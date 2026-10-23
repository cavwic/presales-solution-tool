import { BookOpen, Check, ChevronDown, Cloud, Cpu, Download, Layers3, LoaderCircle, RefreshCw, Save, TerminalSquare, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_MODEL_SETTINGS, LOCAL_MODEL_DEFAULT_ENDPOINTS, readLocalModelApiKey, readModelApiKey, readModelSettings, readSubscriptionApiKey, saveModelSettings, type LocalModelRuntime, type ModelProvider, type ModelSettings, type SubscriptionProvider, type SubscriptionProtocol, type SubscriptionVendor } from "../lib/model-settings";
import { parseSubscriptionConfiguration, SUBSCRIPTION_NAMES, SUBSCRIPTION_PRESETS, SUBSCRIPTION_VENDORS, subscriptionConfigurationTemplate, validateSubscriptionEndpoint } from "../lib/subscription-settings";
import SkillManager from "./SkillManager";
import type { Locale } from "../lib/workspace-schema";
import "../styles/model-controls.css";

type Channel = "local" | "codex" | "cloud";
type Task = "analysis" | "draft" | "ocr";
type CatalogItem = { id: string; name?: string };
const channels: Channel[] = ["local", "codex", "cloud"];
const modes: ModelProvider[] = ["local", "codex", "cloud", "hybrid"];
const tasks: Task[] = ["analysis", "draft", "ocr"];
const icons = { local: Cpu, codex: TerminalSquare, cloud: Cloud, hybrid: Layers3 };
const localRuntimes: LocalModelRuntime[] = ["ollama", "lmstudio", "openai"];
const copy = {
  zh: {
    channels: "模型通道", local: "本地模型", codex: "模型套餐", cloud: "API", hybrid: "混合", model: "模型名称", unnamed: "尚未选择模型",
    open: "展开模型设置", close: "收起模型设置", title: "模型与任务分工", endpoint: "接口地址", apiKey: "API 密钥", keyHint: "密钥仅保留在本次应用会话中。", defaultModel: "当前默认套餐模型",
    localHint: "连接已运行的 Ollama、LM Studio 或其他 OpenAI 兼容服务。", localRuntime: "服务类型", localEndpoint: "服务地址", localToken: "访问令牌（可选）", localKeyHint: "服务要求认证时填写，仅保留在本次应用会话中。", localCatalog: "读取本地模型", localCatalogEmpty: "暂无可用模型，请先在对应工具中下载或加载模型，再重新读取。", localCatalogFailed: "无法读取模型，请检查服务是否已启动、地址和访问令牌是否正确。", localModelPlaceholder: "填写模型 ID，或读取后选择", compatibleService: "其他兼容服务", localTestError: "请检查服务是否已启动、模型是否已下载或加载，以及地址和访问令牌是否正确。", codexHint: "使用本机 Codex 登录。点击读取可用模型后选择，或填写准确的模型名称。", cloudHint: "分析和生成时，所选资料会发送到该接口。",
    catalog: "读取可用模型", catalogRead: "模型列表已读取，仍需生成测试。", catalogEmpty: "此接口未提供模型列表，请填写完整模型 ID 后测试。", catalogFailed: "模型列表读取失败，请检查所选服务的配置或登录状态。",
    manual: "手动填写模型名称", desktopOnly: "模型套餐调用和生成测试请使用桌面版。", test: "测试生成", testing: "正在测试…", verified: "生成测试通过", untested: "尚未测试", failed: "生成测试未通过", save: "保存配置", saved: "配置已保存。", continue: "保存并继续", unsaved: "有未保存的修改",
    connection: "接入方式", codexConnection: "ChatGPT 套餐（Codex）", minimaxConnection: "MiniMax 套餐（M Plan / Token Plan）", compatibleConnection: "其他授权套餐 / 接口", vendor: "服务商", protocol: "接口协议", subscriptionKey: "套餐 / 接口密钥", minimaxHint: "填写 MiniMax 订阅 Key，使用 M Plan 或 Token Plan 额度；按量 Key 的费用另计。", compatibleHint: "需要厂商允许本工具使用的套餐接口或独立 API Key。网页会员不能直接导入为接口额度，费用按厂商规则计算。", importConfig: "导入配置", configExample: "配置示例", imported: "配置已载入，请检查地址、模型和计费方式后保存。", importError: "配置无效。请使用示例格式；不支持导入账号 Cookie 或 OAuth 会话。", needSubscriptionKey: "请填写所选服务的套餐或接口密钥。", importSkills: "导入 Skills", skillsHint: "上传或联网安装，启用后供所有模型通道共用。", other: "其他服务商",
    enabled: "启用通道", routing: "任务分工", analysis: "资料分析", draft: "文件生成", ocr: "图像识别", oneChannel: "请至少保留一个模型通道。", needModel: "请填写模型名称。", needEndpoint: "请填写接口地址和模型名称。", invalidEndpoint: "接口地址须以 http:// 或 https:// 开头。", pending: "完成设置后继续当前任务。", testError: "请检查服务地址、模型名称和登录状态后重试。", configured: "已配置", cancel: "放弃修改", selectCatalog: "从模型列表选择", hybridHint: "各任务仅使用指定通道；失败时不会自动改用其它通道。",
  },
  en: {
    channels: "Model channels", local: "Local model", codex: "Model plans", cloud: "API", hybrid: "Hybrid", model: "Model name", unnamed: "No model selected",
    open: "Expand model settings", close: "Collapse model settings", title: "Models and task routing", endpoint: "Endpoint URL", apiKey: "API key", keyHint: "The key is kept for this app session only.", defaultModel: "Current default plan model",
    localHint: "Connect to a running Ollama, LM Studio, or another OpenAI-compatible service.", localRuntime: "Service type", localEndpoint: "Service URL", localToken: "Access token (optional)", localKeyHint: "Only needed if the service requires authentication. Kept for this app session only.", localCatalog: "Read local models", localCatalogEmpty: "No models are available. Download or load a model in the selected tool, then read the list again.", localCatalogFailed: "Could not read models. Check that the service is running and that the URL and access token are correct.", localModelPlaceholder: "Enter a model ID, or read the list to choose one", compatibleService: "Other compatible service", localTestError: "Check that the service is running, the model is downloaded or loaded, and the URL and access token are correct.", codexHint: "Uses your local Codex sign-in. Read available models to choose one, or enter an exact model name.", cloudHint: "Selected source material is sent to this endpoint during analysis and generation.",
    catalog: "Read available models", catalogRead: "Model list loaded. Run a generation test to verify access.", catalogEmpty: "This endpoint does not provide a model list. Enter the exact model ID and run a test.", catalogFailed: "Could not read models. Check the selected service’s settings or sign-in.",
    manual: "Enter a model name", desktopOnly: "Use the desktop app for model plans and generation tests.", test: "Test generation", testing: "Testing…", verified: "Generation test passed", untested: "Not tested", failed: "Generation test failed", save: "Save settings", saved: "Settings saved.", continue: "Save and continue", unsaved: "Unsaved changes",
    connection: "Connection", codexConnection: "ChatGPT plan (Codex)", minimaxConnection: "MiniMax plan (M Plan / Token Plan)", compatibleConnection: "Other authorized plan / endpoint", vendor: "Provider", protocol: "API protocol", subscriptionKey: "Plan / API key", minimaxHint: "Use a MiniMax subscription key for M Plan or Token Plan quota. A pay-as-you-go key is billed separately.", compatibleHint: "Requires a provider-authorized plan endpoint or a separate API key. Web chat subscriptions do not automatically include API access; the provider’s billing rules apply.", importConfig: "Import settings", configExample: "Example settings", imported: "Settings loaded. Review the endpoint, model, and billing method before saving.", importError: "Invalid settings. Use the example format. Account cookies and OAuth sessions cannot be imported.", needSubscriptionKey: "Enter the selected service’s plan or API key.", importSkills: "Import Skills", skillsHint: "Upload or install skills online. Enabled skills are shared by all model channels.", other: "Other provider",
    enabled: "Enabled channels", routing: "Task routing", analysis: "Source analysis", draft: "File generation", ocr: "Image recognition", oneChannel: "Keep at least one channel enabled.", needModel: "Enter a model name.", needEndpoint: "Enter an endpoint URL and model name.", invalidEndpoint: "The endpoint must start with http:// or https://.", pending: "Finish setup to continue the current task.", testError: "Check the endpoint, model name, and sign-in, then try again.", configured: "Configured", cancel: "Discard changes", selectCatalog: "Choose from available models", hybridHint: "Each task uses its assigned channel. A failure does not switch it to another channel.",
  },
} as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="model-control-field"><span>{label}</span>{children}</label>;
}

function normalizeCatalog(value: unknown): CatalogItem[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const entries = Array.isArray(value) ? value : Array.isArray(object.models) ? object.models : Array.isArray(object.data) ? object.data : [];
  return entries.flatMap((item): CatalogItem[] => {
    if (typeof item === "string") return [{ id: item }];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = [record.id, record.model, record.slug].find((candidate) => typeof candidate === "string");
    return typeof id === "string" ? [{ id, name: typeof record.displayName === "string" ? record.displayName : typeof record.name === "string" ? record.name : undefined }] : [];
  });
}

export default function ModelControls({ locale, busy = false, toolbarTarget }: { locale: Locale; busy?: boolean; toolbarTarget: HTMLElement | null }) {
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");
  const [subscriptionApiKey, setSubscriptionApiKey] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [pendingTask, setPendingTask] = useState<Task | null>(null);
  const [testing, setTesting] = useState<Channel | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogDefault, setCatalogDefault] = useState("");
  const [localCatalog, setLocalCatalog] = useState<CatalogItem[]>([]);
  const [verified, setVerified] = useState<Partial<Record<Channel, string>>>({});
  const [failed, setFailed] = useState<Partial<Record<Channel, boolean>>>({});
  const section = useRef<HTMLElement>(null);
  const configInput = useRef<HTMLInputElement>(null);
  const t = copy[locale];
  const enabled = settings.provider === "hybrid" ? settings.enabledProviders : [settings.provider as Channel];
  const locked = busy || testing !== null || catalogLoading;
  const fingerprint = (provider: Channel, candidate = settings, key = apiKey, localKey = localApiKey) => JSON.stringify(provider === "codex" ? [candidate.subscriptionProvider, candidate.subscriptionVendor, candidate.subscriptionProtocol, candidate.subscriptionEndpoint, candidate.subscriptionModel, candidate.codexModel, subscriptionApiKey] : provider === "local" ? [candidate.localRuntime, candidate.localEndpoint, candidate.localModel, localKey] : [candidate.cloudEndpoint, candidate.cloudModel, key]);
  const modelName = (provider: Channel) => provider === "codex" ? settings.subscriptionProvider === "codex" ? settings.codexModel : settings.subscriptionModel : provider === "local" ? settings.localModel : settings.cloudModel;
  const isVerified = (provider: Channel) => verified[provider] === fingerprint(provider);

  useEffect(() => {
    setSettings(readModelSettings());
    setApiKey(readModelApiKey());
    setLocalApiKey(readLocalModelApiKey());
    setSubscriptionApiKey(readSubscriptionApiKey());
    const open = (event: Event) => {
      const task = (event as CustomEvent<{ task?: Task }>).detail?.task;
      setPendingTask(task || null);
      setExpanded(true);
      setNotice("");
      window.requestAnimationFrame(() => section.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    window.addEventListener("bid-model-settings-open", open);
    if (new URLSearchParams(window.location.search).get("model-settings") === "open") setExpanded(true);
    return () => window.removeEventListener("bid-model-settings-open", open);
  }, []);

  const update = (patch: Partial<ModelSettings>, provider?: Channel) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (provider === "local") next.localProfiles = { ...next.localProfiles, [next.localRuntime]: { endpoint: next.localEndpoint, model: next.localModel } };
      return next;
    });
    setDirty(true);
    setNotice("");
    setError(false);
    if (provider) {
      setVerified((current) => ({ ...current, [provider]: undefined }));
      setFailed((current) => ({ ...current, [provider]: false }));
    }
  };

  const changeLocalRuntime = (runtime: LocalModelRuntime) => {
    if (runtime === settings.localRuntime) return;
    const profiles = { ...settings.localProfiles, [settings.localRuntime]: { endpoint: settings.localEndpoint, model: settings.localModel } };
    const next = profiles[runtime] || { endpoint: LOCAL_MODEL_DEFAULT_ENDPOINTS[runtime], model: "" };
    setLocalCatalog([]);
    update({ localRuntime: runtime, localEndpoint: next.endpoint, localModel: next.model, localProfiles: profiles }, "local");
  };

  const changeSubscription = (connection: SubscriptionProvider, vendor: SubscriptionVendor = settings.subscriptionVendor) => {
    const nextVendor = connection === "codex" ? "openai" : connection === "minimax" ? "minimax" : vendor;
    setCatalog([]);
    setCatalogDefault("");
    setSubscriptionApiKey("");
    update({ subscriptionProvider: connection, subscriptionVendor: nextVendor, ...SUBSCRIPTION_PRESETS[nextVendor], subscriptionModel: "" }, "codex");
  };

  const importConfiguration = async (file: File) => {
    try {
      if (file.size > 65536) throw new Error("CONFIG_TOO_LARGE");
      const imported = parseSubscriptionConfiguration(await file.text());
      setCatalog([]); setCatalogDefault("");
      setSubscriptionApiKey(imported.apiKey);
      update(imported.patch, "codex");
      setNotice(t.imported);
    } catch { setNotice(t.importError); setError(true); }
  };

  const downloadConfiguration = () => {
    const url = URL.createObjectURL(new Blob([subscriptionConfigurationTemplate()], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "model-plan.example.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const chooseMode = (provider: ModelProvider) => {
    const next = { ...settings, provider };
    if (provider === "hybrid" && !next.enabledProviders.length) next.enabledProviders = ["local", "codex"];
    if (provider === "hybrid") {
      next.hybridRoutes = { ...next.hybridRoutes };
      for (const task of tasks) if (!next.enabledProviders.includes(next.hybridRoutes[task])) next.hybridRoutes[task] = next.enabledProviders[0];
    }
    setSettings(next);
    saveModelSettings(next, apiKey, localApiKey, subscriptionApiKey);
    setDirty(false);
    setNotice("");
    if (provider === "local" || provider === "hybrid" || !modelName(provider)) {
      setExpanded(true);
      window.requestAnimationFrame(() => section.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const toggleChannel = (provider: Channel, checked: boolean) => {
    const nextEnabled = channels.filter((channel) => channel === provider ? checked : settings.enabledProviders.includes(channel));
    if (!nextEnabled.length) { setNotice(t.oneChannel); setError(true); return; }
    const routes = { ...settings.hybridRoutes };
    for (const task of tasks) if (!nextEnabled.includes(routes[task])) routes[task] = nextEnabled[0];
    update({ enabledProviders: nextEnabled, hybridRoutes: routes });
  };

  const validate = (provider: Channel): string => {
    if (provider === "codex" && settings.subscriptionProvider !== "codex") {
      if (!settings.subscriptionModel.trim()) return t.needModel;
      if (!validateSubscriptionEndpoint(settings.subscriptionEndpoint)) return t.invalidEndpoint;
      if (!subscriptionApiKey.trim()) return t.needSubscriptionKey;
    }
    if (provider !== "codex" && !modelName(provider).trim()) return t.needEndpoint;
    if (provider !== "codex") {
      const endpoint = provider === "local" ? settings.localEndpoint : settings.cloudEndpoint;
      if (!endpoint.trim()) return t.needEndpoint;
      try { if (!["http:", "https:"].includes(new URL(endpoint).protocol)) return t.invalidEndpoint; }
      catch { return t.invalidEndpoint; }
    }
    return "";
  };

  const test = async (provider: Channel) => {
    const invalid = validate(provider);
    if (invalid) { setNotice(invalid); setError(true); return; }
    if (!window.bidDesktop?.modelTest) { setNotice(t.desktopOnly); setError(true); return; }
    setTesting(provider);
    setNotice("");
    setError(false);
    setVerified((current) => ({ ...current, [provider]: undefined }));
    try {
      const result = await window.bidDesktop.modelTest({ settings, apiKey, localApiKey, subscriptionApiKey, provider });
      if (result.verified !== true) throw new Error("MODEL_TEST_FAILED");
      setVerified((current) => ({ ...current, [provider]: fingerprint(provider) }));
      setFailed((current) => ({ ...current, [provider]: false }));
      setNotice(`${t[provider]} · ${t.verified}`);
    } catch {
      setFailed((current) => ({ ...current, [provider]: true }));
      setNotice(`${t[provider]} · ${t.failed}${locale === "zh" ? "。" : ". "}${provider === "local" ? t.localTestError : t.testError}`);
      setError(true);
    } finally { setTesting(null); }
  };

  const readLocalCatalog = async () => {
    if (!window.bidDesktop?.localModelCatalog) { setNotice(t.desktopOnly); setError(true); return; }
    if (!settings.localEndpoint.trim()) { setNotice(t.needEndpoint); setError(true); return; }
    try { if (!["http:", "https:"].includes(new URL(settings.localEndpoint).protocol)) throw new Error(); }
    catch { setNotice(t.invalidEndpoint); setError(true); return; }
    setCatalogLoading(true);
    setVerified((current) => ({ ...current, local: undefined }));
    setNotice("");
    setError(false);
    try {
      const result = await window.bidDesktop.localModelCatalog({ settings, localApiKey });
      const next = normalizeCatalog(result);
      setLocalCatalog(next);
      setNotice(next.length ? t.catalogRead : t.localCatalogEmpty);
    } catch { setLocalCatalog([]); setNotice(t.localCatalogFailed); setError(true); }
    finally { setCatalogLoading(false); }
  };

  const readCatalog = async () => {
    if (!window.bidDesktop?.modelCatalog) { setNotice(t.desktopOnly); setError(true); return; }
    setCatalogLoading(true);
    setVerified((current) => ({ ...current, codex: undefined }));
    setNotice("");
    setError(false);
    try {
      const result = await window.bidDesktop.modelCatalog({ settings, subscriptionApiKey });
      const next = normalizeCatalog(result);
      setCatalog(next);
      setCatalogDefault(result.defaultModel || "");
      setNotice(next.length ? t.catalogRead : t.catalogEmpty);
    } catch { setNotice(t.catalogFailed); setError(true); }
    finally { setCatalogLoading(false); }
  };

  const save = () => {
    for (const provider of enabled) {
      const invalid = validate(provider);
      if (invalid) { setNotice(`${t[provider]} · ${invalid}`); setError(true); return; }
    }
    saveModelSettings(settings, apiKey, localApiKey, subscriptionApiKey);
    setDirty(false);
    setNotice(t.saved);
    setError(false);
    if (pendingTask) {
      setPendingTask(null);
      setExpanded(false);
      window.dispatchEvent(new CustomEvent("bid-model-settings-saved"));
    }
  };

  const discard = () => {
    setSettings(readModelSettings());
    setApiKey(readModelApiKey());
    setLocalApiKey(readLocalModelApiKey());
    setSubscriptionApiKey(readSubscriptionApiKey());
    setCatalog([]);
    setCatalogDefault("");
    setLocalCatalog([]);
    setDirty(false);
    setNotice("");
    setError(false);
  };

  return <>
    {toolbarTarget && createPortal(<>
      <div className="model-provider-strip" aria-label={t.channels}>
      <span className="model-strip-label"><Cpu size={17}/>{t.channels}</span>
      <div className="model-mode-options" role="radiogroup" aria-label={t.channels}>
        {modes.map((provider) => { const Icon = icons[provider]; return <button type="button" data-testid={`model-mode-${provider}`} role="radio" aria-checked={settings.provider === provider} className={settings.provider === provider ? "active" : ""} disabled={locked} key={provider} onClick={() => chooseMode(provider)}><Icon size={16}/><span>{t[provider]}</span></button>; })}
      </div>
      <div className="model-current-summary" title={enabled.map((provider) => `${t[provider]}: ${modelName(provider) || t.unnamed}`).join(" · ")}>
        <i className={enabled.every(isVerified) ? "verified" : ""}/><span>{settings.provider === "hybrid" ? enabled.map((provider) => t[provider]).join(" + ") : modelName(settings.provider) || (settings.provider === "codex" ? t.defaultModel : t.unnamed)}</span>
        {dirty && <small>{t.unsaved}</small>}
      </div>
      <button type="button" className={`model-expand-toggle${expanded ? " expanded" : ""}`} aria-label={expanded ? t.close : t.open} title={expanded ? t.close : t.open} aria-expanded={expanded} aria-controls="workbench-model-settings" disabled={locked} onClick={() => { setExpanded(!expanded); if (!expanded) window.requestAnimationFrame(() => section.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }}><ChevronDown size={19}/></button>
      <button type="button" className="model-skills-button" data-testid="import-skills" disabled={locked} title={t.skillsHint} onClick={() => setSkillsOpen(true)}><BookOpen size={16}/><span>{t.importSkills}</span></button>
      </div>
    </>, toolbarTarget)}
    <section className="model-controls" id="workbench-model-controls" data-testid="model-controls" ref={section} aria-label={t.channels} hidden={!expanded}>
    {expanded && <div className="model-settings-inline" id="workbench-model-settings">
      <header><h2>{t.title}</h2>{pendingTask && <span>{t.pending}</span>}</header>
      {settings.provider === "hybrid" && <div className="model-enabled-channels" role="group" aria-label={t.enabled}><span>{t.enabled}</span>{channels.map((provider) => <label key={provider}><input type="checkbox" checked={enabled.includes(provider)} disabled={locked} onChange={(event) => toggleChannel(provider, event.target.checked)}/>{t[provider]}</label>)}</div>}
      <div className="model-channel-grid" data-count={enabled.length}>
        {enabled.map((provider) => { const Icon = icons[provider]; return <section className="model-channel-card" data-testid={`model-channel-${provider}`} key={provider}>
          <header><h3><Icon size={18}/>{t[provider]}</h3><span className={`model-test-status${isVerified(provider) ? " verified" : failed[provider] ? " failed" : ""}`}>{isVerified(provider) && <Check size={13}/>} {isVerified(provider) ? t.verified : failed[provider] ? t.failed : t.untested}</span></header>
          <p>{provider === "codex" ? settings.subscriptionProvider === "codex" ? t.codexHint : settings.subscriptionProvider === "minimax" ? t.minimaxHint : t.compatibleHint : provider === "local" ? t.localHint : t.cloudHint}</p>
          {provider === "codex" && <>
            <Field label={t.connection}><select data-testid="subscription-connection" disabled={locked} value={settings.subscriptionProvider} onChange={(event) => changeSubscription(event.target.value as SubscriptionProvider)}><option value="codex">{t.codexConnection}</option><option value="minimax">{t.minimaxConnection}</option><option value="compatible">{t.compatibleConnection}</option></select></Field>
            {settings.subscriptionProvider === "compatible" && <Field label={t.vendor}><select data-testid="subscription-vendor" disabled={locked} value={settings.subscriptionVendor} onChange={(event) => changeSubscription("compatible", event.target.value as SubscriptionVendor)}>{SUBSCRIPTION_VENDORS.map(vendor => <option value={vendor} key={vendor}>{vendor === "other" ? t.other : SUBSCRIPTION_NAMES[vendor]}</option>)}</select></Field>}
            {settings.subscriptionProvider !== "codex" && <>
              <Field label={t.protocol}><select data-testid="subscription-protocol" disabled={locked} value={settings.subscriptionProtocol} onChange={(event) => update({ subscriptionProtocol: event.target.value as SubscriptionProtocol }, "codex")}><option value="openai">OpenAI Chat Completions</option><option value="anthropic">Anthropic Messages</option><option value="gemini">Gemini GenerateContent</option></select></Field>
              <Field label={t.endpoint}><input type="url" data-testid="subscription-endpoint" disabled={locked} value={settings.subscriptionEndpoint} onChange={(event) => { setSubscriptionApiKey(""); update({ subscriptionEndpoint: event.target.value }, "codex"); }}/></Field>
              <Field label={t.subscriptionKey}><input type="password" autoComplete="off" data-testid="subscription-key" disabled={locked} value={subscriptionApiKey} onChange={(event) => { setSubscriptionApiKey(event.target.value); update({}, "codex"); }}/><small>{t.keyHint}</small></Field>
            </>}
            <div className="subscription-config-actions">
              <input ref={configInput} type="file" accept=".json,application/json" hidden disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importConfiguration(file); }}/>
              <button type="button" className="model-secondary-button" disabled={locked} onClick={() => configInput.current?.click()}><Upload size={15}/>{t.importConfig}</button>
              <button type="button" className="model-secondary-button" disabled={locked} onClick={downloadConfiguration}><Download size={15}/>{t.configExample}</button>
            </div>
          </>}
          {provider === "local" && <Field label={t.localRuntime}><select data-testid="local-runtime" disabled={locked} value={settings.localRuntime} onChange={(event) => changeLocalRuntime(event.target.value as LocalModelRuntime)}>{localRuntimes.map((runtime) => <option key={runtime} value={runtime}>{runtime === "ollama" ? "Ollama" : runtime === "lmstudio" ? "LM Studio" : t.compatibleService}</option>)}</select></Field>}
          {provider !== "codex" && <Field label={provider === "local" ? t.localEndpoint : t.endpoint}><input data-testid={provider === "local" ? "local-endpoint" : undefined} type="url" disabled={locked} placeholder={provider === "local" ? LOCAL_MODEL_DEFAULT_ENDPOINTS[settings.localRuntime] : "https://…/v1/chat/completions"} value={provider === "local" ? settings.localEndpoint : settings.cloudEndpoint} onChange={(event) => { if (provider === "local") setLocalCatalog([]); update(provider === "local" ? { localEndpoint: event.target.value } : { cloudEndpoint: event.target.value }, provider); }}/></Field>}
          {provider === "local" && <div className="model-catalog-actions"><button type="button" data-testid="local-catalog-read" className="model-secondary-button" disabled={locked} onClick={() => void readLocalCatalog()}>{catalogLoading ? <LoaderCircle size={15} className="model-spinner"/> : <RefreshCw size={15}/>} {t.localCatalog}</button></div>}
          {provider === "local" && localCatalog.length > 0 && <Field label={t.selectCatalog}><select data-testid="local-catalog-select" aria-label={t.selectCatalog} disabled={locked} value={settings.localModel} onChange={(event) => update({ localModel: event.target.value }, "local")}><option value="" disabled>{t.selectCatalog}</option>{settings.localModel && !localCatalog.some((item) => item.id === settings.localModel) && <option value={settings.localModel}>{settings.localModel}</option>}{localCatalog.map((item) => <option value={item.id} key={item.id}>{item.name && item.name !== item.id ? `${item.name} (${item.id})` : item.id}</option>)}</select></Field>}
          {provider === "codex" && <div className="model-catalog-actions"><button type="button" className="model-secondary-button" disabled={locked} onClick={() => void readCatalog()}>{catalogLoading ? <LoaderCircle size={15} className="model-spinner"/> : <RefreshCw size={15}/>} {t.catalog}</button></div>}
          {provider === "codex" && catalog.length > 0 && <Field label={t.selectCatalog}><select aria-label={t.selectCatalog} disabled={locked} value={settings.codexModel} onChange={(event) => update({ codexModel: event.target.value }, "codex")}><option value="">{t.defaultModel}{catalogDefault ? ` (${catalogDefault})` : ""}</option>{settings.codexModel && !catalog.some((item) => item.id === settings.codexModel) && <option value={settings.codexModel}>{settings.codexModel}</option>}{catalog.map((item) => <option value={item.id} key={item.id}>{item.name && item.name !== item.id ? `${item.name} (${item.id})` : item.id}</option>)}</select></Field>}
          <Field label={t.model}><input data-testid={provider === "local" ? "local-model" : provider === "codex" ? "subscription-model" : undefined} disabled={locked} value={modelName(provider)} placeholder={provider === "codex" && settings.subscriptionProvider === "codex" ? t.defaultModel : provider === "local" ? t.localModelPlaceholder : undefined} onChange={(event) => update(provider === "local" ? { localModel: event.target.value } : provider === "cloud" ? { cloudModel: event.target.value } : settings.subscriptionProvider === "codex" ? { codexModel: event.target.value } : { subscriptionModel: event.target.value }, provider)}/></Field>
          {provider === "local" && <Field label={t.localToken}><input data-testid="local-api-key" type="password" autoComplete="off" aria-label={t.localToken} aria-describedby="model-local-api-key-hint" disabled={locked} value={localApiKey} onChange={(event) => { setLocalApiKey(event.target.value); setDirty(true); setVerified((current) => ({ ...current, local: undefined })); setFailed((current) => ({ ...current, local: false })); setLocalCatalog([]); setNotice(""); }}/><small id="model-local-api-key-hint">{t.localKeyHint}</small></Field>}
          {provider === "cloud" && <Field label={t.apiKey}><input type="password" autoComplete="off" aria-label={t.apiKey} aria-describedby="model-api-key-hint" disabled={locked} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setDirty(true); setVerified((current) => ({ ...current, cloud: undefined })); setFailed((current) => ({ ...current, cloud: false })); setNotice(""); }}/><small id="model-api-key-hint">{t.keyHint}</small></Field>}
          <button type="button" className="model-secondary-button model-test-button" disabled={locked} onClick={() => void test(provider)}>{testing === provider ? <LoaderCircle size={16} className="model-spinner"/> : <TerminalSquare size={16}/>} {testing === provider ? t.testing : t.test}</button>
        </section>; })}
      </div>
      {settings.provider === "hybrid" && <div className="model-routing"><h3>{t.routing}</h3><div>{tasks.map((task) => <Field label={t[task]} key={task}><select aria-label={t[task]} value={settings.hybridRoutes[task]} disabled={locked} onChange={(event) => update({ hybridRoutes: { ...settings.hybridRoutes, [task]: event.target.value as Channel } })}>{enabled.map((provider) => <option key={provider} value={provider}>{t[provider]}</option>)}</select></Field>)}</div><p>{t.hybridHint}</p></div>}
      <footer><span role={error ? "alert" : "status"} className={error ? "model-settings-notice error" : "model-settings-notice"}>{notice}</span><div>{dirty && <button type="button" className="model-secondary-button" disabled={locked} onClick={discard}>{t.cancel}</button>}<button type="button" className="model-save-button" disabled={locked} onClick={save}><Save size={16}/>{pendingTask ? t.continue : t.save}</button></div></footer>
    </div>}
    </section>
    {skillsOpen && <SkillManager locale={locale} busy={busy} api={typeof window === "undefined" ? null : window.bidDesktop?.skills} onClose={() => setSkillsOpen(false)}/>}
  </>;
}
