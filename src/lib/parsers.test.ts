import { describe, expect, it } from "vitest";
import { projectToDocx, projectToPptx, projectToXlsx } from "./exporters";
import { hasReadableSourceText, parsePlainText, parseSourceFile, sha256 } from "./parsers";
import { createSampleProject } from "./workflow";

function minimalPdf(text: string): ArrayBuffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const bytes = new TextEncoder().encode(body);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("source parsers", () => {
  it("keeps line locators for plain text", () => {
    const segments = parsePlainText("第一条要求\n\n第二条要求", "source-a");
    expect(segments.map((item) => item.locator)).toEqual(["第 1 行", "第 3 行"]);
    expect(segments[1].text).toBe("第二条要求");
  });

  it("calculates stable SHA-256 hashes", async () => {
    const bytes = new TextEncoder().encode("solution-workbench");
    expect(await sha256(bytes)).toBe(await sha256(bytes));
    expect(await sha256(bytes)).toHaveLength(64);
  });

  it.each([
    ["notes.md", "Markdown requirement"],
    ["notes.txt", "Text requirement"],
    ["notes.csv", "id,requirement\n1,CSV requirement"],
    ["project.json", "{\"customerAlias\":\"Customer A\"}"],
  ])("parses %s with line-level traceability", async (name, contents) => {
    const result = await parseSourceFile(new File([contents], name));
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0].locatorKind).toBe("line");
    expect(result.sha256).toHaveLength(64);
  });

  it("parses selectable PDF text and identifies the page", async () => {
    const file = new File([minimalPdf("Tender requirement traceability test content")], "tender.pdf", { type: "application/pdf" });
    const result = await parseSourceFile(file);
    expect(result.requiresOcr).toBe(false);
    expect(result.segments[0].locator).toBe("第 1 页");
    expect(result.segments[0].text).toContain("traceability");
  });

  it("separates readable tender text from image sources that require OCR", async () => {
    const text = await parseSourceFile(new File(["投标人应提交部署方案、验收方案和项目进度计划，并在投标文件中标明来源。"], "tender.txt", { type: "text/plain" }));
    const image = await parseSourceFile(new File([new Uint8Array([137, 80, 78, 71])], "scan.png", { type: "image/png" }));
    expect(hasReadableSourceText(text)).toBe(true);
    expect(image.requiresOcr).toBe(true);
    expect(image.segments).toHaveLength(0);
    expect(hasReadableSourceText(image)).toBe(false);
  });

  it("round-trips generated DOCX, XLSX, and PPTX into precise source locators", async () => {
    const project = createSampleProject();
    const files = [
      new File([await projectToDocx(project)], "proposal.docx"),
      new File([await projectToXlsx(project)], "matrix.xlsx"),
      new File([await projectToPptx(project)], "presentation.pptx"),
    ];
    const parsed = await Promise.all(files.map(parseSourceFile));
    expect(parsed[0].segments.some((segment) => segment.locatorKind === "paragraph" || segment.locatorKind === "table-cell")).toBe(true);
    expect(parsed[1].segments.some((segment) => segment.locatorKind === "sheet-cell" && segment.locator.includes("!"))).toBe(true);
    expect(parsed[2].segments.some((segment) => segment.locatorKind === "slide" && segment.locator === "第 1 页")).toBe(true);
  }, 30_000);
});
