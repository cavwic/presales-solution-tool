import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_MODEL_SETTINGS, migrateModelSettings, readSubscriptionApiKey, saveModelSettings } from "./model-settings";
import { parseSubscriptionConfiguration, validateSubscriptionEndpoint } from "./subscription-settings";

afterEach(() => vi.unstubAllGlobals());
describe("subscription settings", () => {
  it("preserves an existing Codex model when old settings gain subscription defaults", () => {
    const { subscriptionProvider: _provider, subscriptionVendor: _vendor, subscriptionProtocol: _protocol, subscriptionEndpoint: _endpoint, subscriptionModel: _model, ...old } = { ...DEFAULT_MODEL_SETTINGS, codexModel: "existing-selected-id", provider: "hybrid" as const };
    expect(migrateModelSettings(old)).toMatchObject({ provider: "hybrid", codexModel: "existing-selected-id", subscriptionProvider: "codex" });
  });
  it("imports common connection aliases and keeps the key outside persisted settings", () => {
    const imported = parseSubscriptionConfiguration(JSON.stringify({ vendor: "deepseek", base_url: "https://api.deepseek.com/v1", model: "exact-model", api_key: "synthetic-key" }));
    expect(imported.patch).toMatchObject({ subscriptionProvider: "compatible", subscriptionVendor: "deepseek", subscriptionEndpoint: "https://api.deepseek.com/v1", subscriptionModel: "exact-model" });
    expect(imported.apiKey).toBe("synthetic-key");
    expect(JSON.stringify(imported.patch)).not.toContain("synthetic-key");
  });
  it("rejects session credentials, malformed models, public HTTP and credential-bearing URLs", () => {
    const base = { endpoint: "https://example.test/v1", model: "exact-model" };
    for (const patch of [{ cookie: "secret" }, { refresh_token: "secret" }, { endpoint: "http://example.test" }, { endpoint: "https://u:p@example.test/v1" }, { endpoint: "https://example.test/v1?api_key=secret" }, { model: "hello\nworld" }]) expect(() => parseSubscriptionConfiguration(JSON.stringify({ ...base, ...patch }))).toThrow();
    expect(validateSubscriptionEndpoint("http://127.0.0.1:1234/v1")).toBe(true);
  });
  it("keeps subscription keys separate from local and cloud credentials", () => {
    let key = "old-plan-key";
    const setItem = vi.fn(), localWrites = vi.fn(), cloudWrites = vi.fn();
    vi.stubGlobal("CustomEvent", class {});
    vi.stubGlobal("localStorage", { setItem });
    vi.stubGlobal("sessionStorage", { removeItem: vi.fn() });
    vi.stubGlobal("window", { bidDesktop: { setApiKey: cloudWrites, setLocalApiKey: localWrites, getSubscriptionApiKey: () => key, setSubscriptionApiKey: (value: string) => { key = value; } }, dispatchEvent: vi.fn() });
    saveModelSettings(DEFAULT_MODEL_SETTINGS, "cloud-key", undefined);
    expect(readSubscriptionApiKey()).toBe("old-plan-key");
    saveModelSettings(DEFAULT_MODEL_SETTINGS, "cloud-key", "local-key", "new-plan-key");
    expect(readSubscriptionApiKey()).toBe("new-plan-key");
    expect(JSON.stringify(setItem.mock.calls)).not.toMatch(/new-plan-key|cloud-key|local-key/);
    expect(cloudWrites).toHaveBeenLastCalledWith("cloud-key");
    expect(localWrites).toHaveBeenLastCalledWith("local-key");
  });
});
