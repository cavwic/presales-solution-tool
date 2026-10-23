import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const readArgument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const root = resolve(process.cwd(), "dist");
const base = "/cavwic-solutions-lab";
const host = readArgument("--host", "127.0.0.1");
const port = Number(readArgument("--port", "4332"));
const mime = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
};

const server = createServer((request, response) => {
  const rawPath = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const localPath = rawPath.startsWith(base) ? rawPath.slice(base.length) || "/" : rawPath;
  let filePath = normalize(join(root, localPath));
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    const type = mime[extname(filePath)] || "application/octet-stream";
    response.writeHead(200, {
      "Cache-Control": type === "text/html" ? "no-cache" : "public, max-age=3600",
      "Content-Type": `${type}${type.startsWith("text/") ? "; charset=utf-8" : ""}`,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Static review server: http://${host}:${port}${base}/`);
});
