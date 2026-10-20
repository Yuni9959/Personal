import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import crypto from "node:crypto";
import { canonicalUrl, rankCandidates, selectDiverse, nextMetricHistory, SELECTION_VERSION } from "./selection.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AI = /\b(?:ai|llm|agents?|machine.learning|deep.learning|diffusion|transformer|inference|generative|rag|mcp|language.model|neural|tts|text.to.speech)\b|人工智能|大模型/i;
export const dayKst = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export function plain(value, limit = 700) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " }[entity]))
    .replace(/\s+/g, " ").trim().slice(0, limit);
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function markdownSummary(markdown) {
  const text = String(markdown).replace(/^---[\s\S]*?\n---\s*\n/, "")
    .replace(/```[\s\S]*?```/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/^[#>|].*$/gm, "").replace(/[*_`]/g, "");
  return text.split(/\n\s*\n/).map(p => plain(p, 650)).filter(p => p.length > 90 && !/^(?:\||https?:|\[|Copyright|License|BibTeX)/i.test(p)).slice(0, 2).join(" ").slice(0, 650);
}
const idFor = url => crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
function topic(text) {
  if (/agent|mcp/i.test(text)) return "에이전트";
  if (/image|video|diffusion|vision|multimodal/i.test(text)) return "멀티모달";
  if (/speech|audio|voice|tts/i.test(text)) return "음성 AI";
  if (/train|fine.tun|dataset/i.test(text)) return "학습·데이터";
  if (/inferen|quantiz|local|ollama/i.test(text)) return "로컬·추론";
  return "생성형 AI";
}
export function parseTrending(html) {
  return [...html.matchAll(/<article\b[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g)].map(([, block]) => {
    const heading = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] || "";
    const name = heading.match(/href="\/([^"?#]+\/[^"?#]+)"/)?.[1];
    const daily = block.match(/([\d,]+)\s+stars today/);
    return { name, description: plain(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1]), dailyStars: daily ? Number(daily[1].replaceAll(",", "")) : null };
  }).filter(row => row.name && AI.test(`${row.name} ${row.description}`));
}
export function parseFeed(xml, source, now = new Date()) {
  const field = (block, tag) => plain(block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1], tag === "description" ? 500 : 300);
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([, block]) => {
    const rawLink = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i)?.[1];
    const url = safeUrl(plain(rawLink));
    const publishedAt = new Date(field(block, "pubDate"));
    return { title: field(block, "title"), description: field(block, "description"), url, source, publishedAt: Number.isFinite(publishedAt.getTime()) ? publishedAt.toISOString() : null, category: "news" };
  }).filter(row => row.url && row.title && row.publishedAt && new Date(row.publishedAt) <= now && now - new Date(row.publishedAt) <= 7 * 86400000);
}
async function request(url, { token, fetchImpl = fetch } = {}) {
  const headers = { Accept: "*/*", "User-Agent": "PersonalTap-AI-Trend/1.0" };
  if (token && new URL(url).hostname === "api.github.com") headers.Authorization = `Bearer ${token}`;
  const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (Buffer.byteLength(text) > 2500000) throw new Error("response too large");
  return text;
}
export function makeCard(item, now = new Date()) {
  const url = safeUrl(item.url);
  if (!url) throw new Error("카드 원문 URL이 올바르지 않습니다.");
  const tags = [topic(`${item.title} ${item.description} ${(item.topics || []).join(" ")}`)];
  const stats = item.stats || [];
  const signal = item.category === "project"
    ? item.dailyStars != null ? `GitHub Trending에서 오늘 별 ${item.dailyStars.toLocaleString("ko-KR")}개를 얻었습니다. 누적 인지도와 별개로 당일 관심 유입을 확인할 수 있습니다.`
      : item.starDelta != null ? `직전 수집 대비 별 ${item.starDelta >= 0 ? "+" : ""}${item.starDelta.toLocaleString("ko-KR")}개 변화했습니다. 새 저장소의 성장 속도를 비교해 보세요.`
      : `최근 45일 안에 공개된 AI 프로젝트입니다. 현재 별 ${Number(item.stars || 0).toLocaleString("ko-KR")}개이며, 첫 수집이라 성장량은 아직 측정하지 않았습니다.`
    : item.category === "model" ? `Hugging Face의 trendingScore 순으로 발견한 모델입니다. 최근 다운로드와 좋아요는 관심 지표이며 성능 평가 결과와는 다릅니다.`
      : `${item.source}의 최근 7일 내 발표입니다. 발표 원문의 기능·제공 범위·이용 조건을 함께 확인할 수 있습니다.`;
  const next = item.category === "project" ? "README의 빠른 시작을 읽고 작은 예제로 재현해 보세요. 라이선스, 최근 커밋과 열린 이슈도 함께 확인하면 도입 판단에 도움이 됩니다."
    : item.category === "model" ? "모델 카드에서 라이선스·메모리 요구량·지원 언어를 확인하고, 익숙한 입력으로 기존 모델과 결과를 비교해 보세요."
      : "원문에서 공개 일정과 직접 사용할 수 있는 기능을 확인하세요. 발표 수치의 평가 조건과 실제 제공 범위를 함께 읽어 보세요.";
  return {
    id: idFor(url), category: item.category, title: plain(item.title, 160), source: item.source,
    selection: item.selection || null, name: item.name || null, topics: item.topics || [], discoveryTopic: item.discoveryTopic || null,
    pipelineTag: item.pipelineTag || null, pushedAt: item.pushedAt || null, stars: item.stars ?? null, likes: item.likes ?? null,
    url, publishedAt: item.publishedAt || null, discoveredAt: now.toISOString(),
    summary: plain(item.description || item.title, 320), tags, stats,
    signalLabel: item.dailyStars != null ? "오늘 급상승" : item.starDelta != null ? "성장 관측" : item.category === "project" ? "새 프로젝트" : item.category === "model" ? "모델 레이더" : "공식 발표",
    slides: [
      { eyebrow: "01 / 핵심 내용", title: plain(item.title, 160), body: plain(item.description || item.title, 650) },
      { eyebrow: "02 / 주목할 신호", title: "지금 살펴볼 이유", body: signal },
      { eyebrow: "03 / 다음 한 걸음", title: "직접 확인해 보세요", body: next }
    ],
    summaryMethod: "원문 발췌 + 관측 지표 기반 한국어 안내"
  };
}
export function buildEdition(items, sources, { now = new Date(), previous = null } = {}) {
  const candidates = rankCandidates(items, { now, previous });
  const picked = selectDiverse(candidates);
  if (picked.length < 3 || new Set(picked.map(item => item.category)).size < 2) throw new Error("충분한 최신 정보를 수집하지 못해 직전 발행본을 보존합니다.");
  const oldMetrics = previous?.repositoryMetrics || {};
  const previousIds = new Map((previous?.cards || []).map(c => [canonicalUrl(c.url), c.id]));
  const toCard = item => {
    const card = makeCard({ ...item, starDelta: item.name && oldMetrics[item.name] != null ? item.stars - oldMetrics[item.name] : null }, now);
    return previousIds.has(item.url) ? { ...card, id: previousIds.get(item.url) } : card;
  };
  const cards = picked.map(toCard);
  return {
    schemaVersion: 1, date: dayKst(now), generatedAt: now.toISOString(), cards, sources,
    candidatePool: candidates.map(toCard), selectionPolicy: SELECTION_VERSION,
    metricHistory: nextMetricHistory(candidates, previous, now),
    repositoryMetrics: Object.fromEntries(candidates.filter(item => item.name && Number.isFinite(item.stars)).map(item => [item.name, item.stars])),
    editorial: "GitHub 당일 Trending·최근 45일 신규 저장소, Hugging Face 트렌딩 모델, 최근 7일 공식 발표를 하루 4회, 6시간마다 수집합니다. 요약은 원문 발췌이며 한국어 안내는 관측 지표 기반입니다."
  };
}
export async function collect({ now = new Date(), token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, previous = null, fetchImpl = fetch } = {}) {
  const sources = [];
  const get = url => request(url, { token, fetchImpl });
  async function source(name, url, work) {
    try { const rows = await work(); sources.push({ name, url, status: "ok", count: rows.length, checkedAt: now.toISOString() }); return rows; }
    catch (error) { sources.push({ name, url, status: "error", detail: error.message, checkedAt: now.toISOString() }); return []; }
  }
  const repoItem = (repo, extra = {}) => ({
    name: repo.full_name, title: repo.full_name, description: repo.description,
    url: repo.html_url, source: "GitHub", category: "project", topics: repo.topics,
    publishedAt: repo.created_at, pushedAt: repo.pushed_at, stars: repo.stargazers_count,
    archived: repo.archived, fork: repo.fork, private: repo.private,
    stats: [{ label: "Stars", value: repo.stargazers_count }, { label: repo.language || "Code", value: repo.forks_count, suffix: " forks" }], ...extra
  });
  const since = new Date(now - 45 * 86400000).toISOString().slice(0, 10);
  const results = await Promise.allSettled([
    source("GitHub Trending", "https://github.com/trending?since=daily", async () => {
      const trending = parseTrending(await get("https://github.com/trending?since=daily")).slice(0, 10);
      const repos = [];
      for (const row of trending) {
        try {
          const repo = JSON.parse(await get(`https://api.github.com/repos/${row.name}`));
          repos.push(repoItem(repo, { dailyStars: row.dailyStars, discovery: ["github-trending"], stats: [{ label: "오늘", value: row.dailyStars, suffix: " stars" }, { label: "전체", value: repo.stargazers_count, suffix: " stars" }] }));
        } catch { /* Search and other sources can still supply cards. */ }
      }
      return repos;
    }),
    source("GitHub New AI", "https://github.com/topics/llm", async () => {
      const rows = [], failures = [];
      for (const topic of ["llm", "ai-agents", "mcp", "computer-vision", "text-to-speech", "machine-learning"]) {
        try {
          const q = `topic:${topic} created:>=${since} stars:>=10 archived:false fork:false is:public`;
          const data = JSON.parse(await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=12`));
          if (!Array.isArray(data.items) || data.incomplete_results) throw new Error("검색 불완전");
          rows.push(...data.items.map(repo => repoItem(repo, { discovery: [`github-topic:${topic}`], discoveryTopic: topic })));
        } catch (e) { failures.push(`${topic}: ${e.message}`); }
      }
      if (!rows.length) throw new Error(failures.join("; "));
      if (failures.length) sources.push({ name: "GitHub topic coverage", url: "https://github.com/topics/artificial-intelligence", status: "partial", detail: failures.join("; "), checkedAt: now.toISOString() });
      return rows;
    }),
    source("Hugging Face Models", "https://huggingface.co/models?sort=trending", async () => {
      const rows = JSON.parse(await get("https://huggingface.co/api/models?sort=trendingScore&limit=12&full=true"));
      return rows.map((row, index) => ({
        category: "model", title: row.id, description: `${row.pipeline_tag || "AI model"} · ${row.id}. ${row.downloads?.toLocaleString("ko-KR") || 0} downloads, ${row.likes || 0} likes.`,
        source: "Hugging Face", url: `https://huggingface.co/${row.id}`, publishedAt: row.createdAt,
        trendRank: index + 1, pipelineTag: row.pipeline_tag, likes: row.likes || 0,
        topics: row.tags || [], discovery: ["huggingface-trending"],
        stats: [{ label: "Downloads", value: row.downloads || 0 }, { label: "Likes", value: row.likes || 0 }]
      }));
    }),
    ...[
      ["OpenAI", "https://openai.com/news/rss.xml"],
      ["Google AI", "https://blog.google/technology/ai/rss/"],
      ["Hugging Face Blog", "https://huggingface.co/blog/feed.xml"]
    ].map(([name, url]) => source(name, url, async () => parseFeed(await get(url), name, now).slice(0, 8))),
    source("Hacker News AI", "https://news.ycombinator.com/", async () => {
      const after = Math.floor(+now / 1000) - 3 * 86400;
      const data = JSON.parse(await get(`https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&numericFilters=created_at_i%3E${after}%2Cpoints%3E20&hitsPerPage=30`));
      return (data.hits || []).filter(h => AI.test(`${h.title} ${h.story_text || ""}`) && h.url && h.created_at_i <= +now / 1000).map(h => ({ url: canonicalUrl(h.url), title: h.title, points: h.points, comments: h.num_comments || 0, storyUrl: `https://news.ycombinator.com/item?id=${h.objectID}` }));
    })
  ]);
  const groups = results.map(result => result.status === "fulfilled" ? result.value : []);
  const projects = [...groups[0], ...groups[1]];
  const news = groups.slice(3, 6).flat();
  const community = groups[6] || [];
  // Only an exact canonical URL match is a cross-platform confirmation. Shared
  // words or multiple GitHub topic searches are not independent confirmations.
  for (const hit of community.filter(h => /^https:\/\/github\.com\/[^/]+\/[^/?]+$/.test(h.url || "")).slice(0, 4)) {
    if (!projects.some(p => canonicalUrl(p.url) === hit.url)) {
      try { projects.push(repoItem(JSON.parse(await get(`https://api.github.com/repos${new URL(hit.url).pathname}`)), { discovery: ["hacker-news"] })); } catch {}
    }
  }
  const all = [...projects, ...news, ...groups[2]].map(item => {
    const hit = community.find(h => h.url === canonicalUrl(item.url));
    return hit ? { ...item, hn: { points: hit.points, comments: hit.comments, url: hit.storyUrl } } : item;
  });
  const edition = buildEdition(all, sources, { now, previous });
  // Enrich model cards and blogs which do not include RSS descriptions, using
  // the publisher's public README/article, without executing repository code.
  await Promise.allSettled(edition.cards.map(async card => {
    let markdownUrl;
    if (card.category === "model") markdownUrl = `${card.url}/raw/main/README.md`;
    else if (card.source === "Hugging Face Blog" && card.summary === card.title) {
      const slug = new URL(card.url).pathname.split("/").at(-1);
      markdownUrl = `https://raw.githubusercontent.com/huggingface/blog/main/${slug}.md`;
    }
    if (!markdownUrl) return;
    const summary = markdownSummary(await get(markdownUrl));
    if (summary) { card.summary = summary.slice(0, 320); card.slides[0].body = summary; }
  }));
  return edition;
}
export async function publish(edition, root = ROOT) {
  const dataRoot = path.join(root, "data");
  await fs.mkdir(path.join(dataRoot, "archive"), { recursive: true });
  const archive = `${edition.date}.json`;
  const encoded = `${JSON.stringify(edition, null, 2)}\n`;
  await fs.writeFile(path.join(dataRoot, "archive", archive), encoded);
  await fs.writeFile(path.join(dataRoot, "latest.json"), encoded);
  const dates = (await fs.readdir(path.join(dataRoot, "archive"))).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
  for (const expired of dates.slice(30)) await fs.unlink(path.join(dataRoot, "archive", expired));
  await fs.writeFile(path.join(dataRoot, "index.json"), `${JSON.stringify({ schemaVersion: 1, latest: edition.date, dates: dates.slice(0, 30).map(name => name.slice(0, 10)) }, null, 2)}\n`);
}
async function main() {
  let previous = null;
  try { previous = JSON.parse(await fs.readFile(path.join(ROOT, "data/latest.json"), "utf8")); } catch { /* First edition. */ }
  const { applyAnalyses } = await import("./editorial.mjs");
  let analyses = {};
  try { analyses = JSON.parse(await fs.readFile(path.join(ROOT, "data/analyses.json"), "utf8")); } catch { /* No verified Korean research yet. */ }
  const candidate = await collect({ previous });
  const edition = applyAnalyses(candidate, analyses, previous);
  await publish(edition);
  console.log(`AI Trend ${edition.date}: ${edition.cards.length} cards; ${edition.sources.filter(s => s.status === "ok").length}/${edition.sources.length} sources`);
  for (const source of edition.sources) console.log(`  ${source.name}: ${source.status} ${source.count ?? source.detail}`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
