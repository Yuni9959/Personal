(() => {
  "use strict";

  const bank = window.MENSA_QUESTION_BANK || [];
  const types = window.MENSA_TYPES || [];
  const STORAGE_KEY = "mkat98-stats-v1";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const views = {
    home: $("#homeView"),
    quiz: $("#quizView"),
    result: $("#resultView")
  };

  const els = {
    homeBtn: $("#homeBtn"),
    streakBadge: $("#streakBadge"),
    accuracyBadge: $("#accuracyBadge"),
    todaySolved: $("#todaySolved"),
    wrongCountLabel: $("#wrongCountLabel"),
    categoryFilter: $("#categoryFilter"),
    typeGrid: $("#typeGrid"),
    statsPanel: $("#statsPanel"),
    resetStatsBtn: $("#resetStatsBtn"),
    quitBtn: $("#quitBtn"),
    progressText: $("#progressText"),
    progressBar: $("#progressBar"),
    sessionScore: $("#sessionScore"),
    timer: $("#timer"),
    typeBadge: $("#typeBadge"),
    difficultyBadge: $("#difficultyBadge"),
    skillBadge: $("#skillBadge"),
    prompt: $("#prompt"),
    stimulus: $("#stimulus"),
    options: $("#options"),
    feedback: $("#feedback"),
    feedbackIcon: $("#feedbackIcon"),
    feedbackTitle: $("#feedbackTitle"),
    feedbackSubtitle: $("#feedbackSubtitle"),
    explanation: $("#explanation"),
    trapBox: $("#trapBox"),
    nextBtn: $("#nextBtn"),
    resultScore: $("#resultScore"),
    resultTitle: $("#resultTitle"),
    resultSummary: $("#resultSummary"),
    resultBreakdown: $("#resultBreakdown"),
    retryWrongBtn: $("#retryWrongBtn"),
    backHomeBtn: $("#backHomeBtn")
  };

  let stats = loadStats();
  let session = null;
  let timerId = null;
  let remaining = 0;
  let overtime = false;

  function blankStats() {
    return {
      attempts: 0,
      correct: 0,
      solvedByDate: {},
      questions: {},
      streak: 0,
      lastActiveDate: null
    };
  }

  function loadStats() {
    try {
      return { ...blankStats(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return blankStats();
    }
  }

  function saveStats() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }

  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dayDiff(a, b) {
    const aa = new Date(`${a}T12:00:00`);
    const bb = new Date(`${b}T12:00:00`);
    return Math.round((bb - aa) / 86400000);
  }

  function markActiveDay() {
    const today = localDateKey();
    if (stats.lastActiveDate === today) return;
    if (!stats.lastActiveDate) stats.streak = 1;
    else stats.streak = dayDiff(stats.lastActiveDate, today) === 1 ? stats.streak + 1 : 1;
    stats.lastActiveDate = today;
    saveStats();
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(items, seed = Math.floor(Math.random() * 2 ** 31)) {
    const result = [...items];
    const rand = seededRandom(seed);
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function showView(name) {
    Object.entries(views).forEach(([key, el]) => el.classList.toggle("hidden", key !== name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function questionStats(id) {
    return stats.questions[id] || { attempts: 0, correct: 0, wrong: 0, overtime: 0 };
  }

  function allWrongQuestions() {
    return bank.filter(q => {
      const s = questionStats(q.id);
      return (s.wrong || 0) > (s.correct || 0);
    });
  }

  function typeAccuracy(typeId) {
    const qs = bank.filter(q => q.typeId === typeId);
    let attempts = 0;
    let correct = 0;
    qs.forEach(q => {
      const s = questionStats(q.id);
      attempts += s.attempts || 0;
      correct += s.correct || 0;
    });
    return attempts ? Math.round(correct / attempts * 100) : null;
  }

  function renderHome() {
    markActiveDay();
    const today = localDateKey();
    const accuracy = stats.attempts ? Math.round(stats.correct / stats.attempts * 100) : null;
    els.streakBadge.textContent = `🔥 ${stats.streak || 0}일`;
    els.accuracyBadge.textContent = `정확도 ${accuracy == null ? "—" : `${accuracy}%`}`;
    els.todaySolved.textContent = stats.solvedByDate[today] || 0;
    els.wrongCountLabel.textContent = `저장된 오답 ${allWrongQuestions().length}개`;
    renderTypeGrid();
    renderStatsPanel();
  }

  function renderCategoryOptions() {
    const categories = [...new Set(types.map(t => t.category))];
    categories.forEach(category => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      els.categoryFilter.appendChild(option);
    });
  }

  function renderTypeGrid() {
    const category = els.categoryFilter.value || "all";
    els.typeGrid.innerHTML = "";
    types
      .filter(type => category === "all" || type.category === category)
      .forEach(type => {
        const accuracy = typeAccuracy(type.id);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "type-card";
        button.innerHTML = `
          <span class="type-code">${type.id} · ${type.category}</span>
          <strong>${type.title}</strong>
          <span class="type-accuracy">${accuracy == null ? "미응시" : `${accuracy}%`}</span>
          <small>5문제 →</small>
        `;
        button.addEventListener("click", () => startSession("type", type.id));
        els.typeGrid.appendChild(button);
      });
  }

  function renderStatsPanel() {
    const accuracy = stats.attempts ? Math.round(stats.correct / stats.attempts * 100) : 0;
    const wrong = allWrongQuestions().length;
    const attemptedQuestions = Object.values(stats.questions).filter(x => x.attempts > 0).length;
    els.statsPanel.innerHTML = `
      <div class="stat-box"><span>누적 풀이</span><strong>${stats.attempts}</strong></div>
      <div class="stat-box"><span>누적 정확도</span><strong>${stats.attempts ? `${accuracy}%` : "—"}</strong></div>
      <div class="stat-box"><span>경험한 문제</span><strong>${attemptedQuestions}/125</strong></div>
      <div class="stat-box"><span>복습할 오답</span><strong>${wrong}</strong></div>
    `;
  }

  function chooseDailyQuestions() {
    const seed = hashString(`daily-${localDateKey()}`);
    const orderedTypes = shuffled(types, seed).slice(0, 10);
    return orderedTypes.map((type, index) => {
      const qs = bank.filter(q => q.typeId === type.id);
      const weakFirst = [...qs].sort((a, b) => {
        const sa = questionStats(a.id);
        const sb = questionStats(b.id);
        const scoreA = (sa.wrong || 0) * 3 - (sa.correct || 0);
        const scoreB = (sb.wrong || 0) * 3 - (sb.correct || 0);
        return scoreB - scoreA;
      });
      const pickIndex = hashString(`${localDateKey()}-${type.id}-${index}`) % weakFirst.length;
      return weakFirst[pickIndex];
    });
  }

  function chooseMixed25() {
    const seed = hashString(`mixed-${Date.now()}`);
    return types.map((type, index) => {
      const qs = bank.filter(q => q.typeId === type.id);
      return qs[(seed + index * 7) % qs.length];
    });
  }

  function chooseSpeed15() {
    const weak = allWrongQuestions();
    const pool = [...weak, ...bank];
    const unique = [];
    for (const q of shuffled(pool, Date.now())) {
      if (!unique.some(x => x.id === q.id)) unique.push(q);
      if (unique.length === 15) break;
    }
    return unique;
  }

  function startSession(mode, typeId = null, suppliedQueue = null) {
    let queue;
    if (suppliedQueue) queue = suppliedQueue;
    else if (mode === "daily") queue = chooseDailyQuestions();
    else if (mode === "mixed25") queue = chooseMixed25();
    else if (mode === "speed") queue = chooseSpeed15();
    else if (mode === "wrong") {
      const wrong = allWrongQuestions();
      if (!wrong.length) {
        alert("아직 저장된 오답이 없습니다. 오늘의 문제부터 풀어봅시다.");
        return;
      }
      queue = shuffled(wrong, Date.now()).slice(0, 25);
    } else if (mode === "type") {
      queue = shuffled(bank.filter(q => q.typeId === typeId), Date.now());
    } else queue = shuffled(bank, Date.now()).slice(0, 10);

    session = {
      mode,
      queue,
      index: 0,
      score: 0,
      answers: [],
      locked: false,
      speed: mode === "speed"
    };
    showView("quiz");
    renderQuestion();
  }

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function startTimer(seconds) {
    clearTimer();
    remaining = seconds;
    overtime = false;
    els.timer.classList.remove("overtime");
    updateTimer();
    timerId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = 0;
        overtime = true;
        els.timer.classList.add("overtime");
        clearTimer();
      }
      updateTimer();
    }, 1000);
  }

  function updateTimer() {
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    els.timer.textContent = `${mm}:${ss}`;
  }

  function renderQuestion() {
    session.locked = false;
    const q = session.queue[session.index];
    els.progressText.textContent = `${session.index + 1} / ${session.queue.length}`;
    els.progressBar.style.width = `${session.index / session.queue.length * 100}%`;
    els.sessionScore.textContent = `정답 ${session.score}`;
    els.typeBadge.textContent = `${q.typeId} · ${q.typeTitle}`;
    els.difficultyBadge.textContent = `난이도 ${q.difficulty}`;
    els.skillBadge.textContent = q.skills.slice(0, 2).join(" · ");
    els.prompt.textContent = q.prompt;
    els.stimulus.innerHTML = q.stimulusSvg || "";
    els.feedback.classList.add("hidden");
    els.feedback.classList.remove("correct-feedback", "wrong-feedback");
    els.options.innerHTML = "";

    q.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-button";
      button.dataset.index = index;
      button.setAttribute("aria-label", `${index + 1}번 보기`);
      let content = `<span class="option-index">${index + 1}</span>`;
      if (option.svg) content += `<span class="option-svg">${option.svg}</span>`;
      if (option.text != null) content += `<span class="option-text">${escapeHtml(option.text)}${option.suffix ? escapeHtml(option.suffix) : ""}</span>`;
      button.innerHTML = content;
      button.addEventListener("click", () => answerQuestion(index));
      els.options.appendChild(button);
    });

    startTimer(q.timeLimitSec || 45);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function answerQuestion(selectedIndex) {
    if (session.locked) return;
    session.locked = true;
    clearTimer();

    const q = session.queue[session.index];
    const isCorrect = selectedIndex === q.answerIndex;
    if (isCorrect) session.score += 1;

    const buttons = $$(".option-button");
    buttons.forEach((button, index) => {
      button.disabled = true;
      if (index === q.answerIndex) button.classList.add("correct");
      if (index === selectedIndex) {
        button.classList.add("selected");
        if (!isCorrect) button.classList.add("wrong");
      }
    });

    recordAnswer(q, isCorrect, overtime);
    session.answers.push({ id: q.id, typeId: q.typeId, correct: isCorrect, overtime, selectedIndex });

    if (session.speed) {
      setTimeout(nextQuestion, 420);
      return;
    }

    els.feedback.classList.remove("hidden");
    els.feedback.classList.add(isCorrect ? "correct-feedback" : "wrong-feedback");
    els.feedbackIcon.textContent = isCorrect ? "✅" : "🔍";
    els.feedbackTitle.textContent = isCorrect ? "정답입니다." : "여기서 한 번 더 잡아냅시다.";
    els.feedbackSubtitle.textContent = overtime ? "제한시간을 넘겼습니다." : `남은 시간 ${remaining}초`;
    els.explanation.textContent = q.explanation;
    els.trapBox.textContent = q.trap ? `실전 함정: ${q.trap}` : "정답을 선택한 뒤 개수·위치·방향을 마지막으로 확인하세요.";
    els.nextBtn.textContent = session.index === session.queue.length - 1 ? "결과 보기 →" : "다음 문제 →";
    els.feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function recordAnswer(q, correct, wasOvertime) {
    const today = localDateKey();
    stats.attempts += 1;
    if (correct) stats.correct += 1;
    stats.solvedByDate[today] = (stats.solvedByDate[today] || 0) + 1;
    const s = stats.questions[q.id] || { attempts: 0, correct: 0, wrong: 0, overtime: 0 };
    s.attempts += 1;
    if (correct) s.correct += 1;
    else s.wrong += 1;
    if (wasOvertime) s.overtime += 1;
    s.lastAnswered = Date.now();
    stats.questions[q.id] = s;
    saveStats();
  }

  function nextQuestion() {
    if (!session) return;
    if (session.index >= session.queue.length - 1) {
      showResults();
      return;
    }
    session.index += 1;
    renderQuestion();
  }

  function showResults() {
    clearTimer();
    const total = session.queue.length;
    const percent = Math.round(session.score / total * 100);
    const wrong = session.answers.filter(x => !x.correct);
    const overtimeCount = session.answers.filter(x => x.overtime).length;
    els.resultScore.textContent = `${percent}%`;
    els.resultTitle.textContent = percent >= 90 ? "상위권 안정성에 가까워졌습니다." :
      percent >= 75 ? "좋습니다. 실수를 더 줄이면 됩니다." :
      "오답은 약점 지도가 됩니다.";
    els.resultSummary.textContent = `${total}문제 중 ${session.score}문제를 맞혔습니다. 이번 세트에서 틀린 ${wrong.length}문제는 바로 재훈련할 수 있습니다.`;
    els.resultBreakdown.innerHTML = `
      <div><span>정답</span><strong>${session.score}</strong></div>
      <div><span>오답</span><strong>${wrong.length}</strong></div>
      <div><span>시간초과</span><strong>${overtimeCount}</strong></div>
    `;
    els.retryWrongBtn.disabled = !wrong.length;
    els.retryWrongBtn.style.opacity = wrong.length ? "1" : ".45";
    els.progressBar.style.width = "100%";
    showView("result");
  }

  function goHome() {
    clearTimer();
    session = null;
    renderHome();
    showView("home");
  }

  $$(".mode-card").forEach(button => {
    button.addEventListener("click", () => startSession(button.dataset.mode));
  });
  els.categoryFilter.addEventListener("change", renderTypeGrid);
  els.nextBtn.addEventListener("click", nextQuestion);
  els.quitBtn.addEventListener("click", () => {
    if (!session || session.index === 0 || confirm("현재 훈련을 종료하고 홈으로 돌아갈까요?")) goHome();
  });
  els.homeBtn.addEventListener("click", goHome);
  els.backHomeBtn.addEventListener("click", goHome);
  els.retryWrongBtn.addEventListener("click", () => {
    if (!session) return;
    const wrongIds = new Set(session.answers.filter(x => !x.correct).map(x => x.id));
    const retry = session.queue.filter(q => wrongIds.has(q.id));
    if (retry.length) startSession("retry", null, shuffled(retry, Date.now()));
  });
  els.resetStatsBtn.addEventListener("click", () => {
    if (!confirm("모든 풀이 기록과 오답 기록을 초기화할까요?")) return;
    stats = blankStats();
    saveStats();
    renderHome();
  });

  window.addEventListener("keydown", event => {
    if (views.quiz.classList.contains("hidden") || session?.locked) return;
    const num = Number(event.key);
    if (num >= 1 && num <= 9) {
      const q = session.queue[session.index];
      if (num <= q.options.length) answerQuestion(num - 1);
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("../../sw.js").catch(() => {}));
  }

  renderCategoryOptions();
  renderHome();
})();
