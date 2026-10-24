import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createCatalog } from "../js/catalog.js";
import { validateEdition } from "../js/model.js";
import { validateManifest, editionForRelease } from "../js/schedule.js";

export async function atomicWrite(file, text) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, text, { flag: "wx" }); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); }
}
// Index + manifest are derived data. Published edition bytes are never rewritten.
export async function writeCatalog(data, manifest) {
  validateManifest(manifest);
  const editions = [];
  for (const entry of manifest.releases) {
    const edition = editionForRelease(validateEdition(JSON.parse(await fs.readFile(path.join(data, entry.path), "utf8"))), entry);
    editions.push({ entry, edition });
  }
  const catalog = createCatalog(editions), encoded = `${JSON.stringify(catalog)}\n`;
  const hash = createHash("sha256").update(encoded).digest("hex");
  const catalogPath = `catalogs/${hash}.json`;
  await fs.mkdir(path.join(data, "catalogs"), { recursive: true });
  await atomicWrite(path.join(data, catalogPath), encoded);
  const next = validateManifest({ ...manifest, catalogPath });
  await atomicWrite(path.join(data, "release-manifest.json"), `${JSON.stringify(next, null, 2)}\n`);
  // These are rebuildable indexes, not original editions or audit history.
  for (const name of await fs.readdir(path.join(data, "catalogs"))) {
    if (/^[a-f0-9]{64}\.json$/.test(name) && name !== `${hash}.json`) await fs.unlink(path.join(data, "catalogs", name));
  }
  return next;
}
