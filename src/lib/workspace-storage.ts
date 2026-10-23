import type { PresalesRoundAction, SourceDocument } from "./workspace-schema";

export const WORKSPACE_MODULE_DIRECTORIES = {
  projectContext: "0_项目客户方资料/1_项目与边界",
  generalTemplates: "0_项目客户方资料/2_通用文件模板",
  presalesContext: "1_售前准备/1_项目与边界",
  presalesCommunications: "1_售前准备/2_客户沟通与文件响应",
  tenderFiles: "2_招标要求/1_招标文件",
  tenderClarifications: "2_招标要求/2_澄清及相关文件",
  tenderAnalysis: "2_招标要求/3_招标文件分析/1_招标要求分析",
  tenderComparison: "2_招标要求/3_招标文件分析/2_售前文件对比",
  bidOutput: "3_技术标组包/1_投标文件输出",
  awardSupplement: "4_中标交底/1_中标补充内容",
  handoverChecklist: "4_中标交底/2_交底清单输出",
} as const;

export function safeWorkspaceName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "").slice(0, 80) || "未命名";
}

export function chineseInteger(value: number): string {
  if (!Number.isInteger(value) || value <= 0 || value > 9999) return String(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const text = String(value);
  let result = "";
  let pendingZero = false;
  for (let index = 0; index < text.length; index += 1) {
    const digit = Number(text[index]);
    const unitIndex = text.length - index - 1;
    if (digit === 0) {
      if (result) pendingZero = true;
      continue;
    }
    if (pendingZero) result += digits[0];
    pendingZero = false;
    if (!(digit === 1 && unitIndex === 1 && !result)) result += digits[digit];
    result += units[unitIndex];
  }
  return result;
}

export function presalesRoundDirectory(roundIndex: number): string {
  return `${WORKSPACE_MODULE_DIRECTORIES.presalesCommunications}/第${chineseInteger(roundIndex + 1)}轮沟通`;
}

export function tenderClarificationDirectory(roundIndex: number): string {
  return `${WORKSPACE_MODULE_DIRECTORIES.tenderClarifications}/第${chineseInteger(roundIndex + 1)}轮澄清`;
}

export function bidItemDirectory(title: string): string {
  return `${WORKSPACE_MODULE_DIRECTORIES.bidOutput}/${safeWorkspaceName(title)}`;
}

export function handoverTaskDirectory(_title: string, index: number): string {
  return `${WORKSPACE_MODULE_DIRECTORIES.handoverChecklist}/任务${chineseInteger(index + 1)}`;
}

export function sourceReferenceDocument(sources: SourceDocument[]): string {
  const unique = [...new Map(sources.map((source) => [source.id, source])).values()];
  return [
    "本目录引用项目内已有文件，未重复复制原文件。",
    "",
    ...unique.map((source, index) => `${index + 1}. ${source.name}\n   项目路径：${source.workspacePath || "项目内部资料库（旧版路径）"}\n   SHA-256：${source.sha256}`),
    "",
  ].join("\n");
}

export function analysisSupplementText(keywords: string[], requirements: string): Array<{ name: string; content: string }> {
  const supplements: Array<{ name: string; content: string }> = [];
  if (keywords.length) supplements.push({ name: "关键词.txt", content: keywords.join("\n") });
  if (requirements.trim()) supplements.push({ name: "分析要求.txt", content: `${requirements.trim()}\n` });
  return supplements;
}

export function responseFileMetadata(action: PresalesRoundAction, generatedName: string): string {
  const statusLabels = { open: "待处理", working: "进行中", blocked: "受阻", done: "已完成" } as const;
  return [
    `响应文件：${generatedName}`,
    `项目负责人：${action.owner.trim() || "未填写"}`,
    `截止时间：${action.dueDate || "未填写"}`,
    `文件状态：${statusLabels[action.status]}`,
    "",
    "文件要求：",
    action.fileRequirements?.trim() || "未填写",
    "",
  ].join("\n");
}
