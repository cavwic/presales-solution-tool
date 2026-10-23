import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOTICE_NAME = /^(?:licen[cs]e(?:[._-].*)?|notice(?:[._-].*)?|copying(?:[._-].*)?|third[._-]?party(?:[._-].*)?)$/i;
const LEGAL_TEXT = /copyright|@license|SPDX-License-Identifier|permission is hereby granted|licensed under|(?:^|\n)\s*MIT License/i;
const MAX_NOTICE_BYTES = 4 * 1024 * 1024;
const MAX_MODULE_BYTES = 16 * 1024 * 1024;
const DEFAULT_SUPPLEMENTS = fileURLToPath(new URL("./third-party-license-supplements/", import.meta.url));
const normalized = value => process.platform === "win32" ? value.toLowerCase() : value;
const digest = value => createHash("sha256").update(value).digest("hex");

function licenseOf(metadata) {
  if (typeof metadata.license === "string" && metadata.license.trim()) return metadata.license.trim();
  if (metadata.license && typeof metadata.license.type === "string") return metadata.license.type;
  if (Array.isArray(metadata.licenses)) {
    const values = metadata.licenses.map(item => typeof item === "string" ? item : item?.type).filter(value => typeof value === "string" && value);
    if (values.length) return values.join(" OR ");
  }
  return "UNKNOWN";
}

function moduleFilename(id) {
  if (typeof id !== "string") return null;
  let filename = id.replace(/^\0+/, "");
  if (filename.startsWith("file:")) {
    try { filename = fileURLToPath(new URL(filename)); } catch { return null; }
  } else filename = filename.split(/[?#]/, 1)[0];
  if (filename.startsWith("/@fs/")) filename = filename.slice(5);
  const normalizedSlashes = filename.replaceAll("\\", "/");
  const marker = normalizedSlashes.toLowerCase().lastIndexOf("/node_modules/");
  if (marker < 0 || !path.isAbsolute(filename)) return null;
  const segments = normalizedSlashes.slice(marker + 14).split("/");
  const packageSegments = segments[0]?.startsWith("@") ? segments.slice(0, 2) : segments.slice(0, 1);
  if (packageSegments.some(part => !part || part === "." || part === "..")) return null;
  const packageBoundary = normalizedSlashes.slice(0, marker + 14) + packageSegments.join("/");
  return { filename: path.normalize(filename), boundary: path.normalize(packageBoundary), hint: packageSegments.join("/") };
}

async function packageForModule(module, projectRoot) {
  let directory = path.dirname(module.filename);
  const boundary = normalized(module.boundary);
  while (normalized(directory) === boundary || normalized(directory).startsWith(boundary + path.sep)) {
    try {
      const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      // Nested package.json files sometimes only declare {type:"module"}.
      if (typeof metadata.name === "string" && metadata.name && typeof metadata.version === "string" && metadata.version) {
        const canonical = await realpath(directory);
        if (projectRoot && normalized(canonical) === normalized(projectRoot)) return { ownSource: true };
        return { directory, canonical, metadata };
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code) && !(error instanceof SyntaxError)) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

async function readableNotice(filename) {
  const info = await stat(filename);
  if (!info.isFile() || info.size > MAX_NOTICE_BYTES) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filename)).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  return text && !text.includes("\0") ? text : null;
}

/** Preserve legal comments from actual included modules, including upstream prebundles. */
export function inlineLegalComments(source) {
  const comments = source.match(/\/\*[\s\S]*?\*\/|(?:^|\n)(?:[ \t]*\/\/[^\n]*(?:\n|$))+/g) || [];
  return [...new Map(comments.filter(comment => LEGAL_TEXT.test(comment)).map(comment => {
    const text = comment.trim();
    return [digest(text), text];
  })).values()];
}

function addNotice(record, name, text) {
  const key = digest(text);
  if (!record.noticeHashes.has(key)) {
    record.noticeHashes.add(key);
    record.notices.push({ name, text });
  }
}

async function addPackageNotices(record, descriptor) {
  const entries = await readdir(descriptor.directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (!entry.isFile() || !NOTICE_NAME.test(entry.name)) continue;
    try {
      const content = await readableNotice(path.join(descriptor.directory, entry.name));
      if (content) addNotice(record, entry.name, content);
      else record.missing.add(`Unreadable, empty or oversized notice: ${entry.name}`);
    } catch { record.missing.add(`Could not read notice: ${entry.name}`); }
  }
  const pointer = /^SEE LICEN[CS]E IN (.+)$/i.exec(record.license);
  if (pointer) {
    const relative = pointer[1].trim().replaceAll("\\", "/");
    if (!relative || path.posix.isAbsolute(relative) || relative.split("/").some(part => !part || part === "." || part === "..") || /[:\x00]/.test(relative)) {
      record.missing.add("The package license points outside its package directory.");
    } else {
      try {
        const content = await readableNotice(path.join(descriptor.directory, ...relative.split("/")));
        if (content) addNotice(record, relative, content);
        else record.missing.add(`License text is missing: ${relative}`);
      } catch { record.missing.add(`License text is missing: ${relative}`); }
    }
  }
}

async function addLicenseSupplement(record, directory) {
  if (record.notices.length || !directory) return;
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return; record.missing.add("The upstream license supplement index could not be read."); return; }
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.entries)) {
    record.missing.add("The upstream license supplement index is invalid.");
    return;
  }
  const entry = manifest.entries.find(item => item.name === record.name && item.version === record.version);
  if (!entry) return;
  if (entry.license !== record.license) { record.missing.add("The pinned upstream supplement declares a different license."); return; }
  if (typeof entry.file !== "string" || path.basename(entry.file) !== entry.file || /[/\\:\x00]/.test(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256 || "")
    || !/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//.test(entry.sourceUrl || "")) {
    record.missing.add("The pinned upstream license supplement metadata is invalid.");
    return;
  }
  try {
    const filename = path.join(directory, entry.file), bytes = await readFile(filename);
    if (bytes.length > MAX_NOTICE_BYTES || digest(bytes) !== entry.sha256) throw new Error("Supplement digest mismatch");
    const content = await readableNotice(filename);
    if (!content) throw new Error("Empty supplement");
    const provenance = [
      `Upstream source: ${entry.sourceUrl}`,
      `Source SHA-256: ${entry.sha256}`,
      ...(entry.packageMetadataUrl ? [`Package version metadata: ${entry.packageMetadataUrl}`] : []),
      ...(entry.versionEvidenceUrl ? [`Upstream version evidence: ${entry.versionEvidenceUrl}`] : []),
      `Provenance: ${entry.provenance || "Pinned upstream license text omitted from the installed package."}`,
    ];
    addNotice(record, "Upstream LICENSE supplement (exact package version)", `${provenance.join("\n")}\n\n${content}`);
  } catch { record.missing.add("The pinned upstream license supplement is missing or its SHA-256 does not match."); }
}

/** Inventory module owners only; never infer unused packages from dependencies. */
export async function collectThirdPartyNotices(moduleIds, { projectRoot, supplementDirectory = DEFAULT_SUPPLEMENTS } = {}) {
  const canonicalProjectRoot = projectRoot ? await realpath(projectRoot) : null;
  const packages = new Map(), descriptors = new Map(), unresolved = new Set();
  for (const id of [...new Set(moduleIds)].sort()) {
    const module = moduleFilename(id);
    if (!module) continue;
    let descriptor;
    try { descriptor = await packageForModule(module, canonicalProjectRoot); }
    catch { unresolved.add(`${module.hint}: package metadata could not be read`); continue; }
    if (descriptor?.ownSource) continue;
    if (!descriptor) { unresolved.add(`${module.hint}: package metadata was not found`); continue; }
    const key = `${descriptor.metadata.name}@${descriptor.metadata.version}`;
    let record = packages.get(key);
    if (!record) {
      record = { name: descriptor.metadata.name, version: descriptor.metadata.version, license: licenseOf(descriptor.metadata), notices: [], noticeHashes: new Set(), missing: new Set() };
      packages.set(key, record);
    } else if (record.license !== licenseOf(descriptor.metadata)) {
      record.missing.add("Included copies declare different license identifiers.");
    }
    if (!descriptors.has(descriptor.canonical)) {
      descriptors.set(descriptor.canonical, descriptor);
      await addPackageNotices(record, descriptor);
      await addLicenseSupplement(record, supplementDirectory);
    }
    try {
      const info = await stat(module.filename);
      if (info.isFile() && info.size <= MAX_MODULE_BYTES) {
        const source = await readFile(module.filename, "utf8");
        const relative = path.relative(descriptor.directory, module.filename).replaceAll(path.sep, "/");
        for (const comment of inlineLegalComments(source)) addNotice(record, `Inline legal notice (${relative})`, comment);
      }
    } catch { record.missing.add("An included module could not be checked for inline legal comments."); }
  }
  return {
    packages: [...packages.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en")).map(record => {
      if (record.license === "UNKNOWN") record.missing.add("The package does not declare a license identifier.");
      if (!record.notices.length) record.missing.add("No distributed LICENSE, NOTICE or inline legal text was found. Review before shipping.");
      return { name: record.name, version: record.version, license: record.license, notices: record.notices, missing: [...record.missing].sort() };
    }),
    unresolved: [...unresolved].sort(),
  };
}

function mergeReports(left, right) {
  const packages = new Map(left.packages.map(record => [`${record.name}@${record.version}`, { ...record, notices: [...record.notices], missing: [...record.missing] }]));
  for (const record of right.packages) {
    const key = `${record.name}@${record.version}`, previous = packages.get(key);
    if (!previous) { packages.set(key, record); continue; }
    const hashes = new Set(previous.notices.map(notice => digest(notice.text)));
    for (const notice of record.notices) if (!hashes.has(digest(notice.text))) { hashes.add(digest(notice.text)); previous.notices.push(notice); }
    previous.missing = [...new Set([...previous.missing, ...record.missing])].sort();
  }
  return { packages: [...packages.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en")), unresolved: [...new Set([...left.unresolved, ...right.unresolved])].sort() };
}

export function renderThirdPartyNotices(report) {
  const lines = [
    "THIRD-PARTY NOTICES — CLIENT BUNDLE", "",
    "This inventory is generated from the module IDs in the emitted client chunks.",
    "It includes the distributed license/notice files and legal comments found in those modules.",
    "Upstream prebundled dependencies are represented by their distributed package notices and retained legal comments; unused dependency declarations are not treated as bundled code.",
    "The application's own source and content licenses are supplied separately as LICENSE and CONTENT-LICENSE.md.", "",
  ];
  for (const record of report.packages) {
    lines.push("=".repeat(78), `${record.name}@${record.version}`, `Declared license: ${record.license}`, "");
    for (const notice of record.notices) lines.push(`--- ${notice.name} ---`, notice.text, "");
    for (const missing of record.missing) lines.push(`MISSING / REVIEW: ${missing}`);
    if (record.missing.length) lines.push("");
  }
  if (report.unresolved.length) lines.push("=".repeat(78), "UNRESOLVED MODULE OWNERS — REVIEW REQUIRED", ...report.unresolved, "");
  return lines.join("\n").trimEnd() + "\n";
}

/** Vite 7/Rollup and Vite 8/Rolldown compatible; SSR never resets client results. */
export function thirdPartyNoticesPlugin({ projectRoot = process.cwd(), emitJson = true, failOnMissing = false, supplementDirectory = DEFAULT_SUPPLEMENTS } = {}) {
  let report = { packages: [], unresolved: [] }, resolvedSsr = false;
  return {
    name: "presales:third-party-notices",
    apply: "build",
    enforce: "post",
    sharedDuringBuild: true,
    applyToEnvironment(environment) { return environment.name === "client"; },
    configResolved(config) { resolvedSsr = Boolean(config.build?.ssr); },
    async generateBundle(_options, bundle) {
      const environment = this.environment;
      if (environment ? environment.name !== "client" : resolvedSsr) return;
      const moduleIds = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        moduleIds.push(...Object.keys(output.modules || {}), ...(output.moduleIds || []));
      }
      report = mergeReports(report, await collectThirdPartyNotices(moduleIds, { projectRoot, supplementDirectory }));
      const missing = [...report.packages.filter(record => record.missing.length).map(record => `${record.name}@${record.version}`), ...report.unresolved];
      if (missing.length) {
        const message = `Third-party notice review required: ${missing.join(", ")}`;
        if (failOnMissing) this.error(message);
        else this.warn(message);
      }
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: renderThirdPartyNotices(report) });
      if (emitJson) this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.json", source: JSON.stringify(report.packages.map(({ name, version, license }) => ({ name, version, license })), null, 2) + "\n" });
    },
    api: { report: () => structuredClone(report) },
  };
}

export default thirdPartyNoticesPlugin;
