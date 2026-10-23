import { describe, expect, it } from "vitest";
import { createEmptyProject, type ProjectManifest } from "./workspace-schema";
import { WorkspaceHistory } from "./workspace-history";

function namedProject(name: string): ProjectManifest {
  return { ...createEmptyProject("zh"), name };
}

describe("workspace history", () => {
  it("keeps only the latest three undo states and restores them in order", () => {
    const history = new WorkspaceHistory(3);
    const states = ["A", "B", "C", "D", "E"].map(namedProject);
    for (let index = 1; index < states.length; index += 1) history.record(states[index - 1]);

    expect(history.apply("undo", states[4])?.name).toBe("D");
    expect(history.apply("undo", states[3])?.name).toBe("C");
    expect(history.apply("undo", states[2])?.name).toBe("B");
    expect(history.apply("undo", states[1])).toBeNull();
  });

  it("coalesces a continuous text edit and clears redo after a new change", () => {
    const history = new WorkspaceHistory(3, 900);
    const empty = namedProject("项目");
    const first = namedProject("项");
    const second = namedProject("项目A");
    history.record(empty, "project:name", 1000);
    history.record(first, "project:name", 1500);

    expect(history.state.undoCount).toBe(1);
    expect(history.apply("undo", second)?.name).toBe("项目");
    expect(history.state.canRedo).toBe(true);

    history.record(empty, "project:industry", 3000);
    expect(history.state.canRedo).toBe(false);
  });
});
