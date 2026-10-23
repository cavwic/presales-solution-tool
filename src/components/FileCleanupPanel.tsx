import { FileText, FolderOpen, HardDrive, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "../lib/workspace-schema";
import "../styles/file-cleanup.css";

export type CleanupCategoryId = "runtime-cache" | "previews";
export type CleanupCategory = { id: CleanupCategoryId; count: number; bytes: number };
export type CleanupGeneratedFile = { id: string; name: string; relativePath: string; bytes: number; scope: "project" | "local"; stage?: string; error?: string; exists?: boolean };
export type CleanupSelection = { categories: CleanupCategoryId[]; generatedIds: string[] };
export type FileCleanupPanelProps = {
  locale: Locale;
  busy?: boolean;
  loading?: boolean;
  categories: CleanupCategory[];
  generatedFiles: CleanupGeneratedFile[];
  message?: string;
  error?: string;
  onRefresh: () => void | Promise<void>;
  onClean: (selection: CleanupSelection) => Promise<unknown>;
  onClose: () => void;
};

const copy = {
  zh: {
    title: "文件清理", close: "关闭文件清理", refresh: "重新扫描", scanning: "正在扫描…", cache: "缓存文件", generated: "已生成文件", empty: "暂无可清理的生成文件", none: "暂无文件", all: "全选生成文件", file: "文件", location: "位置", size: "大小", project: "项目文件", local: "本机记录", projectHint: "选中的现存项目文件将移入回收站。", localHint: "仅清理本机记录，下载副本保留。", clean: "清理所选", cleaning: "正在清理…", cancel: "返回选择", confirm: "确认清理", confirmTitle: "清理以下所选内容？", failed: "清理未完成，请重新扫描后重试。", refreshFailed: "扫描失败，请稍后重试。", choose: "请选择要清理的内容。", selected: "已选", items: "项", cacheCount: "类缓存", generatedCount: "个生成文件", cacheHint: "下次使用时会按需重新生成。", runtime: "运行缓存", previews: "临时预览", previewHint: "打开文件时生成的临时副本。", runtimeHint: "页面资源缓存，不含项目资料和模型配置。", files: "个文件", unavailable: "暂不可清理", missing: "文件已不存在，仅清理记录。", undoHint: "清理生成文件后将重置当前撤销记录。", presales: "售前", tender: "招标", bid: "投标",
  },
  en: {
    title: "File cleanup", close: "Close file cleanup", refresh: "Scan again", scanning: "Scanning…", cache: "Cache files", generated: "Generated files", empty: "No generated files to clean up", none: "No files", all: "Select all generated files", file: "File", location: "Location", size: "Size", project: "Project file", local: "Local record", projectHint: "Selected project files that still exist will be moved to the Recycle Bin.", localHint: "Only local records are removed. Downloaded copies are kept.", clean: "Clean up selected", cleaning: "Cleaning up…", cancel: "Back to selection", confirm: "Confirm cleanup", confirmTitle: "Clean up these selected items?", failed: "Cleanup did not finish. Scan again and retry.", refreshFailed: "Could not scan files. Try again shortly.", choose: "Select the items you want to clean up.", selected: "Selected", items: "items", cacheCount: "cache categories", generatedCount: "generated files", cacheHint: "These files are recreated when needed.", runtime: "Runtime cache", previews: "Temporary previews", previewHint: "Temporary copies created when opening files.", runtimeHint: "Page resource cache only. Project sources and model settings are kept.", files: "files", unavailable: "Unavailable for cleanup", missing: "The file is already missing. Only its record will be removed.", undoHint: "Cleaning generated files also clears this project's undo history.", presales: "Presales", tender: "Tender", bid: "Bid",
  },
} as const;

function formatBytes(bytes: number, locale: Locale) {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safe < 1024) return `${safe} B`;
  const unit = safe < 1024 ** 2 ? "KB" : safe < 1024 ** 3 ? "MB" : "GB";
  const divisor = unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : 1024 ** 3;
  return `${new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", { maximumFractionDigits: 1 }).format(safe / divisor)} ${unit}`;
}

export default function FileCleanupPanel({ locale, busy = false, loading = false, categories, generatedFiles, message = "", error = "", onRefresh, onClean, onClose }: FileCleanupPanelProps) {
  const t = copy[locale];
  const titleId = useId();
  const confirmId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const selectButton = useRef<HTMLButtonElement>(null);
  const [selectedCategories, setSelectedCategories] = useState<CleanupCategoryId[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const locked = busy || loading || pending;
  const selectedCache = categories.filter((category) => selectedCategories.includes(category.id) && category.count > 0);
  const availableFiles = generatedFiles.filter((file) => !file.error);
  const selectedGenerated = availableFiles.filter((file) => selectedFiles.includes(file.id));
  const cacheCount = selectedCache.length;
  const selectedCount = cacheCount + selectedGenerated.length;
  const selectedBytes = selectedCache.reduce((total, category) => total + category.bytes, 0) + selectedGenerated.reduce((total, file) => total + file.bytes, 0);
  const allGeneratedSelected = availableFiles.length > 0 && availableFiles.every((file) => selectedFiles.includes(file.id));
  const selectedHasProject = selectedGenerated.some((file) => file.scope === "project");
  const selectedHasLocal = selectedGenerated.some((file) => file.scope === "local");
  const stageLabel = (stage: string) => stage === "presales" || stage === "tender" || stage === "bid" ? t[stage] : stage;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    setSelectedCategories((current) => current.filter((id) => categories.some((category) => category.id === id && category.count > 0)));
    setSelectedFiles((current) => current.filter((id) => generatedFiles.some((file) => file.id === id && !file.error)));
  }, [categories, generatedFiles]);

  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  const backToSelection = () => {
    setConfirming(false);
    window.requestAnimationFrame(() => selectButton.current?.focus());
  };
  const close = () => { if (!locked) { if (confirming) backToSelection(); else onClose(); } };
  const refresh = async () => {
    if (locked) return;
    setPending(true);
    setLocalError("");
    try { await onRefresh(); }
    catch { setLocalError(t.refreshFailed); }
    finally { setPending(false); }
  };
  const clean = async () => {
    if (locked || !selectedCount) return;
    setPending(true);
    setLocalError("");
    try {
      await onClean({ categories: selectedCache.map((category) => category.id), generatedIds: selectedGenerated.map((file) => file.id) });
      setConfirming(false);
      setSelectedCategories([]);
      setSelectedFiles([]);
      window.requestAnimationFrame(() => selectButton.current?.focus());
    } catch { setLocalError(t.failed); }
    finally { setPending(false); }
  };

  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="file-cleanup-dialog" aria-modal="true" aria-labelledby={titleId} data-testid="file-cleanup-dialog" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="file-cleanup-header">
      <h2 id={titleId}><Trash2 size={20}/>{t.title}</h2>
      <div><button type="button" className="file-cleanup-button file-cleanup-refresh" disabled={locked || confirming} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? "file-cleanup-spinner" : ""}/><span>{loading ? t.scanning : t.refresh}</span></button><button type="button" className="file-cleanup-close" aria-label={t.close} title={t.close} disabled={locked} onClick={onClose}><X size={20}/></button></div>
    </header>
    <div className="file-cleanup-body" aria-busy={locked}>
      {confirming ? <section className="file-cleanup-confirm" aria-labelledby={confirmId} data-testid="file-cleanup-confirmation">
        <h3 id={confirmId}>{t.confirmTitle}</h3>
        <p>{cacheCount > 0 && <span>{cacheCount} {t.cacheCount}</span>}{selectedGenerated.length > 0 && <span>{selectedGenerated.length} {t.generatedCount}</span>}<strong>{formatBytes(selectedBytes, locale)}</strong></p>
        <ul>{selectedCache.map((category) => <li key={category.id}><HardDrive size={16}/><span>{category.id === "runtime-cache" ? t.runtime : t.previews}</span></li>)}{selectedGenerated.map((file) => <li key={file.id}><FileText size={16}/><span>{file.name}</span><small>{file.scope === "project" ? t.project : t.local}</small></li>)}</ul>
        <div className="file-cleanup-confirm-notes">{selectedCache.length > 0 && <p>{t.cacheHint}</p>}{selectedHasProject && <p>{t.projectHint}</p>}{selectedHasLocal && <p>{t.localHint}</p>}{selectedGenerated.length > 0 && <p>{t.undoHint}</p>}</div>
      </section> : <>
        <section className="file-cleanup-section"><h3>{t.cache}</h3><div className="file-cleanup-categories">{categories.map((category) => <label className={`file-cleanup-category${category.count ? "" : " empty"}`} key={category.id} title={category.id === "runtime-cache" ? t.runtimeHint : t.previewHint}>
          <input type="checkbox" data-testid={`cleanup-category-${category.id}`} checked={selectedCategories.includes(category.id)} disabled={locked || category.count <= 0} onChange={(event) => { setSelectedCategories((current) => event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id)); setLocalError(""); }}/>
          <HardDrive size={19}/><span><strong>{category.id === "runtime-cache" ? t.runtime : t.previews}</strong><small>{category.count > 0 ? category.id === "runtime-cache" ? t.cacheHint : `${category.count} ${t.files}` : t.none}</small></span><b>{formatBytes(category.bytes, locale)}</b>
        </label>)}</div></section>
        <section className="file-cleanup-section"><div className="file-cleanup-section-heading"><h3>{t.generated}<small>{generatedFiles.length}</small></h3>{generatedFiles.length > 0 && <label className="file-cleanup-select-all"><input type="checkbox" checked={allGeneratedSelected} disabled={locked || !availableFiles.length} onChange={(event) => { setSelectedFiles(event.target.checked ? availableFiles.map((file) => file.id) : []); setLocalError(""); }}/>{t.all}</label>}</div>
          {generatedFiles.length > 0 ? <div className="file-cleanup-files"><div className="file-cleanup-files-head" aria-hidden="true"><span>{t.file}</span><span>{t.location}</span><span>{t.size}</span></div>{generatedFiles.map((file) => <label className={`file-cleanup-file${file.error ? " unavailable" : ""}`} key={file.id} title={file.error || (file.exists === false ? t.missing : undefined)}>
            <input type="checkbox" data-testid={`cleanup-file-${file.id}`} checked={selectedFiles.includes(file.id)} disabled={locked || Boolean(file.error)} onChange={(event) => { setSelectedFiles((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id)); setLocalError(""); }}/>
            <span className="file-cleanup-file-name"><FileText size={17}/><strong>{file.name}</strong>{file.error ? <small>{t.unavailable}</small> : file.stage && <small>{stageLabel(file.stage)}</small>}</span>
            <span className="file-cleanup-file-location" title={file.relativePath}><small title={file.scope === "project" ? t.projectHint : t.localHint}><FolderOpen size={13}/>{file.scope === "project" ? t.project : t.local}</small><span>{file.relativePath}</span></span><b>{formatBytes(file.bytes, locale)}</b>
          </label>)}</div> : <p className="file-cleanup-empty">{loading ? <><LoaderCircle size={20} className="file-cleanup-spinner"/>{t.scanning}</> : <><FileText size={22}/>{t.empty}</>}</p>}
        </section>
      </>}
    </div>
    <footer className="file-cleanup-footer"><div className="file-cleanup-feedback">{error || localError ? <p role="alert" className="file-cleanup-error">{error || localError}</p> : message ? <p role="status">{message}</p> : <p role="status">{selectedCount ? `${t.selected} ${selectedCount} ${t.items} · ${formatBytes(selectedBytes, locale)}` : t.choose}</p>}</div><div className="file-cleanup-footer-actions">{confirming ? <><button type="button" className="file-cleanup-button" disabled={locked} onClick={backToSelection}>{t.cancel}</button><button ref={confirmButton} type="button" className="file-cleanup-button file-cleanup-primary" data-testid="cleanup-confirm" disabled={locked || !selectedCount} onClick={() => void clean()}>{pending || busy ? <LoaderCircle size={16} className="file-cleanup-spinner"/> : <Trash2 size={16}/>} {pending || busy ? t.cleaning : t.confirm}</button></> : <button ref={selectButton} type="button" className="file-cleanup-button file-cleanup-primary" data-testid="cleanup-review" disabled={locked || !selectedCount} onClick={() => { setLocalError(""); setConfirming(true); }}><Trash2 size={16}/>{t.clean}</button>}</div></footer>
  </dialog>, document.body);
}
