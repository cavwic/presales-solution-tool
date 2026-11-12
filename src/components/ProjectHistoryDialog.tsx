import { AlertTriangle, Check, FolderOpen, History, LoaderCircle, RefreshCw, Search, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { libraryApi, type ProjectLibraryEntry } from "../lib/project-library";
import type { Locale } from "../lib/workspace-schema";
import "../styles/project-library.css";

export type ProjectHistoryDialogProps = {
  locale: Locale;
  open: boolean;
  busy?: boolean;
  onClose(): void;
  onLoad(id: string): Promise<void>;
  onImportExisting(): Promise<void>;
};

const copy = {
  zh: {
    title: "历史项目", close: "关闭历史项目", search: "搜索项目名称、客户或责任人", filter: "投递状态", all: "全部项目", submitted: "已投递", draft: "未投递", refresh: "刷新项目列表", openLibrary: "打开资料库", import: "收录已有项目", loading: "正在读取项目…", noProjects: "还没有历史项目", noProjectsHint: "保存当前项目或收录已有项目后，可在这里查询。", noMatch: "没有符合条件的项目", noMatchHint: "试试其他关键词或投递状态。", choose: "选择项目查看资料位置", folder: "项目文件夹", customer: "客户", owner: "责任人", stage: "当前阶段", updated: "最近更新", submittedAt: "投递时间", source: "来源", files: "项目资料", generated: "生成文件", unknown: "未填写", noSubmission: "尚未标记", openFolder: "打开项目文件夹", load: "载入工作台", mark: "标记已投递", unmark: "取消已投递标记", marked: "已标记为已投递。", unmarked: "已取消已投递标记。", markedHint: "记录项目投递状态。", readError: "无法读取历史项目，请刷新重试。", actionError: "操作未完成，请检查项目文件夹后重试。", desktop: "请在桌面版中使用历史项目资料库。", missing: "以下文件暂时无法找到，项目记录仍已保留：", count: "个项目", presales: "售前", tender: "投标", delivery: "交底", root: "资料库位置", opening: "正在处理…",
  },
  en: {
    title: "Project history", close: "Close project history", search: "Search by project, customer, or owner", filter: "Submission status", all: "All projects", submitted: "Submitted", draft: "Not submitted", refresh: "Refresh project list", openLibrary: "Open library folder", import: "Add existing project", loading: "Loading projects…", noProjects: "No saved projects yet", noProjectsHint: "Save the current project or add an existing project to find it here.", noMatch: "No matching projects", noMatchHint: "Try another search or submission status.", choose: "Select a project to see its files", folder: "Project folder", customer: "Customer", owner: "Owner", stage: "Current stage", updated: "Last updated", submittedAt: "Submitted", source: "Source", files: "Source files", generated: "Generated files", unknown: "Not set", noSubmission: "Not marked", openFolder: "Open project folder", load: "Open in workspace", mark: "Mark as submitted", unmark: "Mark as not submitted", marked: "Marked as submitted.", unmarked: "Submission mark removed.", markedHint: "Update the saved submission status.", readError: "Could not load project history. Refresh and try again.", actionError: "The action did not finish. Check the project folder and try again.", desktop: "Use the desktop app to access the project library.", missing: "These files are currently unavailable. The project record has been kept:", count: "projects", presales: "Presales", tender: "Bid", delivery: "Handover", root: "Library location", opening: "Working…",
  },
} as const;

function sortEntries(entries: ProjectLibraryEntry[]): ProjectLibraryEntry[] {
  return [...entries].sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0));
}

function dateText(value: string | null, locale: Locale): string {
  if (!value) return copy[locale].noSubmission;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : value;
}

export default function ProjectHistoryDialog({ locale, open, busy = false, onClose, onLoad, onImportExisting }: ProjectHistoryDialogProps) {
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const lastDialogFocus = useRef<HTMLElement | null>(null);
  const [entries, setEntries] = useState<ProjectLibraryEntry[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "submitted" | "draft">("all");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const api = libraryApi();
  const t = copy[locale];
  const locked = busy || operation;
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  const visible = entries.filter(entry => (filter === "all" || (filter === "submitted" ? Boolean(entry.submittedAt) : !entry.submittedAt))
    && (!needle || [entry.name, entry.customerAlias, entry.industry, entry.owner].join(" ").normalize("NFKC").toLocaleLowerCase().includes(needle)));
  const selected = visible.find(entry => entry.id === selectedId) || visible[0] || null;

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    search.current?.focus({ preventScroll: true });
    return () => {
      if (element.open) element.close();
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open || locked) return;
    const frame = requestAnimationFrame(() => {
      const element = dialog.current;
      const active = document.activeElement;
      if (!element?.open || (active && element.contains(active))) return;
      const activeDialog = active instanceof Element ? active.closest("dialog[open]") : null;
      if (activeDialog && activeDialog !== element) return;
      const previous = lastDialogFocus.current;
      const usable = previous?.isConnected && element.contains(previous)
        && !previous.matches(":disabled, [aria-disabled='true']")
        && !previous.closest("[inert], [hidden], [aria-hidden='true']")
        && previous.getClientRects().length > 0;
      (usable ? previous : closeButton.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, locked]);

  useEffect(() => {
    if (!open || !api) return;
    let cancelled = false;
    setLoading(true); setError(""); setNotice("");
    void Promise.all([api.list(), api.info()]).then(([projects, info]) => {
      if (cancelled) return;
      setEntries(sortEntries(projects)); setRootPath(info.rootPath);
      setSelectedId(current => projects.some(entry => entry.id === current) ? current : projects[0]?.id || "");
    }).catch(() => { if (!cancelled) setError(copy[locale].readError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, api]);

  const refresh = async () => {
    if (!api) return;
    setLoading(true); setError("");
    try {
      const [projects, info] = await Promise.all([api.list(), api.info()]);
      const sorted = sortEntries(projects);
      setEntries(sorted); setRootPath(info.rootPath);
      setSelectedId(current => sorted.some(entry => entry.id === current) ? current : sorted[0]?.id || "");
    } catch { setError(t.readError); }
    finally { setLoading(false); }
  };

  const run = async (action: () => Promise<void>) => {
    if (locked) return;
    setOperation(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) { if (!(reason instanceof Error && reason.name === "AbortError")) setError(reason instanceof Error && reason.message ? reason.message : t.actionError); }
    finally { setOperation(false); }
  };

  if (typeof document === "undefined" || !open) return null;
  return createPortal(<dialog ref={dialog} className="project-history-dialog" data-testid="project-history-dialog" aria-modal="true" aria-labelledby={`${ids}-title`} onFocusCapture={event => { if (event.target instanceof HTMLElement) lastDialogFocus.current = event.target; }} onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
    <header className="project-history-header"><h2 id={`${ids}-title`}><History size={21}/>{t.title}</h2><button ref={closeButton} className="project-library-icon" type="button" aria-label={t.close} title={t.close} disabled={locked} onClick={onClose}><X size={21}/></button></header>
    <div className="project-history-toolbar">
      <label className="project-history-search"><Search size={17}/><input ref={search} data-testid="history-search" type="search" aria-label={t.search} placeholder={t.search} value={query} disabled={locked} onChange={event => setQuery(event.target.value)}/></label>
      <select data-testid="history-status-filter" aria-label={t.filter} value={filter} disabled={locked} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">{t.all}</option><option value="submitted">{t.submitted}</option><option value="draft">{t.draft}</option></select>
      <button className="project-library-icon" type="button" aria-label={t.refresh} title={t.refresh} disabled={locked || loading || !api} onClick={() => void refresh()}><RefreshCw size={18} className={loading ? "project-library-spin" : ""}/></button>
    </div>
    {!api ? <p className="project-history-unavailable" role="status">{t.desktop}</p> : <div className="project-history-content" aria-busy={loading || locked}>
      <section className="project-history-list" aria-label={t.title}>
        {loading && !entries.length ? <div className="project-history-empty"><LoaderCircle size={25} className="project-library-spin"/><span>{t.loading}</span></div> : !visible.length ? <div className="project-history-empty"><History size={28}/><strong>{entries.length ? t.noMatch : t.noProjects}</strong><span>{entries.length ? t.noMatchHint : t.noProjectsHint}</span></div> : visible.map(entry => <button className={selected?.id === entry.id ? "selected" : ""} type="button" key={entry.id} data-testid="history-project-row" data-project-id={entry.id} aria-pressed={selected?.id === entry.id} disabled={locked} onClick={() => { setSelectedId(entry.id); setError(""); setNotice(""); }}><span className="project-history-row-title"><strong>{entry.name}</strong><small className={entry.submittedAt ? "submitted" : ""}>{entry.submittedAt ? t.submitted : t.draft}</small></span><span>{entry.customerAlias || t.unknown}</span><time dateTime={entry.updatedAt}>{dateText(entry.updatedAt, locale)}</time></button>)}
      </section>
      <section className="project-history-detail" aria-label={selected?.name || t.choose}>
        {!selected ? <div className="project-history-empty"><FolderOpen size={29}/><span>{t.choose}</span></div> : <>
          <div className="project-history-detail-heading"><h3>{selected.name}</h3><span className={`project-history-status${selected.submittedAt ? " submitted" : ""}`}>{selected.submittedAt && <Check size={14}/>} {selected.submittedAt ? t.submitted : t.draft}</span></div>
          <dl className="project-history-facts"><div><dt>{t.customer}</dt><dd>{selected.customerAlias || t.unknown}</dd></div><div><dt>{t.owner}</dt><dd>{selected.owner || t.unknown}</dd></div><div><dt>{t.stage}</dt><dd>{t[selected.stage]}</dd></div><div><dt>{t.updated}</dt><dd>{dateText(selected.updatedAt, locale)}</dd></div><div><dt>{t.files}</dt><dd>{selected.sourceCount}</dd></div><div><dt>{t.generated}</dt><dd>{selected.generatedCount}</dd></div><div><dt>{t.submittedAt}</dt><dd>{dateText(selected.submittedAt, locale)}</dd></div>{selected.originLabel && <div><dt>{t.source}</dt><dd>{selected.originLabel}</dd></div>}</dl>
          <div className="project-history-folder"><span>{t.folder}</span><p>{selected.folderPath}</p></div>
          {selected.missingFiles.length > 0 && <div className="project-history-missing" role="status"><strong><AlertTriangle size={16}/>{t.missing}</strong><ul>{selected.missingFiles.map(path => <li key={path}>{path}</li>)}</ul></div>}
          <div className="project-history-actions"><button className="project-library-button" type="button" data-testid="history-open-folder" aria-label={t.openFolder} disabled={locked} onClick={() => void run(() => api.openFolder({ id: selected.id }))}><FolderOpen size={16}/>{t.openFolder}</button><button className="project-library-button" type="button" data-testid="history-mark-submitted" aria-label={selected.submittedAt ? t.unmark : t.mark} title={t.markedHint} disabled={locked} onClick={() => void run(async () => { const updated = await api.setSubmitted({ id: selected.id, submitted: !selected.submittedAt }); setEntries(current => sortEntries(current.map(entry => entry.id === updated.id ? updated : entry))); setNotice(updated.submittedAt ? t.marked : t.unmarked); })}>{selected.submittedAt ? t.unmark : t.mark}</button><button className="project-library-button project-library-primary" type="button" data-testid="history-load" aria-label={t.load} disabled={locked} onClick={() => void run(async () => { await onLoad(selected.id); onClose(); })}><FolderOpen size={16}/>{t.load}</button></div>
        </>}
      </section>
    </div>}
    <footer className="project-history-footer"><div className="project-history-location"><span title={t.root}>{rootPath || (api ? `${visible.length} ${t.count}` : t.desktop)}</span>{error ? <p role="alert" className="project-library-error">{error}</p> : notice ? <p role="status">{notice}</p> : locked && <p role="status">{t.opening}</p>}</div><div><button className="project-library-button" type="button" data-testid="history-open-library" aria-label={t.openLibrary} disabled={locked || !api} onClick={() => void run(() => api!.openFolder({}))}><FolderOpen size={16}/>{t.openLibrary}</button><button className="project-library-button" type="button" data-testid="history-import-existing" aria-label={t.import} disabled={locked || !api} onClick={() => void run(async () => { await onImportExisting(); setSelectedId(""); await refresh(); })}><Upload size={16}/>{t.import}</button></div></footer>
  </dialog>, document.body);
}
