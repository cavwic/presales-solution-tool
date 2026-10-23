import { describe, expect, it, vi } from "vitest";
import { analysisResultBaseName, buildCodexCustomerAnalysisTask, buildCodexPresalesTask, buildCustomerNeedsAnalysisPrompt, buildPresalesPrompt, createGeneratedFile, DEFAULT_MODEL_SETTINGS, getActionResponseTarget, requestPresalesDraft, safeGeneratedFileName, templateFileFormat } from "./presales-generation";
import { createEmptyProject, createPresalesRound } from "./workspace-schema";

function projectWithRound() {
  const project = createEmptyProject("zh");
  project.presalesRounds.push(createPresalesRound("zh", 1));
  return project;
}

describe("presales generation", () => {
  it("builds a source-bounded prompt with project, round, and prior history", () => {
    const project = projectWithRound();
    project.customerAlias = "某客户";
    project.presalesRounds[0].customerNeeds = "需要响应需求 A";
    project.presalesRounds.push({ ...project.presalesRounds[0], id: "round-2", title: "第二次沟通", customerNeeds: "补充需求 B", generatedFiles: [] });
    const prompt = buildPresalesPrompt(project, project.presalesRounds[1]);
    expect(prompt).toContain("某客户");
    expect(prompt).toContain("补充需求 B");
    expect(prompt).toContain("需要响应需求 A");
    expect(prompt).toContain("不得虚构");
  });

  it("calls an OpenAI-compatible chat completions endpoint", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: "# 响应文件" } }] }), { status: 200 });
    });
    const result = await requestPresalesDraft({ ...DEFAULT_MODEL_SETTINGS, provider: "local", localEndpoint: "http://127.0.0.1:9000/v1/chat/completions", localModel: "local-model" }, "", "prompt", fetchMock as typeof fetch);
    expect(result.content).toBe("# 响应文件");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(capturedInit?.body)).model).toBe("local-model");
  });

  it("sanitizes generated file names", () => {
    expect(safeGeneratedFileName("客户/响应:第一版", "docx")).toBe("客户-响应-第一版.docx");
  });

  it("builds a Codex task that writes output and metadata back to the project", () => {
    const project = projectWithRound();
    const round = project.presalesRounds[0];
    round.customerNeeds = "生成客户响应文件";
    const template = { id: "template-1", name: "响应模板.docx", fileType: "docx" as const, version: "1.0", size: 12, sha256: "abc", importedAt: "2026-08-20", workspacePath: "", requiresOcr: false, preprocessStatus: "ready" as const, preprocessedAt: "2026-08-20", preprocessMessage: "", segments: [{ id: "paragraph-1", locatorKind: "paragraph" as const, locator: "段落 1", text: "固定章节：需求理解、响应方案、待确认边界" }] };
    project.sources.push(template);
    const action = { id: "action-1", title: "", owner: "方案负责人", dueDate: "2026-09-01", status: "open" as const, responseFileName: "第一轮响应", responseFileFormat: "docx" as const, fileRequirements: "说明接口范围和待确认边界", templateSourceIds: [template.id], selectedTemplateSourceIds: [template.id] };
    round.actions = [action];
    const task = buildCodexPresalesTask(project, round, action, "zh", [template]);
    expect(task.name).toMatch(/^presales-.+\.md$/);
    expect(task.outputName).toBe("第一轮响应.docx");
    expect(task.content).toContain("1_售前准备/2_客户沟通与文件响应/第一轮沟通/生成文件/第一轮响应.docx");
    expect(task.content).toContain("provider 为 codex");
    expect(task.content).toContain("actionId 为 action-1");
    expect(task.content).toContain("生成客户响应文件");
    expect(task.content).toContain("说明接口范围和待确认边界");
    expect(task.content).toContain(`projects/${project.id}/sources/响应模板.docx`);
    expect(task.content).not.toContain("固定章节：需求理解、响应方案、待确认边界");
    expect(task.content).toContain("模板仅用于复用版式与视觉样式");
  });

  it("keeps new response items blank instead of inheriting the legacy round defaults", () => {
    const project = projectWithRound();
    const round = project.presalesRounds[0];
    const action = { id: "action-new", title: "", owner: "", dueDate: "", status: "open" as const, responseFileName: "", fileRequirements: "", templateSourceIds: [], selectedTemplateSourceIds: [] };
    round.actions = [action];
    expect(getActionResponseTarget(round, action)).toEqual({ name: "", format: "" });
  });

  it("builds a keyword-weighted customer attachment analysis prompt", () => {
    const project = projectWithRound();
    const round = project.presalesRounds[0];
    round.keywords = ["技术参数"];
    round.analysisRequirements = "列出参数、来源位置和待确认项";
    round.participants = [{ id: "participant-1", name: "客户项目经理", category: "customer" }];
    const source = { id: "source-1", name: "客户需求.md", fileType: "md" as const, version: "1.0", size: 12, sha256: "abc", importedAt: "2026-08-17", workspacePath: "", requiresOcr: false, preprocessStatus: "ready" as const, preprocessedAt: "2026-08-17", preprocessMessage: "", segments: [{ id: "line-1", locatorKind: "line" as const, locator: "行 1", text: "额定负载 5 kg" }] };
    const template = { ...source, id: "template-1", name: "分析模板.md", segments: [{ ...source.segments[0], id: "template-line", text: "章节：技术要求" }] };
    const prompt = buildCustomerNeedsAnalysisPrompt(project, round, [source], [template]);
    expect(prompt).toContain("提高以下关键词");
    expect(prompt).toContain("技术参数");
    expect(prompt).toContain("额定负载 5 kg");
    expect(prompt).toContain("列出参数、来源位置和待确认项");
    expect(prompt).not.toContain("章节：技术要求");
    expect(prompt).toContain("模板仅用于复用版式与视觉样式");
    expect(prompt).toContain("客户项目经理 (客户)");
  });

  it("builds a customer analysis task that writes the result back to the project", () => {
    const project = projectWithRound();
    const round = project.presalesRounds[0];
    round.keywords = ["技术参数"];
    round.analysisRequirements = "列出参数和来源位置";
    round.analysisOutputFormat = "docx";
    const source = { id: "source-1", name: "客户需求.md", fileType: "md" as const, version: "1.0", size: 12, sha256: "abc", importedAt: "2026-08-18", workspacePath: "", requiresOcr: false, preprocessStatus: "ready" as const, preprocessedAt: "2026-08-18", preprocessMessage: "", segments: [{ id: "line-1", locatorKind: "line" as const, locator: "行 1", text: "额定负载 5 kg" }] };
    const task = buildCodexCustomerAnalysisTask(project, round, [source], []);
    expect(task.name).toMatch(/^presales-analysis-.+\.md$/);
    expect(task.outputName).toBe("第一次沟通需求分析.docx");
    expect(task.content).toContain("额定负载 5 kg");
    expect(task.content).toContain("列出参数和来源位置");
    expect(task.content).toContain("analysisResults");
    expect(task.content).toContain("provider 为 codex");
  });

  it("maps template extensions and analysis result names", () => {
    expect(templateFileFormat("企业模板.docx")).toBe("docx");
    expect(templateFileFormat("汇报模板.pptx")).toBe("pptx");
    expect(templateFileFormat("结构.md")).toBe("md");
    expect(analysisResultBaseName([], "zh")).toBe("整体分析结果");
    expect(analysisResultBaseName(["技术参数", "时间"], "zh")).toBe("技术参数+时间分析结果");
  });

  it("creates a downloadable Markdown file", async () => {
    const generated = await createGeneratedFile("# 响应", "客户响应", "md");
    expect(generated.name).toBe("客户响应.md");
    expect(await generated.blob.text()).toBe("# 响应");
  });
});
