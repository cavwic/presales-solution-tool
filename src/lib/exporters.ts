import type PptxGenJS from "pptxgenjs";
import { getActionResponseTarget } from "./presales-generation";
import { compareBaselines, validateProject } from "./workflow";
import { outputManifestSchema, type Locale, type PresalesRoundAction, type ProjectManifest } from "./workspace-schema";
import { sha256 } from "./parsers";

const responseLabels = {
  zh: { confirmed: "已证实满足", conditional: "条件满足", custom: "需定制", missing_evidence: "缺少证据", unsupported: "不满足" },
  en: { confirmed: "Confirmed", conditional: "Conditional", custom: "Customization required", missing_evidence: "Evidence missing", unsupported: "Unsupported" },
} as const;
const deviationLabels = {
  zh: { positive: "正偏离", none: "无偏离", negative: "负偏离", pending: "待确认" },
  en: { positive: "Positive", none: "None", negative: "Negative", pending: "Pending" },
} as const;
const participantCategoryZh = { customer: "客户", "third-party": "第三方", internal: "公司内人员" } as const;
const preprocessStatusZh = { uploaded: "已上传", ready: "上传并预处理完成", "needs-ocr": "需要 OCR", skipped: "仅上传，未处理", processing: "处理中", failed: "处理失败" } as const;
const handoverDeliverableZh = { document: "文件", "drawing-bom": "图纸 / BOM", software: "软件包 / 配置", "test-record": "测试记录", training: "培训材料", "site-action": "现场实施", approval: "审批确认", other: "其他" } as const;
const handoverResponseZh = { file: "上传文件", report: "文字报告", path: "软件包 / 路径", confirmation: "状态确认", mixed: "混合响应" } as const;
const handoverStatusZh = { pending: "待处理", working: "进行中", blocked: "受阻", submitted: "已提交", accepted: "已验收" } as const;

function safeStem(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "solution-project";
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function selectedActionTemplateNames(project: ProjectManifest, action: PresalesRoundAction): string {
  return action.selectedTemplateSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("、") || "无";
}

export function projectToCsv(project: ProjectManifest, locale: Locale = project.locale): string {
  const headers = locale === "zh"
    ? ["编号", "基线", "分类", "要求标题", "原文", "来源", "强制项", "评分项", "责任人", "响应状态", "偏离", "正式响应", "证据", "审阅状态", "验收标准"]
    : ["ID", "Baseline", "Category", "Title", "Original", "Source", "Mandatory", "Scored", "Owner", "Response", "Deviation", "Formal response", "Evidence", "Review", "Acceptance"];
  const rows = project.requirements.map((item) => [
    item.id,
    item.baseline,
    item.category,
    item.title,
    item.originalText,
    item.sourceRef?.locator || "",
    item.mandatory ? "Y" : "N",
    item.scored ? item.scoreWeight || "Y" : "N",
    item.owner,
    responseLabels[locale][item.responseStatus],
    deviationLabels[locale][item.deviationType],
    item.formalResponse,
    item.evidenceRefs.join("; "),
    item.reviewState,
    item.acceptanceCriteria,
  ]);
  return `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function presentationMarkdown(project: ProjectManifest): string {
  const approved = project.requirements.filter((item) => item.reviewState === "approved");
  const presalesHistory = project.presalesRounds.map((round) => [
    `## ${round.title} ${round.meetingAt}`,
    `参会人员：${round.participants.map((participant) => `${participant.name}（${participantCategoryZh[participant.category]}）`).join("、") || "待确认"}`,
    round.customerNeeds || "客户需求待确认",
    round.actions.map((item) => { const response = getActionResponseTarget(round, item); return `- ${response.name || "响应文件待定"}${response.format ? `.${response.format}` : " / 格式待选择"} / ${item.owner || "责任人待定"} / ${item.status}\n  文件要求：${item.fileRequirements || item.title || "待填写"}\n  响应文件模板：${selectedActionTemplateNames(project, item)}`; }).join("\n"),
    round.analysisResults.map((result) => `- 附件分析：${result.name} / ${result.fileName}`).join("\n"),
    round.generatedFiles.map((file) => `- 已生成: ${file.name}`).join("\n"),
  ].filter(Boolean).join("\n\n")).join("\n\n");
  const slides = [
    `# ${project.name}\n\n${project.customerAlias || "客户代称待确认"}\n\n${project.industry}`,
    `# 项目目标与边界\n\n## 业务目标\n${project.objective || "待确认"}\n\n## 当前约束\n${project.constraints || "待确认"}`,
    `# 售前沟通记录\n\n${presalesHistory || "尚无沟通记录"}`,
    `# 已确认需求\n\n${approved.length ? approved.map((item) => `- ${item.title}: ${item.formalResponse}`).join("\n") : "- 尚无已批准要求"}`,
    `# 方案结构\n\n${project.sections.length ? project.sections.map((item) => `- ${item.title}: ${item.purpose}`).join("\n") : "- 方案章节待编制"}`,
    `# 中标交底任务\n\n${project.handover.tasks.map((item) => `- ${item.title || "未命名任务"} / ${project.handover.departments.find((department) => department.id === item.departmentId)?.name || "部门待定"} / ${item.owner || "责任人待定"} / ${handoverStatusZh[item.status]}`).join("\n") || project.actions.filter((item) => item.status !== "done").map((item) => `- ${item.title} / ${item.owner || "责任人待定"} / ${item.dueDate || "日期待定"}`).join("\n") || "- 暂无交底任务"}`,
  ];
  return slides.join("\n\n---\n\n");
}

export function projectToMarkdown(project: ProjectManifest): string {
  const linkedDiffs = compareBaselines(project.requirements);
  const analyzedDiffs = project.tenderComparison.results.flatMap((result) => result.differences.map((difference) => ({ result: result.name, ...difference })));
  const issues = validateProject(project);
  const sections = [
    `# ${project.name}`,
    `- 项目编号: ${project.id}\n- 客户代称: ${project.customerAlias || "待确认"}\n- 行业: ${project.industry || "待确认"}\n- 责任人: ${project.owner || "待确认"}\n- 当前阶段: ${project.stage}\n- 截止日期: ${project.deadline || "待确认"}`,
    `## 业务目标\n\n${project.objective || "待确认"}`,
    `## 约束与不可承诺项\n\n${project.constraints || "待确认"}`,
    `## 售前沟通记录\n\n${project.presalesRounds.map((round) => [
      `### ${round.title}`,
      `- 沟通时间: ${round.meetingAt || "待确认"}`,
      `- 参会人员: ${round.participants.map((participant) => `${participant.name}（${participantCategoryZh[participant.category]}）`).join("、") || "待确认"}`,
      `- 客户信息及需求: ${round.customerNeeds || "待确认"}`,
      `- 客户附件: ${round.requirementSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join(", ") || "无"}`,
      `- 参考资料: ${round.referenceSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join(", ") || "无"}`,
      `- 分析关键词: ${round.keywords.join("、") || "无，执行全文分析"}`,
      `- 分析要求: ${round.analysisRequirements || "按全文分析"}`,
      `- 分析模板: ${round.selectedTemplateSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join(", ") || "无"}`,
      `- 分析结果: ${round.analysisResults.map((result) => `${result.name}（${result.fileName}）`).join(", ") || "无"}`,
      `- 生成文件: ${round.generatedFiles.map((file) => file.name).join(", ") || "无"}`,
      round.actions.map((item) => { const response = getActionResponseTarget(round, item); return `  - [${item.status === "done" ? "x" : " "}] ${response.name || "响应文件待定"}${response.format ? `.${response.format}` : " / 格式待选择"} / ${item.owner || "责任人待定"} / ${item.dueDate || "截止时间待定"}\n    文件要求：${item.fileRequirements || item.title || "待填写"}\n    响应文件模板：${selectedActionTemplateNames(project, item)}`; }).join("\n"),
    ].filter(Boolean).join("\n")).join("\n\n") || "尚无沟通记录。"}`,
    `## 招标文件\n\n${project.tenderSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter(Boolean).map((source) => `- [${project.selectedTenderSourceIds.includes(source!.id) ? "x" : " "}] ${source!.name} / ${preprocessStatusZh[source!.preprocessStatus]} / ${source!.sha256}`).join("\n") || "尚未导入招标文件。"}`,
    `## 澄清及相关文件\n\n${project.tenderClarificationRounds.map((round) => `### ${round.title}\n\n- 时间: ${round.occurredAt || "待确认"}\n- 已选文件: ${round.selectedSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("、") || "无"}`).join("\n\n") || "尚无澄清记录。"}`,
    `## 招标文件分析\n\n${project.tenderAnalysis.results.map((result) => `- ${result.name} / ${result.fileName} / ${result.relativePath}`).join("\n") || "尚无分析结果。"}`,
    `## 招标要求响应表\n\n${project.requirements.map((item) => [
      `### ${item.title}`,
      `- 基线: ${item.baseline}`,
      `- 分类: ${item.category}`,
      `- 原文来源: ${item.sourceRef ? `${item.sourceRef.locator} / ${item.sourceRef.excerpt}` : "缺少来源"}`,
      `- 响应状态: ${responseLabels.zh[item.responseStatus]}`,
      `- 偏离: ${deviationLabels.zh[item.deviationType]}`,
      `- 正式响应: ${item.formalResponse || "待编制"}`,
      `- 证据: ${item.evidenceRefs.join(", ") || "缺少证据"}`,
      `- 验收: ${item.acceptanceCriteria || "待定义"}`,
    ].join("\n")).join("\n\n") || "尚无需求记录。"}`,
    `## 售前与招标差异\n\n${analyzedDiffs.map((item) => `- [${item.relation}] ${item.title}: ${item.presales || "未提供"} -> ${item.tender || "未提供"}（${item.notes || item.result}）`).join("\n") || linkedDiffs.map((item) => `- ${item.relation}: ${item.tender?.title || item.discovery?.title || item.id}`).join("\n") || "尚无可比较基线。"}`,
    `## 投标文件清单\n\n${project.bidFileChecklist.map((item) => `- [${item.status === "confirmed" ? "x" : " "}] ${item.title} / ${item.category} / ${item.notes || "无说明"}`).join("\n") || "尚未生成投标文件清单。"}`,
    `## 技术方案章节\n\n${project.sections.map((item) => `### ${item.title}\n\n${item.body || "待编制"}\n\n关联要求: ${item.requirementIds.join(", ") || "无"}\n\n关联证据: ${item.evidenceIds.join(", ") || "无"}`).join("\n\n") || "尚无技术方案章节。"}`,
    `## 中标补充内容\n\n- 中标资料: ${project.handover.selectedAwardSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("、") || "无"}\n- 中标说明: ${project.handover.awardNotes || "无"}\n- 临时变更: ${project.handover.temporaryChanges || "无"}`,
    `## 交底部门\n\n${project.handover.departments.map((department) => `- ${department.name || "未命名部门"} / ${department.owner || "负责人待定"} / ${handoverDeliverableZh[department.defaultDeliverableType]} / ${handoverResponseZh[department.defaultResponseMethod]}\n  - 职责: ${department.responsibility || "待填写"}`).join("\n") || "尚未配置部门。"}`,
    `## 交底清单\n\n${project.handover.tasks.map((item) => `### ${item.title || "未命名交底任务"}\n- 部门: ${project.handover.departments.find((department) => department.id === item.departmentId)?.name || "未分配"}\n- 范围: ${item.scope || "待填写"}\n- 交付: ${handoverDeliverableZh[item.deliverableType]} / ${item.deliverableName || "名称待定"}\n- 响应: ${handoverResponseZh[item.responseMethod]} / ${handoverStatusZh[item.status]}\n- 负责人及截止时间: ${item.owner || "待定"} / ${item.dueDate || "待定"}\n- 前置依赖: ${item.dependencyNotes || "无"}\n- 验收标准: ${item.acceptanceCriteria || "待填写"}\n- 响应记录: ${[item.responseText, item.responsePath, ...item.responseSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id)].filter(Boolean).join("；") || "无"}`).join("\n\n") || "尚无交底任务。"}`,
    `## 审阅问题\n\n${issues.map((item) => `- ${item.severity.toUpperCase()}: ${item.message}`).join("\n") || "未发现阻断问题。"}`,
  ];
  return `${sections.join("\n\n")}\n`;
}

export async function projectToDocx(project: ProjectManifest): Promise<Blob> {
  const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = await import("docx");
  const docxCell = (text: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
  const rows = [
    new TableRow({ children: ["编号", "要求", "来源", "响应状态", "偏离", "正式响应", "审阅"].map((value) => docxCell(value, true)) }),
    ...project.requirements.map((item) => new TableRow({ children: [
      item.id,
      item.title,
      item.sourceRef?.locator || "缺少来源",
      responseLabels.zh[item.responseStatus],
      deviationLabels.zh[item.deviationType],
      item.formalResponse || "待编制",
      item.reviewState,
    ].map((value) => docxCell(value)) })),
  ];
  const document = new Document({
    styles: { default: { document: { run: { font: "Microsoft YaHei", size: 21 }, paragraph: { spacing: { after: 120 } } } } },
    sections: [{ children: [
      new Paragraph({ text: project.name, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: `项目编号：${project.id}` }),
      new Paragraph({ text: `客户代称：${project.customerAlias || "待确认"}` }),
      new Paragraph({ text: `责任人：${project.owner || "待确认"}` }),
      new Paragraph({ text: "业务目标", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(project.objective || "待确认"),
      new Paragraph({ text: "约束与不可承诺项", heading: HeadingLevel.HEADING_1 }),
      new Paragraph(project.constraints || "待确认"),
      new Paragraph({ text: "售前沟通记录", heading: HeadingLevel.HEADING_1 }),
      ...project.presalesRounds.flatMap((round) => [
        new Paragraph({ text: round.title, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: `沟通时间：${round.meetingAt || "待确认"}` }),
        new Paragraph({ text: `参会人员：${round.participants.map((participant) => `${participant.name}（${participantCategoryZh[participant.category]}）`).join("、") || "待确认"}` }),
        new Paragraph({ text: `客户信息及需求：${round.customerNeeds || "待确认"}` }),
        new Paragraph({ text: `分析关键词：${round.keywords.join("、") || "无，执行全文分析"}` }),
        new Paragraph({ text: `分析要求：${round.analysisRequirements || "按全文分析"}` }),
        ...round.analysisResults.map((result) => new Paragraph({ text: `附件分析：${result.name} / ${result.fileName}`, bullet: { level: 0 } })),
        ...round.actions.flatMap((item) => { const response = getActionResponseTarget(round, item); return [new Paragraph({ text: `${response.name || "响应文件待定"}${response.format ? `.${response.format}` : " / 格式待选择"} / ${item.owner || "责任人待定"} / ${item.dueDate || "截止时间待定"} / ${item.status}`, bullet: { level: 0 } }), new Paragraph({ text: `文件要求：${item.fileRequirements || item.title || "待填写"}` }), new Paragraph({ text: `响应文件模板：${selectedActionTemplateNames(project, item)}` })]; }),
        new Paragraph({ text: `生成文件：${round.generatedFiles.map((file) => file.name).join("、") || "无"}` }),
      ]),
      new Paragraph({ text: "招标文件", heading: HeadingLevel.HEADING_1 }),
      ...project.tenderSourceIds.map((id) => project.sources.find((source) => source.id === id)).filter((source): source is NonNullable<typeof source> => Boolean(source)).map((source) => new Paragraph({ text: `${source.name} / ${preprocessStatusZh[source.preprocessStatus]} / ${source.sha256}`, bullet: { level: 0 } })),
      new Paragraph({ text: "澄清及相关文件", heading: HeadingLevel.HEADING_1 }),
      ...project.tenderClarificationRounds.flatMap((round) => [new Paragraph({ text: round.title, heading: HeadingLevel.HEADING_2 }), new Paragraph({ text: `时间：${round.occurredAt || "待确认"}` }), new Paragraph({ text: `已选文件：${round.selectedSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("、") || "无"}` })]),
      new Paragraph({ text: "招标文件分析", heading: HeadingLevel.HEADING_1 }),
      ...project.tenderAnalysis.results.map((result) => new Paragraph({ text: `${result.name} / ${result.fileName} / ${result.relativePath}`, bullet: { level: 0 } })),
      new Paragraph({ text: "售前与招标差异", heading: HeadingLevel.HEADING_1 }),
      ...project.tenderComparison.results.flatMap((result) => result.differences.map((difference) => new Paragraph({ text: `${difference.title}：${difference.presales || "未提供"} -> ${difference.tender || "未提供"} / ${difference.relation} / ${difference.notes || result.name}`, bullet: { level: 0 } }))),
      new Paragraph({ text: "投标文件清单", heading: HeadingLevel.HEADING_1 }),
      ...project.bidFileChecklist.map((item) => new Paragraph({ text: `${item.status === "confirmed" ? "[已确认]" : "[待确认]"} ${item.title} / ${item.category} / ${item.notes || "无说明"}`, bullet: { level: 0 } })),
      new Paragraph({ text: "招标要求响应表", heading: HeadingLevel.HEADING_1 }),
      new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
      new Paragraph({ text: "技术方案章节", heading: HeadingLevel.HEADING_1 }),
      ...project.sections.flatMap((section) => [new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }), new Paragraph(section.body || "待编制")]),
      new Paragraph({ text: "中标补充内容", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: `中标资料：${project.handover.selectedAwardSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("、") || "无"}` }),
      new Paragraph({ text: `中标说明：${project.handover.awardNotes || "无"}` }),
      new Paragraph({ text: `临时变更：${project.handover.temporaryChanges || "无"}` }),
      new Paragraph({ text: "交底部门", heading: HeadingLevel.HEADING_1 }),
      ...project.handover.departments.flatMap((department) => [new Paragraph({ text: department.name || "未命名部门", heading: HeadingLevel.HEADING_2 }), new Paragraph({ text: `${department.responsibility || "职责待填写"} / ${department.owner || "负责人待定"} / ${handoverDeliverableZh[department.defaultDeliverableType]} / ${handoverResponseZh[department.defaultResponseMethod]}` })]),
      new Paragraph({ text: "交底清单", heading: HeadingLevel.HEADING_1 }),
      ...project.handover.tasks.flatMap((item) => [
        new Paragraph({ text: item.title || "未命名交底任务", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: `部门：${project.handover.departments.find((department) => department.id === item.departmentId)?.name || "未分配"} / 负责人：${item.owner || "待定"} / 截止时间：${item.dueDate || "待定"} / 状态：${handoverStatusZh[item.status]}` }),
        new Paragraph({ text: `任务范围：${item.scope || "待填写"}` }),
        new Paragraph({ text: `交付物：${handoverDeliverableZh[item.deliverableType]} / ${item.deliverableName || "名称待定"} / 响应方式：${handoverResponseZh[item.responseMethod]}` }),
        new Paragraph({ text: `前置依赖：${item.dependencyNotes || "无"}` }),
        new Paragraph({ text: `验收标准：${item.acceptanceCriteria || "待填写"}` }),
        new Paragraph({ text: `响应记录：${[item.responseText, item.responsePath, ...item.responseSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id)].filter(Boolean).join("；") || "无"}` }),
      ]),
    ] }],
  });
  return Packer.toBlob(document);
}

export async function projectToXlsx(project: ProjectManifest): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CAVWIC Solutions Lab";
  const requirements = workbook.addWorksheet("要求响应矩阵", { views: [{ state: "frozen", ySplit: 1 }] });
  requirements.columns = [
    { header: "编号", key: "id", width: 25 }, { header: "基线", key: "baseline", width: 12 }, { header: "分类", key: "category", width: 14 },
    { header: "要求", key: "title", width: 34 }, { header: "原文", key: "original", width: 48 }, { header: "来源", key: "source", width: 24 },
    { header: "强制", key: "mandatory", width: 10 }, { header: "评分", key: "scored", width: 16 }, { header: "责任人", key: "owner", width: 22 },
    { header: "响应状态", key: "response", width: 16 }, { header: "偏离", key: "deviation", width: 12 }, { header: "正式响应", key: "formal", width: 50 },
    { header: "证据", key: "evidence", width: 32 }, { header: "审阅", key: "review", width: 12 }, { header: "验收", key: "acceptance", width: 36 },
  ];
  project.requirements.forEach((item) => requirements.addRow({ id: item.id, baseline: item.baseline, category: item.category, title: item.title, original: item.originalText, source: item.sourceRef?.locator || "", mandatory: item.mandatory ? "是" : "否", scored: item.scored ? item.scoreWeight || "是" : "否", owner: item.owner, response: responseLabels.zh[item.responseStatus], deviation: deviationLabels.zh[item.deviationType], formal: item.formalResponse, evidence: item.evidenceRefs.join("; "), review: item.reviewState, acceptance: item.acceptanceCriteria }));

  const actions = workbook.addWorksheet("行动与交底清单", { views: [{ state: "frozen", ySplit: 1 }] });
  actions.columns = [{ header: "阶段", key: "stage", width: 14 }, { header: "任务", key: "title", width: 42 }, { header: "责任人", key: "owner", width: 24 }, { header: "截止日期", key: "dueDate", width: 16 }, { header: "状态", key: "status", width: 14 }, { header: "关联要求", key: "requirement", width: 26 }, { header: "说明", key: "notes", width: 42 }];
  project.actions.forEach((item) => actions.addRow(item));

  const presales = workbook.addWorksheet("售前沟通记录", { views: [{ state: "frozen", ySplit: 1 }] });
  presales.columns = [{ header: "沟通节点", key: "title", width: 24 }, { header: "沟通时间", key: "meetingAt", width: 22 }, { header: "参会人员", key: "participants", width: 36 }, { header: "历史需求记录", key: "customerNeeds", width: 40 }, { header: "响应文件清单", key: "actions", width: 72 }, { header: "客户附件", key: "requirements", width: 36 }, { header: "分析关键词", key: "keywords", width: 30 }, { header: "分析要求", key: "analysisRequirements", width: 48 }, { header: "分析模板", key: "templates", width: 36 }, { header: "分析结果", key: "analysisResults", width: 44 }, { header: "参考资料", key: "references", width: 36 }, { header: "生成文件", key: "outputs", width: 36 }];
  project.presalesRounds.forEach((round) => presales.addRow({
    title: round.title,
    meetingAt: round.meetingAt,
    participants: round.participants.map((participant) => `${participant.name}（${participantCategoryZh[participant.category]}）`).join("\n"),
    customerNeeds: round.customerNeeds,
    actions: round.actions.map((item) => { const response = getActionResponseTarget(round, item); return `${response.name || "响应文件待定"}${response.format ? `.${response.format}` : " / 格式待选择"} / ${item.owner || "责任人待定"} / ${item.dueDate || "截止时间待定"} / ${item.status}\n文件要求：${item.fileRequirements || item.title || "待填写"}\n响应文件模板：${selectedActionTemplateNames(project, item)}`; }).join("\n\n"),
    requirements: round.requirementSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("\n"),
    keywords: round.keywords.join("\n"),
    analysisRequirements: round.analysisRequirements,
    templates: round.selectedTemplateSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("\n"),
    analysisResults: round.analysisResults.map((result) => `${result.name} / ${result.fileName} / ${result.relativePath}`).join("\n"),
    references: round.referenceSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id).join("\n"),
    outputs: round.generatedFiles.map((file) => file.name).join("\n"),
  }));

  const tenderFiles = workbook.addWorksheet("招标文件与澄清", { views: [{ state: "frozen", ySplit: 1 }] });
  tenderFiles.columns = [{ header: "类型", key: "kind", width: 16 }, { header: "节点", key: "round", width: 24 }, { header: "时间", key: "occurredAt", width: 22 }, { header: "文件", key: "name", width: 40 }, { header: "已选择", key: "selected", width: 12 }, { header: "预处理状态", key: "status", width: 24 }, { header: "SHA-256", key: "sha256", width: 68 }];
  project.tenderSourceIds.forEach((id) => { const source = project.sources.find((item) => item.id === id); if (source) tenderFiles.addRow({ kind: "招标文件", round: "", occurredAt: "", name: source.name, selected: project.selectedTenderSourceIds.includes(id) ? "是" : "否", status: preprocessStatusZh[source.preprocessStatus], sha256: source.sha256 }); });
  project.tenderClarificationRounds.forEach((round) => round.sourceIds.forEach((id) => { const source = project.sources.find((item) => item.id === id); if (source) tenderFiles.addRow({ kind: "澄清文件", round: round.title, occurredAt: round.occurredAt, name: source.name, selected: round.selectedSourceIds.includes(id) ? "是" : "否", status: preprocessStatusZh[source.preprocessStatus], sha256: source.sha256 }); }));

  const tenderAnalysis = workbook.addWorksheet("招标分析与差异", { views: [{ state: "frozen", ySplit: 1 }] });
  tenderAnalysis.columns = [{ header: "分析批次", key: "result", width: 32 }, { header: "类型", key: "kind", width: 16 }, { header: "文件", key: "fileName", width: 36 }, { header: "差异项", key: "title", width: 30 }, { header: "售前基线", key: "presales", width: 44 }, { header: "招标基线", key: "tender", width: 44 }, { header: "关系", key: "relation", width: 16 }, { header: "说明", key: "notes", width: 40 }];
  project.tenderAnalysis.results.forEach((result) => tenderAnalysis.addRow({ result: result.name, kind: "招标要求分析", fileName: result.fileName }));
  project.tenderComparison.results.forEach((result) => result.differences.length ? result.differences.forEach((difference) => tenderAnalysis.addRow({ result: result.name, kind: "售前与招标对比", fileName: result.fileName, ...difference })) : tenderAnalysis.addRow({ result: result.name, kind: "售前与招标对比", fileName: result.fileName }));

  const bidFiles = workbook.addWorksheet("投标文件清单", { views: [{ state: "frozen", ySplit: 1 }] });
  bidFiles.columns = [{ header: "文件名称", key: "title", width: 42 }, { header: "类别", key: "category", width: 18 }, { header: "状态", key: "status", width: 16 }, { header: "来源分析", key: "sourceResultId", width: 30 }, { header: "说明", key: "notes", width: 52 }];
  project.bidFileChecklist.forEach((item) => bidFiles.addRow(item));

  const handover = workbook.addWorksheet("中标交底清单", { views: [{ state: "frozen", ySplit: 1 }] });
  handover.columns = [
    { header: "任务编号", key: "id", width: 24 }, { header: "责任部门", key: "department", width: 24 }, { header: "任务名称", key: "title", width: 34 },
    { header: "任务范围", key: "scope", width: 48 }, { header: "交付类型", key: "deliverableType", width: 18 }, { header: "响应方式", key: "responseMethod", width: 18 },
    { header: "交付物名称", key: "deliverableName", width: 34 }, { header: "责任人", key: "owner", width: 20 }, { header: "截止时间", key: "dueDate", width: 16 },
    { header: "前置依赖", key: "dependencies", width: 34 }, { header: "验收标准", key: "acceptance", width: 44 }, { header: "响应记录", key: "response", width: 48 }, { header: "状态", key: "status", width: 14 },
  ];
  project.handover.tasks.forEach((item) => handover.addRow({
    id: item.id,
    department: project.handover.departments.find((department) => department.id === item.departmentId)?.name || "未分配",
    title: item.title,
    scope: item.scope,
    deliverableType: handoverDeliverableZh[item.deliverableType],
    responseMethod: handoverResponseZh[item.responseMethod],
    deliverableName: item.deliverableName,
    owner: item.owner,
    dueDate: item.dueDate,
    dependencies: item.dependencyNotes,
    acceptance: item.acceptanceCriteria,
    response: [item.responseText, item.responsePath, ...item.responseSourceIds.map((id) => project.sources.find((source) => source.id === id)?.name || id)].filter(Boolean).join("\n"),
    status: handoverStatusZh[item.status],
  }));

  const evidence = workbook.addWorksheet("资料与证据索引", { views: [{ state: "frozen", ySplit: 1 }] });
  evidence.columns = [{ header: "编号", key: "id", width: 24 }, { header: "资料名称", key: "title", width: 36 }, { header: "类型", key: "kind", width: 22 }, { header: "文件", key: "fileName", width: 32 }, { header: "版本", key: "version", width: 12 }, { header: "核验日期", key: "verifiedAt", width: 16 }, { header: "复核日期", key: "expiresAt", width: 16 }, { header: "说明", key: "notes", width: 48 }];
  project.evidence.forEach((item) => evidence.addRow(item));

  const diff = workbook.addWorksheet("需求基线差异", { views: [{ state: "frozen", ySplit: 1 }] });
  diff.columns = [{ header: "关系", key: "relation", width: 16 }, { header: "售前需求", key: "discovery", width: 42 }, { header: "招标要求", key: "tender", width: 42 }, { header: "冲突说明", key: "conflict", width: 42 }];
  compareBaselines(project.requirements).forEach((item) => diff.addRow({ relation: item.relation, discovery: item.discovery?.normalizedText || "", tender: item.tender?.normalizedText || "", conflict: item.tender?.conflictNote || "" }));

  workbook.eachSheet((sheet) => {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17211F" } };
    sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function projectToPptx(project: ProjectManifest): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "CAVWIC Solutions Lab";
  pptx.subject = project.name;
  pptx.title = project.name;
  pptx.company = "CAVWIC";
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };
  const addTitle = (slide: ReturnType<typeof pptx.addSlide>, eyebrow: string, title: string) => {
    slide.addText(eyebrow, { x: 0.65, y: 0.45, w: 11.8, h: 0.25, fontFace: "Aptos", fontSize: 10, bold: true, color: "DF4C35", charSpacing: 0 });
    slide.addText(title, { x: 0.65, y: 0.84, w: 11.8, h: 0.7, fontSize: 28, bold: true, color: "17211F", margin: 0, breakLine: false });
    slide.addShape(pptx.ShapeType.line, { x: 0.65, y: 1.65, w: 12, h: 0, line: { color: "B9C2BE", width: 1 } });
  };
  let slide = pptx.addSlide();
  slide.background = { color: "F4F6F2" };
  slide.addText("SOLUTION REVIEW", { x: 0.7, y: 0.65, w: 4, h: 0.3, fontSize: 11, bold: true, color: "DF4C35", charSpacing: 0 });
  slide.addText(project.name, { x: 0.7, y: 1.35, w: 10.8, h: 1.45, fontSize: 34, bold: true, color: "17211F", margin: 0, breakLine: false });
  slide.addText(`${project.customerAlias || "客户代称待确认"}\n${project.industry || "行业待确认"}`, { x: 0.7, y: 3.2, w: 6.6, h: 0.8, fontSize: 16, color: "53615D", margin: 0 });
  slide.addText(`责任人  ${project.owner || "待确认"}\n日期  ${new Date().toISOString().slice(0, 10)}`, { x: 9.3, y: 5.7, w: 3.1, h: 0.6, fontSize: 11, color: "53615D", align: "right", margin: 0 });

  slide = pptx.addSlide(); slide.background = { color: "FFFFFF" }; addTitle(slide, "01 / CONTEXT", "目标、范围与不可承诺项");
  slide.addText("业务目标", { x: 0.7, y: 2, w: 2.2, h: 0.4, fontSize: 17, bold: true, color: "17211F", margin: 0 });
  slide.addText(project.objective || "待确认", { x: 0.7, y: 2.55, w: 5.6, h: 2.7, fontSize: 15, color: "36423F", breakLine: false, valign: "top", margin: 0.05 });
  slide.addText("约束与边界", { x: 6.9, y: 2, w: 2.2, h: 0.4, fontSize: 17, bold: true, color: "17211F", margin: 0 });
  slide.addText(project.constraints || "待确认", { x: 6.9, y: 2.55, w: 5.6, h: 2.7, fontSize: 15, color: "36423F", breakLine: false, valign: "top", margin: 0.05 });

  slide = pptx.addSlide(); slide.background = { color: "FFFFFF" }; addTitle(slide, "02 / PRESALES", "售前沟通与文件响应");
  const presalesText = project.presalesRounds.slice(0, 6).map((round) => [
    `${round.title}  ${round.meetingAt}`,
    round.customerNeeds || "客户需求待确认",
    `执行项 ${round.actions.length} 项  |  生成文件 ${round.generatedFiles.length} 个`,
  ].join("\n")).join("\n\n") || "尚无沟通记录。";
  slide.addText(presalesText, { x: 0.7, y: 2, w: 11.8, h: 3.8, fontSize: 14, color: "24302D", breakLine: false, valign: "top", margin: 0 });

  slide = pptx.addSlide(); slide.background = { color: "FFFFFF" }; addTitle(slide, "03 / TENDER", "招标文件、澄清与差异");
  const tenderText = [
    `招标文件  ${project.tenderSourceIds.length} 个  |  澄清轮次  ${project.tenderClarificationRounds.length} 次`,
    `分析结果  ${project.tenderAnalysis.results.length} 份  |  对比结果  ${project.tenderComparison.results.length} 份`,
    `投标文件清单  ${project.bidFileChecklist.length} 项`,
    ...project.tenderComparison.results.flatMap((result) => result.differences.slice(0, 4).map((difference) => `${difference.title}：${difference.presales || "未提供"} -> ${difference.tender || "未提供"}`)),
  ].join("\n\n");
  slide.addText(tenderText, { x: 0.7, y: 2, w: 11.8, h: 3.8, fontSize: 14, color: "24302D", breakLine: false, valign: "top", margin: 0 });

  slide = pptx.addSlide(); slide.background = { color: "FFFFFF" }; addTitle(slide, "04 / REQUIREMENTS", "已审阅的需求与响应");
  const reviewed = project.requirements.filter((item) => item.reviewState !== "draft").slice(0, 8);
  const tableRows: PptxGenJS.TableRow[] = [["要求", "状态", "偏离", "责任人"], ...reviewed.map((item) => [item.title, responseLabels.zh[item.responseStatus], deviationLabels.zh[item.deviationType], item.owner || "待定"])] as PptxGenJS.TableRow[];
  slide.addTable(tableRows, { x: 0.7, y: 2, w: 12, h: 3.8, border: { type: "solid", color: "CBD2CF", pt: 1 }, fill: { color: "FFFFFF" }, color: "24302D", fontSize: 11, rowH: 0.42, margin: 0.08, bold: false });

  slide = pptx.addSlide(); slide.background = { color: "FFFFFF" }; addTitle(slide, "05 / SOLUTION", "技术方案章节与证据");
  const sectionText = project.sections.map((item, index) => `${String(index + 1).padStart(2, "0")}  ${item.title}\n${item.purpose || item.body || "待编制"}`).join("\n\n") || "方案章节待编制。";
  slide.addText(sectionText, { x: 0.7, y: 2, w: 11.8, h: 3.8, fontSize: 14, color: "24302D", breakLine: false, valign: "top", margin: 0 });

  slide = pptx.addSlide(); slide.background = { color: "F4F6F2" }; addTitle(slide, "06 / NEXT ACTION", "会后执行与技术交底");
  const actions = project.handover.tasks.slice(0, 8).map((item) => `• ${item.title || "未命名任务"}  |  ${project.handover.departments.find((department) => department.id === item.departmentId)?.name || "部门待定"}  |  ${item.owner || "责任人待定"}  |  ${handoverStatusZh[item.status]}`).join("\n\n")
    || project.actions.filter((item) => item.status !== "done").slice(0, 8).map((item) => `• ${item.title}  |  ${item.owner || "责任人待定"}  |  ${item.dueDate || "日期待定"}`).join("\n\n")
    || "暂无未完成事项。";
  slide.addText(actions, { x: 0.7, y: 2, w: 11.8, h: 3.8, fontSize: 15, color: "24302D", breakLine: false, valign: "top", margin: 0 });

  const buffer = await pptx.write({ outputType: "arraybuffer" });
  return new Blob([buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

export type ArchiveResult = { blob: Blob; manifest: ReturnType<typeof outputManifestSchema.parse> };

export async function buildProjectArchive(project: ProjectManifest, includeSources = false, sourceFiles: Map<string, File> = new Map()): Promise<ArchiveResult> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const stem = safeStem(project.id);
  const generated: Array<{ name: string; blob: Blob }> = [
    { name: `${stem}.json`, blob: new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }) },
    { name: `${stem}.md`, blob: new Blob([projectToMarkdown(project)], { type: "text/markdown;charset=utf-8" }) },
    { name: `${stem}-requirements.csv`, blob: new Blob([projectToCsv(project)], { type: "text/csv;charset=utf-8" }) },
    { name: `${stem}.docx`, blob: await projectToDocx(project) },
    { name: `${stem}.xlsx`, blob: await projectToXlsx(project) },
    { name: `${stem}.pptx`, blob: await projectToPptx(project) },
    { name: "presentation.md", blob: new Blob([presentationMarkdown(project)], { type: "text/markdown;charset=utf-8" }) },
  ];
  for (const file of generated) zip.file(`outputs/${file.name}`, new Uint8Array(await file.blob.arrayBuffer()));
  if (includeSources) {
    for (const source of project.sources) {
      const file = sourceFiles.get(source.id);
      if (file) zip.file(`sources/${source.name}`, new Uint8Array(await file.arrayBuffer()));
    }
  }
  const files = await Promise.all(generated.map(async (file) => ({ name: `outputs/${file.name}`, sha256: await sha256(file.blob), bytes: file.blob.size })));
  const manifest = outputManifestSchema.parse({ schemaVersion: project.schemaVersion, projectId: project.id, generatedAt: new Date().toISOString(), includesSources: includeSources, files });
  zip.file("output-manifest.json", JSON.stringify(manifest, null, 2));
  return { blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }), manifest };
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function projectFileStem(project: ProjectManifest): string {
  return safeStem(project.id);
}
