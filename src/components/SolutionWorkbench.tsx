import {
  AlertTriangle,
  Archive,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Eraser,
  ExternalLink,
  FileArchive,
  FileCheck2,
  FileInput,
  FileImage,
  FileOutput,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderCog,
  FolderOpen,
  PackageCheck,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import ModelControls from "./ModelControls";
import FileCleanupPanel, { type CleanupCategory, type CleanupGeneratedFile, type CleanupSelection } from "./FileCleanupPanel";
import { executeGeneratedCleanup, previewGeneratedCleanup, type GeneratedCleanupCandidate, type GeneratedCleanupPreview } from "../lib/file-cleanup";
import type { CleanupPreview as NativeCleanupPreview } from "../lib/desktop-bridge";
import {
  buildBidFilePrompt,
  buildCodexBidFileTask,
} from "../lib/bid-generation";
import {
  buildCodexHandoverTask,
  buildHandoverTaskSplitPrompt,
  requestHandoverTaskSplit,
} from "../lib/handover-generation";
import {
  downloadBlob,
} from "../lib/exporters";
import { hasReadableSourceText, parseSourceFile } from "../lib/parsers";
import {
  createFormatOnlyTemplateSource,
  generalTemplateSourceId,
  resolveFormatTemplateSources,
} from "../lib/format-templates";
import {
  buildCodexCustomerAnalysisTask,
  buildCodexPresalesTask,
  buildCustomerNeedsAnalysisPrompt,
  buildPresalesPrompt,
  analysisResultBaseName,
  createGeneratedFile,
  getActionResponseTarget,
  requestPresalesDraft,
  templateFileFormat,
  type ResponseFileFormat,
} from "../lib/presales-generation";
import {
  readModelApiKey,
  readModelSettings,
  type ModelTask,
} from "../lib/model-settings";
import {
  consumeModelActionReturnState,
  hasBrowserCallableModel,
  type ModelActionReturnState,
  type WorkspaceView,
} from "../lib/model-action";
import {
  chooseWorkspaceDirectory,
  chooseProjectOutputDirectory,
  chooseTaskOutputDirectory,
  copyWorkspaceFilesToOutput,
  clearPersistedSourceFiles,
  ensureProjectStageDirectories,
  importProjectArchive,
  loadActiveProject,
  listWorkspaceOutputFiles,
  loadSourceFilesFromDirectory,
  migrateWorkspaceDirectory,
  persistWorkspaceDirectory,
  persistSourceFiles,
  readGeneratedFileFromDirectory,
  readWorkspaceFileFromRelativePath,
  removeWorkspaceFileFromRelativePath,
  trashWorkspaceFileFromRelativePath,
  removePersistedSourceFile,
  restoreSourceFiles,
  restoreProjectOutputDirectory,
  restoreWorkspaceDirectory,
  saveTaskFileToDirectory,
  saveProjectStateToDirectory,
  saveProjectToDirectory,
  saveWorkspaceFilesAsZip,
  ensureWorkspaceDirectoryPath,
  saveWorkspaceFilesToDirectory,
  saveWorkspaceTextFiles,
  synchronizeProjectHistoryToDirectory,
  synchronizeDerivedWorkspaceArtifacts,
  supportsDirectoryAccess,
  validateWorkspaceOutputDirectory,
  type DirectoryHandleLike,
  type WorkspaceOutputFile,
} from "../lib/workspace-io";
import { WorkspaceHistory, type HistoryDirection } from "../lib/workspace-history";
import {
  WORKSPACE_MODULE_DIRECTORIES,
  analysisSupplementText,
  bidItemDirectory,
  chineseInteger,
  handoverTaskDirectory,
  presalesRoundDirectory,
  responseFileMetadata,
  safeWorkspaceName,
  sourceReferenceDocument,
  tenderClarificationDirectory,
} from "../lib/workspace-storage";
import {
  buildCodexOcrTask,
  buildCodexTenderTask,
  buildTenderAnalysisPrompt,
  buildTenderComparisonPrompt,
  createTenderGeneratedFile,
  extractTenderStructuredData,
  requestOcrRecognition,
  tenderTemplateFileFormat,
} from "../lib/tender-generation";
import {
  createRequirement,
  inferProjectStage,
  localizeBuiltInProject,
  requirementCoverage,
  syncProjectStage,
  validateProject,
} from "../lib/workflow";
import {
  createEmptyProject,
  createId,
  createPresalesRound,
  isLegacyUntouchedPresalesRound,
  projectManifestSchema,
  type Locale,
  type GeneralTemplateFormat,
  type PresalesGeneratedFile,
  type PresalesAnalysisResult,
  type PresalesParticipant,
  type PresalesRound,
  type PresalesRoundAction,
  type ProjectManifest,
  type BidFileChecklistItem,
  type SourceDocument,
  type TenderAnalysisResult,
  type BidGeneratedFile,
  type TenderOutputFormat,
  type HandoverDepartment,
  type HandoverDeliverableType,
  type HandoverResponseMethod,
  type HandoverTask,
  type HandoverTaskStatus,
} from "../lib/workspace-schema";

declare global {
  interface BidDesktopWindowControls {
    windowControl?(action: "minimize" | "maximize" | "close"): void;
    windowResize?(state: { phase: "start" | "move" | "end"; edge: "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"; screenX: number; screenY: number }): void;
    onWindowState?(callback: (state: { maximized: boolean }) => void): (() => void) | void;
    setLocale?(locale: "zh" | "en"): void;
    setTheme?(theme: "light" | "dark" | "system"): void;
    openFile?(input: { name: string; data: Uint8Array }): Promise<string>;
  }
  interface Window {
    bidDesktop?: BidDesktopWindowControls;
  }
}

async function openFilePreview(file: Blob, name: string): Promise<void> {
  if (window.bidDesktop?.openFile) {
    await window.bidDesktop.openFile({ name, data: new Uint8Array(await file.arrayBuffer()) });
    return;
  }
  const url = URL.createObjectURL(file);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

type View = WorkspaceView;
type Props = { initialView?: View };
type ModelInvocation = { settings: ReturnType<typeof readModelSettings>; apiKey: string };
type PendingDirectoryChange = { handle: DirectoryHandleLike; mode: "select" | "migrate" };
const isUsableProjectDirectory = (handle: DirectoryHandleLike | null): handle is DirectoryHandleLike => Boolean(
  handle
  && typeof handle.getDirectoryHandle === "function"
  && typeof handle.getFileHandle === "function",
);
type PendingModelAction =
  | { kind: "customer-analysis"; roundId: string; anchorId: string }
  | { kind: "response-files"; roundId: string; actionIds: string[]; anchorId: string }
  | { kind: "tender-ocr"; sourceIds: string[]; anchorId: string }
  | { kind: "tender-analysis"; anchorId: string }
  | { kind: "tender-comparison"; anchorId: string }
  | { kind: "bid-output"; bidFileId: string; anchorId: string }
  | { kind: "handover-task-split"; anchorId: string };

const copy = {
  zh: {
    project: "售前解决方案工具",
    projectContext: "项目与边界",
    presales: "售前准备",
    requirements: "招标",
    bid: "投标",
    handover: "中标交底",
    outputs: "输出文件",
    reset: "新建项目",
    projectPath: "项目设置",
    projectName: "项目名称",
    customer: "客户代称",
    industry: "行业",
    owner: "项目责任人",
    budget: "预算信息",
    deadline: "计划截止日期",
    objective: "业务目标",
    constraints: "约束与不可承诺项",
    presalesPack: "售前清单包",
    actions: "会后执行清单",
    add: "新增",
    sourceLibrary: "招标文件",
    importSources: "导入文件",
    noSource: "导入招标书及相关文件",
    sourceSegments: "来源片段",
    addRequirement: "加入要求",
    requirementReview: "要求复核队列",
    baselineDiff: "售前与招标差异",
    commitments: "承诺基线",
    handoverList: "技术交底与项目协同",
    directory: "选择工作区目录",
    sync: "写入目录",
    rescan: "重新扫描",
    importZip: "导入项目 ZIP",
    pending: "待批准",
    evidenced: "已绑定证据",
    approved: "已批准",
    total: "招标要求",
    saved: "已保存到本机",
    folderSaved: "项目状态及目录结构已写入本地工作区。",
    projectPathSaved: "项目已保存到所选路径。",
    projectPathRequired: "未设置项目路径，请先在“项目设置”中选择项目路径。",
    projectPathRequiredHint: "当前操作已取消。关闭提示后仍停留在原来的页面和位置，现有内容不会丢失。",
    acknowledge: "知道了",
    loaded: "已载入项目。",
    invalid: "文件结构无法识别，请检查项目版本或文件类型。",
    parsing: "正在解析来源文件",
    noRequirement: "选择一条要求查看并编辑响应、偏离和证据。",
    ocr: "该 PDF 几乎没有可提取文字，请先完成 OCR，再导入识别结果。",
    darkMode: "切换到深色模式",
    lightMode: "切换到浅色模式",
    remove: "删除",
    ready: "已就绪",
  },
  en: {
    project: "Presales Solution Tool",
    projectContext: "Project and boundary",
    presales: "Presales",
    requirements: "Tender",
    bid: "Bid",
    handover: "Award handover",
    outputs: "Output files",
    reset: "New project",
    projectPath: "Project settings",
    projectName: "Project name",
    customer: "Customer alias",
    industry: "Industry",
    owner: "Project owner",
    budget: "Budget information",
    deadline: "Target deadline",
    objective: "Business objective",
    constraints: "Constraints and non-commitments",
    presalesPack: "Presales pack",
    actions: "Follow-up actions",
    add: "Add",
    sourceLibrary: "Tender files",
    importSources: "Import files",
    noSource: "Import the tender and related files.",
    sourceSegments: "Source segments",
    addRequirement: "Add requirement",
    requirementReview: "Requirement review queue",
    baselineDiff: "Presales and tender differences",
    commitments: "Commitment baseline",
    handoverList: "Technical handover and project actions",
    directory: "Choose workspace folder",
    sync: "Write to folder",
    rescan: "Rescan",
    importZip: "Import project ZIP",
    pending: "Pending approval",
    evidenced: "With evidence",
    approved: "Approved",
    total: "Tender requirements",
    saved: "Saved on this computer",
    folderSaved: "Project state and folder structure were written to the local workspace.",
    projectPathSaved: "Project saved to the selected folder.",
    projectPathRequired: "No project folder is set. Choose one in Project settings first.",
    projectPathRequiredHint: "The current action was cancelled. Closing this message keeps the current page, position, and existing content.",
    acknowledge: "Got it",
    loaded: "Project loaded.",
    invalid: "The file structure is not supported. Check its project version or file type.",
    parsing: "Parsing source files",
    noRequirement: "Select a requirement to edit its response, deviation, and evidence.",
    ocr: "This PDF contains almost no selectable text. Run OCR and import the recognized text.",
    darkMode: "Switch to dark mode",
    lightMode: "Switch to light mode",
    remove: "Remove",
    ready: "Ready",
  },
} as const;

const emptyPresalesMigrationKey = "cavwic-empty-presales-default-v1";

const viewMeta: Array<{ id: View; icon: typeof BriefcaseBusiness; code: string }> = [
  { id: "presales", icon: BriefcaseBusiness, code: "01" },
  { id: "requirements", icon: FileSearch, code: "02" },
  { id: "bid", icon: PackageCheck, code: "03" },
  { id: "handover", icon: ClipboardCheck, code: "04" },
  { id: "outputs", icon: FileOutput, code: "05" },
];

const actionStatusLabels = {
  zh: { open: "待处理", working: "进行中", blocked: "受阻", done: "已完成" },
  en: { open: "Open", working: "Working", blocked: "Blocked", done: "Done" },
} as const;
const projectStageLabels = {
  zh: { presales: "售前", tender: "投标", delivery: "交底" },
  en: { presales: "Presales", tender: "Tender", delivery: "Handover" },
} as const;
const diffRelationLabels = {
  zh: { added: "新增", changed: "已修改", unchanged: "未变化", removed: "已删除", conflict: "有冲突" },
  en: { added: "Added", changed: "Changed", unchanged: "Unchanged", removed: "Removed", conflict: "Conflict" },
} as const;
const preprocessStatusLabels = {
  zh: { uploaded: "已上传，等待预处理", ready: "上传并预处理完成", "needs-ocr": "存在无法识别内容", skipped: "仅上传，未处理", processing: "正在识别", failed: "识别失败" },
  en: { uploaded: "Uploaded, preprocessing pending", ready: "Uploaded and preprocessed", "needs-ocr": "Unrecognized content detected", skipped: "Uploaded only, not processed", processing: "Recognizing", failed: "Recognition failed" },
} as const;
const bidFileCategoryLabels = {
  zh: { technical: "技术文件", business: "商务文件", qualification: "资格文件", delivery: "交付与验收", other: "其他" },
  en: { technical: "Technical", business: "Business", qualification: "Qualification", delivery: "Delivery and acceptance", other: "Other" },
} as const;
const recommendedAnalysisKeywords = {
  zh: ["技术参数", "评标办法", "时间", "进度", "资质"],
  en: ["Technical parameters", "Evaluation method", "Schedule", "Progress", "Qualifications"],
} as const;
const participantCategoryLabels = {
  zh: { customer: "客户", "third-party": "第三方", internal: "公司内人员" },
  en: { customer: "Customer", "third-party": "Third party", internal: "Internal" },
} as const;
const handoverDeliverableLabels: Record<Locale, Record<HandoverDeliverableType, string>> = {
  zh: { document: "文件", "drawing-bom": "图纸 / BOM", software: "软件包 / 配置", "test-record": "测试记录", training: "培训材料", "site-action": "现场实施", approval: "审批确认", other: "其他" },
  en: { document: "Document", "drawing-bom": "Drawing / BOM", software: "Software / config", "test-record": "Test record", training: "Training material", "site-action": "Site work", approval: "Approval", other: "Other" },
};
const handoverResponseLabels: Record<Locale, Record<HandoverResponseMethod, string>> = {
  zh: { file: "上传文件", report: "文字报告", path: "软件包 / 路径", confirmation: "状态确认", mixed: "混合响应" },
  en: { file: "File upload", report: "Written report", path: "Package / path", confirmation: "Status confirmation", mixed: "Mixed response" },
};
const handoverTaskStatusLabels: Record<Locale, Record<HandoverTaskStatus, string>> = {
  zh: { pending: "待处理", working: "进行中", blocked: "受阻", submitted: "已提交", accepted: "已验收" },
  en: { pending: "Pending", working: "In progress", blocked: "Blocked", submitted: "Submitted", accepted: "Accepted" },
};

type WorkspaceOutputModuleGroup = { path: string; label: string; files: WorkspaceOutputFile[] };
type WorkspaceOutputStageGroup = { path: string; label: string; modules: WorkspaceOutputModuleGroup[]; files: WorkspaceOutputFile[] };

function groupWorkspaceOutputFiles(files: WorkspaceOutputFile[]): WorkspaceOutputStageGroup[] {
  const stages = new Map<string, Map<string, WorkspaceOutputFile[]>>();
  for (const file of files) {
    const parts = file.relativePath.split("/");
    const stagePath = parts[0];
    const modulePath = parts.slice(0, -1).join("/");
    const modules = stages.get(stagePath) || new Map<string, WorkspaceOutputFile[]>();
    const moduleFiles = modules.get(modulePath) || [];
    moduleFiles.push(file);
    modules.set(modulePath, moduleFiles);
    stages.set(stagePath, modules);
  }
  return [...stages.entries()].map(([stagePath, modules]) => {
    const moduleGroups = [...modules.entries()].map(([modulePath, moduleFiles]) => ({
      path: modulePath,
      label: modulePath.split("/").slice(1).join(" / ") || stagePath,
      files: moduleFiles,
    }));
    return {
      path: stagePath,
      label: stagePath,
      modules: moduleGroups,
      files: moduleGroups.flatMap((module) => module.files),
    };
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function selectedCustomerSourceIds(round: PresalesRound): string[] {
  return round.selectedRequirementSourceIds ?? round.requirementSourceIds;
}

function uniqueAnalysisResultName(baseName: string, results: PresalesAnalysisResult[]): string {
  if (!results.some((result) => result.name === baseName)) return baseName;
  let index = 2;
  while (results.some((result) => result.name === `${baseName}-${index}`)) index += 1;
  return `${baseName}-${index}`;
}

function sourceIsReferenced(project: ProjectManifest, sourceId: string): boolean {
  return Object.values(project.generalTemplates).includes(sourceId)
    || project.enterpriseContext.sourceIds.includes(sourceId)
    || project.tenderSourceIds.includes(sourceId)
    || project.tenderClarificationRounds.some((round) => round.sourceIds.includes(sourceId))
    || project.tenderAnalysis.templateSourceIds.includes(sourceId)
    || project.tenderAnalysis.results.some((result) => result.sourceId === sourceId || result.sourceIds.includes(sourceId) || result.templateSourceIds.includes(sourceId))
    || project.tenderComparison.selectedPresalesSourceIds.includes(sourceId)
    || project.tenderComparison.templateSourceIds.includes(sourceId)
    || project.tenderComparison.results.some((result) => result.sourceId === sourceId || result.sourceIds.includes(sourceId) || result.templateSourceIds.includes(sourceId))
    || project.bidFileChecklist.some((item) => item.templateSourceIds.includes(sourceId)
      || item.referenceSourceIds.includes(sourceId)
      || item.generatedFiles.some((file) => file.sourceId === sourceId || file.referenceSourceIds.includes(sourceId) || file.templateSourceIds.includes(sourceId)))
    || project.handover.awardSourceIds.includes(sourceId)
    || project.handover.tasks.some((task) => task.sourceIds.includes(sourceId) || task.responseSourceIds.includes(sourceId))
    || project.requirements.some((item) => item.sourceRef?.documentId === sourceId)
    || project.evidence.some((item) => item.sourceRef?.documentId === sourceId)
    || project.presalesRounds.some((round) => round.requirementSourceIds.includes(sourceId)
      || round.referenceSourceIds.includes(sourceId)
      || round.templateSourceIds.includes(sourceId)
      || round.actions.some((action) => action.templateSourceIds.includes(sourceId))
      || round.generatedFiles.some((file) => file.sourceId === sourceId)
      || round.analysisResults.some((result) => result.sourceId === sourceId || result.sourceIds.includes(sourceId) || result.templateSourceIds.includes(sourceId)));
}

function downloadText(name: string, content: string, type: string): void {
  downloadBlob(name, new Blob([content], { type }));
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}</label>;
}

function LocalizedTemporalInput({
  type,
  locale,
  value,
  ariaLabel,
  emptyPlaceholder,
  onChange,
}: {
  type: "date" | "datetime-local";
  locale: Locale;
  value: string;
  ariaLabel: string;
  emptyPlaceholder?: string;
  onChange(value: string): void;
}) {
  const datePlaceholder = locale === "zh" ? "年 / 月 / 日" : "MM / DD / YYYY";
  const placeholder = emptyPlaceholder ?? (type === "date" ? datePlaceholder : `${datePlaceholder}  HH:MM`);
  const [datePart = "", timePart = ""] = value.split("T");
  const [year = "", month = "", day = ""] = datePart.split("-");
  const formattedDate = year && month && day
    ? (locale === "zh" ? `${year}/${month}/${day}` : `${month}/${day}/${year}`)
    : "";
  const displayValue = formattedDate && type === "datetime-local"
    ? `${formattedDate}  ${timePart.slice(0, 5)}`
    : formattedDate;

  const showPicker = (input: HTMLInputElement) => {
    try { input.showPicker?.(); } catch { /* The native input remains usable when showPicker is unavailable. */ }
  };

  return <div className={`localized-temporal-input${value ? "" : " empty"}`}>
    <input
      type={type}
      lang={locale === "zh" ? "zh-CN" : "en-US"}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => showPicker(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        showPicker(event.currentTarget);
      }}
    />
    <span aria-hidden="true">{displayValue || placeholder}</span>
    <CalendarDays aria-hidden="true" size={18}/>
  </div>;
}

function ConfirmableTextarea({
  fieldId,
  label,
  locale,
  value,
  rows,
  placeholder,
  ariaLabel,
  wide = false,
  confirmed,
  onChange,
  onConfirmedChange,
}: {
  fieldId: string;
  label: string;
  locale: Locale;
  value: string;
  rows: number;
  placeholder?: string;
  ariaLabel?: string;
  wide?: boolean;
  confirmed: boolean;
  onChange(value: string): void;
  onConfirmedChange(confirmed: boolean): void;
}) {
  const [controlsVisible, setControlsVisible] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusTextarea = () => window.requestAnimationFrame(() => textarea.current?.focus());
  const edit = () => { onConfirmedChange(false); focusTextarea(); };
  const clear = () => { onChange(""); onConfirmedChange(false); focusTextarea(); };

  return <div className={`field confirmable-field${wide ? " wide" : ""}`}>
    <span>{label}</span>
    <div
      data-field-id={fieldId}
      className={`confirmable-textarea${confirmed ? " confirmed" : ""}${controlsVisible ? " controls-visible" : ""}`}
      onPointerMove={(event) => setControlsVisible(event.clientY - event.currentTarget.getBoundingClientRect().top <= 46)}
      onPointerLeave={() => setControlsVisible(false)}
    >
      <textarea ref={textarea} rows={rows} aria-label={ariaLabel || label} placeholder={placeholder} readOnly={confirmed} value={value} onChange={(event) => onChange(event.target.value)}/>
      <div className="textarea-controls" role="toolbar" aria-label={locale === "zh" ? "多行文本编辑操作" : "Multiline text editing actions"}>
        <button type="button" disabled={confirmed} aria-label={locale === "zh" ? "确认文本内容" : "Confirm text"} title={locale === "zh" ? "确认" : "Confirm"} onClick={() => onConfirmedChange(true)}><Check size={15}/></button>
        <button type="button" disabled={!confirmed} aria-label={locale === "zh" ? "修改文本内容" : "Edit text"} title={locale === "zh" ? "修改" : "Edit"} onClick={edit}><Pencil size={15}/></button>
        <button type="button" aria-label={locale === "zh" ? "清空文本内容" : "Clear text"} title={locale === "zh" ? "清空" : "Clear"} onClick={clear}><Eraser size={15}/></button>
      </div>
    </div>
  </div>;
}

export default function SolutionWorkbench({ initialView = "presales" }: Props) {
  const [locale, setLocale] = useState<Locale>("zh");
  const [headerSettingsTarget, setHeaderSettingsTarget] = useState<HTMLElement | null>(null);
  const solutionApp = useRef<HTMLDivElement>(null);
  const projectHeader = useRef<HTMLElement>(null);
  const projectSettingsSection = useRef<HTMLElement>(null);
  useEffect(() => { setHeaderSettingsTarget(document.getElementById("workbench-header-settings")); }, []);
  useEffect(() => {
    const app = solutionApp.current;
    const header = projectHeader.current;
    const toolbar = document.querySelector<HTMLElement>(".lab-header");
    if (!app || !header || !toolbar) return;
    const measureHeaders = () => {
      app.style.setProperty("--toolbar-height", `${toolbar.getBoundingClientRect().height}px`);
      app.style.setProperty("--project-header-height", `${header.getBoundingClientRect().height}px`);
    };
    const observer = new ResizeObserver(measureHeaders);
    observer.observe(toolbar);
    observer.observe(header);
    measureHeaders();
    return () => observer.disconnect();
  }, []);
  const [view, setView] = useState<View>(initialView);
  const [project, setProject] = useState<ProjectManifest>(() => createEmptyProject("zh"));
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [workspaceRecovery, setWorkspaceRecovery] = useState<{ key: string; content: string; saved: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [directoryHandle, setDirectoryHandle] = useState<DirectoryHandleLike | null>(null);
  const [taskKind, setTaskKind] = useState<"workflow" | "extract" | "bid">("workflow");
  const [outputDirectoryHandle, setOutputDirectoryHandle] = useState<DirectoryHandleLike | null>(null);
  const [workspaceOutputFiles, setWorkspaceOutputFiles] = useState<WorkspaceOutputFile[]>([]);
  const [selectedOutputPaths, setSelectedOutputPaths] = useState<Set<string>>(new Set());
  const [outputFilesLoading, setOutputFilesLoading] = useState(false);
  const [outputPathRequired, setOutputPathRequired] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<Map<string, File>>(new Map());
  const [generatedBlobs, setGeneratedBlobs] = useState<Map<string, Blob>>(new Map());
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupCategories, setCleanupCategories] = useState<CleanupCategory[]>([]);
  const [cleanupFiles, setCleanupFiles] = useState<CleanupGeneratedFile[]>([]);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupError, setCleanupError] = useState("");
  const cleanupSequence = useRef(0);
  const cleanupRunningRef = useRef(false);
  const cleanupSnapshot = useRef<{
    project: ProjectManifest; directory: DirectoryHandleLike | null; files: Map<string, File>; blobs: Map<string, Blob>;
    generated: GeneratedCleanupPreview; cache: NativeCleanupPreview | null;
  } | null>(null);
  const [generatingActionId, setGeneratingActionId] = useState("");
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [analyzingRoundId, setAnalyzingRoundId] = useState("");
  const [expandedAnalysisId, setExpandedAnalysisId] = useState("");
  const [expandedTenderSourceId, setExpandedTenderSourceId] = useState("");
  const [expandedTenderResultId, setExpandedTenderResultId] = useState("");
  const [expandedBidFileId, setExpandedBidFileId] = useState("");
  const [expandedHandoverTaskId, setExpandedHandoverTaskId] = useState("");
  const [tenderKeywordDraft, setTenderKeywordDraft] = useState("");
  const [ocrChoiceSourceIds, setOcrChoiceSourceIds] = useState<string[] | null>(null);
  const [ocrProgress, setOcrProgress] = useState<Record<string, number>>({});
  const [resumeModelAction, setResumeModelAction] = useState<PendingModelAction | null>(null);
  const [filesHydrated, setFilesHydrated] = useState(false);
  const [participantDrafts, setParticipantDrafts] = useState<Record<string, { name: string; category: PresalesParticipant["category"] }>>({});
  const [returnState, setReturnState] = useState<ModelActionReturnState | null>(null);
  const [pendingModelAction, setPendingModelAction] = useState<PendingModelAction | null>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [pendingDirectoryChange, setPendingDirectoryChange] = useState<PendingDirectoryChange | null>(null);
  const [projectPathRequired, setProjectPathRequired] = useState(false);
  const sourceInput = useRef<HTMLInputElement>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const modelChoicePrimary = useRef<HTMLButtonElement>(null);
  const modelActionAwaitingSettings = useRef<PendingModelAction | null>(null);
  const projectRef = useRef(project);
  const sourceFilesRef = useRef(sourceFiles);
  const knownSourceFilesRef = useRef<Map<string, File>>(new Map());
  const historyRef = useRef(new WorkspaceHistory(3));
  const busyRef = useRef(busy);
  const t = copy[locale];

  projectRef.current = project;
  sourceFilesRef.current = sourceFiles;
  busyRef.current = busy;
  for (const [sourceId, file] of sourceFiles) knownSourceFilesRef.current.set(sourceId, file);

  const publishHistoryState = () => {
    window.dispatchEvent(new CustomEvent("cavwic-history-state", {
      detail: { ...historyRef.current.state, busy: busyRef.current },
    }));
  };

  const recordHistory = (previous: ProjectManifest, group = "") => {
    historyRef.current.record(previous, group);
    window.queueMicrotask(publishHistoryState);
  };

  const projectFilesForSnapshot = (snapshot: ProjectManifest) => new Map(
    snapshot.sources
      .map((source) => [source.id, knownSourceFilesRef.current.get(source.id)] as const)
      .filter((entry): entry is readonly [string, File] => Boolean(entry[1])),
  );

  const applyHistory = async (direction: HistoryDirection) => {
    if (busyRef.current) return;
    const current = projectRef.current;
    const target = historyRef.current.peek(direction);
    if (!target) return;
    const currentSourceIds = new Set(current.sources.map((source) => source.id));
    const restoredSource = target.sources.find((source) => !currentSourceIds.has(source.id) && !knownSourceFilesRef.current.has(source.id));
    if (restoredSource) {
      setNotice(locale === "zh" ? `无法恢复“${restoredSource.name}”，当前会话中缺少文件副本。` : `Cannot restore “${restoredSource.name}” because its session copy is unavailable.`);
      return;
    }

    const targetFiles = projectFilesForSnapshot(target);
    busyRef.current = true;
    setBusy(true);
    publishHistoryState();
    try {
      if (isUsableProjectDirectory(directoryHandle)) {
        await synchronizeProjectHistoryToDirectory(directoryHandle, current, target, targetFiles);
      }
      const targetSourceIds = new Set(target.sources.map((source) => source.id));
      for (const source of current.sources) {
        if (!targetSourceIds.has(source.id)) await removePersistedSourceFile(current.id, source.id).catch(() => undefined);
      }
      await persistSourceFiles(target.id, targetFiles).catch(() => undefined);
      const applied = historyRef.current.apply(direction, current);
      if (!applied) return;
      persistProjectSnapshot(applied);
      projectRef.current = applied;
      sourceFilesRef.current = targetFiles;
      setProject(applied);
      setSourceFiles(targetFiles);
      setSelectedSourceId("");
      setSelectedRequirementId("");
      setSelectedActionIds(new Set());
      setExpandedAnalysisId("");
      setExpandedTenderSourceId("");
      setExpandedTenderResultId("");
      setExpandedBidFileId("");
      setExpandedHandoverTaskId("");
      setNotice(direction === "undo"
        ? (locale === "zh" ? "已撤销上一步操作。" : "The last action was undone.")
        : (locale === "zh" ? "已恢复上一步操作。" : "The last action was restored."));
    } catch {
      setNotice(locale === "zh"
        ? "撤销或恢复失败，项目目录中的文件未能完整同步。"
        : "Undo or redo failed because the project files could not be synchronized.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      window.queueMicrotask(publishHistoryState);
    }
  };

  const issues = useMemo(() => validateProject(project, locale), [project, locale]);
  const coverage = useMemo(() => requirementCoverage(project), [project]);
  const currentStage = useMemo(() => inferProjectStage(project), [project]);
  const outputGroups = useMemo(() => groupWorkspaceOutputFiles(workspaceOutputFiles), [workspaceOutputFiles]);

  const refreshWorkspaceOutputFiles = async (handle = directoryHandle) => {
    if (!isUsableProjectDirectory(handle)) {
      setWorkspaceOutputFiles([]);
      setSelectedOutputPaths(new Set());
      return;
    }
    setOutputFilesLoading(true);
    try {
      const files = await listWorkspaceOutputFiles(handle);
      const available = new Set(files.map((file) => file.relativePath));
      setWorkspaceOutputFiles(files);
      setSelectedOutputPaths((current) => new Set([...current].filter((path) => available.has(path))));
    } catch {
      setNotice(locale === "zh" ? "无法读取项目文件，请重新授权项目路径。" : "Project files could not be read. Authorize the project folder again.");
    } finally {
      setOutputFilesLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storedLocale = localStorage.getItem("cavwic-lab-locale");
      const nextLocale: Locale = storedLocale === "en" ? "en" : "zh";
      const storedTheme = localStorage.getItem("cavwic-lab-theme");
      const nextTheme = storedTheme === "dark" || storedTheme === "light" ? storedTheme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      let nextProject = syncProjectStage(createEmptyProject(nextLocale));
      const stored = localStorage.getItem("cavwic-solution-workspace");
      if (stored) {
        try {
          const parsed = projectManifestSchema.parse(JSON.parse(stored));
          nextProject = syncProjectStage(localizeBuiltInProject(parsed, nextLocale));
          if (nextProject.handover.awardNotes === "Award scope confirmed for local review.") {
            nextProject = {
              ...nextProject,
              handover: { ...nextProject.handover, awardNotes: "" },
            };
          }
        } catch {
          const recoveryKey = `cavwic-solution-workspace-recovery-${Date.now()}`;
          let saved = false;
          try { localStorage.setItem(recoveryKey, stored); saved = true; } catch { /* Keep the original value and offer a file backup. */ }
          setWorkspaceRecovery({ key: recoveryKey, content: stored, saved });
        }
      }
      if (!localStorage.getItem(emptyPresalesMigrationKey)) {
        if (nextProject.presalesRounds.length === 1 && isLegacyUntouchedPresalesRound(nextProject.presalesRounds[0])) {
          nextProject = { ...nextProject, presalesRounds: [] };
        }
        try { localStorage.setItem(emptyPresalesMigrationKey, "1"); } catch { /* Workspace recovery also works when the cache is full. */ }
      }
      const restoredHandle = await restoreWorkspaceDirectory().catch(() => null);
      const restoredOutputHandle = await restoreProjectOutputDirectory().catch(() => null);
      const handle = isUsableProjectDirectory(restoredHandle) ? restoredHandle : null;
      const outputHandle = isUsableProjectDirectory(restoredOutputHandle) ? restoredOutputHandle : null;
      const persistedFiles = await restoreSourceFiles(nextProject.id).catch(() => new Map<string, File>());
      if (handle) {
        const directoryFiles = await loadSourceFilesFromDirectory(handle, nextProject).catch(() => new Map<string, File>());
        for (const [id, file] of directoryFiles) if (!persistedFiles.has(id)) persistedFiles.set(id, file);
      }
      if (cancelled) return;
      historyRef.current.reset();
      projectRef.current = nextProject;
      sourceFilesRef.current = persistedFiles;
      knownSourceFilesRef.current = new Map(persistedFiles);
      setLocale(nextLocale);
      setProject(nextProject);
      setSourceFiles(persistedFiles);
      setDirectoryHandle(handle);
      setOutputDirectoryHandle(outputHandle);
      document.documentElement.dataset.locale = nextLocale;
      document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
      document.documentElement.dataset.theme = nextTheme;
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const pendingReturn = consumeModelActionReturnState(currentPath);
      if (pendingReturn) {
        setView(pendingReturn.view);
        setSelectedSourceId(pendingReturn.selectedSourceId);
        setSelectedRequirementId(pendingReturn.selectedRequirementId);
        setSelectedActionIds(new Set(pendingReturn.selectedActionIds));
        setExpandedAnalysisId(pendingReturn.expandedAnalysisId);
        setTaskKind(pendingReturn.taskKind);
        setReturnState(pendingReturn);
        if (pendingReturn.action === "tender-ocr") setResumeModelAction({ kind: "tender-ocr", sourceIds: pendingReturn.targetIds, anchorId: pendingReturn.anchorId });
        else if (pendingReturn.action === "tender-analysis") setResumeModelAction({ kind: "tender-analysis", anchorId: pendingReturn.anchorId });
        else if (pendingReturn.action === "tender-comparison") setResumeModelAction({ kind: "tender-comparison", anchorId: pendingReturn.anchorId });
        else if (pendingReturn.action === "bid-output" && pendingReturn.targetIds[0]) {
          setExpandedBidFileId(pendingReturn.targetIds[0]);
          setResumeModelAction({ kind: "bid-output", bidFileId: pendingReturn.targetIds[0], anchorId: pendingReturn.anchorId });
        }
        else if (pendingReturn.action === "handover-task-split") setResumeModelAction({ kind: "handover-task-split", anchorId: pendingReturn.anchorId });
      }
      setFilesHydrated(true);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || workspaceRecovery) return;
    const undo = () => { void applyHistory("undo"); };
    const redo = () => { void applyHistory("redo"); };
    const publish = () => publishHistoryState();
    window.addEventListener("cavwic-history-undo", undo);
    window.addEventListener("cavwic-history-redo", redo);
    window.addEventListener("cavwic-history-request", publish);
    publishHistoryState();
    return () => {
      window.removeEventListener("cavwic-history-undo", undo);
      window.removeEventListener("cavwic-history-redo", redo);
      window.removeEventListener("cavwic-history-request", publish);
    };
  }, [directoryHandle, locale, ready, workspaceRecovery]);

  useEffect(() => {
    if (ready) publishHistoryState();
  }, [busy, ready]);

  useEffect(() => {
    const resume = () => {
      const pending = modelActionAwaitingSettings.current;
      if (!pending) return;
      modelActionAwaitingSettings.current = null;
      setResumeModelAction(pending);
      window.requestAnimationFrame(() => document.getElementById(pending.anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    window.addEventListener("bid-model-settings-saved", resume);
    return () => window.removeEventListener("bid-model-settings-saved", resume);
  }, []);

  useEffect(() => {
    if (!ready || view !== "outputs") return;
    void refreshWorkspaceOutputFiles();
  }, [directoryHandle, ready, view]);

  useEffect(() => {
    const handleLocaleChange = (event: Event) => {
      const next = (event as CustomEvent<Locale>).detail;
      if (next !== "zh" && next !== "en") return;
      setLocale(next);
      if (workspaceRecovery) return;
      setProject((current) => {
        const nextProject = syncProjectStage(localizeBuiltInProject(current, next));
        try { localStorage.setItem("cavwic-solution-workspace", JSON.stringify(nextProject)); } catch { /* The project directory remains the fallback. */ }
        return nextProject;
      });
    };
    window.addEventListener("cavwic-locale-change", handleLocaleChange);
    return () => window.removeEventListener("cavwic-locale-change", handleLocaleChange);
  }, [workspaceRecovery]);

  useEffect(() => {
    if (!ready || !returnState) return;
    const timer = window.setTimeout(() => {
      const anchor = returnState.anchorId ? document.getElementById(returnState.anchorId) : null;
      if (anchor) anchor.scrollIntoView({ block: "center" });
      else window.scrollTo({ top: returnState.scrollY });
      setReturnState(null);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [ready, returnState, view]);

  useEffect(() => {
    if (pendingModelAction || ocrChoiceSourceIds || projectPathRequired || outputPathRequired || workspaceRecovery) modelChoicePrimary.current?.focus();
  }, [ocrChoiceSourceIds, outputPathRequired, pendingModelAction, projectPathRequired, workspaceRecovery]);

  useEffect(() => {
    if (!ready || workspaceRecovery) return;
    try {
      localStorage.setItem("cavwic-solution-workspace", JSON.stringify({ ...project, updatedAt: new Date().toISOString() }));
      setNotice(t.saved);
      const timer = window.setTimeout(() => setNotice(""), 1100);
      return () => window.clearTimeout(timer);
    } catch {
      setNotice(locale === "zh" ? "项目缓存空间不足，请写入项目目录。" : "The local cache is full. Save the project to its folder.");
    }
  }, [project, locale, ready, t.saved, workspaceRecovery]);

  useEffect(() => {
    if (!ready || workspaceRecovery || !isUsableProjectDirectory(directoryHandle)) return;
    const timer = window.setTimeout(() => {
      void saveProjectStateToDirectory(directoryHandle, project, sourceFiles)
        .then(() => setNotice(t.projectPathSaved))
        .catch(() => setNotice(locale === "zh" ? "项目路径授权已失效，请重新选择。" : "Project folder access expired. Choose it again."));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [directoryHandle, locale, project, ready, sourceFiles, t.projectPathSaved, workspaceRecovery]);

  useEffect(() => {
    if (!ready || !filesHydrated || !sourceFiles.size) return;
    const timer = window.setTimeout(() => {
      void persistSourceFiles(project.id, sourceFiles).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filesHydrated, project.id, ready, sourceFiles]);

  const persistProjectSnapshot = (snapshot: ProjectManifest) => {
    try {
      localStorage.setItem("cavwic-solution-workspace", JSON.stringify(snapshot));
    } catch {
      // The authorized project directory remains the fallback when browser storage is full.
    }
  };
  const commitProject = (snapshot: ProjectManifest, historyGroup = "", trackHistory = true) => {
    const previous = projectRef.current;
    if (trackHistory && previous !== snapshot) recordHistory(previous, historyGroup);
    persistProjectSnapshot(snapshot);
    projectRef.current = snapshot;
    setProject(snapshot);
  };
  const updateProject = <K extends keyof ProjectManifest>(key: K, value: ProjectManifest[K], historyGroup = typeof value === "string" ? `project:${String(key)}` : "") => {
    const current = projectRef.current;
    const nextProject = syncProjectStage({ ...current, [key]: value, updatedAt: new Date().toISOString() });
    recordHistory(current, historyGroup);
    persistProjectSnapshot(nextProject);
    projectRef.current = nextProject;
    setProject(nextProject);
  };
  const patchHistoryGroup = (scope: string, patch: object) => Object.values(patch).every((value) => typeof value === "string")
    ? `${scope}:${Object.keys(patch).sort().join("+")}`
    : "";
  const updatePresalesRound = (id: string, patch: Partial<PresalesRound>) => {
    const current = projectRef.current;
    updateProject("presalesRounds", current.presalesRounds.map((item) => item.id === id ? { ...item, ...patch } : item), patchHistoryGroup(`presales:${id}`, patch));
  };
  const updateBidFile = (id: string, patch: Partial<BidFileChecklistItem>) => {
    const current = projectRef.current;
    updateProject("bidFileChecklist", current.bidFileChecklist.map((item) => item.id === id ? { ...item, ...patch } : item), patchHistoryGroup(`bid:${id}`, patch));
  };
  const updateHandover = (patch: Partial<ProjectManifest["handover"]>, historyGroup = patchHistoryGroup("handover", patch)) => {
    const current = projectRef.current;
    updateProject("handover", { ...current.handover, ...patch }, historyGroup);
  };
  const updateHandoverDepartment = (id: string, patch: Partial<HandoverDepartment>) => {
    const current = projectRef.current;
    updateHandover(
      { departments: current.handover.departments.map((item) => item.id === id ? { ...item, ...patch } : item) },
      patchHistoryGroup(`handover-department:${id}`, patch),
    );
  };
  const updateHandoverTask = (id: string, patch: Partial<HandoverTask>) => {
    const current = projectRef.current;
    updateHandover(
      { tasks: current.handover.tasks.map((item) => item.id === id ? { ...item, ...patch } : item) },
      patchHistoryGroup(`handover-task:${id}`, patch),
    );
  };
  const setTextFieldConfirmed = (fieldId: string, confirmed: boolean) => updateProject(
    "confirmedTextFields",
    confirmed
      ? [...new Set([...projectRef.current.confirmedTextFields, fieldId])]
      : projectRef.current.confirmedTextFields.filter((item) => item !== fieldId),
  );

  const requireProjectDirectory = () => {
    if (isUsableProjectDirectory(directoryHandle)) return true;
    setProjectPathRequired(true);
    return false;
  };

  const guardFileImport = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isUsableProjectDirectory(directoryHandle)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const fileLabel = target.closest("label");
    if (!fileLabel?.querySelector('input[type="file"]')) return;
    event.preventDefault();
    event.stopPropagation();
    setProjectPathRequired(true);
  };

  const openGuardedFilePicker = (input: HTMLInputElement | null) => {
    if (!requireProjectDirectory()) return;
    input?.click();
  };

  const uniqueImportedFileName = (relativeDirectory: string, originalName: string, pendingPaths: Set<string>) => {
    const usedPaths = new Set(projectRef.current.sources.map((source) => source.workspacePath).filter(Boolean));
    for (const path of pendingPaths) usedPaths.add(path);
    if (!usedPaths.has(`${relativeDirectory}/${originalName}`)) return originalName;
    const dot = originalName.lastIndexOf(".");
    const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
    const extension = dot > 0 ? originalName.slice(dot) : "";
    let index = 2;
    while (usedPaths.has(`${relativeDirectory}/${stem}(${index})${extension}`)) index += 1;
    return `${stem}(${index})${extension}`;
  };

  const prepareImportedSources = async (
    items: Array<{ source: SourceDocument; file: File }>,
    relativeDirectory: string,
  ) => {
    const nextFiles = new Map(sourceFilesRef.current);
    const addedSources: SourceDocument[] = [];
    const resolvedSources: SourceDocument[] = [];
    const filesToStore: File[] = [];
    const pendingPaths = new Set<string>();
    for (const item of items) {
      const duplicate = [...projectRef.current.sources, ...addedSources].find((source) => source.sha256 === item.source.sha256);
      if (duplicate) {
        resolvedSources.push(duplicate);
        continue;
      }
      const storedName = uniqueImportedFileName(relativeDirectory, item.file.name, pendingPaths);
      const storedFile = storedName === item.file.name
        ? item.file
        : new File([item.file], storedName, { type: item.file.type, lastModified: item.file.lastModified });
      const source: SourceDocument = {
        ...item.source,
        name: storedName,
        workspacePath: isUsableProjectDirectory(directoryHandle) ? `${relativeDirectory}/${storedName}` : "",
      };
      pendingPaths.add(`${relativeDirectory}/${storedName}`);
      addedSources.push(source);
      resolvedSources.push(source);
      filesToStore.push(storedFile);
      nextFiles.set(source.id, storedFile);
    }
    if (isUsableProjectDirectory(directoryHandle) && filesToStore.length) {
      await saveWorkspaceFilesToDirectory(directoryHandle, relativeDirectory, filesToStore);
    }
    return { addedSources, resolvedSources, nextFiles };
  };

  const saveExistingSourceNote = async (relativeDirectory: string, sources: SourceDocument[]) => {
    if (!isUsableProjectDirectory(directoryHandle)) return;
    const references = sources.filter((source) => !source.workspacePath.startsWith(`${relativeDirectory}/`));
    if (!references.length) return;
    await saveWorkspaceTextFiles(directoryHandle, relativeDirectory, [{ name: "说明文档.txt", content: sourceReferenceDocument(references) }]);
  };

  const workspaceSourcePath = (source: SourceDocument) => source.workspacePath || `projects/${projectRef.current.id}/sources/${source.name}`;

  const addPresalesRound = async () => {
    const current = projectRef.current;
    const roundIndex = current.presalesRounds.length;
    if (isUsableProjectDirectory(directoryHandle)) {
      try {
        await ensureWorkspaceDirectoryPath(directoryHandle, presalesRoundDirectory(roundIndex));
      } catch {
        setNotice(locale === "zh" ? "无法创建本轮沟通目录，请重新授权项目路径。" : "The communication folder could not be created. Reauthorize the project folder.");
        return;
      }
    }
    updateProject("presalesRounds", [...current.presalesRounds, createPresalesRound(locale, roundIndex + 1)]);
  };

  const addTenderClarificationRound = async () => {
    const current = projectRef.current;
    const roundIndex = current.tenderClarificationRounds.length;
    if (isUsableProjectDirectory(directoryHandle)) {
      try {
        await ensureWorkspaceDirectoryPath(directoryHandle, tenderClarificationDirectory(roundIndex));
      } catch {
        setNotice(locale === "zh" ? "无法创建澄清目录，请重新授权项目路径。" : "The clarification folder could not be created. Reauthorize the project folder.");
        return;
      }
    }
    updateProject("tenderClarificationRounds", [...current.tenderClarificationRounds, {
      id: createId("clarification"),
      title: locale === "zh" ? `第${chineseInteger(roundIndex + 1)}次澄清` : `Clarification ${roundIndex + 1}`,
      occurredAt: "",
      sourceIds: [],
      selectedSourceIds: [],
    }]);
  };

  const commitStructuralRemoval = async (detachedProject: ProjectManifest, candidateSourceIds: string[], onCommitted?: () => void) => {
    const removableIds = [...new Set(candidateSourceIds)].filter((sourceId) => !sourceIsReferenced(detachedProject, sourceId));
    const removableSet = new Set(removableIds);
    const nextProject = syncProjectStage({
      ...detachedProject,
      sources: detachedProject.sources.filter((source) => !removableSet.has(source.id)),
      updatedAt: new Date().toISOString(),
    });
    const nextFiles = new Map(sourceFilesRef.current);
    removableIds.forEach((sourceId) => nextFiles.delete(sourceId));
    setBusy(true);
    try {
      if (isUsableProjectDirectory(directoryHandle)) {
        await synchronizeProjectHistoryToDirectory(directoryHandle, projectRef.current, nextProject, nextFiles);
      }
      for (const sourceId of removableIds) await removePersistedSourceFile(projectRef.current.id, sourceId).catch(() => undefined);
      commitProject(nextProject);
      setSourceFiles(nextFiles);
      onCommitted?.();
    } catch {
      setNotice(locale === "zh" ? "目录或文件删除失败，项目内容未更改。" : "The folder or files could not be removed. The project was not changed.");
    } finally {
      setBusy(false);
    }
  };

  const removePresalesRound = async (round: PresalesRound) => {
    const candidateSourceIds = [
      ...round.requirementSourceIds,
      ...round.referenceSourceIds,
      ...round.templateSourceIds,
      ...round.actions.flatMap((action) => action.templateSourceIds),
      ...round.analysisResults.map((result) => result.sourceId),
      ...round.generatedFiles.map((file) => file.sourceId),
    ];
    await commitStructuralRemoval({
      ...projectRef.current,
      presalesRounds: projectRef.current.presalesRounds.filter((item) => item.id !== round.id),
    }, candidateSourceIds);
  };

  const removeTenderClarificationRound = async (roundId: string) => {
    const round = projectRef.current.tenderClarificationRounds.find((item) => item.id === roundId);
    if (!round) return;
    await commitStructuralRemoval({
      ...projectRef.current,
      tenderClarificationRounds: projectRef.current.tenderClarificationRounds.filter((item) => item.id !== roundId),
    }, round.sourceIds);
  };

  const removeBidChecklistItem = async (item: BidFileChecklistItem) => {
    await commitStructuralRemoval({
      ...projectRef.current,
      bidFileChecklist: projectRef.current.bidFileChecklist.filter((candidate) => candidate.id !== item.id),
    }, [
      ...item.templateSourceIds,
      ...item.referenceSourceIds,
      ...item.generatedFiles.map((file) => file.sourceId),
    ], () => {
      if (expandedBidFileId === item.id) setExpandedBidFileId("");
    });
  };

  const removeHandoverTask = async (task: HandoverTask) => {
    await commitStructuralRemoval({
      ...projectRef.current,
      handover: {
        ...projectRef.current.handover,
        tasks: projectRef.current.handover.tasks.filter((candidate) => candidate.id !== task.id),
      },
    }, task.responseSourceIds, () => {
      if (expandedHandoverTaskId === task.id) setExpandedHandoverTaskId("");
    });
  };

  const importTenderFiles = async (files: FileList | null, target: { kind: "tender" } | { kind: "clarification"; roundId: string } | { kind: "analysis-template" | "comparison-template" }) => {
    if (!files?.length) return;
    setBusy(true);
    setNotice(`${t.parsing}…`);
    try {
      const parsed: Array<{ source: SourceDocument; file: File }> = [];
      for (const file of Array.from(files)) {
        const templateImport = target.kind === "analysis-template" || target.kind === "comparison-template";
        const templateFormat = tenderTemplateFileFormat(file.name);
        if (templateImport && !templateFormat) throw new Error("UNSUPPORTED_TEMPLATE_FORMAT");
        const rawSource = templateImport
          ? await createFormatOnlyTemplateSource(file, templateFormat as GeneralTemplateFormat | "md")
          : await parseSourceFile(file);
        const automaticallyPrepared = target.kind !== "tender" && hasReadableSourceText(rawSource);
        const source: SourceDocument = automaticallyPrepared ? {
          ...rawSource,
          preprocessStatus: "ready",
          preprocessedAt: new Date().toISOString(),
          preprocessMessage: locale === "zh" ? "上传并预处理完成" : "Uploaded and preprocessed",
        } : rawSource;
        parsed.push({ source, file });
      }
      const clarificationIndex = target.kind === "clarification"
        ? Math.max(0, project.tenderClarificationRounds.findIndex((round) => round.id === target.roundId))
        : 0;
      const relativeDirectory = target.kind === "tender"
        ? `${WORKSPACE_MODULE_DIRECTORIES.tenderFiles}/导入文件`
        : target.kind === "clarification"
          ? `${tenderClarificationDirectory(clarificationIndex)}/导入文件`
          : target.kind === "analysis-template"
            ? `${WORKSPACE_MODULE_DIRECTORIES.tenderAnalysis}/导入文件/模板文件`
            : `${WORKSPACE_MODULE_DIRECTORIES.tenderComparison}/导入文件/模板文件`;
      const prepared = await prepareImportedSources(parsed, relativeDirectory);
      const sourceIds = prepared.resolvedSources.map((source) => source.id);
      let nextProject: ProjectManifest = { ...project, sources: [...project.sources, ...prepared.addedSources], updatedAt: new Date().toISOString() };
      if (target.kind === "tender") nextProject = {
        ...nextProject,
        tenderSourceIds: [...new Set([...project.tenderSourceIds, ...sourceIds])],
        selectedTenderSourceIds: [...new Set([...project.selectedTenderSourceIds, ...sourceIds])],
      };
      else if (target.kind === "clarification") nextProject = {
        ...nextProject,
        tenderClarificationRounds: project.tenderClarificationRounds.map((round) => round.id === target.roundId ? {
          ...round,
          sourceIds: [...new Set([...round.sourceIds, ...sourceIds])],
          selectedSourceIds: [...new Set([...round.selectedSourceIds, ...sourceIds])],
        } : round),
      };
      else if (target.kind === "analysis-template") nextProject = { ...nextProject, tenderAnalysis: { ...project.tenderAnalysis, templateSourceIds: [...new Set([...project.tenderAnalysis.templateSourceIds, ...sourceIds])] } };
      else nextProject = { ...nextProject, tenderComparison: { ...project.tenderComparison, templateSourceIds: [...new Set([...project.tenderComparison.templateSourceIds, ...sourceIds])] } };
      nextProject = syncProjectStage(nextProject);
      commitProject(nextProject);
      setSourceFiles(prepared.nextFiles);
      setSelectedSourceId(prepared.resolvedSources[0]?.id || "");
      await persistSourceFiles(project.id, new Map(prepared.addedSources.map((source) => [source.id, prepared.nextFiles.get(source.id) as File]))).catch(() => undefined);
      if (directoryHandle) {
        await saveExistingSourceNote(relativeDirectory, prepared.resolvedSources);
        await saveProjectStateToDirectory(directoryHandle, nextProject, prepared.nextFiles);
      }
      setNotice(locale === "zh" ? `${prepared.resolvedSources.length} 个文件已导入。` : `${prepared.resolvedSources.length} file(s) imported.`);
    } catch {
      setNotice(t.invalid);
    } finally {
      setBusy(false);
      if (sourceInput.current) sourceInput.current.value = "";
    }
  };

  const importPresalesFiles = async (files: FileList | null, target: { kind: "requirements" | "references" | "templates"; roundId: string } | { kind: "action-templates"; roundId: string; actionId: string }) => {
    if (!files?.length) return;
    setBusy(true);
    setNotice(`${t.parsing}…`);
    try {
      const parsed: Array<{ source: SourceDocument; file: File }> = [];
      for (const file of Array.from(files)) {
        const templateImport = target.kind === "templates" || target.kind === "action-templates";
        const templateFormat = templateFileFormat(file.name);
        if (templateImport && !templateFormat) throw new Error("UNSUPPORTED_TEMPLATE_FORMAT");
        const source = templateImport
          ? await createFormatOnlyTemplateSource(file, templateFormat as GeneralTemplateFormat | "md")
          : await parseSourceFile(file);
        parsed.push({ source, file });
      }
      const roundIndex = Math.max(0, project.presalesRounds.findIndex((round) => round.id === target.roundId));
      const roundDirectory = presalesRoundDirectory(roundIndex);
      const relativeDirectory = target.kind === "requirements"
        ? `${roundDirectory}/客户附件`
        : target.kind === "references"
          ? `${roundDirectory}/参考文件`
          : target.kind === "templates"
            ? `${roundDirectory}/补充文件/需求分析模板`
            : `${roundDirectory}/补充文件/响应文件模板`;
      const prepared = await prepareImportedSources(parsed, relativeDirectory);
      const sourceIds = prepared.resolvedSources.map((source) => source.id);
      const nextProject = syncProjectStage({
        ...project,
        sources: [...project.sources, ...prepared.addedSources],
        presalesRounds: project.presalesRounds.map((round) => {
          if (round.id !== target.roundId) return round;
          if (target.kind === "requirements") return {
            ...round,
            requirementSourceIds: [...new Set([...round.requirementSourceIds, ...sourceIds])],
            selectedRequirementSourceIds: [...new Set([...selectedCustomerSourceIds(round), ...sourceIds])],
          };
          if (target.kind === "templates") return {
            ...round,
            templateSourceIds: [...new Set([...round.templateSourceIds, ...sourceIds])],
          };
          if (target.kind === "action-templates") return {
            ...round,
            actions: round.actions.map((action) => action.id === target.actionId ? {
              ...action,
              templateSourceIds: [...new Set([...action.templateSourceIds, ...sourceIds])],
            } : action),
          };
          return {
            ...round,
            referenceSourceIds: [...new Set([...round.referenceSourceIds, ...sourceIds])],
          };
        }),
        updatedAt: new Date().toISOString(),
      } as ProjectManifest);
      commitProject(nextProject);
      setSourceFiles(prepared.nextFiles);
      await persistSourceFiles(project.id, new Map(prepared.addedSources.map((source) => [source.id, prepared.nextFiles.get(source.id) as File]))).catch(() => undefined);
      await saveExistingSourceNote(relativeDirectory, prepared.resolvedSources);
      if (directoryHandle) await saveProjectStateToDirectory(directoryHandle, nextProject, prepared.nextFiles);
      setNotice(locale === "zh" ? `${prepared.resolvedSources.length} 个文件已导入。` : `${prepared.resolvedSources.length} file(s) imported.`);
    } catch {
      setNotice(t.invalid);
    } finally {
      setBusy(false);
    }
  };

  const toggleCustomerSource = (round: PresalesRound, sourceId: string, checked: boolean) => {
    const selected = selectedCustomerSourceIds(round);
    updatePresalesRound(round.id, {
      selectedRequirementSourceIds: checked ? [...new Set([...selected, sourceId])] : selected.filter((id) => id !== sourceId),
    });
  };

  const selectAllCustomerSources = (round: PresalesRound, checked: boolean) => updatePresalesRound(round.id, {
    selectedRequirementSourceIds: checked ? [...round.requirementSourceIds] : [],
  });

  const removePresalesSource = async (round: PresalesRound, sourceId: string, kind: "requirements" | "templates" | "action-templates", actionId?: string) => {
    const source = project.sources.find((item) => item.id === sourceId);
    const nextRounds = project.presalesRounds.map((item) => {
      if (item.id !== round.id) return item;
      if (kind === "requirements") return {
        ...item,
        requirementSourceIds: item.requirementSourceIds.filter((id) => id !== sourceId),
        selectedRequirementSourceIds: selectedCustomerSourceIds(item).filter((id) => id !== sourceId),
      };
      if (kind === "action-templates") return {
        ...item,
        actions: item.actions.map((action) => action.id === actionId ? {
          ...action,
          templateSourceIds: action.templateSourceIds.filter((id) => id !== sourceId),
          selectedTemplateSourceIds: action.selectedTemplateSourceIds.filter((id) => id !== sourceId),
        } : action),
      };
      return {
        ...item,
        templateSourceIds: item.templateSourceIds.filter((id) => id !== sourceId),
        selectedTemplateSourceIds: item.selectedTemplateSourceIds.filter((id) => id !== sourceId),
      };
    });
    const detachedProject = syncProjectStage({ ...project, presalesRounds: nextRounds, updatedAt: new Date().toISOString() });
    const removeSource = !sourceIsReferenced(detachedProject, sourceId);
    const nextProject = removeSource ? { ...detachedProject, sources: detachedProject.sources.filter((item) => item.id !== sourceId) } : detachedProject;
    const nextFiles = new Map(sourceFiles);
    if (removeSource) nextFiles.delete(sourceId);
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    if (directoryHandle) {
      if (removeSource && source) await removeWorkspaceFileFromRelativePath(directoryHandle, workspaceSourcePath(source)).catch(() => undefined);
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
      await synchronizeDerivedWorkspaceArtifacts(directoryHandle, nextProject).catch(() => undefined);
    }
  };

  const addAnalysisKeyword = (round: PresalesRound, value: string) => {
    const keyword = value.trim();
    if (!keyword || round.keywords.includes(keyword)) return;
    updatePresalesRound(round.id, { keywords: [...round.keywords, keyword] });
    setKeywordDrafts((current) => ({ ...current, [round.id]: "" }));
  };

  const alertTemplateMismatch = (sourceName: string, format: ResponseFileFormat) => {
    const target = format === "docx" ? "Word" : format === "pptx" ? "PPT" : "Markdown";
    window.alert(locale === "zh"
      ? `模板“${sourceName}”与 ${target} 输出格式不匹配，请更换模板或输出格式。`
      : `Template “${sourceName}” does not match the ${target} output format. Choose another template or output format.`);
  };

  const toggleAnalysisTemplate = (round: PresalesRound, sourceId: string) => {
    const selected = round.selectedTemplateSourceIds.includes(sourceId);
    if (!selected && round.analysisOutputFormat) {
      const source = project.sources.find((item) => item.id === sourceId);
      if (source && templateFileFormat(source.name) !== round.analysisOutputFormat) {
        alertTemplateMismatch(source.name, round.analysisOutputFormat);
        return;
      }
    }
    updatePresalesRound(round.id, {
      selectedTemplateSourceIds: selected
        ? round.selectedTemplateSourceIds.filter((id) => id !== sourceId)
        : [...round.selectedTemplateSourceIds, sourceId],
    });
  };

  const setAnalysisOutputFormat = (round: PresalesRound, format: ResponseFileFormat | "") => {
    if (format) {
      const mismatch = round.selectedTemplateSourceIds
        .map((id) => project.sources.find((source) => source.id === id))
        .find((source) => source && templateFileFormat(source.name) !== format);
      if (mismatch) {
        alertTemplateMismatch(mismatch.name, format);
        return;
      }
    }
    updatePresalesRound(round.id, { analysisOutputFormat: format || undefined });
  };

  const toggleActionTemplate = (round: PresalesRound, action: PresalesRoundAction, sourceId: string) => {
    const selected = action.selectedTemplateSourceIds.includes(sourceId);
    if (!selected && action.responseFileFormat) {
      const source = project.sources.find((item) => item.id === sourceId);
      if (source && templateFileFormat(source.name) !== action.responseFileFormat) {
        alertTemplateMismatch(source.name, action.responseFileFormat);
        return;
      }
    }
    updateRoundAction(round, action.id, {
      selectedTemplateSourceIds: selected
        ? action.selectedTemplateSourceIds.filter((id) => id !== sourceId)
        : [...action.selectedTemplateSourceIds, sourceId],
    });
  };

  const setActionResponseFormat = (round: PresalesRound, action: PresalesRoundAction, format: ResponseFileFormat | "") => {
    if (format) {
      const mismatch = action.selectedTemplateSourceIds
        .map((id) => project.sources.find((source) => source.id === id))
        .find((source) => source && templateFileFormat(source.name) !== format);
      if (mismatch) {
        alertTemplateMismatch(mismatch.name, format);
        return;
      }
    }
    updateRoundAction(round, action.id, { responseFileFormat: format || undefined });
  };

  const addRoundParticipant = (round: PresalesRound) => {
    const draft = participantDrafts[round.id] || { name: "", category: "customer" as const };
    const name = draft.name.trim();
    if (!name || round.participants.some((participant) => participant.category === draft.category && participant.name === name)) return;
    updatePresalesRound(round.id, {
      participants: [...round.participants, { id: createId("participant"), name, category: draft.category }],
    });
    setParticipantDrafts((current) => ({ ...current, [round.id]: { ...draft, name: "" } }));
  };

  const addRoundAction = (round: PresalesRound) => {
    const action: PresalesRoundAction = {
      id: createId("round-action"),
      title: "",
      owner: "",
      dueDate: "",
      status: "open",
      responseFileName: "",
      fileRequirements: "",
      templateSourceIds: [],
      selectedTemplateSourceIds: [],
    };
    updatePresalesRound(round.id, { actions: [...round.actions, action] });
  };

  const updateRoundAction = (round: PresalesRound, actionId: string, patch: Partial<PresalesRoundAction>) => updatePresalesRound(round.id, {
    actions: round.actions.map((action) => action.id === actionId ? { ...action, ...patch } : action),
  });

  const checkedActions = (round: PresalesRound) => round.actions.filter((action) => selectedActionIds.has(action.id));

  const setActionSelected = (actionId: string, checked: boolean) => setSelectedActionIds((current) => {
    const next = new Set(current);
    if (checked) next.add(actionId);
    else next.delete(actionId);
    return next;
  });

  const setRoundActionsSelected = (round: PresalesRound, checked: boolean) => setSelectedActionIds((current) => {
    const next = new Set(current);
    round.actions.forEach((action) => checked ? next.add(action.id) : next.delete(action.id));
    return next;
  });

  const validateResponseActions = (round: PresalesRound, actions: PresalesRoundAction[]) => {
    if (!actions.length) {
      setNotice(locale === "zh" ? "请先勾选需要处理的响应文件。" : "Select at least one response file first.");
      return false;
    }
    const incomplete = actions.find((action) => {
      const target = getActionResponseTarget(round, action);
      return !target.name || !target.format;
    });
    if (incomplete) {
      setNotice(locale === "zh" ? "请先填写响应文件名称并选择文件格式。" : "Enter a response file name and select its format first.");
      return false;
    }
    return true;
  };

  const generatePresalesTasks = async (round: PresalesRound, actions: PresalesRoundAction[]) => {
    if (!validateResponseActions(round, actions)) return;
    setGeneratingActionId(actions.length === 1 ? `task-${actions[0].id}` : `batch-task-${round.id}`);
    setBusy(true);
    try {
      const tasks = actions.map((action) => {
        const target = getActionResponseTarget(round, action);
        const templates = target.format ? resolvedTemplateSources(target.format, action.selectedTemplateSourceIds) : [];
        return buildCodexPresalesTask(project, round, action, locale, templates);
      });
      if (supportsDirectoryAccess()) {
        const outputDirectory = await chooseTaskOutputDirectory(directoryHandle);
        for (const task of tasks) await saveTaskFileToDirectory(outputDirectory, task.name, task.content);
        setNotice(locale === "zh" ? `${tasks.length} 个独立任务文件已保存到“${outputDirectory.name}”。` : `${tasks.length} separate task file(s) saved to “${outputDirectory.name}”.`);
      } else {
        tasks.forEach((task) => downloadText(task.name, task.content, "text/markdown;charset=utf-8"));
        setNotice(locale === "zh" ? `${tasks.length} 个独立任务文件已下载。` : `${tasks.length} separate task file(s) downloaded.`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setNotice(locale === "zh" ? "已取消保存任务。" : "Task saving cancelled.");
      else setNotice(locale === "zh" ? "任务文件保存失败，请重新选择可写目录。" : "Task files could not be saved. Select a writable folder and try again.");
    } finally {
      setBusy(false);
      setGeneratingActionId("");
    }
  };

  const configuredModel = (task: ModelTask = "draft"): ModelInvocation | null => {
    const currentSettings = readModelSettings();
    const currentApiKey = readModelApiKey();
    if (hasBrowserCallableModel(currentSettings, task)) return { settings: currentSettings, apiKey: currentApiKey };
    return null;
  };

  const selectedClarificationSourceIds = () => project.tenderClarificationRounds.flatMap((round) => round.selectedSourceIds);

  const resolveSourceFile = async (source: SourceDocument): Promise<File | null> => {
    const current = sourceFiles.get(source.id);
    if (current) return current;
    if (!directoryHandle) return null;
    return readWorkspaceFileFromRelativePath(directoryHandle, workspaceSourcePath(source)).catch(() => null);
  };

  const resolvedTemplateSources = (format: TenderOutputFormat, specificIds: string[]): SourceDocument[] => {
    return resolveFormatTemplateSources(project, format, specificIds);
  };

  const resolvePrimaryTemplateFile = async (templates: SourceDocument[]): Promise<File | undefined> => {
    if (!templates[0]) return undefined;
    return (await resolveSourceFile(templates[0])) || undefined;
  };

  const uploadGeneralTemplate = async (format: GeneralTemplateFormat, file?: File) => {
    if (!file) return;
    if (tenderTemplateFileFormat(file.name) !== format) {
      alertBidTemplateMismatch(file.name, format);
      return;
    }
    setBusy(true);
    try {
      const rawSource = await createFormatOnlyTemplateSource(file, format);
      const formatFolder = format === "docx" ? "Word" : format === "xlsx" ? "Excel" : "PPT";
      const templateDirectory = `${WORKSPACE_MODULE_DIRECTORIES.generalTemplates}/${formatFolder}`;
      const source: SourceDocument = {
        ...rawSource,
        workspacePath: isUsableProjectDirectory(directoryHandle) ? `${templateDirectory}/${file.name}` : "",
      };
      const key = `${format}SourceId` as const;
      const previousId = project.generalTemplates[key];
      const previousSource = project.sources.find((candidate) => candidate.id === previousId);
      const withTemplate = syncProjectStage({
        ...project,
        generalTemplates: { ...project.generalTemplates, [key]: source.id },
        sources: [...project.sources, source],
        updatedAt: new Date().toISOString(),
      });
      const removePrevious = previousId && !sourceIsReferenced(withTemplate, previousId);
      const nextProject = removePrevious
        ? { ...withTemplate, sources: withTemplate.sources.filter((candidate) => candidate.id !== previousId) }
        : withTemplate;
      const nextFiles = new Map(sourceFiles).set(source.id, file);
      if (removePrevious) nextFiles.delete(previousId);
      commitProject(nextProject);
      setSourceFiles(nextFiles);
      await persistSourceFiles(project.id, new Map([[source.id, file]])).catch(() => undefined);
      if (removePrevious) await removePersistedSourceFile(project.id, previousId).catch(() => undefined);
      if (directoryHandle) {
        if (removePrevious && previousSource) {
          await removeWorkspaceFileFromRelativePath(directoryHandle, workspaceSourcePath(previousSource)).catch(() => undefined);
          await removeWorkspaceFileFromRelativePath(directoryHandle, `projects/${project.id}/templates/general/${previousSource.name}`).catch(() => undefined);
        }
        await saveWorkspaceFilesToDirectory(directoryHandle, templateDirectory, [file]);
        await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles);
      }
      setNotice(locale === "zh" ? `${format.toUpperCase()} 通用格式模板已保存。` : `${format.toUpperCase()} general format template saved.`);
    } catch {
      setNotice(locale === "zh" ? "通用模板上传失败，请检查文件格式。" : "General template upload failed. Check the file format.");
    } finally {
      setBusy(false);
    }
  };

  const removeGeneralTemplate = async (format: GeneralTemplateFormat) => {
    const key = `${format}SourceId` as const;
    const sourceId = project.generalTemplates[key];
    if (!sourceId) return;
    const source = project.sources.find((candidate) => candidate.id === sourceId);
    const detached = syncProjectStage({
      ...project,
      generalTemplates: { ...project.generalTemplates, [key]: "" },
      updatedAt: new Date().toISOString(),
    });
    const removeSource = !sourceIsReferenced(detached, sourceId);
    const nextProject = removeSource ? { ...detached, sources: detached.sources.filter((candidate) => candidate.id !== sourceId) } : detached;
    const nextFiles = new Map(sourceFiles);
    if (removeSource) nextFiles.delete(sourceId);
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    if (removeSource) await removePersistedSourceFile(project.id, sourceId).catch(() => undefined);
    if (directoryHandle && source) {
      if (removeSource) await removeWorkspaceFileFromRelativePath(directoryHandle, workspaceSourcePath(source)).catch(() => undefined);
      await removeWorkspaceFileFromRelativePath(directoryHandle, `projects/${project.id}/templates/general/${source.name}`).catch(() => undefined);
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
    }
  };

  const openSourceFile = async (source: SourceDocument) => {
    try {
      const file = await resolveSourceFile(source);
      if (!file) throw new Error("FILE_NOT_AVAILABLE");
      await openFilePreview(file, source.name);
    } catch {
      setNotice(locale === "zh" ? "本机缓存中找不到原始文件，请重新导入或选择项目路径。" : "The original file is unavailable. Import it again or select the project folder.");
    }
  };

  const preprocessTenderSources = (sourceIds: string[]) => {
    const targetIds = sourceIds.filter((id) => project.sources.some((source) => source.id === id && source.preprocessStatus !== "ready"));
    if (!targetIds.length) return;
    const needsOcr: string[] = [];
    const now = new Date().toISOString();
    const nextProject = syncProjectStage({
      ...project,
      sources: project.sources.map((source) => {
        if (!targetIds.includes(source.id)) return source;
        if (hasReadableSourceText(source)) return { ...source, requiresOcr: false, preprocessStatus: "ready" as const, preprocessedAt: now, preprocessMessage: locale === "zh" ? "上传并预处理完成" : "Uploaded and preprocessed" };
        needsOcr.push(source.id);
        return { ...source, requiresOcr: true, preprocessStatus: "needs-ocr" as const, preprocessMessage: locale === "zh" ? "存在无法识别内容" : "Unrecognized content detected" };
      }),
      updatedAt: now,
    });
    commitProject(nextProject);
    if (needsOcr.length) setOcrChoiceSourceIds(needsOcr);
    else setNotice(locale === "zh" ? "所选文件预处理完成。" : "Selected files were preprocessed.");
  };

  const skipTenderOcr = () => {
    const sourceIds = ocrChoiceSourceIds || [];
    setOcrChoiceSourceIds(null);
    const nextProject = syncProjectStage({
      ...project,
      sources: project.sources.map((source) => sourceIds.includes(source.id) ? { ...source, preprocessStatus: "skipped", preprocessMessage: locale === "zh" ? "仅上传，未处理" : "Uploaded only, not processed" } : source),
      updatedAt: new Date().toISOString(),
    });
    commitProject(nextProject);
  };

  const performTenderOcr = async (sourceIds: string[], invocation: ModelInvocation) => {
    if (!sourceIds.length) return;
    setBusy(true);
    let nextProject = project;
    let completed = 0;
    for (const sourceId of sourceIds) {
      const source = nextProject.sources.find((item) => item.id === sourceId);
      if (!source) continue;
      setOcrProgress((current) => ({ ...current, [sourceId]: 2 }));
      nextProject = { ...nextProject, sources: nextProject.sources.map((item) => item.id === sourceId ? { ...item, preprocessStatus: "processing", preprocessMessage: locale === "zh" ? "正在识别" : "Recognizing" } : item) };
      nextProject = syncProjectStage(nextProject);
      commitProject(nextProject);
      try {
        const file = await resolveSourceFile(source);
        if (!file) throw new Error("SOURCE_FILE_UNAVAILABLE");
        const segments = await requestOcrRecognition(invocation.settings, invocation.apiKey, file, (progress) => setOcrProgress((current) => ({ ...current, [sourceId]: progress })));
        const now = new Date().toISOString();
        nextProject = syncProjectStage({
          ...nextProject,
          sources: nextProject.sources.map((item) => item.id === sourceId ? {
            ...item,
            segments: segments.map((segment, index) => ({ ...segment, id: `${sourceId}-ocr-${index + 1}` })),
            requiresOcr: false,
            preprocessStatus: "ready",
            preprocessedAt: now,
            preprocessMessage: locale === "zh" ? "上传并预处理完成" : "Uploaded and preprocessed",
          } : item),
          updatedAt: now,
        });
        completed += 1;
      } catch {
        nextProject = syncProjectStage({
          ...nextProject,
          sources: nextProject.sources.map((item) => item.id === sourceId ? { ...item, preprocessStatus: "failed", preprocessMessage: locale === "zh" ? "识别失败，请检查模型是否支持视觉识别或将文件转换为图片/PDF" : "Recognition failed. Check vision support or convert the file to an image/PDF." } : item),
          updatedAt: new Date().toISOString(),
        });
      }
      commitProject(nextProject);
      if (directoryHandle) await saveProjectStateToDirectory(directoryHandle, nextProject, sourceFiles).catch(() => undefined);
    }
    setOcrProgress((current) => { const next = { ...current }; sourceIds.forEach((id) => delete next[id]); return next; });
    setBusy(false);
    if (completed) window.alert(locale === "zh" ? "识别完成" : "Recognition complete");
    if (completed !== sourceIds.length) setNotice(locale === "zh" ? `${completed} 个文件识别完成，${sourceIds.length - completed} 个文件未完成。` : `${completed} file(s) recognized; ${sourceIds.length - completed} incomplete.`);
  };

  const confirmTenderOcr = () => {
    const sourceIds = ocrChoiceSourceIds || [];
    setOcrChoiceSourceIds(null);
    const invocation = configuredModel("ocr");
    if (invocation) {
      void performTenderOcr(sourceIds, invocation);
      return;
    }
    setPendingModelAction({ kind: "tender-ocr", sourceIds, anchorId: "tender-files" });
  };

  const toggleTenderTemplate = (kind: "analysis" | "comparison", sourceId: string) => {
    const config = kind === "analysis" ? project.tenderAnalysis : project.tenderComparison;
    const selected = config.selectedTemplateSourceIds.includes(sourceId);
    if (!selected && config.outputFormat) {
      const source = project.sources.find((item) => item.id === sourceId);
      if (source && tenderTemplateFileFormat(source.name) !== config.outputFormat) {
        const target = config.outputFormat === "docx" ? "Word" : config.outputFormat === "pptx" ? "PPT" : config.outputFormat === "xlsx" ? "Excel" : "Markdown";
        window.alert(locale === "zh" ? `模板“${source.name}”与 ${target} 输出格式不匹配。` : `Template “${source.name}” does not match ${target}.`);
        return;
      }
    }
    const selectedTemplateSourceIds = selected ? config.selectedTemplateSourceIds.filter((id) => id !== sourceId) : [...config.selectedTemplateSourceIds, sourceId];
    if (kind === "analysis") updateProject("tenderAnalysis", { ...project.tenderAnalysis, selectedTemplateSourceIds });
    else updateProject("tenderComparison", { ...project.tenderComparison, selectedTemplateSourceIds });
  };

  const setTenderOutputFormat = (kind: "analysis" | "comparison", format: TenderOutputFormat | "") => {
    const config = kind === "analysis" ? project.tenderAnalysis : project.tenderComparison;
    if (format) {
      const mismatch = config.selectedTemplateSourceIds.map((id) => project.sources.find((source) => source.id === id)).find((source) => source && tenderTemplateFileFormat(source.name) !== format);
      if (mismatch) {
        const target = format === "docx" ? "Word" : format === "pptx" ? "PPT" : format === "xlsx" ? "Excel" : "Markdown";
        window.alert(locale === "zh" ? `模板“${mismatch.name}”与 ${target} 输出格式不匹配。` : `Template “${mismatch.name}” does not match ${target}.`);
        return;
      }
    }
    if (kind === "analysis") updateProject("tenderAnalysis", { ...project.tenderAnalysis, outputFormat: format || undefined });
    else updateProject("tenderComparison", { ...project.tenderComparison, outputFormat: format || undefined });
  };

  const removeTenderSources = async (sourceIds: string[]) => {
    if (!sourceIds.length) return;
    const sourceIdSet = new Set(sourceIds);
    const detached = syncProjectStage({
      ...project,
      tenderSourceIds: project.tenderSourceIds.filter((id) => !sourceIdSet.has(id)),
      selectedTenderSourceIds: project.selectedTenderSourceIds.filter((id) => !sourceIdSet.has(id)),
      tenderClarificationRounds: project.tenderClarificationRounds.map((round) => ({ ...round, sourceIds: round.sourceIds.filter((id) => !sourceIdSet.has(id)), selectedSourceIds: round.selectedSourceIds.filter((id) => !sourceIdSet.has(id)) })),
      tenderAnalysis: { ...project.tenderAnalysis, templateSourceIds: project.tenderAnalysis.templateSourceIds.filter((id) => !sourceIdSet.has(id)), selectedTemplateSourceIds: project.tenderAnalysis.selectedTemplateSourceIds.filter((id) => !sourceIdSet.has(id)) },
      tenderComparison: { ...project.tenderComparison, templateSourceIds: project.tenderComparison.templateSourceIds.filter((id) => !sourceIdSet.has(id)), selectedTemplateSourceIds: project.tenderComparison.selectedTemplateSourceIds.filter((id) => !sourceIdSet.has(id)), selectedPresalesSourceIds: project.tenderComparison.selectedPresalesSourceIds.filter((id) => !sourceIdSet.has(id)) },
      requirements: project.requirements.filter((requirement) => !requirement.sourceRef || !sourceIdSet.has(requirement.sourceRef.documentId)),
      updatedAt: new Date().toISOString(),
    });
    const removableIds = sourceIds.filter((id) => !sourceIsReferenced(detached, id));
    const removableSet = new Set(removableIds);
    const nextProject = { ...detached, sources: detached.sources.filter((source) => !removableSet.has(source.id)) };
    const nextFiles = new Map(sourceFiles);
    removableIds.forEach((id) => nextFiles.delete(id));
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    if (sourceIdSet.has(expandedTenderSourceId)) setExpandedTenderSourceId("");
    for (const id of removableIds) {
      const source = project.sources.find((item) => item.id === id);
      await removePersistedSourceFile(project.id, id).catch(() => undefined);
      if (directoryHandle && source) await removeWorkspaceFileFromRelativePath(directoryHandle, workspaceSourcePath(source)).catch(() => undefined);
    }
    if (directoryHandle) {
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
      await synchronizeDerivedWorkspaceArtifacts(directoryHandle, nextProject).catch(() => undefined);
    }
  };

  const tenderAnalysisInputs = (kind: "analysis" | "comparison") => {
    const tenderSources = project.selectedTenderSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    const clarificationSources = selectedClarificationSourceIds().map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    const incomplete = [...tenderSources, ...clarificationSources].find((source) => source.preprocessStatus !== "ready");
    if (!tenderSources.length) {
      window.alert(locale === "zh" ? "请先选择至少一个招标文件。" : "Select at least one tender file.");
      return null;
    }
    if (incomplete) {
      window.alert(locale === "zh" ? `文件“${incomplete.name}”尚未完成预处理。` : `File “${incomplete.name}” has not been preprocessed.`);
      return null;
    }
    if (kind === "analysis") {
      if (!project.tenderAnalysis.outputFormat) {
        window.alert(locale === "zh" ? "请先选择招标要求分析的文件格式。" : "Select an output format for tender analysis.");
        return null;
      }
      const templates = resolvedTemplateSources(project.tenderAnalysis.outputFormat, project.tenderAnalysis.selectedTemplateSourceIds);
      return { tenderSources, clarificationSources, presalesSources: [] as SourceDocument[], templates, outputFormat: project.tenderAnalysis.outputFormat };
    }
    const presalesSources = project.tenderComparison.selectedPresalesSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    if (!presalesSources.length) {
      window.alert(locale === "zh" ? "请先选择至少一个售前文件。" : "Select at least one presales file.");
      return null;
    }
    if (!project.tenderComparison.outputFormat) {
      window.alert(locale === "zh" ? "请先选择对比结果的文件格式。" : "Select an output format for the comparison.");
      return null;
    }
    const templates = resolvedTemplateSources(project.tenderComparison.outputFormat, project.tenderComparison.selectedTemplateSourceIds);
    return { tenderSources, clarificationSources, presalesSources, templates, outputFormat: project.tenderComparison.outputFormat };
  };

  const nextTenderResultName = (kind: "analysis" | "comparison") => {
    const baseName = kind === "analysis"
      ? analysisResultBaseName(project.tenderAnalysis.keywords, locale)
      : (locale === "zh" ? "售前与招标对比结果" : "Presales and tender comparison");
    const results = kind === "analysis" ? project.tenderAnalysis.results : project.tenderComparison.results;
    if (!results.some((result) => result.name === baseName)) return baseName;
    let sequence = 2;
    while (results.some((result) => result.name === `${baseName}-${sequence}`)) sequence += 1;
    return `${baseName}-${sequence}`;
  };

  const createTenderRequirements = (data: ReturnType<typeof extractTenderStructuredData>["data"], sources: SourceDocument[]) => data.requirements.map((item) => {
    const source = sources.find((candidate) => candidate.name === item.sourceName) || sources[0];
    const segment = source?.segments.find((candidate) => candidate.locator === item.locator || (item.originalText && candidate.text.includes(item.originalText.slice(0, 32)))) || source?.segments[0];
    return createRequirement("tender", {
      title: item.title,
      category: item.category,
      originalText: item.originalText,
      normalizedText: item.normalizedText || item.originalText || item.title,
      mandatory: item.mandatory,
      scored: item.scored,
      dueDate: item.dueDate,
      sourceRef: source && segment ? { documentId: source.id, segmentId: segment.id, locator: segment.locator, excerpt: (item.originalText || segment.text).slice(0, 240) } : null,
    }, locale);
  });

  const runTenderAnalysis = async (kind: "analysis" | "comparison", invocation: ModelInvocation) => {
    const inputs = tenderAnalysisInputs(kind);
    if (!inputs) return;
    setBusy(true);
    setGeneratingActionId(kind === "analysis" ? "tender-analysis" : "tender-comparison");
    try {
      const prompt = kind === "analysis"
        ? buildTenderAnalysisPrompt(project, inputs.tenderSources, inputs.clarificationSources, inputs.templates, locale)
        : buildTenderComparisonPrompt(project, inputs.presalesSources, inputs.tenderSources, inputs.clarificationSources, inputs.templates, locale);
      const draft = await requestPresalesDraft(invocation.settings, invocation.apiKey, prompt, undefined, "analysis");
      const extracted = extractTenderStructuredData(draft.content);
      const resultName = nextTenderResultName(kind);
      const templateFile = await resolvePrimaryTemplateFile(inputs.templates);
      const generated = await createTenderGeneratedFile(extracted.content, resultName, inputs.outputFormat, templateFile);
      const generatedFile = new File([generated.blob], generated.name, { type: generated.blob.type });
      const parsedOutput = await parseSourceFile(generatedFile);
      const outputDirectory = `${kind === "analysis" ? WORKSPACE_MODULE_DIRECTORIES.tenderAnalysis : WORKSPACE_MODULE_DIRECTORIES.tenderComparison}/生成文件`;
      const relativePath = isUsableProjectDirectory(directoryHandle)
        ? `${outputDirectory}/${generated.name}`
        : `downloads/${generated.name}`;
      if (isUsableProjectDirectory(directoryHandle)) {
        await saveWorkspaceFilesToDirectory(directoryHandle, outputDirectory, [generatedFile]);
        if (kind === "analysis") {
          await saveWorkspaceTextFiles(directoryHandle, outputDirectory, analysisSupplementText(project.tenderAnalysis.keywords, project.tenderAnalysis.analysisRequirements));
        }
        await saveExistingSourceNote(outputDirectory, [...inputs.tenderSources, ...inputs.clarificationSources, ...inputs.presalesSources, ...inputs.templates]);
      }
      const source: SourceDocument = {
        ...parsedOutput,
        workspacePath: isUsableProjectDirectory(directoryHandle) ? relativePath : "",
        preprocessStatus: "ready",
        preprocessedAt: new Date().toISOString(),
        preprocessMessage: locale === "zh" ? "模型分析结果" : "Model analysis result",
      };
      const sourceIds = [...inputs.tenderSources, ...inputs.clarificationSources, ...(kind === "comparison" ? inputs.presalesSources : [])].map((item) => item.id);
      const record: TenderAnalysisResult = {
        id: createId("tender-analysis"),
        kind: kind === "analysis" ? "requirements" : "comparison",
        name: resultName,
        fileName: generated.name,
        format: inputs.outputFormat,
        createdAt: new Date().toISOString(),
        provider: draft.provider,
        model: draft.model,
        sourceId: source.id,
        relativePath,
        prompt: kind === "analysis" ? project.tenderAnalysis.analysisRequirements : "",
        keywords: kind === "analysis" ? [...project.tenderAnalysis.keywords] : [],
        sourceIds,
        templateSourceIds: inputs.templates.map((item) => item.id),
        differences: extracted.data.differences,
      };
      const nextFiles = new Map(sourceFiles).set(source.id, generatedFile);
      const existingNormalized = new Set(project.requirements.filter((item) => item.baseline === "tender").map((item) => item.normalizedText.trim()));
      const extractedRequirements = kind === "analysis" ? createTenderRequirements(extracted.data, [...inputs.tenderSources, ...inputs.clarificationSources]).filter((item) => !existingNormalized.has(item.normalizedText.trim())) : [];
      const checklist: BidFileChecklistItem[] = kind === "analysis" ? extracted.data.bidFileChecklist.map((item) => ({
        id: createId("bid-file"),
        title: item.title,
        category: item.category,
        status: "pending",
        sourceResultId: record.id,
        notes: item.notes,
        templateSourceIds: [],
        selectedTemplateSourceIds: [],
        referenceSourceIds: [],
        selectedReferenceSourceIds: [],
        detailRequirements: "",
        generatedFiles: [],
      })) : [];
      const knownChecklist = new Set(project.bidFileChecklist.map((item) => item.title.trim()));
      const nextProject = syncProjectStage({
        ...project,
        sources: [...project.sources, source],
        requirements: [...project.requirements, ...extractedRequirements],
        tenderAnalysis: kind === "analysis" ? { ...project.tenderAnalysis, results: [...project.tenderAnalysis.results, record] } : project.tenderAnalysis,
        tenderComparison: kind === "comparison" ? { ...project.tenderComparison, results: [...project.tenderComparison.results, record] } : project.tenderComparison,
        bidFileChecklist: [...project.bidFileChecklist, ...checklist.filter((item) => !knownChecklist.has(item.title.trim()))],
        updatedAt: new Date().toISOString(),
      });
      commitProject(nextProject);
      setSourceFiles(nextFiles);
      setGeneratedBlobs((current) => new Map(current).set(record.id, generated.blob));
      await persistSourceFiles(project.id, new Map([[source.id, generatedFile]])).catch(() => undefined);
      if (directoryHandle) {
        for (const item of nextProject.bidFileChecklist) await ensureWorkspaceDirectoryPath(directoryHandle, bidItemDirectory(item.title));
        await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles);
      }
      else downloadBlob(generated.name, generated.blob);
      setNotice(locale === "zh" ? `${resultName}已生成。` : `${resultName} generated.`);
    } catch {
      setNotice(locale === "zh" ? "招标文件分析失败，请检查模型服务、文件预处理状态和接口配置。" : "Tender analysis failed. Check preprocessing and model configuration.");
    } finally {
      setBusy(false);
      setGeneratingActionId("");
    }
  };

  const openTenderResult = async (result: TenderAnalysisResult) => {
    try {
      const file = generatedBlobs.get(result.id) || sourceFiles.get(result.sourceId) || (directoryHandle ? await readWorkspaceFileFromRelativePath(directoryHandle, result.relativePath).catch(() => null) : null);
      if (!file) throw new Error("FILE_NOT_AVAILABLE");
      await openFilePreview(file, result.fileName);
    } catch {
      setNotice(locale === "zh" ? "找不到分析结果文件，请重新选择项目路径。" : "The analysis result is unavailable. Select the project folder again.");
    }
  };

  const removeTenderResult = async (result: TenderAnalysisResult) => {
    const detached = syncProjectStage({
      ...project,
      tenderAnalysis: { ...project.tenderAnalysis, results: project.tenderAnalysis.results.filter((item) => item.id !== result.id) },
      tenderComparison: { ...project.tenderComparison, results: project.tenderComparison.results.filter((item) => item.id !== result.id) },
      bidFileChecklist: project.bidFileChecklist.filter((item) => item.sourceResultId !== result.id),
      updatedAt: new Date().toISOString(),
    });
    const removeSource = !sourceIsReferenced(detached, result.sourceId);
    const nextProject = removeSource ? { ...detached, sources: detached.sources.filter((source) => source.id !== result.sourceId) } : detached;
    const nextFiles = new Map(sourceFiles);
    const nextBlobs = new Map(generatedBlobs);
    if (removeSource) {
      nextFiles.delete(result.sourceId);
      await removePersistedSourceFile(project.id, result.sourceId).catch(() => undefined);
    }
    nextBlobs.delete(result.id);
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    setGeneratedBlobs(nextBlobs);
    if (expandedTenderResultId === result.id) setExpandedTenderResultId("");
    if (directoryHandle) {
      await removeWorkspaceFileFromRelativePath(directoryHandle, result.relativePath).catch(() => undefined);
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
      await synchronizeDerivedWorkspaceArtifacts(directoryHandle, nextProject).catch(() => undefined);
    }
  };

  const startTenderAnalysis = (kind: "analysis" | "comparison") => {
    if (!requireProjectDirectory()) return;
    if (!tenderAnalysisInputs(kind)) return;
    const invocation = configuredModel("analysis");
    if (invocation) {
      void runTenderAnalysis(kind, invocation);
      return;
    }
    setPendingModelAction({ kind: kind === "analysis" ? "tender-analysis" : "tender-comparison", anchorId: "tender-analysis" });
  };

  const rememberModelActionAndOpenSettings = async (pending: PendingModelAction) => {
    modelActionAwaitingSettings.current = pending;
    setPendingModelAction(null);
    const task: ModelTask = pending.kind === "tender-ocr" ? "ocr" : pending.kind === "response-files" || pending.kind === "bid-output" ? "draft" : "analysis";
    window.dispatchEvent(new CustomEvent("bid-model-settings-open", { detail: { task } }));
  };

  const customerAnalysisInputs = (round: PresalesRound) => {
    const sourceIds = selectedCustomerSourceIds(round);
    if (!sourceIds.length) {
      window.alert(locale === "zh" ? "请先选择需要分析的客户附件。" : "Select at least one customer attachment to analyze.");
      return null;
    }
    if (!round.analysisOutputFormat) {
      window.alert(locale === "zh" ? "请先选择分析结果的文件格式。" : "Select an output format for the analysis result.");
      return null;
    }
    const selectedTemplates = resolvedTemplateSources(round.analysisOutputFormat, round.selectedTemplateSourceIds);
    const mismatch = selectedTemplates.find((source) => templateFileFormat(source.name) !== round.analysisOutputFormat);
    if (mismatch) {
      alertTemplateMismatch(mismatch.name, round.analysisOutputFormat);
      return null;
    }
    const selectedSources = sourceIds
      .map((id) => project.sources.find((source) => source.id === id))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    return { sourceIds, selectedSources, selectedTemplates, outputFormat: round.analysisOutputFormat };
  };

  const analyzeCustomerSources = async (round: PresalesRound, invocation: ModelInvocation) => {
    const inputs = customerAnalysisInputs(round);
    if (!inputs) return;
    const { sourceIds, selectedSources, selectedTemplates, outputFormat } = inputs;
    setAnalyzingRoundId(round.id);
    setBusy(true);
    try {
      const prompt = buildCustomerNeedsAnalysisPrompt(project, round, selectedSources, selectedTemplates, locale);
      const draft = await requestPresalesDraft(invocation.settings, invocation.apiKey, prompt, undefined, "analysis");
      const roundIndex = Math.max(0, project.presalesRounds.findIndex((item) => item.id === round.id));
      const baseName = locale === "zh" ? `第${chineseInteger(roundIndex + 1)}次沟通需求分析` : `Communication ${roundIndex + 1} requirements analysis`;
      const resultName = uniqueAnalysisResultName(baseName, round.analysisResults);
      const templateFile = await resolvePrimaryTemplateFile(selectedTemplates);
      const generated = await createGeneratedFile(draft.content, resultName, outputFormat, templateFile);
      const generatedFile = new File([generated.blob], generated.name, { type: generated.blob.type });
      const analysisDirectory = `${presalesRoundDirectory(roundIndex)}/需求分析`;
      const relativePath = isUsableProjectDirectory(directoryHandle)
        ? (await saveWorkspaceFilesToDirectory(directoryHandle, analysisDirectory, [generatedFile]))[0]
        : `downloads/${generated.name}`;
      if (isUsableProjectDirectory(directoryHandle)) {
        const supplements = analysisSupplementText(round.keywords, round.analysisRequirements);
        if (supplements.length) await saveWorkspaceTextFiles(directoryHandle, analysisDirectory, supplements);
        await saveExistingSourceNote(analysisDirectory, [...selectedSources, ...selectedTemplates]);
      }
      const source = { ...await parseSourceFile(generatedFile), workspacePath: isUsableProjectDirectory(directoryHandle) ? relativePath : "" };
      const record: PresalesAnalysisResult = {
        id: createId("analysis"),
        name: resultName,
        fileName: generated.name,
        format: outputFormat,
        createdAt: new Date().toISOString(),
        provider: draft.provider,
        model: draft.model,
        sourceId: source.id,
        relativePath,
        prompt: round.analysisRequirements,
        keywords: [...round.keywords],
        sourceIds: [...sourceIds],
        templateSourceIds: selectedTemplates.map((source) => source.id),
      };
      const nextFiles = new Map(sourceFiles).set(source.id, generatedFile);
      const nextProject = syncProjectStage({
        ...project,
        sources: [...project.sources, source],
        presalesRounds: project.presalesRounds.map((item) => item.id === round.id ? { ...item, analysisResults: [...item.analysisResults, record] } : item),
        updatedAt: new Date().toISOString(),
      });
      commitProject(nextProject);
      setSourceFiles(nextFiles);
      setGeneratedBlobs((current) => new Map(current).set(record.id, generated.blob));
      if (directoryHandle) await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles);
      else downloadBlob(generated.name, generated.blob);
      setNotice(locale === "zh"
        ? `${resultName}已生成${directoryHandle ? `并保存到 ${relativePath}` : "并下载"}。`
        : `${resultName} generated${directoryHandle ? ` and saved to ${relativePath}` : " and downloaded"}.`);
    } catch {
      setNotice(locale === "zh" ? "需求分析失败，请检查模型服务、跨域授权和接口配置。" : "Analysis failed. Check the model service, CORS permission, and endpoint settings.");
    } finally {
      setBusy(false);
      setAnalyzingRoundId("");
    }
  };

  const openAnalysisResult = async (result: PresalesAnalysisResult) => {
    try {
      const file = generatedBlobs.get(result.id)
        || sourceFiles.get(result.sourceId)
        || (directoryHandle ? await readWorkspaceFileFromRelativePath(directoryHandle, result.relativePath) : null);
      if (!file) throw new Error("FILE_NOT_AVAILABLE");
      if (result.format === "md") {
        await openFilePreview(file, result.fileName);
      } else downloadBlob(result.fileName, file);
    } catch {
      setNotice(locale === "zh" ? "找不到该分析文件，请重新选择项目路径。" : "The analysis file is unavailable. Select the project folder again.");
    }
  };

  const removeAnalysisResult = async (round: PresalesRound, result: PresalesAnalysisResult) => {
    const nextRounds = project.presalesRounds.map((item) => item.id === round.id
      ? { ...item, analysisResults: item.analysisResults.filter((entry) => entry.id !== result.id) }
      : item);
    const detachedProject = syncProjectStage({ ...project, presalesRounds: nextRounds, updatedAt: new Date().toISOString() });
    const removeSource = !sourceIsReferenced(detachedProject, result.sourceId);
    const nextProject = removeSource ? { ...detachedProject, sources: detachedProject.sources.filter((source) => source.id !== result.sourceId) } : detachedProject;
    const nextFiles = new Map(sourceFiles);
    const nextBlobs = new Map(generatedBlobs);
    if (removeSource) nextFiles.delete(result.sourceId);
    nextBlobs.delete(result.id);
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    setGeneratedBlobs(nextBlobs);
    if (expandedAnalysisId === result.id) setExpandedAnalysisId("");
    if (directoryHandle) {
      await removeWorkspaceFileFromRelativePath(directoryHandle, result.relativePath).catch(() => undefined);
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
      await synchronizeDerivedWorkspaceArtifacts(directoryHandle, nextProject).catch(() => undefined);
    }
  };

  const generatePresalesFiles = async (round: PresalesRound, actions: PresalesRoundAction[], invocation: ModelInvocation) => {
    if (!validateResponseActions(round, actions)) return;
    if (!window.confirm(locale === "zh" ? "是否使用模型生成该文件？" : "Use the configured model to generate this file?")) return;

    setGeneratingActionId(actions.length === 1 ? `file-${actions[0].id}` : `batch-file-${round.id}`);
    setBusy(true);
    try {
      let nextProject = project;
      const nextFiles = new Map(sourceFiles);
      const nextBlobs = new Map(generatedBlobs);
      const pendingWrites: Array<{ name: string; blob: Blob }> = [];
      const referencedSourceIds = new Set<string>();
      const roundIndex = Math.max(0, project.presalesRounds.findIndex((item) => item.id === round.id));
      const generationDirectory = `${presalesRoundDirectory(roundIndex)}/生成文件`;

      for (const action of actions) {
        const currentRound = nextProject.presalesRounds.find((item) => item.id === round.id) || round;
        const target = getActionResponseTarget(currentRound, action);
        if (!target.name || !target.format) throw new Error("RESPONSE_FILE_CONFIG_REQUIRED");
        const templates = resolvedTemplateSources(target.format, action.selectedTemplateSourceIds);
        const templateFile = await resolvePrimaryTemplateFile(templates);
        const prompt = buildPresalesPrompt(nextProject, currentRound, locale, action);
        const draft = await requestPresalesDraft(invocation.settings, invocation.apiKey, prompt);
        const generated = await createGeneratedFile(draft.content, target.name, target.format, templateFile);
        const generatedFile = new File([generated.blob], generated.name, { type: generated.blob.type });
        const relativePath = isUsableProjectDirectory(directoryHandle)
          ? (await saveWorkspaceFilesToDirectory(directoryHandle, generationDirectory, [generatedFile]))[0]
          : `downloads/${generated.name}`;
        if (isUsableProjectDirectory(directoryHandle)) {
          const metadataName = `${safeWorkspaceName(generated.name.replace(/\.[^.]+$/, ""))}-文件信息.txt`;
          await saveWorkspaceTextFiles(directoryHandle, generationDirectory, [{ name: metadataName, content: responseFileMetadata(action, generated.name) }]);
        }
        const source = { ...await parseSourceFile(generatedFile), workspacePath: isUsableProjectDirectory(directoryHandle) ? relativePath : "" };
        const record: PresalesGeneratedFile = {
          id: createId("generated"),
          name: generated.name,
          format: target.format,
          createdAt: new Date().toISOString(),
          provider: draft.provider,
          model: draft.model,
          sourceId: source.id,
          relativePath,
          actionId: action.id,
        };
        nextFiles.set(source.id, generatedFile);
        nextBlobs.set(record.id, generated.blob);
        pendingWrites.push({ name: generated.name, blob: generated.blob });
        for (const sourceId of [...selectedCustomerSourceIds(currentRound), ...currentRound.referenceSourceIds, ...action.selectedTemplateSourceIds]) referencedSourceIds.add(sourceId);
        nextProject = syncProjectStage({
          ...nextProject,
          sources: [...nextProject.sources, source],
          presalesRounds: nextProject.presalesRounds.map((item) => item.id === round.id ? { ...item, generatedFiles: [...item.generatedFiles, record] } : item),
          updatedAt: new Date().toISOString(),
        });
      }

      if (directoryHandle) {
        const references = [...referencedSourceIds].map((sourceId) => nextProject.sources.find((source) => source.id === sourceId)).filter((source): source is SourceDocument => Boolean(source));
        await saveExistingSourceNote(generationDirectory, references);
        await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles);
      }
      commitProject(nextProject);
      setSourceFiles(nextFiles);
      setGeneratedBlobs(nextBlobs);
      setNotice(locale === "zh" ? `${pendingWrites.length} 个响应文件已生成${directoryHandle ? "并写入项目目录" : ""}。` : `${pendingWrites.length} response file(s) generated${directoryHandle ? " and written to the project folder" : ""}.`);
    } catch {
      setNotice(locale === "zh" ? "文件生成失败，请检查模型服务、跨域授权和接口配置。" : "Generation failed. Check the model service, CORS permission, and endpoint settings.");
    } finally {
      setBusy(false);
      setGeneratingActionId("");
    }
  };

  const generateCustomerAnalysisTask = async (round: PresalesRound) => {
    const inputs = customerAnalysisInputs(round);
    if (!inputs) return;
    setGeneratingActionId(`task-analysis-${round.id}`);
    setBusy(true);
    try {
      const task = buildCodexCustomerAnalysisTask(project, round, inputs.selectedSources, inputs.selectedTemplates, locale);
      if (supportsDirectoryAccess()) {
        const outputDirectory = await chooseTaskOutputDirectory(directoryHandle);
        await saveTaskFileToDirectory(outputDirectory, task.name, task.content);
        setNotice(locale === "zh" ? `大模型任务已保存到“${outputDirectory.name}”。` : `Model task saved to “${outputDirectory.name}”.`);
      } else {
        downloadText(task.name, task.content, "text/markdown;charset=utf-8");
        setNotice(locale === "zh" ? "大模型任务已下载。" : "Model task downloaded.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setNotice(locale === "zh" ? "已取消保存任务。" : "Task saving cancelled.");
      else setNotice(locale === "zh" ? "任务文件保存失败，请重新选择可写目录。" : "The task could not be saved. Select a writable folder and try again.");
    } finally {
      setBusy(false);
      setGeneratingActionId("");
    }
  };

  const startCustomerAnalysis = (round: PresalesRound) => {
    if (!requireProjectDirectory()) return;
    const invocation = configuredModel("analysis");
    if (invocation) {
      void analyzeCustomerSources(round, invocation);
      return;
    }
    setPendingModelAction({ kind: "customer-analysis", roundId: round.id, anchorId: `communication-${round.id}` });
  };

  const startPresalesFiles = (round: PresalesRound, actions: PresalesRoundAction[]) => {
    if (!requireProjectDirectory()) return;
    const invocation = configuredModel();
    if (invocation) {
      void generatePresalesFiles(round, actions, invocation);
      return;
    }
    const anchorId = actions.length === 1 ? `response-action-${actions[0].id}` : `communication-${round.id}`;
    setPendingModelAction({ kind: "response-files", roundId: round.id, actionIds: actions.map((action) => action.id), anchorId });
  };

  const alertBidTemplateMismatch = (sourceName: string, format: TenderOutputFormat) => {
    const target = format === "docx" ? "Word" : format === "pptx" ? "PPT" : format === "xlsx" ? "Excel" : "Markdown";
    window.alert(locale === "zh"
      ? `模板“${sourceName}”与 ${target} 输出格式不匹配，请更换模板或输出格式。`
      : `Template “${sourceName}” does not match the ${target} output format. Choose another template or output format.`);
  };

  const importBidFiles = async (item: BidFileChecklistItem, files: FileList | null, kind: "template" | "reference") => {
    if (!files?.length) return;
    setBusy(true);
    setNotice(`${t.parsing}…`);
    try {
      const parsed: Array<{ source: SourceDocument; file: File }> = [];
      for (const file of Array.from(files)) {
        const templateFormat = tenderTemplateFileFormat(file.name);
        if (kind === "template" && !templateFormat) throw new Error("UNSUPPORTED_TEMPLATE_FORMAT");
        const rawSource = kind === "template"
          ? await createFormatOnlyTemplateSource(file, templateFormat as GeneralTemplateFormat | "md")
          : await parseSourceFile(file);
        const source: SourceDocument = hasReadableSourceText(rawSource) ? {
          ...rawSource,
          preprocessStatus: "ready",
          preprocessedAt: new Date().toISOString(),
          preprocessMessage: locale === "zh" ? "上传并预处理完成" : "Uploaded and preprocessed",
        } : rawSource;
        parsed.push({ source, file });
      }
      const relativeDirectory = `${bidItemDirectory(item.title)}/导入文件/${kind === "template" ? "模板文件" : "参考资料"}`;
      const prepared = await prepareImportedSources(parsed, relativeDirectory);
      const sourceIds = prepared.resolvedSources.map((source) => source.id);
      const mismatched = kind === "template" && item.outputFormat
        ? prepared.resolvedSources.filter((source) => tenderTemplateFileFormat(source.name) !== item.outputFormat)
        : [];
      const selectableIds = sourceIds.filter((id) => !mismatched.some((source) => source.id === id));
      const nextItem: BidFileChecklistItem = kind === "template" ? {
        ...item,
        templateSourceIds: [...new Set([...item.templateSourceIds, ...sourceIds])],
        selectedTemplateSourceIds: [...new Set([...item.selectedTemplateSourceIds, ...selectableIds])],
      } : {
        ...item,
        referenceSourceIds: [...new Set([...item.referenceSourceIds, ...sourceIds])],
        selectedReferenceSourceIds: [...new Set([...item.selectedReferenceSourceIds, ...sourceIds])],
      };
      const nextProject = syncProjectStage({
        ...project,
        sources: [...project.sources, ...prepared.addedSources],
        bidFileChecklist: project.bidFileChecklist.map((candidate) => candidate.id === item.id ? nextItem : candidate),
        updatedAt: new Date().toISOString(),
      });
      commitProject(nextProject);
      setSourceFiles(prepared.nextFiles);
      await persistSourceFiles(project.id, new Map(prepared.addedSources.map((source) => [source.id, prepared.nextFiles.get(source.id) as File]))).catch(() => undefined);
      if (directoryHandle) {
        await saveExistingSourceNote(relativeDirectory, prepared.resolvedSources);
        await saveProjectStateToDirectory(directoryHandle, nextProject, prepared.nextFiles);
      }
      if (mismatched[0] && item.outputFormat) alertBidTemplateMismatch(mismatched[0].name, item.outputFormat);
      setNotice(locale === "zh" ? `${prepared.resolvedSources.length} 个文件已导入。` : `${prepared.resolvedSources.length} file(s) imported.`);
    } catch {
      setNotice(locale === "zh" ? "文件导入失败，请检查文件格式。" : "Import failed. Check the file format.");
    } finally {
      setBusy(false);
    }
  };

  const removeBidSource = async (item: BidFileChecklistItem, sourceId: string, kind: "template" | "reference") => {
    const nextItem: BidFileChecklistItem = kind === "template" ? {
      ...item,
      templateSourceIds: item.templateSourceIds.filter((id) => id !== sourceId),
      selectedTemplateSourceIds: item.selectedTemplateSourceIds.filter((id) => id !== sourceId),
    } : {
      ...item,
      referenceSourceIds: item.referenceSourceIds.filter((id) => id !== sourceId),
      selectedReferenceSourceIds: item.selectedReferenceSourceIds.filter((id) => id !== sourceId),
    };
    const detached = syncProjectStage({
      ...project,
      bidFileChecklist: project.bidFileChecklist.map((candidate) => candidate.id === item.id ? nextItem : candidate),
      updatedAt: new Date().toISOString(),
    });
    const removeSource = !sourceIsReferenced(detached, sourceId);
    const nextProject = removeSource ? { ...detached, sources: detached.sources.filter((source) => source.id !== sourceId) } : detached;
    const source = project.sources.find((candidate) => candidate.id === sourceId);
    const nextFiles = new Map(sourceFiles);
    if (removeSource) {
      nextFiles.delete(sourceId);
      await removePersistedSourceFile(project.id, sourceId).catch(() => undefined);
    }
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    if (directoryHandle) {
      if (removeSource && source) await removeWorkspaceFileFromRelativePath(directoryHandle, workspaceSourcePath(source)).catch(() => undefined);
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
      await synchronizeDerivedWorkspaceArtifacts(directoryHandle, nextProject).catch(() => undefined);
    }
  };

  const toggleBidTemplate = (item: BidFileChecklistItem, sourceId: string) => {
    const selected = item.selectedTemplateSourceIds.includes(sourceId);
    if (!selected && item.outputFormat) {
      const source = project.sources.find((candidate) => candidate.id === sourceId);
      if (source && tenderTemplateFileFormat(source.name) !== item.outputFormat) {
        alertBidTemplateMismatch(source.name, item.outputFormat);
        return;
      }
    }
    updateBidFile(item.id, { selectedTemplateSourceIds: selected ? item.selectedTemplateSourceIds.filter((id) => id !== sourceId) : [...item.selectedTemplateSourceIds, sourceId] });
  };

  const setBidOutputFormat = (item: BidFileChecklistItem, format: TenderOutputFormat | "") => {
    if (format) {
      const mismatch = item.selectedTemplateSourceIds
        .map((id) => project.sources.find((source) => source.id === id))
        .find((source) => source && tenderTemplateFileFormat(source.name) !== format);
      if (mismatch) {
        alertBidTemplateMismatch(mismatch.name, format);
        return;
      }
    }
    updateBidFile(item.id, { outputFormat: format || undefined });
  };

  const bidFileInputs = (item: BidFileChecklistItem, requireReadableReferences = false) => {
    if (!item.outputFormat) {
      window.alert(locale === "zh" ? "请先选择输出格式。" : "Select an output format first.");
      return null;
    }
    const templates = resolvedTemplateSources(item.outputFormat, item.selectedTemplateSourceIds);
    const mismatch = templates.find((source) => tenderTemplateFileFormat(source.name) !== item.outputFormat);
    if (mismatch) {
      alertBidTemplateMismatch(mismatch.name, item.outputFormat);
      return null;
    }
    const references = item.selectedReferenceSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    if (requireReadableReferences) {
      const unreadable = references.find((source) => source.requiresOcr || !source.segments.some((segment) => segment.text.trim()));
      if (unreadable) {
        window.alert(locale === "zh" ? `参考资料“${unreadable.name}”无法提取文本，请先转换为可读取文件，或选择“输出任务”交由 Codex 处理原文件。` : `Reference “${unreadable.name}” has no extractable text. Convert it first or output a Codex task to process the original file.`);
        return null;
      }
    }
    return { templates, references, outputFormat: item.outputFormat };
  };

  const generateBidFile = async (item: BidFileChecklistItem, invocation: ModelInvocation) => {
    const inputs = bidFileInputs(item, true);
    if (!inputs) return;
    setBusy(true);
    setGeneratingActionId(`bid-output-${item.id}`);
    try {
      const prompt = buildBidFilePrompt(project, item, inputs.references, inputs.templates, locale);
      const draft = await requestPresalesDraft(invocation.settings, invocation.apiKey, prompt);
      const templateFile = await resolvePrimaryTemplateFile(inputs.templates);
      const generated = await createTenderGeneratedFile(draft.content, item.title, inputs.outputFormat, templateFile);
      const outputDirectory = `${bidItemDirectory(item.title)}/生成文件`;
      const existingOutputNames = new Set([
        ...item.generatedFiles.map((record) => record.name.toLowerCase()),
        ...project.sources.filter((source) => source.workspacePath.startsWith(`${outputDirectory}/`)).map((source) => source.name.toLowerCase()),
      ]);
      let nameExists = existingOutputNames.has(generated.name.toLowerCase());
      if (!nameExists && isUsableProjectDirectory(directoryHandle)) {
        try { await readWorkspaceFileFromRelativePath(directoryHandle, `${outputDirectory}/${generated.name}`); nameExists = true; } catch (error) {
          if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
        }
      }
      if (nameExists) {
        const generatedAt = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        const stamp = `${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-${pad(generatedAt.getHours())}${pad(generatedAt.getMinutes())}${pad(generatedAt.getSeconds())}`;
        const extension = `.${inputs.outputFormat}`;
        generated.name = `${generated.name.slice(0, -extension.length)}_${stamp}-${createId("revision").slice(-8)}${extension}`;
      }
      const generatedFile = new File([generated.blob], generated.name, { type: generated.blob.type });
      const parsedOutput = await parseSourceFile(generatedFile);
      const relativePath = isUsableProjectDirectory(directoryHandle)
        ? `${outputDirectory}/${generated.name}`
        : `downloads/${generated.name}`;
      if (isUsableProjectDirectory(directoryHandle)) {
        await saveWorkspaceFilesToDirectory(directoryHandle, outputDirectory, [generatedFile]);
        if (item.detailRequirements.trim()) {
          await saveWorkspaceTextFiles(directoryHandle, outputDirectory, [{ name: "细节要求.txt", content: `${item.detailRequirements.trim()}\n` }]);
        }
        await saveExistingSourceNote(outputDirectory, [...inputs.references, ...inputs.templates]);
      }
      const source: SourceDocument = {
        ...parsedOutput,
        workspacePath: isUsableProjectDirectory(directoryHandle) ? relativePath : "",
        preprocessStatus: "ready",
        preprocessedAt: new Date().toISOString(),
        preprocessMessage: locale === "zh" ? "模型生成文件" : "Model-generated file",
      };
      const record: BidGeneratedFile = {
        id: createId("bid-output"),
        name: generated.name,
        format: inputs.outputFormat,
        createdAt: new Date().toISOString(),
        provider: draft.provider,
        model: draft.model,
        sourceId: source.id,
        relativePath,
        referenceSourceIds: inputs.references.map((candidate) => candidate.id),
        templateSourceIds: inputs.templates.map((candidate) => candidate.id),
        detailRequirements: item.detailRequirements,
      };
      const nextFiles = new Map(sourceFiles).set(source.id, generatedFile);
      const nextProject = syncProjectStage({
        ...project,
        sources: [...project.sources, source],
        bidFileChecklist: project.bidFileChecklist.map((candidate) => candidate.id === item.id ? { ...candidate, status: "confirmed", generatedFiles: [...candidate.generatedFiles, record] } : candidate),
        updatedAt: new Date().toISOString(),
      });
      commitProject(nextProject);
      setSourceFiles(nextFiles);
      setGeneratedBlobs((current) => new Map(current).set(record.id, generated.blob));
      await persistSourceFiles(project.id, new Map([[source.id, generatedFile]])).catch(() => undefined);
      if (directoryHandle) await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles);
      else downloadBlob(generated.name, generated.blob);
      setNotice(locale === "zh" ? `“${generated.name}”已生成。` : `“${generated.name}” generated.`);
    } catch {
      setNotice(locale === "zh" ? "投标文件生成失败，请检查模型服务、参考资料和接口配置。" : "Bid file generation failed. Check the model service, references, and API settings.");
    } finally {
      setBusy(false);
      setGeneratingActionId("");
    }
  };

  const startBidFileGeneration = (item: BidFileChecklistItem) => {
    if (!requireProjectDirectory()) return;
    const invocation = configuredModel();
    if (invocation) {
      void generateBidFile(item, invocation);
      return;
    }
    if (!bidFileInputs(item)) return;
    setPendingModelAction({ kind: "bid-output", bidFileId: item.id, anchorId: `bid-output-${item.id}` });
  };

  const openBidGeneratedFile = async (record: BidGeneratedFile) => {
    try {
      const file = generatedBlobs.get(record.id) || sourceFiles.get(record.sourceId) || (directoryHandle ? await readWorkspaceFileFromRelativePath(directoryHandle, record.relativePath) : null);
      if (!file) throw new Error("FILE_NOT_AVAILABLE");
      if (record.format === "md") {
        await openFilePreview(file, record.name);
      } else downloadBlob(record.name, file);
    } catch {
      setNotice(locale === "zh" ? "找不到该投标文件，请重新选择项目路径。" : "The bid file is unavailable. Select the project folder again.");
    }
  };

  const removeBidGeneratedFile = async (item: BidFileChecklistItem, record: BidGeneratedFile) => {
    const detached = syncProjectStage({
      ...project,
      bidFileChecklist: project.bidFileChecklist.map((candidate) => candidate.id === item.id ? { ...candidate, generatedFiles: candidate.generatedFiles.filter((file) => file.id !== record.id) } : candidate),
      updatedAt: new Date().toISOString(),
    });
    const removeSource = !sourceIsReferenced(detached, record.sourceId);
    const nextProject = removeSource ? { ...detached, sources: detached.sources.filter((source) => source.id !== record.sourceId) } : detached;
    const nextFiles = new Map(sourceFiles);
    const nextBlobs = new Map(generatedBlobs);
    if (removeSource) {
      nextFiles.delete(record.sourceId);
      await removePersistedSourceFile(project.id, record.sourceId).catch(() => undefined);
    }
    nextBlobs.delete(record.id);
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    setGeneratedBlobs(nextBlobs);
    if (directoryHandle) {
      await removeWorkspaceFileFromRelativePath(directoryHandle, record.relativePath).catch(() => undefined);
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
      await synchronizeDerivedWorkspaceArtifacts(directoryHandle, nextProject).catch(() => undefined);
    }
  };

  const handoverBidRecords = () => project.bidFileChecklist.flatMap((item) => item.generatedFiles.map((record) => ({ item, record })));

  const selectedHandoverSources = (requireReadable = false) => {
    const awardIds = project.handover.selectedAwardSourceIds;
    const bidIds = handoverBidRecords()
      .map(({ record }) => record.sourceId)
      .filter((id) => !project.handover.excludedBidSourceIds.includes(id));
    const awardSources = awardIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    const bidSources = bidIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    if (!project.handover.departments.length || project.handover.departments.some((department) => !department.name.trim())) {
      window.alert(locale === "zh" ? "请先添加部门并填写部门名称。" : "Add at least one department and provide every department name.");
      return null;
    }
    if (!awardSources.length && !bidSources.length && !project.handover.awardNotes.trim() && !project.handover.temporaryChanges.trim()) {
      window.alert(locale === "zh" ? "请先选择中标资料、投标文件，或填写中标说明与临时变更。" : "Select award materials or bid files, or add award notes or temporary changes first.");
      return null;
    }
    if (requireReadable) {
      const unreadable = [...awardSources, ...bidSources].find((source) => source.requiresOcr || !source.segments.some((segment) => segment.text.trim()));
      if (unreadable) {
        window.alert(locale === "zh"
          ? `“${unreadable.name}”无法直接提取文本，请先转为可读取文件，或选择“否，输出任务”交由 Codex 处理原文件。`
          : `“${unreadable.name}” has no extractable text. Convert it first, or choose “No, output task” so Codex can process the original file.`);
        return null;
      }
    }
    return { awardSources, bidSources };
  };

  const importHandoverAwardFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setNotice(`${t.parsing}…`);
    try {
      const parsed: Array<{ source: SourceDocument; file: File }> = [];
      for (const file of Array.from(files)) {
        const raw = await parseSourceFile(file);
        const source = hasReadableSourceText(raw) ? {
          ...raw,
          preprocessStatus: "ready" as const,
          preprocessedAt: new Date().toISOString(),
          preprocessMessage: locale === "zh" ? "上传并可读取" : "Uploaded and readable",
        } : raw;
        parsed.push({ source, file });
      }
      const relativeDirectory = `${WORKSPACE_MODULE_DIRECTORIES.awardSupplement}/导入文件`;
      const prepared = await prepareImportedSources(parsed, relativeDirectory);
      const sourceIds = prepared.resolvedSources.map((source) => source.id);
      const nextProject = syncProjectStage({
        ...project,
        sources: [...project.sources, ...prepared.addedSources],
        handover: {
          ...project.handover,
          awardSourceIds: [...new Set([...project.handover.awardSourceIds, ...sourceIds])],
          selectedAwardSourceIds: [...new Set([...project.handover.selectedAwardSourceIds, ...sourceIds])],
        },
        updatedAt: new Date().toISOString(),
      });
      commitProject(nextProject);
      setSourceFiles(prepared.nextFiles);
      await persistSourceFiles(project.id, new Map(prepared.addedSources.map((source) => [source.id, prepared.nextFiles.get(source.id) as File]))).catch(() => undefined);
      if (directoryHandle) {
        await saveExistingSourceNote(relativeDirectory, prepared.resolvedSources);
        await saveProjectStateToDirectory(directoryHandle, nextProject, prepared.nextFiles);
      }
      setNotice(locale === "zh" ? `${prepared.resolvedSources.length} 个中标资料已导入。` : `${prepared.resolvedSources.length} award file(s) imported.`);
    } catch {
      setNotice(locale === "zh" ? "中标资料导入失败，请检查文件格式。" : "Award file import failed. Check the file format.");
    } finally {
      setBusy(false);
    }
  };

  const removeHandoverSource = async (sourceId: string, target: "award" | "response", taskId = "") => {
    const nextHandover = target === "award" ? {
      ...project.handover,
      awardSourceIds: project.handover.awardSourceIds.filter((id) => id !== sourceId),
      selectedAwardSourceIds: project.handover.selectedAwardSourceIds.filter((id) => id !== sourceId),
    } : {
      ...project.handover,
      tasks: project.handover.tasks.map((task) => task.id === taskId ? { ...task, responseSourceIds: task.responseSourceIds.filter((id) => id !== sourceId) } : task),
    };
    const detached = syncProjectStage({ ...project, handover: nextHandover, updatedAt: new Date().toISOString() });
    const removeSource = !sourceIsReferenced(detached, sourceId);
    const nextProject = removeSource ? { ...detached, sources: detached.sources.filter((source) => source.id !== sourceId) } : detached;
    const nextFiles = new Map(sourceFiles);
    const source = project.sources.find((item) => item.id === sourceId);
    if (removeSource) {
      nextFiles.delete(sourceId);
      await removePersistedSourceFile(project.id, sourceId).catch(() => undefined);
    }
    commitProject(nextProject);
    setSourceFiles(nextFiles);
    if (directoryHandle) {
      if (removeSource && source) await removeWorkspaceFileFromRelativePath(directoryHandle, workspaceSourcePath(source)).catch(() => undefined);
      await saveProjectStateToDirectory(directoryHandle, nextProject, nextFiles).catch(() => undefined);
      await synchronizeDerivedWorkspaceArtifacts(directoryHandle, nextProject).catch(() => undefined);
    }
  };

  const importHandoverResponseFiles = async (task: HandoverTask, files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const parsed: Array<{ source: SourceDocument; file: File }> = [];
      for (const file of Array.from(files)) {
        const source = await parseSourceFile(file);
        parsed.push({ source, file });
      }
      const taskIndex = Math.max(0, project.handover.tasks.findIndex((item) => item.id === task.id));
      const relativeDirectory = `${handoverTaskDirectory(task.title, taskIndex)}/导入文件`;
      const prepared = await prepareImportedSources(parsed, relativeDirectory);
      const sourceIds = prepared.resolvedSources.map((source) => source.id);
      const nextProject = syncProjectStage({
        ...project,
        sources: [...project.sources, ...prepared.addedSources],
        handover: {
          ...project.handover,
          tasks: project.handover.tasks.map((item) => item.id === task.id ? {
            ...item,
            responseSourceIds: [...new Set([...item.responseSourceIds, ...sourceIds])],
            status: item.status === "pending" ? "submitted" : item.status,
          } : item),
        },
        updatedAt: new Date().toISOString(),
      });
      commitProject(nextProject);
      setSourceFiles(prepared.nextFiles);
      await persistSourceFiles(project.id, new Map(prepared.addedSources.map((source) => [source.id, prepared.nextFiles.get(source.id) as File]))).catch(() => undefined);
      if (directoryHandle) {
        await saveExistingSourceNote(relativeDirectory, prepared.resolvedSources);
        await saveProjectStateToDirectory(directoryHandle, nextProject, prepared.nextFiles);
      }
      setNotice(locale === "zh" ? `${prepared.resolvedSources.length} 个响应文件已加入任务。` : `${prepared.resolvedSources.length} response file(s) added to the task.`);
    } catch {
      setNotice(locale === "zh" ? "响应文件导入失败；软件包可改用受控路径记录。" : "Response file import failed. Record software packages as a controlled path instead.");
    } finally {
      setBusy(false);
    }
  };

  const addHandoverDepartment = () => updateHandover({
    departments: [...project.handover.departments, {
      id: createId("department"),
      name: "",
      responsibility: "",
      owner: "",
      defaultDeliverableType: "document",
      defaultResponseMethod: "file",
    }],
  });

  const removeHandoverDepartment = (department: HandoverDepartment) => {
    const assigned = project.handover.tasks.filter((task) => task.departmentId === department.id).length;
    if (assigned && !window.confirm(locale === "zh" ? `该部门已有 ${assigned} 项任务。删除后这些任务将变为未分配，是否继续？` : `${assigned} task(s) are assigned to this department. They will become unassigned. Continue?`)) return;
    updateHandover({
      departments: project.handover.departments.filter((item) => item.id !== department.id),
      tasks: project.handover.tasks.map((task) => task.departmentId === department.id ? { ...task, departmentId: "" } : task),
    });
  };

  const addHandoverTask = async () => {
    const department = project.handover.departments[0];
    const task: HandoverTask = {
      id: createId("handover-task"),
      title: "",
      departmentId: department?.id || "",
      scope: "",
      deliverableType: department?.defaultDeliverableType || "document",
      responseMethod: department?.defaultResponseMethod || "file",
      deliverableName: "",
      owner: department?.owner || "",
      dueDate: "",
      status: "pending",
      dependencyNotes: "",
      acceptanceCriteria: "",
      sourceIds: [],
      responseText: "",
      responsePath: "",
      responseSourceIds: [],
    };
    if (isUsableProjectDirectory(directoryHandle)) {
      try {
        await ensureWorkspaceDirectoryPath(directoryHandle, handoverTaskDirectory(task.title, project.handover.tasks.length));
      } catch {
        setNotice(locale === "zh" ? "无法创建交底任务目录，请重新授权项目路径。" : "The handover task folder could not be created. Reauthorize the project folder.");
        return;
      }
    }
    updateHandover({ tasks: [...project.handover.tasks, task] });
    setExpandedHandoverTaskId(task.id);
  };

  const runHandoverTaskSplit = async (invocation: ModelInvocation) => {
    const inputs = selectedHandoverSources(true);
    if (!inputs) return;
    if (project.handover.tasks.length && !window.confirm(locale === "zh" ? "重新分拆会替换当前交底任务及其响应记录，是否继续？" : "Splitting again replaces the current handover tasks and their responses. Continue?")) return;
    setBusy(true);
    setGeneratingActionId("handover-task-split");
    try {
      const prompt = buildHandoverTaskSplitPrompt(project, inputs.awardSources, inputs.bidSources, locale);
      const result = await requestHandoverTaskSplit(invocation.settings, invocation.apiKey, prompt);
      const departmentIds = new Set(project.handover.departments.map((department) => department.id));
      const sourceIds = new Set([...inputs.awardSources, ...inputs.bidSources].map((source) => source.id));
      const tasks: HandoverTask[] = result.tasks
        .filter((task) => departmentIds.has(task.departmentId))
        .map((task) => ({
          ...task,
          id: createId("handover-task"),
          sourceIds: task.sourceIds.filter((id) => sourceIds.has(id)),
          status: "pending",
          responseText: "",
          responsePath: "",
          responseSourceIds: [],
        }));
      if (!tasks.length) throw new Error("HANDOVER_TASKS_EMPTY");
      const nextProject = syncProjectStage({
        ...project,
        handover: {
          ...project.handover,
          tasks,
          lastSplitAt: new Date().toISOString(),
          lastSplitProvider: result.provider,
          lastSplitModel: result.model,
        },
        updatedAt: new Date().toISOString(),
      });
      commitProject(nextProject);
      if (directoryHandle) {
        for (const [index, task] of tasks.entries()) await ensureWorkspaceDirectoryPath(directoryHandle, handoverTaskDirectory(task.title, index));
        await saveProjectStateToDirectory(directoryHandle, nextProject, sourceFiles);
      }
      setExpandedHandoverTaskId(tasks[0]?.id || "");
      setNotice(locale === "zh" ? `已分拆 ${tasks.length} 项交底任务，请逐项复核。` : `${tasks.length} handover task(s) created. Review each item.`);
    } catch {
      setNotice(locale === "zh" ? "交底任务分拆失败，请检查部门配置、来源文件和模型接口。" : "Task split failed. Check departments, source files, and model configuration.");
    } finally {
      setBusy(false);
      setGeneratingActionId("");
    }
  };

  const startHandoverTaskSplit = () => {
    const invocation = configuredModel("analysis");
    if (invocation) {
      void runHandoverTaskSplit(invocation);
      return;
    }
    if (!selectedHandoverSources()) return;
    setPendingModelAction({ kind: "handover-task-split", anchorId: "handover-checklist" });
  };

  useEffect(() => {
    if (!ready || workspaceRecovery || !filesHydrated || !resumeModelAction) return;
    const pending = resumeModelAction;
    setResumeModelAction(null);
    if (!isUsableProjectDirectory(directoryHandle)) {
      setProjectPathRequired(true);
      return;
    }
    const task: ModelTask = pending.kind === "tender-ocr" ? "ocr" : pending.kind === "response-files" || pending.kind === "bid-output" ? "draft" : "analysis";
    const invocation = configuredModel(task);
    if (!invocation) {
      setPendingModelAction(pending);
      return;
    }
    if (pending.kind === "tender-ocr") void performTenderOcr(pending.sourceIds, invocation);
    else if (pending.kind === "tender-analysis") void runTenderAnalysis("analysis", invocation);
    else if (pending.kind === "tender-comparison") void runTenderAnalysis("comparison", invocation);
    else if (pending.kind === "bid-output") {
      const item = project.bidFileChecklist.find((candidate) => candidate.id === pending.bidFileId);
      if (item) void generateBidFile(item, invocation);
    }
    else if (pending.kind === "handover-task-split") void runHandoverTaskSplit(invocation);
    else if (pending.kind === "customer-analysis" || pending.kind === "response-files") {
      const round = project.presalesRounds.find((item) => item.id === pending.roundId);
      if (!round) return;
      if (pending.kind === "customer-analysis") void analyzeCustomerSources(round, invocation);
      else void generatePresalesFiles(round, round.actions.filter((action) => pending.actionIds.includes(action.id)), invocation);
    }
  }, [directoryHandle, filesHydrated, ready, resumeModelAction, workspaceRecovery]);

  const saveTenderTask = async (task: { name: string; content: string }) => {
    setBusy(true);
    try {
      if (supportsDirectoryAccess()) {
        const outputDirectory = await chooseTaskOutputDirectory(directoryHandle);
        await saveTaskFileToDirectory(outputDirectory, task.name, task.content);
        setNotice(locale === "zh" ? `大模型任务已保存到“${outputDirectory.name}”。` : `Model task saved to “${outputDirectory.name}”.`);
      } else {
        downloadText(task.name, task.content, "text/markdown;charset=utf-8");
        setNotice(locale === "zh" ? "大模型任务已下载。" : "Model task downloaded.");
      }
    } catch {
      setNotice(locale === "zh" ? "任务文件保存失败。" : "The task file could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const outputPendingModelTask = () => {
    const pending = pendingModelAction;
    setPendingModelAction(null);
    if (!pending) return;
    if (pending.kind === "tender-ocr") {
      const sources = pending.sourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
      void saveTenderTask(buildCodexOcrTask(project, sources, locale));
      return;
    }
    if (pending.kind === "tender-analysis" || pending.kind === "tender-comparison") {
      const kind = pending.kind === "tender-analysis" ? "analysis" : "comparison";
      const inputs = tenderAnalysisInputs(kind);
      if (!inputs) return;
      const prompt = kind === "analysis"
        ? buildTenderAnalysisPrompt(project, inputs.tenderSources, inputs.clarificationSources, inputs.templates, locale)
        : buildTenderComparisonPrompt(project, inputs.presalesSources, inputs.tenderSources, inputs.clarificationSources, inputs.templates, locale);
      void saveTenderTask(buildCodexTenderTask(kind === "analysis" ? "requirements" : "comparison", project, prompt, inputs.outputFormat, locale, inputs.templates));
      return;
    }
    if (pending.kind === "bid-output") {
      const item = project.bidFileChecklist.find((candidate) => candidate.id === pending.bidFileId);
      if (!item) return;
      const inputs = bidFileInputs(item);
      if (!inputs) return;
      void saveTenderTask(buildCodexBidFileTask(project, item, inputs.references, inputs.templates, locale));
      return;
    }
    if (pending.kind === "handover-task-split") {
      const inputs = selectedHandoverSources();
      if (!inputs) return;
      void saveTenderTask(buildCodexHandoverTask(project, inputs.awardSources, inputs.bidSources, locale));
      return;
    }
    const round = project.presalesRounds.find((item) => item.id === pending.roundId);
    if (!round) return;
    if (pending.kind === "customer-analysis") {
      void generateCustomerAnalysisTask(round);
      return;
    }
    const actions = pending.actionIds
      .map((id) => round.actions.find((action) => action.id === id))
      .filter((action): action is PresalesRoundAction => Boolean(action));
    void generatePresalesTasks(round, actions);
  };

  const openGeneratedFile = async (record: PresalesGeneratedFile) => {
    try {
      const file = generatedBlobs.get(record.id) || sourceFiles.get(record.sourceId) || (directoryHandle ? await readWorkspaceFileFromRelativePath(directoryHandle, record.relativePath).catch(() => readGeneratedFileFromDirectory(directoryHandle, project, record.name)) : null);
      if (!file) throw new Error("FILE_NOT_AVAILABLE");
      if (record.format === "md") {
        await openFilePreview(file, record.name);
      } else downloadBlob(record.name, file);
    } catch {
      setNotice(locale === "zh" ? "当前会话中找不到该文件，请重新选择项目路径后再试。" : "The file is unavailable in this session. Select the project folder and try again.");
    }
  };

  const resetCurrentProject = () => {
    const previousProjectId = project.id;
    commitProject(syncProjectStage(createEmptyProject(locale)));
    setSourceFiles(new Map());
    setGeneratedBlobs(new Map());
    setSelectedSourceId("");
    setSelectedRequirementId("");
    setSelectedActionIds(new Set());
    setExpandedTenderSourceId("");
    setExpandedTenderResultId("");
    setExpandedBidFileId("");
    setWorkspaceOutputFiles([]);
    setSelectedOutputPaths(new Set());
    void clearPersistedSourceFiles(previousProjectId).catch(() => undefined);
  };

  const chooseDirectory = async (mode: PendingDirectoryChange["mode"]) => {
    try {
      const handle = await chooseWorkspaceDirectory(directoryHandle);
      setPendingDirectoryChange({ handle, mode });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setNotice(locale === "zh" ? "无法打开文件夹选择窗口。" : "The folder picker could not be opened.");
      }
    }
  };
  const confirmDirectoryChange = async () => {
    if (!pendingDirectoryChange) return;
    const { handle, mode } = pendingDirectoryChange;
    setPendingDirectoryChange(null);
    setBusy(true);
    try {
      if (mode === "migrate" && directoryHandle) {
        await saveProjectStateToDirectory(directoryHandle, project, sourceFiles);
        await migrateWorkspaceDirectory(directoryHandle, handle);
      }
      await ensureProjectStageDirectories(handle);
      const nextProject = syncProjectStage({ ...project, localPathHint: handle.name, updatedAt: new Date().toISOString() });
      await saveProjectStateToDirectory(handle, nextProject, sourceFiles);
      await persistWorkspaceDirectory(handle);
      historyRef.current.reset();
      commitProject(nextProject, "", false);
      setDirectoryHandle(handle);
      window.queueMicrotask(publishHistoryState);
      setNotice(mode === "migrate"
        ? (locale === "zh" ? `项目已迁移到“${handle.name}”。` : `Project migrated to “${handle.name}”.`)
        : (locale === "zh" ? `项目路径已设置为“${handle.name}”。` : `Project folder set to “${handle.name}”.`));
    } catch (error) {
      setNotice(error instanceof Error && error.message.includes("inside")
        ? (locale === "zh" ? "新项目路径不能位于当前项目的受管目录中。" : "The new project folder cannot be inside the current managed workspace.")
        : (locale === "zh" ? "项目路径设置或迁移失败，请检查新旧目录中的受管文件后重试。" : "Project folder setup or migration failed. Check the managed files in both folders before retrying."));
    } finally {
      setBusy(false);
    }
  };
  const syncDirectory = async () => {
    if (!directoryHandle) return;
    setBusy(true);
    try {
      await saveProjectToDirectory(directoryHandle, project, sourceFiles);
      setNotice(t.folderSaved);
    } catch {
      setNotice(t.invalid);
    } finally { setBusy(false); }
  };
  const rescanDirectory = async () => {
    if (!directoryHandle) return;
    setBusy(true);
    try {
      commitProject(syncProjectStage(await loadActiveProject(directoryHandle)));
      setNotice(t.loaded);
    } catch {
      setNotice(t.invalid);
    } finally { setBusy(false); }
  };
  const importArchive = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const imported = await importProjectArchive(file);
      const nextProject = syncProjectStage(imported.project);
      commitProject(nextProject);
      setSourceFiles(imported.sourceFiles);
      if (directoryHandle) await saveProjectStateToDirectory(directoryHandle, nextProject, imported.sourceFiles);
      setNotice(t.loaded);
    } catch { setNotice(t.invalid); }
    finally { setBusy(false); if (archiveInput.current) archiveInput.current.value = ""; }
  };
  const restoreWorkspaceAfterCacheFailure = async () => {
    setBusy(true);
    try {
      const handle = await chooseWorkspaceDirectory(directoryHandle);
      const restoredProject = syncProjectStage(await loadActiveProject(handle));
      const restoredFiles = await loadSourceFilesFromDirectory(handle, restoredProject);
      await persistWorkspaceDirectory(handle);
      historyRef.current.reset();
      commitProject(restoredProject, "", false);
      setDirectoryHandle(handle);
      setSourceFiles(restoredFiles);
      knownSourceFilesRef.current = new Map(restoredFiles);
      setResumeModelAction(null);
      setReturnState(null);
      setWorkspaceRecovery(null);
      setNotice(t.loaded);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setNotice(locale === "zh" ? "未能读取项目，请选择包含 workspace.json 的原项目目录。原始缓存已保留。" : "Choose the original project folder containing workspace.json. The original cache has been preserved.");
      }
    } finally { setBusy(false); }
  };
  const startNewWorkspaceAfterCacheFailure = () => {
    if (!workspaceRecovery) return;
    downloadBlob(`${workspaceRecovery.key}.json`, new Blob([workspaceRecovery.content], { type: "application/json" }));
    setDirectoryHandle(null);
    setResumeModelAction(null);
    setReturnState(null);
    setWorkspaceRecovery(null);
  };
  const setOutputPathsChecked = (paths: string[], checked: boolean) => setSelectedOutputPaths((current) => {
    const next = new Set(current);
    paths.forEach((path) => checked ? next.add(path) : next.delete(path));
    return next;
  });

  const chooseOutputDirectory = async () => {
    try {
      const handle = await chooseProjectOutputDirectory(outputDirectoryHandle || directoryHandle);
      if (directoryHandle) await validateWorkspaceOutputDirectory(directoryHandle, handle);
      setOutputDirectoryHandle(handle);
      setNotice(locale === "zh" ? `输出路径已设置为“${handle.name}”。` : `Output folder set to “${handle.name}”.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(error instanceof Error && error.message === "OUTPUT_INSIDE_WORKSPACE"
        ? (locale === "zh" ? "输出路径不能是项目路径，也不能位于项目的受管目录中。" : "The output folder cannot be the project folder or one of its managed subfolders.")
        : (locale === "zh" ? "无法设置输出路径。" : "The output folder could not be set."));
    }
  };

  const outputSelectionIsReady = () => {
    if (!isUsableProjectDirectory(directoryHandle)) {
      setProjectPathRequired(true);
      return false;
    }
    if (!isUsableProjectDirectory(outputDirectoryHandle)) {
      setOutputPathRequired(true);
      return false;
    }
    if (!selectedOutputPaths.size) {
      setNotice(locale === "zh" ? "请至少选择一个需要输出的文件。" : "Select at least one file to output.");
      return false;
    }
    return true;
  };

  const exportSelectedFiles = async (kind: "complete" | "zip") => {
    if (!outputSelectionIsReady() || !directoryHandle || !outputDirectoryHandle) return;
    setBusy(true);
    try {
      const paths = [...selectedOutputPaths];
      if (kind === "complete") {
        const result = await copyWorkspaceFilesToOutput(directoryHandle, outputDirectoryHandle, project.name, paths);
        setNotice(locale === "zh"
          ? `已将 ${result.files.length} 个文件完整输出到“${outputDirectoryHandle.name}/${result.projectDirectoryName}”。`
          : `${result.files.length} files were copied to “${outputDirectoryHandle.name}/${result.projectDirectoryName}”.`);
      } else {
        const result = await saveWorkspaceFilesAsZip(directoryHandle, outputDirectoryHandle, project.name, paths);
        setNotice(locale === "zh"
          ? `已将 ${result.files.length} 个文件导出为“${result.name}”。`
          : `${result.files.length} files were exported as “${result.name}”.`);
      }
    } catch (error) {
      setNotice(error instanceof Error && error.message === "OUTPUT_INSIDE_WORKSPACE"
        ? (locale === "zh" ? "输出路径不能是项目路径，也不能位于项目的受管目录中。" : "The output folder cannot be the project folder or one of its managed subfolders.")
        : (locale === "zh" ? "文件输出失败，请检查项目路径、输出路径和目录权限。" : "File output failed. Check the project folder, output folder, and permissions."));
    } finally {
      setBusy(false);
    }
  };

  const renderProjectContext = () => <section className="work-section">
    <div className="section-heading">
      <div><h2>{t.projectContext}</h2></div>
      <span>{project.schemaVersion}</span>
    </div>
    <div className="field-grid">
      <Field label={t.projectName}><input value={project.name} onChange={(event) => updateProject("name", event.target.value)} /></Field>
      <Field label={t.customer}><input value={project.customerAlias} onChange={(event) => updateProject("customerAlias", event.target.value)} /></Field>
      <Field label={t.industry}><input value={project.industry} onChange={(event) => updateProject("industry", event.target.value)} /></Field>
      <Field label={t.owner}><input value={project.owner} onChange={(event) => updateProject("owner", event.target.value)} /></Field>
      <Field label={t.budget}><input value={project.budget} onChange={(event) => updateProject("budget", event.target.value)} /></Field>
      <Field label={t.deadline}><LocalizedTemporalInput type="date" locale={locale} ariaLabel={t.deadline} value={project.deadline} onChange={(value) => updateProject("deadline", value)}/></Field>
      <ConfirmableTextarea fieldId="project-objective" label={t.objective} locale={locale} rows={4} wide value={project.objective} confirmed={project.confirmedTextFields.includes("project-objective")} onChange={(value) => updateProject("objective", value)} onConfirmedChange={(confirmed) => setTextFieldConfirmed("project-objective", confirmed)}/>
      <ConfirmableTextarea fieldId="project-constraints" label={t.constraints} locale={locale} rows={4} wide value={project.constraints} confirmed={project.confirmedTextFields.includes("project-constraints")} onChange={(value) => updateProject("constraints", value)} onConfirmedChange={(confirmed) => setTextFieldConfirmed("project-constraints", confirmed)}/>
    </div>
  </section>;

  const renderPresales = () => <>
    {renderProjectContext()}
    <section className="work-section">
      <div className="section-heading"><div><h2>{locale === "zh" ? "客户沟通与文件响应" : "Customer communications and file responses"}</h2></div><button className="icon-command" type="button" onClick={() => void addPresalesRound()} title={locale === "zh" ? "新增沟通节点" : "Add communication node"} aria-label={locale === "zh" ? "新增沟通节点" : "Add communication node"}><Plus size={18}/></button></div>
      <div className="presales-rounds">
        <div className="presales-round-head"><span>{locale === "zh" ? "沟通节点" : "Communication"}</span><span>{locale === "zh" ? "客户信息及需求" : "Customer information and needs"}</span><span>{locale === "zh" ? "执行清单与生成要求" : "Actions and generation request"}</span><span>{locale === "zh" ? "生成文件列表" : "Generated files"}</span></div>
        {project.presalesRounds.map((round, roundIndex) => {
          const priorGeneratedIds = project.presalesRounds.slice(0, roundIndex + 1).flatMap((item) => item.generatedFiles.map((file) => file.sourceId));
          const candidateIds = [...new Set([...priorGeneratedIds, ...round.referenceSourceIds])];
          const referenceCandidates = candidateIds.map((id) => project.sources.find((source) => source.id === id)).filter(Boolean);
          const customerSources = round.requirementSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter(Boolean);
          const selectedCustomerIds = selectedCustomerSourceIds(round);
          const templateSources = round.templateSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter(Boolean);
          const participantDraft = participantDrafts[round.id] || { name: "", category: "customer" as const };
          return <article className="presales-round" id={`communication-${round.id}`} key={round.id}>
            <div className="round-node">
              <span className="round-cell-label">{locale === "zh" ? "沟通节点" : "Communication"}</span>
              <input aria-label={locale === "zh" ? "沟通节点名称" : "Communication name"} value={round.title} onChange={(event) => updatePresalesRound(round.id, { title: event.target.value })}/>
              <LocalizedTemporalInput type="datetime-local" locale={locale} ariaLabel={locale === "zh" ? "沟通时间" : "Communication time"} emptyPlaceholder={locale === "zh" ? "年 / 月 / 日" : undefined} value={round.meetingAt} onChange={(value) => updatePresalesRound(round.id, { meetingAt: value })}/>
              <div className="participant-editor">
                <strong>{locale === "zh" ? "参与沟通人员" : "Participants"}</strong>
                <select aria-label={locale === "zh" ? "参会人员类别" : "Participant category"} value={participantDraft.category} onChange={(event) => setParticipantDrafts((current) => ({ ...current, [round.id]: { ...participantDraft, category: event.target.value as PresalesParticipant["category"] } }))}>{Object.entries(participantCategoryLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
                <div className="participant-input-row"><input aria-label={locale === "zh" ? "参会人员" : "Participant name"} placeholder={locale === "zh" ? "输入姓名或角色" : "Name or role"} value={participantDraft.name} onChange={(event) => setParticipantDrafts((current) => ({ ...current, [round.id]: { ...participantDraft, name: event.target.value } }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRoundParticipant(round); } }}/><button className="icon-command" type="button" aria-label={locale === "zh" ? "新增参会人员" : "Add participant"} title={locale === "zh" ? "新增参会人员" : "Add participant"} onClick={() => addRoundParticipant(round)}><Plus size={16}/></button></div>
                {round.participants.length > 0 && <div className="participant-groups">{(["customer", "third-party", "internal"] as const).map((category) => {
                  const participants = round.participants.filter((participant) => participant.category === category);
                  return participants.length > 0 && <div key={category}><span>{participantCategoryLabels[locale][category]}</span><div>{participants.map((participant) => <span key={participant.id}>{participant.name}<button type="button" aria-label={locale === "zh" ? `删除参会人员 ${participant.name}` : `Delete participant ${participant.name}`} title={locale === "zh" ? "删除参会人员" : "Delete participant"} onClick={() => updatePresalesRound(round.id, { participants: round.participants.filter((item) => item.id !== participant.id) })}><X size={12}/></button></span>)}</div></div>;
                })}</div>}
              </div>
              <button className="row-delete" type="button" title={t.remove} aria-label={`${t.remove}: ${round.title}`} onClick={() => void removePresalesRound(round)}><Trash2 size={17}/></button>
            </div>
            <div className="round-needs">
              <span className="round-cell-label">{locale === "zh" ? "客户信息及需求" : "Customer information and needs"}</span>
              <label className="file-command"><Upload size={16}/>{locale === "zh" ? "导入客户附件" : "Import customer attachments"}<input hidden multiple type="file" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv,.json" onChange={(event) => { void importPresalesFiles(event.target.files, { kind: "requirements", roundId: round.id }); event.currentTarget.value = ""; }}/></label>
              {customerSources.length > 0 && <div className="customer-source-panel">
                <div className="analysis-panel-heading"><strong>{locale === "zh" ? "已导入客户附件" : "Imported customer attachments"}</strong><label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? "全选客户附件" : "Select all customer attachments"} checked={round.requirementSourceIds.every((id) => selectedCustomerIds.includes(id))} onChange={(event) => selectAllCustomerSources(round, event.target.checked)}/><span><Check size={13}/></span>{locale === "zh" ? "全选" : "Select all"}</label></div>
                <div className="customer-source-list">{customerSources.map((source) => source && <div key={source.id}>
                  <label><input type="checkbox" aria-label={locale === "zh" ? `选择客户附件 ${source.name}` : `Select customer attachment ${source.name}`} checked={selectedCustomerIds.includes(source.id)} onChange={(event) => toggleCustomerSource(round, source.id, event.target.checked)}/><span><Check size={13}/></span><FileText size={15}/><strong>{source.name}</strong></label>
                  <button className="row-delete" type="button" title={locale === "zh" ? "删除客户附件" : "Delete customer attachment"} aria-label={locale === "zh" ? `删除客户附件 ${source.name}` : `Delete customer attachment ${source.name}`} onClick={() => void removePresalesSource(round, source.id, "requirements")}><Trash2 size={15}/></button>
                </div>)}</div>
              </div>}
              <div className="analysis-config-block keyword-config">
                <strong>{locale === "zh" ? "关键词" : "Keywords"}</strong>
                <div className="keyword-input-row"><input aria-label={locale === "zh" ? "新增关键词" : "New keyword"} value={keywordDrafts[round.id] || ""} onChange={(event) => setKeywordDrafts((current) => ({ ...current, [round.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addAnalysisKeyword(round, keywordDrafts[round.id] || ""); } }}/><button className="icon-command" type="button" aria-label={locale === "zh" ? "添加关键词" : "Add keyword"} title={locale === "zh" ? "添加关键词" : "Add keyword"} onClick={() => addAnalysisKeyword(round, keywordDrafts[round.id] || "")}><Plus size={17}/></button></div>
                <div className="recommended-keywords"><span>{locale === "zh" ? "推荐关键词" : "Recommended"}</span><div>{recommendedAnalysisKeywords[locale].map((keyword) => <button type="button" key={keyword} disabled={round.keywords.includes(keyword)} onClick={() => addAnalysisKeyword(round, keyword)}>{keyword}</button>)}</div></div>
                {round.keywords.length > 0 && <div className="selected-keywords">{round.keywords.map((keyword) => <span key={keyword}>{keyword}<button type="button" aria-label={locale === "zh" ? `删除关键词 ${keyword}` : `Delete keyword ${keyword}`} title={locale === "zh" ? "删除关键词" : "Delete keyword"} onClick={() => updatePresalesRound(round.id, { keywords: round.keywords.filter((item) => item !== keyword) })}><X size={13}/></button></span>)}</div>}
              </div>
              <ConfirmableTextarea fieldId={`presales-analysis-${round.id}`} label={locale === "zh" ? "分析要求" : "Analysis requirements"} locale={locale} rows={5} placeholder={locale === "zh" ? "输入模型分析时需要遵循的提示词、重点和输出要求" : "Enter the prompt, priorities, and output requirements for the model"} value={round.analysisRequirements} confirmed={project.confirmedTextFields.includes(`presales-analysis-${round.id}`)} onChange={(value) => updatePresalesRound(round.id, { analysisRequirements: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`presales-analysis-${round.id}`, confirmed)}/>
              <div className="analysis-config-block template-config">
                <label className="file-command"><Upload size={16}/>{locale === "zh" ? "上传模板" : "Upload templates"}<input hidden multiple type="file" accept=".docx,.pptx,.md" onChange={(event) => { void importPresalesFiles(event.target.files, { kind: "templates", roundId: round.id }); event.currentTarget.value = ""; }}/></label>
                {templateSources.length > 0 && <div className="template-source-list">{templateSources.map((source) => source && <div className={round.selectedTemplateSourceIds.includes(source.id) ? "selected" : ""} key={source.id}><button type="button" aria-pressed={round.selectedTemplateSourceIds.includes(source.id)} onClick={() => toggleAnalysisTemplate(round, source.id)}><FileText size={15}/><span>{source.name}</span></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除模板 ${source.name}` : `Delete template ${source.name}`} title={locale === "zh" ? "删除模板" : "Delete template"} onClick={() => void removePresalesSource(round, source.id, "templates")}><X size={14}/></button></div>)}</div>}
                <Field label={locale === "zh" ? "文件格式" : "Output format"}><select aria-label={locale === "zh" ? "分析结果文件格式" : "Analysis result output format"} value={round.analysisOutputFormat || ""} onChange={(event) => setAnalysisOutputFormat(round, event.target.value as ResponseFileFormat | "")}><option value="">{locale === "zh" ? "请选择" : "Select"}</option><option value="docx">Word</option><option value="pptx">PPT</option><option value="md">Markdown</option></select></Field>
              </div>
              <button className="generate-command analysis-command" type="button" disabled={busy || !round.requirementSourceIds.length} onClick={() => startCustomerAnalysis(round)}><Sparkles size={17}/>{analyzingRoundId === round.id ? (locale === "zh" ? "正在分析" : "Analyzing") : (locale === "zh" ? "需求分析" : "Analyze requirements")}</button>
              {round.analysisResults.length > 0 && <div className="analysis-result-list"><strong>{locale === "zh" ? "分析结果" : "Analysis results"}</strong>{round.analysisResults.map((result) => <article className={expandedAnalysisId === result.id ? "expanded" : ""} key={result.id}>
                <div><button type="button" onClick={() => { updatePresalesRound(round.id, { analysisRequirements: result.prompt }); setExpandedAnalysisId(expandedAnalysisId === result.id ? "" : result.id); }}><FileCheck2 size={16}/><span>{result.name}</span></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除分析结果 ${result.name}` : `Delete analysis result ${result.name}`} title={locale === "zh" ? "删除分析结果" : "Delete analysis result"} onClick={() => void removeAnalysisResult(round, result)}><X size={14}/></button></div>
                {expandedAnalysisId === result.id && <button className="open-analysis-file" type="button" onClick={() => void openAnalysisResult(result)}><ExternalLink size={15}/>{locale === "zh" ? `打开文件 · ${result.fileName}` : `Open file · ${result.fileName}`}</button>}
              </article>)}</div>}
            </div>
            <div className="round-actions">
              <span className="round-cell-label">{locale === "zh" ? "执行清单与生成要求" : "Actions and generation request"}</span>
              <div className="round-reference-box">
                <strong>{locale === "zh" ? "本轮参考资料" : "References for this round"}</strong>
                {referenceCandidates.length > 0 && <div className="reference-checks">{referenceCandidates.map((source) => source && <label key={source.id}><input type="checkbox" checked={round.referenceSourceIds.includes(source.id)} onChange={(event) => updatePresalesRound(round.id, { referenceSourceIds: event.target.checked ? [...new Set([...round.referenceSourceIds, source.id])] : round.referenceSourceIds.filter((id) => id !== source.id) })}/><span><Check size={13}/></span>{source.name}</label>)}</div>}
                <label className="file-command"><Upload size={16}/>{locale === "zh" ? "导入其他参考文件" : "Import another reference"}<input hidden multiple type="file" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv,.json" onChange={(event) => { void importPresalesFiles(event.target.files, { kind: "references", roundId: round.id }); event.currentTarget.value = ""; }}/></label>
              </div>
              <div className="round-action-list">{round.actions.map((action) => {
                const target = getActionResponseTarget(round, action);
                const actionTemplateSources = action.templateSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter(Boolean);
                return <div className="round-action-row" id={`response-action-${action.id}`} key={action.id}>
                  <div className="action-response-fields">
                    <Field label={locale === "zh" ? "响应文件名称" : "Response file name"}><input aria-label={locale === "zh" ? "响应文件名称" : "Response file name"} value={target.name} onChange={(event) => updateRoundAction(round, action.id, { responseFileName: event.target.value })}/></Field>
                    <Field label={locale === "zh" ? "响应文件格式" : "Response file format"}><select aria-label={locale === "zh" ? "响应文件格式" : "Response file format"} value={target.format} onChange={(event) => setActionResponseFormat(round, action, event.target.value as ResponseFileFormat | "")}><option value="">{locale === "zh" ? "请选择" : "Select"}</option><option value="docx">Word</option><option value="pptx">PPT</option><option value="md">Markdown</option></select></Field>
                    <button className="row-delete" type="button" title={t.remove} aria-label={t.remove} onClick={() => { setActionSelected(action.id, false); updatePresalesRound(round.id, { actions: round.actions.filter((item) => item.id !== action.id) }); }}><Trash2 size={15}/></button>
                  </div>
                  <Field label={t.owner}><input aria-label={t.owner} placeholder={t.owner} value={action.owner} onChange={(event) => updateRoundAction(round, action.id, { owner: event.target.value })}/></Field>
                  <div className="action-meta-fields">
                    <Field label={locale === "zh" ? "截止时间" : "Deadline"}><LocalizedTemporalInput type="date" locale={locale} ariaLabel={locale === "zh" ? "截止时间" : "Deadline"} value={action.dueDate} onChange={(value) => updateRoundAction(round, action.id, { dueDate: value })}/></Field>
                    <Field label={locale === "zh" ? "文件状态" : "File status"}><select aria-label={locale === "zh" ? "文件状态" : "File status"} value={action.status} onChange={(event) => updateRoundAction(round, action.id, { status: event.target.value as PresalesRoundAction["status"] })}>{Object.entries(actionStatusLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
                  </div>
                  <ConfirmableTextarea fieldId={`presales-file-requirements-${action.id}`} label={locale === "zh" ? "文件要求" : "File requirements"} locale={locale} rows={5} placeholder={locale === "zh" ? "说明文件格式、内容、参考模板、需继承的信息及不得承诺的事项" : "Describe formatting, content, reference templates, inherited information, and prohibited commitments"} value={action.fileRequirements || ""} confirmed={project.confirmedTextFields.includes(`presales-file-requirements-${action.id}`)} onChange={(value) => updateRoundAction(round, action.id, { fileRequirements: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`presales-file-requirements-${action.id}`, confirmed)}/>
                  <div className="analysis-config-block template-config action-template-config">
                    <strong>{locale === "zh" ? "响应文件模板" : "Response file templates"}</strong>
                    <label className="file-command"><Upload size={16}/>{locale === "zh" ? "上传模板" : "Upload templates"}<input hidden multiple type="file" accept=".docx,.pptx,.md" onChange={(event) => { void importPresalesFiles(event.target.files, { kind: "action-templates", roundId: round.id, actionId: action.id }); event.currentTarget.value = ""; }}/></label>
                    {actionTemplateSources.length > 0 && <div className="template-source-list">{actionTemplateSources.map((source) => source && <div className={action.selectedTemplateSourceIds.includes(source.id) ? "selected" : ""} key={source.id}><button type="button" aria-pressed={action.selectedTemplateSourceIds.includes(source.id)} onClick={() => toggleActionTemplate(round, action, source.id)}><FileText size={15}/><span>{source.name}</span></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除响应文件模板 ${source.name}` : `Delete response file template ${source.name}`} title={locale === "zh" ? "删除模板" : "Delete template"} onClick={() => void removePresalesSource(round, source.id, "action-templates", action.id)}><X size={14}/></button></div>)}</div>}
                  </div>
                  <div className="action-command-row">
                    <label className="action-select" title={locale === "zh" ? "选择该项" : "Select this item"}><input type="checkbox" aria-label={locale === "zh" ? `选择响应文件 ${target.name || "未命名"}` : `Select response file ${target.name || "unnamed"}`} checked={selectedActionIds.has(action.id)} onChange={(event) => setActionSelected(action.id, event.target.checked)}/><span><Check size={16}/></span></label>
                    <button className="generate-command" type="button" disabled={busy} onClick={() => startPresalesFiles(round, [action])}><Sparkles size={17}/>{generatingActionId === `file-${action.id}` ? (locale === "zh" ? "处理中" : "Working") : (locale === "zh" ? "生成文件" : "Generate file")}</button>
                  </div>
                </div>;
              })}</div>
              <button className="inline-command" type="button" onClick={() => addRoundAction(round)}><Plus size={15}/>{locale === "zh" ? "新增执行项" : "Add action"}</button>
              <div className="bulk-action-row">
                <label className="action-select" title={locale === "zh" ? "选择本轮全部执行项" : "Select all actions in this round"}><input type="checkbox" aria-label={locale === "zh" ? "选择本轮全部执行项" : "Select all actions in this round"} disabled={!round.actions.length} checked={round.actions.length > 0 && round.actions.every((action) => selectedActionIds.has(action.id))} onChange={(event) => setRoundActionsSelected(round, event.target.checked)}/><span><Check size={16}/></span></label>
                <button className="generate-command" type="button" disabled={busy || !checkedActions(round).length} onClick={() => startPresalesFiles(round, checkedActions(round))}><Sparkles size={17}/>{generatingActionId === `batch-file-${round.id}` ? (locale === "zh" ? "处理中" : "Working") : (locale === "zh" ? "批量生成文件" : "Generate files")}</button>
              </div>
            </div>
            <div className="round-outputs">
              <span className="round-cell-label">{locale === "zh" ? "生成文件列表" : "Generated files"}</span>
              {round.generatedFiles.length ? round.generatedFiles.map((file) => { const sourceAction = round.actions.find((action) => action.id === file.actionId); const sourceName = sourceAction ? getActionResponseTarget(round, sourceAction).name : ""; return <button className="generated-file" type="button" key={file.id} onClick={() => void openGeneratedFile(file)}><FileCheck2 size={18}/><span><strong>{file.name}</strong><small>{sourceName || (locale === "zh" ? "历史响应文件" : "Legacy response file")} · {new Date(file.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")} · {file.provider} / {file.model}</small></span><ExternalLink size={15}/></button>; }) : <div className="round-empty"><FileOutput size={22}/><span>{locale === "zh" ? "本轮尚未生成文件" : "No files generated for this round"}</span></div>}
            </div>
          </article>;
        })}
        {!project.presalesRounds.length && <div className="empty-state"><FileInput size={24}/><p>{locale === "zh" ? "新增沟通节点后开始记录。" : "Add a communication node to begin."}</p></div>}
      </div>
    </section>
  </>;

  const renderTenderSourceList = (sourceIds: string[], selectedIds: string[], onToggle: (sourceId: string, checked: boolean) => void) => <div className="tender-source-list">{sourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source)).map((source) => {
    const expanded = expandedTenderSourceId === source.id;
    const progress = ocrProgress[source.id];
    return <article className={expanded ? "expanded" : ""} key={source.id}>
      <div className="tender-source-summary">
        <label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? `选择文件 ${source.name}` : `Select file ${source.name}`} checked={selectedIds.includes(source.id)} onChange={(event) => onToggle(source.id, event.target.checked)}/><span><Check size={13}/></span></label>
        <button type="button" onClick={() => setExpandedTenderSourceId(expanded ? "" : source.id)}><span className="source-kind-icon">{["png", "jpg", "jpeg", "webp"].includes(source.fileType) ? <FileImage size={18}/> : <FileText size={18}/>}</span><span><strong>{source.name}</strong><small className={source.preprocessStatus}>{preprocessStatusLabels[locale][source.preprocessStatus]}</small>{source.preprocessMessage && source.preprocessMessage !== preprocessStatusLabels[locale][source.preprocessStatus] && <small>{source.preprocessMessage}</small>}</span>{source.requiresOcr && <AlertTriangle size={16}/>}</button>
      </div>
      {progress !== undefined && <div className="ocr-progress" aria-label={locale === "zh" ? `${source.name} 识别进度` : `${source.name} recognition progress`}><span style={{ width: `${progress}%` }}></span></div>}
      {expanded && <div className="tender-source-actions"><button type="button" disabled={source.preprocessStatus === "ready" || source.preprocessStatus === "processing"} onClick={() => preprocessTenderSources([source.id])}><RefreshCw size={15}/>{locale === "zh" ? "预处理" : "Preprocess"}</button><button type="button" onClick={() => void openSourceFile(source)}><ExternalLink size={15}/>{locale === "zh" ? "打开文件" : "Open file"}</button><button type="button" onClick={() => void removeTenderSources([source.id])}><Trash2 size={15}/>{locale === "zh" ? "删除" : "Delete"}</button></div>}
    </article>;
  })}</div>;

  const renderTenderTemplates = (kind: "analysis" | "comparison") => {
    const config = kind === "analysis" ? project.tenderAnalysis : project.tenderComparison;
    const sources = config.templateSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    return <div className="analysis-config-block template-config">
      <label className="file-command"><Upload size={16}/>{locale === "zh" ? "上传模板" : "Upload templates"}<input hidden multiple type="file" accept={kind === "comparison" ? ".docx,.xlsx,.pptx,.md" : ".docx,.pptx,.md"} onChange={(event) => { void importTenderFiles(event.target.files, { kind: kind === "analysis" ? "analysis-template" : "comparison-template" }); event.currentTarget.value = ""; }}/></label>
      {sources.length > 0 && <div className="template-source-list">{sources.map((source) => <div className={config.selectedTemplateSourceIds.includes(source.id) ? "selected" : ""} key={source.id}><button type="button" aria-pressed={config.selectedTemplateSourceIds.includes(source.id)} onClick={() => toggleTenderTemplate(kind, source.id)}><FileText size={15}/><span>{source.name}</span></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除模板 ${source.name}` : `Delete template ${source.name}`} onClick={() => void removeTenderSources([source.id])}><X size={14}/></button></div>)}</div>}
      <Field label={locale === "zh" ? "文件格式" : "Output format"}><select aria-label={kind === "analysis" ? (locale === "zh" ? "招标分析文件格式" : "Tender analysis format") : (locale === "zh" ? "对比结果文件格式" : "Comparison format")} value={config.outputFormat || ""} onChange={(event) => setTenderOutputFormat(kind, event.target.value as TenderOutputFormat | "")}><option value="">{locale === "zh" ? "请选择" : "Select"}</option><option value="docx">Word</option>{kind === "comparison" && <option value="xlsx">Excel</option>}<option value="pptx">PPT</option><option value="md">Markdown</option></select></Field>
    </div>;
  };

  const renderRequirements = () => {
    const tenderSources = project.tenderSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
    const allTenderSelected = tenderSources.length > 0 && tenderSources.every((source) => project.selectedTenderSourceIds.includes(source.id));
    const presalesGroups = [
      { id: "attachments", label: locale === "zh" ? "已导入客户附件" : "Imported customer attachments", ids: [...new Set(project.presalesRounds.flatMap((round) => round.requirementSourceIds))] },
      { id: "summaries", label: locale === "zh" ? "生成的总结文件" : "Generated summaries", ids: [...new Set(project.presalesRounds.flatMap((round) => round.analysisResults.map((result) => result.sourceId)))] },
      { id: "generated", label: locale === "zh" ? "生成的文件" : "Generated files", ids: [...new Set(project.presalesRounds.flatMap((round) => round.generatedFiles.map((file) => file.sourceId)))] },
    ];
    const allPresalesIds = [...new Set(presalesGroups.flatMap((group) => group.ids))];
    const allPresalesSelected = allPresalesIds.length > 0 && allPresalesIds.every((id) => project.tenderComparison.selectedPresalesSourceIds.includes(id));
    const comparisonResults = project.tenderComparison.results;
    return <>
      <section className="work-section" id="tender-files">
        <div className="section-heading"><div><h2>{t.sourceLibrary}</h2><span className="section-description">{t.noSource}</span></div><button className="command-button" type="button" disabled={busy} onClick={() => openGuardedFilePicker(sourceInput.current)}><Upload size={17}/>{t.importSources}</button></div>
        <input ref={sourceInput} hidden multiple type="file" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => { void importTenderFiles(event.target.files, { kind: "tender" }); event.currentTarget.value = ""; }}/>
        {tenderSources.length ? <>
          <div className="tender-file-toolbar"><label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? "全选招标文件" : "Select all tender files"} checked={allTenderSelected} onChange={(event) => updateProject("selectedTenderSourceIds", event.target.checked ? [...project.tenderSourceIds] : [])}/><span><Check size={13}/></span>{locale === "zh" ? "全选" : "Select all"}</label><button type="button" disabled={!project.selectedTenderSourceIds.length || busy} onClick={() => preprocessTenderSources(project.selectedTenderSourceIds)}><RefreshCw size={16}/>{locale === "zh" ? "预处理" : "Preprocess"}</button><button type="button" className="danger-command" disabled={busy} onClick={() => void removeTenderSources(project.tenderSourceIds)}><Trash2 size={16}/>{locale === "zh" ? "删除全部导入文件" : "Delete all imported files"}</button></div>
          {renderTenderSourceList(project.tenderSourceIds, project.selectedTenderSourceIds, (sourceId, checked) => updateProject("selectedTenderSourceIds", checked ? [...new Set([...project.selectedTenderSourceIds, sourceId])] : project.selectedTenderSourceIds.filter((id) => id !== sourceId)))}
        </> : <div className="empty-state"><FileInput size={28}/><p>{t.noSource}</p></div>}
      </section>

      <section className="work-section tender-clarifications">
        <div className="section-heading"><div><h2>{locale === "zh" ? "澄清及相关文件" : "Clarifications and related files"}</h2></div><button className="icon-command" type="button" aria-label={locale === "zh" ? "新增澄清节点" : "Add clarification node"} onClick={() => void addTenderClarificationRound()}><Plus size={18}/></button></div>
        <div className="clarification-head"><span>{locale === "zh" ? "时间节点" : "Timeline"}</span><span>{locale === "zh" ? "澄清文件" : "Clarification files"}</span></div>
        {project.tenderClarificationRounds.map((round) => <article className="clarification-row" id={`clarification-${round.id}`} key={round.id}>
          <div className="clarification-node">
            <input aria-label={locale === "zh" ? "澄清节点名称" : "Clarification name"} value={round.title} onChange={(event) => updateProject("tenderClarificationRounds", project.tenderClarificationRounds.map((item) => item.id === round.id ? { ...item, title: event.target.value } : item))}/>
            <LocalizedTemporalInput type="datetime-local" locale={locale} ariaLabel={locale === "zh" ? "澄清时间" : "Clarification time"} value={round.occurredAt} onChange={(value) => updateProject("tenderClarificationRounds", project.tenderClarificationRounds.map((item) => item.id === round.id ? { ...item, occurredAt: value } : item))}/>
            <button className="row-delete" type="button" aria-label={locale === "zh" ? `删除澄清节点 ${round.title}` : `Delete clarification ${round.title}`} onClick={() => void removeTenderClarificationRound(round.id)}><Trash2 size={16}/></button>
          </div>
          <div className="clarification-files">
            <label className="file-command"><Upload size={16}/>{locale === "zh" ? "导入澄清文件" : "Import clarification files"}<input hidden multiple type="file" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => { void importTenderFiles(event.target.files, { kind: "clarification", roundId: round.id }); event.currentTarget.value = ""; }}/></label>
            {round.sourceIds.length > 0 && <label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? `全选 ${round.title} 文件` : `Select all files in ${round.title}`} checked={round.sourceIds.every((id) => round.selectedSourceIds.includes(id))} onChange={(event) => updateProject("tenderClarificationRounds", project.tenderClarificationRounds.map((item) => item.id === round.id ? { ...item, selectedSourceIds: event.target.checked ? [...item.sourceIds] : [] } : item))}/><span><Check size={13}/></span>{locale === "zh" ? "全选" : "Select all"}</label>}
            {renderTenderSourceList(round.sourceIds, round.selectedSourceIds, (sourceId, checked) => updateProject("tenderClarificationRounds", project.tenderClarificationRounds.map((item) => item.id === round.id ? { ...item, selectedSourceIds: checked ? [...new Set([...item.selectedSourceIds, sourceId])] : item.selectedSourceIds.filter((id) => id !== sourceId) } : item)))}
          </div>
        </article>)}
        {!project.tenderClarificationRounds.length && <div className="empty-state"><FileSearch size={26}/><p>{locale === "zh" ? "有补遗或澄清时新增时间节点。" : "Add a timeline node when an addendum or clarification arrives."}</p></div>}
      </section>

      <section className="work-section" id="tender-analysis">
        <div className="section-heading"><div><h2>{locale === "zh" ? "招标文件分析" : "Tender file analysis"}</h2></div></div>
        <div className="tender-analysis-grid">
          <div className="tender-analysis-pane"><div className="pane-title"><div><h3>{locale === "zh" ? "招标要求分析" : "Tender requirement analysis"}</h3></div></div>
            <div className="analysis-config-block keyword-config"><strong>{locale === "zh" ? "关键词" : "Keywords"}</strong><div className="keyword-input-row"><input aria-label={locale === "zh" ? "新增招标分析关键词" : "New tender keyword"} value={tenderKeywordDraft} onChange={(event) => setTenderKeywordDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const value = tenderKeywordDraft.trim(); if (value && !project.tenderAnalysis.keywords.includes(value)) updateProject("tenderAnalysis", { ...project.tenderAnalysis, keywords: [...project.tenderAnalysis.keywords, value] }); setTenderKeywordDraft(""); } }}/><button className="icon-command" type="button" aria-label={locale === "zh" ? "添加招标分析关键词" : "Add tender keyword"} onClick={() => { const value = tenderKeywordDraft.trim(); if (value && !project.tenderAnalysis.keywords.includes(value)) updateProject("tenderAnalysis", { ...project.tenderAnalysis, keywords: [...project.tenderAnalysis.keywords, value] }); setTenderKeywordDraft(""); }}><Plus size={17}/></button></div><div className="recommended-keywords"><span>{locale === "zh" ? "推荐关键词" : "Recommended"}</span><div>{recommendedAnalysisKeywords[locale].map((keyword) => <button type="button" key={keyword} disabled={project.tenderAnalysis.keywords.includes(keyword)} onClick={() => updateProject("tenderAnalysis", { ...project.tenderAnalysis, keywords: [...project.tenderAnalysis.keywords, keyword] })}>{keyword}</button>)}</div></div>{project.tenderAnalysis.keywords.length > 0 && <div className="selected-keywords">{project.tenderAnalysis.keywords.map((keyword) => <span key={keyword}>{keyword}<button type="button" aria-label={locale === "zh" ? `删除招标分析关键词 ${keyword}` : `Delete tender keyword ${keyword}`} onClick={() => updateProject("tenderAnalysis", { ...project.tenderAnalysis, keywords: project.tenderAnalysis.keywords.filter((item) => item !== keyword) })}><X size={13}/></button></span>)}</div>}</div>
            <ConfirmableTextarea fieldId="tender-analysis-requirements" label={locale === "zh" ? "分析要求" : "Analysis requirements"} ariaLabel={locale === "zh" ? "招标分析要求" : "Tender analysis requirements"} locale={locale} rows={6} value={project.tenderAnalysis.analysisRequirements} confirmed={project.confirmedTextFields.includes("tender-analysis-requirements")} onChange={(value) => updateProject("tenderAnalysis", { ...project.tenderAnalysis, analysisRequirements: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed("tender-analysis-requirements", confirmed)} placeholder={locale === "zh" ? "说明需要提炼的时间、参数、评标、资质、废标项和投标文件清单" : "Describe deadlines, parameters, scoring, qualifications, rejection rules, and the bid-file checklist to extract"}/>
            {renderTenderTemplates("analysis")}
            <button className="generate-command analysis-command" type="button" disabled={busy || !project.selectedTenderSourceIds.length} onClick={() => startTenderAnalysis("analysis")}><Sparkles size={17}/>{generatingActionId === "tender-analysis" ? (locale === "zh" ? "正在分析" : "Analyzing") : (locale === "zh" ? "招标要求分析" : "Analyze tender requirements")}</button>
            {project.tenderAnalysis.results.length > 0 && <div className="analysis-result-list"><strong>{locale === "zh" ? "分析结果" : "Analysis results"}</strong>{project.tenderAnalysis.results.map((result) => <article className={expandedTenderResultId === result.id ? "expanded" : ""} key={result.id}><div><button type="button" onClick={() => { setExpandedTenderResultId(expandedTenderResultId === result.id ? "" : result.id); updateProject("tenderAnalysis", { ...project.tenderAnalysis, analysisRequirements: result.prompt }); }}><FileCheck2 size={16}/><span>{result.name}</span></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除分析结果 ${result.name}` : `Delete analysis result ${result.name}`} onClick={() => void removeTenderResult(result)}><X size={14}/></button></div>{expandedTenderResultId === result.id && <button className="open-analysis-file" type="button" onClick={() => void openTenderResult(result)}><ExternalLink size={15}/>{locale === "zh" ? `打开文件 · ${result.fileName}` : `Open file · ${result.fileName}`}</button>}</article>)}</div>}
          </div>

          <div className="tender-analysis-pane"><div className="pane-title"><div><h3>{locale === "zh" ? "售前文件对比" : "Presales file comparison"}</h3></div></div>
            <div className="presales-source-selector"><div className="analysis-panel-heading"><strong>{locale === "zh" ? "售前阶段文件" : "Presales files"}</strong><label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? "全选售前文件" : "Select all presales files"} disabled={!allPresalesIds.length} checked={allPresalesSelected} onChange={(event) => updateProject("tenderComparison", { ...project.tenderComparison, selectedPresalesSourceIds: event.target.checked ? allPresalesIds : [] })}/><span><Check size={13}/></span>{locale === "zh" ? "全选" : "Select all"}</label></div>{presalesGroups.map((group) => <div className="presales-source-group" key={group.id}><strong>{group.label}</strong>{group.ids.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source)).map((source) => <label key={source.id}><input type="checkbox" checked={project.tenderComparison.selectedPresalesSourceIds.includes(source.id)} onChange={(event) => updateProject("tenderComparison", { ...project.tenderComparison, selectedPresalesSourceIds: event.target.checked ? [...new Set([...project.tenderComparison.selectedPresalesSourceIds, source.id])] : project.tenderComparison.selectedPresalesSourceIds.filter((id) => id !== source.id) })}/><span><Check size={13}/></span><FileText size={15}/>{source.name}</label>)}{!group.ids.length && <small>{locale === "zh" ? "暂无文件" : "No files"}</small>}</div>)}</div>
            {renderTenderTemplates("comparison")}
            <button className="generate-command analysis-command" type="button" disabled={busy || !project.selectedTenderSourceIds.length || !project.tenderComparison.selectedPresalesSourceIds.length} onClick={() => startTenderAnalysis("comparison")}><Sparkles size={17}/>{generatingActionId === "tender-comparison" ? (locale === "zh" ? "正在对比" : "Comparing") : (locale === "zh" ? "对比" : "Compare")}</button>
          </div>
        </div>
      </section>

      <section className="work-section"><div className="section-heading"><div><h2>{t.baselineDiff}</h2></div><span>{comparisonResults.length}</span></div><div className="tender-difference-results">{comparisonResults.map((result) => <article key={result.id}><header><button type="button" onClick={() => void openTenderResult(result)}><FileSpreadsheet size={18}/><span><strong>{result.name}</strong><small>{result.fileName} · {new Date(result.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</small></span><ExternalLink size={15}/></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除对比结果 ${result.name}` : `Delete comparison ${result.name}`} onClick={() => void removeTenderResult(result)}><Trash2 size={16}/></button></header>{result.differences.map((difference, index) => <div className="diff-list" key={`${result.id}-${index}`}><div><span className={`relation ${difference.relation}`}>{diffRelationLabels[locale][difference.relation]}</span><p>{difference.presales || (locale === "zh" ? "未提供" : "Not provided")}</p><ChevronRight size={16}/><p>{difference.tender || (locale === "zh" ? "未提供" : "Not provided")}</p></div></div>)}</article>)}{!comparisonResults.length && <div className="empty-state"><FileSpreadsheet size={26}/><p>{locale === "zh" ? "完成售前文件对比后，结果会按分析批次显示在这里。" : "Comparison results will appear here by analysis run."}</p></div>}</div></section>

      <section className="work-section"><div className="section-heading"><div><h2>{locale === "zh" ? "投标文件清单" : "Bid file checklist"}</h2></div><span>{project.bidFileChecklist.length}</span></div><div className="bid-file-checklist">{project.bidFileChecklist.map((item) => <div key={item.id}><label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? `确认投标文件 ${item.title}` : `Confirm bid file ${item.title}`} checked={item.status === "confirmed"} onChange={(event) => updateProject("bidFileChecklist", project.bidFileChecklist.map((entry) => entry.id === item.id ? { ...entry, status: event.target.checked ? "confirmed" : "pending" } : entry))}/><span><Check size={13}/></span></label><select aria-label={locale === "zh" ? `文件类别 ${item.title}` : `File category ${item.title}`} value={item.category} onChange={(event) => updateProject("bidFileChecklist", project.bidFileChecklist.map((entry) => entry.id === item.id ? { ...entry, category: event.target.value as BidFileChecklistItem["category"] } : entry))}>{Object.entries(bidFileCategoryLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input aria-label={locale === "zh" ? "投标文件名称" : "Bid file name"} value={item.title} onChange={(event) => updateProject("bidFileChecklist", project.bidFileChecklist.map((entry) => entry.id === item.id ? { ...entry, title: event.target.value } : entry))}/><input aria-label={locale === "zh" ? `投标文件说明 ${item.title}` : `Bid file notes ${item.title}`} placeholder={locale === "zh" ? "来源、责任人或待确认事项" : "Source, owner, or open questions"} value={item.notes} onChange={(event) => updateProject("bidFileChecklist", project.bidFileChecklist.map((entry) => entry.id === item.id ? { ...entry, notes: event.target.value } : entry))}/><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除投标文件 ${item.title}` : `Delete bid file ${item.title}`} onClick={() => void removeBidChecklistItem(item)}><Trash2 size={16}/></button></div>)}</div>{!project.bidFileChecklist.length && <div className="empty-state"><FileOutput size={26}/><p>{locale === "zh" ? "招标要求分析后，识别到的投标文件会逐项加入清单。" : "Files identified by tender analysis will be added here."}</p></div>}</section>
    </>;
  };

  const renderBid = () => <section className="work-section" id="bid-output">
    <div className="section-heading"><div><h2>{locale === "zh" ? "投标文件输出" : "Bid file output"}</h2></div><span>{project.bidFileChecklist.length}</span></div>
    {project.bidFileChecklist.length ? <div className="bid-output-list">{project.bidFileChecklist.map((item) => {
      const expanded = expandedBidFileId === item.id;
      const templates = item.templateSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
      const references = item.referenceSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
      const allReferencesSelected = references.length > 0 && references.every((source) => item.selectedReferenceSourceIds.includes(source.id));
      return <article className={expanded ? "expanded" : ""} id={`bid-output-${item.id}`} key={item.id}>
        <button className="bid-output-summary" type="button" aria-expanded={expanded} onClick={() => setExpandedBidFileId(expanded ? "" : item.id)}>
          <FileOutput size={21}/><span><strong>{item.title}</strong><small>{bidFileCategoryLabels[locale][item.category]}{item.notes ? ` · ${item.notes}` : ""}</small></span><span>{item.generatedFiles.length ? (locale === "zh" ? `已生成 ${item.generatedFiles.length}` : `${item.generatedFiles.length} generated`) : (locale === "zh" ? "待编制" : "Not generated")}</span><ChevronRight size={18}/>
        </button>
        {expanded && <div className="bid-output-editor">
          <div className="bid-material-grid">
            <section><div className="bid-editor-heading"><strong>{locale === "zh" ? "文件模板" : "File template"}</strong><label className="file-command"><Upload size={16}/>{locale === "zh" ? "上传模板" : "Upload template"}<input hidden type="file" accept=".docx,.xlsx,.pptx,.md" onChange={(event) => { void importBidFiles(item, event.target.files, "template"); event.currentTarget.value = ""; }}/></label></div>{templates.length ? <div className="template-source-list">{templates.map((source) => <div className={item.selectedTemplateSourceIds.includes(source.id) ? "selected" : ""} key={source.id}><button type="button" aria-pressed={item.selectedTemplateSourceIds.includes(source.id)} onClick={() => toggleBidTemplate(item, source.id)}><FileText size={15}/><span>{source.name}</span></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除模板 ${source.name}` : `Delete template ${source.name}`} onClick={() => void removeBidSource(item, source.id, "template")}><X size={14}/></button></div>)}</div> : <div className="bid-material-empty">{locale === "zh" ? "未上传时使用通用模板" : "A general template will be used"}</div>}</section>
            <section><div className="bid-editor-heading"><strong>{locale === "zh" ? "参考资料" : "Reference materials"}</strong><label className="file-command"><Upload size={16}/>{locale === "zh" ? "上传参考资料" : "Upload references"}<input hidden multiple type="file" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => { void importBidFiles(item, event.target.files, "reference"); event.currentTarget.value = ""; }}/></label></div>{references.length ? <><label className="compact-check bid-select-all"><input type="checkbox" aria-label={locale === "zh" ? `全选 ${item.title} 参考资料` : `Select all references for ${item.title}`} checked={allReferencesSelected} onChange={(event) => updateBidFile(item.id, { selectedReferenceSourceIds: event.target.checked ? references.map((source) => source.id) : [] })}/><span><Check size={13}/></span>{locale === "zh" ? "全选" : "Select all"}</label><div className="customer-source-list">{references.map((source) => <div key={source.id}><label><input type="checkbox" aria-label={locale === "zh" ? `选择参考资料 ${source.name}` : `Select reference ${source.name}`} checked={item.selectedReferenceSourceIds.includes(source.id)} onChange={(event) => updateBidFile(item.id, { selectedReferenceSourceIds: event.target.checked ? [...new Set([...item.selectedReferenceSourceIds, source.id])] : item.selectedReferenceSourceIds.filter((id) => id !== source.id) })}/><span><Check size={12}/></span><FileText size={15}/><strong>{source.name}</strong></label><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除参考资料 ${source.name}` : `Delete reference ${source.name}`} onClick={() => void removeBidSource(item, source.id, "reference")}><X size={14}/></button></div>)}</div></> : <div className="bid-material-empty">{locale === "zh" ? "尚未上传参考资料" : "No references uploaded"}</div>}</section>
          </div>
          <div className="bid-output-fields"><Field label={locale === "zh" ? "输出格式" : "Output format"}><select aria-label={locale === "zh" ? `输出格式 ${item.title}` : `Output format ${item.title}`} value={item.outputFormat || ""} onChange={(event) => setBidOutputFormat(item, event.target.value as TenderOutputFormat | "")}><option value="">{locale === "zh" ? "请选择" : "Select"}</option><option value="docx">Word</option><option value="xlsx">Excel</option><option value="pptx">PPT</option><option value="md">Markdown</option></select></Field><ConfirmableTextarea fieldId={`bid-detail-${item.id}`} wide label={locale === "zh" ? "细节要求" : "Detailed requirements"} ariaLabel={locale === "zh" ? `细节要求 ${item.title}` : `Detailed requirements ${item.title}`} locale={locale} rows={7} placeholder={locale === "zh" ? "填写文件范围、重点内容、章节结构、语气、不得承诺事项及需继承的模板要求" : "Specify scope, emphasis, structure, tone, prohibited commitments, and template requirements"} value={item.detailRequirements} confirmed={project.confirmedTextFields.includes(`bid-detail-${item.id}`)} onChange={(value) => updateBidFile(item.id, { detailRequirements: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`bid-detail-${item.id}`, confirmed)}/></div>
          <button className="generate-command bid-generate-command" type="button" disabled={busy} onClick={() => startBidFileGeneration(item)}><Sparkles size={18}/>{generatingActionId === `bid-output-${item.id}` ? (locale === "zh" ? "正在生成…" : "Generating…") : (locale === "zh" ? "生成文件" : "Generate file")}</button>
          {item.generatedFiles.length > 0 && <div className="bid-generated-list"><strong>{locale === "zh" ? "已生成文件" : "Generated files"}</strong>{item.generatedFiles.map((record) => <div key={record.id}><button type="button" onClick={() => void openBidGeneratedFile(record)}><FileCheck2 size={17}/><span><strong>{record.name}</strong><small>{record.provider} / {record.model} · {new Date(record.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</small></span><ExternalLink size={15}/></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除生成文件 ${record.name}` : `Delete generated file ${record.name}`} onClick={() => void removeBidGeneratedFile(item, record)}><Trash2 size={16}/></button></div>)}</div>}
        </div>}
      </article>;
    })}</div> : <div className="empty-state"><FileOutput size={26}/><p>{locale === "zh" ? "招标要求分析生成投标文件清单后，文件会同步显示在这里。" : "Files will appear here after tender analysis creates the bid file checklist."}</p></div>}
  </section>;

  const renderHandover = () => {
    const awardSources = project.handover.awardSourceIds
      .map((id) => project.sources.find((source) => source.id === id))
      .filter((source): source is SourceDocument => Boolean(source));
    const bidRecords = handoverBidRecords();
    const bidSourceIds = [...new Set(bidRecords.map(({ record }) => record.sourceId))];
    const allAwardSelected = awardSources.length > 0 && awardSources.every((source) => project.handover.selectedAwardSourceIds.includes(source.id));
    const allBidSelected = bidSourceIds.length > 0 && bidSourceIds.every((id) => !project.handover.excludedBidSourceIds.includes(id));

    return <>
      <section className="work-section" id="handover-award">
        <div className="section-heading"><div><h2>{locale === "zh" ? "中标补充内容" : "Award supplements"}</h2></div><span>{awardSources.length}</span></div>
        <div className="handover-award-layout">
          <div className="handover-source-panel">
            <div className="handover-panel-heading"><strong>{locale === "zh" ? "中标函及相关资料" : "Award letter and related files"}</strong><label className="file-command"><Upload size={16}/>{locale === "zh" ? "上传资料" : "Upload files"}<input hidden multiple type="file" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => { void importHandoverAwardFiles(event.target.files); event.currentTarget.value = ""; }}/></label></div>
            {awardSources.length ? <>
              <label className="compact-check handover-select-all"><input type="checkbox" checked={allAwardSelected} onChange={(event) => updateHandover({ selectedAwardSourceIds: event.target.checked ? awardSources.map((source) => source.id) : [] })}/><span><Check size={13}/></span>{locale === "zh" ? "全选" : "Select all"}</label>
              <div className="handover-source-list">{awardSources.map((source) => <div key={source.id}><label><input type="checkbox" checked={project.handover.selectedAwardSourceIds.includes(source.id)} onChange={(event) => updateHandover({ selectedAwardSourceIds: event.target.checked ? [...new Set([...project.handover.selectedAwardSourceIds, source.id])] : project.handover.selectedAwardSourceIds.filter((id) => id !== source.id) })}/><span><Check size={12}/></span><FileText size={16}/><strong>{source.name}</strong><small>{source.requiresOcr ? (locale === "zh" ? "需要 OCR" : "OCR required") : (locale === "zh" ? "可用于交底" : "Ready for handover")}</small></label><button type="button" aria-label={locale === "zh" ? `打开 ${source.name}` : `Open ${source.name}`} onClick={() => void openSourceFile(source)}><ExternalLink size={15}/></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除 ${source.name}` : `Delete ${source.name}`} onClick={() => void removeHandoverSource(source.id, "award")}><Trash2 size={15}/></button></div>)}</div>
            </> : <div className="handover-empty-line"><FileInput size={20}/><span>{locale === "zh" ? "可上传中标函、合同技术附件、最终澄清函等资料。" : "Upload the award letter, contract technical annexes, or final clarifications."}</span></div>}
          </div>
          <ConfirmableTextarea fieldId="handover-award-notes" label={locale === "zh" ? "中标说明" : "Award notes"} locale={locale} rows={8} value={project.handover.awardNotes} confirmed={project.confirmedTextFields.includes("handover-award-notes")} onChange={(value) => updateHandover({ awardNotes: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed("handover-award-notes", confirmed)} placeholder={locale === "zh" ? "记录中标范围、合同技术边界、最终澄清结论和仍待确认事项" : "Record awarded scope, contract technical boundaries, final clarifications, and open questions"}/>
        </div>
      </section>

      <section className="work-section" id="handover-checklist">
        <div className="section-heading"><div><h2>{locale === "zh" ? "交底清单输出" : "Handover checklist"}</h2></div><span>{project.handover.tasks.length}</span></div>

        <div className="handover-baseline">
          <div><span>{locale === "zh" ? "项目名称" : "Project"}</span><strong>{project.name}</strong></div>
          <div><span>{locale === "zh" ? "客户代称" : "Customer alias"}</span><strong>{project.customerAlias || (locale === "zh" ? "未填写" : "Not provided")}</strong></div>
          <div><span>{locale === "zh" ? "行业" : "Industry"}</span><strong>{project.industry || (locale === "zh" ? "未填写" : "Not provided")}</strong></div>
        </div>

        <div className="handover-identifiers">
          <Field label={locale === "zh" ? "交底清单编号" : "Handover checklist no."}><input value={project.handover.checklistNumber} onChange={(event) => updateHandover({ checklistNumber: event.target.value })}/></Field>
          <Field label={locale === "zh" ? "项目编号" : "Project no."}><input value={project.handover.projectNumber} onChange={(event) => updateHandover({ projectNumber: event.target.value })}/></Field>
        </div>

        <div className="handover-subsection">
          <div className="handover-panel-heading"><div><strong>{locale === "zh" ? "最终投标文件" : "Final bid files"}</strong><small>{locale === "zh" ? "已生成的投标文件默认全部参与任务分拆" : "Generated bid files are selected by default"}</small></div>{bidSourceIds.length > 0 && <label className="compact-check"><input type="checkbox" checked={allBidSelected} onChange={(event) => updateHandover({ excludedBidSourceIds: event.target.checked ? [] : bidSourceIds })}/><span><Check size={13}/></span>{locale === "zh" ? "全选" : "Select all"}</label>}</div>
          {bidRecords.length ? <div className="handover-bid-source-list">{bidRecords.map(({ item, record }) => <label key={record.id}><input type="checkbox" checked={!project.handover.excludedBidSourceIds.includes(record.sourceId)} onChange={(event) => updateHandover({ excludedBidSourceIds: event.target.checked ? project.handover.excludedBidSourceIds.filter((id) => id !== record.sourceId) : [...new Set([...project.handover.excludedBidSourceIds, record.sourceId])] })}/><span><Check size={12}/></span><FileCheck2 size={16}/><strong>{record.name}</strong><small>{item.title}</small></label>)}</div> : <div className="handover-empty-line"><FileOutput size={20}/><span>{locale === "zh" ? "投标阶段尚未生成文件，可先上传中标资料或填写中标说明。" : "No bid files have been generated. Add award materials or notes first."}</span></div>}
        </div>

        <ConfirmableTextarea fieldId="handover-temporary-changes" label={locale === "zh" ? "临时变更与补充说明" : "Temporary changes and supplementary notes"} locale={locale} rows={6} value={project.handover.temporaryChanges} confirmed={project.confirmedTextFields.includes("handover-temporary-changes")} onChange={(value) => updateHandover({ temporaryChanges: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed("handover-temporary-changes", confirmed)} placeholder={locale === "zh" ? "记录中标后新增或调整的事项；与投标文件冲突时，以此处说明为准" : "Record post-award changes. These notes take precedence over conflicting bid content"}/>

        <div className="handover-subsection department-register">
          <div className="handover-panel-heading"><div><strong>{locale === "zh" ? "部门与职责" : "Departments and responsibilities"}</strong><small>{locale === "zh" ? "定义职责边界及默认交付和响应方式，模型只会分配到这里列出的部门" : "Define ownership and default delivery behavior. The model assigns only to listed departments"}</small></div><button className="inline-command" type="button" onClick={addHandoverDepartment}><Plus size={16}/>{locale === "zh" ? "新增部门" : "Add department"}</button></div>
          {project.handover.departments.length ? <div className="department-list">{project.handover.departments.map((department) => <article key={department.id}>
            <div className="department-primary"><Field label={locale === "zh" ? "部门名称" : "Department"}><input value={department.name} onChange={(event) => updateHandoverDepartment(department.id, { name: event.target.value })}/></Field><Field label={locale === "zh" ? "部门负责人" : "Department owner"}><input value={department.owner} onChange={(event) => updateHandoverDepartment(department.id, { owner: event.target.value })}/></Field><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除部门 ${department.name}` : `Delete department ${department.name}`} onClick={() => removeHandoverDepartment(department)}><Trash2 size={16}/></button></div>
            <ConfirmableTextarea fieldId={`handover-department-${department.id}`} label={locale === "zh" ? "职责与功能边界" : "Responsibility and function boundary"} locale={locale} rows={3} value={department.responsibility} confirmed={project.confirmedTextFields.includes(`handover-department-${department.id}`)} onChange={(value) => updateHandoverDepartment(department.id, { responsibility: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`handover-department-${department.id}`, confirmed)} placeholder={locale === "zh" ? "说明本部门负责的系统、设备、接口、现场工作或审核范围" : "Define the systems, equipment, interfaces, site work, or reviews owned by this department"}/>
            <div className="department-defaults"><Field label={locale === "zh" ? "默认交付类型" : "Default deliverable"}><select value={department.defaultDeliverableType} onChange={(event) => updateHandoverDepartment(department.id, { defaultDeliverableType: event.target.value as HandoverDeliverableType })}>{Object.entries(handoverDeliverableLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label={locale === "zh" ? "默认响应方式" : "Default response"}><select value={department.defaultResponseMethod} onChange={(event) => updateHandoverDepartment(department.id, { defaultResponseMethod: event.target.value as HandoverResponseMethod })}>{Object.entries(handoverResponseLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field></div>
          </article>)}</div> : <div className="handover-empty-line"><BriefcaseBusiness size={20}/><span>{locale === "zh" ? "先添加实际参与部门，再由模型按职责拆分任务。" : "Add the participating departments before using the model to split tasks."}</span></div>}
        </div>

        <div className="handover-split-actions"><button className="generate-command" type="button" disabled={busy} onClick={startHandoverTaskSplit}><Sparkles size={18}/>{generatingActionId === "handover-task-split" ? (locale === "zh" ? "正在分拆…" : "Splitting…") : (locale === "zh" ? "任务分拆" : "Split tasks")}</button><button className="inline-command" type="button" onClick={() => void addHandoverTask()}><Plus size={16}/>{locale === "zh" ? "手动新增任务" : "Add task manually"}</button>{project.handover.lastSplitAt && <small>{locale === "zh" ? "上次分拆" : "Last split"} · {new Date(project.handover.lastSplitAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")} · {project.handover.lastSplitProvider} / {project.handover.lastSplitModel}</small>}</div>

        {project.handover.tasks.length ? <div className="handover-task-list">{project.handover.tasks.map((task, index) => {
          const expanded = expandedHandoverTaskId === task.id;
          const department = project.handover.departments.find((item) => item.id === task.departmentId);
          const responseSources = task.responseSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source));
          const showFiles = task.responseMethod === "file" || task.responseMethod === "mixed";
          const showReport = task.responseMethod === "report" || task.responseMethod === "confirmation" || task.responseMethod === "mixed";
          const showPath = task.responseMethod === "path" || task.responseMethod === "mixed";
          return <article className={expanded ? "expanded" : ""} key={task.id} id={`handover-task-${task.id}`}>
            <header><button type="button" onClick={() => setExpandedHandoverTaskId(expanded ? "" : task.id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{task.title || (locale === "zh" ? "未命名交底任务" : "Untitled handover task")}</strong><small>{department?.name || (locale === "zh" ? "未分配部门" : "Unassigned")} · {handoverDeliverableLabels[locale][task.deliverableType]} · {handoverTaskStatusLabels[locale][task.status]}</small></div><ChevronRight size={18}/></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除任务 ${task.title}` : `Delete task ${task.title}`} onClick={() => void removeHandoverTask(task)}><Trash2 size={16}/></button></header>
            {expanded && <div className="handover-task-editor">
              <div className="handover-task-core"><Field label={locale === "zh" ? "任务名称" : "Task name"}><input value={task.title} onChange={(event) => updateHandoverTask(task.id, { title: event.target.value })}/></Field><Field label={locale === "zh" ? "责任部门" : "Department"}><select value={task.departmentId} onChange={(event) => { const nextDepartment = project.handover.departments.find((item) => item.id === event.target.value); updateHandoverTask(task.id, { departmentId: event.target.value, owner: task.owner || nextDepartment?.owner || "" }); }}><option value="">{locale === "zh" ? "请选择" : "Select"}</option>{project.handover.departments.map((item) => <option value={item.id} key={item.id}>{item.name || (locale === "zh" ? "未命名部门" : "Unnamed department")}</option>)}</select></Field><Field label={locale === "zh" ? "负责人" : "Owner"}><input value={task.owner} onChange={(event) => updateHandoverTask(task.id, { owner: event.target.value })}/></Field><Field label={locale === "zh" ? "截止时间" : "Due date"}><LocalizedTemporalInput type="date" locale={locale} ariaLabel={locale === "zh" ? "截止时间" : "Due date"} value={task.dueDate} onChange={(value) => updateHandoverTask(task.id, { dueDate: value })}/></Field></div>
              <ConfirmableTextarea fieldId={`handover-task-scope-${task.id}`} label={locale === "zh" ? "任务范围" : "Task scope"} locale={locale} rows={4} value={task.scope} confirmed={project.confirmedTextFields.includes(`handover-task-scope-${task.id}`)} onChange={(value) => updateHandoverTask(task.id, { scope: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`handover-task-scope-${task.id}`, confirmed)}/>
              <div className="handover-task-core"><Field label={locale === "zh" ? "交付类型" : "Deliverable type"}><select value={task.deliverableType} onChange={(event) => updateHandoverTask(task.id, { deliverableType: event.target.value as HandoverDeliverableType })}>{Object.entries(handoverDeliverableLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label={locale === "zh" ? "响应方式" : "Response method"}><select value={task.responseMethod} onChange={(event) => updateHandoverTask(task.id, { responseMethod: event.target.value as HandoverResponseMethod })}>{Object.entries(handoverResponseLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label={locale === "zh" ? "交付物名称" : "Deliverable name"}><input value={task.deliverableName} onChange={(event) => updateHandoverTask(task.id, { deliverableName: event.target.value })}/></Field><Field label={locale === "zh" ? "任务状态" : "Task status"}><select value={task.status} onChange={(event) => updateHandoverTask(task.id, { status: event.target.value as HandoverTaskStatus })}>{Object.entries(handoverTaskStatusLabels[locale]).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field></div>
              <div className="handover-task-notes"><ConfirmableTextarea fieldId={`handover-task-dependency-${task.id}`} label={locale === "zh" ? "前置依赖" : "Dependencies"} locale={locale} rows={3} value={task.dependencyNotes} confirmed={project.confirmedTextFields.includes(`handover-task-dependency-${task.id}`)} onChange={(value) => updateHandoverTask(task.id, { dependencyNotes: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`handover-task-dependency-${task.id}`, confirmed)}/><ConfirmableTextarea fieldId={`handover-task-acceptance-${task.id}`} label={locale === "zh" ? "验收标准" : "Acceptance criteria"} locale={locale} rows={3} value={task.acceptanceCriteria} confirmed={project.confirmedTextFields.includes(`handover-task-acceptance-${task.id}`)} onChange={(value) => updateHandoverTask(task.id, { acceptanceCriteria: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`handover-task-acceptance-${task.id}`, confirmed)}/></div>
              {task.sourceIds.length > 0 && <div className="handover-task-basis"><strong>{locale === "zh" ? "任务依据" : "Task basis"}</strong>{task.sourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is SourceDocument => Boolean(source)).map((source) => <span key={source.id}><FileText size={14}/>{source.name}</span>)}</div>}
              <div className="department-response"><div className="handover-panel-heading"><div><strong>{locale === "zh" ? "部门响应" : "Department response"}</strong><small>{handoverResponseLabels[locale][task.responseMethod]}</small></div></div>
                {showReport && <ConfirmableTextarea fieldId={`handover-task-response-${task.id}`} label={task.responseMethod === "confirmation" ? (locale === "zh" ? "确认说明" : "Confirmation note") : (locale === "zh" ? "响应报告" : "Response report")} locale={locale} rows={4} value={task.responseText} confirmed={project.confirmedTextFields.includes(`handover-task-response-${task.id}`)} onChange={(value) => updateHandoverTask(task.id, { responseText: value })} onConfirmedChange={(confirmed) => setTextFieldConfirmed(`handover-task-response-${task.id}`, confirmed)}/>}
                {showPath && <Field label={locale === "zh" ? "软件包、仓库或受控路径" : "Package, repository, or controlled path"} wide><input value={task.responsePath} onChange={(event) => updateHandoverTask(task.id, { responsePath: event.target.value })} placeholder={locale === "zh" ? "填写版本、仓库地址、共享目录或制品库路径" : "Record version, repository URL, shared folder, or artifact path"}/></Field>}
                {showFiles && <div className="handover-response-files"><label className="file-command"><Upload size={16}/>{locale === "zh" ? "上传响应文件" : "Upload response files"}<input hidden multiple type="file" accept=".pdf,.docx,.xlsx,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => { void importHandoverResponseFiles(task, event.target.files); event.currentTarget.value = ""; }}/></label>{responseSources.map((source) => <div key={source.id}><button type="button" onClick={() => void openSourceFile(source)}><FileCheck2 size={15}/><span>{source.name}</span><ExternalLink size={14}/></button><button className="row-delete" type="button" aria-label={locale === "zh" ? `删除响应文件 ${source.name}` : `Delete response file ${source.name}`} onClick={() => void removeHandoverSource(source.id, "response", task.id)}><Trash2 size={14}/></button></div>)}</div>}
              </div>
            </div>}
          </article>;
        })}</div> : <div className="empty-state"><ClipboardCheck size={26}/><p>{locale === "zh" ? "配置部门后运行任务分拆，或手动新增交底任务。" : "Configure departments, then split tasks with the model or add tasks manually."}</p></div>}
      </section>
    </>;
  };

  const renderProjectSettings = () => {
    const templateRows: Array<{ format: GeneralTemplateFormat; label: string; accept: string }> = [
      { format: "docx", label: "Word", accept: ".docx" },
      { format: "xlsx", label: "Excel", accept: ".xlsx" },
      { format: "pptx", label: "PowerPoint", accept: ".pptx" },
    ];
    return <section className="project-settings-panel" ref={projectSettingsSection} aria-label={locale === "zh" ? "项目设置" : "Project settings"}>
      <div className="project-settings-heading"><div><h2>{locale === "zh" ? "项目设置" : "Project settings"}</h2></div><button className="row-delete" type="button" aria-label={locale === "zh" ? "关闭项目设置" : "Close project settings"} onClick={() => setProjectSettingsOpen(false)}><X size={18}/></button></div>
      <div className="project-path-settings">
        <label><span>{locale === "zh" ? "项目路径" : "Project folder"}</span><input readOnly disabled={Boolean(directoryHandle)} value={directoryHandle?.name || ""} placeholder={locale === "zh" ? "尚未选择" : "Not selected"}/></label>
        <div className="project-path-actions">
          <button type="button" disabled={Boolean(directoryHandle) || busy} onClick={() => void chooseDirectory("select")}><FolderOpen size={17}/>{locale === "zh" ? "选择" : "Choose"}</button>
          <button type="button" disabled={!directoryHandle || busy} onClick={() => void chooseDirectory("migrate")}><RefreshCw size={17}/>{locale === "zh" ? "修改" : "Change"}</button>
        </div>
      </div>
      <div className="project-directory-utilities">
        <button type="button" disabled={!directoryHandle || busy} onClick={() => void syncDirectory()}><Save size={17}/>{locale === "zh" ? "写入目录" : "Write to folder"}</button>
        <button type="button" disabled={!directoryHandle || busy} onClick={() => void rescanDirectory()}><RefreshCw size={17}/>{locale === "zh" ? "重新扫描" : "Rescan"}</button>
        <button type="button" onClick={() => openGuardedFilePicker(archiveInput.current)}><FileArchive size={17}/>{t.importZip}</button>
        <input ref={archiveInput} hidden type="file" accept=".zip,application/zip" onChange={(event) => void importArchive(event.target.files?.[0])}/>
      </div>
      <div className="general-template-settings">
        <div><p>{locale === "zh" ? "通用文件模板" : "General file templates"}</p><span>{locale === "zh" ? "仅复用版式和视觉样式；模板正文、数据、示例与指令不会参与内容生成。模块内模板优先于这里的通用模板。" : "Only layout and visual styling are reused. Template text, data, examples, and instructions never participate in content generation. Module templates take priority."}</span></div>
        <div className="general-template-grid">{templateRows.map(({ format, label, accept }) => {
          const sourceId = generalTemplateSourceId(project, format);
          const source = project.sources.find((candidate) => candidate.id === sourceId);
          const Icon = format === "xlsx" ? FileSpreadsheet : format === "pptx" ? Presentation : FileText;
          return <article key={format}><Icon size={20}/><div><strong>{label}</strong><span title={source?.name}>{source?.name || (locale === "zh" ? "未上传" : "Not uploaded")}</span></div><label className="file-command"><Upload size={16}/>{source ? (locale === "zh" ? "替换" : "Replace") : (locale === "zh" ? "上传模板" : "Upload")}<input hidden type="file" accept={accept} onChange={(event) => { void uploadGeneralTemplate(format, event.target.files?.[0]); event.currentTarget.value = ""; }}/></label>{source && <button className="row-delete" type="button" aria-label={locale === "zh" ? `删除 ${label} 通用模板` : `Delete ${label} general template`} onClick={() => void removeGeneralTemplate(format)}><X size={15}/></button>}</article>;
        })}</div>
      </div>
    </section>;
  };

  const renderOutputs = () => {
    const allPaths = workspaceOutputFiles.map((file) => file.relativePath);
    const allSelected = allPaths.length > 0 && allPaths.every((path) => selectedOutputPaths.has(path));
    return <section className="work-section output-file-section">
      <div className="section-heading output-file-heading">
        <div><h2>{locale === "zh" ? "输出文件" : "Output files"}</h2><span className="section-description">{locale === "zh" ? "从项目各阶段选择实际文件，输出时保留项目名称、阶段和模块目录。" : "Select actual project files and preserve the project, stage, and module folders in the output."}</span></div>
        <button className="icon-command" type="button" disabled={!directoryHandle || busy || outputFilesLoading} aria-label={locale === "zh" ? "重新扫描输出文件" : "Rescan output files"} title={locale === "zh" ? "重新扫描" : "Rescan"} onClick={() => void refreshWorkspaceOutputFiles()}><RefreshCw size={18}/></button>
      </div>

      <div className="output-path-control">
        <div><span>{locale === "zh" ? "输出路径" : "Output folder"}</span><strong>{outputDirectoryHandle?.name || (locale === "zh" ? "尚未设置" : "Not set")}</strong><small>{locale === "zh" ? "完整输出会在此目录下创建项目名称文件夹；ZIP 直接保存在此目录。" : "Complete output creates a project-named folder here; the ZIP is saved directly in this folder."}</small></div>
        <button className="command-button" type="button" disabled={busy} onClick={() => void chooseOutputDirectory()}><FolderOpen size={18}/>{outputDirectoryHandle ? (locale === "zh" ? "修改路径" : "Change folder") : (locale === "zh" ? "选择路径" : "Choose folder")}</button>
      </div>

      <div className="output-selection-toolbar">
        <label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? "选择所有输出文件" : "Select all output files"} disabled={!allPaths.length} checked={allSelected} onChange={(event) => setOutputPathsChecked(allPaths, event.target.checked)}/><span><Check size={13}/></span>{locale === "zh" ? "选择所有文件" : "Select all files"}</label>
        <strong>{locale === "zh" ? `已选择 ${selectedOutputPaths.size} / ${workspaceOutputFiles.length}` : `${selectedOutputPaths.size} / ${workspaceOutputFiles.length} selected`}</strong>
      </div>

      {outputFilesLoading ? <div className="empty-state"><RefreshCw size={25}/><p>{locale === "zh" ? "正在扫描项目文件…" : "Scanning project files…"}</p></div> : outputGroups.length ? <div className="output-stage-list">{outputGroups.map((stage) => {
        const stagePaths = stage.files.map((file) => file.relativePath);
        const stageSelected = stagePaths.every((path) => selectedOutputPaths.has(path));
        return <section className="output-stage-group" key={stage.path}>
          <header><label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? `全选 ${stage.label}` : `Select all in ${stage.label}`} checked={stageSelected} onChange={(event) => setOutputPathsChecked(stagePaths, event.target.checked)}/><span><Check size={13}/></span><strong>{stage.label}</strong></label><span>{stage.files.length} {locale === "zh" ? "个文件" : "files"}</span></header>
          <div>{stage.modules.map((module) => {
            const modulePaths = module.files.map((file) => file.relativePath);
            const moduleSelected = modulePaths.every((path) => selectedOutputPaths.has(path));
            return <section className="output-module-group" key={module.path}>
              <header><label className="compact-check"><input type="checkbox" aria-label={locale === "zh" ? `全选模块 ${module.label}` : `Select all in module ${module.label}`} checked={moduleSelected} onChange={(event) => setOutputPathsChecked(modulePaths, event.target.checked)}/><span><Check size={12}/></span><strong>{module.label}</strong></label><span>{module.files.length}</span></header>
              <div className="output-file-list">{module.files.map((file) => {
                const extension = file.name.split(".").pop()?.toLowerCase() || "";
                const Icon = ["png", "jpg", "jpeg", "webp", "gif"].includes(extension) ? FileImage : ["xls", "xlsx", "csv"].includes(extension) ? FileSpreadsheet : ["zip", "7z", "rar"].includes(extension) ? FileArchive : FileText;
                return <label key={file.relativePath}><input type="checkbox" aria-label={locale === "zh" ? `选择输出文件 ${file.relativePath}` : `Select output file ${file.relativePath}`} checked={selectedOutputPaths.has(file.relativePath)} onChange={(event) => setOutputPathsChecked([file.relativePath], event.target.checked)}/><span><Check size={12}/></span><Icon size={18}/><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></label>;
              })}</div>
            </section>;
          })}</div>
        </section>;
      })}</div> : <div className="empty-state"><FileOutput size={26}/><p>{directoryHandle ? (locale === "zh" ? "项目各阶段暂时没有可输出的文件。" : "No project-stage files are available for output yet.") : (locale === "zh" ? "请先在“项目设置”中选择项目路径。" : "Choose a project folder in Project settings first.")}</p></div>}

      <div className="output-export-actions">
        <button className="command-button" type="button" disabled={busy || outputFilesLoading} onClick={() => void exportSelectedFiles("complete")}><FolderOpen size={19}/>{locale === "zh" ? "完整输出" : "Complete output"}</button>
        <button className="primary-export" type="button" disabled={busy || outputFilesLoading} onClick={() => void exportSelectedFiles("zip")}><Archive size={19}/>{locale === "zh" ? "导出为 ZIP" : "Export as ZIP"}</button>
      </div>
    </section>;
  };

  const readCleanupFile = async (candidate: GeneratedCleanupCandidate, directory: DirectoryHandleLike | null, files: Map<string, File>, blobs: Map<string, Blob>): Promise<Blob | null> => {
    if (candidate.scope === "local") return candidate.sourceIds.map((id) => files.get(id)).find(Boolean)
      || candidate.recordIds.map((id) => blobs.get(id)).find(Boolean) || null;
    if (!isUsableProjectDirectory(directory)) throw new Error(locale === "zh" ? "请先在项目设置中选择项目目录。" : "Choose the project folder in Project settings first.");
    try { return await readWorkspaceFileFromRelativePath(directory, candidate.relativePath); }
    catch (error) {
      if (error instanceof Error && (error.name === "NotFoundError" || (error as Error & { code?: string }).code === "ENOENT")) return null;
      throw error;
    }
  };

  const scanCleanup = async (keepMessage = false) => {
    const sequence = ++cleanupSequence.current;
    setCleanupLoading(true);
    setCleanupError("");
    if (!keepMessage) setCleanupMessage("");
    const snapshot = { project: projectRef.current, directory: directoryHandle, files: new Map(sourceFilesRef.current), blobs: new Map(generatedBlobs) };
    const [cache, generated] = await Promise.allSettled([
      window.bidDesktop?.cleanup ? window.bidDesktop.cleanup.preview() : Promise.reject(new Error("DESKTOP_REQUIRED")),
      previewGeneratedCleanup(snapshot.project, { readFile: (candidate) => readCleanupFile(candidate, snapshot.directory, snapshot.files, snapshot.blobs) }),
    ]);
    if (sequence !== cleanupSequence.current) return;
    const generatedPreview = generated.status === "fulfilled" ? generated.value : { projectId: snapshot.project.id, candidates: [], blocked: [] };
    cleanupSnapshot.current = { ...snapshot, generated: generatedPreview, cache: cache.status === "fulfilled" ? cache.value : null };
    setCleanupCategories(cache.status === "fulfilled" ? cache.value.categories : []);
    setCleanupFiles(generatedPreview.candidates.map((file) => ({
      ...file, bytes: file.fingerprint?.size ?? file.bytes,
      error: file.error ? (locale === "zh"
        ? (file.error === "GENERATED_FILE_CHANGED" ? "文件内容已改变，已保留。" : "无法核实文件，请检查项目目录授权。")
        : (file.error === "GENERATED_FILE_CHANGED" ? "This file has changed and will be kept." : "Could not verify this file. Check project folder access.")) : undefined,
    })));
    if (!keepMessage && generatedPreview.blocked.length) setCleanupMessage(locale === "zh"
      ? `另有 ${generatedPreview.blocked.length} 个文件仍被使用或无法核实，已保留。`
      : `${generatedPreview.blocked.length} other files are in use or could not be verified and will be kept.`);
    if (cache.status === "rejected" || generated.status === "rejected") setCleanupError(locale === "zh" ? "部分内容无法扫描，请检查目录授权并重新扫描。" : "Some items could not be scanned. Check folder access and scan again.");
    setCleanupLoading(false);
  };

  const cleanSelectedFiles = async (selection: CleanupSelection) => {
    const snapshot = cleanupSnapshot.current;
    if (!snapshot || cleanupRunningRef.current || busyRef.current) throw new Error(locale === "zh" ? "请等待扫描完成。" : "Wait for the scan to finish.");
    if (projectRef.current !== snapshot.project || directoryHandle !== snapshot.directory) {
      setCleanupError(locale === "zh" ? "项目已变化，请重新扫描后清理。" : "The project has changed. Scan again before cleaning up.");
      throw new Error("STALE_PREVIEW");
    }
    cleanupRunningRef.current = true;
    busyRef.current = true;
    setCleanupRunning(true);
    setBusy(true);
    setCleanupError("");
    publishHistoryState();
    const failures: string[] = [];
    let generatedCount = 0, cacheBytes = 0;
    try {
      if (selection.categories.length) {
        try {
          if (!snapshot.cache || !window.bidDesktop?.cleanup) throw new Error("NO_CACHE_PREVIEW");
          const result = await window.bidDesktop.cleanup.run({ token: snapshot.cache.token, categories: selection.categories });
          cacheBytes = result.categories.reduce((total, category) => total + category.bytes, 0);
          if (result.errors.length || result.categories.some((category) => category.failed)) failures.push(locale === "zh" ? "部分缓存已变化或无法访问，已保留。" : "Some cache files changed or could not be accessed and were kept.");
        } catch { failures.push(locale === "zh" ? "缓存清理未完成，请重新扫描。" : "Cache cleanup did not finish. Scan again."); }
      }
      if (selection.generatedIds.length) {
        const result = await executeGeneratedCleanup(snapshot.project, snapshot.generated, selection.generatedIds, {
          readFile: (candidate) => readCleanupFile(candidate, snapshot.directory, snapshot.files, snapshot.blobs),
          trashFile: async (candidate, expectedFingerprint) => {
            if (!snapshot.directory) throw new Error("PROJECT_FOLDER_REQUIRED");
            await trashWorkspaceFileFromRelativePath(snapshot.directory, candidate.relativePath, expectedFingerprint);
          },
        });
        const successful = result.results.filter((item) => item.status === "cleaned" || item.status === "missing");
        generatedCount = successful.length;
        if (successful.length) {
          const nextFiles = new Map(snapshot.files), nextBlobs = new Map(snapshot.blobs);
          for (const id of result.sourceIds) { nextFiles.delete(id); knownSourceFilesRef.current.delete(id); }
          for (const id of result.recordIds) nextBlobs.delete(id);
          const nextProject = syncProjectStage({ ...result.project, updatedAt: new Date().toISOString() });
          // Old history must not recreate files that the user has just cleaned.
          historyRef.current.reset();
          commitProject(nextProject, "", false);
          sourceFilesRef.current = nextFiles;
          setSourceFiles(nextFiles);
          setGeneratedBlobs(nextBlobs);
          if (result.sourceIds.includes(selectedSourceId)) setSelectedSourceId("");
          const removedPaths = new Set(snapshot.generated.candidates.filter((candidate) => successful.some((item) => item.id === candidate.id)).map((candidate) => candidate.relativePath));
          setSelectedOutputPaths((current) => new Set([...current].filter((path) => !removedPaths.has(path))));
          for (const id of result.sourceIds) {
            try { await removePersistedSourceFile(nextProject.id, id); }
            catch { if (!failures.includes("LOCAL_RECORDS")) failures.push("LOCAL_RECORDS"); }
          }
          if (snapshot.directory) {
            try { await saveProjectStateToDirectory(snapshot.directory, nextProject, nextFiles); }
            catch { failures.push(locale === "zh" ? "项目记录尚未写入目录，请检查目录授权。" : "The project record could not be saved to its folder. Check folder access."); }
            await refreshWorkspaceOutputFiles(snapshot.directory);
          }
          // Refresh from the post-cleanup maps, rather than the render's old closures.
          cleanupSnapshot.current = null;
          const [cache, generated] = await Promise.all([
            window.bidDesktop?.cleanup?.preview().catch(() => null) ?? Promise.resolve(null),
            previewGeneratedCleanup(nextProject, { readFile: (candidate) => readCleanupFile(candidate, snapshot.directory, nextFiles, nextBlobs) }),
          ]);
          cleanupSnapshot.current = { project: nextProject, directory: snapshot.directory, files: nextFiles, blobs: nextBlobs, generated, cache };
          setCleanupCategories(cache?.categories || []);
          setCleanupFiles(generated.candidates.map((file) => ({ ...file, bytes: file.fingerprint?.size ?? file.bytes, error: file.error ? (locale === "zh" ? "无法核实文件，已保留。" : "Could not verify this file. It will be kept.") : undefined })));
        }
        if (result.results.some((item) => !["cleaned", "missing"].includes(item.status))) failures.push(locale === "zh" ? "部分生成文件已变化、仍被使用或无法移入回收站，已保留。" : "Some generated files changed, are in use, or could not be recycled and were kept.");
      }
      if (!generatedCount) await scanCleanup(true);
      const summary = locale === "zh" ? `已清理缓存 ${formatFileSize(cacheBytes)}，处理 ${generatedCount} 个生成文件记录。`
        : `Cleaned ${formatFileSize(cacheBytes)} of cache and ${generatedCount} generated-file records.`;
      setCleanupMessage(summary);
      if (failures.length) {
        const text = failures.map((failure) => failure === "LOCAL_RECORDS" ? (locale === "zh" ? "部分本机副本未能清理。" : "Some local copies could not be removed.") : failure).join(" ");
        setCleanupError(text);
        throw new Error(text);
      }
    } finally {
      cleanupRunningRef.current = false;
      busyRef.current = false;
      setCleanupRunning(false);
      setBusy(false);
      publishHistoryState();
    }
  };

  const content = view === "presales" ? renderPresales() : view === "requirements" ? renderRequirements() : view === "bid" ? renderBid() : view === "handover" ? renderHandover() : renderOutputs();

  return <div className="solution-app" ref={solutionApp} data-ready={ready ? "true" : "false"} onClickCapture={guardFileImport}>
    <header className="project-header" ref={projectHeader}>
      <div><h1>{t.project}</h1><nav className="workspace-toolbar" aria-label={locale === "zh" ? "项目操作" : "Project actions"}>
        <button type="button" disabled={busy} aria-label={t.reset} onClick={resetCurrentProject} title={t.reset}><RotateCcw size={17}/><span>{t.reset}</span></button>
        <button className={`project-path-command${projectSettingsOpen ? " active" : ""}`} type="button" disabled={busy} aria-expanded={projectSettingsOpen} aria-label={t.projectPath} onClick={() => { setProjectSettingsOpen(!projectSettingsOpen); if (!projectSettingsOpen) window.requestAnimationFrame(() => projectSettingsSection.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }} title={t.projectPath}><FolderCog size={17}/><span>{t.projectPath}</span></button>
        <button className="file-cleanup-command" type="button" disabled={busy || !ready || !filesHydrated} aria-label={locale === "zh" ? "文件清理" : "File cleanup"} title={locale === "zh" ? "文件清理" : "File cleanup"} onClick={() => { setCleanupOpen(true); void scanCleanup(); }}><Trash2 size={17}/><span>{locale === "zh" ? "文件清理" : "File cleanup"}</span></button>
      </nav></div>
      <div className="header-metrics"><div><strong>{coverage.total}</strong><span>{t.total}</span></div><div><strong>{coverage.evidenced}</strong><span>{t.evidenced}</span></div><div><strong>{coverage.approved}</strong><span>{t.approved}</span></div><div><strong>{coverage.pending}</strong><span>{t.pending}</span></div></div>
    </header>
    <ModelControls locale={locale} busy={busy} toolbarTarget={headerSettingsTarget}/>
    {cleanupOpen && <FileCleanupPanel locale={locale} busy={cleanupRunning} loading={cleanupLoading} categories={cleanupCategories} generatedFiles={cleanupFiles} message={cleanupMessage} error={cleanupError} onRefresh={() => scanCleanup()} onClean={cleanSelectedFiles} onClose={() => { if (!cleanupRunningRef.current) { ++cleanupSequence.current; setCleanupOpen(false); } }}/>} 
    {projectSettingsOpen && renderProjectSettings()}
    {notice && notice !== copy.zh.saved && notice !== copy.en.saved && <div className="workbench-notice" role="status" aria-live="polite">{notice}</div>}
    <div className="workspace-shell">
      <aside className="stage-rail" aria-label={locale === "zh" ? "解决方案流程" : "Solution lifecycle"}>{viewMeta.map((item) => { const Icon = item.icon; return <button type="button" aria-label={t[item.id]} title={t[item.id]} className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{item.code}</span><Icon size={19}/><strong>{t[item.id]}</strong><ChevronRight size={16}/></button>; })}<div className="rail-status" data-stage={currentStage}><p>{locale === "zh" ? "当前阶段" : "Current stage"}</p><strong>{projectStageLabels[locale][currentStage]}</strong><span>{issues.filter((item) => item.severity === "error").length} {locale === "zh" ? "个阻断项" : "blocking issues"}</span></div></aside>
      <main className="workspace-content">{content}</main>
    </div>
    {ocrChoiceSourceIds && <div className="model-choice-backdrop">
      <section className="model-choice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ocr-choice-title">
        <h2 id="ocr-choice-title">{locale === "zh" ? "导入文件存在无法识别项，是否通过 OCR 重新识别？" : "Some imported files could not be recognized. Run OCR?"}</h2>
        <span>{locale === "zh" ? "选择“否”会保留原文件并标记为仅上传、未处理。" : "Choosing No keeps the original files and marks them as uploaded only."}</span>
        <div><button ref={modelChoicePrimary} className="model-choice-primary" type="button" onClick={confirmTenderOcr}><RefreshCw size={18}/>{locale === "zh" ? "是" : "Yes"}</button><button type="button" onClick={skipTenderOcr}><X size={18}/>{locale === "zh" ? "否" : "No"}</button></div>
      </section>
    </div>}
    {pendingModelAction && <div className="model-choice-backdrop">
      <section className="model-choice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="model-choice-title">
        <h2 id="model-choice-title">{locale === "zh" ? "请先完善当前任务的模型设置。" : "Complete the model settings for this task."}</h2>
        <span>{locale === "zh" ? "可在当前工作台设置模型，或输出任务文件稍后执行。" : "Set up a model here, or export the task to run later."}</span>
        <div>
          <button ref={modelChoicePrimary} className="model-choice-primary" type="button" onClick={() => void rememberModelActionAndOpenSettings(pendingModelAction)}><Settings2 size={18}/>{locale === "zh" ? "展开模型设置" : "Open model settings"}</button>
          <button type="button" onClick={outputPendingModelTask}><FileText size={18}/>{locale === "zh" ? "输出任务" : "Export task"}</button>
        </div>
      </section>
    </div>}
    {pendingDirectoryChange && <div className="model-choice-backdrop">
      <section className="model-choice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="directory-change-title">
        <h2 id="directory-change-title">{pendingDirectoryChange.mode === "migrate"
          ? (locale === "zh" ? "修改路径会迁移当前项目到新路径，可能会需要一些时间，请等候..." : "Changing the folder migrates the current project and may take some time. Please wait.")
          : (locale === "zh" ? "选定路径后将创建项目文件夹，是否继续？" : "The project folder structure will be created in the selected folder. Continue?")}</h2>
        <span>{pendingDirectoryChange.mode === "migrate"
          ? (locale === "zh" ? `当前项目将迁移到“${pendingDirectoryChange.handle.name}”。迁移成功后只删除原路径中的工作台受管文件，不处理其他文件。` : `The project will move to “${pendingDirectoryChange.handle.name}”. Only workbench-managed files are removed from the old folder after a successful copy.`)
          : (locale === "zh" ? "将创建：0_项目客户方资料、1_售前准备、2_招标要求、3_技术标组包、4_中标交底、5_输出文件。" : "Six managed stage folders will be created for customer materials, presales, tender, bid, handover, and outputs.")}</span>
        <div><button className="model-choice-primary" type="button" onClick={() => void confirmDirectoryChange()}><Check size={18}/>{locale === "zh" ? "是，继续" : "Yes, continue"}</button><button type="button" onClick={() => setPendingDirectoryChange(null)}><X size={18}/>{locale === "zh" ? "否，取消" : "No, cancel"}</button></div>
      </section>
    </div>}
    {projectPathRequired && <div className="model-choice-backdrop">
      <section className="model-choice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="project-path-required-title">
        <h2 id="project-path-required-title">{t.projectPathRequired}</h2>
        <span>{t.projectPathRequiredHint}</span>
        <div><button ref={modelChoicePrimary} className="model-choice-primary" type="button" onClick={() => setProjectPathRequired(false)}><Check size={18}/>{t.acknowledge}</button></div>
      </section>
    </div>}
    {workspaceRecovery && <div className="model-choice-backdrop">
      <section className="model-choice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="workspace-recovery-title">
        <h2 id="workspace-recovery-title">{locale === "zh" ? "项目缓存无法读取，请从原项目目录恢复。" : "The project cache could not be read. Restore it from the original project folder."}</h2>
        <span>{workspaceRecovery.saved
          ? (locale === "zh" ? `原始内容已备份到本机缓存“${workspaceRecovery.key}”。恢复完成前暂停自动保存。` : `The original content was backed up locally as “${workspaceRecovery.key}”. Autosave is paused until recovery is complete.`)
          : (locale === "zh" ? "本机缓存空间不足，原始缓存仍保持原样。你可以载入原项目，或保存原始缓存备份后新建项目。" : "The local cache is full. The original value is unchanged. Load your project folder, or save a copy of the original cache before starting a new project.")}</span>
        {notice && <span role="status">{notice}</span>}
        <div><button ref={modelChoicePrimary} className="model-choice-primary" type="button" disabled={busy} onClick={() => void restoreWorkspaceAfterCacheFailure()}><FolderOpen size={18}/>{locale === "zh" ? "载入原项目目录" : "Load original project folder"}</button><button type="button" disabled={busy} onClick={startNewWorkspaceAfterCacheFailure}><Save size={18}/>{locale === "zh" ? "保存备份并新建项目" : "Save backup and start a new project"}</button></div>
      </section>
    </div>}
    {outputPathRequired && <div className="model-choice-backdrop">
      <section className="model-choice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="output-path-required-title">
        <h2 id="output-path-required-title">{locale === "zh" ? "未设置输出路径，请先选择输出路径。" : "No output folder is set. Choose an output folder first."}</h2>
        <span>{locale === "zh" ? "当前输出操作已取消，已选择的文件保持不变。" : "The output was cancelled and the current file selection is preserved."}</span>
        <div><button ref={modelChoicePrimary} className="model-choice-primary" type="button" onClick={() => setOutputPathRequired(false)}><Check size={18}/>{t.acknowledge}</button></div>
      </section>
    </div>}
  </div>;
}
