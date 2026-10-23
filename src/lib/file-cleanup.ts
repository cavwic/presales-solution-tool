import type { ProjectManifest } from "./workspace-schema";
import { bidItemDirectory, presalesRoundDirectory, WORKSPACE_MODULE_DIRECTORIES } from "./workspace-storage";

export type GeneratedCleanupCandidate = {
  id: string;
  name: string;
  relativePath: string;
  sourceId: string;
  sourceIds: string[];
  recordIds: string[];
  bytes: number;
  scope: "project" | "local";
  stage: "presales" | "tender" | "bid";
};

export type GeneratedCleanupBlocked = { name: string; relativePath: string; recordIds: string[]; reason: "invalid-path" | "missing-source" | "shared-source" | "shared-path" | "content-conflict" | "referenced-record" };
export type GeneratedCleanupCatalog = { candidates: GeneratedCleanupCandidate[]; blocked: GeneratedCleanupBlocked[] };
export type CleanupFingerprint = { size: number; sha256: string };
export type GeneratedCleanupPreviewItem = GeneratedCleanupCandidate & {
  exists: boolean;
  fingerprint: CleanupFingerprint | null;
  error?: string;
};
export type GeneratedCleanupPreview = { projectId: string; candidates: GeneratedCleanupPreviewItem[]; blocked: GeneratedCleanupBlocked[] };
export type GeneratedCleanupIO = {
  /** Return null only when absent; permission and read errors must reject. */
  readFile(candidate: GeneratedCleanupCandidate): Promise<Blob | null>;
  /** Project files go to the recycle bin; local download copies are never passed here. */
  trashFile(candidate: GeneratedCleanupCandidate, expectedFingerprint: CleanupFingerprint): Promise<void>;
};
export type GeneratedCleanupResult = { id: string; status: "cleaned" | "missing" | "changed" | "blocked" | "failed"; error?: string };

type GeneratedRecord = { id: string; sourceId: string; relativePath: string; name: string };
type RecordEntry = { record: GeneratedRecord; directory: string; stage: GeneratedCleanupCandidate["stage"] };

function generatedEntries(project: ProjectManifest): RecordEntry[] {
  return [
    ...project.presalesRounds.flatMap((round, index) => [
      ...round.analysisResults.map((record) => ({ record: { ...record, name: record.fileName }, directory: `${presalesRoundDirectory(index)}/需求分析`, stage: "presales" as const })),
      ...round.generatedFiles.map((record) => ({ record, directory: `${presalesRoundDirectory(index)}/生成文件`, stage: "presales" as const })),
    ]),
    ...project.tenderAnalysis.results.map((record) => ({ record: { ...record, name: record.fileName }, directory: `${WORKSPACE_MODULE_DIRECTORIES.tenderAnalysis}/生成文件`, stage: "tender" as const })),
    ...project.tenderComparison.results.map((record) => ({ record: { ...record, name: record.fileName }, directory: `${WORKSPACE_MODULE_DIRECTORIES.tenderComparison}/生成文件`, stage: "tender" as const })),
    ...project.bidFileChecklist.flatMap((item) => item.generatedFiles.map((record) => ({ record, directory: `${bidItemDirectory(item.title)}/生成文件`, stage: "bid" as const }))),
  ];
}

/** Deliberately reject alternate spellings rather than resolving untrusted paths. */
function safeRelativePath(value: string): string | null {
  if (!value || value.includes("\\") || /[\u0000-\u001f:*?"<>|]/.test(value)) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))) return null;
  return value;
}

function pathKey(value: string): string { return value.toLocaleLowerCase("en-US"); }

function sourcePathKey(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (part === "." || !part) continue;
    if (part === "..") parts.pop();
    else parts.push(part.replace(/[. ]+$/, ""));
  }
  return pathKey(parts.join("/"));
}

/** Any use other than being an output owner protects the underlying source. */
function protectedSourceIds(project: ProjectManifest): Set<string> {
  const ids = new Set<string>();
  const add = (...values: Array<string | undefined>) => values.forEach((value) => { if (value) ids.add(value); });
  add(...Object.values(project.generalTemplates), ...project.enterpriseContext.sourceIds,
    ...project.tenderSourceIds, ...project.selectedTenderSourceIds,
    ...project.tenderAnalysis.templateSourceIds, ...project.tenderAnalysis.selectedTemplateSourceIds,
    ...project.tenderComparison.selectedPresalesSourceIds, ...project.tenderComparison.templateSourceIds,
    ...project.tenderComparison.selectedTemplateSourceIds, ...project.handover.awardSourceIds,
    ...project.handover.selectedAwardSourceIds, ...project.handover.excludedBidSourceIds);
  project.tenderClarificationRounds.forEach((round) => add(...round.sourceIds, ...round.selectedSourceIds));
  [...project.tenderAnalysis.results, ...project.tenderComparison.results].forEach((result) => add(...result.sourceIds, ...result.templateSourceIds));
  project.presalesRounds.forEach((round) => {
    add(...round.requirementSourceIds, ...(round.selectedRequirementSourceIds || []), ...round.referenceSourceIds,
      ...round.templateSourceIds, ...round.selectedTemplateSourceIds);
    round.actions.forEach((action) => add(...action.templateSourceIds, ...action.selectedTemplateSourceIds));
    round.analysisResults.forEach((result) => add(...result.sourceIds, ...result.templateSourceIds));
  });
  project.bidFileChecklist.forEach((item) => {
    add(...item.templateSourceIds, ...item.selectedTemplateSourceIds, ...item.referenceSourceIds, ...item.selectedReferenceSourceIds);
    item.generatedFiles.forEach((record) => add(...record.referenceSourceIds, ...record.templateSourceIds));
  });
  project.handover.tasks.forEach((task) => add(...task.sourceIds, ...task.responseSourceIds));
  project.requirements.forEach((requirement) => add(requirement.sourceRef?.documentId));
  project.evidence.forEach((evidence) => add(evidence.sourceRef?.documentId));
  project.deliverables.forEach((deliverable) => add(...deliverable.sourceIds));
  return ids;
}

export function collectGeneratedCleanupCatalog(project: ProjectManifest): GeneratedCleanupCatalog {
  const entries = generatedEntries(project);
  const protectedIds = protectedSourceIds(project);
  const sources = new Map(project.sources.map((source) => [source.id, source]));
  const responsePaths = new Set(project.handover.tasks.map((task) => task.responsePath).filter(Boolean).map(sourcePathKey));
  const referencedRecordIds = new Set(project.bidFileChecklist.map((item) => item.sourceResultId).filter(Boolean));
  const groups = new Map<string, RecordEntry[]>();
  const blocked: GeneratedCleanupBlocked[] = [];
  for (const entry of entries) {
    const { record } = entry;
    const path = safeRelativePath(record.relativePath);
    const pathParts = path?.split("/");
    const parent = pathParts?.slice(0, -1).join("/");
    if (!path || (parent !== entry.directory && parent !== "downloads") || pathParts?.at(-1) !== record.name) {
      blocked.push({ name: record.name, relativePath: record.relativePath, recordIds: [record.id], reason: "invalid-path" });
      continue;
    }
    const key = pathKey(path);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const candidates: GeneratedCleanupCandidate[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const recordIds = [...new Set(group.map(({ record }) => record.id))];
    const sourceIds = [...new Set(group.map(({ record }) => record.sourceId))];
    const path = first.record.relativePath;
    const scope = path.startsWith("downloads/") ? "local" as const : "project" as const;
    const outputSources = sourceIds.map((id) => sources.get(id));
    let reason: GeneratedCleanupBlocked["reason"] | null = null;
    if (outputSources.some((source) => !source)) reason = "missing-source";
    else if (recordIds.some((id) => referencedRecordIds.has(id))) reason = "referenced-record";
    else if (sourceIds.some((id) => protectedIds.has(id))) reason = "shared-source";
    else if (outputSources.some((source) => source!.workspacePath && sourcePathKey(source!.workspacePath) !== key)) reason = "shared-path";
    // A second source alias may be an imported material, even when its path is an output path.
    else if (scope === "project" && project.sources.some((source) => source.workspacePath && sourcePathKey(source.workspacePath) === key && !sourceIds.includes(source.id))) reason = "shared-path";
    else if (scope === "project" && responsePaths.has(key)) reason = "shared-path";
    // The same source cannot be removed while another output record still owns it elsewhere.
    else if (entries.some(({ record }) => sourceIds.includes(record.sourceId) && pathKey(record.relativePath) !== key)) reason = "shared-source";
    else if (entries.some(({ record }) => recordIds.includes(record.id) && pathKey(record.relativePath) !== key)) reason = "content-conflict";
    else if (new Set(outputSources.map((source) => `${source!.sha256.toLowerCase()}:${source!.size}`)).size > 1) reason = "content-conflict";
    if (reason) {
      blocked.push({ name: first.record.name, relativePath: path, recordIds, reason });
      continue;
    }
    candidates.push({
      id: `${scope}:${key}`, name: first.record.name, relativePath: path,
      sourceId: sourceIds[0], sourceIds, recordIds, bytes: outputSources[0]!.size,
      scope, stage: first.stage,
    });
  }
  return { candidates, blocked };
}

export function collectGeneratedCleanupCandidates(project: ProjectManifest): GeneratedCleanupCandidate[] {
  return collectGeneratedCleanupCatalog(project).candidates;
}

export function pruneGeneratedCleanup(project: ProjectManifest, successfulCandidateIds: Iterable<string>): { project: ProjectManifest; sourceIds: string[]; recordIds: string[] } {
  const selected = new Set(successfulCandidateIds);
  const candidates = collectGeneratedCleanupCandidates(project).filter((candidate) => selected.has(candidate.id));
  const recordIds = [...new Set(candidates.flatMap((candidate) => candidate.recordIds))];
  const sourceIds = [...new Set(candidates.flatMap((candidate) => candidate.sourceIds))];
  const removedSources = new Set(sourceIds);
  const retain = <T extends GeneratedRecord>(records: T[]) => records.filter((record) => !candidates.some((candidate) =>
    candidate.recordIds.includes(record.id) && candidate.sourceIds.includes(record.sourceId) && pathKey(record.relativePath) === pathKey(candidate.relativePath)));
  return {
    sourceIds, recordIds,
    project: {
      ...project,
      sources: project.sources.filter((source) => !removedSources.has(source.id)),
      presalesRounds: project.presalesRounds.map((round) => ({ ...round, analysisResults: retain(round.analysisResults), generatedFiles: retain(round.generatedFiles) })),
      tenderAnalysis: { ...project.tenderAnalysis, results: retain(project.tenderAnalysis.results) },
      tenderComparison: { ...project.tenderComparison, results: retain(project.tenderComparison.results) },
      bidFileChecklist: project.bidFileChecklist.map((item) => ({ ...item, generatedFiles: retain(item.generatedFiles) })),
    },
  };
}

function absent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (("name" in error && error.name === "NotFoundError") || ("code" in error && error.code === "ENOENT")));
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export async function fingerprintCleanupFile(file: Blob): Promise<CleanupFingerprint> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return { size: file.size, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

function sameFingerprint(left: CleanupFingerprint | null, right: CleanupFingerprint | null): boolean {
  return left === right || Boolean(left && right && left.size === right.size && left.sha256 === right.sha256);
}

async function inspect(candidate: GeneratedCleanupCandidate, readFile: GeneratedCleanupIO["readFile"]): Promise<GeneratedCleanupPreviewItem> {
  try {
    const file = await readFile(candidate);
    return { ...candidate, exists: Boolean(file), fingerprint: file ? await fingerprintCleanupFile(file) : null };
  } catch (error) {
    return { ...candidate, exists: false, fingerprint: null, ...(absent(error) ? {} : { error: message(error) }) };
  }
}

function matchesRecordedContent(project: ProjectManifest, item: GeneratedCleanupPreviewItem): boolean {
  if (!item.fingerprint) return true;
  return item.sourceIds.every((sourceId) => {
    const source = project.sources.find((entry) => entry.id === sourceId);
    if (!source) return false;
    // Old manifests may not have a standard digest; their preview is still checked at execution.
    return source.size === item.fingerprint!.size && (!/^[a-f0-9]{64}$/i.test(source.sha256) || source.sha256.toLowerCase() === item.fingerprint!.sha256);
  });
}

export async function previewGeneratedCleanup(project: ProjectManifest, io: Pick<GeneratedCleanupIO, "readFile">): Promise<GeneratedCleanupPreview> {
  const catalog = collectGeneratedCleanupCatalog(project);
  const candidates: GeneratedCleanupPreviewItem[] = [];
  for (const candidate of catalog.candidates) {
    const item = await inspect(candidate, io.readFile);
    if (!item.error && !matchesRecordedContent(project, item)) item.error = "GENERATED_FILE_CHANGED";
    candidates.push(item);
  }
  return { projectId: project.id, candidates, blocked: catalog.blocked };
}

export async function executeGeneratedCleanup(project: ProjectManifest, preview: GeneratedCleanupPreview, selectedIds: Iterable<string>, io: GeneratedCleanupIO): Promise<ReturnType<typeof pruneGeneratedCleanup> & { results: GeneratedCleanupResult[] }> {
  const selected = new Set(selectedIds);
  const current = new Map(collectGeneratedCleanupCandidates(project).map((item) => [item.id, item]));
  const previews = new Map(preview.candidates.map((item) => [item.id, item]));
  const results: GeneratedCleanupResult[] = [];
  const successful: string[] = [];
  for (const id of selected) {
    const candidate = current.get(id);
    const before = previews.get(id);
    if (preview.projectId !== project.id || !candidate || !before || before.error
      || JSON.stringify(candidate.recordIds) !== JSON.stringify(before.recordIds)
      || JSON.stringify(candidate.sourceIds) !== JSON.stringify(before.sourceIds)) {
      results.push({ id, status: "blocked" });
      continue;
    }
    const now = await inspect(candidate, io.readFile);
    if (now.error) { results.push({ id, status: "failed", error: now.error }); continue; }
    if (!matchesRecordedContent(project, now) || (now.exists && !sameFingerprint(before.fingerprint, now.fingerprint))) {
      results.push({ id, status: "changed" });
      continue;
    }
    try {
      if (candidate.scope === "project" && now.fingerprint) await io.trashFile(candidate, now.fingerprint);
      successful.push(id);
      results.push({ id, status: now.exists ? "cleaned" : "missing" });
    } catch (error) {
      // Absence is safe to detach; permissions or a recycle-bin failure preserve records.
      if (absent(error)) { successful.push(id); results.push({ id, status: "missing" }); }
      else results.push({ id, status: "failed", error: message(error) });
    }
  }
  return { ...pruneGeneratedCleanup(project, successful), results };
}
