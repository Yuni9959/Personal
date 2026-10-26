import { editionForRelease, resolvePublication } from "./schedule.js?v=20261026.1";
import { filterCards, isOldEdition, validateEdition, validUrl } from "./model.js?v=20261026.1";
import { editionKey, editionLabel, identityCard, occurrenceFor } from "./library.js?v=20261026.1";
import { openBookmarks, legacyBookmarks } from "./bookmarks.js?v=20261026.1";
const $ = selector => document.querySelector(selector);
const CACHE = "personal-tap-ai-trend-edition-v3";
const API = "https://personal-tap-data-yuni14.vercel.app/api/ai-trend";
const remote = !["localhost", "127.0.0.1", ""].includes(location.hostname);
let publicationTimer, serverOffset = 0, revision = null, storageFailed = false;
const displayTime = value => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
function scheduleRefresh(nextAt, retry = false) {
  clearTimeout(publicationTimer);
  if ($("#editionSelect").value !== "latest") return;
  const boundary = Date.parse(nextAt);
  const delay = retry || !Number.isFinite(boundary) ? 60000 : Math.max(250, boundary - (Date.now() + serverOffset) + 100);
  // Also discover manual reissues while this tab stays open.
  publicationTimer = setTimeout(() => { if (document.visibilityState === "visible") load({ silent: true }); }, Math.min(delay, 60000));
}
const saved = new Set(), library = new Map(), unsavedWrites = new Map();
let bookmarkStore = null, writeQueue = Promise.resolve(), writesInFlight = 0, bookmarkSyncPending = false;
let bookmarksReady = false;
const bookmarkChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("personal-tap-ai-bookmarks") : null;
let edition = null, filter = "all", activeCard = null, slide = 0, pending = null;
let feed = [], releases = [], catalog = [], catalogComplete = false, catalogPending = false;
let archivePending = false, archiveFailed = false, feedGeneration = 0, localManifest = null;
let activeEdition = null, returnFocus = null, returnScroll = 0, readerClosing = false;
const editionCache = new Map(), cardNodes = new Map();
const number = value => typeof value === "number" ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "—";
function node(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el;
}
function link(url, text, className) {
  const el = node("a", className, text); el.href = validUrl(url) || "#"; el.target = "_blank"; el.rel = "noopener noreferrer"; return el;
}
function status(text, warning = false) { $("#status").textContent = text; $("#status").dataset.warning = String(warning); }
function queueBookmark(id, record, recovering = false) {
  if (!bookmarkStore) { if (!recovering) unsavedWrites.set(id, record); storageFailed = true; return; }
  writesInFlight++; document.body.dataset.saving = "true";
  writeQueue = writeQueue.then(async () => {
    if (recovering) {
      const restored = await bookmarkStore.recover(record);
      if (!restored) bookmarkSyncPending = true;
      else if (library.get(id) === record) library.set(id, restored);
    } else if (record) await bookmarkStore.put(record);
    else await bookmarkStore.remove(id);
    unsavedWrites.delete(id); storageFailed = unsavedWrites.size > 0;
    bookmarkChannel?.postMessage({ changed: id });
  }).catch(() => {
    // Recovery is not a new save. Retry it conditionally from the committed row,
    // so a deletion in another tab cannot become an unconditional insert.
    if (!recovering) unsavedWrites.set(id, record);
    storageFailed = true;
    status("기기에 저장하지 못했습니다. 현재 화면의 변경은 유지되며 저장 탭에서 다시 시도할 수 있습니다.", true);
  }).finally(() => {
    writesInFlight--; document.body.dataset.saving = String(writesInFlight > 0);
    updateLibraryStatus();
    if (!writesInFlight && bookmarkSyncPending) { bookmarkSyncPending = false; void syncBookmarks(); }
  });
}
function applyBookmarks(records) {
  saved.clear(); library.clear();
  for (const record of records) { saved.add(record.id); if (record.card) library.set(record.id, record); }
  // A failed local change stays visible until retried; do not silently discard it.
  for (const [id, record] of unsavedWrites) {
    if (record) { saved.add(id); library.set(id, record); } else { saved.delete(id); library.delete(id); }
  }
}
async function syncBookmarks() {
  if (!bookmarkStore) return;
  if (writesInFlight) { bookmarkSyncPending = true; return; }
  try {
    const records = await bookmarkStore.list();
    if (writesInFlight) return;
    applyBookmarks(records); updateSavedButtons(); updateReaderSaved();
    if (filter === "saved") { updateTopics(); renderCards(); }
    updateLibraryStatus();
  } catch { storageFailed = true; updateLibraryStatus(); }
}
function rememberEdition(value) {
  editionCache.set(editionKey(value), value);
  for (const card of value.cards) if (saved.has(card.id) && !library.has(card.id)) {
    const record = { id: card.id, card, edition: editionInfo(value), savedAt: new Date().toISOString() };
    library.set(card.id, record); queueBookmark(card.id, record, true);
  }
}
function editionInfo(value) { return { schemaVersion: value.schemaVersion, date: value.date, generatedAt: value.generatedAt, publication: value.publication }; }
function toggleSaved(card, owner = activeEdition) {
  if (saved.has(card.id)) { saved.delete(card.id); library.delete(card.id); }
  else { saved.add(card.id); library.set(card.id, { id: card.id, card, edition: editionInfo(owner), savedAt: new Date().toISOString() }); }
  queueBookmark(card.id, library.get(card.id) || null);
  updateSavedButtons(); updateLibraryStatus(); updateReaderSaved();
  if (filter === "saved") { const y = scrollY; renderCards(); window.scrollTo(0, y); }
}
function updateSavedButtons() {
  // Updating a star must not replace the list, move focus, or reset the reader.
  for (const article of cardNodes.values()) {
    const button = article.querySelector(".save-button"); if (!button) continue;
    const on = saved.has(button.dataset.cardId);
    button.textContent = on ? "★" : "☆"; button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", `${button.dataset.title} ${on ? "저장 해제" : "저장"}`);
  }
}
function updateLibraryStatus() {
  $("#savedCount").textContent = saved.size;
  const missing = [...saved].filter(id => !library.has(id)).length;
  $("#libraryStatus").hidden = filter !== "saved";
  $("#libraryStatus").textContent = `모든 발행본에서 저장한 카드 ${library.size}개 · ${storageFailed ? "저장 공간을 사용할 수 없어 이번 화면에서만 유지됩니다." : writesInFlight ? "기기에 저장 중입니다…" : "이 기기에 보관됩니다."}${missing ? ` 이전 저장 ${missing}개는 보관 발행본에서 확인 중입니다. 보관 기간이 지난 원문은 복원되지 않을 수 있습니다.` : ""}`;
  $("#retrySaved").hidden = filter !== "saved" || !storageFailed;
}
function updateTopics() {
  const cards = filter === "saved" ? [...library.values()].map(r => r.card) : feed.flatMap(e => e.cards);
  const topics = [...new Set(cards.map(c => c.topic || c.tags[0]))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"));
  const selectedTopic = $("#topicSelect").value;
  $("#topicSelect").replaceChildren(new Option("모든 분야", "all"), ...topics.map(t => new Option(t, t)));
  $("#topicSelect").value = topics.includes(selectedTopic) ? selectedTopic : "all";
}
function repeatBadge(card, owner) {
  const badge = node("span", "repeat-badge");
  badge.dataset.cardId = card.id; badge.dataset.editionId = editionKey(owner);
  setRepeatBadge(badge, card, owner); return badge;
}
function setRepeatBadge(badge, card, owner) {
  const history = [...catalog, ...feed.map(e => ({ id: editionKey(e), cards: e.cards }))];
  const repeat = occurrenceFor(card, editionKey(owner), history);
  badge.hidden = repeat.count < 2;
  badge.textContent = `${catalogComplete ? "" : "확인된 "}${repeat.count}번째 선정 · ${repeat.repeats}회 재등장 · 중요도 높음`;
  badge.title = "최근 30일 공개 발행본 기준. 프로젝트명·원문 URL·공식 저장소를 비교합니다. 반복 선정에 따른 편집상 중요도이며 성능·품질 보증이 아닙니다.";
}
function updateRepeatBadges() {
  for (const badge of document.querySelectorAll(".repeat-badge")) {
    const owner = editionCache.get(badge.dataset.editionId) || [...library.values()].find(r => editionKey(r.edition) === badge.dataset.editionId && r.card.id === badge.dataset.cardId)?.edition;
    const card = owner?.cards?.find(c => c.id === badge.dataset.cardId) || library.get(badge.dataset.cardId)?.card;
    if (card && owner) setRepeatBadge(badge, card, owner);
  }
  if (activeCard) setRepeatBadge($("#readerRepeat"), activeCard, activeEdition);
}
function createCard(card, owner) {
    const article = node("article", "trend-card"); article.dataset.category = card.category; article.dataset.cardId = card.id; article.dataset.editionId = editionKey(owner);
    const cover = node("div", "card-cover"); const top = node("div", "cover-top");
    top.append(node("span", "topic-badge", card.topic || card.tags[0]));
    const save = node("button", "save-button", saved.has(card.id) ? "★" : "☆"); save.type = "button"; save.dataset.cardId = card.id; save.dataset.title = card.title; save.setAttribute("aria-label", `${card.title} ${saved.has(card.id) ? "저장 해제" : "저장"}`); save.setAttribute("aria-pressed", String(saved.has(card.id))); save.onclick = () => toggleSaved(card, owner); top.append(save);
    cover.append(top, node("h3", "cover-title", card.category === "news" && card.headline ? card.headline : card.title), node("span", "cover-category", `${card.source} · ${card.channel === "research" ? "논문·연구" : { project: "오픈소스 프로젝트", model: "AI 모델", news: "AI 소식" }[card.category]}`));
    const body = node("div", "card-body");
    body.append(node("p", "card-edition", `${editionLabel(owner)} 발행`), repeatBadge(card, owner));
    if (card.headline && card.category !== "news") body.append(node("h4", "card-headline", card.headline));
    body.append(node("span", "card-tag", card.signalLabel), node("p", "card-summary", card.summary));
    if (card.selection?.signals?.length) {
      const details = node("details", "selection-reasons");
      details.append(node("summary", "", "선정 이유"));
      const list = node("ul", "");
      for (const signal of card.selection.signals.slice(0, 4)) { const item = node("li", ""); item.append(link(signal.url, signal.label, "")); list.append(item); }
      details.append(list, node("p", "", `${card.selection.repeated ? "최근 소개 항목으로 반복 노출 감점을 적용했습니다. " : ""}관심 신호이며 성능·품질 순위가 아닙니다.`));
      body.append(details);
    }
    if (card.reviewedAt) body.append(node("p", "review-time", `내용 검토 ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(card.reviewedAt))}`));
    const stats = node("div", "stats");
    for (const stat of card.stats) { const el = node("span", "stat"); el.append(node("strong", "", `${number(stat.value)}${(stat.suffix || "").replace("stars", "별").replace("forks", "포크")}`), document.createTextNode(({ Stars: "별", Downloads: "다운로드", Likes: "좋아요" })[stat.label] || stat.label)); stats.append(el); }
    if (card.publishedAt) { const date = new Date(card.publishedAt); if (Number.isFinite(date.getTime())) stats.append(node("span", "stat", `공개 ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" }).format(date)}`)); }
    const bottom = node("div", "card-bottom"); const read = node("button", "read-button", "카드뉴스 읽기"); read.type = "button"; read.append(node("span", "", `${card.slides.length}장 ↗`)); read.onclick = () => openReader(card, owner, read);
    bottom.append(read, link(card.url, "원문 ↗", "source-link")); body.append(stats, bottom); article.append(cover, body); return article;
}
function renderCards() {
  const grid = $("#cardGrid"), desired = [];
  const groups = filter === "saved" ? [{ records: [...library.values()].sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || "")) }] : feed.map(owner => ({ owner, records: owner.cards.map(card => ({ card, edition: owner })) }));
  let count = 0;
  for (const [index, group] of groups.entries()) {
    const records = group.records.filter(r => filterCards([r.card], { filter: filter === "saved" ? "all" : filter, topic: $("#topicSelect").value, query: $("#searchInput").value }).length);
    if (!records.length) continue;
    if (index > 0 && group.owner) {
      const key = `heading:${editionKey(group.owner)}`;
      if (!cardNodes.has(key)) { const heading = node("h3", "edition-divider", `${editionLabel(group.owner)} · 이전 발행본`); heading.dataset.editionId = editionKey(group.owner); cardNodes.set(key, heading); }
      desired.push(cardNodes.get(key));
    }
    for (const record of records) {
      const key = `${filter === "saved" ? "saved:" : ""}${editionKey(record.edition)}:${record.card.id}`;
      if (!cardNodes.has(key)) cardNodes.set(key, createCard(record.card, record.edition));
      desired.push(cardNodes.get(key)); count++;
    }
  }
  const keep = new Set(desired);
  for (const child of [...grid.children]) if (!keep.has(child)) child.remove();
  desired.forEach((child, i) => { if (grid.children[i] !== child) grid.insertBefore(child, grid.children[i] || null); });
  $("#resultCount").textContent = String(count).padStart(2, "0");
  $("#feedLabel").textContent = filter === "saved" ? "저장한 발견" : "오늘의 발견";
  $("#emptyState").hidden = count > 0;
  $("#emptyMessage").textContent = filter === "saved" ? "카드의 ☆를 누르면 발행일과 관계없이 여기에 모입니다. 검색과 분야 조건도 확인해 보세요." : "다른 검색어나 분류를 선택하거나 이전 발행본을 이어서 확인해 보세요.";
  updateLibraryStatus(); updateArchiveControl();
}
function olderEntries() {
  const last = feed.at(-1); if (!last) return [];
  return releases.filter(e => e.id < editionKey(last) && !feed.some(f => editionKey(f) === e.id));
}
function updateArchiveControl() {
  const remaining = olderEntries();
  $("#archiveControl").hidden = filter === "saved" || !edition;
  $("#loadOlder").hidden = !remaining.length;
  $("#loadOlder").disabled = archivePending;
  $("#loadOlder").textContent = archivePending ? "이전 발행본 불러오는 중…" : archiveFailed ? "다시 불러오기" : "이전 발행본 이어서 보기 ↓";
  $("#archiveStatus").textContent = archiveFailed ? "이전 발행본을 받지 못했습니다. 연결 후 다시 시도해 주세요." : remaining.length ? `${remaining[0].id.slice(0, 10)} 발행본이 아래로 이어집니다.` : "보관된 발행본을 모두 확인했어요. 최근 30일의 기록을 제공합니다.";
}
async function readOlder(id, signal) {
  if (editionCache.has(id)) return editionCache.get(id);
  let value;
  if (remote) { const p = await json(`${API}?edition=${encodeURIComponent(id)}&t=${Date.now()}`, signal); value = editionForRelease(validateEdition(p.edition), p.entry); }
  else if (localManifest) { const entry = localManifest.releases.find(e => e.id === id); value = editionForRelease(validateEdition(await json(`./data/${entry.path}`, signal)), entry); }
  else value = validateEdition(await json(`./data/archive/${id}.json`, signal));
  if (editionKey(value) !== id) throw new Error("다른 발행본 응답");
  return value;
}
async function loadOlder() {
  if (archivePending || filter === "saved") return;
  const next = olderEntries()[0]; if (!next) return;
  const generation = feedGeneration;
  archivePending = true; archiveFailed = false; updateArchiveControl();
  try {
    const value = await readOlder(next.id, AbortSignal.timeout(12000));
    if (generation !== feedGeneration) return;
    rememberEdition(value); feed.push(value); updateTopics(); renderCards(); updateRepeatBadges();
  } catch { if (generation === feedGeneration) archiveFailed = true; }
  finally { if (generation === feedGeneration) { archivePending = false; updateArchiveControl(); } }
}
async function loadCatalog() {
  if (catalogPending) return;
  catalogPending = true;
  try {
    if (remote) {
      const result = await json(`${API}?catalog=1&t=${Date.now()}`, AbortSignal.timeout(12000));
      if (!Array.isArray(result.catalog)) throw new Error("발행 색인 오류");
      catalog = result.catalog.filter(e => releases.some(r => r.id === e.id)); catalogComplete = result.complete === true;
    } else {
      const results = await Promise.allSettled(releases.map(async entry => {
        const value = await readOlder(entry.id, AbortSignal.timeout(12000));
        editionCache.set(entry.id, value); return { id: entry.id, cards: value.cards.map(identityCard) };
      }));
      catalog = results.filter(r => r.status === "fulfilled").map(r => r.value); catalogComplete = results.every(r => r.status === "fulfilled");
    }
    updateRepeatBadges();
    // Recover old ID-only bookmarks from any retained issue, without changing the feed.
    const missing = new Set([...saved].filter(id => !library.has(id)));
    for (const entry of catalog) {
      if (!entry.cards.some(c => missing.has(c.id))) continue;
      try { const value = await readOlder(entry.id, AbortSignal.timeout(12000)); rememberEdition(value); for (const c of value.cards) missing.delete(c.id); } catch {}
    }
    if (filter === "saved") { updateTopics(); renderCards(); }
    updateLibraryStatus();
  } catch { catalogComplete = false; }
  finally { catalogPending = false; }
}
function resetFeed(value) {
  feedGeneration++; archivePending = false; archiveFailed = false;
  feed = [value]; cardNodes.clear(); rememberEdition(value);
}
function renderEdition() {
  updateTopics();
  const topics = [...new Set(edition.cards.map(c => c.topic || c.tags[0]))];
  $("#editionDate").textContent = editionLabel(edition).replaceAll("-", ".");
  $("#editionCount").textContent = `${edition.cards.length}개의 발견 · ${topics.length}개 분야${edition.candidateCount ? ` · 후보 ${edition.candidateCount}개에서 선정` : ""}`;
  const updated = edition.publication?.reissuedAt || edition.publication?.scheduledAt;
  $("#editionUpdated").hidden = !updated;
  $("#editionUpdated").textContent = updated ? `${displayTime(updated)} ${edition.publication.reissuedAt ? "재발행" : "발행"} · KST` : "";
  $("#editorial").textContent = edition.editorial;
  $("#researchStatus").textContent = edition.pendingCount ? `게시된 ${edition.cards.length}개 카드 외 추가 후보 ${edition.pendingCount}개는 심층 요약 검토 중입니다.` : "";
  const sources = Array.isArray(edition.sources) ? edition.sources : [];
  $("#sourceCount").textContent = `${sources.filter(s => s.status === "ok").length}/${sources.length} 출처 수집`;
  $("#sourceList").replaceChildren(...sources.filter(s => validUrl(s.url)).map(source => link(source.url, `${source.status === "ok" ? "●" : "○"} ${source.name} · ${source.count ?? "수집 실패"}`, "")));
  renderCards();
}
function renderSlide() {
  const page = activeCard.slides[slide];
  $("#readerSource").textContent = `${activeCard.source} / ${activeCard.tags[0]}`;
  $("#readerProject").textContent = activeCard.title;
  $("#readerEdition").textContent = `${editionLabel(activeEdition)} 발행`;
  const panels = [...document.querySelectorAll(".slide-panel")];
  for (const [index, panel] of panels.entries()) {
    panel.inert = index !== slide; panel.setAttribute("aria-hidden", String(index !== slide));
    panel.querySelector("h2").id = index === slide ? "readerTitle" : `readerTitle-${index}`;
    panel.querySelector(".slide-body").id = index === slide ? "slideBody" : `slideBody-${index}`;
  }
  $("#slideTrack").style.transform = `translate3d(${-slide * 100}%,0,0)`;
  $("#slidePosition").textContent = `${slide + 1} / ${activeCard.slides.length}`;
  $("#slideDots").replaceChildren(...activeCard.slides.map((_, index) => {
    const dot = node("button", `slide-dot${index === slide ? " active" : ""}`); dot.type = "button";
    dot.setAttribute("aria-label", `${index + 1}번째 장으로 이동`); dot.setAttribute("aria-current", String(index === slide));
    dot.onclick = () => moveSlide(index - slide); return dot;
  }));
  $("#previousSlide").disabled = slide === 0; $("#nextSlide").disabled = slide === activeCard.slides.length - 1;
  const sources = (activeCard.evidence || []).filter(e => page.evidenceIds?.includes(e.id));
  $("#slideSources").replaceChildren(...sources.map(e => link(e.url, `${e.label} ↗`, "slide-citation")));
  $("#readerLink").href = activeCard.url;
  setRepeatBadge($("#readerRepeat"), activeCard, activeEdition);
  updateReaderSaved();
}
function updateReaderSaved() {
  if (!activeCard) return;
  $("#readerSave").textContent = saved.has(activeCard.id) ? "★ 저장됨" : "☆ 저장";
  $("#readerSave").setAttribute("aria-pressed", String(saved.has(activeCard.id)));
}
function openReader(card, owner, trigger, fromHistory = false, initialSlide = 0) {
  if (readerClosing) return;
  activeCard = card; activeEdition = owner; slide = initialSlide;
  returnFocus = trigger || document.activeElement; returnScroll = scrollY;
  $("#reader").dataset.category = card.category;
  $("#slideTrack").replaceChildren(...card.slides.map((page, index) => {
    const panel = node("section", "slide-panel"); panel.setAttribute("aria-label", `${index + 1} / ${card.slides.length}`);
    panel.append(node("p", "eyebrow", page.eyebrow || `${index + 1} / ${card.slides.length}`), node("h2", "", page.title), node("p", "slide-body", page.body)); return panel;
  }));
  $("#slideTrack").classList.add("no-motion"); renderSlide();
  document.body.classList.add("reader-open"); $("#reader").showModal();
  $("#closeReader").focus({ preventScroll: true });
  requestAnimationFrame(() => $("#slideTrack").classList.remove("no-motion"));
  if (!fromHistory) history.pushState({ ...history.state, aiReader: { cardId: card.id, editionId: editionKey(owner), slide } }, "");
}
function hideReader() {
  if (!$("#reader").open) return;
  $("#reader").close(); document.body.classList.remove("reader-open");
  activeCard = null; activeEdition = null;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  window.scrollTo({ top: returnScroll, behavior: "instant" });
}
function closeReader() {
  if (readerClosing || !$("#reader").open) return;
  hideReader();
  if (history.state?.aiReader) { readerClosing = true; history.back(); }
}
function moveSlide(delta) {
  if (!activeCard) return;
  slide = Math.min(activeCard.slides.length - 1, Math.max(0, slide + delta)); renderSlide();
  if (history.state?.aiReader) history.replaceState({ ...history.state, aiReader: { ...history.state.aiReader, slide } }, "");
}
async function json(url, signal) {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function load({ selected = $("#editionSelect").value, silent = false } = {}) {
  if (!bookmarksReady) return;
  clearTimeout(publicationTimer);
  pending?.abort(); const controller = new AbortController(); pending = controller;
  const timeout = setTimeout(() => controller.abort(), 12000);
  $("#refreshBtn").disabled = true;
  if (!silent) status("발행본을 확인하고 있습니다…");
  try {
    let publication = null, next;
    if (remote) {
      publication = await json(`${API}?edition=${encodeURIComponent(selected)}&t=${Date.now()}`, controller.signal);
      if (!Number.isFinite(Date.parse(publication.serverNow))) throw new Error("서버 시각 오류");
      serverOffset = Date.parse(publication.serverNow) - Date.now();
      next = editionForRelease(validateEdition(publication.edition), publication.entry);
    } else {
      // Local preview uses the same release policy, with legacy fixtures supported.
      let manifest = null;
      if (new URLSearchParams(location.search).has("scheduled-preview")) manifest = await json(`./data/release-manifest.json?t=${Date.now()}`, controller.signal);
      if (manifest) {
        localManifest = manifest;
        publication = resolvePublication(manifest, new Date(), selected);
        if (!publication.entry) throw new Error("공개 전 발행본");
        next = editionForRelease(validateEdition(await json(`./data/${publication.entry.path}`, controller.signal)), publication.entry);
      } else {
        next = validateEdition(await json(`${selected === "latest" ? "./data/latest.json" : `./data/archive/${selected}.json`}?t=${Date.now()}`, controller.signal));
      }
    }
    if (controller !== pending) return;
    const nextRevision = publication?.entry.path || JSON.stringify(next);
    const changed = nextRevision !== revision;
    edition = next; revision = nextRevision;
    if (changed) { resetFeed(edition); renderEdition(); }
    if (selected === "latest" && changed) { try { localStorage.setItem(CACHE, JSON.stringify(edition)); } catch {} }
    const errors = edition.sources?.filter(s => s.status !== "ok").length || 0;
    const old = selected === "latest" && (publication ? publication.delayed : isOldEdition(edition));
    const oldReviews = edition.cards.filter(c => c.reviewedAt && Date.now() + serverOffset - Date.parse(c.reviewedAt) > 24 * 3600000).length;
    const reviewText = oldReviews ? ` · ${oldReviews}개 카드 내용 재검토 대기` : "";
    const legacy = edition.schemaVersion === 1 ? "이전 형식의 보관본입니다. " : "";
    const issue = edition.publication;
    const issueText = issue ? `${displayTime(issue.scheduledAt)} 발행본${issue.reissuedAt ? ` · ${displayTime(issue.reissuedAt)} 재발행` : Date.parse(issue.preparedAt) > Date.parse(issue.scheduledAt) ? " · 지연 준비" : ""} · 자료 수집 ${displayTime(edition.generatedAt)}` : `${displayTime(edition.generatedAt)} KST 수집`;
    const confirmed = remote ? `서버 확인 ${displayTime(publication.serverNow)} KST. ` : "";
    status(`${confirmed}${legacy}${old ? "예정 발행본이 지연되어 마지막 검증 발행본을 표시합니다. " : ""}${issueText} · ${edition.cards.length}개 카드${errors ? ` · ${errors}개 출처 수집 실패` : ""}${reviewText}${edition.collectionWarning ? ` · ${edition.collectionWarning}` : ""}`, old || errors > 0 || oldReviews > 0 || !!legacy);
    const select = $("#editionSelect");
    if (publication) {
      releases = publication.releases;
      select.replaceChildren(new Option("최신 발행본", "latest"), ...publication.releases.map(e => new Option(editionLabel({ date: e.id.slice(0, 10), publication: e }), e.id)));
      select.value = selected;
      $("#nextPublication").textContent = selected === "latest" ? `다음 발행 ${displayTime(publication.nextPublishAt)} KST · 1분마다 최신본 확인` : "지난 발행본을 보고 있습니다";
      if (selected === "latest") scheduleRefresh(publication.nextPublishAt, old);
    } else {
      try {
        const index = await json(`./data/index.json?t=${Date.now()}`, controller.signal);
        if (controller !== pending || !Array.isArray(index.dates)) return;
        releases = index.dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().reverse().slice(0, 30).map(id => ({ id }));
        select.replaceChildren(new Option("최신 발행본", "latest"), ...releases.map(e => new Option(e.id, e.id)));
        select.value = selected;
      } catch {}
    }
    updateArchiveControl();
    if (changed || !catalogComplete) void loadCatalog();
  } catch (error) {
    if (controller !== pending) return;
    if (!edition && selected === "latest") {
      try { edition = validateEdition(JSON.parse(localStorage.getItem(CACHE))); resetFeed(edition); renderEdition(); } catch {}
    }
    status(edition ? `새 발행본을 받지 못했습니다. ${edition.date} 발행본을 유지합니다. ${navigator.onLine ? "1분 뒤 자동으로 다시 확인합니다." : "오프라인 보관본입니다."}` : "발행본을 불러오지 못했습니다. 1분 뒤 자동으로 다시 확인합니다.", true);
    $("#nextPublication").textContent = navigator.onLine ? "서버 연결 재확인 중" : "오프라인 · 저장된 발행본";
    if (!edition) { $("#emptyState").hidden = false; $("#emptyMessage").textContent = "인터넷 연결 후 새로고침하면 최신 카드를 받을 수 있습니다."; }
    if (selected === "latest") scheduleRefresh(null, true);
  } finally {
    clearTimeout(timeout);
    if (controller === pending) { $("#refreshBtn").disabled = false; document.body.dataset.ready = "true"; }
  }
}
for (const button of document.querySelectorAll("[data-filter]")) button.onclick = () => {
  filter = button.dataset.filter;
  for (const el of document.querySelectorAll("[data-filter]")) { el.classList.toggle("active", el === button); el.setAttribute("aria-pressed", String(el === button)); }
  cardNodes.clear(); updateTopics(); renderCards();
};
$("#searchInput").addEventListener("input", renderCards);
$("#topicSelect").onchange = renderCards;
$("#refreshBtn").onclick = () => { $("#editionSelect").value = "latest"; load({ selected: "latest" }); };
$("#editionSelect").onchange = () => load();
$("#closeReader").onclick = closeReader;
$("#previousSlide").onclick = () => moveSlide(-1); $("#nextSlide").onclick = () => moveSlide(1);
$("#readerSave").onclick = () => toggleSaved(activeCard);
$("#reader").addEventListener("keydown", event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); moveSlide(event.key === "ArrowRight" ? 1 : -1); } });
$("#reader").addEventListener("cancel", event => { event.preventDefault(); closeReader(); });
$("#reader").addEventListener("click", event => { if (event.target === $("#reader")) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeReader(); } });
let gesture = null;
const viewport = $("#slideContent"), track = $("#slideTrack");
viewport.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: false };
});
viewport.addEventListener("pointermove", event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (!gesture.horizontal && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
    if (Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
    gesture.horizontal = true; viewport.setPointerCapture(event.pointerId); track.classList.add("dragging");
  }
  if (!gesture.horizontal) return;
  gesture.dx = dx;
  const offset = (slide === 0 && dx > 0 || slide === activeCard.slides.length - 1 && dx < 0) ? dx / 4 : dx;
  track.style.transform = `translate3d(calc(${-slide * 100}% + ${offset}px),0,0)`;
});
function endGesture(event) {
  if (!gesture || gesture.id !== event.pointerId) return;
  const { dx, horizontal } = gesture; gesture = null; track.classList.remove("dragging");
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  if (horizontal) moveSlide(event.type !== "pointercancel" && Math.abs(dx) > Math.min(70, viewport.clientWidth * .18) ? (dx < 0 ? 1 : -1) : 0);
}
viewport.addEventListener("pointerup", endGesture); viewport.addEventListener("pointercancel", endGesture);
window.addEventListener("popstate", event => {
  readerClosing = false;
  if (!event.state?.aiReader) { hideReader(); return; }
  const { cardId, editionId, slide: index } = event.state.aiReader;
  const owner = editionCache.get(editionId) || library.get(cardId)?.edition;
  const card = owner?.cards?.find(c => c.id === cardId) || library.get(cardId)?.card;
  if (card && owner && !$("#reader").open) openReader(card, owner, null, true, Math.min(index || 0, card.slides.length - 1));
});
// A reload has no open modal; remove only our transient marker.
if (history.state?.aiReader) { const state = { ...history.state }; delete state.aiReader; history.replaceState(state, ""); }
$("#loadOlder").onclick = () => loadOlder();
const observer = new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting) && !archiveFailed && !activeCard && filter !== "saved" && !$("#searchInput").value && $("#topicSelect").value === "all") void loadOlder();
}, { rootMargin: "0px 0px 180px 0px" });
observer.observe($("#archiveControl"));
window.addEventListener("online", () => load());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && $("#editionSelect").value === "latest") load(); });
$("#retrySaved").onclick = async () => {
  if (writesInFlight) return;
  try {
    bookmarkStore?.close(); bookmarkStore = null;
    bookmarkStore = await openBookmarks(); applyBookmarks(await bookmarkStore.list());
    storageFailed = unsavedWrites.size > 0;
    for (const value of editionCache.values()) rememberEdition(value);
    for (const [id, record] of unsavedWrites) queueBookmark(id, record);
    updateSavedButtons(); updateReaderSaved(); updateTopics(); renderCards();
  } catch {
    storageFailed = true; updateLibraryStatus();
    status("기기 저장소를 아직 사용할 수 없습니다. 다른 탭을 닫거나 저장 공간을 확인해 주세요.", true);
  }
};
bookmarkChannel?.addEventListener("message", () => syncBookmarks());
window.addEventListener("focus", () => syncBookmarks());
try { bookmarkStore = await openBookmarks(); applyBookmarks(await bookmarkStore.list()); }
catch { storageFailed = true; try { applyBookmarks(legacyBookmarks(localStorage)); } catch {} }
bookmarksReady = true; updateLibraryStatus(); load();
