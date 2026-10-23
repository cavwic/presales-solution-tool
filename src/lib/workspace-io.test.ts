import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseSourceFile } from "./parsers";
import { createEmptyProject, createPresalesRound } from "./workspace-schema";
import {
  copyWorkspaceFilesToOutput,
  ensureProjectStageDirectories,
  listWorkspaceOutputFiles,
  migrateWorkspaceDirectory,
  PROJECT_STAGE_DIRECTORIES,
  saveProjectToDirectory,
  saveWorkspaceFilesAsZip,
  synchronizeProjectHistoryToDirectory,
  trashWorkspaceFileFromRelativePath,
  type DirectoryHandleLike,
  writeWorkspaceFileToRelativePath,
} from "./workspace-io";

class MemoryFileHandle {
  readonly kind = "file" as const;
  constructor(public name: string, private data: Blob = new Blob()) {}
  async getFile() { return new File([this.data], this.name); }
  async createWritable() {
    return {
      write: async (value: Blob | string | ArrayBuffer) => { this.data = value instanceof Blob ? value : new Blob([value]); },
      close: async () => undefined,
    };
  }
}

class MemoryDirectoryHandle implements DirectoryHandleLike {
  readonly kind = "directory" as const;
  readonly children = new Map<string, MemoryFileHandle | MemoryDirectoryHandle>();
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const current = this.children.get(name);
    if (current instanceof MemoryDirectoryHandle) return current;
    if (current || !options?.create) throw new DOMException("Not found", "NotFoundError");
    const next = new MemoryDirectoryHandle(name);
    this.children.set(name, next);
    return next;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const current = this.children.get(name);
    if (current instanceof MemoryFileHandle) return current;
    if (current || !options?.create) throw new DOMException("Not found", "NotFoundError");
    const next = new MemoryFileHandle(name);
    this.children.set(name, next);
    return next;
  }
  async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirectoryHandle]> {
    for (const entry of this.children.entries()) yield entry;
  }
  async isSameEntry(other: DirectoryHandleLike) { return other === this; }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException("Not found", "NotFoundError");
  }
  async queryPermission() { return "granted" as PermissionState; }
}

describe("workspace directory management", () => {
  it("moves a chosen workspace file to the Recycle Bin without using permanent removal", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    const directory = await root.getDirectoryHandle("generated", { create: true });
    await directory.getFileHandle("result.txt", { create: true });
    await directory.getFileHandle("keep.txt", { create: true });
    const recycled: string[] = [];
    const expectedFingerprint = { size: 8, sha256: "a".repeat(64) };
    Object.assign(directory, { trashEntry: async (name: string, expected: unknown) => { expect(expected).toEqual(expectedFingerprint); recycled.push(name); directory.children.delete(name); } });
    directory.removeEntry = async () => { throw new Error("Permanent deletion must never run."); };
    await trashWorkspaceFileFromRelativePath(root, "generated/result.txt", expectedFingerprint);
    expect(recycled).toEqual(["result.txt"]);
    expect([...directory.children.keys()]).toEqual(["keep.txt"]);
  });

  it("refuses unsafe cleanup paths and preserves files when recycling is unavailable or denied", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    const directory = await root.getDirectoryHandle("generated", { create: true });
    await directory.getFileHandle("result.txt", { create: true });
    for (const relativePath of ["result.txt", "../result.txt", "generated/../result.txt", "generated//result.txt", "/generated/result.txt", "generated/a\\b.txt", "generated/a:stream"]) {
      await expect(trashWorkspaceFileFromRelativePath(root, relativePath)).rejects.toThrow("Invalid workspace file path");
    }
    await expect(trashWorkspaceFileFromRelativePath(root, "generated/result.txt")).rejects.toThrow("Recycle Bin");
    expect(directory.children.has("result.txt")).toBe(true);
    Object.assign(directory, { trashEntry: async () => { throw new Error("Permission denied"); } });
    await expect(trashWorkspaceFileFromRelativePath(root, "generated/result.txt")).rejects.toThrow("Permission denied");
    expect(directory.children.has("result.txt")).toBe(true);
  });

  it("creates the six managed project stage folders", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    await ensureProjectStageDirectories(root);
    expect([...root.children.keys()]).toEqual([...PROJECT_STAGE_DIRECTORIES]);
  });

  it("writes project state without recreating the retired formal export files", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    await saveProjectToDirectory(root, createEmptyProject("zh"));
    const outputs = await root.getDirectoryHandle("5_输出文件");
    expect([...outputs.children.keys()]).toEqual([]);
  });

  it("migrates only managed entries and leaves unrelated files in the old folder", async () => {
    const source = new MemoryDirectoryHandle("old-root");
    const destination = new MemoryDirectoryHandle("new-root");
    const projectDirectory = await (await source.getDirectoryHandle("projects", { create: true })).getDirectoryHandle("project-1", { create: true });
    const manifest = await projectDirectory.getFileHandle("project.json", { create: true });
    const manifestWriter = await manifest.createWritable();
    await manifestWriter.write("{\"id\":\"project-1\"}");
    await manifestWriter.close();
    await source.getFileHandle("workspace.json", { create: true });
    await source.getFileHandle("personal-notes.txt", { create: true });
    await source.getDirectoryHandle("1_售前准备", { create: true });
    await destination.getFileHandle("keep.txt", { create: true });

    await migrateWorkspaceDirectory(source, destination);

    expect(source.children.has("workspace.json")).toBe(false);
    expect(source.children.has("projects")).toBe(false);
    expect(source.children.has("1_售前准备")).toBe(false);
    expect(source.children.has("personal-notes.txt")).toBe(true);
    expect(destination.children.has("keep.txt")).toBe(true);
    const migratedProjects = await destination.getDirectoryHandle("projects");
    const migratedManifest = await (await migratedProjects.getDirectoryHandle("project-1")).getFileHandle("project.json");
    expect(await (await migratedManifest.getFile()).text()).toContain("project-1");
  });

  it("restores and removes project files while recreating their parent folders", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    const empty = createEmptyProject("zh");
    const file = new File(["额定负载 5 kg。"], "客户要求.txt", { type: "text/plain" });
    const source = await parseSourceFile(file);
    const withSource = { ...empty, sources: [source] };
    const files = new Map([[source.id, file]]);

    await synchronizeProjectHistoryToDirectory(root, empty, withSource, files);
    const sourceDirectory = await (await (await root.getDirectoryHandle("projects")).getDirectoryHandle(empty.id)).getDirectoryHandle("sources");
    expect(await (await sourceDirectory.getFileHandle(file.name)).getFile().then((stored) => stored.text())).toBe("额定负载 5 kg。");

    await synchronizeProjectHistoryToDirectory(root, withSource, empty, new Map());
    await expect(sourceDirectory.getFileHandle(file.name)).rejects.toThrow();
  });

  it("creates and removes communication folders with project history", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    const empty = createEmptyProject("zh");
    const withRound = { ...empty, presalesRounds: [createPresalesRound("zh", 1)] };

    await synchronizeProjectHistoryToDirectory(root, empty, withRound, new Map());
    const presales = await root.getDirectoryHandle("1_售前准备");
    const communications = await presales.getDirectoryHandle("2_客户沟通与文件响应");
    expect((await communications.getDirectoryHandle("第一轮沟通")).name).toBe("第一轮沟通");

    await synchronizeProjectHistoryToDirectory(root, withRound, empty, new Map());
    await expect(communications.getDirectoryHandle("第一轮沟通")).rejects.toThrow();
  });

  it("restores canonical business files without creating duplicate legacy copies", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    const empty = createEmptyProject("zh");
    const file = new File(["客户要求"], "客户附件1.txt", { type: "text/plain" });
    const parsed = await parseSourceFile(file);
    const source = {
      ...parsed,
      workspacePath: "1_售前准备/2_客户沟通与文件响应/第一轮沟通/客户附件/客户附件1.txt",
    };
    const withSource = { ...empty, sources: [source], presalesRounds: [createPresalesRound("zh", 1)] };

    await synchronizeProjectHistoryToDirectory(root, empty, withSource, new Map([[source.id, file]]));
    const customerFiles = await (await (await (await root.getDirectoryHandle("1_售前准备")).getDirectoryHandle("2_客户沟通与文件响应")).getDirectoryHandle("第一轮沟通")).getDirectoryHandle("客户附件");
    expect(await (await customerFiles.getFileHandle(file.name)).getFile().then((stored) => stored.text())).toBe("客户要求");
    const legacySources = await (await (await root.getDirectoryHandle("projects")).getDirectoryHandle(empty.id)).getDirectoryHandle("sources");
    await expect(legacySources.getFileHandle(file.name)).rejects.toThrow();
  });

  it("lists only business-stage files available for output", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    await ensureProjectStageDirectories(root);
    await writeWorkspaceFileToRelativePath(root, "1_售前准备/2_客户沟通与文件响应/第一轮沟通/客户附件/客户附件1.txt", "客户附件");
    await writeWorkspaceFileToRelativePath(root, "3_技术标组包/1_投标文件输出/技术方案/生成文件/技术方案.docx", "技术方案");
    await writeWorkspaceFileToRelativePath(root, "5_输出文件/旧导出.zip", "旧导出");

    const files = await listWorkspaceOutputFiles(root);

    expect(files.map((file) => file.relativePath)).toEqual([
      "1_售前准备/2_客户沟通与文件响应/第一轮沟通/客户附件/客户附件1.txt",
      "3_技术标组包/1_投标文件输出/技术方案/生成文件/技术方案.docx",
    ]);
  });

  it("copies selected files with their project-relative folder hierarchy", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    const output = new MemoryDirectoryHandle("output-root");
    const relativePath = "1_售前准备/2_客户沟通与文件响应/第一轮沟通/客户附件/客户附件1.txt";
    await writeWorkspaceFileToRelativePath(root, relativePath, "客户附件");

    const result = await copyWorkspaceFilesToOutput(root, output, "客户解决方案项目", [relativePath]);

    expect(result).toEqual({ projectDirectoryName: "客户解决方案项目", files: [relativePath] });
    const exported = await (await (await (await (await (await output.getDirectoryHandle("客户解决方案项目")).getDirectoryHandle("1_售前准备")).getDirectoryHandle("2_客户沟通与文件响应")).getDirectoryHandle("第一轮沟通")).getDirectoryHandle("客户附件")).getFileHandle("客户附件1.txt");
    expect(await (await exported.getFile()).text()).toBe("客户附件");
  });

  it("saves a project-named ZIP with selected relative paths", async () => {
    const root = new MemoryDirectoryHandle("project-root");
    const output = new MemoryDirectoryHandle("output-root");
    const relativePath = "2_招标要求/1_招标文件/导入文件/招标书.txt";
    await writeWorkspaceFileToRelativePath(root, relativePath, "招标内容");

    const result = await saveWorkspaceFilesAsZip(root, output, "测试项目", [relativePath]);
    const archive = await (await output.getFileHandle("测试项目.zip")).getFile();
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());

    expect(result).toEqual({ name: "测试项目.zip", files: [relativePath] });
    expect(await zip.file(`测试项目/${relativePath}`)?.async("string")).toBe("招标内容");
  });
});
