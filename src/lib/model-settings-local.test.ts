import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_SETTINGS,
  MODEL_SETTINGS_STORAGE_KEY,
  migrateModelSettings,
  readLocalModelApiKey,
  saveModelSettings,
} from "./model-settings";

afterEach(() => vi.unstubAllGlobals());

describe("local model settings compatibility", () => {
  it.each(["2.0.0", "3.0.0"])("keeps legacy %s local endpoints on the OpenAI-compatible protocol", (schemaVersion) => {
    const old = {
      ...DEFAULT_MODEL_SETTINGS,
      schemaVersion,
      localEndpoint: "http://192.168.50.118:11434/v1/chat/completions",
      localModel: "existing-customer-model:custom",
      localRuntime: undefined,
      localProfiles: undefined,
    };
    const migrated = migrateModelSettings(old);
    expect(migrated.localRuntime).toBe("openai");
    expect(migrated.localEndpoint).toBe(old.localEndpoint);
    expect(migrated.localModel).toBe(old.localModel);
    expect(old.localRuntime).toBeUndefined();
  });

  it("uses native Ollama only for a fresh default configuration", () => {
    expect(DEFAULT_MODEL_SETTINGS.localRuntime).toBe("ollama");
    expect(DEFAULT_MODEL_SETTINGS.localEndpoint).toBe("http://127.0.0.1:11434");
    expect(DEFAULT_MODEL_SETTINGS.localModel).toBe("");
  });

  it("preserves each saved service profile and exact custom model ID", () => {
    const settings = {
      ...DEFAULT_MODEL_SETTINGS,
      localRuntime: "lmstudio" as const,
      localEndpoint: "http://127.0.0.1:1234/custom/v1",
      localModel: "custom-loaded-id",
      localProfiles: {
        ollama: { endpoint: "http://192.168.50.118:11434", model: "qwen-custom:4b" },
        lmstudio: { endpoint: "http://127.0.0.1:1234/custom/v1", model: "custom-loaded-id" },
        openai: { endpoint: "http://127.0.0.1:8080/api/v1/chat/completions", model: "another-exact-id" },
      },
    };
    expect(migrateModelSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it("keeps local and cloud tokens separate and out of persisted configuration", () => {
    let localKey = "existing-local-session-token";
    const localWrites = vi.fn((value: string) => { localKey = value; });
    const cloudWrites = vi.fn();
    const setItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("CustomEvent", class { constructor(public type: string, public options: unknown) {} });
    vi.stubGlobal("localStorage", { setItem });
    vi.stubGlobal("sessionStorage", { removeItem: vi.fn() });
    vi.stubGlobal("window", { bidDesktop: { getLocalApiKey: () => localKey, setLocalApiKey: localWrites, setApiKey: cloudWrites }, dispatchEvent });

    saveModelSettings(DEFAULT_MODEL_SETTINGS, "cloud-session-token");
    expect(localWrites).not.toHaveBeenCalled();
    expect(readLocalModelApiKey()).toBe("existing-local-session-token");

    saveModelSettings(DEFAULT_MODEL_SETTINGS, "cloud-session-token", "separate-local-token");
    expect(readLocalModelApiKey()).toBe("separate-local-token");
    expect(cloudWrites).toHaveBeenLastCalledWith("cloud-session-token");
    expect(setItem).toHaveBeenLastCalledWith(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_MODEL_SETTINGS));
    expect(JSON.stringify(setItem.mock.calls)).not.toContain("token");

    saveModelSettings(DEFAULT_MODEL_SETTINGS, "cloud-session-token", "");
    expect(readLocalModelApiKey()).toBe("");
  });
});
