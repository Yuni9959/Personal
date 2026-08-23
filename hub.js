import { WEEKLY_VOLATILITY_REFERENCE as VOLATILITY_REFERENCE } from "./apps/volatility/js/weekly-reference.generated.js";

(() => {
  "use strict";

  const apps = Array.isArray(window.PERSONAL_TAP_APPS) ? window.PERSONAL_TAP_APPS : [];
  const RECENT_KEY = "personal-tap-recent-v1";
  const MKAT_SUMMARY_KEY = "mkat98-summary-v2";
  const MKAT_LEGACY_KEY = "mkat98-stats-v1";

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

  function currentStreak(dateKeys) {
    const dates = [...new Set((dateKeys || []).filter(
      value => /^\d{4}-\d{2}-\d{2}$/.test(value)
    ))].sort();
    if (!dates.length) return 0;

    const today = localDateKey();
    const last = dates.at(-1);
    const gap = Math.round(
      (new Date(`${today}T12:00:00`) - new Date(`${last}T12:00:00`)) /
      86400000
    );
    if (gap < 0 || gap > 1) return 0;

    const available = new Set(dates);
    let cursor = last;
    let streak = 0;
    while (available.has(cursor)) {
      streak += 1;
      const previous = new Date(`${cursor}T12:00:00`);
      previous.setDate(previous.getDate() - 1);
      cursor = localDateKey(previous);
    }
    return streak;
  }

  function readMkatStats() {
    try {
      const summary = JSON.parse(
        localStorage.getItem(MKAT_SUMMARY_KEY) || "null"
      );
      if (summary?.schemaVersion === 2) {
        const attempts = Number(summary.attempts || 0);
        const correct = Number(summary.correct || 0);
        const goalTarget = Number(summary.goals?.dailyTarget || 10);
        const goalProgress = summary.today?.localDate === localDateKey()
          ? Number(summary.today.goalProgress || 0)
          : 0;
        const streak = currentStreak(summary.goals?.completedDates);
        const accuracy = attempts ? Math.round((correct / attempts) * 100) : null;
        return {
          attempts,
          correct,
          streak,
          goalProgress,
          goalTarget,
          accuracy,
          migrated: true
        };
      }

      const legacy = JSON.parse(
        localStorage.getItem(MKAT_LEGACY_KEY) || "{}"
      );
      const attempts = Number(legacy.attempts || 0);
      const correct = Number(legacy.correct || 0);
      const accuracy = attempts ? Math.round((correct / attempts) * 100) : null;
      return {
        attempts,
        correct,
        streak: 0,
        goalProgress: 0,
        goalTarget: 10,
        accuracy,
        migrated: false
      };
    } catch {
      return {
        attempts: 0,
        correct: 0,
        streak: 0,
        goalProgress: 0,
        goalTarget: 10,
        accuracy: null,
        migrated: false
      };
    }
  }

  function mkatMetricText() {
    const s = readMkatStats();
    if (!s.attempts) return "아직 훈련 기록이 없습니다. 오늘의 10문제로 시작하세요.";
    if (!s.migrated) return "기존 기록이 있습니다. MKAT를 열어 v2 기록으로 안전하게 이전하세요.";
    return `오늘 ${s.goalProgress}/${s.goalTarget} · 누적 정확도 ${s.accuracy}% · 목표 ${s.streak}일 연속`;
  }

  function updateFocus() {
    const s = readMkatStats();
    if (!s.attempts) {
      els.focusSummary.textContent = "오늘 첫 문제를 시작해 보세요.";
      return;
    }
    if (!s.migrated) {
      els.focusSummary.textContent = "MKAT를 열어 기존 기록을 안전하게 이전해 주세요.";
    } else if (s.goalProgress > 0) {
      els.focusSummary.textContent = `오늘 목표 ${s.goalProgress}/${s.goalTarget} · 정확도 ${s.accuracy}%`;
    } else {
      els.focusSummary.textContent = `목표 완주 ${s.streak}일 연속 기록을 이어가세요.`;
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
      card.dataset.appId = app.id;

      const safeId = String(app.id || "app").replace(/[^a-z0-9_-]/gi, "-");
      const titleId = `${safeId}-title`;
      const descriptionId = `${safeId}-description`;
      const metricId = `${safeId}-metric`;
      card.setAttribute("aria-labelledby", titleId);
      card.setAttribute("aria-describedby", `${descriptionId} ${metricId}`);

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
        app.metric === "volatility"
          ? `실전선 · 상승 ${VOLATILITY_REFERENCE.exAnte.up.safePercent.toFixed(3)}% · 하락 ${VOLATILITY_REFERENCE.exAnte.down.safePercent.toFixed(3)}%`
          : app.enabled ? "탭해서 바로 열기" : "연결할 주소가 정해지면 활성화됩니다.";

      card.innerHTML = `
        <div class="app-card-topline">
          <div class="app-visual" aria-hidden="true">${app.icon || "◻"}</div>
          <span class="app-badge">${app.badge || "APP"}</span>
        </div>
        <div class="app-copy">
          <span class="app-subtitle">${app.subtitle || "Personal App"}</span>
          <h3 id="${titleId}">${app.title}</h3>
          <p id="${descriptionId}" class="app-description">${app.description || ""}</p>
          <p id="${metricId}" class="app-metric">${metric}</p>
          <span class="app-action" aria-hidden="true">
            <span>${app.enabled ? (app.external ? "새 창에서 열기" : "앱으로 들어가기") : "준비 중"}</span>
            <span class="app-action-icon">${app.enabled ? (app.external ? "↗" : "→") : "·"}</span>
          </span>
        </div>
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

  setGreeting();
  updateConnection();
  updateFocus();
  renderRecent();
  renderApps();
})();
