import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0" as const;

export const localeSchema = z.enum(["zh", "en"]);
export const projectStageSchema = z.enum(["presales", "tender", "delivery"]);
export const baselineSchema = z.enum(["discovery", "tender"]);
export const requirementCategorySchema = z.enum([
  "technical",
  "business",
  "qualification",
  "scoring",
  "schedule",
  "acceptance",
  "delivery",
  "commercial",
]);
export const responseStatusSchema = z.enum([
  "confirmed",
  "conditional",
  "custom",
  "missing_evidence",
  "unsupported",
]);
export const deviationTypeSchema = z.enum(["positive", "none", "negative", "pending"]);
export const reviewStateSchema = z.enum(["draft", "reviewed", "approved"]);
export const sourceFileTypeSchema = z.enum(["pdf", "docx", "xlsx", "pptx", "md", "txt", "csv", "json", "png", "jpg", "jpeg", "webp", "ocr"]);
export const preprocessStatusSchema = z.enum(["uploaded", "ready", "needs-ocr", "skipped", "processing", "failed"]);
export const generalTemplateFormatSchema = z.enum(["docx", "xlsx", "pptx"]);

export const generalTemplatesSchema = z.object({
  docxSourceId: z.string().default(""),
  xlsxSourceId: z.string().default(""),
  pptxSourceId: z.string().default(""),
});

export const sourceSegmentSchema = z.object({
  id: z.string().min(1),
  locatorKind: z.enum(["page", "paragraph", "table-cell", "sheet-cell", "slide", "line"]),
  locator: z.string().min(1),
  text: z.string(),
});

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fileType: sourceFileTypeSchema,
  version: z.string().default("1.0"),
  size: z.number().nonnegative(),
  sha256: z.string().min(1),
  importedAt: z.string(),
  requiresOcr: z.boolean().default(false),
  preprocessStatus: preprocessStatusSchema.default("uploaded"),
  preprocessedAt: z.string().default(""),
  preprocessMessage: z.string().default(""),
  workspacePath: z.string().default(""),
  segments: z.array(sourceSegmentSchema),
});

export const sourceRefSchema = z.object({
  documentId: z.string().min(1),
  segmentId: z.string().min(1),
  locator: z.string().min(1),
  excerpt: z.string(),
});

export const evidenceRefSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["product-intro", "sow", "manual", "historical-solution", "certificate", "drawing", "other"]),
  fileName: z.string(),
  version: z.string(),
  verifiedAt: z.string(),
  expiresAt: z.string(),
  sourceRef: sourceRefSchema.nullable(),
  notes: z.string(),
});

export const requirementSchema = z.object({
  id: z.string().min(1),
  baseline: baselineSchema,
  category: requirementCategorySchema,
  title: z.string().min(1),
  originalText: z.string(),
  normalizedText: z.string(),
  mandatory: z.boolean(),
  scored: z.boolean(),
  scoreWeight: z.string(),
  dueDate: z.string(),
  sourceRef: sourceRefSchema.nullable(),
  owner: z.string(),
  responseStatus: responseStatusSchema,
  deviationType: deviationTypeSchema,
  formalResponse: z.string(),
  evidenceRefs: z.array(z.string()),
  reviewState: reviewStateSchema,
  linkedDiscoveryId: z.string(),
  conflictNote: z.string(),
  acceptanceCriteria: z.string(),
  notes: z.string(),
});

export const actionItemSchema = z.object({
  id: z.string().min(1),
  stage: projectStageSchema,
  title: z.string().min(1),
  owner: z.string(),
  dueDate: z.string(),
  status: z.enum(["open", "working", "blocked", "done"]),
  sourceRequirementId: z.string(),
  notes: z.string(),
});

export const deliverableSchema = z.object({
  id: z.string().min(1),
  stage: projectStageSchema,
  kind: z.enum([
    "product-intro",
    "preliminary-solution",
    "meeting-deck",
    "discovery-record",
    "poc-plan",
    "technical-proposal",
    "response-matrix",
    "deviation-table",
    "module-detail",
    "drawing-register",
    "deployment-manual",
    "acceptance-plan",
    "certificate-register",
    "handover-pack",
  ]),
  title: z.string().min(1),
  status: z.enum(["not-started", "draft", "review", "approved"]),
  owner: z.string(),
  dueDate: z.string(),
  sourceIds: z.array(z.string()),
  notes: z.string(),
});

export const solutionSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string(),
  requirementIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  body: z.string(),
  reviewState: reviewStateSchema,
});

export const pocPlanSchema = z.object({
  objective: z.string(),
  demoScope: z.string(),
  acceptance: z.string(),
  failureAndFallback: z.string(),
});

export const enterpriseContextSchema = z.object({
  companyName: z.string().default(""),
  platform: z.string().default(""),
  importedAt: z.string().default(""),
  notes: z.string().default(""),
  sourceIds: z.array(z.string()).default([]),
});

export const presalesRoundActionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  owner: z.string(),
  dueDate: z.string(),
  status: z.enum(["open", "working", "blocked", "done"]),
  responseFileName: z.string().optional(),
  responseFileFormat: z.enum(["md", "docx", "pptx"]).optional(),
  fileRequirements: z.string().optional(),
  templateSourceIds: z.array(z.string()).default([]),
  selectedTemplateSourceIds: z.array(z.string()).default([]),
});

export const presalesGeneratedFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  format: z.enum(["md", "docx", "pptx"]),
  createdAt: z.string(),
  provider: z.enum(["codex", "local", "cloud"]),
  model: z.string(),
  sourceId: z.string(),
  relativePath: z.string(),
  actionId: z.string().default(""),
});

export const presalesAnalysisResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fileName: z.string().min(1),
  format: z.enum(["md", "docx", "pptx"]),
  createdAt: z.string(),
  provider: z.enum(["local", "cloud", "codex"]),
  model: z.string(),
  sourceId: z.string(),
  relativePath: z.string(),
  prompt: z.string(),
  keywords: z.array(z.string()),
  sourceIds: z.array(z.string()),
  templateSourceIds: z.array(z.string()),
});

export const presalesParticipantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["customer", "third-party", "internal"]),
});

export const presalesRoundSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  meetingAt: z.string(),
  participants: z.array(presalesParticipantSchema).default([]),
  customerNeeds: z.string(),
  requirementSourceIds: z.array(z.string()),
  selectedRequirementSourceIds: z.array(z.string()).optional(),
  keywords: z.array(z.string()).default([]),
  analysisRequirements: z.string().default(""),
  templateSourceIds: z.array(z.string()).default([]),
  selectedTemplateSourceIds: z.array(z.string()).default([]),
  analysisOutputFormat: z.enum(["md", "docx", "pptx"]).optional(),
  analysisResults: z.array(presalesAnalysisResultSchema).default([]),
  actions: z.array(presalesRoundActionSchema),
  referenceSourceIds: z.array(z.string()),
  generationInstructions: z.string(),
  outputName: z.string(),
  outputFormat: z.enum(["md", "docx", "pptx"]),
  generatedFiles: z.array(presalesGeneratedFileSchema),
});

export const tenderOutputFormatSchema = z.enum(["md", "docx", "pptx", "xlsx"]);

export const tenderClarificationRoundSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  occurredAt: z.string(),
  sourceIds: z.array(z.string()).default([]),
  selectedSourceIds: z.array(z.string()).default([]),
});

export const tenderDifferenceSchema = z.object({
  title: z.string().min(1),
  presales: z.string().default(""),
  tender: z.string().default(""),
  relation: z.enum(["added", "changed", "unchanged", "removed", "conflict"]).default("changed"),
  notes: z.string().default(""),
});

export const tenderAnalysisResultSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["requirements", "comparison"]),
  name: z.string().min(1),
  fileName: z.string().min(1),
  format: tenderOutputFormatSchema,
  createdAt: z.string(),
  provider: z.enum(["local", "cloud", "codex"]),
  model: z.string(),
  sourceId: z.string(),
  relativePath: z.string(),
  prompt: z.string(),
  keywords: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
  templateSourceIds: z.array(z.string()).default([]),
  differences: z.array(tenderDifferenceSchema).default([]),
});

export const tenderAnalysisConfigSchema = z.object({
  keywords: z.array(z.string()).default([]),
  analysisRequirements: z.string().default(""),
  templateSourceIds: z.array(z.string()).default([]),
  selectedTemplateSourceIds: z.array(z.string()).default([]),
  outputFormat: tenderOutputFormatSchema.optional(),
  results: z.array(tenderAnalysisResultSchema).default([]),
});

export const tenderComparisonConfigSchema = z.object({
  selectedPresalesSourceIds: z.array(z.string()).default([]),
  templateSourceIds: z.array(z.string()).default([]),
  selectedTemplateSourceIds: z.array(z.string()).default([]),
  outputFormat: tenderOutputFormatSchema.optional(),
  results: z.array(tenderAnalysisResultSchema).default([]),
});

export const bidGeneratedFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  format: tenderOutputFormatSchema,
  createdAt: z.string(),
  provider: z.enum(["local", "cloud", "codex"]),
  model: z.string(),
  sourceId: z.string(),
  relativePath: z.string(),
  referenceSourceIds: z.array(z.string()).default([]),
  templateSourceIds: z.array(z.string()).default([]),
  detailRequirements: z.string().default(""),
});

export const bidFileChecklistItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(["technical", "business", "qualification", "delivery", "other"]),
  status: z.enum(["pending", "confirmed"]).default("pending"),
  sourceResultId: z.string().default(""),
  notes: z.string().default(""),
  templateSourceIds: z.array(z.string()).default([]),
  selectedTemplateSourceIds: z.array(z.string()).default([]),
  referenceSourceIds: z.array(z.string()).default([]),
  selectedReferenceSourceIds: z.array(z.string()).default([]),
  outputFormat: tenderOutputFormatSchema.optional(),
  detailRequirements: z.string().default(""),
  generatedFiles: z.array(bidGeneratedFileSchema).default([]),
});

export const handoverDeliverableTypeSchema = z.enum([
  "document",
  "drawing-bom",
  "software",
  "test-record",
  "training",
  "site-action",
  "approval",
  "other",
]);

export const handoverResponseMethodSchema = z.enum([
  "file",
  "report",
  "path",
  "confirmation",
  "mixed",
]);

export const handoverTaskStatusSchema = z.enum([
  "pending",
  "working",
  "blocked",
  "submitted",
  "accepted",
]);

export const handoverDepartmentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  responsibility: z.string(),
  owner: z.string(),
  defaultDeliverableType: handoverDeliverableTypeSchema,
  defaultResponseMethod: handoverResponseMethodSchema,
});

export const handoverTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  departmentId: z.string(),
  scope: z.string(),
  deliverableType: handoverDeliverableTypeSchema,
  responseMethod: handoverResponseMethodSchema,
  deliverableName: z.string(),
  owner: z.string(),
  dueDate: z.string(),
  status: handoverTaskStatusSchema,
  dependencyNotes: z.string(),
  acceptanceCriteria: z.string(),
  sourceIds: z.array(z.string()).default([]),
  responseText: z.string(),
  responsePath: z.string(),
  responseSourceIds: z.array(z.string()).default([]),
});

export const handoverConfigSchema = z.object({
  awardSourceIds: z.array(z.string()).default([]),
  selectedAwardSourceIds: z.array(z.string()).default([]),
  awardNotes: z.string().default(""),
  checklistNumber: z.string().default(""),
  projectNumber: z.string().default(""),
  temporaryChanges: z.string().default(""),
  departments: z.array(handoverDepartmentSchema).default([]),
  excludedBidSourceIds: z.array(z.string()).default([]),
  tasks: z.array(handoverTaskSchema).default([]),
  lastSplitAt: z.string().default(""),
  lastSplitProvider: z.enum(["local", "cloud", "codex"]).optional(),
  lastSplitModel: z.string().default(""),
});

export const projectManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  customerAlias: z.string(),
  industry: z.string(),
  owner: z.string(),
  stage: projectStageSchema,
  locale: localeSchema,
  localPathHint: z.string(),
  generalTemplates: generalTemplatesSchema.default({ docxSourceId: "", xlsxSourceId: "", pptxSourceId: "" }),
  budget: z.string(),
  deadline: z.string(),
  objective: z.string(),
  constraints: z.string(),
  confirmedTextFields: z.array(z.string()).default([]),
  updatedAt: z.string(),
  sources: z.array(sourceDocumentSchema),
  requirements: z.array(requirementSchema),
  evidence: z.array(evidenceRefSchema),
  actions: z.array(actionItemSchema),
  deliverables: z.array(deliverableSchema),
  sections: z.array(solutionSectionSchema),
  pocPlan: pocPlanSchema,
  enterpriseContext: enterpriseContextSchema.default({ companyName: "", platform: "", importedAt: "", notes: "", sourceIds: [] }),
  presalesRounds: z.array(presalesRoundSchema).default([]),
  tenderSourceIds: z.array(z.string()).default([]),
  selectedTenderSourceIds: z.array(z.string()).default([]),
  tenderClarificationRounds: z.array(tenderClarificationRoundSchema).default([]),
  tenderAnalysis: tenderAnalysisConfigSchema.default({ keywords: [], analysisRequirements: "", templateSourceIds: [], selectedTemplateSourceIds: [], results: [] }),
  tenderComparison: tenderComparisonConfigSchema.default({ selectedPresalesSourceIds: [], templateSourceIds: [], selectedTemplateSourceIds: [], results: [] }),
  bidFileChecklist: z.array(bidFileChecklistItemSchema).default([]),
  handover: handoverConfigSchema.default({
    awardSourceIds: [],
    selectedAwardSourceIds: [],
    awardNotes: "",
    checklistNumber: "",
    projectNumber: "",
    temporaryChanges: "",
    departments: [],
    excludedBidSourceIds: [],
    tasks: [],
    lastSplitAt: "",
    lastSplitModel: "",
  }),
  handoverNotes: z.string(),
});

export const workspaceManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  activeProjectId: z.string(),
  projects: z.array(z.object({ id: z.string(), name: z.string(), updatedAt: z.string() })),
});

export const outputManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  projectId: z.string(),
  generatedAt: z.string(),
  includesSources: z.boolean(),
  files: z.array(z.object({ name: z.string(), sha256: z.string(), bytes: z.number().nonnegative() })),
});

export type Locale = z.infer<typeof localeSchema>;
export type ProjectStage = z.infer<typeof projectStageSchema>;
export type Baseline = z.infer<typeof baselineSchema>;
export type RequirementCategory = z.infer<typeof requirementCategorySchema>;
export type ResponseStatus = z.infer<typeof responseStatusSchema>;
export type DeviationType = z.infer<typeof deviationTypeSchema>;
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type SourceSegment = z.infer<typeof sourceSegmentSchema>;
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type Deliverable = z.infer<typeof deliverableSchema>;
export type SolutionSection = z.infer<typeof solutionSectionSchema>;
export type EnterpriseContext = z.infer<typeof enterpriseContextSchema>;
export type PresalesRoundAction = z.infer<typeof presalesRoundActionSchema>;
export type PresalesGeneratedFile = z.infer<typeof presalesGeneratedFileSchema>;
export type PresalesAnalysisResult = z.infer<typeof presalesAnalysisResultSchema>;
export type PresalesParticipant = z.infer<typeof presalesParticipantSchema>;
export type PresalesRound = z.infer<typeof presalesRoundSchema>;
export type PreprocessStatus = z.infer<typeof preprocessStatusSchema>;
export type GeneralTemplateFormat = z.infer<typeof generalTemplateFormatSchema>;
export type GeneralTemplates = z.infer<typeof generalTemplatesSchema>;
export type TenderOutputFormat = z.infer<typeof tenderOutputFormatSchema>;
export type TenderClarificationRound = z.infer<typeof tenderClarificationRoundSchema>;
export type TenderAnalysisResult = z.infer<typeof tenderAnalysisResultSchema>;
export type TenderAnalysisConfig = z.infer<typeof tenderAnalysisConfigSchema>;
export type TenderComparisonConfig = z.infer<typeof tenderComparisonConfigSchema>;
export type BidGeneratedFile = z.infer<typeof bidGeneratedFileSchema>;
export type BidFileChecklistItem = z.infer<typeof bidFileChecklistItemSchema>;
export type HandoverDeliverableType = z.infer<typeof handoverDeliverableTypeSchema>;
export type HandoverResponseMethod = z.infer<typeof handoverResponseMethodSchema>;
export type HandoverTaskStatus = z.infer<typeof handoverTaskStatusSchema>;
export type HandoverDepartment = z.infer<typeof handoverDepartmentSchema>;
export type HandoverTask = z.infer<typeof handoverTaskSchema>;
export type HandoverConfig = z.infer<typeof handoverConfigSchema>;
export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;
export type OutputManifest = z.infer<typeof outputManifestSchema>;

export function createId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

function toChineseInteger(value: number): string {
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

export function createPresalesRound(locale: Locale = "zh", index = 1): PresalesRound {
  return {
    id: createId("round"),
    title: locale === "zh" ? `第${toChineseInteger(index)}次沟通` : `Communication ${index}`,
    meetingAt: "",
    participants: [],
    customerNeeds: "",
    requirementSourceIds: [],
    selectedRequirementSourceIds: [],
    keywords: [],
    analysisRequirements: "",
    templateSourceIds: [],
    selectedTemplateSourceIds: [],
    analysisResults: [],
    actions: [],
    referenceSourceIds: [],
    generationInstructions: "",
    outputName: locale === "zh" ? `第${index}次沟通响应文件` : `communication-${index}-response`,
    outputFormat: "docx",
    generatedFiles: [],
  };
}

export function createEmptyProject(locale: Locale = "zh"): ProjectManifest {
  const updatedAt = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `solution-${updatedAt.slice(0, 10)}`,
    name: locale === "zh" ? "新建解决方案项目" : "New solution project",
    customerAlias: "",
    industry: "",
    owner: "",
    stage: "presales",
    locale,
    localPathHint: "",
    generalTemplates: { docxSourceId: "", xlsxSourceId: "", pptxSourceId: "" },
    budget: "",
    deadline: "",
    objective: "",
    constraints: "",
    confirmedTextFields: [],
    updatedAt,
    sources: [],
    requirements: [],
    evidence: [],
    actions: [],
    deliverables: [
      { id: createId("deliverable"), stage: "presales", kind: "product-intro", title: locale === "zh" ? "产品介绍" : "Product introduction", status: "not-started", owner: "", dueDate: "", sourceIds: [], notes: "" },
      { id: createId("deliverable"), stage: "presales", kind: "preliminary-solution", title: locale === "zh" ? "初步方案" : "Preliminary solution", status: "not-started", owner: "", dueDate: "", sourceIds: [], notes: "" },
      { id: createId("deliverable"), stage: "presales", kind: "discovery-record", title: locale === "zh" ? "需求调研文件" : "Discovery record", status: "not-started", owner: "", dueDate: "", sourceIds: [], notes: "" },
    ],
    sections: [],
    pocPlan: { objective: "", demoScope: "", acceptance: "", failureAndFallback: "" },
    enterpriseContext: { companyName: "", platform: "", importedAt: "", notes: "", sourceIds: [] },
    presalesRounds: [],
    tenderSourceIds: [],
    selectedTenderSourceIds: [],
    tenderClarificationRounds: [],
    tenderAnalysis: { keywords: [], analysisRequirements: "", templateSourceIds: [], selectedTemplateSourceIds: [], results: [] },
    tenderComparison: { selectedPresalesSourceIds: [], templateSourceIds: [], selectedTemplateSourceIds: [], results: [] },
    bidFileChecklist: [],
    handover: {
      awardSourceIds: [],
      selectedAwardSourceIds: [],
      awardNotes: "",
      checklistNumber: "",
      projectNumber: "",
      temporaryChanges: "",
      departments: [],
      excludedBidSourceIds: [],
      tasks: [],
      lastSplitAt: "",
      lastSplitModel: "",
    },
    handoverNotes: "",
  };
}

export function isLegacyUntouchedPresalesRound(round: PresalesRound): boolean {
  const defaultTitle = round.title === "第一次沟通" || round.title === "第 1 次沟通" || round.title === "Communication 1";
  const defaultOutputName = !round.outputName || round.outputName === "第1次沟通响应文件" || round.outputName === "communication-1-response";
  return defaultTitle
    && !round.meetingAt
    && round.participants.length === 0
    && !round.customerNeeds
    && round.requirementSourceIds.length === 0
    && (round.selectedRequirementSourceIds?.length ?? 0) === 0
    && round.keywords.length === 0
    && !round.analysisRequirements
    && round.templateSourceIds.length === 0
    && round.selectedTemplateSourceIds.length === 0
    && !round.analysisOutputFormat
    && round.analysisResults.length === 0
    && round.actions.length === 0
    && round.referenceSourceIds.length === 0
    && !round.generationInstructions
    && defaultOutputName
    && round.outputFormat === "docx"
    && round.generatedFiles.length === 0;
}
