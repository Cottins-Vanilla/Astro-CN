import { isDeepSeekConfig, type AIProviderConfig } from "./types";

export type ConnectionKind = "anthropic" | "deepseek" | "openai-compatible" | "local";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODELS = [
  { id: "deepseek-flash", label: "Flash · 日常问答与代码讲解" },
  { id: "deepseek-v4-pro", label: "Pro · 复杂代码与问题分析" },
] as const;

export function connectionKindOf(config: AIProviderConfig): ConnectionKind {
  if (config.provider === "anthropic") return "anthropic";
  if (isDeepSeekConfig(config)) return "deepseek";
  try {
    const host = new URL(config.baseUrl.trim()).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "local";
  } catch { /* Incomplete custom URLs stay editable as an online service. */ }
  return "openai-compatible";
}

/** The transport remains OpenAI-compatible, so existing saved configurations keep working. */
export function switchConnectionKind(config: AIProviderConfig, kind: ConnectionKind): AIProviderConfig {
  if (connectionKindOf(config) === kind) return config;
  const common = { ...config, apiKey: "", deepSeekThinking: false };
  if (kind === "deepseek") return { ...common, provider: "openai-compatible", baseUrl: DEEPSEEK_BASE_URL, model: DEEPSEEK_MODELS[0].id };
  if (kind === "anthropic") return { ...common, provider: "anthropic", baseUrl: "", model: "claude-sonnet-5" };
  if (kind === "local") return { ...common, provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "" };
  return { ...common, provider: "openai-compatible", baseUrl: "", model: "gpt-4o-mini" };
}

