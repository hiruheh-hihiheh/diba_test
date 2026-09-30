// Minimal static server for visually checking a rendered PDF in the browser.
// Serves only this directory; used for verification, not part of the app.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "out");
const port = Number(process.argv[2] ?? 8123);
const types = { ".pdf": "application/pdf", ".html": "text/html" };

createServer(async (req, res) => {
  const name = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = normalize(name === "/" ? "/SAMPLE_original.pdf" : name).replace(/^([/\\])+/, "");
  // Refuse anything that climbs out of the served directory.
  if (rel.startsWith("..")) {
    res.writeHead(403).end("no");
    return;
  }
  const file = join(root, rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log("serving " + root + " on " + port));
