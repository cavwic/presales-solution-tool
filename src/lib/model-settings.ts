import { z } from "zod";

export const MODEL_SETTINGS_STORAGE_KEY = "cavwic-lab-model-settings";
export const MODEL_API_KEY_STORAGE_KEY = "cavwic-lab-api-key";
export const MODEL_SETTINGS_CHANGED_EVENT = "cavwic-model-settings-change";
export const modelChannelSchema = z.enum(["local", "codex", "cloud"]);
export type ModelChannel = z.infer<typeof modelChannelSchema>;
export type ModelTask = "analysis" | "draft" | "ocr";
export const localModelRuntimeSchema = z.enum(["ollama", "lmstudio", "openai"]);
export type LocalModelRuntime = z.infer<typeof localModelRuntimeSchema>;
export const subscriptionProviderSchema = z.enum(["codex", "minimax", "compatible"]);
export const subscriptionProtocolSchema = z.enum(["openai", "anthropic", "gemini"]);
export const subscriptionVendorSchema = z.enum(["openai", "claude", "gemini", "grok", "deepseek", "qwen", "kimi", "glm", "minimax", "other"]);
export type SubscriptionProvider = z.infer<typeof subscriptionProviderSchema>;
export type SubscriptionProtocol = z.infer<typeof subscriptionProtocolSchema>;
export type SubscriptionVendor = z.infer<typeof subscriptionVendorSchema>;
const localProfileSchema = z.object({ endpoint: z.string(), model: z.string() });

export const LOCAL_MODEL_DEFAULT_ENDPOINTS: Record<LocalModelRuntime, string> = {
  ollama: "http://127.0.0.1:11434",
  lmstudio: "http://127.0.0.1:1234/v1",
  openai: "http://127.0.0.1:8080/v1",
};

export const modelSettingsSchema = z.object({
  schemaVersion: z.literal("3.0.0"),
  provider: z.enum(["codex", "local", "cloud", "hybrid"]),
  localEndpoint: z.string(),
  localModel: z.string(),
  // Older saved endpoints used Chat Completions, including Ollama's /v1 API.
  // Missing runtime must therefore preserve that protocol rather than infer it.
  localRuntime: localModelRuntimeSchema.default("openai"),
  localProfiles: z.object({ ollama: localProfileSchema.optional(), lmstudio: localProfileSchema.optional(), openai: localProfileSchema.optional() }).default({}),
  cloudEndpoint: z.string(),
  cloudModel: z.string(),
  codexModel: z.string().default(""),
  subscriptionProvider: subscriptionProviderSchema.default("codex"),
  subscriptionVendor: subscriptionVendorSchema.default("openai"),
  subscriptionProtocol: subscriptionProtocolSchema.default("openai"),
  subscriptionEndpoint: z.string().default(""),
  subscriptionModel: z.string().default(""),
  enabledProviders: z.array(modelChannelSchema).min(1).default(["local", "codex", "cloud"]),
  hybridRoutes: z.object({ analysis: modelChannelSchema, draft: modelChannelSchema, ocr: modelChannelSchema }).default({ analysis: "local", draft: "codex", ocr: "cloud" }),
});

export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export type ModelProvider = ModelSettings["provider"];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  schemaVersion: "3.0.0",
  provider: "codex",
  localEndpoint: LOCAL_MODEL_DEFAULT_ENDPOINTS.ollama,
  localModel: "",
  localRuntime: "ollama",
  localProfiles: {},
  cloudEndpoint: "",
  cloudModel: "",
  codexModel: "",
  subscriptionProvider: "codex",
  subscriptionVendor: "openai",
  subscriptionProtocol: "openai",
  subscriptionEndpoint: "",
  subscriptionModel: "",
  enabledProviders: ["local", "codex", "cloud"],
  hybridRoutes: { analysis: "local", draft: "codex", ocr: "cloud" },
};

export function getModelProvider(settings: ModelSettings, task: ModelTask = "draft"): ModelChannel {
  if (settings.provider !== "hybrid") return settings.provider;
  const selected = settings.hybridRoutes[task];
  return settings.enabledProviders.includes(selected) ? selected : settings.enabledProviders[0];
}

export function migrateModelSettings(value: unknown): ModelSettings {
  const current = modelSettingsSchema.safeParse(value);
  if (current.success) return current.data;
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(DEFAULT_MODEL_SETTINGS);
  const old = value as Record<string, unknown>;
  const provider = ["local", "cloud", "codex"].includes(String(old.provider)) ? old.provider as ModelChannel : "codex";
  return {
    ...structuredClone(DEFAULT_MODEL_SETTINGS), provider,
    localEndpoint: typeof old.localEndpoint === "string" ? old.localEndpoint : "",
    localModel: typeof old.localModel === "string" ? old.localModel : "",
    localRuntime: localModelRuntimeSchema.safeParse(old.localRuntime).success ? old.localRuntime as LocalModelRuntime : "openai",
    cloudEndpoint: typeof old.cloudEndpoint === "string" ? old.cloudEndpoint : "",
    cloudModel: typeof old.cloudModel === "string" ? old.cloudModel : "",
    codexModel: typeof old.codexModel === "string" ? old.codexModel : "",
    enabledProviders: [provider],
  };
}

export function readModelSettings(): ModelSettings {
  if (typeof localStorage === "undefined") return DEFAULT_MODEL_SETTINGS;
  const stored = localStorage.getItem(MODEL_SETTINGS_STORAGE_KEY);
  if (!stored) return DEFAULT_MODEL_SETTINGS;
  try {
    return migrateModelSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

export function readModelApiKey(): string {
  if (typeof window !== "undefined" && window.bidDesktop) return window.bidDesktop.getApiKey();
  return typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(MODEL_API_KEY_STORAGE_KEY) || "";
}

let sessionLocalApiKey = "";
let sessionSubscriptionApiKey = "";

export function readSubscriptionApiKey(): string {
  if (typeof window !== "undefined" && window.bidDesktop?.getSubscriptionApiKey) return window.bidDesktop.getSubscriptionApiKey();
  return sessionSubscriptionApiKey;
}

export function readLocalModelApiKey(): string {
  if (typeof window !== "undefined" && window.bidDesktop?.getLocalApiKey) return window.bidDesktop.getLocalApiKey();
  return sessionLocalApiKey;
}

export function saveModelSettings(settings: ModelSettings, apiKey: string, localApiKey?: string, subscriptionApiKey?: string): void {
  const parsed = modelSettingsSchema.parse(settings);
  localStorage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
  if (typeof window !== "undefined" && window.bidDesktop) {
    window.bidDesktop.setApiKey(apiKey);
    sessionStorage.removeItem(MODEL_API_KEY_STORAGE_KEY);
  }
  else if (apiKey.trim()) sessionStorage.setItem(MODEL_API_KEY_STORAGE_KEY, apiKey.trim());
  else sessionStorage.removeItem(MODEL_API_KEY_STORAGE_KEY);
  if (localApiKey !== undefined) {
    if (typeof window !== "undefined" && window.bidDesktop?.setLocalApiKey) window.bidDesktop.setLocalApiKey(localApiKey);
    else sessionLocalApiKey = localApiKey.trim();
  }
  if (subscriptionApiKey !== undefined) {
    if (typeof window !== "undefined" && window.bidDesktop?.setSubscriptionApiKey) window.bidDesktop.setSubscriptionApiKey(subscriptionApiKey);
    else sessionSubscriptionApiKey = subscriptionApiKey.trim();
  }
  window.dispatchEvent(new CustomEvent(MODEL_SETTINGS_CHANGED_EVENT, { detail: parsed }));
}
