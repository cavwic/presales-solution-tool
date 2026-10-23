import {
  createEmptyProject,
  createId,
  createPresalesRound,
  type Baseline,
  type Locale,
  type ProjectManifest,
  type ProjectStage,
  type Requirement,
} from "./workspace-schema";
import { getActionResponseTarget, templateFileFormat } from "./presales-generation";
import { tenderTemplateFileFormat } from "./tender-generation";

export type ValidationIssue = {
  id: string;
  severity: "error" | "warning";
  area: "project" | "source" | "requirement" | "evidence" | "action" | "deliverable" | "section";
  message: string;
  targetId?: string;
};

export type BaselineDiff = {
  id: string;
  relation: "added" | "changed" | "unchanged" | "removed" | "conflict";
  discovery?: Requirement;
  tender?: Requirement;
};

export function compareBaselines(requirements: Requirement[]): BaselineDiff[] {
  const discovery = requirements.filter((item) => item.baseline === "discovery");
  const tender = requirements.filter((item) => item.baseline === "tender");
  const linked = new Set(tender.map((item) => item.linkedDiscoveryId).filter(Boolean));
  const result: BaselineDiff[] = tender.map((item) => {
    const baseline = discovery.find((candidate) => candidate.id === item.linkedDiscoveryId);
    if (!baseline) return { id: item.id, relation: "added", tender: item };
    if (item.conflictNote.trim()) return { id: item.id, relation: "conflict", discovery: baseline, tender: item };
    const before = baseline.normalizedText.trim().replace(/\s+/g, " ");
    const after = item.normalizedText.trim().replace(/\s+/g, " ");
    return { id: item.id, relation: before === after ? "unchanged" : "changed", discovery: baseline, tender: item };
  });
  for (const item of discovery) {
    if (!linked.has(item.id)) result.push({ id: `removed-${item.id}`, relation: "removed", discovery: item });
  }
  return result;
}

export function validateProject(project: ProjectManifest, locale: Locale = project.locale): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const zh = locale === "zh";
  if (!project.owner.trim()) issues.push({ id: "project-owner", severity: "warning", area: "project", message: zh ? "项目责任人尚未填写。" : "The project owner has not been assigned." });
  if (!project.objective.trim()) issues.push({ id: "project-objective", severity: "warning", area: "project", message: zh ? "项目业务目标尚未填写。" : "The business objective has not been entered." });

  for (const requirement of project.requirements) {
    if (!requirement.sourceRef) {
      issues.push({ id: `${requirement.id}-source`, severity: "error", area: "requirement", targetId: requirement.id, message: zh ? `“${requirement.title}”缺少原文来源。` : `"${requirement.title}" has no source clause.` });
    }
    if (!requirement.owner.trim()) {
      issues.push({ id: `${requirement.id}-owner`, severity: "warning", area: "requirement", targetId: requirement.id, message: zh ? `“${requirement.title}”尚未指定责任人。` : `"${requirement.title}" has no owner.` });
    }
    if (requirement.reviewState === "approved" && !requirement.formalResponse.trim()) {
      issues.push({ id: `${requirement.id}-response`, severity: "error", area: "requirement", targetId: requirement.id, message: zh ? `“${requirement.title}”已批准，但正式响应为空。` : `"${requirement.title}" is approved but has no formal response.` });
    }
    if (requirement.reviewState === "approved" && requirement.responseStatus === "missing_evidence") {
      issues.push({ id: `${requirement.id}-approval`, severity: "error", area: "requirement", targetId: requirement.id, message: zh ? `“${requirement.title}”缺少证据，不能批准为正式响应。` : `"${requirement.title}" cannot be approved while evidence is missing.` });
    }
    if (requirement.responseStatus === "confirmed" && requirement.evidenceRefs.length === 0) {
      issues.push({ id: `${requirement.id}-evidence`, severity: "error", area: "requirement", targetId: requirement.id, message: zh ? `“${requirement.title}”标记为已证实满足，但没有绑定证据。` : `"${requirement.title}" is marked confirmed but has no linked evidence.` });
    }
    if (requirement.responseStatus === "unsupported" && requirement.deviationType !== "negative") {
      issues.push({ id: `${requirement.id}-negative`, severity: "error", area: "requirement", targetId: requirement.id, message: zh ? `“${requirement.title}”不满足时必须记录为负偏离。` : `"${requirement.title}" is unsupported and must be recorded as a negative deviation.` });
    }
    if ((requirement.responseStatus === "custom" || requirement.responseStatus === "conditional") && requirement.deviationType === "none") {
      issues.push({ id: `${requirement.id}-conditional`, severity: "warning", area: "requirement", targetId: requirement.id, message: zh ? `“${requirement.title}”存在条件或定制工作，不应直接标记无偏离。` : `"${requirement.title}" has conditions or customization work and should not be marked as no deviation.` });
    }
  }

  for (const evidence of project.evidence) {
    if (!evidence.verifiedAt) issues.push({ id: `${evidence.id}-verified`, severity: "warning", area: "evidence", targetId: evidence.id, message: zh ? `证据“${evidence.title}”缺少核验日期。` : `Evidence "${evidence.title}" has no verification date.` });
    if (evidence.expiresAt && new Date(evidence.expiresAt).getTime() < Date.now()) {
      issues.push({ id: `${evidence.id}-expired`, severity: "warning", area: "evidence", targetId: evidence.id, message: zh ? `证据“${evidence.title}”已超过复核日期。` : `Evidence "${evidence.title}" is past its review date.` });
    }
  }

  for (const action of project.actions) {
    if (action.status !== "done" && !action.owner.trim()) issues.push({ id: `${action.id}-owner`, severity: "warning", area: "action", targetId: action.id, message: zh ? `任务“${action.title}”没有责任人。` : `Action "${action.title}" has no owner.` });
  }
  for (const round of project.presalesRounds) {
    const selectedCustomerIds = round.selectedRequirementSourceIds ?? round.requirementSourceIds;
    if (round.requirementSourceIds.length && !selectedCustomerIds.length) issues.push({ id: `${round.id}-customer-source-selection`, severity: "warning", area: "source", targetId: round.id, message: zh ? `“${round.title}”已导入客户附件，但没有选择待分析文件。` : `"${round.title}" has imported customer attachments but none are selected for analysis.` });
    if (round.analysisOutputFormat) {
      const mismatch = round.selectedTemplateSourceIds
        .map((id) => project.sources.find((source) => source.id === id))
        .find((source) => source && templateFileFormat(source.name) !== round.analysisOutputFormat);
      if (mismatch) issues.push({ id: `${round.id}-template-format`, severity: "warning", area: "source", targetId: round.id, message: zh ? `模板“${mismatch.name}”与当前分析输出格式不匹配。` : `Template "${mismatch.name}" does not match the current analysis output format.` });
    }
    for (const action of round.actions) {
      const target = getActionResponseTarget(round, action);
      const configured = Boolean(target.name || target.format || action.owner.trim() || action.dueDate || action.fileRequirements?.trim() || action.title.trim());
      const label = target.name || (zh ? "未命名响应文件" : "unnamed response file");
      if (target.format) {
        const mismatch = action.selectedTemplateSourceIds
          .map((id) => project.sources.find((source) => source.id === id))
          .find((source) => source && templateFileFormat(source.name) !== target.format);
        if (mismatch) issues.push({ id: `${action.id}-template-format`, severity: "warning", area: "source", targetId: action.id, message: zh ? `响应文件模板“${mismatch.name}”与“${label}”的输出格式不匹配。` : `Response file template "${mismatch.name}" does not match the output format for "${label}".` });
      }
      if (configured && action.status !== "done" && !action.owner.trim()) issues.push({ id: `${action.id}-owner`, severity: "warning", area: "action", targetId: action.id, message: zh ? `“${round.title}”中的“${label}”没有项目责任人。` : `"${label}" in "${round.title}" has no project owner.` });
      if (configured && !target.name) issues.push({ id: `${action.id}-response-file`, severity: "warning", area: "action", targetId: action.id, message: zh ? `“${round.title}”中有响应文件未填写名称。` : `A response file in "${round.title}" has no name.` });
      if (configured && !target.format) issues.push({ id: `${action.id}-response-format`, severity: "warning", area: "action", targetId: action.id, message: zh ? `“${round.title}”中的“${label}”未选择文件格式。` : `"${label}" in "${round.title}" has no file format.` });
    }
  }
  if (project.tenderSourceIds.length && !project.selectedTenderSourceIds.length) {
    issues.push({ id: "tender-source-selection", severity: "warning", area: "source", message: zh ? "已导入招标文件，但没有选择待分析文件。" : "Tender files were imported, but none are selected for analysis." });
  }
  for (const sourceId of [...project.selectedTenderSourceIds, ...project.tenderClarificationRounds.flatMap((round) => round.selectedSourceIds)]) {
    const source = project.sources.find((item) => item.id === sourceId);
    if (source && source.preprocessStatus !== "ready") {
      issues.push({ id: `${source.id}-preprocess`, severity: "warning", area: "source", targetId: source.id, message: zh ? `文件“${source.name}”尚未完成预处理，不能进入招标分析。` : `File "${source.name}" is not preprocessed and cannot be included in tender analysis.` });
    }
  }
  for (const [kind, config] of [["analysis", project.tenderAnalysis], ["comparison", project.tenderComparison]] as const) {
    if (!config.outputFormat) continue;
    const mismatch = config.selectedTemplateSourceIds
      .map((id) => project.sources.find((source) => source.id === id))
      .find((source) => source && tenderTemplateFileFormat(source.name) !== config.outputFormat);
    if (mismatch) issues.push({ id: `${kind}-${mismatch.id}-template-format`, severity: "warning", area: "source", targetId: mismatch.id, message: zh ? `模板“${mismatch.name}”与当前招标${kind === "analysis" ? "分析" : "对比"}输出格式不匹配。` : `Template "${mismatch.name}" does not match the current tender ${kind} output format.` });
  }
  const handoverDepartmentIds = new Set(project.handover.departments.map((department) => department.id));
  for (const task of project.handover.tasks) {
    const label = task.title || (zh ? "未命名交底任务" : "Untitled handover task");
    if (!task.departmentId || !handoverDepartmentIds.has(task.departmentId)) issues.push({ id: `${task.id}-department`, severity: "warning", area: "action", targetId: task.id, message: zh ? `交底任务“${label}”尚未分配到有效部门。` : `Handover task "${label}" is not assigned to a valid department.` });
    if (task.status !== "accepted" && !task.owner.trim()) issues.push({ id: `${task.id}-owner`, severity: "warning", area: "action", targetId: task.id, message: zh ? `交底任务“${label}”没有负责人。` : `Handover task "${label}" has no owner.` });
    if (!task.acceptanceCriteria.trim()) issues.push({ id: `${task.id}-acceptance`, severity: task.status === "accepted" ? "error" : "warning", area: "action", targetId: task.id, message: zh ? `交底任务“${label}”缺少验收标准。` : `Handover task "${label}" has no acceptance criteria.` });
    if (task.status === "submitted" || task.status === "accepted") {
      const hasResponse = task.responseMethod === "file" ? task.responseSourceIds.length > 0
        : task.responseMethod === "path" ? Boolean(task.responsePath.trim())
          : task.responseMethod === "mixed" ? Boolean(task.responseSourceIds.length || task.responsePath.trim() || task.responseText.trim())
            : Boolean(task.responseText.trim());
      if (!hasResponse) issues.push({ id: `${task.id}-response`, severity: task.status === "accepted" ? "error" : "warning", area: "action", targetId: task.id, message: zh ? `交底任务“${label}”已${task.status === "accepted" ? "验收" : "提交"}，但没有对应响应记录。` : `Handover task "${label}" is ${task.status} without a matching response record.` });
    }
  }
  for (const section of project.sections) {
    if (section.reviewState === "approved" && section.requirementIds.length === 0) issues.push({ id: `${section.id}-requirement`, severity: "warning", area: "section", targetId: section.id, message: zh ? `章节“${section.title}”已批准，但没有关联招标要求。` : `Section "${section.title}" is approved but has no linked tender requirement.` });
    if (section.reviewState === "approved" && section.evidenceIds.length === 0) issues.push({ id: `${section.id}-evidence`, severity: "warning", area: "section", targetId: section.id, message: zh ? `章节“${section.title}”已批准，但没有关联证据。` : `Section "${section.title}" is approved but has no linked evidence.` });
  }
  return issues;
}

export function requirementCoverage(project: ProjectManifest) {
  const tender = project.requirements.filter((item) => item.baseline === "tender");
  const approved = tender.filter((item) => item.reviewState === "approved").length;
  const evidenced = tender.filter((item) => item.evidenceRefs.length > 0).length;
  return { total: tender.length, approved, evidenced, pending: tender.length - approved };
}

export function inferProjectStage(project: ProjectManifest): ProjectStage {
  const hasDeliveryWork = project.handover.awardSourceIds.length > 0
    || project.handover.awardNotes.trim().length > 0
    || project.handover.checklistNumber.trim().length > 0
    || project.handover.projectNumber.trim().length > 0
    || project.handover.temporaryChanges.trim().length > 0
    || project.handover.departments.length > 0
    || project.handover.tasks.length > 0
    || project.handoverNotes.trim().length > 0
    || project.actions.some((item) => item.stage === "delivery")
    || project.deliverables.some((item) => item.stage === "delivery");
  if (hasDeliveryWork) return "delivery";

  const hasTenderWork = project.tenderSourceIds.length > 0
    || project.tenderClarificationRounds.some((round) => round.sourceIds.length > 0)
    || project.tenderAnalysis.results.length > 0
    || project.tenderComparison.results.length > 0
    || project.bidFileChecklist.length > 0
    || project.requirements.some((item) => item.baseline === "tender")
    || project.evidence.length > 0
    || project.sections.length > 0
    || project.deliverables.some((item) => item.stage === "tender");
  if (hasTenderWork) return "tender";

  // Presales is the first stage and remains current until tender or handover work is recorded.
  return "presales";
}

export function syncProjectStage(project: ProjectManifest): ProjectManifest {
  const stage = inferProjectStage(project);
  return project.stage === stage ? project : { ...project, stage };
}

export function createRequirement(baseline: Baseline, patch: Partial<Requirement> = {}, locale: Locale = "zh"): Requirement {
  return {
    id: createId("req"),
    baseline,
    category: "technical",
    title: locale === "zh"
      ? baseline === "tender" ? "待复核的招标要求" : "待确认的客户需求"
      : baseline === "tender" ? "Tender requirement to review" : "Customer requirement to confirm",
    originalText: "",
    normalizedText: "",
    mandatory: false,
    scored: false,
    scoreWeight: "",
    dueDate: "",
    sourceRef: null,
    owner: "",
    responseStatus: "missing_evidence",
    deviationType: "pending",
    formalResponse: "",
    evidenceRefs: [],
    reviewState: "draft",
    linkedDiscoveryId: "",
    conflictNote: "",
    acceptanceCriteria: "",
    notes: "",
    ...patch,
  };
}

export function createSampleProject(kind: "ai" | "robot" | "electromechanical" = "ai", locale: Locale = "zh"): ProjectManifest {
  const project = createEmptyProject(locale);
  const samples = locale === "zh" ? {
    ai: {
      id: "enterprise-ai-knowledge-assistant",
      name: "企业知识助手售前与技术投标",
      customerAlias: "某装备制造企业",
      industry: "企业 AI",
      objective: "在权限边界内检索当前技术资料，为一线人员提供带来源的回答，并将低置信度问题转交人工。",
      constraints: "客户资料不得进入公开服务；答案必须引用原文；系统不得自动对外发送内容。",
    },
    robot: {
      id: "robot-material-handling",
      name: "室内物料配送机器人方案",
      customerAlias: "某制造园区",
      industry: "具身智能机器人",
      objective: "完成物料接单、取放、配送和回执，并记录失败恢复及人工干预。",
      constraints: "人机混行；门禁接口待确认；现场风险评估由具备资质的责任方完成。",
    },
    electromechanical: {
      id: "electromechanical-security-system",
      name: "复杂机电安全系统技术方案",
      customerAlias: "某公共设施项目",
      industry: "复杂机电系统",
      objective: "完成现场设备、控制系统、第三方接口和验收边界的技术方案与交底。",
      constraints: "正式结构图由专业设计单位出具；第三方接口版本以书面确认为准。",
    },
  } as const : {
    ai: {
      id: "enterprise-ai-knowledge-assistant",
      name: "Enterprise knowledge assistant presales and tender",
      customerAlias: "Equipment manufacturer",
      industry: "Enterprise AI",
      objective: "Retrieve current technical documents within permission boundaries, return source-linked answers to frontline staff, and route low-confidence questions to a person.",
      constraints: "Customer documents must not enter public services. Every answer must cite its source. The system must not send external messages automatically.",
    },
    robot: {
      id: "robot-material-handling",
      name: "Indoor material delivery robot solution",
      customerAlias: "Manufacturing campus",
      industry: "Embodied robotics",
      objective: "Accept, collect, deliver, and acknowledge material tasks while recording recovery attempts and human intervention.",
      constraints: "People and robots share the site. Access-control interfaces remain unconfirmed. A qualified responsible party must complete the site risk assessment.",
    },
    electromechanical: {
      id: "electromechanical-security-system",
      name: "Complex electromechanical safety system proposal",
      customerAlias: "Public facility project",
      industry: "Complex electromechanical systems",
      objective: "Define the technical solution and handover boundary for site devices, controls, third-party interfaces, and acceptance.",
      constraints: "A qualified design organization must issue formal structural drawings. Written confirmation governs third-party interface versions.",
    },
  } as const;
  const sample = samples[kind];
  Object.assign(project, sample, { owner: locale === "zh" ? "解决方案负责人" : "Solution owner", stage: "tender" as const, budget: locale === "zh" ? "待商务确认" : "Pending commercial confirmation", deadline: "2026-09-30", localPathHint: `D:\\Solutions\\${sample.id}` });
  const text = locale === "zh" ? {
    discoveryTitle: "关键业务流程需要形成可追溯记录",
    discoveryOriginal: "沟通确认：关键任务的输入、处理结果、失败原因和人工处理过程需要留痕。",
    discoveryNormalized: "关键任务输入、输出、失败和人工处理过程需要留痕。",
    discoveryOwner: "客户业务负责人 / 解决方案",
    meetingLocator: "沟通纪要 / 第 1 条",
    meetingExcerpt: "关键任务需要保留完整处理记录。",
    tenderTitle: "系统运行日志保存不少于 180 天",
    tenderOriginal: "系统应记录关键操作、接口调用、异常和人工处理过程，日志保存时间不少于 180 天。",
    tenderNormalized: "记录关键操作、接口调用、异常和人工处理过程，日志保存不少于 180 天。",
    scoreWeight: "技术评分 4 分",
    tenderOwner: "产品 / 平台 / 解决方案",
    tenderLocator: "招标文件第 18 页 / 4.3.2",
    tenderExcerpt: "日志保存时间不少于 180 天。",
    formalResponse: "可通过日志策略配置实现，具体存储容量需结合并发量和日志粒度确认。",
    acceptance: "现场连续运行并抽查日志完整性、检索权限和 180 天保留策略。",
    meetingFile: "售前沟通纪要.md",
    meetingLine: "第 1 行",
    tenderFile: "招标文件-示例.pdf",
    evidenceTitle: "日志与审计功能手册",
    evidenceNotes: "仅证明可配置留存策略，容量仍需核算。",
    presalesAction: "确认用户规模、并发量和日志粒度",
    presalesActionOwner: "客户 IT / 解决方案",
    presalesActionNotes: "用于计算存储容量。",
    deliveryAction: "按中标版本完成技术交底",
    deliveryActionOwner: "解决方案 / 项目经理",
    deliveryActionNotes: "交付前冻结承诺基线。",
    sectionTitle: "日志、审计与权限控制",
    sectionPurpose: "说明日志范围、访问权限、容量估算和验收方法。",
    pocObjective: "验证关键流程、失败处理和来源追溯。",
    pocScope: "使用脱敏样本完成主流程与两个失败场景。",
    pocAcceptance: "所有结果可复核，失败进入人工处理。",
    pocFallback: "接口超时、资料缺失和权限不足时停止自动处理并记录原因。",
    handover: "交底前核对最终投标文件、澄清函、合同技术附件和现场条件。",
  } : {
    discoveryTitle: "Critical business processes require traceable records",
    discoveryOriginal: "Meeting confirmation: preserve task inputs, processing results, failure causes, and human handling records.",
    discoveryNormalized: "Preserve the inputs, outputs, failures, and human handling records for critical tasks.",
    discoveryOwner: "Customer business owner / Solution team",
    meetingLocator: "Meeting notes / Item 1",
    meetingExcerpt: "Critical tasks require complete processing records.",
    tenderTitle: "Retain system operation logs for at least 180 days",
    tenderOriginal: "The system shall record critical operations, interface calls, exceptions, and human handling. Logs shall be retained for at least 180 days.",
    tenderNormalized: "Record critical operations, interface calls, exceptions, and human handling, with at least 180 days of log retention.",
    scoreWeight: "4 technical points",
    tenderOwner: "Product / Platform / Solution team",
    tenderLocator: "Tender page 18 / 4.3.2",
    tenderExcerpt: "Logs shall be retained for at least 180 days.",
    formalResponse: "A configurable retention policy can support this requirement. Storage capacity must be confirmed against concurrency and log granularity.",
    acceptance: "Run the system continuously on site and inspect log completeness, retrieval permissions, and the 180-day retention policy.",
    meetingFile: "presales-meeting-notes.md",
    meetingLine: "Line 1",
    tenderFile: "sample-tender.pdf",
    evidenceTitle: "Logging and audit manual",
    evidenceNotes: "This confirms configurable retention only. Storage capacity still requires calculation.",
    presalesAction: "Confirm user count, concurrency, and log granularity",
    presalesActionOwner: "Customer IT / Solution team",
    presalesActionNotes: "Required for storage sizing.",
    deliveryAction: "Complete the technical handover against the awarded baseline",
    deliveryActionOwner: "Solution team / Project manager",
    deliveryActionNotes: "Freeze the commitment baseline before delivery.",
    sectionTitle: "Logging, audit, and access control",
    sectionPurpose: "Define log scope, access permissions, capacity sizing, and acceptance methods.",
    pocObjective: "Validate the critical flow, failure handling, and source traceability.",
    pocScope: "Use sanitized samples to run the main flow and two failure scenarios.",
    pocAcceptance: "Every result can be reviewed, and failures route to a person.",
    pocFallback: "Stop automated processing and record the cause when an interface times out, material is missing, or permission is denied.",
    handover: "Before handover, reconcile the final bid, clarification letters, contract technical attachments, and site conditions.",
  };

  const discovery = createRequirement("discovery", {
    id: `${sample.id}-discovery-1`,
    title: text.discoveryTitle,
    originalText: text.discoveryOriginal,
    normalizedText: text.discoveryNormalized,
    owner: text.discoveryOwner,
    reviewState: "reviewed",
    sourceRef: { documentId: "meeting-notes", segmentId: "meeting-notes-line-1", locator: text.meetingLocator, excerpt: text.meetingExcerpt },
  }, locale);
  const tender = createRequirement("tender", {
    id: `${sample.id}-tender-1`,
    title: text.tenderTitle,
    originalText: text.tenderOriginal,
    normalizedText: text.tenderNormalized,
    mandatory: true,
    scored: true,
    scoreWeight: text.scoreWeight,
    owner: text.tenderOwner,
    responseStatus: "conditional",
    deviationType: "pending",
    reviewState: "reviewed",
    linkedDiscoveryId: discovery.id,
    sourceRef: { documentId: "tender-v1", segmentId: "tender-v1-page-18", locator: text.tenderLocator, excerpt: text.tenderExcerpt },
    formalResponse: text.formalResponse,
    acceptanceCriteria: text.acceptance,
  }, locale);
  project.sources = [
    { id: "meeting-notes", name: text.meetingFile, fileType: "md", version: "1.0", size: 240, sha256: "sample-meeting-notes", importedAt: project.updatedAt, workspacePath: "", requiresOcr: false, preprocessStatus: "ready", preprocessedAt: project.updatedAt, preprocessMessage: "", segments: [{ id: "meeting-notes-line-1", locatorKind: "line", locator: text.meetingLine, text: text.meetingExcerpt }] },
    { id: "tender-v1", name: text.tenderFile, fileType: "pdf", version: "1.0", size: 1024, sha256: "sample-tender-v1", importedAt: project.updatedAt, workspacePath: "", requiresOcr: false, preprocessStatus: "ready", preprocessedAt: project.updatedAt, preprocessMessage: "", segments: [{ id: "tender-v1-page-18", locatorKind: "page", locator: text.tenderLocator, text: tender.originalText }] },
  ];
  project.requirements = [discovery, tender];
  project.evidence = [{ id: "evidence-log-manual", title: text.evidenceTitle, kind: "manual", fileName: "logging-manual.pdf", version: "3.2", verifiedAt: "2026-08-14", expiresAt: "2026-11-12", sourceRef: null, notes: text.evidenceNotes }];
  project.actions = [
    { id: createId("action"), stage: "presales", title: text.presalesAction, owner: text.presalesActionOwner, dueDate: "2026-08-28", status: "working", sourceRequirementId: tender.id, notes: text.presalesActionNotes },
    { id: createId("action"), stage: "delivery", title: text.deliveryAction, owner: text.deliveryActionOwner, dueDate: "", status: "open", sourceRequirementId: tender.id, notes: text.deliveryActionNotes },
  ];
  project.sections = [{ id: createId("section"), title: text.sectionTitle, purpose: text.sectionPurpose, requirementIds: [tender.id], evidenceIds: [], body: tender.formalResponse, reviewState: "reviewed" }];
  project.pocPlan = { objective: text.pocObjective, demoScope: text.pocScope, acceptance: text.pocAcceptance, failureAndFallback: text.pocFallback };
  project.handoverNotes = text.handover;
  project.handover.awardNotes = text.handover;
  project.handover.departments = [{
    id: createId("department"),
    name: locale === "zh" ? "解决方案与交付" : "Solution and delivery",
    responsibility: text.deliveryActionNotes,
    owner: text.deliveryActionOwner,
    defaultDeliverableType: "document",
    defaultResponseMethod: "mixed",
  }];
  return project;
}

export function localizeBuiltInProject(project: ProjectManifest, locale: Locale): ProjectManifest {
  const sampleKinds = {
    "enterprise-ai-knowledge-assistant": "ai",
    "robot-material-handling": "robot",
    "electromechanical-security-system": "electromechanical",
  } as const;
  const sampleKind = sampleKinds[project.id as keyof typeof sampleKinds];
  const toTemplate = sampleKind ? createSampleProject(sampleKind, locale) : createEmptyProject(locale);
  const translatableFields = new Set([
    "name", "customerAlias", "industry", "owner", "budget", "objective", "constraints",
    "title", "originalText", "normalizedText", "scoreWeight", "locator", "excerpt", "formalResponse",
    "acceptanceCriteria", "notes", "text", "purpose", "demoScope", "acceptance",
    "failureAndFallback", "handoverNotes", "customerNeeds", "generationInstructions", "outputName", "responseFileName", "fileRequirements", "analysisRequirements", "prompt",
    "awardNotes", "temporaryChanges", "responsibility", "scope", "deliverableName", "dependencyNotes", "acceptanceCriteria", "responseText", "responsePath",
  ]);
  const translations = new Map<string, string>();

  const collectTranslations = (from: unknown, to: unknown, key = "") => {
    if (typeof from === "string" && typeof to === "string") {
      if (translatableFields.has(key) && from && from !== to) translations.set(from, to);
      return;
    }
    if (Array.isArray(from) && Array.isArray(to)) {
      from.forEach((item, index) => collectTranslations(item, to[index], key));
      return;
    }
    if (!from || !to || typeof from !== "object" || typeof to !== "object") return;
    for (const [childKey, value] of Object.entries(from)) {
      collectTranslations(value, (to as Record<string, unknown>)[childKey], childKey);
    }
  };

  const translateKnownValues = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") return translatableFields.has(key) ? translations.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map((item) => translateKnownValues(item, key));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, translateKnownValues(childValue, childKey)]));
  };

  for (const sourceLocale of ["zh", "en"] as const) {
    const fromTemplate = sampleKind ? createSampleProject(sampleKind, sourceLocale) : createEmptyProject(sourceLocale);
    collectTranslations(fromTemplate, toTemplate);
    for (let index = 1; index <= Math.max(project.presalesRounds.length, 1); index += 1) {
      const localizedRound = createPresalesRound(locale, index);
      collectTranslations(createPresalesRound(sourceLocale, index), localizedRound);
      translations.set(`第 ${index} 次沟通`, localizedRound.title);
      translations.set(`第${index}次沟通`, localizedRound.title);
    }
  }
  const localized = translateKnownValues(project) as ProjectManifest;
  return { ...localized, locale, updatedAt: new Date().toISOString() };
}
