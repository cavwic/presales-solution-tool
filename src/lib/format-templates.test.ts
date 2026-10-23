import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Document, Footer, Header, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { createFormatOnlyTemplateSource, resolveFormatTemplateSources } from "./format-templates";
import { createGeneratedFile } from "./presales-generation";
import { createTenderGeneratedFile } from "./tender-generation";
import { createEmptyProject } from "./workspace-schema";

describe("format-only templates", () => {
  it("keeps DOCX package formatting while replacing every template body paragraph", async () => {
    const templateBlob = await Packer.toBlob(new Document({ sections: [{
      headers: { default: new Header({ children: [new Paragraph("HEADER FORMAT MARKER")] }) },
      footers: { default: new Footer({ children: [new Paragraph("FOOTER FORMAT MARKER")] }) },
      children: [new Paragraph({ children: [new TextRun({ text: "TEMPLATE BODY MUST NOT LEAK", color: "CC0000" })] })],
    }] }));
    const template = new File([templateBlob], "company-template.docx", { type: templateBlob.type });
    const generated = await createGeneratedFile("# Generated title\n\nGenerated factual body", "result", "docx", template);
    const zip = await JSZip.loadAsync(await generated.blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const headerXml = await zip.file("word/header1.xml")?.async("string");
    const footerXml = await zip.file("word/footer1.xml")?.async("string");
    expect(documentXml).toContain("Generated factual body");
    expect(documentXml).not.toContain("TEMPLATE BODY MUST NOT LEAK");
    expect(headerXml).toContain("HEADER FORMAT MARKER");
    expect(footerXml).toContain("FOOTER FORMAT MARKER");
  });

  it("keeps XLSX dimensions and cell styling without retaining template values", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("TEMPLATE SECRET SHEET");
    sheet.getColumn(1).width = 31;
    sheet.getColumn(2).width = 72;
    sheet.getRow(2).height = 29;
    sheet.getCell("A1").value = "TEMPLATE HEADER SECRET";
    sheet.getCell("A2").value = "TEMPLATE DATA SECRET";
    sheet.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
    const template = new File([await workbook.xlsx.writeBuffer()], "company-template.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const generated = await createTenderGeneratedFile("# Generated section\nGenerated spreadsheet content", "result", "xlsx", template);
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await generated.blob.arrayBuffer());
    const outputSheet = output.worksheets[0];
    const values: string[] = [];
    outputSheet.eachRow({ includeEmpty: false }, (row) => row.eachCell((cell) => values.push(String(cell.value || ""))));
    expect(outputSheet.name).toBe("分析结果");
    expect(outputSheet.getColumn(1).width).toBe(31);
    expect(outputSheet.getRow(2).height).toBe(29);
    expect(outputSheet.getCell("B2").fill).toMatchObject({ type: "pattern", pattern: "solid" });
    expect(values.join(" ")).toContain("Generated spreadsheet content");
    expect(values.join(" ")).not.toContain("TEMPLATE");
  });

  it("uses PPTX master assets without copying normal template slides", async () => {
    const templateDeck = new PptxGenJS();
    templateDeck.layout = "LAYOUT_WIDE";
    const templateSlide = templateDeck.addSlide();
    templateSlide.addText("TEMPLATE SLIDE CONTENT MUST NOT LEAK", { x: 1, y: 1, w: 8, h: 1 });
    const template = new File([await templateDeck.write({ outputType: "arraybuffer" }) as ArrayBuffer], "company-template.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const generated = await createGeneratedFile("# Generated title\nGenerated presentation body", "result", "pptx", template);
    const zip = await JSZip.loadAsync(await generated.blob.arrayBuffer());
    const slidePaths = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path));
    const slides = (await Promise.all(slidePaths.map((path) => zip.file(path)?.async("string")))).join("\n");
    expect(slides).toContain("Generated presentation body");
    expect(slides).not.toContain("TEMPLATE SLIDE CONTENT MUST NOT LEAK");
    expect(Object.keys(zip.files).some((path) => path.startsWith("ppt/slideMasters/"))).toBe(true);
  });

  it("stores format templates without parsed content segments", async () => {
    const file = new File(["template text must stay isolated"], "template.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const source = await createFormatOnlyTemplateSource(file, "docx");
    expect(source.segments).toEqual([]);
    expect(source.preprocessMessage).toContain("Format-only");
  });

  it("prefers a matching module template and falls back to the matching general template", () => {
    const project = createEmptyProject("zh");
    const general = { id: "general-docx", name: "general.docx", fileType: "docx" as const, version: "1.0", size: 1, sha256: "general", importedAt: "2026-08-23", workspacePath: "", requiresOcr: false, preprocessStatus: "ready" as const, preprocessedAt: "", preprocessMessage: "", segments: [] };
    const specific = { ...general, id: "specific-docx", name: "specific.docx", sha256: "specific" };
    project.sources.push(general, specific);
    project.generalTemplates.docxSourceId = general.id;
    expect(resolveFormatTemplateSources(project, "docx", [])).toEqual([general]);
    expect(resolveFormatTemplateSources(project, "docx", [specific.id])).toEqual([specific]);
    expect(resolveFormatTemplateSources(project, "pptx", [])).toEqual([]);
  });
});
