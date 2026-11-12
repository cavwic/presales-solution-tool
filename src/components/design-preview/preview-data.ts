export type PreviewLocale = 'zh' | 'en';
export type PreviewStyle = 'linear' | 'fluent' | 'notion' | 'shadcn';
export type PreviewStage = 'presales' | 'requirements' | 'bid' | 'handover' | 'outputs';
export type PreviewAction = 'import' | 'generate' | 'project' | 'new' | 'cleanup' | 'skills' | 'models' | 'communication' | 'export';
export type DemoProject = { name: string; customer: string; industry: string; owner: string; budget: string; deadline: string; objective: string; constraints: string };
export type DemoFile = { id: string; name: string; type: string; size: string; updated: string; status: 'ready' | 'review' };
export type DemoTask = { id: string; title: string; done: boolean };
export interface PreviewPageProps {
  locale: PreviewLocale;
  project: DemoProject;
  stage: PreviewStage;
  files: DemoFile[];
  tasks: DemoTask[];
  onStageChange: (stage: PreviewStage) => void;
  onProjectChange: (key: keyof DemoProject, value: string) => void;
  onAction: (action: PreviewAction) => void;
  onOpenFile: (file: DemoFile) => void;
  onTaskToggle: (id: string) => void;
}
export const tr = (locale: PreviewLocale, zh: string, en: string) => locale === 'zh' ? zh : en;
export const stages: { id: PreviewStage; zh: string; en: string }[] = [
  { id: 'presales', zh: '售前准备', en: 'Presales' },
  { id: 'requirements', zh: '招标要求', en: 'Tender requirements' },
  { id: 'bid', zh: '投标文件', en: 'Bid documents' },
  { id: 'handover', zh: '中标交底', en: 'Handover' },
  { id: 'outputs', zh: '输出文件', en: 'Output files' },
];
export const styleNames = { linear: 'A · Linear', fluent: 'B · Fluent', notion: 'C · Notion', shadcn: 'D · shadcn' };
export const demoProject = (locale: PreviewLocale): DemoProject => ({
  name: tr(locale, '园区协同平台方案', 'Campus collaboration platform'),
  customer: tr(locale, '示例园区', 'Example Campus'),
  industry: tr(locale, '产业园区运营', 'Business park operations'),
  owner: tr(locale, '方案团队', 'Solutions team'),
  budget: tr(locale, '待客户确认', 'To be confirmed'),
  deadline: '2026-12-18',
  objective: tr(locale, '梳理访客登记、会议预约与工单协作需求，形成可评审的方案及实施边界。', 'Define visitor registration, room booking, and service request workflows for a reviewable proposal and delivery scope.'),
  constraints: tr(locale, '仅使用客户确认的资料；接口、工期与验收标准需共同确认，不作未经验证的承诺。', 'Use customer-approved material only. Confirm integrations, schedules, and acceptance criteria before making commitments.'),
});
export const demoFiles = (locale: PreviewLocale): DemoFile[] => [
  { id: 'brief', name: tr(locale, '客户需求说明.pdf', 'Customer requirements.pdf'), type: 'PDF', size: '1.2 MB', updated: '11-10 14:30', status: 'ready' },
  { id: 'notes', name: tr(locale, '首次沟通纪要.docx', 'Discovery meeting notes.docx'), type: 'DOCX', size: '86 KB', updated: '11-10 16:45', status: 'ready' },
  { id: 'scope', name: tr(locale, '接口范围清单.xlsx', 'Integration scope.xlsx'), type: 'XLSX', size: '124 KB', updated: '11-11 09:20', status: 'review' },
];
export const demoTasks = (locale: PreviewLocale): DemoTask[] => [
  { id: 'requirements', title: tr(locale, '整理客户需求与项目目标', 'Organize requirements and project goals'), done: true },
  { id: 'scope', title: tr(locale, '确认接口范围与交付边界', 'Confirm integrations and delivery scope'), done: false },
  { id: 'proposal', title: tr(locale, '形成首版技术方案', 'Prepare the first technical proposal'), done: false },
];
