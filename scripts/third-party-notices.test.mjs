import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { collectThirdPartyNotices, inlineLegalComments, renderThirdPartyNotices, thirdPartyNoticesPlugin } from "./third-party-notices.mjs";

async function fixture(t) {
  const temporaryRoot = await realpath(os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "presales-notices-test-")));
  t.after(async () => {
    if (!path.resolve(root).startsWith(temporaryRoot + path.sep) || !path.basename(root).startsWith("presales-notices-test-")) throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "own-app", version: "1.0.0", license: "MIT" }));
  return root;
}
async function packageFixture(root, name, { version = "2.0.0", license = "MIT", notice = "MIT License\nCopyright (c) Synthetic package owner\nPermission is hereby granted, free of charge...", code = "export const value = 7;", extra = {} } = {}) {
  const directory = path.join(root, "node_modules", ...name.split("/"));
  await mkdir(path.join(directory, "dist"), { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version, ...(license === null ? {} : { license }), dependencies: { "not-actually-used": "1.0.0" }, ...extra }));
  await writeFile(path.join(directory, "dist", "package.json"), '{"type":"module"}');
  const entry = path.join(directory, "dist", "index.js");
  await writeFile(entry, code);
  if (notice !== null) await writeFile(path.join(directory, "LICENSE"), notice);
  return { directory, entry };
}

test("collects actual transitive module owners, scoped packages and nested package metadata without dependency guessing", async t => {
  const root = await fixture(t);
  const direct = await packageFixture(root, "direct"), transitive = await packageFixture(root, "@scope/transitive"), unused = await packageFixture(root, "unused");
  const report = await collectThirdPartyNotices([direct.entry, `${transitive.entry}?commonjs-proxy`, path.join(root, "app.js"), "\0commonjsHelpers.js", pathToFileURL(direct.entry).href], { projectRoot: root });
  assert.deepEqual(report.packages.map(record => record.name), ["@scope/transitive", "direct"]);
  assert.equal(report.packages.some(record => record.name === "unused"), false);
  assert.equal(report.packages.some(record => record.name === "not-actually-used"), false);
  assert.deepEqual(report.unresolved, []);
  assert.ok(report.packages.every(record => record.notices.length === 1 && record.missing.length === 0));
  assert.ok(unused.entry);
});

test("retains NOTICE and actual bundled inline copyright text without host paths", async t => {
  const root = await fixture(t);
  const dependency = await packageFixture(root, "embedded", { code: "/*! Copyright (c) Vendor One. Licensed under MIT. */\n/* ordinary comment */\n// Copyright (c) Vendor Two\n// SPDX-License-Identifier: BSD-2-Clause\nexport const value = 7;" });
  await writeFile(path.join(dependency.directory, "NOTICE.txt"), "Vendor attribution notice");
  const report = await collectThirdPartyNotices([dependency.entry], { projectRoot: root });
  const rendered = renderThirdPartyNotices(report);
  assert.match(rendered, /Vendor One/); assert.match(rendered, /Vendor Two/); assert.match(rendered, /Vendor attribution notice/);
  assert.doesNotMatch(rendered, /ordinary comment/); assert.equal(rendered.includes(root), false);
  assert.equal(report.packages[0].notices.filter(notice => notice.name.startsWith("Inline legal notice")).length, 2);
});

test("reports missing license evidence and unresolved module metadata explicitly", async t => {
  const root = await fixture(t), dependency = await packageFixture(root, "missing", { license: null, notice: null });
  const unresolved = path.join(root, "node_modules", "unresolved", "entry.js");
  await mkdir(path.dirname(unresolved), { recursive: true }); await writeFile(unresolved, "export default 1;");
  const report = await collectThirdPartyNotices([dependency.entry, unresolved], { projectRoot: root });
  assert.equal(report.packages[0].license, "UNKNOWN");
  assert.equal(report.packages[0].missing.length, 2);
  assert.deepEqual(report.unresolved, ["unresolved: package metadata was not found"]);
  const rendered = renderThirdPartyNotices(report);
  assert.match(rendered, /MISSING \/ REVIEW/); assert.match(rendered, /UNRESOLVED MODULE OWNERS/); assert.equal(rendered.includes(root), false);
});

test("does not include the application's own license through a node_modules junction", async t => {
  const root = await fixture(t), modules = path.join(root, "node_modules");
  await mkdir(modules);
  await writeFile(path.join(root, "entry.js"), "export default 1;");
  await symlink(root, path.join(modules, "own-app"), process.platform === "win32" ? "junction" : "dir");
  const report = await collectThirdPartyNotices([path.join(modules, "own-app", "entry.js")], { projectRoot: root });
  assert.deepEqual(report.packages, []);
});

test("supports SEE LICENSE IN nested files and does not follow outside license pointers", async t => {
  const root = await fixture(t), safe = await packageFixture(root, "safe", { license: "SEE LICENSE IN legal/terms.txt", notice: null });
  await mkdir(path.join(safe.directory, "legal")); await writeFile(path.join(safe.directory, "legal", "terms.txt"), "Synthetic legal text");
  const unsafe = await packageFixture(root, "unsafe", { license: "SEE LICENSE IN ../private.txt", notice: null });
  const report = await collectThirdPartyNotices([safe.entry, unsafe.entry], { projectRoot: root });
  assert.match(report.packages.find(record => record.name === "safe").notices[0].text, /Synthetic legal text/);
  assert.ok(report.packages.find(record => record.name === "unsafe").missing.some(message => message.includes("outside")));
});

test("emits complete cumulative client assets for Rollup/Rolldown chunk shapes and ignores SSR rounds", async t => {
  const root = await fixture(t), first = await packageFixture(root, "first"), second = await packageFixture(root, "second");
  const plugin = thirdPartyNoticesPlugin({ projectRoot: root }), assets = [], warnings = [];
  const client = { environment: { name: "client" }, emitFile: asset => assets.push(asset), warn: warning => warnings.push(warning), error: error => { throw new Error(error); } };
  const ssr = { ...client, environment: { name: "prerender" } };
  await plugin.generateBundle.call(ssr, {}, { "server.js": { type: "chunk", modules: { [second.entry]: {} } } });
  assert.equal(assets.length, 0);
  await plugin.generateBundle.call(client, {}, { "client.js": { type: "chunk", modules: { [first.entry]: {} } } });
  await plugin.generateBundle.call(ssr, {}, {});
  await plugin.generateBundle.call(client, {}, { "dynamic.js": { type: "chunk", moduleIds: [second.entry] } });
  const inventory = JSON.parse(assets.filter(asset => asset.fileName.endsWith(".json")).at(-1).source);
  assert.deepEqual(inventory, [{ name: "first", version: "2.0.0", license: "MIT" }, { name: "second", version: "2.0.0", license: "MIT" }]);
  assert.ok(inventory.every(item => Object.keys(item).join(",") === "name,version,license"));
  assert.equal(warnings.length, 0);
});

test("can fail a build explicitly when third-party evidence is missing", async t => {
  const root = await fixture(t), dependency = await packageFixture(root, "missing", { notice: null });
  const plugin = thirdPartyNoticesPlugin({ projectRoot: root, failOnMissing: true });
  await assert.rejects(plugin.generateBundle.call({ emitFile() {}, warn() {}, error(message) { throw new Error(message); } }, {}, { chunk: { type: "chunk", modules: { [dependency.entry]: {} } } }), /Third-party notice review required: missing@2.0.0/);
});

test("uses only version- and license-matched pinned official supplements", async t => {
  const root = await fixture(t), entities = await packageFixture(root, "@nodable/entities", { version: "3.0.0", notice: null });
  const dingbat = await packageFixture(root, "dingbat-to-unicode", { version: "1.0.1", license: "BSD-2-Clause", notice: null });
  const report = await collectThirdPartyNotices([entities.entry, dingbat.entry], { projectRoot: root });
  assert.ok(report.packages.every(record => record.missing.length === 0));
  const rendered = renderThirdPartyNotices(report);
  assert.match(rendered, /Copyright \(c\) 2026 Nodable/);
  assert.match(rendered, /Copyright \(c\) 2021, Michael Williamson/);
  assert.match(rendered, /Source SHA-256: [a-f0-9]{64}/);
  assert.match(rendered, /not represented as part of the published npm archive/);
  await writeFile(path.join(entities.directory, "package.json"), JSON.stringify({ name: "@nodable/entities", version: "3.0.1", license: "MIT" }));
  const differentVersion = await collectThirdPartyNotices([entities.entry], { projectRoot: root });
  assert.equal(differentVersion.packages[0].notices.length, 0);
  assert.ok(differentVersion.packages[0].missing.length);
  await writeFile(path.join(entities.directory, "package.json"), JSON.stringify({ name: "@nodable/entities", version: "3.0.0", license: "BSD-2-Clause" }));
  const differentLicense = await collectThirdPartyNotices([entities.entry], { projectRoot: root });
  assert.ok(differentLicense.packages[0].missing.some(message => message.includes("different license")));
});

test("rejects a supplement with changed bytes instead of inventing license evidence", async t => {
  const root = await fixture(t), dependency = await packageFixture(root, "synthetic-supplement", { notice: null });
  const supplements = path.join(root, "supplements"); await mkdir(supplements);
  const original = "Synthetic MIT license text", filename = "synthetic.txt";
  const entry = { name: "synthetic-supplement", version: "2.0.0", license: "MIT", file: filename, sha256: createHash("sha256").update(original).digest("hex"), sourceUrl: `https://raw.githubusercontent.com/example/synthetic/${"a".repeat(40)}/LICENSE`, provenance: "Synthetic unit-test fixture only." };
  await writeFile(path.join(supplements, "index.json"), JSON.stringify({ formatVersion: 1, entries: [entry] }));
  await writeFile(path.join(supplements, filename), "Changed bytes");
  const report = await collectThirdPartyNotices([dependency.entry], { projectRoot: root, supplementDirectory: supplements });
  assert.equal(report.packages[0].notices.length, 0);
  assert.ok(report.packages[0].missing.some(message => message.includes("SHA-256")));
  const plugin = thirdPartyNoticesPlugin({ projectRoot: root, failOnMissing: true, supplementDirectory: supplements });
  await assert.rejects(plugin.generateBundle.call({ emitFile() {}, warn() {}, error(message) { throw new Error(message); } }, {}, { chunk: { type: "chunk", modules: { [dependency.entry]: {} } } }), /Third-party notice review required/);
});

test("builds a real small Rollup client bundle and writes the emitted notices", async t => {
  const root = await fixture(t), dependency = await packageFixture(root, "actual-build");
  const entry = path.join(root, "entry.mjs");
  await writeFile(entry, `import {value} from ${JSON.stringify(dependency.entry.replaceAll("\\", "/"))}; console.log(value);`);
  const { rollup } = await import("rollup");
  const bundle = await rollup({ input: entry, plugins: [thirdPartyNoticesPlugin({ projectRoot: root })] });
  t.after(() => bundle.close());
  const out = path.join(root, "out");
  await bundle.write({ dir: out, format: "es" });
  const notice = await readFile(path.join(out, "THIRD_PARTY_NOTICES.txt"), "utf8");
  assert.match(notice, /actual-build@2.0.0/); assert.equal(notice.includes(root), false);
  assert.deepEqual(JSON.parse(await readFile(path.join(out, "THIRD_PARTY_NOTICES.json"), "utf8")), [{ name: "actual-build", version: "2.0.0", license: "MIT" }]);
});

test("builds with the installed native Rolldown OutputChunk API", async t => {
  const root = await fixture(t), dependency = await packageFixture(root, "rolldown-build", { code: "globalThis.__noticeFixture = new Date().getTime(); export const value = globalThis.__noticeFixture;" });
  const entry = path.join(root, "entry.mjs");
  await writeFile(entry, `import {value} from ${JSON.stringify(dependency.entry.replaceAll("\\", "/"))}; console.log(value);`);
  const { rolldown } = await import("rolldown");
  const bundle = await rolldown({ input: entry, plugins: [thirdPartyNoticesPlugin({ projectRoot: root })] });
  t.after(() => bundle.close());
  const output = await bundle.generate({ format: "es" });
  const asset = output.output.find(item => item.type === "asset" && item.fileName === "THIRD_PARTY_NOTICES.json");
  assert.ok(asset);
  assert.deepEqual(JSON.parse(asset.source), [{ name: "rolldown-build", version: "2.0.0", license: "MIT" }], JSON.stringify(output.output.filter(item => item.type === "chunk").map(item => ({ moduleIds: item.moduleIds, modules: Object.keys(item.modules) }))));
});

test("extracts only legal comment text", () => {
  assert.deepEqual(inlineLegalComments("/* mundane */\n/*! @license MIT — Synthetic */\nconsole.log('x');"), ["/*! @license MIT — Synthetic */"]);
});
