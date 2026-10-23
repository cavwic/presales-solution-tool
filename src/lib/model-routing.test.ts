import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_SETTINGS,
  MODEL_SETTINGS_STORAGE_KEY,
  getModelProvider,
  migrateModelSettings,
  readModelSettings,
  type ModelChannel,
  type ModelSettings,
  type ModelTask,
} from "./model-settings";
import { requestPresalesDraft } from "./presales-generation";
import { hasBrowserCallableModel } from "./model-action";

afterEach(() => vi.unstubAllGlobals());

const legacyFields = {
  localEndpoint: "http://192.168.50.118:11434/v1/chat/completions",
  localModel: "customer-selected-local-model",
  cloudEndpoint: "https://api.example.test/custom/v1/chat/completions",
  cloudModel: "customer-selected-api-model",
};

describe("model settings migration", () => {
  for (const provider of ["local", "codex", "cloud"] as const) {
    it(`preserves all old model fields and the selected ${provider} channel`, () => {
      const stored = { schemaVersion: "2.0.0", provider, ...legacyFields };
      const migrated = migrateModelSettings(stored);
      expect(migrated).toMatchObject({ schemaVersion: "3.0.0", provider, ...legacyFields });
      expect(migrated.enabledProviders).toContain(provider);
      expect(getModelProvider(migrated, "draft")).toBe(provider);
      expect(stored).toEqual({ schemaVersion: "2.0.0", provider, ...legacyFields });
    });
  }

  it("retains endpoints and model IDs in older payloads instead of replacing them with defaults", () => {
    expect(migrateModelSettings({ schemaVersion: "1.0.0", provider: "local", ...legacyFields })).toMatchObject(legacyFields);
  });

  it("round trips hybrid assignments and disabled channel configuration without data loss", () => {
    const configured: ModelSettings = {
      ...DEFAULT_MODEL_SETTINGS,
      ...legacyFields,
      provider: "hybrid",
      enabledProviders: ["local", "codex"],
      hybridRoutes: { analysis: "local", draft: "codex", ocr: "local" },
    };
    expect(migrateModelSettings(JSON.parse(JSON.stringify(configured)))).toEqual(configured);
    expect(getModelProvider(configured, "analysis")).toBe("local");
    expect(getModelProvider(configured, "draft")).toBe("codex");
    expect(getModelProvider(configured, "ocr")).toBe("local");
  });

  it("reads settings without rewriting the stored payload or any project data", () => {
    const stored = JSON.stringify({ schemaVersion: "2.0.0", provider: "cloud", ...legacyFields });
    const getItem = vi.fn((key: string) => key === MODEL_SETTINGS_STORAGE_KEY ? stored : null);
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem, removeItem });
    expect(readModelSettings()).toMatchObject({ provider: "cloud", ...legacyFields });
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(getItem).toHaveBeenCalledWith(MODEL_SETTINGS_STORAGE_KEY);
  });

  it("recovers malformed saved JSON with valid defaults without deleting the original value", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => '{"damaged":', setItem, removeItem });
    expect(readModelSettings()).toEqual(DEFAULT_MODEL_SETTINGS);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});

describe("model task routing", () => {
  const tasks: ModelTask[] = ["analysis", "draft", "ocr"];
  const channels: ModelChannel[] = ["local", "codex", "cloud"];

  it("pure local mode remains local for analysis, drafting and OCR", () => {
    const settings: ModelSettings = { ...DEFAULT_MODEL_SETTINGS, ...legacyFields, provider: "local", enabledProviders: ["local"] };
    for (const task of tasks) expect(getModelProvider(settings, task)).toBe("local");
  });

  it("uses each explicit hybrid task assignment only when that channel is enabled", () => {
    for (const task of tasks) for (const selected of channels) {
      const settings: ModelSettings = {
        ...DEFAULT_MODEL_SETTINGS,
        ...legacyFields,
        provider: "hybrid",
        enabledProviders: [selected],
        hybridRoutes: { analysis: selected, draft: selected, ocr: selected },
      };
      expect(getModelProvider(settings, task)).toBe(selected);
    }
  });

  it("cannot route a stale assignment to a disabled cloud or subscription channel", () => {
    const settings: ModelSettings = {
      ...DEFAULT_MODEL_SETTINGS,
      ...legacyFields,
      provider: "hybrid",
      enabledProviders: ["local"],
      hybridRoutes: { analysis: "cloud", draft: "codex", ocr: "cloud" },
    };
    for (const task of tasks) expect(getModelProvider(settings, task)).toBe("local");
  });

  it("uses enabled order for a stale hybrid assignment without preferring an unselected service", () => {
    const settings: ModelSettings = {
      ...DEFAULT_MODEL_SETTINGS,
      provider: "hybrid",
      enabledProviders: ["codex", "local"],
      hybridRoutes: { analysis: "cloud", draft: "cloud", ocr: "cloud" },
    };
    for (const task of tasks) expect(getModelProvider(settings, task)).toBe("codex");
  });

  it("does not retry a failed local draft against cloud even when cloud configuration exists", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":"fixture local unavailable"}', { status: 503 }));
    const settings: ModelSettings = {
      ...DEFAULT_MODEL_SETTINGS,
      ...legacyFields,
      provider: "local",
      enabledProviders: ["local"],
    };
    await expect(requestPresalesDraft(settings, "", "虚构测试内容", fetcher as typeof fetch)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(legacyFields.localEndpoint);
  });

  it("enables subscription generation only when the native model bridge is present", () => {
    const settings: ModelSettings = { ...DEFAULT_MODEL_SETTINGS, provider: "codex" };
    expect(hasBrowserCallableModel(settings)).toBe(false);
    vi.stubGlobal("window", { bidDesktop: { modelChat: vi.fn() } });
    expect(hasBrowserCallableModel(settings)).toBe(true);
  });

  it("forwards the task to the native bridge and records its actual provider and model", async () => {
    const result = { content: "虚构分析内容", provider: "codex" as const, model: "selected-plan-model" };
    const modelChat = vi.fn(async () => result);
    vi.stubGlobal("window", { bidDesktop: { modelChat } });
    const settings: ModelSettings = {
      ...DEFAULT_MODEL_SETTINGS,
      provider: "hybrid",
      enabledProviders: ["local", "codex"],
      hybridRoutes: { analysis: "codex", draft: "local", ocr: "codex" },
    };
    expect(await requestPresalesDraft(settings, "synthetic-memory-secret", "虚构分析提示词", undefined, "analysis")).toEqual(result);
    expect(modelChat).toHaveBeenCalledWith({ settings, apiKey: "synthetic-memory-secret", prompt: "虚构分析提示词", task: "analysis" });
  });
});
