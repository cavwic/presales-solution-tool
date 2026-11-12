import { beforeEach, describe, expect, it, vi } from "vitest";
import { bidFileChecklistItemSchema, createEmptyProject, sourceDocumentSchema } from "./workspace-schema";
import type { NativeHandle } from "./desktop-bridge";
import type { ProjectLibraryApi, ProjectLibraryEntry } from "./project-library";

const memory = vi.hoisted(() => ({
  files: new Map<string, Blob>(), directories: new Set<string>(), writes: [] as string[], events: [] as string[],
  fail: "", gate: null as null | { promise: Promise<void>; release(): void; used: boolean },
}));

vi.mock("./desktop-bridge", () => {
  class DesktopDirectoryHandle {
    readonly kind = "directory";
    constructor(readonly native: NativeHandle) {}
    get name() { return this.native.name; }
    key(relative = "") { return [this.native.rootId, this.native.relativePath, relative].filter(Boolean).join("/"); }
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const key = this.key(name);
      if (options?.create) memory.directories.add(key);
      if (!memory.directories.has(key)) throw new DOMException("Missing folder", "NotFoundError");
      return new DesktopDirectoryHandle({ ...this.native, relativePath: [this.native.relativePath, name].filter(Boolean).join("/"), name });
    }
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const key = this.key(name);
      if (!options?.create && !memory.files.has(key)) throw new DOMException("Missing file", "NotFoundError");
      return {
        getFile: async () => {
          const content = memory.files.get(key);
          if (!content) throw new DOMException("Missing file", "NotFoundError");
          return new File([content], name);
        },
        createWritable: async () => {
          let pending: Blob | null = null;
          return {
            write: async (data: Blob | string | ArrayBuffer) => { pending = data instanceof Blob ? data : new Blob([data]); },
            close: async () => {
              if (!pending) return;
              memory.events.push(`write:${key}`);
              if (memory.gate && !memory.gate.used && key.endsWith("/shared.txt")) { memory.gate.used = true; await memory.gate.promise; }
              if (memory.fail && key.endsWith(memory.fail)) throw new Error("Disk is full");
              memory.files.set(key, pending); memory.writes.push(key);
            },
          };
        },
      };
    }
    async isSameEntry(other: DesktopDirectoryHandle) { return this.key() === other.key(); }
    async queryPermission() { return "granted"; }
  }
  return { DesktopDirectoryHandle };
});

import { DesktopDirectoryHandle } from "./desktop-bridge";
import { loadProjectFromLibrary, saveProjectToLibrary } from "./project-library";
import { readWorkspaceFileFromRelativePath, writeWorkspaceFileToRelativePath } from "./workspace-io";

function setup() {
  const entries = new Map<string, ProjectLibraryEntry>();
  const native = (id: string): NativeHandle => ({ rootId: `archive-${id}`, relativePath: "", kind: "directory", name: id });
  const empty = (id: string, name: string): ProjectLibraryEntry => ({ id, name, folderName: id, folderPath: `D:/fixture/项目资料/${id}`, customerAlias: "", industry: "", owner: "", stage: "presales", createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z", submittedAt: null, sourceCount: 0, generatedCount: 0, missingFiles: [], originLabel: "" });
  const api: ProjectLibraryApi = {
    info: async () => ({ rootPath: "D:/fixture/项目资料" }),
    prepare: async ({ id, name }) => { memory.directories.add(native(id).rootId); return { entry: entries.get(id) || empty(id, name), directory: native(id) }; },
    commit: vi.fn(async input => { memory.events.push(`commit:${input.id}`); const entry = { ...(entries.get(input.id) || empty(input.id, input.name)), ...input, missingFiles: input.missingFiles || [], originLabel: input.originLabel || "" }; entries.set(input.id, entry); return entry; }),
    list: async () => [...entries.values()],
    get: async ({ id }) => { const entry = entries.get(id); if (!entry) throw new Error("Project not found"); return { entry, directory: native(id) }; },
    setSubmitted: async ({ id, submitted }) => { const prior = entries.get(id)!; const entry = { ...prior, submittedAt: submitted ? "2026-11-11T12:00:00Z" : null }; entries.set(id, entry); return entry; },
    openFolder: async () => {},
  };
  vi.stubGlobal("window", { bidDesktop: { projects: api } });
  return { api, entries };
}

function source(id: string, name = "shared.txt", workspacePath = "") {
  return sourceDocumentSchema.parse({ id, name, fileType: "txt", size: 5, sha256: `sha-${id}`, importedAt: "2026-11-11T00:00:00Z", segments: [], workspacePath });
}

beforeEach(() => {
  memory.files.clear(); memory.directories.clear(); memory.writes.length = 0; memory.events.length = 0;
  memory.fail = ""; memory.gate = null; vi.unstubAllGlobals();
});

describe("project library mirrors", () => {
  it("keeps duplicate source names in distinct stable folders and restores the complete project", async () => {
    const { api } = setup();
    const project = createEmptyProject("zh"); project.sources = [source("source-a"), source("source-b")];
    const before = JSON.stringify(project);
    const files = new Map([["source-a", new File(["first"], "shared.txt")], ["source-b", new File(["other"], "shared.txt")]]);
    const saved = await saveProjectToLibrary({ project, sourceFiles: files });
    expect(saved.project.sources[0].workspacePath).not.toBe(saved.project.sources[1].workspacePath);
    expect(JSON.stringify(project)).toBe(before);
    const restored = await loadProjectFromLibrary(project.id);
    expect(await restored.sourceFiles.get("source-a")!.text()).toBe("first");
    expect(await restored.sourceFiles.get("source-b")!.text()).toBe("other");
    expect(restored.entry.missingFiles).toEqual([]);
    expect(api.commit).toHaveBeenCalledOnce();
    expect(memory.events.at(-1)).toBe(`commit:${project.id}`);
  });

  it("reuses successful File copies across ordinary text edits and does not delete old archive files", async () => {
    setup(); const project = createEmptyProject("zh"); project.sources = [source("source-a")];
    const file = new File(["first"], "shared.txt"), files = new Map([["source-a", file]]);
    const first = await saveProjectToLibrary({ project, sourceFiles: files });
    await saveProjectToLibrary({ project: { ...project, objective: "Updated objective" }, sourceFiles: files });
    expect(memory.writes.filter(path => path.endsWith("/shared.txt"))).toHaveLength(1);
    await saveProjectToLibrary({ project: { ...project, sources: [] }, sourceFiles: new Map() });
    expect(await (await readWorkspaceFileFromRelativePath(first.directory, first.project.sources[0].workspacePath)).text()).toBe("first");
  });

  it("copies an existing authorized relative path without writing to the original directory", async () => {
    setup(); const project = createEmptyProject("zh"); project.sources = [source("source-a", "shared.txt", "1_售前准备/资料/shared.txt")];
    const directory = new DesktopDirectoryHandle({ rootId: "external", relativePath: "", kind: "directory", name: "External project" });
    memory.directories.add("external");
    await writeWorkspaceFileToRelativePath(directory, project.sources[0].workspacePath, "first");
    const originalWrites = memory.writes.filter(path => path.startsWith("external/")).length;
    const saved = await saveProjectToLibrary({ project, sourceFiles: new Map(), directory });
    expect(saved.project.sources[0].workspacePath).toBe(project.sources[0].workspacePath);
    expect(saved.entry.originLabel).toBe("External project");
    expect(await (await readWorkspaceFileFromRelativePath(saved.directory, project.sources[0].workspacePath)).text()).toBe("first");
    expect(memory.writes.filter(path => path.startsWith("external/"))).toHaveLength(originalWrites);
  });

  it("preserves missing-file metadata and does not report a non-existent file as restored", async () => {
    setup(); const project = createEmptyProject("zh"); project.sources = [source("missing")];
    const saved = await saveProjectToLibrary({ project, sourceFiles: new Map() });
    expect(saved.entry.missingFiles).toEqual([saved.project.sources[0].workspacePath]);
    const loaded = await loadProjectFromLibrary(project.id);
    expect(loaded.sourceFiles.size).toBe(0);
    expect(loaded.project.sources).toHaveLength(1);
  });

  it("archives a generated download Blob once and rewrites its record to the archived file", async () => {
    setup(); const project = createEmptyProject("zh"); project.sources = [source("generated", "answer.md")];
    project.bidFileChecklist = [bidFileChecklistItemSchema.parse({ id: "bid-a", title: "Response", category: "technical", generatedFiles: [{ id: "generated-record", name: "answer.md", format: "md", createdAt: "2026-11-11T00:00:00Z", provider: "local", model: "fixture", sourceId: "generated", relativePath: "downloads/answer.md" }] })];
    const saved = await saveProjectToLibrary({ project, sourceFiles: new Map(), generatedBlobs: new Map([["generated-record", new Blob(["# Response"])]]) });
    expect(saved.project.bidFileChecklist[0].generatedFiles[0].relativePath).toBe(saved.project.sources[0].workspacePath);
    expect(saved.project.sources[0].workspacePath.startsWith("5_输出文件/")).toBe(true);
    expect(memory.writes.filter(path => path.endsWith("/answer.md"))).toHaveLength(1);
    expect(saved.entry.generatedCount).toBe(1); expect(saved.entry.sourceCount).toBe(0);
    expect(await (await loadProjectFromLibrary(project.id)).sourceFiles.get("generated")!.text()).toBe("# Response");
  });

  it("does not commit after a binary write fails and retries that file on the next save", async () => {
    const { api } = setup(); const project = createEmptyProject("zh"); project.sources = [source("source-a")];
    const files = new Map([["source-a", new File(["first"], "shared.txt")]]);
    memory.fail = "/shared.txt";
    await expect(saveProjectToLibrary({ project, sourceFiles: files })).rejects.toThrow("Disk is full");
    expect(api.commit).not.toHaveBeenCalled();
    expect([...memory.files.keys()].some(key => key.endsWith("project.json"))).toBe(false);
    memory.fail = "";
    await saveProjectToLibrary({ project, sourceFiles: files });
    expect(api.commit).toHaveBeenCalledOnce();
    expect(memory.writes.filter(path => path.endsWith("/shared.txt"))).toHaveLength(1);
  });

  it("keeps an older generated record readable even when its source metadata is absent", async () => {
    setup(); const project = createEmptyProject("zh");
    project.bidFileChecklist = [bidFileChecklistItemSchema.parse({ id: "bid-a", title: "Response", category: "technical", generatedFiles: [{ id: "old-record", name: "old.md", format: "md", createdAt: "2026-11-11T00:00:00Z", provider: "local", model: "fixture", sourceId: "old-source", relativePath: "downloads/old.md" }] })];
    const saved = await saveProjectToLibrary({ project, sourceFiles: new Map(), generatedBlobs: new Map([["old-record", new Blob(["Older generated file"])]]) });
    const path = saved.project.bidFileChecklist[0].generatedFiles[0].relativePath;
    expect(path.startsWith("5_输出文件/历史生成文件/")).toBe(true);
    expect(await (await readWorkspaceFileFromRelativePath(saved.directory, path)).text()).toBe("Older generated file");
    expect(saved.entry.missingFiles).toEqual([]);
  });

  it.each([
    "workspace.json", "WORKSPACE.JSON", "library/library.json", "projects/{id}/project.json",
    "projects/{id}/work/requirements.csv", "projects/{id}/work/solution-draft.md", "projects/{id}/work/presentation.md",
    "projects/{id}/templates/template-guidance.txt", "workspace.json/attachment.txt", "projects/{id}/sources",
  ])("preserves original bytes when a source claims metadata path %s", async template => {
    setup(); const project = createEmptyProject("zh");
    const originalPath = template.replace("{id}", project.id);
    project.sources = [source("evidence", "original-evidence.txt", originalPath)];
    const bytes = new Uint8Array([0, 1, 2, 10, 128, 255]);
    const saved = await saveProjectToLibrary({ project, sourceFiles: new Map([["evidence", new File([bytes], "original-evidence.txt")]]) });
    expect(saved.project.sources[0].workspacePath.startsWith("0_项目客户方资料/历史资料/")).toBe(true);
    expect(project.sources[0].workspacePath).toBe(originalPath);
    const restored = await loadProjectFromLibrary(project.id);
    expect(new Uint8Array(await restored.sourceFiles.get("evidence")!.arrayBuffer())).toEqual(bytes);
    expect(restored.entry.missingFiles).toEqual([]);
  });

  it("remaps conflicting generated metadata paths while retaining a normal source stage path", async () => {
    setup(); const project = createEmptyProject("zh");
    const normalSourcePath = "3_技术标组包/正常生成文件/answer.md";
    const metadataPath = `projects/${project.id}/work/presentation.md`;
    project.sources = [source("generated", "answer.md", normalSourcePath)];
    project.bidFileChecklist = [bidFileChecklistItemSchema.parse({ id: "bid-a", title: "Response", category: "technical", generatedFiles: [{ id: "record-a", name: "answer.md", format: "md", createdAt: "2026-11-11T00:00:00Z", provider: "local", model: "fixture", sourceId: "generated", relativePath: metadataPath }] })];
    const saved = await saveProjectToLibrary({ project, sourceFiles: new Map([["generated", new File(["Original response bytes"], "answer.md")]]) });
    expect(saved.project.sources[0].workspacePath).toBe(normalSourcePath);
    const generatedPath = saved.project.bidFileChecklist[0].generatedFiles[0].relativePath;
    expect(generatedPath.startsWith("5_输出文件/历史生成文件/")).toBe(true);
    expect(await (await readWorkspaceFileFromRelativePath(saved.directory, generatedPath)).text()).toBe("Original response bytes");
    expect(await (await readWorkspaceFileFromRelativePath(saved.directory, metadataPath)).text()).not.toBe("Original response bytes");
    expect(project.bidFileChecklist[0].generatedFiles[0].relativePath).toBe(metadataPath);
  });

  it("serializes saves for one project so an older write cannot overwrite a newer snapshot", async () => {
    const { entries } = setup(); const project = createEmptyProject("zh"); project.sources = [source("source-a")];
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    memory.gate = { promise, release, used: false };
    const first = saveProjectToLibrary({ project: { ...project, name: "First" }, sourceFiles: new Map([["source-a", new File(["first"], "shared.txt")]]) });
    await vi.waitFor(() => expect(memory.gate?.used).toBe(true));
    const second = saveProjectToLibrary({ project: { ...project, name: "Latest" }, sourceFiles: new Map([["source-a", new File(["newer"], "shared.txt")]]) });
    expect(entries.size).toBe(0);
    release(); await Promise.all([first, second]);
    expect(entries.get(project.id)?.name).toBe("Latest");
    expect((await loadProjectFromLibrary(project.id)).project.name).toBe("Latest");
  });
});
