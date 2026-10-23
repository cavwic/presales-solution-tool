import { BookOpen, Check, FileText, GitBranch, Info, Link, LoaderCircle, PackageOpen, RefreshCw, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImportedSkillDetail, ImportedSkillsApi, ImportedSkillSummary } from "../lib/imported-skills";
import type { Locale } from "../lib/workspace-schema";
import "../styles/skill-manager.css";

export type SkillManagerProps = {
  locale: Locale;
  api?: ImportedSkillsApi | null;
  busy?: boolean;
  onChanged?: () => void;
  onClose: () => void;
};

const copy = {
  zh: {
    title: "Skills", close: "关闭 Skills 管理", scope: "所有模型模式共用", help: "启用后，模型会使用 Skill 指引及可用参考文本；不会自动运行附带脚本。", uploadTab: "上传文件", githubTab: "联网安装", importMethod: "导入方式", choose: "选择文件", fileHint: "SKILL.md 或 ZIP", fileLimit: "SKILL.md 最大 128 KB，ZIP 最大 16 MB。", import: "导入", installing: "正在安装…", importing: "正在导入…", githubUrl: "公开 GitHub 地址", githubPlaceholder: "https://github.com/owner/repo/tree/main/skills/name", githubHint: "填写公开 GitHub 中的 Skill 目录、SKILL.md 或 ZIP 地址。", install: "安装", installed: "已导入", loading: "正在读取…", refresh: "刷新列表", noSkills: "还没有导入 Skill", noSkillsHint: "上传文件或填写 GitHub 地址即可添加。", enable: "启用", enabled: "已启用", disabled: "未启用", view: "查看", preview: "内容与来源", previewEmpty: "选择一个 Skill 查看内容与来源。", closePreview: "关闭内容预览", content: "查看内容", source: "来源", uploaded: "本地文件", references: "参考文本", ignored: "未使用的附件", scriptsHint: "脚本和不支持的附件不会执行或加载。", importedAt: "导入时间", imported: "已导入，可查看内容后启用。", installedHint: "已安装，可查看内容后启用。", listError: "无法读取 Skills，请刷新重试。", importError: "导入失败，请检查 Skill 文件后重试。", installError: "安装失败，请检查地址和网络后重试。", updateError: "无法更新启用状态，请重试。", previewError: "无法读取内容，请重新选择。", needFile: "请选择 SKILL.md 或 ZIP 文件。", invalidFile: "请选择名为 SKILL.md 的文件，或 ZIP 压缩包。", fileTooLarge: "文件过大。SKILL.md 最大 128 KB，ZIP 最大 16 MB。", needUrl: "请填写公开 GitHub 地址。", invalidUrl: "请使用公开 GitHub 的 HTTPS 地址。", desktopOnly: "请在桌面版中导入和管理 Skills。", fileCount: "个文件", referenceCount: "份参考文本", ignoredCount: "个附件未使用", activeCount: "已启用", selected: "已选择", noDescription: "未提供说明", skillFile: "Skill 指引", githubSource: "GitHub",
  },
  en: {
    title: "Skills", close: "Close Skills manager", scope: "Shared by all model modes", help: "Enabled Skills provide instructions and supported reference text to the model. Bundled scripts are never run automatically.", uploadTab: "Upload file", githubTab: "Install from GitHub", importMethod: "Import method", choose: "Choose file", fileHint: "SKILL.md or ZIP", fileLimit: "SKILL.md: up to 128 KB. ZIP: up to 16 MB.", import: "Import", installing: "Installing…", importing: "Importing…", githubUrl: "Public GitHub URL", githubPlaceholder: "https://github.com/owner/repo/tree/main/skills/name", githubHint: "Use a public GitHub Skill folder, SKILL.md file, or ZIP URL.", install: "Install", installed: "Imported", loading: "Loading…", refresh: "Refresh list", noSkills: "No Skills imported yet", noSkillsHint: "Upload a file or enter a GitHub URL to add one.", enable: "Enable", enabled: "Enabled", disabled: "Disabled", view: "View", preview: "Content and source", previewEmpty: "Select a Skill to view its content and source.", closePreview: "Close content preview", content: "View content", source: "Source", uploaded: "Local file", references: "Reference text", ignored: "Unused attachments", scriptsHint: "Scripts and unsupported attachments are not executed or loaded.", importedAt: "Imported", imported: "Imported. Review the content, then enable it when ready.", installedHint: "Installed. Review the content, then enable it when ready.", listError: "Could not load Skills. Refresh the list and try again.", importError: "Could not import this Skill. Check the file and try again.", installError: "Installation failed. Check the URL and your connection, then retry.", updateError: "Could not change the enabled state. Try again.", previewError: "Could not load this content. Select the Skill again.", needFile: "Choose a SKILL.md or ZIP file.", invalidFile: "Choose a file named SKILL.md or a ZIP archive.", fileTooLarge: "This file is too large. SKILL.md supports up to 128 KB; ZIP supports up to 16 MB.", needUrl: "Enter a public GitHub URL.", invalidUrl: "Use a public GitHub HTTPS URL.", desktopOnly: "Use the desktop app to import and manage Skills.", fileCount: "files", referenceCount: "reference texts", ignoredCount: "unused attachments", activeCount: "Enabled", selected: "Selected", noDescription: "No description provided", skillFile: "Skill instructions", githubSource: "GitHub",
  },
} as const;

type ImportTab = "file" | "github";
function messageFrom(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  return error.message.replace(/^(?:Error: )?Error invoking remote method '[^']+': (?:Error: )?/, "").trim() || fallback;
}
function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SkillManager({ locale, api = null, busy = false, onChanged, onClose }: SkillManagerProps) {
  const t = copy[locale];
  const helpText = locale === "zh"
    ? `${t.help} 每个指引最多 16,000 字符，每份参考 4,000 字符，合计 32,000 字符；超出时仅使用节选。`
    : `${t.help} Context limits: 16,000 characters per Skill, 4,000 per reference, and 32,000 in total. Longer content is excerpted.`;
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const uploadTab = useRef<HTMLButtonElement>(null);
  const githubTab = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement | null>(null);
  const activeRequest = useRef(0);
  const mounted = useRef(false);
  const [tab, setTab] = useState<ImportTab>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [skills, setSkills] = useState<ImportedSkillSummary[]>([]);
  const [loading, setLoading] = useState(Boolean(api));
  const [operation, setOperation] = useState<"import" | "install" | "toggle" | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ImportedSkillDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewPath, setPreviewPath] = useState("SKILL.md");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const locked = busy || loading || operation !== null;
  const selectedSkill = skills.find((skill) => skill.id === selectedId);
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const previewText = detail ? previewPath === "SKILL.md" ? detail.skillText : detail.references.find((reference) => reference.path === previewPath)?.text || "" : "";
  const countText = (count: number, kind: "file" | "reference" | "ignored") => {
    if (locale === "zh") return `${count} ${kind === "file" ? t.fileCount : kind === "reference" ? t.referenceCount : t.ignoredCount}`;
    return kind === "file" ? `${count} ${count === 1 ? "file" : "files"}`
      : kind === "reference" ? `${count} ${count === 1 ? "reference" : "references"}`
      : `${count} unused ${count === 1 ? "attachment" : "attachments"}`;
  };

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { mounted.current = false; ++activeRequest.current; element?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!api) { setLoading(false); return; }
    setLoading(true);
    void api.list().then((list) => { if (!cancelled) setSkills(list); }).catch((cause) => { if (!cancelled) setError(messageFrom(cause, t.listError)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api]);

  const refreshList = async () => {
    if (!api || locked) return;
    setLoading(true); setError(""); setNotice("");
    try { const list = await api.list(); if (mounted.current) setSkills(list); }
    catch (cause) { if (mounted.current) setError(messageFrom(cause, t.listError)); }
    finally { if (mounted.current) setLoading(false); }
  };

  const showPreview = async (id: string) => {
    if (!api) return;
    const sequence = ++activeRequest.current;
    setSelectedId(id); setPreviewLoading(true); setPreviewError(""); setPreviewPath("SKILL.md"); setDetail(null);
    try { const next = await api.read({ id }); if (mounted.current && sequence === activeRequest.current) setDetail(next); }
    catch (cause) { if (mounted.current && sequence === activeRequest.current) setPreviewError(messageFrom(cause, t.previewError)); }
    finally { if (mounted.current && sequence === activeRequest.current) setPreviewLoading(false); }
  };

  const closePreview = () => { ++activeRequest.current; setSelectedId(""); setDetail(null); setPreviewError(""); setPreviewLoading(false); window.requestAnimationFrame(() => previewButton.current?.focus()); };
  const selectFile = (next: File | undefined) => {
    setError(""); setNotice("");
    if (!next) return;
    const zip = /\.zip$/i.test(next.name);
    if (!zip && !/^SKILL\.md$/i.test(next.name)) { setFile(null); setError(t.invalidFile); return; }
    if (next.size > (zip ? 16 * 1024 * 1024 : 128 * 1024)) { setFile(null); setError(t.fileTooLarge); return; }
    setFile(next);
  };

  const install = async (kind: "import" | "install") => {
    if (!api || locked) return;
    if (kind === "import" && !file) { setError(t.needFile); return; }
    if (kind === "install") {
      if (!url.trim()) { setError(t.needUrl); return; }
      try { const address = new URL(url.trim()); if (address.protocol !== "https:" || !["github.com", "raw.githubusercontent.com", "codeload.github.com"].includes(address.hostname.toLowerCase()) || address.username || address.password || address.port) throw new Error(); }
      catch { setError(t.invalidUrl); return; }
    }
    setOperation(kind); setError(""); setNotice("");
    try {
      const added = kind === "import" ? await api.importFile({ name: file!.name, data: new Uint8Array(await file!.arrayBuffer()) }) : await api.installUrl({ url: url.trim() });
      const list = await api.list();
      if (!mounted.current) return;
      setSkills(list); setNotice(kind === "import" ? t.imported : t.installedHint);
      if (kind === "import") { setFile(null); if (input.current) input.current.value = ""; } else setUrl("");
      onChanged?.();
      await showPreview(added.id);
    } catch (cause) { if (mounted.current) setError(messageFrom(cause, kind === "import" ? t.importError : t.installError)); }
    finally { if (mounted.current) setOperation(null); }
  };

  const toggle = async (skill: ImportedSkillSummary) => {
    if (!api || locked) return;
    setOperation("toggle"); setError(""); setNotice("");
    try {
      const updated = await api.setEnabled({ id: skill.id, enabled: !skill.enabled });
      if (!mounted.current) return;
      setSkills((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetail((current) => current?.id === updated.id ? { ...current, ...updated } : current);
      onChanged?.();
    } catch (cause) { if (mounted.current) setError(messageFrom(cause, t.updateError)); }
    finally { if (mounted.current) setOperation(null); }
  };

  const moveTab = (key: string) => {
    if (locked || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return false;
    const next = key === "Home" ? "file" : key === "End" ? "github" : tab === "file" ? "github" : "file";
    setTab(next); (next === "file" ? uploadTab : githubTab).current?.focus(); return true;
  };

  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="skill-manager-dialog" aria-modal="true" aria-labelledby={`${ids}-title`} data-testid="skill-manager-dialog" onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}>
    <header className="skill-manager-header"><div><h2 id={`${ids}-title`}><PackageOpen size={21}/>{t.title}</h2><span>{t.scope}</span></div><div><button type="button" className="skill-manager-info" title={helpText} aria-label={helpText}><Info size={18}/></button><button type="button" className="skill-manager-close" title={t.close} aria-label={t.close} disabled={locked} onClick={onClose}><X size={21}/></button></div></header>
    <div className="skill-manager-body" aria-busy={locked}>
      {!api && <p className="skill-manager-unavailable" role="status">{t.desktopOnly}</p>}
      <section className="skill-manager-import">
        <div className="skill-manager-import-tabs" role="tablist" aria-label={t.importMethod} onKeyDown={(event) => { if (moveTab(event.key)) event.preventDefault(); }}><button ref={uploadTab} type="button" role="tab" aria-selected={tab === "file"} aria-controls={`${ids}-import-panel`} tabIndex={tab === "file" ? 0 : -1} disabled={locked || !api} onClick={() => setTab("file")}><Upload size={16}/>{t.uploadTab}</button><button ref={githubTab} type="button" role="tab" aria-selected={tab === "github"} aria-controls={`${ids}-import-panel`} tabIndex={tab === "github" ? 0 : -1} disabled={locked || !api} onClick={() => setTab("github")}><GitBranch size={16}/>{t.githubTab}</button></div>
        <div id={`${ids}-import-panel`} role="tabpanel" aria-label={tab === "file" ? t.uploadTab : t.githubTab}>
          {tab === "file" ? <form className="skill-manager-file-form" onSubmit={(event) => { event.preventDefault(); void install("import"); }}><input ref={input} className="skill-manager-file-input" type="file" accept=".md,.zip,text/markdown,application/zip" data-testid="skill-upload-input" aria-label={t.choose} disabled={locked || !api} onChange={(event) => selectFile(event.target.files?.[0])}/><button className="skill-manager-button" type="button" disabled={locked || !api} onClick={() => input.current?.click()}><Upload size={16}/>{t.choose}</button><span className={`skill-manager-file-name${file ? " selected" : ""}`} title={file?.name || t.fileLimit}>{file ? <><FileText size={15}/>{file.name}</> : t.fileHint}</span><button className="skill-manager-button skill-manager-primary" type="submit" data-testid="skill-import-file" disabled={locked || !api || !file}>{operation === "import" ? <LoaderCircle className="skill-manager-spinner" size={16}/> : <PackageOpen size={16}/>} {operation === "import" ? t.importing : t.import}</button></form> : <form className="skill-manager-url-form" onSubmit={(event) => { event.preventDefault(); void install("install"); }}><label><span>{t.githubUrl}</span><input type="url" value={url} placeholder={t.githubPlaceholder} title={t.githubHint} maxLength={2048} data-testid="skill-github-url" disabled={locked || !api} onChange={(event) => { setUrl(event.target.value); setError(""); }}/></label><button className="skill-manager-button skill-manager-primary" type="submit" data-testid="skill-install-url" disabled={locked || !api || !url.trim()}>{operation === "install" ? <LoaderCircle className="skill-manager-spinner" size={16}/> : <Link size={16}/>} {operation === "install" ? t.installing : t.install}</button></form>}
        </div>
      </section>
      <div className="skill-manager-workspace">
        <section className="skill-manager-list-section" aria-labelledby={`${ids}-installed`}><header><h3 id={`${ids}-installed`}>{t.installed}<small>{skills.length}</small></h3><button type="button" className="skill-manager-icon-button" title={t.refresh} aria-label={t.refresh} disabled={locked || !api} onClick={() => void refreshList()}><RefreshCw size={16} className={loading ? "skill-manager-spinner" : ""}/></button></header>
          {loading && !skills.length ? <p className="skill-manager-empty"><LoaderCircle size={22} className="skill-manager-spinner"/>{t.loading}</p> : !skills.length ? <div className="skill-manager-empty"><BookOpen size={26}/><strong>{t.noSkills}</strong><span>{t.noSkillsHint}</span></div> : <ul className="skill-manager-list">{skills.map((skill) => <li className={selectedId === skill.id ? "selected" : ""} key={skill.id} data-skill-id={skill.id}><button type="button" className="skill-manager-view" title={`${t.view} ${skill.name}`} aria-label={`${t.view} ${skill.name}`} disabled={locked} onClick={(event) => { previewButton.current = event.currentTarget; void showPreview(skill.id); }}><span><BookOpen size={17}/><strong>{skill.name}</strong></span><p>{skill.description || t.noDescription}</p><small>{skill.source.kind === "github" ? <GitBranch size={12}/> : <Upload size={12}/>}<span>{skill.source.label}</span></small></button><div className="skill-manager-list-state"><span title={t.scriptsHint}>{countText(skill.fileCount, "file")}</span><button type="button" className="skill-manager-switch" role="switch" aria-checked={skill.enabled} aria-label={`${t.enable} ${skill.name}`} disabled={locked} onClick={() => void toggle(skill)}><i aria-hidden="true"><span/></i><span>{skill.enabled ? t.enabled : t.disabled}</span></button></div></li>)}</ul>}
        </section>
        <section className="skill-manager-preview" aria-labelledby={`${ids}-preview`} aria-busy={previewLoading}><header><h3 id={`${ids}-preview`}>{t.preview}</h3>{selectedId && <button type="button" className="skill-manager-icon-button" title={t.closePreview} aria-label={t.closePreview} disabled={locked} onClick={closePreview}><X size={17}/></button>}</header>
          {!selectedId ? <div className="skill-manager-empty"><FileText size={28}/><span>{t.previewEmpty}</span></div> : previewLoading ? <p className="skill-manager-empty"><LoaderCircle size={24} className="skill-manager-spinner"/>{t.loading}</p> : previewError ? <p className="skill-manager-preview-error" role="alert">{previewError}</p> : detail && <>
            <div className="skill-manager-detail-heading"><h4>{detail.name}</h4><span className={selectedSkill?.enabled ? "enabled" : ""}>{selectedSkill?.enabled && <Check size={13}/>} {selectedSkill?.enabled ? t.enabled : t.disabled}</span></div>
            <dl className="skill-manager-source"><div><dt>{t.source}</dt><dd><strong>{detail.source.kind === "github" ? t.githubSource : t.uploaded}</strong><span>{detail.source.url || detail.source.label}</span></dd></div><div><dt>{t.importedAt}</dt><dd>{formatDate(detail.importedAt, locale)}</dd></div></dl>
            <label className="skill-manager-content-select"><span>{t.content}</span><select value={previewPath} aria-label={t.content} onChange={(event) => setPreviewPath(event.target.value)}><option value="SKILL.md">SKILL.md</option>{detail.references.map((reference) => <option key={reference.path} value={reference.path}>{reference.path}</option>)}</select></label>
            <pre className="skill-manager-content" tabIndex={0} aria-label={previewPath} data-testid="skill-content-preview">{previewText}</pre>
            <div className="skill-manager-attachment-summary" title={t.scriptsHint}><span>{countText(detail.referenceCount, "reference")}</span>{detail.ignoredFileCount > 0 && <span>{countText(detail.ignoredFileCount, "ignored")}</span>}</div>
          </>}
        </section>
      </div>
    </div>
    <footer className="skill-manager-footer"><div>{error ? <p role="alert" className="skill-manager-error">{error}</p> : notice ? <p role="status">{notice}</p> : <p role="status">{t.activeCount} {enabledCount} / {skills.length}</p>}</div><button type="button" className="skill-manager-button" disabled={locked} onClick={onClose}>{locale === "zh" ? "完成" : "Done"}</button></footer>
  </dialog>, document.body);
}
