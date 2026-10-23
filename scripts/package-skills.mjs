import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import JSZip from "jszip";

const version = "1.0.0";
const releaseDate = new Date("2026-08-14T00:00:00.000Z");
const root = process.cwd();
const output = join(root, "public", "downloads", "skills");
const skills = ["solution-workflow", "tender-requirement-extraction", "technical-bid-package"];

async function filesUnder(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(fullPath));
    else result.push(fullPath);
  }
  return result;
}

await mkdir(output, { recursive: true });
const codeLicense = await readFile(join(root, "LICENSE"));
const contentLicense = await readFile(join(root, "CONTENT-LICENSE.md"));
const manifest = { version, generatedAt: releaseDate.toISOString(), licenses: { code: "MIT", content: "CC BY 4.0" }, skills: [] };

for (const skill of skills) {
  const source = join(root, "skills", skill);
  const zip = new JSZip();
  for (const file of await filesUnder(source)) {
    const archivePath = `${skill}/${relative(source, file).replaceAll("\\", "/")}`;
    zip.file(archivePath, await readFile(file), { date: releaseDate, createFolders: false });
  }
  zip.file(`${skill}/LICENSE-CODE.txt`, codeLicense, { date: releaseDate, createFolders: false });
  zip.file(`${skill}/LICENSE-CONTENT.md`, contentLicense, { date: releaseDate, createFolders: false });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
  const name = `${skill}-${version}.zip`;
  await writeFile(join(output, name), bytes);
  manifest.skills.push({ name: skill, file: name, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
}

await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
