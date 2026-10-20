import { validateEdition } from "../apps/ai-trend/js/model.js";
import { editionForRelease, resolvePublication, validateManifest } from "../apps/ai-trend/js/schedule.js";

export const VERSION = "2026-10-21.1";
const ROOT = "https://raw.githubusercontent.com/Yuni9959/Personal/ai-trend-data/apps/ai-trend/data/";
const ORIGINS = new Set(["https://yuni9959.github.io", "http://localhost:8080", "http://127.0.0.1:8080"]);
export async function readPublication({ now = new Date(), selected = "latest", statusOnly = false, fetchImpl = fetch } = {}) {
  if (selected !== "latest" && !/^\d{4}-\d{2}-\d{2}-(07|19)$/.test(selected)) throw new Error("Invalid edition");
  const signal = AbortSignal.timeout(8000);
  async function read(relative) {
    const response = await fetchImpl(`${ROOT}${relative}?t=${+now}`, { cache: "no-store", signal, headers: { Accept: "application/json" }, redirect: "error" });
    if (!response.ok) throw new Error(`발행 저장소 HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 2000000) throw new Error("발행 데이터 크기 초과");
    return JSON.parse(body);
  }
  const manifest = validateManifest(await read("release-manifest.json"));
  const result = resolvePublication(manifest, now, selected);
  if (statusOnly) return { ...result, version: VERSION, ready: manifest.releases.map(({ id, preparedAt, scheduledAt }) => ({ id, preparedAt, scheduledAt })) };
  if (!result.entry) throw new Error("아직 공개된 발행본이 없습니다.");
  const edition = editionForRelease(validateEdition(await read(result.entry.path)), result.entry);
  return { ...result, edition, version: VERSION };
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  if (origin && !ORIGINS.has(origin)) return res.status(403).json({ error: "Origin not allowed" });
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS"); return res.status(204).end(); }
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const url = new URL(req.url, "https://personal-tap-data-yuni14.vercel.app");
    const result = await readPublication({ selected: url.searchParams.get("edition") || "latest", statusOnly: url.searchParams.get("status") === "1" });
    result.serverNow = new Date().toISOString();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(503).json({ version: VERSION, error: "발행본 확인 실패. 마지막 검증 발행본을 유지해 주세요.", detail: error.message });
  }
}
