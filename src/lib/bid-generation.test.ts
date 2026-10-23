import { describe, expect, it } from "vitest";
import { buildBidFilePrompt, buildCodexBidFileTask } from "./bid-generation";
import { createRequirement } from "./workflow";
import { bidFileChecklistItemSchema, createEmptyProject, type BidFileChecklistItem, type SourceDocument } from "./workspace-schema";

function source(id: string, name: string, text: string): SourceDocument {
  const extension = name.split(".").pop()?.toLowerCase();
  const fileType = extension === "docx" || extension === "pptx" || extension === "xlsx" || extension === "md" ? extension : "txt";
  return {
    id,
    name,
    fileType,
    version: "1.0",
    size: text.length,
    sha256: `${id}-sha256`,
    importedAt: "2026-08-20T00:00:00.000Z",
    workspacePath: "",
    requiresOcr: false,
    preprocessStatus: "ready",
    preprocessedAt: "2026-08-20T00:00:00.000Z",
    preprocessMessage: "",
    segments: [{ id: `${id}-line`, locatorKind: fileType === "pptx" ? "slide" : fileType === "docx" ? "paragraph" : "line", locator: "第 1 行", text }],
  };
}

function bidFile(): BidFileChecklistItem {
  return {
    id: "bid-file-1",
    title: "技术方案",
    category: "technical",
    status: "pending",
    sourceResultId: "analysis-1",
    notes: "招标文件第三章",
    templateSourceIds: ["template-1"],
    selectedTemplateSourceIds: ["template-1"],
    referenceSourceIds: ["reference-1"],
    selectedReferenceSourceIds: ["reference-1"],
    outputFormat: "docx",
    detailRequirements: "重点说明权限、审计和验收边界。",
    generatedFiles: [],
  };
}

describe("bid file generation", () => {
  it("builds a source-bounded prompt from the synced checklist item", () => {
    const project = createEmptyProject("zh");
    project.name = "企业知识库投标";
    project.sources.push(source("tender-1", "招标书.txt", "系统必须保留审计日志。"));
    project.requirements.push(createRequirement("tender", {
      title: "审计日志",
      normalizedText: "系统必须保留审计日志",
      sourceRef: { documentId: "tender-1", segmentId: "tender-1-line", locator: "第 1 行", excerpt: "系统必须保留审计日志。" },
    }, "zh"));
    const prompt = buildBidFilePrompt(project, bidFile(), [source("reference-1", "产品手册.txt", "支持按用户记录访问日志。")], [source("template-1", "企业模板.docx", "一、项目理解\n二、技术方案")], "zh");
    expect(prompt).toContain("企业知识库投标");
    expect(prompt).toContain("重点说明权限、审计和验收边界");
    expect(prompt).toContain("产品手册.txt");
    expect(prompt).toContain("企业模板.docx");
    expect(prompt).not.toContain("一、项目理解");
    expect(prompt).toContain("不得编造产品参数");
    expect(prompt).toContain("招标书.txt / 第 1 行");
  });

  it("writes a concrete Codex task path and manifest update target", () => {
    const project = createEmptyProject("zh");
    const item = bidFile();
    const task = buildCodexBidFileTask(project, item, [source("reference-1", "产品手册.txt", "已核验资料")], [source("template-1", "企业模板.docx", "模板章节")], "zh");
    expect(task.outputName).toBe("技术方案.docx");
    expect(task.content).toContain("3_技术标组包/1_投标文件输出/技术方案/生成文件/技术方案.docx");
    expect(task.content).toContain(`bidFileChecklist 中 id 为 ${item.id}`);
    expect(task.content).toContain(`projects/${project.id}/sources/产品手册.txt`);
    expect(task.content).toContain("不得补造招标事实");
  });

  it("migrates legacy checklist items with empty output configuration", () => {
    const project = createEmptyProject("zh");
    const parsed = project.bidFileChecklist;
    expect(parsed).toEqual([]);
    const legacy = {
      id: "legacy",
      title: "验收方案",
      category: "delivery",
      status: "pending",
      sourceResultId: "",
      notes: "",
    };
    const item = bidFileChecklistItemSchema.parse(legacy);
    expect(item.referenceSourceIds).toEqual([]);
    expect(item.generatedFiles).toEqual([]);
    expect(item.outputFormat).toBeUndefined();
  });
});
