import { describe, expect, it } from "vitest";
import { compareBaselines, createRequirement, createSampleProject, inferProjectStage, localizeBuiltInProject, validateProject } from "./workflow";
import { createEmptyProject, createPresalesRound, isLegacyUntouchedPresalesRound, projectManifestSchema } from "./workspace-schema";

describe("solution workflow rules", () => {
  it("starts new projects without a communication round and identifies only the untouched legacy default", () => {
    const project = createEmptyProject("zh");
    expect(project.presalesRounds).toEqual([]);
    const legacyRound = createPresalesRound("zh", 1);
    expect(legacyRound.title).toBe("第一次沟通");
    expect(createPresalesRound("zh", 2).title).toBe("第二次沟通");
    expect(createPresalesRound("zh", 3).title).toBe("第三次沟通");
    expect(createPresalesRound("zh", 10).title).toBe("第十次沟通");
    expect(createPresalesRound("zh", 11).title).toBe("第十一次沟通");
    expect(createPresalesRound("en", 3).title).toBe("Communication 3");
    expect(isLegacyUntouchedPresalesRound(legacyRound)).toBe(true);
    legacyRound.customerNeeds = "客户已提出需求";
    expect(isLegacyUntouchedPresalesRound(legacyRound)).toBe(false);
  });

  it("keeps discovery and tender baselines separate", () => {
    const project = createSampleProject();
    const diff = compareBaselines(project.requirements);
    expect(diff).toHaveLength(1);
    expect(diff[0].relation).toBe("changed");
  });

  it("rejects approved requirements without evidence", () => {
    const project = createSampleProject();
    project.requirements[1] = {
      ...project.requirements[1],
      responseStatus: "confirmed",
      reviewState: "approved",
      evidenceRefs: [],
    };
    const messages = validateProject(project).map((item) => item.message);
    expect(messages.some((message) => message.includes("没有绑定证据"))).toBe(true);
  });

  it("forces unsupported requirements into negative deviation", () => {
    const project = createSampleProject();
    project.requirements.push(createRequirement("tender", {
      title: "不支持的接口协议",
      sourceRef: { documentId: "tender-v1", segmentId: "tender-v1-page-18", locator: "第 18 页", excerpt: "要求协议 X。" },
      responseStatus: "unsupported",
      deviationType: "pending",
    }));
    expect(validateProject(project).some((item) => item.message.includes("必须记录为负偏离"))).toBe(true);
  });

  it("creates English samples and validation messages when English is active", () => {
    const project = createSampleProject("ai", "en");
    project.owner = "";
    expect(project.name).toBe("Enterprise knowledge assistant presales and tender");
    expect(project.requirements[0].title).toBe("Critical business processes require traceable records");
    expect(validateProject(project, "en").some((item) => item.message === "The project owner has not been assigned.")).toBe(true);
  });

  it("localizes untouched built-in content without replacing user text", () => {
    const empty = localizeBuiltInProject(createEmptyProject("en"), "zh");
    expect(empty.name).toBe("新建解决方案项目");
    expect(empty.deliverables.map((item) => item.title)).toContain("产品介绍");

    const edited = createEmptyProject("en");
    edited.name = "Customer archive upgrade";
    expect(localizeBuiltInProject(edited, "zh").name).toBe("Customer archive upgrade");

    const sample = localizeBuiltInProject(createSampleProject("robot", "zh"), "en");
    expect(sample.name).toBe("Indoor material delivery robot solution");
    expect(sample.requirements[0].title).toBe("Critical business processes require traceable records");

    const staleCache = createEmptyProject("zh");
    staleCache.name = "New solution project";
    expect(localizeBuiltInProject(staleCache, "zh").name).toBe("新建解决方案项目");

    const legacyRoundTitle = createEmptyProject("zh");
    legacyRoundTitle.presalesRounds.push({ ...createPresalesRound("zh", 1), title: "第 1 次沟通" });
    expect(localizeBuiltInProject(legacyRoundTitle, "zh").presalesRounds[0].title).toBe("第一次沟通");
  });

  it("derives the current project stage from the most advanced recorded work", () => {
    const project = createEmptyProject("zh");
    expect(inferProjectStage(project)).toBe("presales");

    project.customerAlias = "某客户";
    expect(inferProjectStage(project)).toBe("presales");

    project.requirements.push(createRequirement("tender"));
    expect(inferProjectStage(project)).toBe("tender");

    project.actions.push({ id: "handover-1", stage: "delivery", title: "技术交底", owner: "", dueDate: "", status: "open", sourceRequirementId: "", notes: "" });
    expect(inferProjectStage(project)).toBe("delivery");
  });

  it("derives delivery stage and audits the new handover task response", () => {
    const project = createEmptyProject("zh");
    project.handover.departments = [{
      id: "department-delivery",
      name: "交付部",
      responsibility: "现场部署",
      owner: "",
      defaultDeliverableType: "site-action",
      defaultResponseMethod: "confirmation",
    }];
    project.handover.tasks = [{
      id: "handover-task-1",
      title: "完成现场部署确认",
      departmentId: "department-delivery",
      scope: "按中标范围完成部署。",
      deliverableType: "site-action",
      responseMethod: "confirmation",
      deliverableName: "现场部署确认单",
      owner: "",
      dueDate: "",
      status: "accepted",
      dependencyNotes: "",
      acceptanceCriteria: "",
      sourceIds: [],
      responseText: "",
      responsePath: "",
      responseSourceIds: [],
    }];
    expect(inferProjectStage(project)).toBe("delivery");
    const issues = validateProject(project).map((issue) => issue.message);
    expect(issues.some((message) => message.includes("缺少验收标准"))).toBe(true);
    expect(issues.some((message) => message.includes("没有对应响应记录"))).toBe(true);
  });

  it("opens older project manifests with default presales workflow fields", () => {
    const legacy = createEmptyProject("zh") as Record<string, unknown>;
    delete legacy.enterpriseContext;
    delete legacy.presalesRounds;
    delete legacy.handover;
    const parsed = projectManifestSchema.parse(legacy);
    expect(parsed.enterpriseContext.sourceIds).toEqual([]);
    expect(parsed.presalesRounds).toEqual([]);
    expect(parsed.handover.departments).toEqual([]);
    expect(parsed.handover.tasks).toEqual([]);
  });

  it("opens response actions created before action templates were added", () => {
    const legacy = createEmptyProject("zh");
    legacy.presalesRounds.push(createPresalesRound("zh", 1));
    const action = {
      id: "legacy-response",
      title: "",
      owner: "方案负责人",
      dueDate: "2026-09-01",
      status: "open" as const,
      responseFileName: "旧响应文件",
      responseFileFormat: "docx" as const,
      fileRequirements: "沿用原有要求",
    };
    legacy.presalesRounds[0].actions = [action as never];
    const parsed = projectManifestSchema.parse(legacy);
    expect(parsed.presalesRounds[0].actions[0].templateSourceIds).toEqual([]);
    expect(parsed.presalesRounds[0].actions[0].selectedTemplateSourceIds).toEqual([]);
  });
});
