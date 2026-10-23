import { z } from "zod";
import { subscriptionProtocolSchema, subscriptionProviderSchema, subscriptionVendorSchema, type ModelSettings, type SubscriptionVendor } from "./model-settings";

export const SUBSCRIPTION_VENDORS: SubscriptionVendor[] = ["openai", "claude", "gemini", "grok", "deepseek", "qwen", "kimi", "glm", "minimax", "other"];
export const SUBSCRIPTION_NAMES: Record<SubscriptionVendor, string> = { openai: "OpenAI", claude: "Claude", gemini: "Gemini", grok: "Grok", deepseek: "DeepSeek", qwen: "Qwen", kimi: "Kimi", glm: "GLM", minimax: "MiniMax", other: "其他 / Other" };
export const SUBSCRIPTION_PRESETS: Record<SubscriptionVendor, Pick<ModelSettings, "subscriptionProtocol" | "subscriptionEndpoint">> = {
  openai: { subscriptionProtocol: "openai", subscriptionEndpoint: "https://api.openai.com/v1" },
  claude: { subscriptionProtocol: "anthropic", subscriptionEndpoint: "https://api.anthropic.com/v1/messages" },
  gemini: { subscriptionProtocol: "gemini", subscriptionEndpoint: "https://generativelanguage.googleapis.com/v1beta" },
  grok: { subscriptionProtocol: "openai", subscriptionEndpoint: "https://api.x.ai/v1" },
  deepseek: { subscriptionProtocol: "openai", subscriptionEndpoint: "https://api.deepseek.com/v1" },
  qwen: { subscriptionProtocol: "openai", subscriptionEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  kimi: { subscriptionProtocol: "openai", subscriptionEndpoint: "https://api.moonshot.cn/v1" },
  glm: { subscriptionProtocol: "openai", subscriptionEndpoint: "https://open.bigmodel.cn/api/paas/v4" },
  minimax: { subscriptionProtocol: "openai", subscriptionEndpoint: "https://api.minimax.cn/v1" },
  other: { subscriptionProtocol: "openai", subscriptionEndpoint: "" },
};

const configurationSchema = z.object({
  connection: subscriptionProviderSchema,
  vendor: subscriptionVendorSchema.default("other"),
  protocol: subscriptionProtocolSchema.default("openai"),
  endpoint: z.string().max(8192).default(""),
  model: z.string().max(128).regex(/^[a-zA-Z0-9_.:/-]*$/).default(""),
  apiKey: z.string().max(16384).refine(value => !/[\r\n\0]/.test(value)).default(""),
});

export function validateSubscriptionEndpoint(value: string): boolean {
  try {
    if (/[\\\s\u0000-\u001f]/.test(value)) return false;
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const local = host === "localhost" || host === "::1" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    return !url.username && !url.password && !url.hash && !url.search && (url.protocol === "https:" || url.protocol === "http:" && local);
  } catch { return false; }
}

// Import connection data, never account cookies or OAuth session credentials.
export function parseSubscriptionConfiguration(text: string): { patch: Partial<ModelSettings>; apiKey: string } {
  if (new TextEncoder().encode(text).byteLength > 65536) throw new Error("CONFIG_TOO_LARGE");
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CONFIG_INVALID");
  if (Object.keys(raw).some(key => /cookie|oauth|access.?token|refresh.?token|session/i.test(key))) throw new Error("CONFIG_SESSION_UNSUPPORTED");
  const config = configurationSchema.parse({ ...raw, connection: raw.connection ?? "compatible", endpoint: raw.endpoint ?? raw.base_url ?? raw.baseUrl ?? "", apiKey: raw.apiKey ?? raw.api_key ?? "" });
  if (config.connection !== "codex" && (!validateSubscriptionEndpoint(config.endpoint) || !config.model.trim())) throw new Error("CONFIG_ENDPOINT_REQUIRED");
  return {
    patch: {
      subscriptionProvider: config.connection,
      subscriptionVendor: config.connection === "codex" ? "openai" : config.connection === "minimax" ? "minimax" : config.vendor,
      subscriptionProtocol: config.protocol,
      subscriptionEndpoint: config.endpoint.trim(),
      subscriptionModel: config.connection === "codex" ? "" : config.model.trim(),
      ...(config.connection === "codex" ? { codexModel: config.model.trim() } : {}),
    },
    apiKey: config.connection === "codex" ? "" : config.apiKey.trim(),
  };
}

export function subscriptionConfigurationTemplate(): string {
  return JSON.stringify({ connection: "compatible", vendor: "other", protocol: "openai", endpoint: "https://your-provider.example/v1", model: "your-exact-model-id" }, null, 2);
}
