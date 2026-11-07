import { useStore } from "../store";
import { createProvider } from "./providers";
import { isAIConfigured } from "./types";

/**
 * Non-streaming convenience wrapping the active provider's streaming
 * `complete` — this is what `SolenAPI.ai.complete` (plugins/host.ts) is
 * wired to, so plugins get AI "for free" without touching SSE parsing.
 */
export async function completeOnce(prompt: string, opts?: { system?: string; signal?: AbortSignal }): Promise<string> {
  const config = useStore.getState().aiConfig;
  if (!isAIConfigured(config)) {
    throw new Error("尚未设置智能助手。请打开“设置 → 智能助手”，填写服务密钥或本地模型地址。");
  }
  const provider = createProvider(config);
  let out = "";
  for await (const chunk of provider.complete({
    system: opts?.system,
    messages: [{ role: "user", content: prompt }],
    signal: opts?.signal,
  })) {
    out += chunk;
  }
  return out;
}
