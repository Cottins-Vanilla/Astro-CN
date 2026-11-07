/** One turn of a chat exchange sent to an AI provider. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteRequest {
  system?: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
}

/**
 * A streaming chat completion backend. `complete` returns an async iterable
 * of text chunks rather than a promise so the AI panel can render tokens as
 * they arrive.
 */
export interface AIProvider {
  id: string;
  label: string;
  complete(req: CompleteRequest): AsyncIterable<string>;
}

export type AIProviderKind = "anthropic" | "openai-compatible";

/** Persisted under vault settings as `ai.*` (see store.ts). */
export interface AIProviderConfig {
  provider: AIProviderKind;
  apiKey: string;
  model: string;
  /** Override the provider's default endpoint — required for local runtimes. */
  baseUrl: string;
  /** DeepSeek-only thinking mode. Omitted means normal replies. */
  deepSeekThinking?: boolean;
}

export const DEFAULT_AI_CONFIG: AIProviderConfig = {
  provider: "anthropic",
  apiKey: "",
  model: "claude-sonnet-5",
  baseUrl: "",
};

/**
 * Whether this config has enough to attempt a request. An API key is not the test: Settings →
 * AI offers "Local model (Ollama, LM Studio, …)" and deliberately hides the key field for it,
 * so keying off `apiKey` alone made every local runtime report "not configured" and refuse to
 * run. A hosted OpenAI-compatible endpoint that does need a key and was given none now fails
 * with the provider's own 401 text instead, which says more than a blanket "not configured".
 *
 * One helper, both call sites (AIPanel's banner and `completeOnce`'s guard), so the panel can
 * never say "ready" while the plugin path throws — or the reverse.
 */
export function isAIConfigured(config: AIProviderConfig): boolean {
  if (isDeepSeekConfig(config)) return !!config.apiKey.trim();
  if (config.apiKey.trim()) return true;
  return config.provider === "openai-compatible" && config.baseUrl.trim().length > 0;
}

export function isDeepSeekConfig(config: AIProviderConfig): boolean {
  if (config.provider !== "openai-compatible") return false;
  try { return new URL(config.baseUrl.trim()).origin === "https://api.deepseek.com"; } catch { return false; }
}
