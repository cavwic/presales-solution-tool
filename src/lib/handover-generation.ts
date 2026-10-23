import { z } from "zod";
import { desktopAwareFetch } from "./desktop-bridge";
import type { ModelSettings, ModelChannel } from "./model-settings";
import { requestPresalesDraft } from "./presales-generation";
import {
  handoverDeliverableTypeSchema,
  handoverResponseMethodSchema,
  type Locale,
  type ProjectManifest,
  type SourceDocument,
} from "./workspace-schema";

const splitTaskSchema = z.object({
  title: z.string().min(1),
  departmentId: z.string().min(1),
  scope: z.string().min(1),
  deliverableType: handoverDeliverableTypeSchema,
  responseMethod: handoverResponseMethodSchema,
  deliverableName: z.string().default(""),
  owner: z.string().default(""),
  dueDate: z.string().default(""),
  dependencyNotes: z.string().default(""),
  acceptanceCriteria: z.string().min(1),
  sourceIds: z.array(z.string()).default([]),
});

const splitResponseSchema = z.object({
  tasks: z.array(splitTaskSchema).min(1),
});

export type HandoverSplitTask = z.infer<typeof splitTaskSchema>;

function sourceText(source: SourceDocument): string {
  const body = source.segments
    .map((segment) => `[${segment.locator}] ${segment.text}`)
    .join("\n")
    .slice(0, 18000);
  return `[SOURCE id="${source.id}" name="${source.name}"]\n${body || "(no extractable text)"}`;
}

function parseJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || content.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("HANDOVER_RESPONSE_NOT_JSON");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export function buildHandoverTaskSplitPrompt(
  project: ProjectManifest,
  awardSources: SourceDocument[],
  bidSources: SourceDocument[],
  locale: Locale = project.locale,
): string {
  const departments = project.handover.departments.map((department) => [
    `- id: ${department.id}`,
    `  name: ${department.name || (locale === "zh" ? "未命名部门" : "Unnamed department")}`,
    `  responsibility: ${department.responsibility || (locale === "zh" ? "待补充" : "To complete")}`,
    `  owner: ${department.owner || (locale === "zh" ? "待确认" : "To confirm")}`,
    `  defaultDeliverableType: ${department.defaultDeliverableType}`,
    `  defaultResponseMethod: ${department.defaultResponseMethod}`,
  ].join("\n")).join("\n");
  const sources = [...awardSources, ...bidSources].map(sourceText).join("\n\n").slice(0, 72000);
  const common = [
    "Return one JSON object only. Do not wrap it in Markdown.",
    "The object shape is {\"tasks\":[{\"title\":string,\"departmentId\":string,\"scope\":string,\"deliverableType\":\"document|drawing-bom|software|test-record|training|site-action|approval|other\",\"responseMethod\":\"file|report|path|confirmation|mixed\",\"deliverableName\":string,\"owner\":string,\"dueDate\":string,\"dependencyNotes\":string,\"acceptanceCriteria\":string,\"sourceIds\":string[]}]}",
    "Use only the listed department ids and source ids. Keep unknown owners and dates empty. Create the smallest complete set of independently verifiable tasks; do not split work merely to increase the task count.",
  ].join("\n");

  if (locale === "zh") return [
    "你是中标项目技术交底负责人。请把中标技术边界拆成可分派、可响应、可验收的跨部门任务。",
    "事实优先级固定为：临时变更说明 > 中标补充资料与中标说明 > 最终投标文件。出现冲突时采用优先级更高的内容，并在任务范围中明确冲突和待确认项。不得虚构合同承诺、技术参数、工期、责任人、资质、价格或未提供的交付物。",
    "每条任务必须说明实际工作、预期交付物、响应方式、前置依赖和可检查的验收标准。软件类交付可以用软件包或受控路径响应；图纸和 BOM、测试记录、培训、现场实施、审批确认应采用对应交付类型。",
    common,
    `# 项目基线\n项目名称：${project.name}\n客户代称：${project.customerAlias || "待确认"}\n行业：${project.industry || "待确认"}\n交底清单编号：${project.handover.checklistNumber || "待填写"}\n项目编号：${project.handover.projectNumber || "待填写"}`,
    `# 临时变更说明（最高优先级）\n${project.handover.temporaryChanges || "无"}`,
    `# 中标说明\n${project.handover.awardNotes || "无"}`,
    `# 可分派部门\n${departments || "未配置部门"}`,
    `# 已选中标资料与最终投标文件\n${sources || "无可读取资料"}`,
  ].join("\n\n");

  return [
    "You own the technical handover for an awarded project. Split the awarded technical baseline into assignable, answerable, and verifiable cross-functional tasks.",
    "Apply this precedence strictly: temporary change notes > award supplements and award notes > final bid files. When sources conflict, use the higher-priority instruction and make the conflict or open question explicit in the task scope. Do not invent contractual commitments, specifications, schedules, owners, qualifications, prices, or deliverables.",
    "Each task must state the work, expected deliverable, response method, dependencies, and testable acceptance criteria. Software may be answered with a package or controlled path; drawings and BOMs, test records, training, site work, and approvals should use the matching deliverable type.",
    common,
    `# Project baseline\nProject: ${project.name}\nCustomer: ${project.customerAlias || "To confirm"}\nIndustry: ${project.industry || "To confirm"}\nHandover checklist no.: ${project.handover.checklistNumber || "To complete"}\nProject no.: ${project.handover.projectNumber || "To complete"}`,
    `# Temporary changes (highest priority)\n${project.handover.temporaryChanges || "None"}`,
    `# Award notes\n${project.handover.awardNotes || "None"}`,
    `# Available departments\n${departments || "No departments configured"}`,
    `# Selected award materials and final bid files\n${sources || "No readable sources"}`,
  ].join("\n\n");
}

export async function requestHandoverTaskSplit(
  settings: ModelSettings,
  apiKey: string,
  prompt: string,
  fetcher: typeof fetch = desktopAwareFetch,
): Promise<{ tasks: HandoverSplitTask[]; model: string; provider: ModelChannel }> {
  const result = await requestPresalesDraft(settings, apiKey, prompt, fetcher, "analysis");
  const parsed = splitResponseSchema.parse(parseJsonObject(result.content));
  return { ...result, tasks: parsed.tasks };
}

function safeFileStem(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 72) || "handover";
}

export function buildCodexHandoverTask(
  project: ProjectManifest,
  awardSources: SourceDocument[],
  bidSources: SourceDocument[],
  locale: Locale = project.locale,
): { name: string; content: string } {
  const prompt = buildHandoverTaskSplitPrompt(project, awardSources, bidSources, locale);
  const name = `handover-task-split-${safeFileStem(project.name)}.md`;
  const body = locale === "zh" ? [
    `# Codex 中标交底任务分拆：${project.name}`,
    "",
    "在当前本地项目工作区执行。读取任务正文列出的中标补充资料和最终投标文件，输出符合任务正文 JSON 结构的任务列表。",
    "",
    "## 执行要求",
    "1. 临时变更说明优先于中标补充资料，中标补充资料优先于投标文件。冲突必须显式记录，不得静默合并。",
    "2. 只能分配到项目中已配置的部门，不得虚构人员、日期、合同承诺或技术能力。",
    "3. 将结果写回 project.json 的 handover.tasks；为每条任务生成唯一 id，状态设为 pending，响应内容保持为空。",
    "4. 更新 handover.lastSplitAt、lastSplitProvider=codex、lastSplitModel 和 updatedAt，并保留全部现有字段与来源文件。",
    "5. 使用现有 Zod schema 或测试校验 project.json，报告冲突、证据缺口和待人工确认项。",
    "",
    "## 任务正文",
    "```text",
    prompt,
    "```",
  ] : [
    `# Codex award handover task split: ${project.name}`,
    "",
    "Run this in the current local project workspace. Read the selected award supplements and final bid files, then produce the JSON task list defined in the task body.",
    "",
    "## Requirements",
    "1. Temporary changes override award supplements; award supplements override bid files. Record conflicts explicitly.",
    "2. Assign work only to configured departments. Do not invent people, dates, contractual commitments, or technical capability.",
    "3. Write the result to handover.tasks in project.json. Give every task a unique id, set status to pending, and leave response fields empty.",
    "4. Update handover.lastSplitAt, lastSplitProvider=codex, lastSplitModel, and updatedAt while preserving all existing fields and sources.",
    "5. Validate project.json with the existing Zod schema or tests and report conflicts, evidence gaps, and human review items.",
    "",
    "## Task body",
    "```text",
    prompt,
    "```",
  ];
  return { name, content: body.join("\n") };
}
