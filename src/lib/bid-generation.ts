import type { BidFileChecklistItem, Locale, ProjectManifest, SourceDocument } from "./workspace-schema";
import { FORMAT_ONLY_TEMPLATE_RULE_EN, FORMAT_ONLY_TEMPLATE_RULE_ZH } from "./format-templates";
import { bidItemDirectory } from "./workspace-storage";

function sourceText(source: SourceDocument): string {
  const text = source.segments.map((segment) => `[${segment.locator}] ${segment.text}`).join("\n");
  return `## ${source.name}\n${text.slice(0, 18000) || "(no extractable text)"}`;
}

function fileStem(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 72) || "bid-file";
}

export function buildBidFilePrompt(
  project: ProjectManifest,
  item: BidFileChecklistItem,
  references: SourceDocument[],
  templates: SourceDocument[],
  locale: Locale = project.locale,
): string {
  const requirements = project.requirements
    .filter((requirement) => requirement.baseline === "tender")
    .map((requirement) => {
      const source = requirement.sourceRef ? `${project.sources.find((candidate) => candidate.id === requirement.sourceRef?.documentId)?.name || requirement.sourceRef.documentId} / ${requirement.sourceRef.locator}` : (locale === "zh" ? "待确认" : "To confirm");
      return locale === "zh" ? [
        `- ${requirement.title}: ${requirement.normalizedText}`,
        `  来源：${source}`,
        `  响应状态：${requirement.responseStatus}；偏离：${requirement.deviationType}；正式措辞：${requirement.formalResponse || "待确认"}`,
      ].join("\n") : [
        `- ${requirement.title}: ${requirement.normalizedText}`,
        `  Source: ${source}`,
        `  Response: ${requirement.responseStatus}; deviation: ${requirement.deviationType}; formal wording: ${requirement.formalResponse || "To confirm"}`,
      ].join("\n");
    })
    .join("\n");
  const referenceContent = references.map(sourceText).join("\n\n").slice(0, 64000);

  if (locale === "zh") return [
    `你是技术投标文件编制负责人。请为“${item.title}”生成可供人工审阅的正文。`,
    "严格依据下方招标要求和已选参考资料。不得编造产品参数、资质证书、客户案例、价格、工期、接口能力、签字盖章或法律结论；缺少证据时明确写“待确认”，并列出需补充资料。",
    FORMAT_ONLY_TEMPLATE_RULE_ZH,
    "输出 Markdown 正文，不要解释推理过程。内容应便于后续转换为目标文件格式，避免宣传腔和无法核验的承诺。",
    `# 项目与文件\n项目：${project.name}\n客户：${project.customerAlias || "待确认"}\n行业：${project.industry || "待确认"}\n项目目标：${project.objective || "待确认"}\n项目约束：${project.constraints || "待确认"}\n投标文件：${item.title}\n文件类别：${item.category}\n清单说明：${item.notes || "无"}\n目标格式：${item.outputFormat?.toUpperCase() || "待选择"}`,
    `# 细节要求\n${item.detailRequirements || "按照招标要求组织完整、清晰、可复核的文件内容。"}`,
    `# 已提炼招标要求\n${requirements || "尚无已提炼要求；只能使用参考资料中的可核验内容。"}`,
    `# 已选参考资料\n${referenceContent || "未选择额外参考资料。"}`,
    `# 格式模板\n${templates.length ? `已选择：${templates.map((template) => template.name).join("、")}。模板内容不参与正文生成。` : "未上传模板，使用通用专业格式。"}`,
  ].join("\n\n");

  return [
    `You are responsible for preparing a technical bid document. Produce review-ready content for “${item.title}”.`,
    "Use only the tender requirements and selected references below. Do not invent product parameters, qualifications, certificates, customer cases, prices, schedules, integration capabilities, signatures, or legal conclusions. Mark every unsupported point as To confirm and list the missing evidence.",
    FORMAT_ONLY_TEMPLATE_RULE_EN,
    "Return Markdown body content only. Do not explain your reasoning. Keep the document factual, reviewable, and suitable for conversion to the requested file format.",
    `# Project and file\nProject: ${project.name}\nCustomer: ${project.customerAlias || "To confirm"}\nIndustry: ${project.industry || "To confirm"}\nObjective: ${project.objective || "To confirm"}\nConstraints: ${project.constraints || "To confirm"}\nBid file: ${item.title}\nCategory: ${item.category}\nChecklist notes: ${item.notes || "None"}\nTarget format: ${item.outputFormat?.toUpperCase() || "To select"}`,
    `# Detailed requirements\n${item.detailRequirements || "Create a complete, clear, and reviewable document based on the tender requirements."}`,
    `# Extracted tender requirements\n${requirements || "No extracted requirements are available. Use only verifiable content from the references."}`,
    `# Selected references\n${referenceContent || "No additional references selected."}`,
    `# Format template\n${templates.length ? `Selected: ${templates.map((template) => template.name).join(", ")}. Template content does not participate in drafting.` : "No template uploaded. Use a general professional format."}`,
  ].join("\n\n");
}

export function buildCodexBidFileTask(
  project: ProjectManifest,
  item: BidFileChecklistItem,
  references: SourceDocument[],
  templates: SourceDocument[],
  locale: Locale = project.locale,
): { name: string; content: string; outputName: string } {
  if (!item.outputFormat) throw new Error("BID_OUTPUT_FORMAT_REQUIRED");
  const outputName = `${fileStem(item.title)}.${item.outputFormat}`;
  const taskName = `bid-output-${item.id}-${fileStem(item.title)}.md`;
  const outputPath = `${bidItemDirectory(item.title)}/生成文件/${outputName}`;
  const prompt = buildBidFilePrompt(project, item, references, templates, locale);
  const sourcePaths = references.map((source) => `- ${source.workspacePath || `projects/${project.id}/sources/${source.name}`}`).join("\n") || "- 无额外参考资料";
  const templatePaths = templates.map((source) => `- ${source.workspacePath || `projects/${project.id}/sources/${source.name}`}`).join("\n") || "- 无模板，使用通用模板";
  const body = locale === "zh" ? [
    `# Codex 投标文件生成任务：${item.title}`,
    "",
    "在当前本地工作区执行本任务。不得上传未经授权的原始资料，不得补造招标事实、能力或承诺。",
    "",
    "## 路径",
    `- 项目：projects/${project.id}`,
    `- 项目清单：projects/${project.id}/project.json`,
    `- 输出文件：${outputPath}`,
    "- 参考资料：",
    sourcePaths,
    "- 模板：",
    templatePaths,
    "",
    "## 执行要求",
    `1. 根据任务正文生成 ${item.outputFormat.toUpperCase()} 文件；${templates.length ? "沿用所选模板的版式与视觉样式" : "使用通用专业格式"}。${FORMAT_ONLY_TEMPLATE_RULE_ZH}`,
    "2. 只使用任务正文和项目目录中的所选资料；证据不足的参数、资质、案例、价格、工期和承诺标为待确认。",
    "3. 对 Word、Excel、PPT 文件执行实际渲染或打开检查，确认长文本、表格和分页无明显溢出。",
    "4. 生成后计算 SHA-256，在 project.json 的 sources 中增加输出文件来源记录。",
    `5. 在 bidFileChecklist 中 id 为 ${item.id} 的 generatedFiles 增加记录，provider 写 codex，model 写实际模型，relativePath 写 ${outputPath}，并保留 referenceSourceIds、templateSourceIds 和 detailRequirements。`,
    "6. 在同一生成文件目录保存非空的细节要求.txt；跨目录引用项目已有文件时写说明文档.txt，不复制原文件。",
    "7. 更新 updatedAt，使用项目现有 Zod 结构或测试校验，保留所有用户已有数据。",
    "8. 完成后报告输出路径、校验结果、证据缺口和仍需人工确认的事项。",
    "",
    "## 任务正文",
    "```text",
    prompt,
    "```",
  ] : [
    `# Codex bid file generation task: ${item.title}`,
    "",
    "Run this task in the current local workspace. Do not upload unauthorized source files or invent tender facts, capabilities, or commitments.",
    "",
    "## Paths",
    `- Project: projects/${project.id}`,
    `- Manifest: projects/${project.id}/project.json`,
    `- Output: ${outputPath}`,
    "- References:",
    sourcePaths,
    "- Template:",
    templatePaths,
    "",
    "## Execution requirements",
    `1. Generate a ${item.outputFormat.toUpperCase()} file from the task body. ${templates.length ? "Reuse only layout and visual styling from the selected template" : "Use a general professional format"}. ${FORMAT_ONLY_TEMPLATE_RULE_EN}`,
    "2. Use only selected project materials. Mark unsupported parameters, qualifications, cases, prices, schedules, and commitments as To confirm.",
    "3. Render or open Word, Excel, and PowerPoint outputs to check pagination, tables, and text overflow.",
    "4. Calculate SHA-256 and append a matching source record to project.json.",
    `5. Append a generatedFiles record to bidFileChecklist item ${item.id}, including provider codex, the actual model, relativePath ${outputPath}, referenceSourceIds, templateSourceIds, and detailRequirements.`,
    "6. Save non-empty detailed requirements as a text file in the same generated-files folder. For project files referenced across folders, write a reference note instead of copying the source file.",
    "7. Update updatedAt, validate against the existing Zod schema or tests, and preserve all user-authored data.",
    "8. Report the output path, validation result, evidence gaps, and remaining human review items.",
    "",
    "## Task body",
    "```text",
    prompt,
    "```",
  ];
  return { name: taskName, content: body.join("\n"), outputName };
}
