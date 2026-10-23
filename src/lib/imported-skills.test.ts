import { describe, expect, it } from "vitest";
import { buildImportedSkillContext, IMPORTED_SKILL_CONTEXT_LIMITS, type ImportedSkillDetail } from "./imported-skills";

const skill = (id: string, enabled = true): ImportedSkillDetail => ({
  id, name: id, description: "Synthetic guidance", enabled, importedAt: "2026-10-23T00:00:00Z", source: { kind: "file", label: "synthetic.md" }, fileCount: 2, referenceCount: 1, ignoredFileCount: 0, executionMode: "prompt-context", limitations: ["scripts-not-executed", "binary-assets-not-loaded", "context-size-limited"], skillText: "Use verified project facts.", references: [{ path: "references/example.md", text: "Synthetic reference." }],
});

describe("shared imported skill context", () => {
  it("adds only enabled guidance and references with clear authority boundaries", () => {
    const result = buildImportedSkillContext([skill("enabled"), skill("disabled", false)], "zh");
    expect(result.skillIds).toEqual(["enabled"]);
    expect(result.text).toContain("项目事实、已选资料和任务要求优先");
    expect(result.text).toContain("Synthetic reference.");
    expect(result.text).not.toContain('name="disabled"');
    expect(result.truncated).toBe(false);
    expect(buildImportedSkillContext([skill("disabled", false)]).text).toBe("");
  });

  it("caps every section and the total context while retaining complete ending delimiters", () => {
    const first = skill("first"), second = skill("second"), third = skill("third");
    for (const item of [first, second, third]) {
      item.skillText = "S".repeat(25000);
      item.references[0].text = "R".repeat(10000);
    }
    const result = buildImportedSkillContext([first, second, third], "en");
    expect(result.text.length).toBeLessThanOrEqual(IMPORTED_SKILL_CONTEXT_LIMITS.maxContextCharacters);
    expect(result.text.match(/<imported-skill /g)?.length).toBe(result.text.match(/<\/imported-skill>/g)?.length);
    expect(result.text.match(/<skill-reference /g)?.length).toBe(result.text.match(/<\/skill-reference>/g)?.length);
    expect(result.text).not.toContain("R".repeat(4001));
    expect(result.text).not.toContain("S".repeat(16001));
    expect(result.truncated).toBe(true);
    expect(result.skillIds).not.toContain("third");
  });
});
