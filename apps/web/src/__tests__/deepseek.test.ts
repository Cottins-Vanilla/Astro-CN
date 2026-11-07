import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "../ai/providers";
import { testAIConnection } from "../ai/testConnection";
import { connectionKindOf, switchConnectionKind, DEEPSEEK_BASE_URL } from "../ai/presets";
import { DEFAULT_AI_CONFIG, isAIConfigured, type AIProviderConfig, type CompleteRequest } from "../ai/types";

const config = (patch: Partial<AIProviderConfig> = {}): AIProviderConfig => ({
  provider: "openai-compatible", apiKey: "sk-local-test", model: "deepseek-flash", baseUrl: DEEPSEEK_BASE_URL, ...patch,
});
const request: CompleteRequest = { system: "用中文解释代码", messages: [{ role:"user", content:"你好" }] };
const encoder = new TextEncoder();
function streamResponse(text: string, byteStep = 7) {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({
    start(controller) { for (let i = 0; i < bytes.length; i += byteStep) controller.enqueue(bytes.slice(i, i + byteStep)); controller.close(); },
  }), { headers: { "content-type": "text/event-stream" } });
}
const answer = 'data: {"choices":[{"delta":{"reasoning_content":"思考内容"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好，"}}]}\n\ndata: {"choices":[{"delta":{"content":"连接成功"}}]}\n\ndata: [DONE]\n';
async function complete(c = config(), req = request) { let text = ""; for await (const chunk of createProvider(c).complete(req)) text += chunk; return text; }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("DeepSeek 接入", () => {
  it("选择 DeepSeek 自动填写官方接口与当前模型，清除旧服务密钥", () => {
    const c = switchConnectionKind({ ...DEFAULT_AI_CONFIG, apiKey:"other-provider-key" }, "deepseek");
    expect(c).toMatchObject({ provider:"openai-compatible", baseUrl:"https://api.deepseek.com", model:"deepseek-flash", apiKey:"", deepSeekThinking:false });
    expect(connectionKindOf(c)).toBe("deepseek");
    expect(isAIConfigured(c)).toBe(false);
  });
  it("已有 DeepSeek 设置和旧模型名称能够识别，不改动用户配置", () => {
    const c = config({ baseUrl:"https://api.deepseek.com/v1/", model:"my-custom-model", deepSeekThinking:true });
    expect(connectionKindOf(c)).toBe("deepseek");
    expect(switchConnectionKind(c,"deepseek")).toBe(c);
  });
  it("仅官方域名识别为 DeepSeek，本地模型仍可不填密钥", () => {
    expect(connectionKindOf(config({ baseUrl:"https://api.deepseek.com.example.org" }))).toBe("openai-compatible");
    expect(connectionKindOf(config({ baseUrl:"http://localhost:11434/v1" }))).toBe("local");
    expect(isAIConfigured(config({ baseUrl:"http://localhost:11434/v1", apiKey:"" }))).toBe(true);
    expect(isAIConfigured(config({ apiKey:"   " }))).toBe(false);
  });
  it("正常发送模型、密钥、上下文和聊天记录，逐字读取中文，忽略思考字段", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(answer,1));
    vi.stubGlobal("fetch", fetchMock);
    expect(await complete(config({ apiKey:" sk-local-test ", baseUrl:"https://api.deepseek.com///" }))).toBe("你好，连接成功");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(opts.headers.authorization).toBe("Bearer sk-local-test");
    expect(JSON.parse(opts.body)).toEqual({ model:"deepseek-flash", stream:true, thinking:{ type:"disabled" }, messages:[{ role:"system", content:"用中文解释代码" },{ role:"user", content:"你好" }] });
  });
  it("Pro 模型可开启深入思考，并传递停止信号", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(answer));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await complete(config({ model:"deepseek-v4-pro", deepSeekThinking:true }), { ...request, signal });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model:"deepseek-v4-pro", thinking:{ type:"enabled" } });
    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });
  it("没有密钥时清楚提示，且不发送请求", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch",f);
    await expect(complete(config({ apiKey:"" }))).rejects.toThrow("填写 DeepSeek API 密钥");
    expect(f).not.toHaveBeenCalled();
  });
  it.each([[401,"密钥无效"],[402,"余额不足"],[429,"过于频繁"],[400,"模型名称"],[503,"暂时繁忙"]])("错误 %i 显示中文原因", async (status,message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"message":"provider detail"}}', { status:Number(status) })));
    await expect(complete()).rejects.toThrow(String(message));
  });
  it("连接失败使用中文提示", async () => {
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(complete()).rejects.toThrow("检查网络");
  });
  it("停止请求保留取消状态", async () => {
    const c = new AbortController(); c.abort();
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new DOMException("Stopped","AbortError")));
    await expect(complete(config(), { ...request, signal:c.signal })).rejects.toMatchObject({ name:"AbortError" });
  });
  it("最后一段没有换行也能完整显示，空回复会提示", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(streamResponse('data: {"choices":[{"delta":{"content":"最后一段中文"}}]}',2))
      .mockResolvedValueOnce(streamResponse('data: [DONE]')));
    expect(await complete()).toBe("最后一段中文");
    await expect(complete()).rejects.toThrow("没有返回可显示的回复");
  });
  it("流中的错误会提示而非假装完成", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(streamResponse('data: {"error":{"message":"upstream error"}}\n')));
    await expect(complete()).rejects.toThrow("回复中断");
  });
  it("测试连接使用简短请求、普通回复，并在收到文字后关闭流", async () => {
    let cancelled = false;
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(c) { c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"连接成功"}}]}\n\n')); },
      cancel() { cancelled = true; },
    })));
    vi.stubGlobal("fetch",fetchMock);
    await testAIConnection(config({ deepSeekThinking:true }), new AbortController().signal);
    expect(cancelled).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ thinking:{ type:"disabled" }, max_tokens:32 });
  });
  it("普通兼容服务不发送 DeepSeek 参数", async () => {
    const f = vi.fn().mockResolvedValue(streamResponse(answer));
    vi.stubGlobal("fetch",f);
    await complete(config({ baseUrl:"http://localhost:1234/v1", apiKey:"", model:"local-model" }));
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("thinking");
    expect(body.model).toBe("local-model");
    expect(f.mock.calls[0][1].headers).not.toHaveProperty("authorization");
  });
});

