// Regression: a context overflow is a request-scoped 4xx, so checkFallbackError
// deliberately reports shouldFallback:false — that is the right answer for an
// ACCOUNT (cooling it down would evict a healthy connection) but the wrong one
// for a COMBO. In a combo the request is valid; only the current member is too
// small, and the next member may well fit. Returning the 400 straight to the
// client made a fallback combo useless whenever a small model sat above a
// large one. (#4796)
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { isModelFitError } from "../../open-sse/config/errorConfig.js";

// Mirrors the combo loop's condition in services/combo.js.
const comboFallsBack = (status, errorText) =>
  checkFallbackError(status, errorText).shouldFallback || isModelFitError(errorText);

describe("isModelFitError", () => {
  it.each([
    // OpenAI / DeepSeek / Mistral / Qwen and most OSS gateways
    "This model's maximum context length is 8192 tokens. However, you requested 64213 tokens.",
    // OpenAI SDK / codex error code
    "Error code: 400 - context_length_exceeded",
    // Anthropic
    "input length and `max_tokens` exceed context limit: 210000 > 200000",
    // Gemini
    "The input token count (1000001) exceeds the maximum number of tokens allowed (1000000).",
    "Prompt is too long: 1676806 tokens > 1000000 maximum",
  ])("recognises a context overflow: %s", (text) => {
    expect(isModelFitError(text)).toBe(true);
  });

  it("ignores account-scoped and ordinary request errors", () => {
    expect(isModelFitError("rate limit reached")).toBe(false);
    expect(isModelFitError("insufficient credits")).toBe(false);
    expect(isModelFitError("invalid_api_key")).toBe(false);
    expect(isModelFitError("unsupported parameter: foo")).toBe(false);
    expect(isModelFitError("")).toBe(false);
    expect(isModelFitError(null)).toBe(false);
    expect(isModelFitError(undefined)).toBe(false);
  });
});

describe("combo fallback on a context overflow (#4796)", () => {
  it("tries the next model instead of returning the 400", () => {
    const text = "This model's maximum context length is 8192 tokens. However, you requested 64213 tokens.";
    expect(comboFallsBack(400, text)).toBe(true);
  });

  it("still does not cool the account down for the same error", () => {
    // The account fix (account-fallback-4xx.test.js) must stay intact: only the
    // combo moves on, the connection keeps its place in rotation.
    const text = "This model's maximum context length is 8192 tokens. However, you requested 64213 tokens.";
    expect(checkFallbackError(400, text)).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("still stops the combo on a genuine client error", () => {
    expect(comboFallsBack(400, "unsupported parameter: foo")).toBe(false);
    expect(comboFallsBack(422, "messages: field required")).toBe(false);
  });

  it("still falls back for account-scoped failures", () => {
    for (const status of [401, 402, 403, 404, 429, 503]) {
      expect(comboFallsBack(status, "nope")).toBe(true);
    }
  });
});