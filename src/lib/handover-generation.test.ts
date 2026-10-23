import { describe, expect, it } from "vitest";
import { buildCodexHandoverTask, buildHandoverTaskSplitPrompt, requestHandoverTaskSplit } from "./handover-generation";
import { createEmptyProject, type SourceDocument } from "./workspace-schema";
import { DEFAULT_MODEL_SETTINGS } from "./model-settings";

const source = (id: string, name: string, text: string): SourceDocument => ({
  id,
  name,
  fileType: "md",
  version: "1.0",
  size: text.length,
  sha256: id,
  importedAt: "2026-08-23T00:00:00.000Z",
  workspacePath: "",
  requiresOcr: false,
  preprocessStatus: "ready",
  preprocessedAt: "2026-08-23T00:00:00.000Z",
  preprocessMessage: "",
  segments: [{ id: `${id}-line-1`, locatorKind: "line", locator: "line 1", text }],
});

describe("handover task generation", () => {
  it("states source precedence and limits assignment to configured departments", () => {
    const project = createEmptyProject("zh");
    project.handover.temporaryChanges = "现场培训改为两批次。";
    project.handover.awardNotes = "中标函要求提供培训记录。";
    project.handover.departments = [{
      id: "dept-delivery",
      name: "实施部",
      responsibility: "现场部署与培训",
      owner: "",
      defaultDeliverableType: "training",
      defaultResponseMethod: "mixed",
    }];
    const prompt = buildHandoverTaskSplitPrompt(
      project,
      [source("award-1", "中标函.md", "培训一次。")],
      [source("bid-1", "培训方案.md", "不包含现场培训。")],
      "zh",
    );
    expect(prompt).toContain("临时变更说明 > 中标补充资料与中标说明 > 最终投标文件");
    expect(prompt).toContain("dept-delivery");
    expect(prompt).toContain("现场培训改为两批次");
    expect(prompt).toContain('[SOURCE id="bid-1"');
  });

  it("parses a structured model response", async () => {
    const payload = {
      tasks: [{
        title: "准备培训计划",
        departmentId: "dept-delivery",
        scope: "按两批次组织现场培训。",
        deliverableType: "training",
        responseMethod: "mixed",
        deliverableName: "培训计划与签到记录",
        owner: "",
        dueDate: "",
        dependencyNotes: "部署完成后执行",
        acceptanceCriteria: "两批次均有签到和培训记录。",
        sourceIds: ["award-1"],
      }],
    };
    const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` } }] }), { status: 200 });
    const result = await requestHandoverTaskSplit({
      ...DEFAULT_MODEL_SETTINGS,
      provider: "cloud",
      cloudEndpoint: "https://example.com/v1/chat/completions",
      cloudModel: "test-model",
    }, "secret", "prompt", fetcher as typeof fetch);
    expect(result.tasks[0].responseMethod).toBe("mixed");
    expect(result.provider).toBe("cloud");
  });

  it("builds a Codex fallback task that preserves handover precedence", () => {
    const project = createEmptyProject("en");
    project.handover.departments = [{
      id: "dept-rd",
      name: "R&D",
      responsibility: "Software delivery",
      owner: "",
      defaultDeliverableType: "software",
      defaultResponseMethod: "path",
    }];
    const task = buildCodexHandoverTask(project, [], [], "en");
    expect(task.name).toMatch(/^handover-task-split-/);
    expect(task.content).toContain("Temporary changes override award supplements");
    expect(task.content).toContain("handover.tasks");
  });
});
