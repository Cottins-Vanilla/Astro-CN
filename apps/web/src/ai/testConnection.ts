import { createProvider } from "./providers";
import { isAIConfigured, isDeepSeekConfig, type AIProviderConfig } from "./types";

export async function testAIConnection(config: AIProviderConfig, signal: AbortSignal): Promise<void> {
  if (!isAIConfigured(config)) throw new Error("请先填写服务密钥或本地模型服务地址。");
  const provider = createProvider(isDeepSeekConfig(config) ? { ...config, deepSeekThinking: false } : config);
  for await (const chunk of provider.complete({
    messages: [{ role: "user", content: "请只回复：连接成功" }], maxTokens: 32, signal,
  })) {
    if (chunk.trim()) return;
  }
  throw new Error("没有收到模型回复，请检查设置后重试。");
}

