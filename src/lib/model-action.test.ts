import { describe, expect, it } from "vitest";
import { hasBrowserCallableModel } from "./model-action";
import { DEFAULT_MODEL_SETTINGS } from "./model-settings";

describe("model action configuration", () => {
  it("does not treat the Codex task workflow as a browser-callable model", () => {
    expect(hasBrowserCallableModel(DEFAULT_MODEL_SETTINGS)).toBe(false);
  });

  it("requires both endpoint and model name for direct model actions", () => {
    expect(hasBrowserCallableModel({ ...DEFAULT_MODEL_SETTINGS, provider: "local", localEndpoint: "http://127.0.0.1:9000/v1/chat/completions" })).toBe(false);
    expect(hasBrowserCallableModel({ ...DEFAULT_MODEL_SETTINGS, provider: "local", localEndpoint: "http://127.0.0.1:9000/v1/chat/completions", localModel: "local-model" })).toBe(true);
    expect(hasBrowserCallableModel({ ...DEFAULT_MODEL_SETTINGS, provider: "cloud", cloudEndpoint: "https://example.com/v1/chat/completions", cloudModel: "cloud-model" })).toBe(true);
  });
});
