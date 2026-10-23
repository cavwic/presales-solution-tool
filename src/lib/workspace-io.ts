import { projectToCsv, projectToMarkdown, presentationMarkdown } from "./exporters";
import { pickDesktopDirectory, persistDesktopDirectory, restoreDesktopDirectory } from "./desktop-bridge";
import { projectManifestSchema, SCHEMA_VERSION, workspaceManifestSchema, type ProjectManifest } from "./workspace-schema";
import {
  WORKSPACE_MODULE_DIRECTORIES,
  analysisSupplementText,
  bidItemDirectory,
  handoverTaskDirectory,
  presalesRoundDirectory,
  responseFileMetadata,
  safeWorkspaceName,
  sourceReferenceDocument,
  tenderClarificationDirectory,
} from "./workspace-storage";

type WritableLike = { write(data: Blob | string | ArrayBuffer): Promise<void>; close(): Promise<void> };
type FileHandleLike = {
  kind?: "file";
  name?: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
};
type FileSystemEntryLike = FileHandleLike | DirectoryHandleLike;
export type WorkspaceFileFingerprint = { size: number; sha256: string };
export type DirectoryHandleLike = {
  kind?: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  entries?(): AsyncIterableIterator<[string, FileSystemEntryLike]>;
  isSameEntry?(other: DirectoryHandleLike): Promise<boolean>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
  trashEntry?(name: string, expectedFingerprint?: WorkspaceFileFingerprint): Promise<void>;
  queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
};

const HANDLE_DATABASE = "cavwic-solutions-lab";
const HANDLE_STORE = "workspace-handles";
const SOURCE_FILE_STORE = "source-files";
const ACTIVE_HANDLE_KEY = "active-workspace";
const TASK_OUTPUT_HANDLE_KEY = "task-output";
const PROJECT_OUTPUT_HANDLE_KEY = "project-output";

export const PROJECT_STAGE_DIRECTORIES = [
  "0_项目客户方资料",
  "1_售前准备",
  "2_招标要求",
  "3_技术标组包",
  "4_中标交底",
  "5_输出文件",
] as const;

const MANAGED_WORKSPACE_ENTRIES = ["workspace.json", "library", "projects", ...PROJECT_STAGE_DIRECTORIES] as const;

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; startIn?: DirectoryHandleLike }) => Promise<DirectoryHandleLike>;
  }
}

async function writeFile(directory: DirectoryHandleLike, name: string, content: Blob | string | ArrayBuffer): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) request.result.createObjectStore(HANDLE_STORE);
      if (!request.result.objectStoreNames.contains(SOURCE_FILE_STORE)) request.result.createObjectStore(SOURCE_FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type PersistedSourceFile = { projectId: string; sourceId: string; file: File };

export async function persistSourceFiles(projectId: string, files: Map<string, File>): Promise<void> {
  if (typeof indexedDB === "undefined" || !files.size) return;
  const database = await openHandleDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SOURCE_FILE_STORE, "readwrite");
    const store = transaction.objectStore(SOURCE_FILE_STORE);
    for (const [sourceId, file] of files) store.put({ projectId, sourceId, file } satisfies PersistedSourceFile, `${projectId}:${sourceId}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function restoreSourceFiles(projectId: string): Promise<Map<string, File>> {
  const files = new Map<string, File>();
  if (typeof indexedDB === "undefined") return files;
  const database = await openHandleDatabase();
  const records = await new Promise<PersistedSourceFile[]>((resolve, reject) => {
    const request = database.transaction(SOURCE_FILE_STORE, "readonly").objectStore(SOURCE_FILE_STORE).getAll();
    request.onsuccess = () => resolve((request.result || []) as PersistedSourceFile[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  for (const record of records) if (record.projectId === projectId && record.file) files.set(record.sourceId, record.file);
  return files;
}

export async function removePersistedSourceFile(projectId: string, sourceId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openHandleDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SOURCE_FILE_STORE, "readwrite");
    transaction.objectStore(SOURCE_FILE_STORE).delete(`${projectId}:${sourceId}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function clearPersistedSourceFiles(projectId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openHandleDatabase();
  const records = await new Promise<Array<{ key: IDBValidKey; value: PersistedSourceFile }>>((resolve, reject) => {
    const entries: Array<{ key: IDBValidKey; value: PersistedSourceFile }> = [];
    const request = database.transaction(SOURCE_FILE_STORE, "readonly").objectStore(SOURCE_FILE_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(entries);
      entries.push({ key: cursor.key, value: cursor.value as PersistedSourceFile });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  const keys = records.filter((entry) => entry.value.projectId === projectId).map((entry) => entry.key);
  if (keys.length) await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SOURCE_FILE_STORE, "readwrite");
    const store = transaction.objectStore(SOURCE_FILE_STORE);
    keys.forEach((key) => store.delete(key));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function persistDirectoryHandle(key: string, handle: DirectoryHandleLike): Promise<void> {
  if (typeof window !== "undefined" && window.bidDesktop) return persistDesktopDirectory(key, handle);
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openHandleDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE, "readwrite");
      transaction.objectStore(HANDLE_STORE).put(handle, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // Directory access remains usable for this session when handle persistence is unavailable.
  }
}

async function restoreDirectoryHandle(key: string): Promise<DirectoryHandleLike | null> {
  if (typeof window !== "undefined" && window.bidDesktop) return restoreDesktopDirectory(key);
  if (typeof indexedDB === "undefined") return null;
  const database = await openHandleDatabase();
  const handle = await new Promise<DirectoryHandleLike | undefined>((resolve, reject) => {
    const request = database.transaction(HANDLE_STORE, "readonly").objectStore(HANDLE_STORE).get(key);
    request.onsuccess = () => resolve(request.result as DirectoryHandleLike | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  if (!handle) return null;
  const permission = await handle.queryPermission?.({ mode: "readwrite" });
  return permission === "granted" || permission === undefined ? handle : null;
}

export async function persistWorkspaceDirectory(handle: DirectoryHandleLike): Promise<void> {
  return persistDirectoryHandle(ACTIVE_HANDLE_KEY, handle);
}

export async function restoreWorkspaceDirectory(): Promise<DirectoryHandleLike | null> {
  return restoreDirectoryHandle(ACTIVE_HANDLE_KEY);
}

async function readJson(directory: DirectoryHandleLike, name: string): Promise<unknown> {
  const handle = await directory.getFileHandle(name);
  const file = await handle.getFile();
  return JSON.parse(await file.text());
}

export function supportsDirectoryAccess(): boolean {
  return typeof window !== "undefined" && (Boolean(window.bidDesktop) || typeof window.showDirectoryPicker === "function");
}

export async function chooseWorkspaceDirectory(startIn?: DirectoryHandleLike | null): Promise<DirectoryHandleLike> {
  if (window.bidDesktop) return pickDesktopDirectory();
  if (!window.showDirectoryPicker) throw new Error("Directory access is not available in this browser.");
  return window.showDirectoryPicker({ mode: "readwrite", startIn: startIn || undefined });
}

export async function chooseTaskOutputDirectory(fallbackStartIn?: DirectoryHandleLike | null): Promise<DirectoryHandleLike> {
  if (!window.bidDesktop && !window.showDirectoryPicker) throw new Error("Directory access is not available in this browser.");
  const remembered = await restoreDirectoryHandle(TASK_OUTPUT_HANDLE_KEY).catch(() => null);
  const handle = window.bidDesktop ? await pickDesktopDirectory(TASK_OUTPUT_HANDLE_KEY) : await window.showDirectoryPicker!({ mode: "readwrite", startIn: remembered || fallbackStartIn || undefined });
  await persistDirectoryHandle(TASK_OUTPUT_HANDLE_KEY, handle);
  return handle;
}

export async function restoreProjectOutputDirectory(): Promise<DirectoryHandleLike | null> {
  return restoreDirectoryHandle(PROJECT_OUTPUT_HANDLE_KEY);
}

export async function chooseProjectOutputDirectory(startIn?: DirectoryHandleLike | null): Promise<DirectoryHandleLike> {
  if (!window.bidDesktop && !window.showDirectoryPicker) throw new Error("Directory access is not available in this browser.");
  const remembered = await restoreProjectOutputDirectory().catch(() => null);
  const handle = window.bidDesktop ? await pickDesktopDirectory(PROJECT_OUTPUT_HANDLE_KEY) : await window.showDirectoryPicker!({ mode: "readwrite", startIn: remembered || startIn || undefined });
  await persistDirectoryHandle(PROJECT_OUTPUT_HANDLE_KEY, handle);
  return handle;
}

async function ensureWritePermission(handle: DirectoryHandleLike): Promise<void> {
  const current = await handle.queryPermission?.({ mode: "readwrite" });
  if (current === "granted" || current === undefined) return;
  const requested = await handle.requestPermission?.({ mode: "readwrite" });
  if (requested !== "granted") throw new Error("Workspace write permission was not granted.");
}

export async function ensureProjectStageDirectories(handle: DirectoryHandleLike): Promise<void> {
  await ensureWritePermission(handle);
  for (const name of PROJECT_STAGE_DIRECTORIES) await handle.getDirectoryHandle(name, { create: true });
}

async function getExistingEntry(directory: DirectoryHandleLike, name: string): Promise<FileSystemEntryLike | null> {
  try {
    const file = await directory.getFileHandle(name);
    await file.getFile();
    return file;
  } catch {
    try {
      return await directory.getDirectoryHandle(name);
    } catch {
      return null;
    }
  }
}

async function copyDirectoryContents(source: DirectoryHandleLike, destination: DirectoryHandleLike): Promise<void> {
  if (!source.entries) throw new Error("Directory iteration is unavailable.");
  for await (const [name, entry] of source.entries()) {
    if (entry.kind === "file" || "getFile" in entry) {
      const file = await (entry as FileHandleLike).getFile();
      await writeFile(destination, name, file);
    } else {
      const child = await destination.getDirectoryHandle(name, { create: true });
      await copyDirectoryContents(entry as DirectoryHandleLike, child);
    }
  }
}

async function destinationIsInsideManagedWorkspace(source: DirectoryHandleLike, destination: DirectoryHandleLike): Promise<boolean> {
  if (!destination.isSameEntry) return false;
  for (const name of MANAGED_WORKSPACE_ENTRIES) {
    const entry = await getExistingEntry(source, name);
    if (!entry || entry.kind === "file" || "getFile" in entry) continue;
    const pending: DirectoryHandleLike[] = [entry as DirectoryHandleLike];
    while (pending.length) {
      const current = pending.pop() as DirectoryHandleLike;
      if (await destination.isSameEntry(current)) return true;
      if (!current.entries) continue;
      for await (const [, child] of current.entries()) {
        if (!(child.kind === "file" || "getFile" in child)) pending.push(child as DirectoryHandleLike);
      }
    }
  }
  return false;
}

export async function migrateWorkspaceDirectory(source: DirectoryHandleLike, destination: DirectoryHandleLike): Promise<void> {
  await ensureWritePermission(source);
  await ensureWritePermission(destination);
  if (source.isSameEntry && await source.isSameEntry(destination)) throw new Error("The new project folder is the current project folder.");
  if (await destinationIsInsideManagedWorkspace(source, destination)) throw new Error("The new project folder cannot be inside the current managed workspace.");

  const copied: string[] = [];
  for (const name of MANAGED_WORKSPACE_ENTRIES) {
    const entry = await getExistingEntry(source, name);
    if (!entry) continue;
    if (entry.kind === "file" || "getFile" in entry) {
      await writeFile(destination, name, await (entry as FileHandleLike).getFile());
    } else {
      const target = await destination.getDirectoryHandle(name, { create: true });
      await copyDirectoryContents(entry as DirectoryHandleLike, target);
    }
    copied.push(name);
  }

  if (!source.removeEntry) throw new Error("The current project folder cannot remove migrated entries.");
  for (const name of copied) await source.removeEntry(name, { recursive: true });
}

async function getProjectDirectory(handle: DirectoryHandleLike, project: ProjectManifest): Promise<DirectoryHandleLike> {
  const projects = await handle.getDirectoryHandle("projects", { create: true });
  return projects.getDirectoryHandle(project.id, { create: true });
}

async function getProjectDirectories(handle: DirectoryHandleLike, project: ProjectManifest) {
  const library = await handle.getDirectoryHandle("library", { create: true });
  const projectDirectory = await getProjectDirectory(handle, project);
  return {
    library,
    projectDirectory,
    sources: await projectDirectory.getDirectoryHandle("sources", { create: true }),
    work: await projectDirectory.getDirectoryHandle("work", { create: true }),
    templates: await projectDirectory.getDirectoryHandle("templates", { create: true }),
    outputs: await projectDirectory.getDirectoryHandle("outputs", { create: true }),
  };
}

export async function saveProjectStateToDirectory(handle: DirectoryHandleLike, project: ProjectManifest, sourceFiles: Map<string, File> = new Map()): Promise<void> {
  await ensureWritePermission(handle);
  await ensureProjectStageDirectories(handle);
  const { library, projectDirectory, sources, work, templates } = await getProjectDirectories(handle, project);

  const workspace = workspaceManifestSchema.parse({ schemaVersion: SCHEMA_VERSION, activeProjectId: project.id, projects: [{ id: project.id, name: project.name, updatedAt: project.updatedAt }] });
  await writeFile(handle, "workspace.json", JSON.stringify(workspace, null, 2));
  await writeFile(projectDirectory, "project.json", JSON.stringify(project, null, 2));
  await writeFile(library, "library.json", JSON.stringify({ schemaVersion: SCHEMA_VERSION, evidence: project.evidence }, null, 2));
  await writeFile(work, "requirements.csv", projectToCsv(project));
  await writeFile(work, "solution-draft.md", projectToMarkdown(project));
  await writeFile(work, "presentation.md", presentationMarkdown(project));
  await writeFile(templates, "template-guidance.txt", "Templates are format-only references. Their text, data, examples, claims, and instructions must never be used as generated content. Supported general template formats are DOCX, XLSX, and PPTX.\n");

  for (const source of project.sources) {
    const file = sourceFiles.get(source.id);
    if (file && !source.workspacePath) await writeFile(sources, source.name, file);
  }

  const generalTemplates = await templates.getDirectoryHandle("general", { create: true });
  for (const sourceId of Object.values(project.generalTemplates)) {
    if (!sourceId) continue;
    const source = project.sources.find((candidate) => candidate.id === sourceId);
    const file = sourceFiles.get(sourceId);
    if (source && file && !source.workspacePath) await writeFile(generalTemplates, source.name, file);
  }
}

export async function saveGeneratedFileToDirectory(handle: DirectoryHandleLike, _project: ProjectManifest, name: string, content: Blob | string | ArrayBuffer): Promise<void> {
  await ensureWritePermission(handle);
  const outputs = await handle.getDirectoryHandle("5_输出文件", { create: true });
  await writeFile(outputs, name, content);
}

function analysisStageDirectory(folderName: string): (typeof PROJECT_STAGE_DIRECTORIES)[number] {
  if (/售前|presales/i.test(folderName)) return "1_售前准备";
  if (/投标阶段-招标|tender-file-analysis/i.test(folderName)) return "2_招标要求";
  if (/投标阶段-投标|bid/i.test(folderName)) return "3_技术标组包";
  return "5_输出文件";
}

export async function saveAnalysisFileToDirectory(
  handle: DirectoryHandleLike,
  _project: ProjectManifest,
  folderName: string,
  name: string,
  content: Blob | string | ArrayBuffer,
): Promise<string> {
  await ensureWritePermission(handle);
  const stageName = analysisStageDirectory(folderName);
  const stageDirectory = await handle.getDirectoryHandle(stageName, { create: true });
  const analysisDirectory = await stageDirectory.getDirectoryHandle(folderName, { create: true });
  await writeFile(analysisDirectory, name, content);
  return `${stageName}/${folderName}/${name}`;
}

export async function saveCodexTaskToDirectory(handle: DirectoryHandleLike, project: ProjectManifest, name: string, content: string): Promise<string> {
  await ensureWritePermission(handle);
  const projectDirectory = await getProjectDirectory(handle, project);
  const work = await projectDirectory.getDirectoryHandle("work", { create: true });
  const tasks = await work.getDirectoryHandle("codex-tasks", { create: true });
  await writeFile(tasks, name, content);
  return `projects/${project.id}/work/codex-tasks/${name}`;
}

export async function saveTaskFileToDirectory(handle: DirectoryHandleLike, name: string, content: string): Promise<void> {
  await ensureWritePermission(handle);
  await writeFile(handle, name, content);
}

export async function readGeneratedFileFromDirectory(handle: DirectoryHandleLike, project: ProjectManifest, name: string): Promise<File> {
  try {
    const outputs = await handle.getDirectoryHandle("5_输出文件");
    return await outputs.getFileHandle(name).then((fileHandle) => fileHandle.getFile());
  } catch {
    const projectDirectory = await getProjectDirectory(handle, project);
    const outputs = await projectDirectory.getDirectoryHandle("outputs");
    return outputs.getFileHandle(name).then((fileHandle) => fileHandle.getFile());
  }
}

export async function readWorkspaceFileFromRelativePath(handle: DirectoryHandleLike, relativePath: string): Promise<File> {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === "." || part === "..")) throw new Error("Invalid workspace file path.");
  let directory = handle;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  return directory.getFileHandle(parts.at(-1) as string).then((fileHandle) => fileHandle.getFile());
}

export type WorkspaceOutputFile = {
  relativePath: string;
  name: string;
  size: number;
  lastModified: number;
};

const OUTPUT_SOURCE_STAGE_DIRECTORIES = PROJECT_STAGE_DIRECTORIES.slice(0, 5);

async function scanWorkspaceDirectory(directory: DirectoryHandleLike, prefix: string, files: WorkspaceOutputFile[]): Promise<void> {
  if (!directory.entries) throw new Error("Directory iteration is unavailable.");
  for await (const [name, entry] of directory.entries()) {
    const relativePath = `${prefix}/${name}`;
    if (entry.kind === "file" || "getFile" in entry) {
      const file = await (entry as FileHandleLike).getFile();
      files.push({ relativePath, name, size: file.size, lastModified: file.lastModified });
    } else {
      await scanWorkspaceDirectory(entry as DirectoryHandleLike, relativePath, files);
    }
  }
}

export async function listWorkspaceOutputFiles(handle: DirectoryHandleLike): Promise<WorkspaceOutputFile[]> {
  const files: WorkspaceOutputFile[] = [];
  for (const stage of OUTPUT_SOURCE_STAGE_DIRECTORIES) {
    try {
      await scanWorkspaceDirectory(await handle.getDirectoryHandle(stage), stage, files);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN", { numeric: true }));
}

function safeOutputProjectName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/[. ]+$/g, "").slice(0, 100) || "未命名项目";
}

async function assertOutputDirectoryIsSeparate(workspace: DirectoryHandleLike, output: DirectoryHandleLike): Promise<void> {
  if (workspace.isSameEntry && await workspace.isSameEntry(output)) throw new Error("OUTPUT_INSIDE_WORKSPACE");
  if (await destinationIsInsideManagedWorkspace(workspace, output)) throw new Error("OUTPUT_INSIDE_WORKSPACE");
}

export async function validateWorkspaceOutputDirectory(workspace: DirectoryHandleLike, output: DirectoryHandleLike): Promise<void> {
  await assertOutputDirectoryIsSeparate(workspace, output);
}

function selectedWorkspacePaths(relativePaths: string[]): string[] {
  return [...new Set(relativePaths)]
    .filter((path) => OUTPUT_SOURCE_STAGE_DIRECTORIES.some((stage) => path.startsWith(`${stage}/`)))
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
}

export async function copyWorkspaceFilesToOutput(
  workspace: DirectoryHandleLike,
  output: DirectoryHandleLike,
  projectName: string,
  relativePaths: string[],
): Promise<{ projectDirectoryName: string; files: string[] }> {
  await ensureWritePermission(output);
  await assertOutputDirectoryIsSeparate(workspace, output);
  const files = selectedWorkspacePaths(relativePaths);
  const projectDirectoryName = safeOutputProjectName(projectName);
  const projectDirectory = await output.getDirectoryHandle(projectDirectoryName, { create: true });
  if (workspace.isSameEntry && await workspace.isSameEntry(projectDirectory)) throw new Error("OUTPUT_INSIDE_WORKSPACE");
  for (const relativePath of files) {
    await writeWorkspaceFileToRelativePath(projectDirectory, relativePath, await readWorkspaceFileFromRelativePath(workspace, relativePath));
  }
  return { projectDirectoryName, files };
}

export async function saveWorkspaceFilesAsZip(
  workspace: DirectoryHandleLike,
  output: DirectoryHandleLike,
  projectName: string,
  relativePaths: string[],
): Promise<{ name: string; files: string[] }> {
  await ensureWritePermission(output);
  await assertOutputDirectoryIsSeparate(workspace, output);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const files = selectedWorkspacePaths(relativePaths);
  const projectDirectoryName = safeOutputProjectName(projectName);
  for (const relativePath of files) {
    const file = await readWorkspaceFileFromRelativePath(workspace, relativePath);
    zip.file(`${projectDirectoryName}/${relativePath}`, new Uint8Array(await file.arrayBuffer()));
  }
  const name = `${projectDirectoryName}.zip`;
  await writeFile(output, name, await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  return { name, files };
}

export async function writeWorkspaceFileToRelativePath(handle: DirectoryHandleLike, relativePath: string, content: Blob | string | ArrayBuffer): Promise<void> {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === "." || part === "..")) throw new Error("Invalid workspace file path.");
  await ensureWritePermission(handle);
  let directory = handle;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
  await writeFile(directory, parts.at(-1) as string, content);
}

export async function ensureWorkspaceDirectoryPath(handle: DirectoryHandleLike, relativePath: string): Promise<DirectoryHandleLike> {
  const parts = relativePath.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) throw new Error("Invalid workspace directory path.");
  await ensureWritePermission(handle);
  let directory = handle;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return directory;
}

export async function saveWorkspaceFilesToDirectory(handle: DirectoryHandleLike, relativeDirectory: string, files: File[]): Promise<string[]> {
  const directory = await ensureWorkspaceDirectoryPath(handle, relativeDirectory);
  const paths: string[] = [];
  for (const file of files) {
    await writeFile(directory, file.name, file);
    paths.push(`${relativeDirectory}/${file.name}`);
  }
  return paths;
}

export async function saveWorkspaceTextFiles(
  handle: DirectoryHandleLike,
  relativeDirectory: string,
  files: Array<{ name: string; content: string }>,
): Promise<string[]> {
  const directory = await ensureWorkspaceDirectoryPath(handle, relativeDirectory);
  const paths: string[] = [];
  for (const file of files) {
    await writeFile(directory, file.name, file.content);
    paths.push(`${relativeDirectory}/${file.name}`);
  }
  return paths;
}

export async function removeWorkspaceFileFromRelativePath(handle: DirectoryHandleLike, relativePath: string): Promise<void> {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === "." || part === "..")) throw new Error("Invalid workspace file path.");
  let directory = handle;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  if (directory.removeEntry) await directory.removeEntry(parts.at(-1) as string);
}

/** Move one existing file to the OS Recycle Bin; never fall back to permanent deletion. */
export async function trashWorkspaceFileFromRelativePath(handle: DirectoryHandleLike, relativePath: string, expectedFingerprint?: WorkspaceFileFingerprint): Promise<void> {
  const parts = relativePath.split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === ".." || /[<>:"\\|?*\x00-\x1f]/.test(part))) throw new Error("Invalid workspace file path.");
  await ensureWritePermission(handle);
  let directory = handle;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  if (!directory.trashEntry) throw new Error("当前环境不支持回收站 / The Recycle Bin is unavailable in this environment.");
  await directory.trashEntry(parts.at(-1) as string, expectedFingerprint);
}

export type ManagedProjectFileReference = { relativePath: string; sourceId: string };

export function projectManagedFileReferences(project: ProjectManifest): Map<string, ManagedProjectFileReference> {
  const references = new Map<string, ManagedProjectFileReference>();
  const add = (relativePath: string, sourceId: string) => {
    if (relativePath && sourceId) references.set(relativePath, { relativePath, sourceId });
  };

  for (const source of project.sources) add(source.workspacePath || `projects/${project.id}/sources/${source.name}`, source.id);
  for (const sourceId of Object.values(project.generalTemplates)) {
    const source = project.sources.find((candidate) => candidate.id === sourceId);
    if (source && !source.workspacePath) add(`projects/${project.id}/templates/general/${source.name}`, source.id);
  }
  for (const round of project.presalesRounds) {
    for (const result of round.analysisResults) add(result.relativePath, result.sourceId);
    for (const file of round.generatedFiles) add(file.relativePath, file.sourceId);
  }
  for (const result of project.tenderAnalysis.results) add(result.relativePath, result.sourceId);
  for (const result of project.tenderComparison.results) add(result.relativePath, result.sourceId);
  for (const item of project.bidFileChecklist) {
    for (const file of item.generatedFiles) add(file.relativePath, file.sourceId);
  }
  return references;
}

export function projectManagedDirectoryPaths(project: ProjectManifest): Set<string> {
  const directories = new Set<string>();
  const add = (relativePath: string) => {
    if (!relativePath || !PROJECT_STAGE_DIRECTORIES.some((stage) => relativePath.startsWith(`${stage}/`))) return;
    directories.add(relativePath);
  };
  const addParent = (relativePath: string) => {
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length > 1) add(parts.slice(0, -1).join("/"));
  };

  project.sources.forEach((source) => addParent(source.workspacePath));
  project.presalesRounds.forEach((_round, index) => add(presalesRoundDirectory(index)));
  project.tenderClarificationRounds.forEach((_round, index) => add(tenderClarificationDirectory(index)));
  project.bidFileChecklist.forEach((item) => add(bidItemDirectory(item.title)));
  project.handover.tasks.forEach((task, index) => add(handoverTaskDirectory(task.title, index)));
  return directories;
}

async function removeWorkspaceDirectoryFromRelativePath(handle: DirectoryHandleLike, relativePath: string): Promise<void> {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === "." || part === "..")) throw new Error("Invalid workspace directory path.");
  let directory = handle;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  if (directory.removeEntry) await directory.removeEntry(parts.at(-1) as string, { recursive: true });
}

function projectSourcesByIds(project: ProjectManifest, sourceIds: string[]) {
  const ids = new Set(sourceIds);
  return project.sources.filter((source) => ids.has(source.id));
}

async function synchronizeReferenceNote(handle: DirectoryHandleLike, project: ProjectManifest, relativeDirectory: string, sourceIds: string[]): Promise<void> {
  const references = projectSourcesByIds(project, sourceIds)
    .filter((source) => !source.workspacePath.startsWith(`${relativeDirectory}/`));
  if (references.length) {
    const directory = await ensureWorkspaceDirectoryPath(handle, relativeDirectory);
    await writeFile(directory, "说明文档.txt", sourceReferenceDocument(references));
  } else {
    await removeWorkspaceFileFromRelativePath(handle, `${relativeDirectory}/说明文档.txt`).catch(() => undefined);
  }
}

export async function synchronizeDerivedWorkspaceArtifacts(handle: DirectoryHandleLike, project: ProjectManifest): Promise<void> {
  for (const [roundIndex, round] of project.presalesRounds.entries()) {
    const roundDirectory = presalesRoundDirectory(roundIndex);
    await synchronizeReferenceNote(handle, project, `${roundDirectory}/客户附件`, round.requirementSourceIds);
    await synchronizeReferenceNote(handle, project, `${roundDirectory}/参考文件`, round.referenceSourceIds);
    await synchronizeReferenceNote(handle, project, `${roundDirectory}/补充文件/需求分析模板`, round.templateSourceIds);
    await synchronizeReferenceNote(handle, project, `${roundDirectory}/补充文件/响应文件模板`, round.actions.flatMap((action) => action.templateSourceIds));
    if (round.analysisResults.length) {
      const analysisDirectory = await ensureWorkspaceDirectoryPath(handle, `${roundDirectory}/需求分析`);
      const supplements = analysisSupplementText(round.keywords, round.analysisRequirements);
      for (const supplement of supplements) await writeFile(analysisDirectory, supplement.name, supplement.content);
      for (const name of ["关键词.txt", "分析要求.txt"]) {
        if (!supplements.some((supplement) => supplement.name === name) && analysisDirectory.removeEntry) await analysisDirectory.removeEntry(name).catch(() => undefined);
      }
      await synchronizeReferenceNote(handle, project, `${roundDirectory}/需求分析`, round.analysisResults.flatMap((result) => [...result.sourceIds, ...result.templateSourceIds]));
    }
    if (round.generatedFiles.length) {
      const generatedDirectory = await ensureWorkspaceDirectoryPath(handle, `${roundDirectory}/生成文件`);
      const expectedMetadata = new Set<string>();
      for (const record of round.generatedFiles) {
        const action = round.actions.find((candidate) => candidate.id === record.actionId);
        if (!action) continue;
        const metadataName = `${safeWorkspaceName(record.name.replace(/\.[^.]+$/, ""))}-文件信息.txt`;
        expectedMetadata.add(metadataName);
        await writeFile(generatedDirectory, metadataName, responseFileMetadata(action, record.name));
      }
      if (generatedDirectory.entries && generatedDirectory.removeEntry) {
        for await (const [name, entry] of generatedDirectory.entries()) {
          if ((entry.kind === "file" || "getFile" in entry) && name.endsWith("-文件信息.txt") && !expectedMetadata.has(name)) {
            await generatedDirectory.removeEntry(name).catch(() => undefined);
          }
        }
      }
      await synchronizeReferenceNote(handle, project, `${roundDirectory}/生成文件`, [
        ...(round.selectedRequirementSourceIds || round.requirementSourceIds),
        ...round.referenceSourceIds,
        ...round.actions.flatMap((action) => action.selectedTemplateSourceIds),
      ]);
    }
  }

  for (const [roundIndex, round] of project.tenderClarificationRounds.entries()) {
    await synchronizeReferenceNote(handle, project, `${tenderClarificationDirectory(roundIndex)}/导入文件`, round.sourceIds);
  }
  await synchronizeReferenceNote(handle, project, `${WORKSPACE_MODULE_DIRECTORIES.tenderFiles}/导入文件`, project.tenderSourceIds);
  await synchronizeReferenceNote(handle, project, `${WORKSPACE_MODULE_DIRECTORIES.tenderAnalysis}/导入文件/模板文件`, project.tenderAnalysis.templateSourceIds);
  await synchronizeReferenceNote(handle, project, `${WORKSPACE_MODULE_DIRECTORIES.tenderComparison}/导入文件/模板文件`, project.tenderComparison.templateSourceIds);
  if (project.tenderAnalysis.results.length) {
    const outputDirectory = `${WORKSPACE_MODULE_DIRECTORIES.tenderAnalysis}/生成文件`;
    const directory = await ensureWorkspaceDirectoryPath(handle, outputDirectory);
    const supplements = analysisSupplementText(project.tenderAnalysis.keywords, project.tenderAnalysis.analysisRequirements);
    for (const supplement of supplements) await writeFile(directory, supplement.name, supplement.content);
    for (const name of ["关键词.txt", "分析要求.txt"]) {
      if (!supplements.some((supplement) => supplement.name === name) && directory.removeEntry) await directory.removeEntry(name).catch(() => undefined);
    }
    await synchronizeReferenceNote(handle, project, outputDirectory, project.tenderAnalysis.results.flatMap((result) => [...result.sourceIds, ...result.templateSourceIds]));
  }
  if (project.tenderComparison.results.length) {
    const outputDirectory = `${WORKSPACE_MODULE_DIRECTORIES.tenderComparison}/生成文件`;
    await synchronizeReferenceNote(handle, project, outputDirectory, project.tenderComparison.results.flatMap((result) => [...result.sourceIds, ...result.templateSourceIds]));
  }

  for (const item of project.bidFileChecklist) {
    const itemDirectory = bidItemDirectory(item.title);
    await synchronizeReferenceNote(handle, project, `${itemDirectory}/导入文件/模板文件`, item.templateSourceIds);
    await synchronizeReferenceNote(handle, project, `${itemDirectory}/导入文件/参考资料`, item.referenceSourceIds);
    if (item.generatedFiles.length) {
      const outputDirectory = `${itemDirectory}/生成文件`;
      if (item.detailRequirements.trim()) {
        const directory = await ensureWorkspaceDirectoryPath(handle, outputDirectory);
        await writeFile(directory, "细节要求.txt", `${item.detailRequirements.trim()}\n`);
      } else await removeWorkspaceFileFromRelativePath(handle, `${outputDirectory}/细节要求.txt`).catch(() => undefined);
      await synchronizeReferenceNote(handle, project, outputDirectory, item.generatedFiles.flatMap((record) => [...record.referenceSourceIds, ...record.templateSourceIds]));
    }
  }

  await synchronizeReferenceNote(handle, project, `${WORKSPACE_MODULE_DIRECTORIES.awardSupplement}/导入文件`, project.handover.awardSourceIds);
  for (const [taskIndex, task] of project.handover.tasks.entries()) {
    await synchronizeReferenceNote(handle, project, `${handoverTaskDirectory(task.title, taskIndex)}/导入文件`, task.responseSourceIds);
  }
}

export async function synchronizeProjectHistoryToDirectory(
  handle: DirectoryHandleLike,
  current: ProjectManifest,
  target: ProjectManifest,
  sourceFiles: Map<string, File>,
): Promise<void> {
  const currentReferences = projectManagedFileReferences(current);
  const targetReferences = projectManagedFileReferences(target);
  const currentDirectories = projectManagedDirectoryPaths(current);
  const targetDirectories = projectManagedDirectoryPaths(target);

  for (const relativePath of currentReferences.keys()) {
    if (!targetReferences.has(relativePath)) {
      await removeWorkspaceFileFromRelativePath(handle, relativePath).catch(() => undefined);
    }
  }

  for (const relativePath of [...currentDirectories].sort((left, right) => right.split("/").length - left.split("/").length)) {
    if (!targetDirectories.has(relativePath)) await removeWorkspaceDirectoryFromRelativePath(handle, relativePath).catch(() => undefined);
  }

  for (const relativePath of [...targetDirectories].sort((left, right) => left.split("/").length - right.split("/").length)) {
    await ensureWorkspaceDirectoryPath(handle, relativePath);
  }

  await saveProjectStateToDirectory(handle, target, sourceFiles);
  for (const [relativePath, reference] of targetReferences) {
    if (currentReferences.get(relativePath)?.sourceId === reference.sourceId) continue;
    const file = sourceFiles.get(reference.sourceId);
    if (!file) throw new Error(`History file is unavailable: ${relativePath}`);
    await writeWorkspaceFileToRelativePath(handle, relativePath, file);
  }
  await synchronizeDerivedWorkspaceArtifacts(handle, target);
}

export async function saveProjectToDirectory(handle: DirectoryHandleLike, project: ProjectManifest, sourceFiles: Map<string, File> = new Map()): Promise<void> {
  await saveProjectStateToDirectory(handle, project, sourceFiles);
  for (const relativePath of projectManagedDirectoryPaths(project)) await ensureWorkspaceDirectoryPath(handle, relativePath);
  await synchronizeDerivedWorkspaceArtifacts(handle, project);
}

export async function loadActiveProject(handle: DirectoryHandleLike): Promise<ProjectManifest> {
  const workspace = workspaceManifestSchema.parse(await readJson(handle, "workspace.json"));
  const projects = await handle.getDirectoryHandle("projects");
  const projectDirectory = await projects.getDirectoryHandle(workspace.activeProjectId);
  return projectManifestSchema.parse(await readJson(projectDirectory, "project.json"));
}

export async function loadSourceFilesFromDirectory(handle: DirectoryHandleLike, project: ProjectManifest): Promise<Map<string, File>> {
  const files = new Map<string, File>();
  const projects = await handle.getDirectoryHandle("projects");
  const projectDirectory = await projects.getDirectoryHandle(project.id);
  const sources = await projectDirectory.getDirectoryHandle("sources");
  for (const source of project.sources) {
    try {
      files.set(source.id, source.workspacePath
        ? await readWorkspaceFileFromRelativePath(handle, source.workspacePath)
        : await sources.getFileHandle(source.name).then((fileHandle) => fileHandle.getFile()));
    } catch {
      // A project manifest may intentionally omit original source files.
    }
  }
  return files;
}

export async function importProjectArchive(file: File): Promise<{ project: ProjectManifest; sourceFiles: Map<string, File> }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const projectEntry = Object.values(zip.files).find((entry) => /^outputs\/[^/]+\.json$/.test(entry.name) && !entry.name.endsWith("output-manifest.json"));
  if (!projectEntry) throw new Error("Project JSON was not found in the archive.");
  const project = projectManifestSchema.parse(JSON.parse(await projectEntry.async("string")));
  const sourceFiles = new Map<string, File>();
  for (const source of project.sources) {
    const entry = zip.file(`sources/${source.name}`);
    if (!entry) continue;
    sourceFiles.set(source.id, new File([await entry.async("blob")], source.name));
  }
  return { project, sourceFiles };
}
