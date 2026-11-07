import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CONFIG, isAIConfigured, type AIProviderConfig } from "../ai/types";

const cfg = (patch: Partial<AIProviderConfig>): AIProviderConfig => ({ ...DEFAULT_AI_CONFIG, ...patch });

describe("isAIConfigured", () => {
  it("is false for the untouched default", () => {
    expect(isAIConfigured(DEFAULT_AI_CONFIG)).toBe(false);
  });

  it("is true once an API key is present", () => {
    expect(isAIConfigured(cfg({ apiKey: "sk-test" }))).toBe(true);
  });

  it("treats whitespace as no key", () => {
    expect(isAIConfigured(cfg({ apiKey: "   " }))).toBe(false);
  });

  // The regression this helper exists for: Settings → AI's "Local model" kind hides the key
  // field entirely, so a keyless Ollama/LM Studio setup must still count as configured.
  it("is true for a keyless local runtime", () => {
    expect(isAIConfigured(cfg({ provider: "openai-compatible", apiKey: "", baseUrl: "http://localhost:11434/v1" }))).toBe(
      true,
    );
  });

  it("is false for anthropic without a key, base URL or not", () => {
    expect(isAIConfigured(cfg({ provider: "anthropic", apiKey: "", baseUrl: "https://api.anthropic.com" }))).toBe(false);
  });
});
