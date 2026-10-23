import { describe, expect, it, vi } from "vitest";
import { createEmptyProject, createPresalesRound, projectManifestSchema, type ProjectManifest, type SourceDocument } from "./workspace-schema";
import { bidItemDirectory, presalesRoundDirectory, WORKSPACE_MODULE_DIRECTORIES } from "./workspace-storage";
import {
  collectGeneratedCleanupCandidates,
  collectGeneratedCleanupCatalog,
  executeGeneratedCleanup,
  fingerprintCleanupFile,
  previewGeneratedCleanup,
  pruneGeneratedCleanup,
  type GeneratedCleanupCandidate,
} from "./file-cleanup";

function source(id: string, name: string, path: string): SourceDocument {
  return { id, name, fileType: "md", version: "1.0", size: 3, sha256: "legacy-hash", importedAt: "2026-10-23T00:00:00Z", requiresOcr: false, preprocessStatus: "ready", preprocessedAt: "", preprocessMessage: "", workspacePath: path, segments: [] };
}

function fixture(): ProjectManifest {
  const project = createEmptyProject();
  project.id = "test-cleanup";
  const round = createPresalesRound("zh", 1);
  const base = { format: "md" as const, createdAt: "2026-10-23T00:00:00Z", provider: "local" as const, model: "fixture" };
  const analysis = { ...base, id: "pa", name: "沟通分析", fileName: "pa.md", sourceId: "s-pa", relativePath: `${presalesRoundDirectory(0)}/需求分析/pa.md`, prompt: "", keywords: [], sourceIds: [], templateSourceIds: [] };
  round.analysisResults = [analysis];
  round.generatedFiles = [{ ...base, id: "pg", name: "pg.md", sourceId: "s-pg", relativePath: `${presalesRoundDirectory(0)}/生成文件/pg.md`, actionId: "" }];
  project.presalesRounds = [round];
  project.tenderAnalysis.results = [{ ...analysis, id: "ta", name: "招标分析", fileName: "ta.md", sourceId: "s-ta", relativePath: `${WORKSPACE_MODULE_DIRECTORIES.tenderAnalysis}/生成文件/ta.md`, kind: "requirements", differences: [] }];
  project.tenderComparison.results = [{ ...analysis, id: "tc", name: "售前对比", fileName: "tc.md", sourceId: "s-tc", relativePath: `${WORKSPACE_MODULE_DIRECTORIES.tenderComparison}/生成文件/tc.md`, kind: "comparison", differences: [] }];
  project.bidFileChecklist = [{ id: "checklist", title: "技术方案", category: "technical", status: "confirmed", sourceResultId: "", notes: "", templateSourceIds: [], selectedTemplateSourceIds: [], referenceSourceIds: [], selectedReferenceSourceIds: [], detailRequirements: "", generatedFiles: [{ ...base, id: "bg", name: "bg.md", sourceId: "s-bg", relativePath: `${bidItemDirectory("技术方案")}/生成文件/bg.md`, referenceSourceIds: [], templateSourceIds: [], detailRequirements: "" }] }];
  project.sources = [
    source("s-pa", "pa.md", analysis.relativePath),
    source("s-pg", "pg.md", round.generatedFiles[0].relativePath),
    source("s-ta", "ta.md", project.tenderAnalysis.results[0].relativePath),
    source("s-tc", "tc.md", project.tenderComparison.results[0].relativePath),
    source("s-bg", "bg.md", project.bidFileChecklist[0].generatedFiles[0].relativePath),
    source("imported", "客户原始材料.md", "2_招标要求/1_招标文件/客户原始材料.md"),
  ];
  return projectManifestSchema.parse(project);
}

function recordCandidate(project: ProjectManifest, recordId: string): GeneratedCleanupCandidate {
  return collectGeneratedCleanupCandidates(project).find((candidate) => candidate.recordIds.includes(recordId))!;
}

describe("generated file cleanup catalog", () => {
  it("collects only output records from every supported workflow without scanning imported files", () => {
    const project = fixture();
    const candidates = collectGeneratedCleanupCandidates(project);
    expect(candidates.flatMap((candidate) => candidate.recordIds)).toEqual(["pa", "pg", "ta", "tc", "bg"]);
    expect(candidates.map((candidate) => candidate.stage)).toEqual(["presales", "presales", "tender", "tender", "bid"]);
    expect(candidates.some((candidate) => candidate.sourceIds.includes("imported"))).toBe(false);
    expect(candidates.every((candidate) => candidate.bytes === 3 && candidate.scope === "project")).toBe(true);
    expect(collectGeneratedCleanupCandidates(structuredClone(project)).map((candidate) => candidate.id)).toEqual(candidates.map((candidate) => candidate.id));
  });

  it.each([
    ["customer inputs", (project: ProjectManifest) => { project.presalesRounds[0].requirementSourceIds = ["s-pa"]; }],
    ["selected input", (project: ProjectManifest) => { project.selectedTenderSourceIds = ["s-pa"]; }],
    ["templates", (project: ProjectManifest) => { project.generalTemplates.docxSourceId = "s-pa"; }],
    ["generation references", (project: ProjectManifest) => { project.bidFileChecklist[0].generatedFiles[0].referenceSourceIds = ["s-pa"]; }],
    ["analysis inputs", (project: ProjectManifest) => { project.tenderComparison.results[0].sourceIds = ["s-pa"]; }],
    ["evidence", (project: ProjectManifest) => { project.evidence = [{ id: "evidence", title: "证据", kind: "other", fileName: "pa.md", version: "", verifiedAt: "", expiresAt: "", sourceRef: { documentId: "s-pa", segmentId: "segment", locator: "line 1", excerpt: "" }, notes: "" }]; }],
    ["deliverables", (project: ProjectManifest) => { project.deliverables[0].sourceIds = ["s-pa"]; }],
    ["handover responses", (project: ProjectManifest) => { project.handover.tasks = [{ id: "task", title: "task", departmentId: "", scope: "", deliverableType: "document", responseMethod: "file", deliverableName: "", owner: "", dueDate: "", status: "pending", dependencyNotes: "", acceptanceCriteria: "", sourceIds: [], responseText: "", responsePath: "", responseSourceIds: ["s-pa"] }]; }],
  ] as const)("protects generated sources reused as %s", (_name, mutate) => {
    const project = fixture();
    mutate(project);
    expect(recordCandidate(project, "pa")).toBeUndefined();
    expect(collectGeneratedCleanupCatalog(project).blocked).toEqual(expect.arrayContaining([expect.objectContaining({ recordIds: ["pa"], reason: "shared-source" })]));
  });

  it("protects imported source aliases of the same Windows path, even with alternate separators and case", () => {
    const project = fixture();
    project.sources.find((entry) => entry.id === "imported")!.workspacePath = project.sources[0].workspacePath.toUpperCase().replaceAll("/", "\\");
    expect(recordCandidate(project, "pa")).toBeUndefined();
    expect(collectGeneratedCleanupCatalog(project).blocked[0].reason).toBe("shared-path");
  });

  it("protects generated records linked by a checklist and source records located in imported directories", () => {
    const project = fixture();
    project.bidFileChecklist[0].sourceResultId = "ta";
    project.sources[0].workspacePath = "2_招标要求/1_招标文件/pa.md";
    expect(collectGeneratedCleanupCatalog(project).blocked.map((item) => item.reason)).toEqual(["shared-path", "referenced-record"]);
  });

  it("protects an output used as a handover response path without a source attachment", () => {
    const project = fixture();
    project.handover.tasks = [{ id: "task", title: "交底", departmentId: "", scope: "", deliverableType: "document", responseMethod: "path", deliverableName: "", owner: "", dueDate: "", status: "submitted", dependencyNotes: "", acceptanceCriteria: "", sourceIds: [], responseText: "", responsePath: project.sources[0].workspacePath, responseSourceIds: [] }];
    expect(recordCandidate(project, "pa")).toBeUndefined();
    expect(collectGeneratedCleanupCatalog(project).blocked[0].reason).toBe("shared-path");
  });

  it.each(["../pa.md", "/pa.md", "C:/pa.md", "downloads/../pa.md", "downloads\\pa.md", "downloads/pa.md.", "downloads/subfolder/pa.md", "5_输出文件/pa.md"])("rejects untrusted output path %s", (path) => {
    const project = fixture();
    project.presalesRounds[0].analysisResults[0].relativePath = path;
    project.sources[0].workspacePath = path;
    const catalog = collectGeneratedCleanupCatalog(project);
    expect(catalog.candidates.some((item) => item.recordIds.includes("pa"))).toBe(false);
    expect(catalog.blocked[0].reason).toBe("invalid-path");
  });

  it("deduplicates identical output paths and removes precisely their owners while preserving other records", () => {
    const project = fixture();
    const first = project.presalesRounds[0].analysisResults[0];
    project.presalesRounds[0].analysisResults.push({ ...first, id: "pa-revision", sourceId: "s-pa-copy" });
    project.sources.push({ ...project.sources[0], id: "s-pa-copy" });
    const candidate = recordCandidate(project, "pa");
    expect(candidate.recordIds).toEqual(["pa", "pa-revision"]);
    expect(candidate.sourceIds).toEqual(["s-pa", "s-pa-copy"]);
    const result = pruneGeneratedCleanup(project, [candidate.id, "untrusted-id"]);
    expect(result.recordIds).toEqual(["pa", "pa-revision"]);
    expect(result.sourceIds).toEqual(["s-pa", "s-pa-copy"]);
    expect(result.project.presalesRounds[0].analysisResults).toEqual([]);
    expect(result.project.presalesRounds[0].generatedFiles).toEqual(project.presalesRounds[0].generatedFiles);
    expect(result.project.sources.find((item) => item.id === "imported")).toEqual(project.sources.find((item) => item.id === "imported"));
    expect(projectManifestSchema.safeParse(result.project).success).toBe(true);
    expect(project.presalesRounds[0].analysisResults).toHaveLength(2);
  });

  it("blocks duplicate paths with conflicting content and ambiguous duplicate record IDs", () => {
    const project = fixture();
    const first = project.presalesRounds[0].analysisResults[0];
    project.presalesRounds[0].analysisResults.push({ ...first, id: "pa-copy", sourceId: "s-pa-copy" });
    project.sources.push({ ...project.sources[0], id: "s-pa-copy", sha256: "different-content" });
    expect(recordCandidate(project, "pa")).toBeUndefined();
    const other = fixture();
    other.presalesRounds[0].generatedFiles[0].id = "pa";
    expect(collectGeneratedCleanupCandidates(other).some((item) => item.recordIds.includes("pa"))).toBe(false);
  });
});

describe("generated file cleanup preview and execution", () => {
  it("cleans successful items only and retains permission failures and files modified after preview", async () => {
    const project = fixture();
    const files = new Map(collectGeneratedCleanupCandidates(project).map((candidate) => [candidate.id, new Blob(["abc"])]));
    const readFile = async (candidate: GeneratedCleanupCandidate) => files.get(candidate.id) || null;
    const preview = await previewGeneratedCleanup(project, { readFile });
    const changed = recordCandidate(project, "tc");
    const failed = recordCandidate(project, "ta");
    files.set(changed.id, new Blob(["def"])); // Same size; the digest must detect the change.
    const trashFile = vi.fn(async (candidate: GeneratedCleanupCandidate) => {
      if (candidate.id === failed.id) throw new DOMException("Access denied", "NotAllowedError");
      files.delete(candidate.id);
    });
    const result = await executeGeneratedCleanup(project, preview, preview.candidates.map((candidate) => candidate.id), { readFile, trashFile });
    expect(result.results.map((item) => item.status)).toEqual(["cleaned", "cleaned", "failed", "changed", "cleaned"]);
    expect(result.recordIds).toEqual(["pa", "pg", "bg"]);
    expect(result.project.tenderAnalysis.results).toEqual(project.tenderAnalysis.results);
    expect(result.project.tenderComparison.results).toEqual(project.tenderComparison.results);
    expect(result.project.sources.map((item) => item.id)).toEqual(["s-ta", "s-tc", "imported"]);
    expect(projectManifestSchema.safeParse(result.project).success).toBe(true);
    expect(trashFile).toHaveBeenCalledTimes(4);
  });

  it("cleans missing records without invoking disk removal but rejects a file created after a missing preview", async () => {
    const project = fixture();
    const preview = await previewGeneratedCleanup(project, { readFile: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } });
    const ids = preview.candidates.map((candidate) => candidate.id);
    const created = ids[1];
    const trashFile = vi.fn();
    const result = await executeGeneratedCleanup(project, preview, ids, { readFile: async (candidate) => candidate.id === created ? new Blob(["abc"]) : null, trashFile });
    expect(result.results.map((item) => item.status)).toEqual(["missing", "changed", "missing", "missing", "missing"]);
    expect(result.recordIds).not.toContain("pg");
    expect(trashFile).not.toHaveBeenCalled();
  });

  it("distinguishes read failures from absence and leaves records intact", async () => {
    const project = fixture();
    const preview = await previewGeneratedCleanup(project, { readFile: async () => { throw new DOMException("denied", "NotAllowedError"); } });
    expect(preview.candidates.every((candidate) => candidate.error === "denied")).toBe(true);
    const trashFile = vi.fn();
    const result = await executeGeneratedCleanup(project, preview, preview.candidates.map((candidate) => candidate.id), { readFile: async () => new Blob(["abc"]), trashFile });
    expect(result.results.every((item) => item.status === "blocked")).toBe(true);
    expect(result.project).toEqual(project);
    expect(result.sourceIds).toEqual([]);
    expect(trashFile).not.toHaveBeenCalled();
  });

  it("never deletes external download copies and removes only local generated records", async () => {
    const project = fixture();
    const record = project.presalesRounds[0].generatedFiles[0];
    record.relativePath = "downloads/pg.md";
    project.sources.find((item) => item.id === record.sourceId)!.workspacePath = "";
    const candidate = recordCandidate(project, "pg");
    expect(candidate.scope).toBe("local");
    const readFile = async () => new Blob(["abc"]);
    const preview = await previewGeneratedCleanup(project, { readFile });
    const trashFile = vi.fn();
    const result = await executeGeneratedCleanup(project, preview, [candidate.id], { readFile, trashFile });
    expect(result.recordIds).toEqual(["pg"]);
    expect(result.project.presalesRounds[0].analysisResults).toHaveLength(1);
    expect(trashFile).not.toHaveBeenCalled();
  });

  it("requires output bytes to match their recorded digest and rechecks newly shared sources", async () => {
    const project = fixture();
    const digest = await fingerprintCleanupFile(new Blob(["abc"]));
    project.sources[0].sha256 = digest.sha256;
    const wrongPreview = await previewGeneratedCleanup(project, { readFile: async () => new Blob(["def"]) });
    expect(wrongPreview.candidates[0].error).toBe("GENERATED_FILE_CHANGED");
    const readFile = async () => new Blob(["abc"]);
    const preview = await previewGeneratedCleanup(project, { readFile });
    project.tenderComparison.selectedPresalesSourceIds = ["s-pa"];
    const trashFile = vi.fn();
    const result = await executeGeneratedCleanup(project, preview, [preview.candidates[0].id], { readFile, trashFile });
    expect(result.results).toEqual([{ id: preview.candidates[0].id, status: "blocked" }]);
    expect(result.sourceIds).toEqual([]);
    expect(trashFile).not.toHaveBeenCalled();
  });

  it("ignores stale preview identifiers after a project switch or output record replacement", async () => {
    const project = fixture();
    const readFile = async () => new Blob(["abc"]);
    const preview = await previewGeneratedCleanup(project, { readFile });
    const trashFile = vi.fn();
    const switched = await executeGeneratedCleanup({ ...project, id: "other-project" }, preview, [preview.candidates[0].id], { readFile, trashFile });
    expect(switched.results[0].status).toBe("blocked");
    project.presalesRounds[0].analysisResults[0].id = "replacement";
    const replaced = await executeGeneratedCleanup(project, preview, [preview.candidates[0].id], { readFile, trashFile });
    expect(replaced.results[0].status).toBe("blocked");
    expect(trashFile).not.toHaveBeenCalled();
  });
});
