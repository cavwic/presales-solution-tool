import type { ProjectManifest } from "./workspace-schema";

export type HistoryDirection = "undo" | "redo";

export class WorkspaceHistory {
  private readonly undoStack: ProjectManifest[] = [];
  private readonly redoStack: ProjectManifest[] = [];
  private lastGroup = "";
  private lastRecordedAt = 0;

  constructor(
    private readonly limit = 3,
    private readonly mergeWindowMs = 900,
  ) {}

  record(previous: ProjectManifest, group = "", recordedAt = Date.now()) {
    const mergeWithPrevious = Boolean(
      group
      && group === this.lastGroup
      && recordedAt - this.lastRecordedAt <= this.mergeWindowMs,
    );
    if (!mergeWithPrevious) {
      this.undoStack.push(previous);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.lastGroup = group;
    this.lastRecordedAt = recordedAt;
  }

  peek(direction: HistoryDirection) {
    const stack = direction === "undo" ? this.undoStack : this.redoStack;
    return stack.at(-1) || null;
  }

  apply(direction: HistoryDirection, current: ProjectManifest) {
    const source = direction === "undo" ? this.undoStack : this.redoStack;
    const destination = direction === "undo" ? this.redoStack : this.undoStack;
    const target = source.pop();
    if (!target) return null;
    destination.push(current);
    if (destination.length > this.limit) destination.shift();
    this.lastGroup = "";
    this.lastRecordedAt = 0;
    return target;
  }

  reset() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lastGroup = "";
    this.lastRecordedAt = 0;
  }

  get state() {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }
}
