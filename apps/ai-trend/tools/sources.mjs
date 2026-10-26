// Selection status is editorial intent; enabled means an actual public collector.
export const SOURCES = [
  { name: "OpenAI", url: "https://openai.com/news/rss.xml", kind: "official" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/", kind: "official" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", kind: "official" },
  { name: "Reddit r/LocalLLaMA", url: "https://www.reddit.com/r/LocalLLaMA/new/.rss?limit=30", kind: "community", state: "selected" },
  { name: "Product Hunt", url: "https://www.producthunt.com/feed", kind: "product", state: "selected", filterAI: true },
  { name: "Techmeme", url: "https://www.techmeme.com/feed.xml", kind: "reporting", state: "selected", filterAI: true },
  { name: "arXiv", url: "https://rss.arxiv.org/atom/cs.AI+cs.LG+cs.CL+cs.CV", kind: "paper", channel: "research", state: "selected", limit: 18 },
  { name: "alphaXiv", url: "https://www.alphaxiv.org/", kind: "paper", channel: "research", state: "candidate", parser: "alphaxiv", limit: 10 },
  { name: "Google Workspace Updates", url: "https://feeds.feedburner.com/GoogleAppsUpdates", kind: "official", state: "candidate", filterAI: true },
  { name: "Anthropic Engineering", url: "https://www.anthropic.com/engineering", kind: "official", state: "candidate", parser: "anthropic" },
  { name: "Gemini 변경 기록", url: "https://gemini.google/release-notes/", kind: "official", state: "candidate", parser: "gemini" },
  { name: "AI News / Latent Space", url: "https://latent.space/feeds/news.xml", kind: "reporting", state: "candidate" },
  { name: "GeekNews", url: "https://news.hada.io/rss/news", kind: "community", state: "candidate", filterAI: true },
].map(s => ({ channel: "information", state: "monitoring", enabled: true, ...s }));

export const WATCHLIST = [
  { name: "X 공식 계정", state: "candidate", enabled: false, accounts: ["OpenAI", "AnthropicAI", "claudeai", "ClaudeDevs", "GeminiApp", "googlecloud"], reason: "공식 X 읽기 API 인증·접근 경로 확인 필요. 공식 블로그·변경 기록을 별도 수집한다." },
  { name: "X 개인 개발자·연구자", state: "candidate", enabled: false, examples: ["Techartist"], reason: "정확한 계정 식별과 지속 수집 접근 경로 확인 필요" },
  { name: "OpenRouter Rankings", url: "https://openrouter.ai/rankings", state: "candidate", enabled: false, reason: "기간별 사용량의 공식 수집 인터페이스 확인 필요. 전체 시장 점유율로 해석하지 않는다." },
  { name: "OpenReview", url: "https://openreview.net/", channel: "research", state: "candidate", enabled: false, reason: "추적할 학회·venue를 정한 뒤 공개 제출·심사 범위로 연결" },
  { name: "r/StableDiffusion · r/ComfyUI", state: "specialist-candidate", enabled: false, reason: "이미지·영상 분야 확장 후보. 현재 LocalLLaMA 수집과 구분" },
  { name: "프롬왓 @prompt_what", state: "reference-candidate", enabled: false, reason: "플랫폼·계정을 확인한 뒤 원문 발견용으로만 사용" },
];

export const AI_TOPIC = /\b(?:ai|llms?|agents?|machine.learning|deep.learning|diffusion|transformer|inference|generative|rag|mcp|language.model|neural|tts|text.to.speech|gemini|claude|chatgpt|gpt|qwen|deepseek)\b|인공지능|생성형|에이전트|딥러닝|언어모델|人工智能|大模型/i;
export function decode(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, e => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " }[e]));
}
export function plain(value, limit = 700) {
  return decode(decode(value)).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
const field = (block, tag) => block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
const attr = (tag, key) => decode(tag.match(new RegExp(`\\b${key}=["']([^"']*)["']`, "i"))?.[1]);
export const recent = (date, now) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= +now && +now - Date.parse(date) <= 7 * 86400000;
export function parseFeed(xml, source, now = new Date()) {
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(([, type, block]) => {
    const links = [...block.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
    const link = type === "item" ? plain(field(block, "link")) : attr(links.find(l => !attr(l, "rel") || attr(l, "rel") === "alternate") || "", "href");
    const content = decode(field(block, "description") || field(block, "content") || field(block, "summary"));
    const date = plain(field(block, "pubDate") || field(block, "published") || field(block, "updated"));
    // Blogger still emits HTTP permalinks for this HTTPS-capable official blog.
    const url = safeUrl(source === "Google Workspace Updates" ? link.replace(/^http:\/\/workspaceupdates\.googleblog\.com\//, "https://workspaceupdates.googleblog.com/") : link);
    const contentLinks = [...content.matchAll(/href=["']([^"']+)["']/gi)].map(m => safeUrl(decode(m[1])));
    const external = contentLinks
      .filter(p => p && url && new URL(p).hostname !== new URL(url).hostname && !/\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(p));
    const headlineLink = safeUrl(decode(content.match(/<(?:b|strong)\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["']/i)?.[1]));
    return { title: plain(field(block, "title"), 300), description: plain(content, 2000), url, source,
      publishedAt: recent(date, now) ? new Date(date).toISOString() : null, category: "news",
      primaryUrl: source === "Product Hunt" ? contentLinks.find(p => p && /^https:\/\/www\.producthunt\.com\/r\/p\/\d+/.test(p)) || null : source === "Techmeme" ? headlineLink || null : external[0] || null, announceType: plain(field(block, "arxiv:announce_type")) || null };
  }).filter(r => r.url && r.title && r.publishedAt);
}
export function parseAlphaXiv(html, now = new Date()) {
  const rows = [];
  for (const [, text] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const data = JSON.parse(text);
    for (const list of data["@graph"] || [data]) {
      if (list["@type"] !== "ItemList" || list.name !== "Trending Papers") continue;
      for (const { item, position } of list.itemListElement || []) {
        const id = item?.url?.match(/^https:\/\/www\.alphaxiv\.org\/abs\/(\d{4}\.\d{4,5})(?:v\d+)?$/)?.[1];
        if (!id || !recent(item.datePublished, now)) continue;
        const count = kind => item.interactionStatistic?.find(s => s.interactionType?.["@type"] === kind)?.userInteractionCount;
        rows.push({ category: "news", source: "alphaXiv", title: plain(item.headline, 300), description: plain(item.description, 2000),
          url: `https://arxiv.org/abs/${id}`, publishedAt: item.datePublished, discoveryUrl: item.url,
          paperRank: Number.isInteger(position) && position > 0 ? position : null,
          stats: [["alphaXiv 조회", count("ViewAction")], ["alphaXiv 좋아요", count("LikeAction")]].filter(([, n]) => Number.isFinite(n) && n >= 0).map(([label, value]) => ({ label, value })) });
      }
    }
  }
  return rows;
}
export function parseAnthropic(html, now = new Date()) {
  return [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].flatMap(([, block]) => {
    const date = plain(field(block, "time"));
    const title = plain(field(block, "h3"), 300);
    const href = field(block, "h3").match(/href=["']([^"']+)["']/)?.[1];
    const parsed = new Date(`${date} 00:00:00 GMT`);
    return title && href?.startsWith("/") && recent(parsed, now) ? [{ category: "news", source: "Anthropic Engineering", title, description: title, url: new URL(href, "https://www.anthropic.com").href, publishedAt: parsed.toISOString(), datePrecision: "day" }] : [];
  });
}
export function parseGemini(html, now = new Date()) {
  const sections = [...html.matchAll(/<h2\b[^>]*>(\d{4})\.(\d{2})\.(\d{2})<\/h2>([\s\S]*?)(?=<h2\b|$)/gi)];
  return sections.flatMap(([, y, m, d, body]) => {
    const publishedAt = `${y}-${m}-${d}T00:00:00.000Z`;
    return recent(publishedAt, now) ? [{ category: "news", source: "Gemini 변경 기록", title: `Gemini ${y}-${m}-${d}: ${plain(field(body, "h3"), 180)}`, description: plain(body, 2000), url: "https://gemini.google/release-notes/", publishedAt, releaseDate: `${y}.${m}.${d}`, datePrecision: "day" }] : [];
  }).slice(0, 1);
}
export function sourceRows(text, config, now) {
  const parser = { alphaxiv: parseAlphaXiv, anthropic: parseAnthropic, gemini: parseGemini }[config.parser];
  if (!parser && !/<(?:rss|feed|rdf:RDF|item)\b/i.test(text)) throw new Error("RSS/Atom 피드 형식이 아닙니다.");
  return (parser ? parser(text, now) : parseFeed(text, config.name, now))
    .filter(r => (!config.filterAI || AI_TOPIC.test(`${r.title} ${r.description}`)) && (config.name !== "arXiv" || r.announceType === "new"))
    .sort((a, b) => (a.paperRank || 1000) - (b.paperRank || 1000) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, config.limit || 8).map(r => ({ ...r, sourceKind: config.kind, channel: config.channel,
      // Techmeme points at reporting elsewhere. Preserve the discovery link.
      ...(config.name === "Techmeme" && r.primaryUrl ? { discoveryUrl: r.url, url: r.primaryUrl } : {}),
      discovery: [config.name], discoveryUrl: r.discoveryUrl || r.url }));
}
