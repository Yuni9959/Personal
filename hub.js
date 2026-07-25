(() => {
  "use strict";

  const apps = Array.isArray(window.PERSONAL_TAP_APPS) ? window.PERSONAL_TAP_APPS : [];
  const RECENT_KEY = "personal-tap-recent-v1";
  const MKAT_KEY = "mkat98-stats-v1";

  const $ = selector => document.querySelector(selector);
  const els = {
    appGrid: $("#appGrid"),
    greeting: $("#greeting"),
    todayLabel: $("#todayLabel"),
    focusSummary: $("#focusSummary"),
    lastOpened: $("#lastOpened"),
    connectionBadge: $("#connectionBadge"),
    installBtn: $("#installBtn")
  };

  let installPrompt = null;

  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function setGreeting() {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 6 ? "늦은 밤이에요." :
      hour < 12 ? "좋은 아침이에요." :
      hour < 18 ? "좋은 오후예요." : "편안한 저녁이에요.";

    const formatted = new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(now);

    els.greeting.textContent = greeting;
    els.todayLabel.textContent = formatted;
  }

  function readMkatStats() {
    try {
      const stats = JSON.parse(localStorage.getItem(MKAT_KEY) || "{}");
      const attempts = Number(stats.attempts || 0);
      const correct = Number(stats.correct || 0);
      const streak = Number(stats.streak || 0);
      const solvedToday = Number(stats.solvedByDate?.[localDateKey()] || 0);
      const accuracy = attempts ? Math.round((correct / attempts) * 100) : null;
      return { attempts, correct, streak, solvedToday, accuracy };
    } catch {
      return { attempts: 0, correct: 0, streak: 0, solvedToday: 0, accuracy: null };
    }
  }

  function mkatMetricText() {
    const s = readMkatStats();
    if (!s.attempts) return "아직 훈련 기록이 없습니다. 오늘의 10문제로 시작하세요.";
    return `오늘 ${s.solvedToday}문제 · 누적 정확도 ${s.accuracy}% · ${s.streak}일 연속`;
  }

  function updateFocus() {
    const s = readMkatStats();
    if (!s.attempts) {
      els.focusSummary.textContent = "오늘 첫 문제를 시작해 보세요.";
      return;
    }
    if (s.solvedToday > 0) {
      els.focusSummary.textContent = `오늘 ${s.solvedToday}문제 완료 · 정확도 ${s.accuracy}%`;
    } else {
      els.focusSummary.textContent = `${s.streak}일 연속 기록을 오늘도 이어가세요.`;
    }
  }

  function getRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setRecent(app) {
    const payload = { id: app.id, title: app.title, at: Date.now() };
    localStorage.setItem(RECENT_KEY, JSON.stringify(payload));
  }

  function relativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minute = 60000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return "방금 전";
    if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
    if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
    return `${Math.floor(diff / day)}일 전`;
  }

  function renderRecent() {
    const recent = getRecent();
    els.lastOpened.textContent = recent
      ? `최근 사용: ${recent.title} · ${relativeTime(recent.at)}`
      : "아직 방문 기록이 없습니다.";
  }

  function renderApps() {
    els.appGrid.innerHTML = "";

    apps.forEach(app => {
      const card = document.createElement(app.enabled ? "a" : "article");
      card.className = `app-card ${app.accent || "violet"} ${app.enabled ? "enabled" : "disabled"}${app.featured ? " featured" : ""}`;

      if (app.enabled) {
        card.href = app.href;
        if (app.external) {
          card.target = "_blank";
          card.rel = "noopener noreferrer";
        }
        card.addEventListener("click", () => setRecent(app));
      } else {
        card.setAttribute("aria-disabled", "true");
      }

      const metric = app.metric === "mkat" ? mkatMetricText() :
        app.enabled ? "탭해서 바로 열기" : "연결할 주소가 정해지면 활성화됩니다.";

      card.innerHTML = `
        <div class="app-copy">
          <div class="app-topline"><span class="app-badge">${app.badge || "APP"}</span></div>
          <span class="app-subtitle">${app.subtitle || "Personal App"}</span>
          <h3>${app.title}</h3>
          <p class="app-description">${app.description || ""}</p>
          <p class="app-metric">${metric}</p>
          <span class="app-action">${app.enabled ? (app.external ? "새 창에서 열기 ↗" : "앱으로 들어가기 →") : "준비 중"}</span>
        </div>
        <div class="app-visual" aria-hidden="true">${app.icon || "◻"}</div>
      `;

      els.appGrid.appendChild(card);
    });
  }

  function updateConnection() {
    const online = navigator.onLine;
    els.connectionBadge.classList.toggle("offline", !online);
    els.connectionBadge.querySelector("span").textContent = online ? "온라인" : "오프라인";
  }

  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    els.installBtn.classList.remove("hidden");
  });

  els.installBtn.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    els.installBtn.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    els.installBtn.classList.add("hidden");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  setGreeting();
  updateConnection();
  updateFocus();
  renderRecent();
  renderApps();
})();
