import { filterCards, isOldEdition, validateEdition, validUrl } from "./model.js";
const $ = selector => document.querySelector(selector);
const STORAGE = "personal-tap-ai-trend-saved-v1";
const CACHE = "personal-tap-ai-trend-edition-v2";
let saved;
try { saved = new Set(JSON.parse(localStorage.getItem(STORAGE) || "[]")); } catch { saved = new Set(); }
let edition = null, filter = "all", activeCard = null, slide = 0, pending = null;
const number = value => typeof value === "number" ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "—";
function node(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el;
}
function link(url, text, className) {
  const el = node("a", className, text); el.href = validUrl(url) || "#"; el.target = "_blank"; el.rel = "noopener noreferrer"; return el;
}
function status(text, warning = false) { $("#status").textContent = text; $("#status").dataset.warning = String(warning); }
function toggleSaved(card) {
  if (saved.has(card.id)) saved.delete(card.id); else saved.add(card.id);
  try { localStorage.setItem(STORAGE, JSON.stringify([...saved])); }
  catch { status("저장 공간을 사용할 수 없어 이번 화면에서만 관심 항목을 유지합니다.", true); }
  renderCards(); if (activeCard) renderSlide();
}
function renderCards() {
  const grid = $("#cardGrid"); grid.replaceChildren();
  const cards = filterCards(edition?.cards || [], { filter, topic: $("#topicSelect").value, query: $("#searchInput").value, saved });
  $("#resultCount").textContent = String(cards.length).padStart(2, "0");
  $("#emptyState").hidden = cards.length > 0;
  $("#emptyMessage").textContent = filter === "saved" ? "이 발행본에서 관심 있는 카드의 ☆를 눌러 저장해 보세요." : "다른 검색어나 분류를 선택해 보세요.";
  for (const card of cards) {
    const article = node("article", "trend-card"); article.dataset.category = card.category;
    const cover = node("div", "card-cover"); const top = node("div", "cover-top");
    top.append(node("span", "topic-badge", card.topic || card.tags[0]));
    const save = node("button", "save-button", saved.has(card.id) ? "★" : "☆"); save.type = "button"; save.setAttribute("aria-label", `${card.title} ${saved.has(card.id) ? "저장 해제" : "저장"}`); save.setAttribute("aria-pressed", String(saved.has(card.id))); save.onclick = () => toggleSaved(card); top.append(save);
    cover.append(top, node("h3", "cover-title", card.category === "news" && card.headline ? card.headline : card.title), node("span", "cover-category", `${card.source} · ${{ project: "오픈소스 프로젝트", model: "AI 모델", news: "AI 소식" }[card.category]}`));
    const body = node("div", "card-body");
    if (card.headline && card.category !== "news") body.append(node("h4", "card-headline", card.headline));
    body.append(node("span", "card-tag", card.signalLabel), node("p", "card-summary", card.summary));
    if (card.reviewedAt) body.append(node("p", "review-time", `내용 검토 ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(card.reviewedAt))}`));
    const stats = node("div", "stats");
    for (const stat of card.stats) { const el = node("span", "stat"); el.append(node("strong", "", `${number(stat.value)}${(stat.suffix || "").replace("stars", "별").replace("forks", "포크")}`), document.createTextNode(({ Stars: "별", Downloads: "다운로드", Likes: "좋아요" })[stat.label] || stat.label)); stats.append(el); }
    if (card.publishedAt) { const date = new Date(card.publishedAt); if (Number.isFinite(date.getTime())) stats.append(node("span", "stat", `공개 ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" }).format(date)}`)); }
    const bottom = node("div", "card-bottom"); const read = node("button", "read-button", "카드뉴스 읽기"); read.type = "button"; read.append(node("span", "", `${card.slides.length}장 ↗`)); read.onclick = () => openReader(card);
    bottom.append(read, link(card.url, "원문 ↗", "source-link")); body.append(stats, bottom); article.append(cover, body); grid.append(article);
  }
}
function renderEdition() {
  const topics = [...new Set(edition.cards.map(c => c.topic || c.tags[0]))].sort((a, b) => a.localeCompare(b, "ko"));
  const selectedTopic = $("#topicSelect").value;
  $("#topicSelect").replaceChildren(new Option("모든 분야", "all"), ...topics.map(t => new Option(t, t)));
  $("#topicSelect").value = topics.includes(selectedTopic) ? selectedTopic : "all";
  $("#editionDate").textContent = edition.date.replaceAll("-", ".");
  $("#editionCount").textContent = `${edition.cards.length}개의 발견 · ${topics.length}개 분야 · 프로젝트 / 모델 / 소식`;
  $("#editorial").textContent = edition.editorial;
  const sources = Array.isArray(edition.sources) ? edition.sources : [];
  $("#sourceCount").textContent = `${sources.filter(s => s.status === "ok").length}/${sources.length} 출처 수집`;
  $("#sourceList").replaceChildren(...sources.filter(s => validUrl(s.url)).map(source => link(source.url, `${source.status === "ok" ? "●" : "○"} ${source.name} · ${source.count ?? "수집 실패"}`, "")));
  renderCards();
}
function renderSlide() {
  const page = activeCard.slides[slide];
  $("#readerSource").textContent = `${activeCard.source} / ${activeCard.tags[0]}`;
  $("#slideEyebrow").textContent = page.eyebrow;
  $("#readerTitle").textContent = page.title; $("#slideBody").textContent = page.body;
  $("#slidePosition").textContent = `${slide + 1} / ${activeCard.slides.length}`;
  $("#slideDots").replaceChildren(...activeCard.slides.map((_, index) => node("span", `slide-dot${index === slide ? " active" : ""}`)));
  $("#previousSlide").disabled = slide === 0; $("#nextSlide").disabled = slide === activeCard.slides.length - 1;
  const sources = (activeCard.evidence || []).filter(e => page.evidenceIds?.includes(e.id));
  $("#slideSources").replaceChildren(...sources.map(e => link(e.url, `${e.label} ↗`, "slide-citation")));
  $("#readerLink").href = activeCard.url;
  $("#readerSave").textContent = saved.has(activeCard.id) ? "★ 저장됨" : "☆ 저장";
  $("#readerSave").setAttribute("aria-pressed", String(saved.has(activeCard.id)));
}
function openReader(card) { activeCard = card; slide = 0; renderSlide(); $("#reader").showModal(); }
function moveSlide(delta) { if (!activeCard) return; slide = Math.min(activeCard.slides.length - 1, Math.max(0, slide + delta)); renderSlide(); }
async function json(url, signal) {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function load({ selected = $("#editionSelect").value } = {}) {
  pending?.abort(); const controller = new AbortController(); pending = controller;
  const timeout = setTimeout(() => controller.abort(), 12000);
  $("#refreshBtn").disabled = true; status("발행본을 확인하고 있습니다…");
  try {
    const url = selected === "latest" ? "./data/latest.json" : `./data/archive/${selected}.json`;
    const next = validateEdition(await json(`${url}?t=${Date.now()}`, controller.signal));
    if (selected !== "latest" && next.date !== selected) throw new Error("발행일 불일치");
    if (controller !== pending) return;
    edition = next; renderEdition();
    if (selected === "latest") { try { localStorage.setItem(CACHE, JSON.stringify(edition)); } catch { /* Offline service worker remains available. */ } }
    const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }).format(new Date(edition.generatedAt));
    const errors = edition.sources?.filter(s => s.status !== "ok").length || 0;
    const old = selected === "latest" && isOldEdition(edition);
    const pendingText = edition.pendingCount ? ` · 새 항목 ${edition.pendingCount}개 심층 요약 대기` : "";
    const oldReviewCount = edition.cards.filter(c => c.reviewedAt && Date.now() - Date.parse(c.reviewedAt) > 8 * 3600000).length;
    const reviewText = oldReviewCount ? ` · ${oldReviewCount}개 카드 내용 재검토 대기` : "";
    const legacy = edition.schemaVersion === 1 ? "이전 형식의 보관본입니다. " : "";
    status(`${legacy}${old ? "마지막 검증 발행본을 표시합니다. " : ""}${edition.date} ${time} KST 수집 · ${edition.cards.length}개 카드${errors ? ` · ${errors}개 출처 수집 실패` : ""}${pendingText}${reviewText}${edition.collectionWarning ? ` · ${edition.collectionWarning}` : ""}`, old || errors > 0 || edition.pendingCount > 0 || oldReviewCount > 0 || !!legacy);
    document.body.dataset.ready = "true";
    try {
      const index = await json(`./data/index.json?t=${Date.now()}`, controller.signal);
      if (controller !== pending || !Array.isArray(index.dates)) return;
      const select = $("#editionSelect");
      select.replaceChildren(new Option("최신 발행본", "latest"), ...index.dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).slice(0, 30).map(date => new Option(date, date)));
      select.value = selected;
    } catch { /* Current edition is still readable if the archive index fails. */ }
  } catch (error) {
    if (controller !== pending) return;
    if (!edition && selected === "latest") {
      try { edition = validateEdition(JSON.parse(localStorage.getItem(CACHE))); renderEdition(); } catch { /* No verified cached edition. */ }
    }
    status(edition ? `새 발행본을 받지 못했습니다. ${edition.date} 발행본을 유지합니다. ${navigator.onLine ? "잠시 후 새로고침해 주세요." : "오프라인 보관본입니다."}` : "발행본을 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.", true);
    if (!edition) { $("#emptyState").hidden = false; $("#emptyMessage").textContent = "인터넷 연결 후 새로고침하면 최신 카드를 받을 수 있습니다."; }
  } finally {
    clearTimeout(timeout);
    if (controller === pending) { $("#refreshBtn").disabled = false; document.body.dataset.ready = "true"; }
  }
}
for (const button of document.querySelectorAll("[data-filter]")) button.onclick = () => {
  filter = button.dataset.filter;
  for (const el of document.querySelectorAll("[data-filter]")) { el.classList.toggle("active", el === button); el.setAttribute("aria-pressed", String(el === button)); }
  renderCards();
};
$("#searchInput").addEventListener("input", renderCards);
$("#topicSelect").onchange = renderCards;
$("#refreshBtn").onclick = () => load(); $("#editionSelect").onchange = () => load();
$("#closeReader").onclick = () => $("#reader").close();
$("#previousSlide").onclick = () => moveSlide(-1); $("#nextSlide").onclick = () => moveSlide(1);
$("#readerSave").onclick = () => toggleSaved(activeCard);
$("#reader").addEventListener("keydown", event => { if (event.key === "ArrowRight") moveSlide(1); if (event.key === "ArrowLeft") moveSlide(-1); });
$("#reader").addEventListener("click", event => { if (event.target === $("#reader")) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
let touchX = null;
$("#slideContent").addEventListener("touchstart", event => { touchX = event.touches[0]?.clientX ?? null; }, { passive: true });
$("#slideContent").addEventListener("touchend", event => { const x = event.changedTouches[0]?.clientX; if (touchX != null && x != null && Math.abs(x - touchX) > 50) moveSlide(x < touchX ? 1 : -1); touchX = null; }, { passive: true });
window.addEventListener("online", () => load());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && edition && isOldEdition(edition) && $("#editionSelect").value === "latest") load(); });
load();
