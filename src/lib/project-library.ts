import { DesktopDirectoryHandle, type NativeHandle } from "./desktop-bridge";
import {
  loadActiveProject,
  loadSourceFilesFromDirectory,
  projectManagedFileReferences,
  readWorkspaceFileFromRelativePath,
  saveProjectStateToDirectory,
  writeWorkspaceFileToRelativePath,
  type DirectoryHandleLike,
} from "./workspace-io";
import { projectManifestSchema, type ProjectManifest, type ProjectStage } from "./workspace-schema";

export type ProjectLibraryEntry = {
  id: string;
  name: string;
  folderName: string;
  folderPath: string;
  customerAlias: string;
  industry: string;
  owner: string;
  stage: ProjectStage;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  sourceCount: number;
  generatedCount: number;
  missingFiles: string[];
  originLabel: string;
};

export type ProjectLibraryCommit = Pick<ProjectLibraryEntry, "id" | "name" | "customerAlias" | "industry" | "owner" | "stage" | "updatedAt" | "sourceCount" | "generatedCount"> & {
  missingFiles?: string[];
  originLabel?: string;
};

export type ProjectLibraryApi = {
  info(): Promise<{ rootPath: string }>;
  prepare(input: { id: string; name: string }): Promise<{ entry: ProjectLibraryEntry; directory: NativeHandle }>;
  commit(input: ProjectLibraryCommit): Promise<ProjectLibraryEntry>;
  list(): Promise<ProjectLibraryEntry[]>;
  get(input: { id: string }): Promise<{ entry: ProjectLibraryEntry; directory: NativeHandle }>;
  setSubmitted(input: { id: string; submitted: boolean }): Promise<ProjectLibraryEntry>;
  openFolder(input?: { id?: string }): Promise<void>;
};

declare global {
  interface BidDesktopWindowControls {
    projects?: ProjectLibraryApi;
  }
}

export type SaveProjectToLibraryInput = {
  project: ProjectManifest;
  sourceFiles: Map<string, File>;
  generatedBlobs?: Map<string, Blob>;
  directory?: DirectoryHandleLike | null;
};

export type SavedLibraryProject = {
  entry: ProjectLibraryEntry;
  directory: DirectoryHandleLike;
  project: ProjectManifest;
};

type GeneratedReference = { id: string; sourceId: string; relativePath: string; name: string };
type CachedCopy = { blob?: WeakRef<Blob>; sourceKey: string };
type ApiState = { queues: Map<string, Promise<unknown>>; copies: Map<string, Map<string, CachedCopy>> };
const apiStates = new WeakMap<ProjectLibraryApi, ApiState>();

export function libraryApi(): ProjectLibraryApi | null {
  return typeof window === "undefined" ? null : window.bidDesktop?.projects ?? null;
}

function requireApi(): ProjectLibraryApi {
  const api = libraryApi();
  if (!api) throw libraryError("项目资料库仅在桌面版中可用。", "Project library is available in the desktop app.");
  return api;
}

function libraryError(zh: string, en: string): Error {
  return new Error(typeof document !== "undefined" && document.documentElement.dataset.locale === "en" ? en : zh);
}

function stateFor(api: ProjectLibraryApi): ApiState {
  let state = apiStates.get(api);
  if (!state) {
    state = { queues: new Map(), copies: new Map() };
    apiStates.set(api, state);
  }
  return state;
}

function generatedReferences(project: ProjectManifest): GeneratedReference[] {
  return [
    ...project.presalesRounds.flatMap(round => [
      ...round.analysisResults.map(result => ({ ...result, name: result.fileName })),
      ...round.generatedFiles,
    ]),
    ...project.tenderAnalysis.results.map(result => ({ ...result, name: result.fileName })),
    ...project.tenderComparison.results.map(result => ({ ...result, name: result.fileName })),
    ...project.bidFileChecklist.flatMap(item => item.generatedFiles),
  ];
}

function safeName(value: string): string {
  const name = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 140);
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `file-${name || "unnamed"}` : name;
}

function validRelativePath(value: string): boolean {
  return Boolean(value) && !/[\\\u0000-\u001f:*?"<>|]/.test(value)
    && value.split("/").every(part => part && part !== "." && part !== ".." && !/[. ]$/.test(part));
}

async function sourceFolder(id: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
  const suffix = [...bytes.slice(0, 8)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${safeName(id).slice(0, 48)}-${suffix}`;
}

function reservedMetadataPath(value: string, projectId: string): boolean {
  if (!value) return false;
  const path = value.toLocaleLowerCase("en-US");
  const project = `projects/${projectId}`.toLocaleLowerCase("en-US");
  const metadata = ["workspace.json", "library/library.json", `${project}/project.json`, `${project}/work/requirements.csv`, `${project}/work/solution-draft.md`, `${project}/work/presentation.md`, `${project}/templates/template-guidance.txt`];
  if (metadata.some(file => path === file || path.startsWith(`${file}/`) || file.startsWith(`${path}/`))) return true;
  return [`${project}/sources`, `${project}/outputs`, "0_项目客户方资料", "1_售前准备", "2_招标要求", "3_技术标组包", "4_中标交底", "5_输出文件"].includes(path);
}

function generatedKey(record: { id: string; sourceId: string; relativePath: string }): string {
  return JSON.stringify([record.id, record.sourceId, record.relativePath]);
}

function replaceGeneratedPaths(project: ProjectManifest, paths: Map<string, string>, metadataRewrites: Map<string, string>): void {
  const rewrite = <T extends { id: string; sourceId: string; relativePath: string }>(record: T) => {
    const replacement = metadataRewrites.get(generatedKey(record));
    if (replacement) record.relativePath = replacement;
    else if (record.relativePath.startsWith("downloads/") || !record.relativePath) record.relativePath = paths.get(record.sourceId) || record.relativePath;
  };
  project.presalesRounds.forEach(round => { round.analysisResults.forEach(rewrite); round.generatedFiles.forEach(rewrite); });
  project.tenderAnalysis.results.forEach(rewrite);
  project.tenderComparison.results.forEach(rewrite);
  project.bidFileChecklist.forEach(item => item.generatedFiles.forEach(rewrite));
}

async function archiveManifest(project: ProjectManifest): Promise<ProjectManifest> {
  const archive = projectManifestSchema.parse(JSON.parse(JSON.stringify(project)));
  const generated = generatedReferences(archive);
  const generatedBySource = new Map(generated.map(record => [record.sourceId, record]));
  const paths = new Map<string, string>();
  for (const source of archive.sources) {
    const record = generatedBySource.get(source.id);
    const recordedPath = record?.relativePath && !record.relativePath.startsWith("downloads/") && !reservedMetadataPath(record.relativePath, archive.id) ? record.relativePath : "";
    const category = record ? "5_输出文件/历史生成文件" : "0_项目客户方资料/历史资料";
    source.workspacePath = reservedMetadataPath(source.workspacePath, archive.id)
      ? `0_项目客户方资料/历史资料/${await sourceFolder(source.id)}/${safeName(source.name)}`
      : source.workspacePath || recordedPath || `${category}/${await sourceFolder(source.id)}/${safeName(source.name)}`;
    if (!validRelativePath(source.workspacePath)) throw libraryError("项目包含无效的资料路径，请检查项目文件。", "The project contains an invalid file path.");
    paths.set(source.id, source.workspacePath);
  }
  const metadataRewrites = new Map<string, string>();
  for (const record of generated) {
    if (reservedMetadataPath(record.relativePath, archive.id)) metadataRewrites.set(generatedKey(record), `5_输出文件/历史生成文件/${await sourceFolder(`${record.id}:${record.sourceId}`)}/${safeName(record.name)}`);
    if (!paths.has(record.sourceId)) paths.set(record.sourceId, record.relativePath && !record.relativePath.startsWith("downloads/") && !reservedMetadataPath(record.relativePath, archive.id)
      ? record.relativePath : `5_输出文件/历史生成文件/${await sourceFolder(record.sourceId)}/${safeName(record.name)}`);
  }
  replaceGeneratedPaths(archive, paths, metadataRewrites);
  const claimed = new Map<string, string>();
  const check = (relativePath: string, sourceId: string) => {
    if (!validRelativePath(relativePath)) throw libraryError("项目包含无效的资料路径，请检查项目文件。", "The project contains an invalid file path.");
    const key = relativePath.toLocaleLowerCase("en-US");
    const prior = claimed.get(key);
    if (prior && prior !== sourceId) throw libraryError("项目中存在重名资料路径，请分别命名后重试。", "Project files share a conflicting path. Rename them and try again.");
    claimed.set(key, sourceId);
  };
  archive.sources.forEach(source => check(source.workspacePath, source.id));
  generatedReferences(archive).forEach(record => { if (record.relativePath && record.sourceId) check(record.relativePath, record.sourceId); });
  return archive;
}

async function targetHasFile(directory: DirectoryHandleLike, relativePath: string, expectedSize?: number): Promise<boolean> {
  // Native stat avoids reading a large file back across IPC for each text edit.
  if (directory instanceof DesktopDirectoryHandle && typeof window !== "undefined" && window.bidDesktop?.fs) {
    const parts = relativePath.split("/");
    const relative = [directory.native.relativePath, relativePath].filter(Boolean).join("/");
    const result = await window.bidDesktop.fs.op({ op: "stat", handle: { ...directory.native, kind: "file", name: parts.at(-1), relativePath: relative } });
    if (!result.ok) return false;
    const info = result.value as { size?: number };
    return typeof info?.size === "number" && (expectedSize === undefined || info.size === expectedSize);
  }
  try {
    const file = await readWorkspaceFileFromRelativePath(directory, relativePath);
    return expectedSize === undefined || file.size === expectedSize;
  } catch { return false; }
}

function directoryKey(directory: DirectoryHandleLike | null | undefined): string {
  return directory instanceof DesktopDirectoryHandle
    ? `${directory.native.rootId}:${directory.native.relativePath}` : directory?.name || "";
}

async function saveNow(api: ProjectLibraryApi, input: SaveProjectToLibraryInput): Promise<SavedLibraryProject> {
  const archive = await archiveManifest(input.project);
  const prepared = await api.prepare({ id: archive.id, name: archive.name });
  const directory = new DesktopDirectoryHandle(prepared.directory);
  const sameDirectory = Boolean(input.directory && await directory.isSameEntry(input.directory));
  const state = stateFor(api);
  const cache = state.copies.get(archive.id) || new Map<string, CachedCopy>();
  state.copies.set(archive.id, cache);
  const originals = projectManagedFileReferences(input.project);
  const originalPaths = new Map<string, string[]>();
  for (const reference of originals.values()) {
    const paths = originalPaths.get(reference.sourceId) || [];
    if (!paths.includes(reference.relativePath)) paths.push(reference.relativePath);
    originalPaths.set(reference.sourceId, paths);
  }
  const originalRecords = generatedReferences(input.project);
  const generatedBySource = new Map(originalRecords.map(record => [record.sourceId, record]));
  const sourceById = new Map(input.project.sources.map(source => [source.id, source]));
  const missing = new Set<string>();
  for (const reference of projectManagedFileReferences(archive).values()) {
    const source = sourceById.get(reference.sourceId);
    const record = generatedBySource.get(reference.sourceId);
    const blob = input.sourceFiles.get(reference.sourceId) || (record ? input.generatedBlobs?.get(record.id) : undefined);
    const sourceKey = `${directoryKey(input.directory)}:${source?.sha256 || ""}:${source?.workspacePath || record?.relativePath || ""}`;
    const cached = cache.get(reference.relativePath);
    if (((blob && cached?.blob?.deref() === blob) || (!blob && cached?.sourceKey === sourceKey))
      && await targetHasFile(directory, reference.relativePath, blob?.size)) continue;

    // Files in an already managed project are written by the existing workflow.
    // Keep them in place; don't create another binary backup for each text edit.
    if (sameDirectory && (originalPaths.get(reference.sourceId) || []).includes(reference.relativePath)
      && await targetHasFile(directory, reference.relativePath, blob?.size)) {
      cache.set(reference.relativePath, { blob: blob ? new WeakRef(blob) : undefined, sourceKey });
      continue;
    }

    let content: Blob | undefined = blob;
    if (!content && input.directory) {
      for (const relativePath of originalPaths.get(reference.sourceId) || []) {
        if (!validRelativePath(relativePath)) continue;
        try { content = await readWorkspaceFileFromRelativePath(input.directory, relativePath); break; }
        catch { /* Other known references or the last archived copy may still exist. */ }
      }
    }
    if (!content) {
      if (await targetHasFile(directory, reference.relativePath)) continue;
      missing.add(reference.relativePath);
      continue;
    }
    await writeWorkspaceFileToRelativePath(directory, reference.relativePath, content);
    cache.set(reference.relativePath, { blob: blob ? new WeakRef(blob) : undefined, sourceKey });
  }

  archive.localPathHint = directory.name;
  await saveProjectStateToDirectory(directory, archive, input.sourceFiles);
  const generatedSourceIds = new Set(originalRecords.map(record => record.sourceId));
  const entry = await api.commit({
    id: archive.id,
    name: archive.name,
    customerAlias: archive.customerAlias,
    industry: archive.industry,
    owner: archive.owner,
    stage: archive.stage,
    updatedAt: archive.updatedAt,
    sourceCount: archive.sources.filter(source => !generatedSourceIds.has(source.id)).length,
    generatedCount: originalRecords.length,
    missingFiles: [...missing],
    originLabel: !sameDirectory && input.directory ? input.directory.name : prepared.entry.originLabel || "",
  });
  return { entry, directory, project: archive };
}

export function saveProjectToLibrary(input: SaveProjectToLibraryInput): Promise<SavedLibraryProject> {
  const api = requireApi();
  const state = stateFor(api);
  const previous = state.queues.get(input.project.id) || Promise.resolve();
  const saving = previous.catch(() => undefined).then(() => saveNow(api, input));
  state.queues.set(input.project.id, saving);
  void saving.finally(() => { if (state.queues.get(input.project.id) === saving) state.queues.delete(input.project.id); }).catch(() => {});
  return saving;
}

export async function loadProjectFromLibrary(id: string): Promise<SavedLibraryProject & { sourceFiles: Map<string, File> }> {
  const api = requireApi();
  await stateFor(api).queues.get(id)?.catch(() => undefined);
  const result = await api.get({ id });
  const directory = new DesktopDirectoryHandle(result.directory);
  const project = await loadActiveProject(directory);
  if (project.id !== id) throw libraryError("历史项目记录与文件不一致，请检查项目文件夹。", "Project records and files do not match.");
  const sourceFiles = await loadSourceFilesFromDirectory(directory, project);
  const missingFiles: string[] = [];
  for (const reference of projectManagedFileReferences(project).values()) {
    if (!await targetHasFile(directory, reference.relativePath)) missingFiles.push(reference.relativePath);
  }
  return { entry: { ...result.entry, missingFiles }, project, sourceFiles, directory };
}
