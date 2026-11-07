import { isDeepSeekConfig, type AIProvider, type AIProviderConfig, type CompleteRequest } from "./types";

/** SSE data may span network chunks, UTF-8 characters and CRLF boundaries. */
async function* sseLines(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer.trim();
  } finally {
    try { await reader.cancel(); } catch { /* Preserve the original request error. */ }
    reader.releaseLock();
  }
}

function deepSeekError(status: number): string {
  if (status === 401 || status === 403) return "密钥无效或没有访问权限，请检查 DeepSeek API 密钥。";
  if (status === 402) return "DeepSeek 账户余额不足，请到开放平台查看余额。";
  if (status === 429) return "请求过于频繁，请稍后再试。";
  if (status === 400 || status === 404 || status === 422) return "模型名称或接口参数不正确，请检查设置。";
  if (status >= 500) return "DeepSeek 服务暂时繁忙，请稍后再试。";
  return "请求未完成，请检查设置后重试。";
}

async function describeError(res: Response, label: string): Promise<string> {
  if (label === "DeepSeek") return "DeepSeek：" + deepSeekError(res.status) + "（" + res.status + "）";
  const raw = await res.text();
  let detail = raw;
  try {
    const body = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    detail = body.error?.message ?? body.message ?? "";
  } catch { /* Non-JSON errors can still contain a useful message. */ }
  return label + "请求出错（" + res.status + "）：" + (detail || res.statusText || "请求失败");
}

async function* anthropicComplete(config: AIProviderConfig, req: CompleteRequest): AsyncGenerator<string> {
  const baseUrl = (config.baseUrl.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model.trim() || "claude-sonnet-5",
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      }),
      signal: req.signal,
    });
  } catch (err) {
    if (req.signal?.aborted) throw err;
    throw new Error("Anthropic 服务连接失败，请检查网络和接口地址。");
  }
  if (!res.ok) throw new Error(await describeError(res, "Anthropic"));
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    if (!data) continue;
    let event: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
    try { event = JSON.parse(data); } catch { continue; }
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
      yield event.delta.text;
    } else if (event.type === "error") {
      throw new Error(event.error?.message ?? "Anthropic 回复中断");
    }
  }
}

async function* openAICompatibleComplete(config: AIProviderConfig, req: CompleteRequest): AsyncGenerator<string> {
  const deepseek = isDeepSeekConfig(config);
  const label = deepseek ? "DeepSeek" : "模型服务";
  if (deepseek && !config.apiKey.trim()) throw new Error("请先在“设置 → 智能助手”中填写 DeepSeek API 密钥。");
  const baseUrl = (config.baseUrl.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey.trim() ? { authorization: "Bearer " + config.apiKey.trim() } : {}),
      },
      body: JSON.stringify({
        model: config.model.trim() || (deepseek ? "deepseek-flash" : "gpt-4o-mini"),
        stream: true,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(deepseek ? { thinking: { type: config.deepSeekThinking ? "enabled" : "disabled" } } : {}),
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          ...req.messages.map(m => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: req.signal,
    });
  } catch (err) {
    if (req.signal?.aborted) throw err;
    throw new Error(label + "连接失败，请检查网络和接口地址。");
  }
  if (!res.ok) throw new Error(await describeError(res, label));
  let received = false;
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    if (!data) continue;
    let event: { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
    try { event = JSON.parse(data); } catch { continue; }
    if (event.error) throw new Error(deepseek ? "DeepSeek 回复中断，请稍后重试。" : event.error.message || "模型回复中断");
    const delta = event.choices?.[0]?.delta?.content;
    if (delta) { received = true; yield delta; }
  }
  if (!received) throw new Error(label + "没有返回可显示的回复，请检查模型设置后重试。");
}

export function createProvider(config: AIProviderConfig): AIProvider {
  if (config.provider === "anthropic") {
    return { id: "anthropic", label: "Anthropic", complete: req => anthropicComplete(config, req) };
  }
  return { id: isDeepSeekConfig(config) ? "deepseek" : "openai-compatible",
    label: isDeepSeekConfig(config) ? "DeepSeek" : "兼容 OpenAI 接口", complete: req => openAICompatibleComplete(config, req) };
}

