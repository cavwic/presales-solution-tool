import type { SourceDocument, SourceSegment } from "./workspace-schema";
import { createId } from "./workspace-schema";

const supportedExtensions = ["pdf", "docx", "xlsx", "pptx", "md", "txt", "csv", "json", "png", "jpg", "jpeg", "webp"] as const;
type SupportedExtension = (typeof supportedExtensions)[number];

function extensionOf(name: string): SupportedExtension {
  const extension = name.split(".").pop()?.toLowerCase();
  if (!supportedExtensions.includes(extension as SupportedExtension)) {
    throw new Error(`Unsupported file type: ${extension || "unknown"}`);
  }
  return extension as SupportedExtension;
}

function normalizeText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\r/g, "").trim();
}

function xmlText(node: unknown): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(xmlText);
  if (!node || typeof node !== "object") return [];
  const values: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "w:t" || key === "a:t") values.push(...xmlText(value));
    else if (key !== ":@") values.push(...xmlText(value));
  }
  return values;
}

function findChildren(node: unknown, key: string): unknown[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((item) => findChildren(item, key));
  const record = node as Record<string, unknown>;
  const direct = record[key];
  const found = direct === undefined ? [] : Array.isArray(direct) ? direct : [direct];
  return [...found, ...Object.entries(record).filter(([entryKey]) => entryKey !== key && entryKey !== ":@").flatMap(([, value]) => findChildren(value, key))];
}

export async function sha256(input: ArrayBuffer | Uint8Array | Blob): Promise<string> {
  const bytes = input instanceof Blob
    ? new Uint8Array(await input.arrayBuffer())
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function parsePlainText(text: string, documentId: string): SourceSegment[] {
  return text.split(/\r?\n/).map(normalizeText).map((line, index) => ({
    id: `${documentId}-line-${index + 1}`,
    locatorKind: "line" as const,
    locator: `第 ${index + 1} 行`,
    text: line,
  })).filter((segment) => segment.text.length > 0);
}

export function hasReadableSourceText(source: Pick<SourceDocument, "requiresOcr" | "segments">): boolean {
  if (source.requiresOcr) return false;
  const text = source.segments.map((segment) => segment.text).join(" ").trim();
  if (text.length < 24) return false;
  const replacementCount = (text.match(/[�]/g) || []).length;
  const mojibakeCount = (text.match(/锟斤拷|ï¿½|Ã.|Â.|æ\w|ðŸ/g) || []).length;
  const readableCount = (text.match(/[\p{L}\p{N}\p{P}\p{Z}\u3400-\u9fff]/gu) || []).length;
  return replacementCount / text.length < 0.01
    && mojibakeCount < 2
    && readableCount / text.length >= 0.72;
}

async function parsePdf(buffer: ArrayBuffer, documentId: string): Promise<{ segments: SourceSegment[]; requiresOcr: boolean }> {
  const pdfjs = typeof window === "undefined"
    ? await import("pdfjs-dist/legacy/build/pdf.mjs")
    : await import("pdfjs-dist");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const segments: SourceSegment[] = [];
  let totalText = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = normalizeText(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    totalText += text.length;
    segments.push({ id: `${documentId}-page-${pageNumber}`, locatorKind: "page", locator: `第 ${pageNumber} 页`, text });
  }
  return { segments, requiresOcr: totalText < Math.max(24, pdf.numPages * 10) };
}

async function parseDocx(buffer: ArrayBuffer, documentId: string): Promise<SourceSegment[]> {
  const [{ default: JSZip }, { XMLParser }, { default: mammoth }] = await Promise.all([import("jszip"), import("fast-xml-parser"), import("mammoth")]);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) {
    const fallback = await mammoth.extractRawText({ arrayBuffer: buffer });
    return parsePlainText(fallback.value, documentId).map((segment, index) => ({ ...segment, id: `${documentId}-paragraph-${index + 1}`, locatorKind: "paragraph", locator: `段落 ${index + 1}` }));
  }
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: false });
  const document = parser.parse(xml);
  const segments: SourceSegment[] = [];
  const tableNodes = findChildren(document, "w:tbl");
  const tableParagraphs = new Set<string>();
  tableNodes.forEach((table, tableIndex) => {
    const rows = findChildren(table, "w:tr");
    rows.forEach((row, rowIndex) => {
      const cells = findChildren(row, "w:tc");
      cells.forEach((cell, cellIndex) => {
        const text = normalizeText(xmlText(cell).join(""));
        if (!text) return;
        tableParagraphs.add(text);
        segments.push({
          id: `${documentId}-table-${tableIndex + 1}-r${rowIndex + 1}-c${cellIndex + 1}`,
          locatorKind: "table-cell",
          locator: `表格 ${tableIndex + 1} / R${rowIndex + 1}C${cellIndex + 1}`,
          text,
        });
      });
    });
  });
  const paragraphs = findChildren(document, "w:p");
  let paragraphIndex = 0;
  for (const paragraph of paragraphs) {
    const text = normalizeText(xmlText(paragraph).join(""));
    if (!text || tableParagraphs.has(text)) continue;
    paragraphIndex += 1;
    segments.push({ id: `${documentId}-paragraph-${paragraphIndex}`, locatorKind: "paragraph", locator: `段落 ${paragraphIndex}`, text });
  }
  return segments;
}

async function parseXlsx(buffer: ArrayBuffer, documentId: string): Promise<SourceSegment[]> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const segments: SourceSegment[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = normalizeText(cell.text);
        if (!text) return;
        segments.push({
          id: `${documentId}-${sheet.id}-${cell.address}`,
          locatorKind: "sheet-cell",
          locator: `${sheet.name}!${cell.address}`,
          text,
        });
      });
    });
  });
  return segments;
}

async function parsePptx(buffer: ArrayBuffer, documentId: string): Promise<SourceSegment[]> {
  const [{ default: JSZip }, { XMLParser }] = await Promise.all([import("jszip"), import("fast-xml-parser")]);
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: false });
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => {
    const number = (value: string) => Number(value.match(/slide(\d+)\.xml/)?.[1] || 0);
    return number(a) - number(b);
  });
  const segments: SourceSegment[] = [];
  for (const [index, fileName] of slideFiles.entries()) {
    const xml = await zip.file(fileName)?.async("string");
    if (!xml) continue;
    const text = normalizeText(xmlText(parser.parse(xml)).join(" "));
    if (!text) continue;
    segments.push({ id: `${documentId}-slide-${index + 1}`, locatorKind: "slide", locator: `第 ${index + 1} 页`, text });
  }
  return segments;
}

export async function parseSourceFile(file: File): Promise<SourceDocument> {
  const extension = extensionOf(file.name);
  const buffer = await file.arrayBuffer();
  const digest = await sha256(buffer);
  const documentId = createId("source");
  let segments: SourceSegment[] = [];
  let requiresOcr = false;
  if (extension === "pdf") ({ segments, requiresOcr } = await parsePdf(buffer, documentId));
  else if (extension === "docx") segments = await parseDocx(buffer, documentId);
  else if (extension === "xlsx") segments = await parseXlsx(buffer, documentId);
  else if (extension === "pptx") segments = await parsePptx(buffer, documentId);
  else if (["png", "jpg", "jpeg", "webp"].includes(extension)) requiresOcr = true;
  else segments = parsePlainText(await file.text(), documentId);
  return {
    id: documentId,
    name: file.name,
    fileType: extension,
    version: "1.0",
    size: file.size,
    sha256: digest,
    importedAt: new Date().toISOString(),
    requiresOcr,
    preprocessStatus: "uploaded",
    preprocessedAt: "",
    preprocessMessage: "",
    workspacePath: "",
    segments,
  };
}
