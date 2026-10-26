// Scores describe observed attention, never model quality or investment value.
export const SELECTION_VERSION = "momentum-v2";
export const LIMITS = { project: 6, news: 5, model: 3 };
const HOUR = 3600000;
const finite = n => typeof n === "number" && Number.isFinite(n) && n >= 0;
const clamp = (n, max) => Math.max(0, Math.min(max, n));
const log = (value, scale, max) => finite(value) ? clamp(Math.log1p(value) / Math.log1p(scale) * max, max) : 0;
const ageHours = (date, now) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= +now ? (+now - Date.parse(date)) / HOUR : null;
const round = n => Math.round(n * 10) / 10;
export function canonicalUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|ref_src)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    if (u.hostname === "github.com") u.pathname = u.pathname.toLowerCase();
    return u.href;
  } catch { return null; }
}
export function topicFamily(card) {
  const text = `${card.topic || ""} ${card.discoveryTopic || ""} ${card.title} ${card.description || ""} ${(card.topics || []).join(" ")} ${card.pipelineTag || ""}`;
  if (/speech|audio|voice|tts|음성|오디오|text-to-speech/i.test(text)) return "음성·오디오";
  if (/vision|image|video|diffusion|multimodal|시각|영상|이미지|멀티모달/i.test(text)) return "비전·멀티모달";
  if (/dataset|pretrain|fine.tun|학습|데이터셋/i.test(text)) return "학습·데이터";
  if (/inference|quantiz|serving|gpu|가속|양자화|추론 인프라/i.test(text)) return "추론·인프라";
  if (/agents?|mcp|에이전트/i.test(text)) return "에이전트·개발";
  return card.topic || card.discoveryTopic || card.pipelineTag || "새 AI 활용";
}
function ownerOf(card) {
  if (card.category === "news") return card.source;
  return new URL(card.url).pathname.split("/").filter(Boolean)[0]?.toLowerCase() || card.source;
}
function metric(card, name) {
  if (finite(card[name])) return card[name];
  const label = name === "stars" ? /^(Stars|전체)$/ : /^Likes$/;
  return card.stats?.find(s => label.test(s.label))?.value;
}
export function measuredGrowth(card, previous, now) {
  const url = canonicalUrl(card.url), key = card.category === "project" ? "stars" : "likes";
  const current = metric(card, key);
  let history = previous?.metricHistory?.[url] || [];
  const legacy = previous?.repositoryMetrics?.[card.name || card.title];
  if (!history.length && key === "stars" && finite(legacy)) history = [{ at: previous.generatedAt, stars: legacy }];
  const baseline = history.filter(h => {
    const hours = ageHours(h.at, now); return hours != null && hours >= 1 && hours <= 48 && finite(h[key]);
  }).sort((a, b) => Math.abs(ageHours(a.at, now) - 6) - Math.abs(ageHours(b.at, now) - 6))[0];
  if (!baseline || !finite(current) || current < baseline[key]) return null;
  const hours = ageHours(baseline.at, now), delta = current - baseline[key];
  return { metric: key, baselineAt: baseline.at, observedAt: now.toISOString(), baseline: baseline[key], current, delta, hours: round(hours), perHour: round(delta / hours) };
}
export function rankCandidates(items, { now = new Date(), previous = null } = {}) {
  const deduped = new Map();
  for (const item of items) {
    const url = canonicalUrl(item.url);
    if (!url || !LIMITS[item.category] || item.archived || item.fork || item.private || (item.publishedAt && ageHours(item.publishedAt, now) == null)) continue;
    if (item.category === "news" && (ageHours(item.publishedAt, now) == null || ageHours(item.publishedAt, now) > 168)) continue;
    const old = deduped.get(url);
    const discovery = [...(old?.discovery || []), ...(item.discovery || [])];
    // Keep the best native rank and daily measurement when a search also found
    // the same repository; searches are not independent community confirmations.
    const papers = [old, item].filter(row => row?.sourceKind === "paper");
    const paper = papers.find(row => row.paperRank) || papers[0];
    deduped.set(url, { ...old, ...item, ...(paper ? { sourceKind: "paper", channel: "research", source: paper.source, paperRank: paper.paperRank, publishedAt: paper.publishedAt, discoveryUrl: paper.discoveryUrl, stats: paper.stats } : {}), url, dailyStars: Math.max(old?.dailyStars || 0, item.dailyStars || 0) || null, trendRank: Math.min(old?.trendRank || Infinity, item.trendRank || Infinity), hn: (old?.hn?.points || 0) > (item.hn?.points || 0) ? old.hn : item.hn || old?.hn, discovery });
  }
  return [...deduped.values()].map(card => {
    const growth = measuredGrowth(card, previous, now), age = ageHours(card.publishedAt, now), pushed = ageHours(card.pushedAt, now);
    const reasons = [], signals = [];
    const add = (label, url = card.url) => { reasons.push(label); signals.push({ label, url }); };
    const components = {};
    if (card.category === "project") {
      components.dailyAttention = log(card.dailyStars, 5000, 30);
      components.measuredVelocity = growth ? log(growth.perHour, 100, 28) : 0;
      components.freshness = age == null ? 0 : 20 * Math.exp(-age / (14 * 24));
      components.activity = pushed == null ? 0 : 8 * Math.exp(-pushed / (7 * 24));
      components.earlyDiscovery = age != null && age <= 45 * 24 ? 8 * Math.exp(-age / (30 * 24)) : 0;
      components.totalAttention = log(metric(card, "stars"), 100000, 4);
      if (card.dailyStars > 0) add(`GitHub 오늘 별 +${card.dailyStars.toLocaleString("ko-KR")}개`, "https://github.com/trending?since=daily");
      if (growth) add(`별 +${growth.delta.toLocaleString("ko-KR")}개 / ${growth.hours}시간 · 시간당 ${growth.perHour}개`);
      if (age != null && age <= 45 * 24) add(`공개 ${Math.max(1, Math.ceil(age / 24))}일 이내 신규 프로젝트`);
      if (pushed != null && pushed <= 7 * 24) add("최근 7일 내 코드 변경 관측");
      components.curationPenalty = /(?:^|\/)awesome[-_]|curated (?:list|collection)|list of (?:ai|llm)|资源列表/i.test(`${card.title} ${card.description || ""}`) ? -16 : 0;
    } else if (card.category === "model") {
      components.nativeTrend = Number.isFinite(card.trendRank) ? 42 / Math.sqrt(card.trendRank) : 0;
      components.freshness = age == null ? 0 : 18 * Math.exp(-age / (14 * 24));
      components.measuredVelocity = growth ? log(growth.perHour, 10, 20) : 0;
      components.totalAttention = log(metric(card, "likes"), 5000, 4);
      if (Number.isFinite(card.trendRank)) add(`Hugging Face 트렌딩 ${card.trendRank}위 관측`, "https://huggingface.co/models?sort=trending");
      if (growth) add(`좋아요 +${growth.delta}개 / ${growth.hours}시간`);
      if (age != null && age <= 14 * 24) add(`공개 ${Math.max(1, Math.ceil(age / 24))}일 이내 모델`);
      // Downloads is a rolling window, so subtraction is NOT growth.
    } else {
      components.freshness = age == null ? 0 : 72 * Math.exp(-age / 72);
      const label = { paper: "연구 논문", community: "커뮤니티 게시", reporting: "보도·종합 소식", product: "제품 소개" }[card.sourceKind] || "공식 발표";
      add(card.datePrecision === "day" ? `${label} ${card.publishedAt.slice(0, 10)} · 정확한 게시 시각 미제공` : `${label} ${Math.max(1, Math.ceil(age))}시간 경과`);
      if (card.paperRank) {
        components.researchAttention = 16 / Math.sqrt(card.paperRank);
        add(`alphaXiv 공개 인기 목록 ${card.paperRank}위 관측 · 조회·반응은 연구 품질 평가가 아님`, card.discoveryUrl);
      }
      if (card.sourceKind === "paper") add("논문 등록은 동료심사 통과를 뜻하지 않음");
      if (card.discoveryUrl && card.discoveryUrl !== card.url) add(`${card.source} 발견 경로`, card.discoveryUrl);
    }
    components.communityAttention = card.hn ? log(card.hn.points, 500, 16) + log(card.hn.comments, 100, 4) : 0;
    if (card.hn) add(`Hacker News ${card.hn.points}점 · 댓글 ${card.hn.comments}개`, card.hn.url);
    const exposure = previous?.exposureHistory?.[card.url] || (previous?.cards?.some(c => canonicalUrl(c.url) === card.url) ? { lastFeaturedAt: previous.generatedAt } : null);
    const since = ageHours(exposure?.lastFeaturedAt, now);
    components.repeatPenalty = since != null && since < 36 ? -18 * Math.exp(-since / 24) : 0;
    const score = round(Object.values(components).reduce((a, b) => a + b, 0));
    const newsBadge = { paper: "논문·연구", community: "커뮤니티 소식", reporting: "보도·종합 소식", product: "새 제품 소개" }[card.sourceKind] || (age <= 48 ? "새 공식 발표" : "공식 발표 추적");
    const badge = card.category === "news" ? newsBadge : growth?.delta > 0 ? "단기 관심 증가" : card.dailyStars > 0 ? "오늘 급상승" : card.hn ? "커뮤니티 주목" : card.category === "model" ? "모델 트렌딩" : "새로운 발견";
    if (!reasons.length) add("AI 주제 탐색에서 발견 · 단기 성장량 미측정");
    return { ...card, selection: { version: SELECTION_VERSION, score, components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round(v)])), badge, reasons, signals, growth, family: topicFamily(card), owner: ownerOf(card), repeated: since != null && since < 36, independentCommunity: !!card.hn } };
  }).sort((a, b) => b.selection.score - a.selection.score || a.url.localeCompare(b.url));
}
export function selectDiverse(ranked, { limits = LIMITS } = {}) {
  const remaining = [...ranked], picked = [], families = new Map(), owners = new Map(), categories = new Map();
  while (remaining.length && picked.length < Object.values(limits).reduce((a, b) => a + b, 0)) {
    let best = -1, bestValue = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const card = remaining[i], ownerKey = `${card.category}:${ownerOf(card)}`;
      if (card.channel === "research" && picked.filter(c => c.channel === "research").length >= 2) continue;
      if (card.category === "news" && card.selection.score < 0) continue;
      if ((categories.get(card.category) || 0) >= (limits[card.category] || 0) || (owners.get(ownerKey) || 0) >= (card.category === "news" ? 2 : 1)) continue;
      const familyCount = families.get(topicFamily(card)) || 0;
      const adjusted = card.selection.score - familyCount * 9 - Math.max(0, familyCount - 1) * 9;
      if (adjusted > bestValue) { bestValue = adjusted; best = i; }
    }
    if (best < 0) break;
    const [card] = remaining.splice(best, 1), family = topicFamily(card), ownerKey = `${card.category}:${ownerOf(card)}`;
    picked.push(card); families.set(family, (families.get(family) || 0) + 1); owners.set(ownerKey, (owners.get(ownerKey) || 0) + 1); categories.set(card.category, (categories.get(card.category) || 0) + 1);
  }
  return picked;
}
export function nextMetricHistory(ranked, previous, now) {
  const history = {};
  for (const [url, observations] of Object.entries(previous?.metricHistory || {})) {
    const recent = observations.filter(h => ageHours(h.at, now) != null && ageHours(h.at, now) <= 48);
    if (recent.length) history[url] = recent.slice(-12);
  }
  for (const card of ranked) {
    if (card.category === "news") continue;
    const observation = { at: now.toISOString() };
    for (const key of ["stars", "likes"]) { const n = metric(card, key); if (finite(n)) observation[key] = n; }
    const old = history[card.url] || [];
    if (!old.length && card.category === "project" && finite(previous?.repositoryMetrics?.[card.name || card.title]) && ageHours(previous.generatedAt, now) != null && ageHours(previous.generatedAt, now) <= 48) old.push({ at: previous.generatedAt, stars: previous.repositoryMetrics[card.name || card.title] });
    // Refreshes minutes apart must not evict a useful six-hour baseline.
    if (!old.length || ageHours(old.at(-1).at, now) >= 1) old.push(observation);
    history[card.url] = old.slice(-12);
  }
  return history;
}
export function nextExposureHistory(cards, previous, now) {
  const history = Object.fromEntries(Object.entries(previous?.exposureHistory || {}).filter(([, h]) => ageHours(h.lastFeaturedAt, now) != null && ageHours(h.lastFeaturedAt, now) <= 7 * 24));
  for (const card of previous?.cards || []) {
    const url = canonicalUrl(card.url);
    if (!history[url] && ageHours(previous.generatedAt, now) != null && ageHours(previous.generatedAt, now) <= 7 * 24) history[url] = { lastFeaturedAt: previous.generatedAt };
  }
  const bucket = Math.floor(+now / (6 * HOUR));
  for (const card of cards) {
    const old = history[card.url];
    if (!old || Math.floor(Date.parse(old.lastFeaturedAt) / (6 * HOUR)) < bucket) history[card.url] = { lastFeaturedAt: now.toISOString() };
  }
  return history;
}
