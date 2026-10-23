import { z } from "zod";
import { getModelProvider, type ModelSettings, type ModelTask } from "./model-settings";

export const MODEL_ACTION_RETURN_STORAGE_KEY = "cavwic-lab-model-action-return";

const workspaceViewSchema = z.enum(["presales", "requirements", "bid", "handover", "outputs"]);

export const modelActionReturnStateSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  action: z.string().min(1),
  returnPath: z.string().startsWith("/"),
  view: workspaceViewSchema,
  anchorId: z.string(),
  scrollY: z.number().nonnegative(),
  selectedSourceId: z.string(),
  selectedRequirementId: z.string(),
  selectedActionIds: z.array(z.string()),
  expandedAnalysisId: z.string(),
  targetIds: z.array(z.string()).default([]),
  taskKind: z.enum(["workflow", "extract", "bid"]),
  savedAt: z.iso.datetime(),
});

export type ModelActionReturnState = z.infer<typeof modelActionReturnStateSchema>;
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;

export function hasBrowserCallableModel(settings: ModelSettings, task: ModelTask = "draft"): boolean {
  const provider = getModelProvider(settings, task);
  if (provider === "codex") return typeof window !== "undefined" && Boolean(window.bidDesktop?.modelChat);
  const endpoint = provider === "local" ? settings.localEndpoint : settings.cloudEndpoint;
  const model = provider === "local" ? settings.localModel : settings.cloudModel;
  return Boolean(endpoint.trim() && model.trim());
}

export function saveModelActionReturnState(state: ModelActionReturnState): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(MODEL_ACTION_RETURN_STORAGE_KEY, JSON.stringify(modelActionReturnStateSchema.parse(state)));
  } catch {
    // Navigation still proceeds when session storage is unavailable.
  }
}

export function readModelActionReturnState(): ModelActionReturnState | null {
  if (typeof sessionStorage === "undefined") return null;
  const stored = sessionStorage.getItem(MODEL_ACTION_RETURN_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = modelActionReturnStateSchema.safeParse(JSON.parse(stored));
    if (parsed.success) return parsed.data;
  } catch {
    // Invalid session data is discarded below.
  }
  sessionStorage.removeItem(MODEL_ACTION_RETURN_STORAGE_KEY);
  return null;
}

export function consumeModelActionReturnState(returnPath: string): ModelActionReturnState | null {
  const state = readModelActionReturnState();
  if (!state || state.returnPath !== returnPath) return null;
  sessionStorage.removeItem(MODEL_ACTION_RETURN_STORAGE_KEY);
  return state;
}
