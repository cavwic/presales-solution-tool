import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_SETTINGS } from "./model-settings";
import {
  buildCodexOcrTask,
  buildCodexTenderTask,
  buildTenderAnalysisPrompt,
  buildTenderComparisonPrompt,
  extractTenderStructuredData,
  requestOcrRecognition,
  tenderTemplateFileFormat,
} from "./tender-generation";
import { createEmptyProject, type SourceDocument } from "./workspace-schema";

function source(id: string, name: string, text: string, locator = "第 1 行"): SourceDocument {
  return {
    id,
    name,
    fileType: name.endsWith(".md") ? "md" : "txt",
    version: "1.0",
    size: text.length,
    sha256: `${id}-sha256`,
    importedAt: "2026-08-20T00:00:00.000Z",
    workspacePath: "",
    requiresOcr: false,
    preprocessStatus: "ready",
    preprocessedAt: "2026-08-20T00:00:00.000Z",
    preprocessMessage: "",
    segments: [{ id: `${id}-line`, locatorKind: "line", locator, text }],
  };
}

describe("tender generation", () => {
  it("builds a source-bounded tender prompt and structured checklist contract", () => {
    const project = createEmptyProject("zh");
    project.tenderAnalysis.keywords = ["技术参数", "投标时间"];
    project.tenderAnalysis.analysisRequirements = "提取强制要求并保留原始位置";
    const prompt = buildTenderAnalysisPrompt(project, [source("tender", "招标书.txt", "投标截止时间为 2026 年 9 月 30 日。")], [source("clarification", "澄清.txt", "交付周期修改为 60 天。")], [], "zh");
    expect(prompt).toContain("技术参数、投标时间");
    expect(prompt).toContain("招标书.txt");
    expect(prompt).toContain("澄清.txt");
    expect(prompt).toContain("不得补写");
    expect(prompt).toContain("cavwic-tender-analysis-1");
  });

  it("compares complete presales and tender sets with chronology and conflict rules", () => {
    const project = createEmptyProject("zh");
    const prompt = buildTenderComparisonPrompt(
      project,
      [source("a", "A.txt", "功能 F 为标准配置。"), source("b", "B.txt", "功能 F 变更为定制配置。")],
      [source("c", "招标书.txt", "功能 F 为标准配置。")],
      [source("d", "补遗.txt", "功能 F 最终改为定制配置。")],
      [],
      "zh",
    );
    expect(prompt).toContain("[A+B+C]");
    expect(prompt).toContain("不得逐文件机械配对");
    expect(prompt).toContain("功能 F 变更为定制配置");
    expect(prompt).toContain("功能 F 最终改为定制配置");
  });

  it("extracts requirements, bid files, and differences from the model result", () => {
    const response = `# 招标分析\n\n正文保留。\n\n\`\`\`json\n${JSON.stringify({
      schema: "cavwic-tender-analysis-1",
      requirements: [{ title: "审计日志", category: "technical", originalText: "应保留审计日志", normalizedText: "保留审计日志", sourceName: "招标书.txt", locator: "第 8 行", mandatory: true, scored: false, dueDate: "" }],
      bidFileChecklist: [{ title: "技术方案", category: "technical", notes: "招标书第 3 章" }],
      differences: [{ title: "交付周期", presales: "90 天", tender: "60 天", relation: "changed", notes: "以补遗为准" }],
    })}\n\`\`\``;
    const extracted = extractTenderStructuredData(response);
    expect(extracted.content).toBe("# 招标分析\n\n正文保留。");
    expect(extracted.data.requirements[0].sourceName).toBe("招标书.txt");
    expect(extracted.data.bidFileChecklist[0].title).toBe("技术方案");
    expect(extracted.data.differences[0].relation).toBe("changed");
  });

  it("sends an image as an OpenAI-compatible OCR request and reports progress", async () => {
    const progress: number[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }> };
      expect(JSON.stringify(body.messages[1].content)).toContain("data:image/png;base64");
      return new Response(JSON.stringify({ choices: [{ message: { content: "识别后的招标文件内容" } }] }), { status: 200 });
    });
    const segments = await requestOcrRecognition(
      { ...DEFAULT_MODEL_SETTINGS, provider: "local", localEndpoint: "http://127.0.0.1:9000/v1/chat/completions", localModel: "vision-model" },
      "",
      new File([new Uint8Array([137, 80, 78, 71])], "scan.png", { type: "image/png" }),
      (value) => progress.push(value),
      fetcher as typeof fetch,
    );
    expect(segments[0].text).toBe("识别后的招标文件内容");
    expect(progress.at(-1)).toBe(100);
  });

  it("maps tender template formats and writes concrete Codex task paths", () => {
    const project = createEmptyProject("zh");
    expect(tenderTemplateFileFormat("技术方案.docx")).toBe("docx");
    expect(tenderTemplateFileFormat("响应矩阵.xlsx")).toBe("xlsx");
    expect(tenderTemplateFileFormat("汇报.pptx")).toBe("pptx");
    expect(tenderTemplateFileFormat("结构.md")).toBe("md");
    expect(buildCodexTenderTask("requirements", project, "prompt", "docx").content).toContain("2_招标要求/3_招标文件分析/1_招标要求分析/生成文件");
    expect(buildCodexOcrTask(project, [source("scan", "scan.txt", "待识别")]).content).toContain(`projects/${project.id}/sources/scan.txt`);
  });
});
