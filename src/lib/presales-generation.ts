import type { Locale, PresalesRound, PresalesRoundAction, ProjectManifest, SourceDocument } from "./workspace-schema";
import { desktopAwareFetch } from "./desktop-bridge";
import { getModelProvider, type ModelChannel, type ModelSettings, type ModelTask } from "./model-settings";
import { applyFormatOnlyTemplate, FORMAT_ONLY_TEMPLATE_RULE_EN, FORMAT_ONLY_TEMPLATE_RULE_ZH } from "./format-templates";
import { chineseInteger, presalesRoundDirectory } from "./workspace-storage";

export { DEFAULT_MODEL_SETTINGS } from "./model-settings";
export type { ModelProvider, ModelSettings } from "./model-settings";

function sourceText(source: SourceDocument): string {
  const text = source.segments.map((segment) => `[${segment.locator}] ${segment.text}`).join("\n");
  return `## ${source.name}\n${text.slice(0, 16000) || "(no extractable text)"}`;
}

export type ResponseFileFormat = "md" | "docx" | "pptx";

export function templateFileFormat(name: string): ResponseFileFormat | null {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "docx") return "docx";
  if (extension === "pptx") return "pptx";
  if (extension === "md" || extension === "markdown") return "md";
  return null;
}

export function analysisResultBaseName(keywords: string[], locale: Locale): string {
  if (!keywords.length) return locale === "zh" ? "整体分析结果" : "Overall analysis result";
  return locale === "zh" ? `${keywords.join("+")}分析结果` : `${keywords.join("+")} analysis result`;
}

export function buildCustomerNeedsAnalysisPrompt(
  project: ProjectManifest,
  round: PresalesRound,
  sources: SourceDocument[],
  templates: SourceDocument[],
  locale: Locale = project.locale,
): string {
  const sourceContent = sources.map(sourceText).join("\n\n").slice(0, 60000);
  const keywords = round.keywords.filter(Boolean);
  const participantLabels = locale === "zh" ? { customer: "客户", "third-party": "第三方", internal: "公司内人员" } : { customer: "Customer", "third-party": "Third party", internal: "Internal" };
  const participants = round.participants.map((participant) => `${participant.name} (${participantLabels[participant.category]})`).join(", ");
  if (locale === "zh") return [
    "你是企业解决方案售前负责人。请分析所选客户附件，提炼后续沟通和方案编制需要使用的信息。",
    "所有结论必须能够回溯到附件内容。不得补写附件中不存在的参数、时间、资质、评分规则、价格或承诺；无法确认时写“待确认”。",
    keywords.length
      ? `在完整分析全部已选文件的基础上，提高以下关键词相关内容的检索和呈现权重：${keywords.join("、")}。不要忽略关键词以外的重要约束和风险。`
      : "未指定关键词。请分析已选文件全文，覆盖核心需求、范围、约束、时间、交付、验收、风险和待确认事项。",
    `# 项目与沟通\n项目：${project.name}\n客户：${project.customerAlias || "待确认"}\n行业：${project.industry || "待确认"}\n沟通节点：${round.title}\n沟通时间：${round.meetingAt || "待确认"}\n参会人员：${participants || "待确认"}`,
    `# 分析要求\n${round.analysisRequirements || "按事实提炼客户需求、关键约束、证据位置和待确认事项。"}`,
    `# 输出要求\n输出可直接进入人工审阅的 Markdown 正文。每个关键结论标注来源文件名和原始定位；扫描件或无可提取文本的文件标记为需要 OCR。${templates.length ? `已选择 ${templates.length} 个格式模板，正文生成不得读取或模仿模板内容。` : "未选择模板，请自行建立清晰、可复核的专业结构。"}`,
    `# 模板隔离规则\n${FORMAT_ONLY_TEMPLATE_RULE_ZH}`,
    `# 所选客户附件\n${sourceContent || "未选择附件"}`,
  ].join("\n\n");

  return [
    "You are the presales solution owner. Analyze the selected customer attachments and extract information needed for follow-up communication and solution preparation.",
    "Every conclusion must be traceable to the attachments. Do not invent parameters, dates, qualifications, scoring rules, prices, or commitments. Mark unsupported facts as To confirm.",
    keywords.length
      ? `Analyze every selected file in full while giving extra retrieval and presentation weight to: ${keywords.join(", ")}. Do not omit material constraints or risks outside those keywords.`
      : "No keywords were supplied. Analyze the full selected files, covering needs, scope, constraints, schedule, delivery, acceptance, risks, and open questions.",
    `# Project and communication\nProject: ${project.name}\nCustomer: ${project.customerAlias || "To confirm"}\nIndustry: ${project.industry || "To confirm"}\nCommunication: ${round.title}\nTime: ${round.meetingAt || "To confirm"}\nParticipants: ${participants || "To confirm"}`,
    `# Analysis requirements\n${round.analysisRequirements || "Extract customer needs, key constraints, source locations, and open questions factually."}`,
    `# Output requirements\nReturn review-ready Markdown. Cite the source file and original locator for each material finding. Mark scanned or textless files as OCR required.${templates.length ? ` ${templates.length} format template(s) are selected; do not read or imitate their content while drafting.` : " No template is selected; create a clear, reviewable professional structure."}`,
    `# Template isolation rule\n${FORMAT_ONLY_TEMPLATE_RULE_EN}`,
    `# Selected customer attachments\n${sourceContent || "No attachments selected"}`,
  ].join("\n\n");
}

export function getActionResponseTarget(round: PresalesRound, action: PresalesRoundAction): { name: string; format: ResponseFileFormat | "" } {
  const isFirstAction = round.actions[0]?.id === action.id;
  const hasActionFileFields = action.responseFileName !== undefined
    || action.responseFileFormat !== undefined
    || action.fileRequirements !== undefined;
  return {
    name: action.responseFileName !== undefined ? action.responseFileName.trim() : (!hasActionFileFields && isFirstAction ? round.outputName.trim() : ""),
    format: action.responseFileFormat || (!hasActionFileFields && isFirstAction ? round.outputFormat : ""),
  };
}

export function buildPresalesPrompt(project: ProjectManifest, round: PresalesRound, locale: Locale = project.locale, targetAction?: PresalesRoundAction): string {
  const roundIndex = project.presalesRounds.findIndex((item) => item.id === round.id);
  const selectedIds = new Set([
    ...round.requirementSourceIds,
    ...round.referenceSourceIds,
  ]);
  const selectedSources = project.sources.filter((source) => selectedIds.has(source.id));
  const priorRounds = project.presalesRounds.slice(0, Math.max(0, roundIndex));
  const actions = round.actions.map((item) => {
    const response = getActionResponseTarget(round, item);
    return `- [${item.status}] ${response.name || "response file pending"}${response.format ? `.${response.format}` : ""} / ${item.owner || "unassigned"} / ${item.dueDate || "unscheduled"}\n  File requirements: ${item.fileRequirements || item.title || "To confirm"}`;
  }).join("\n");
  const history = priorRounds.map((item) => [
    `### ${item.title} ${item.meetingAt}`,
    item.customerNeeds || "(no recorded customer need)",
    item.actions.map((action) => { const response = getActionResponseTarget(item, action); return `- ${response.name || action.title || "response file pending"} [${action.status}]`; }).join("\n"),
    item.generatedFiles.map((file) => `- generated: ${file.name}`).join("\n"),
  ].filter(Boolean).join("\n")).join("\n\n");
  const references = selectedSources.map(sourceText).join("\n\n").slice(0, 60000);
  const target = targetAction ? getActionResponseTarget(round, targetAction) : null;
  const participantLabels = locale === "zh" ? { customer: "客户", "third-party": "第三方", internal: "公司内人员" } : { customer: "Customer", "third-party": "Third party", internal: "Internal" };
  const participants = round.participants.map((participant) => `${participant.name} (${participantLabels[participant.category]})`).join(", ");

  if (locale === "zh") return [
    "你是企业解决方案售前负责人。只根据以下项目边界、沟通记录和已选资料编制本轮客户响应文件。",
    "不得虚构产品参数、案例、承诺、价格、资质或交付能力。资料缺失时明确写“待确认”，并列出需要谁确认。",
    FORMAT_ONLY_TEMPLATE_RULE_ZH,
    "输出可直接进入人工审阅的 Markdown 正文，不解释你的推理过程，不使用营销口号。",
    `# 项目与边界\n项目：${project.name}\n客户：${project.customerAlias || "待确认"}\n行业：${project.industry || "待确认"}\n责任人：${project.owner || "待确认"}\n预算：${project.budget || "待确认"}\n截止日期：${project.deadline || "待确认"}\n业务目标：${project.objective || "待确认"}\n约束：${project.constraints || "待确认"}`,
    `# 本轮沟通\n节点：${round.title}\n时间：${round.meetingAt || "待确认"}\n参会人员：${participants || "待确认"}\n客户信息及需求：\n${round.customerNeeds || "待确认"}`,
    `# 本轮执行清单\n${actions || "暂无"}`,
    targetAction ? `# 当前响应文件\n文件名：${target?.name || "待填写"}\n格式：${target?.format ? target.format.toUpperCase() : "待选择"}\n责任人：${targetAction.owner || "待确认"}\n截止日期：${targetAction.dueDate || "待确认"}\n文件状态：${targetAction.status}\n文件要求：\n${targetAction.fileRequirements || targetAction.title || "待填写"}` : "",
    `# 之前轮次\n${history || "无"}`,
    `# 已选企业资料与客户附件\n${references || "未选择资料"}`,
    `# 补充生成要求\n${round.generationInstructions || "无"}`,
  ].join("\n\n");

  return [
    "You are the presales solution owner. Draft this round's customer response using only the project boundary, communication history, and selected sources below.",
    "Do not invent product parameters, references, commitments, prices, qualifications, or delivery capability. Mark missing facts as 'To confirm' and name the responsible party.",
    FORMAT_ONLY_TEMPLATE_RULE_EN,
    "Return review-ready Markdown only. Do not explain your reasoning or use promotional language.",
    `# Project boundary\nProject: ${project.name}\nCustomer: ${project.customerAlias || "To confirm"}\nIndustry: ${project.industry || "To confirm"}\nOwner: ${project.owner || "To confirm"}\nBudget: ${project.budget || "To confirm"}\nDeadline: ${project.deadline || "To confirm"}\nObjective: ${project.objective || "To confirm"}\nConstraints: ${project.constraints || "To confirm"}`,
    `# Current communication\nNode: ${round.title}\nTime: ${round.meetingAt || "To confirm"}\nParticipants: ${participants || "To confirm"}\nCustomer information and needs:\n${round.customerNeeds || "To confirm"}`,
    `# Current action list\n${actions || "None"}`,
    targetAction ? `# Current response file\nFile name: ${target?.name || "To confirm"}\nFormat: ${target?.format ? target.format.toUpperCase() : "To select"}\nOwner: ${targetAction.owner || "To confirm"}\nDue date: ${targetAction.dueDate || "To confirm"}\nFile status: ${targetAction.status}\nFile requirements:\n${targetAction.fileRequirements || targetAction.title || "To confirm"}` : "",
    `# Previous rounds\n${history || "None"}`,
    `# Selected company materials and customer attachments\n${references || "No sources selected"}`,
    `# Additional generation instructions\n${round.generationInstructions || "None"}`,
  ].join("\n\n");
}

export async function requestPresalesDraft(
  settings: ModelSettings,
  apiKey: string,
  prompt: string,
  fetcher: typeof fetch = desktopAwareFetch,
  task: ModelTask = "draft",
): Promise<{ content: string; model: string; provider: ModelChannel }> {
  if (typeof window !== "undefined" && window.bidDesktop?.modelChat && fetcher === desktopAwareFetch) return window.bidDesktop.modelChat({ settings, apiKey, prompt, task });
  const provider = getModelProvider(settings, task);
  if (provider === "codex") throw new Error("CODEX_WORKFLOW_SELECTED");
  const endpoint = provider === "local" ? settings.localEndpoint : settings.cloudEndpoint;
  const model = provider === "local" ? settings.localModel : settings.cloudModel;
  if (!endpoint.trim()) throw new Error("MODEL_ENDPOINT_REQUIRED");
  if (!model.trim()) throw new Error("MODEL_NAME_REQUIRED");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const response = await fetcher(endpoint.trim(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model.trim(),
      messages: [
        { role: "system", content: "Produce factual, source-bounded presales documents for human review." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`MODEL_REQUEST_FAILED_${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("MODEL_RESPONSE_EMPTY");
  return { content, model: model.trim(), provider };
}

export function safeGeneratedFileName(name: string, format: ResponseFileFormat): string {
  const stem = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 72) || "presales-response";
  return `${stem}.${format}`;
}

export function buildCodexCustomerAnalysisTask(
  project: ProjectManifest,
  round: PresalesRound,
  sources: SourceDocument[],
  templates: SourceDocument[],
  locale: Locale = project.locale,
): { name: string; content: string; outputName: string } {
  if (!round.analysisOutputFormat) throw new Error("ANALYSIS_OUTPUT_FORMAT_REQUIRED");
  const roundIndex = Math.max(0, project.presalesRounds.findIndex((item) => item.id === round.id));
  const baseName = locale === "zh"
    ? `第${chineseInteger(roundIndex + 1)}次沟通需求分析`
    : `Communication ${roundIndex + 1} requirements analysis`;
  let resultName = baseName;
  let sequence = 2;
  while (round.analysisResults.some((result) => result.name === resultName)) {
    resultName = `${baseName}-${sequence}`;
    sequence += 1;
  }
  const outputName = safeGeneratedFileName(resultName, round.analysisOutputFormat);
  const taskName = `presales-analysis-${round.id}-${outputName.replace(/\.[^.]+$/, "")}.md`.replace(/[\\/:*?"<>|]+/g, "-");
  const prompt = buildCustomerNeedsAnalysisPrompt(project, round, sources, templates, locale);
  const relativePath = `${presalesRoundDirectory(roundIndex)}/需求分析/${outputName}`;
  const sourceLocator = round.analysisOutputFormat === "pptx" ? "slide" : round.analysisOutputFormat === "docx" ? "paragraph" : "line";
  const sourcePaths = sources.map((source) => `- ${source.workspacePath || `projects/${project.id}/sources/${source.name}`}`).join("\n") || "- 未选择输入文件";
  const templatePaths = templates.map((source) => `- ${source.workspacePath || `projects/${project.id}/sources/${source.name}`}`).join("\n") || "- 未选择模板";

  if (locale === "zh") return {
    name: taskName,
    outputName,
    content: [
      `# Codex 客户附件分析任务：${round.title}`,
      "",
      "在当前工作区内执行本任务。不得上传原始资料，不得补造附件中不存在的客户事实。",
      "",
      "## 路径",
      `- 项目：projects/${project.id}`,
      "- 输入资料：",
      sourcePaths,
      "- 格式模板：",
      templatePaths,
      `- 输出文件：${relativePath}`,
      `- 项目清单：projects/${project.id}/project.json`,
      "",
      "## 执行要求",
      `1. 根据下方任务正文生成 ${round.analysisOutputFormat.toUpperCase()} 分析文件；需要时使用文档或演示文稿工具完成格式化和视觉检查。${FORMAT_ONLY_TEMPLATE_RULE_ZH}`,
      "2. 只使用任务正文和项目目录中的资料；无法核验的参数、日期、资质、评分规则、价格和承诺标为待确认。",
      "3. 生成后计算输出文件 SHA-256，并在 project.json 的 sources 中增加对应来源记录。",
      `4. 在本轮 analysisResults 中增加记录：name 为 ${resultName}，provider 为 codex，model 写实际使用的 Codex 模型，relativePath 为 ${relativePath}。`,
      `5. 记录当前 prompt、keywords、sourceIds 和 templateSourceIds；来源摘要的 locatorKind 使用 ${sourceLocator}。`,
      "6. 在同一需求分析目录中，仅当内容非空时分别保存关键词.txt 和分析要求.txt。跨目录引用项目已有文件时写说明文档.txt，不复制原文件。",
      "7. 更新 project.json 的 updatedAt，并用项目现有 Zod 结构或测试校验。不得删除用户已有数据。",
      "8. 完成后报告输出路径、校验结果、证据缺口和仍需人工确认的事项。",
      "",
      "## 任务正文",
      "```text",
      prompt,
      "```",
      "",
    ].join("\n"),
  };

  return {
    name: taskName,
    outputName,
    content: [
      `# Codex customer attachment analysis task: ${round.title}`,
      "",
      "Run this task inside the current workspace. Do not upload source files or invent customer facts absent from the attachments.",
      "",
      "## Paths",
      `- Project: projects/${project.id}`,
      "- Inputs:",
      sourcePaths,
      "- Format templates:",
      templatePaths,
      `- Output: ${relativePath}`,
      `- Manifest: projects/${project.id}/project.json`,
      "",
      "## Execution requirements",
      `1. Generate a ${round.analysisOutputFormat.toUpperCase()} analysis file from the task body below. Use document or presentation tooling for formatting and visual QA when required. ${FORMAT_ONLY_TEMPLATE_RULE_EN}`,
      "2. Use only the task body and project files. Mark unsupported parameters, dates, qualifications, scoring rules, prices, and commitments as To confirm.",
      "3. Calculate the output SHA-256 and append a matching source record to project.json.",
      `4. Append an analysisResults record to this round with name ${resultName}, provider codex, the actual Codex model name, and relativePath ${relativePath}.`,
      `5. Preserve the current prompt, keywords, sourceIds, and templateSourceIds. Use ${sourceLocator} as locatorKind for the output summary.`,
      "6. In the same analysis folder, save keywords.txt and analysis-requirements.txt only when their content is non-empty. For a project file referenced across folders, write a reference note instead of copying the source file.",
      "7. Update project.json updatedAt and validate it against the existing Zod schema or tests. Preserve all user-authored data.",
      "8. Report the output path, validation result, evidence gaps, and every item requiring human review.",
      "",
      "## Task body",
      "```text",
      prompt,
      "```",
      "",
    ].join("\n"),
  };
}

export function buildCodexPresalesTask(project: ProjectManifest, round: PresalesRound, action: PresalesRoundAction, locale: Locale = project.locale, templates: SourceDocument[] = []): { name: string; content: string; outputName: string } {
  const target = getActionResponseTarget(round, action);
  if (!target.name || !target.format) throw new Error("RESPONSE_FILE_CONFIG_REQUIRED");
  const outputName = safeGeneratedFileName(target.name, target.format);
  const taskStem = outputName.replace(/\.[^.]+$/, "");
  const taskName = `presales-${round.id}-${action.id}-${taskStem}.md`.replace(/[\\/:*?"<>|]+/g, "-");
  const prompt = buildPresalesPrompt(project, round, locale, action);
  const sourceLocator = target.format === "pptx" ? "slide" : target.format === "docx" ? "paragraph" : "line";
  const templatePaths = templates.map((source) => `- ${source.workspacePath || `projects/${project.id}/sources/${source.name}`}`).join("\n") || "- 未选择模板";
  const roundIndex = Math.max(0, project.presalesRounds.findIndex((item) => item.id === round.id));
  const outputPath = `${presalesRoundDirectory(roundIndex)}/生成文件/${outputName}`;
  const sourceIds = new Set([...(round.selectedRequirementSourceIds || round.requirementSourceIds), ...round.referenceSourceIds]);
  const sourcePaths = project.sources.filter((source) => sourceIds.has(source.id))
    .map((source) => `- ${source.workspacePath || `projects/${project.id}/sources/${source.name}`}`)
    .join("\n") || "- 未选择输入文件";

  if (locale === "zh") return {
    name: taskName,
    outputName,
    content: [
      `# Codex 文件生成任务：${round.title}`,
      "",
      "在当前工作区内执行本任务。不要上传原始资料，不要把演练内容写成真实客户事实。",
      "",
      "## 路径",
      `- 项目：projects/${project.id}`,
      "- 输入资料：",
      sourcePaths,
      "- 格式模板：",
      templatePaths,
      `- 输出文件：${outputPath}`,
      `- 项目清单：projects/${project.id}/project.json`,
      "",
      "## 执行要求",
      `1. 根据下方任务正文生成 ${target.format.toUpperCase()} 文件；需要时使用文档或演示文稿工具完成格式化和视觉检查。${FORMAT_ONLY_TEMPLATE_RULE_ZH}`,
      "2. 只使用任务正文和项目目录中的资料。缺少依据的参数、案例、价格、资质和承诺一律标为待确认。",
      "3. 生成后计算输出文件 SHA-256，在 project.json 的 sources 中增加对应来源记录；fileType 使用输出格式，segments 至少保留一条可定位摘要。",
      `4. 在本轮 generatedFiles 中增加记录：actionId 为 ${action.id}，provider 为 codex，model 写实际使用的 Codex 模型，relativePath 为 ${outputPath}。`,
      "5. 在生成文件目录中保存同名文件信息文本，记录项目负责人、截止时间、文件状态和文件要求；跨目录引用项目已有文件时写说明文档.txt，不复制原文件。",
      "6. 更新 project.json 的 updatedAt，并用项目现有 Zod 结构或测试校验。不得删除其他轮次或用户已有数据。",
      `7. 来源片段的 locatorKind 使用 ${sourceLocator}。完成后报告输出路径、校验结果和仍需人工确认的事项。`,
      "",
      "## 任务正文",
      "```text",
      prompt,
      "```",
      "",
    ].join("\n"),
  };

  return {
    name: taskName,
    outputName,
    content: [
      `# Codex file generation task: ${round.title}`,
      "",
      "Run this task inside the current workspace. Do not upload source files or present practice material as a real customer fact.",
      "",
      "## Paths",
      `- Project: projects/${project.id}`,
      "- Inputs:",
      sourcePaths,
      "- Format templates:",
      templatePaths,
      `- Output: ${outputPath}`,
      `- Manifest: projects/${project.id}/project.json`,
      "",
      "## Execution requirements",
      `1. Generate a ${target.format.toUpperCase()} file from the task body below. Use document or presentation tooling when formatting and visual QA are required. ${FORMAT_ONLY_TEMPLATE_RULE_EN}`,
      "2. Use only the task body and files in the project folder. Mark unsupported parameters, references, prices, qualifications, and commitments as To confirm.",
      "3. Calculate the output SHA-256 and append a matching source record to project.json. Use the output format as fileType and preserve at least one locatable summary segment.",
      `4. Append a generatedFiles record to this round with actionId ${action.id}, provider codex, the actual Codex model name, and relativePath ${outputPath}.`,
      "5. In the generated-files folder, save a matching metadata text file with owner, due date, status, and file requirements. For project files referenced across folders, write a reference note instead of copying the source file.",
      "6. Update project.json updatedAt and validate it against the existing Zod schema or tests. Preserve every existing round and user-authored field.",
      `7. Use ${sourceLocator} as locatorKind for the output summary. Report the output path, validation result, and every item still requiring human review.`,
      "",
      "## Task body",
      "```text",
      prompt,
      "```",
      "",
    ].join("\n"),
  };
}

function markdownLines(markdown: string): Array<{ kind: "heading" | "body" | "bullet"; text: string; level: number }> {
  return markdown.split(/\r?\n/).map((line) => {
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) return { kind: "heading" as const, text: heading[2], level: heading[1].length };
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) return { kind: "bullet" as const, text: bullet[1], level: 1 };
    return { kind: "body" as const, text: line, level: 0 };
  });
}

async function markdownToDocx(markdown: string): Promise<Blob> {
  const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
  const headingLevels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  const children = markdownLines(markdown).map((line) => line.kind === "heading"
    ? new Paragraph({ text: line.text, heading: headingLevels[Math.min(line.level, 4) - 1] })
    : line.kind === "bullet"
      ? new Paragraph({ text: line.text, bullet: { level: 0 } })
      : new Paragraph(line.text));
  const document = new Document({
    styles: { default: { document: { run: { font: "Microsoft YaHei", size: 21 }, paragraph: { spacing: { after: 120 } } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(document);
}

async function markdownToPptx(markdown: string, title: string): Promise<Blob> {
  const { default: Pptx } = await import("pptxgenjs");
  const pptx = new Pptx();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "CAVWIC Solutions Lab";
  pptx.title = title;
  pptx.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei" };
  const sections: Array<{ title: string; body: string[] }> = [];
  for (const line of markdownLines(markdown)) {
    if (line.kind === "heading" && line.level <= 2) sections.push({ title: line.text, body: [] });
    else {
      if (!sections.length) sections.push({ title, body: [] });
      if (line.text) sections.at(-1)?.body.push(line.kind === "bullet" ? `• ${line.text}` : line.text);
    }
  }
  for (const section of sections.slice(0, 20)) {
    const slide = pptx.addSlide();
    slide.background = { color: "F4F6F2" };
    slide.addText(section.title, { x: 0.7, y: 0.6, w: 11.8, h: 0.7, fontSize: 26, bold: true, color: "17211F", margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: 0.7, y: 1.5, w: 11.8, h: 0, line: { color: "B9C2BE", width: 1 } });
    slide.addText(section.body.join("\n\n").slice(0, 5000) || " ", { x: 0.7, y: 1.9, w: 11.8, h: 4.7, fontSize: 15, color: "36423F", valign: "top", margin: 0.04, breakLine: false });
  }
  const buffer = await pptx.write({ outputType: "arraybuffer" });
  return new Blob([buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

export async function createGeneratedFile(markdown: string, name: string, format: ResponseFileFormat, template?: File): Promise<{ name: string; blob: Blob }> {
  const fileName = safeGeneratedFileName(name, format);
  if (format === "md") return { name: fileName, blob: new Blob([markdown], { type: "text/markdown;charset=utf-8" }) };
  const generated = format === "docx" ? await markdownToDocx(markdown) : await markdownToPptx(markdown, name);
  return { name: fileName, blob: await applyFormatOnlyTemplate(generated, markdown, format, template) };
}
