import { loadQuestionBank } from "./bank-loader.js";
import { hashString, shuffled } from "./random.js";
import {
  attemptEligibility,
  createRecordId,
  localDateKey
} from "./stats-model.js";
import {
  createTrainingStore,
  downloadTrainingExport
} from "./training-store.js";

const bootStatus = document.querySelector("#bootStatus");
const appRoot = document.querySelector("#app");

async function bootstrap() {
  try {
    const data = await loadQuestionBank();
    const trainingStore = await createTrainingStore({
      bankVersion: data.bankVersion
    });
    bootStatus.hidden = true;
    appRoot.hidden = false;
    initializeApp(data, trainingStore);
  } catch (error) {
    console.error(error);
    bootStatus.classList.add("error");
    bootStatus.textContent = "문제은행을 불러오지 못했습니다.";

    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "다시 시도";
    retryButton.addEventListener("click", () => window.location.reload());
    bootStatus.appendChild(retryButton);
  }
}

function initializeApp(data, trainingStore) {
  "use strict";

  const bank = data.questions;
  const types = data.types;

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
    migrationNotice: $("#migrationNotice"),
    dismissMigrationNoticeBtn: $("#dismissMigrationNoticeBtn"),
    storageNotice: $("#storageNotice"),
    exportStatsBtn: $("#exportStatsBtn"),
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

  let stats = trainingStore.summary;
  let session = null;
  let timerId = null;
  let remaining = 0;
  let overtime = false;
  let questionPresentedAt = null;
  let questionPresentedAtPerformance = null;

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
    const accuracy = stats.attempts ? Math.round(stats.correct / stats.attempts * 100) : null;
    els.streakBadge.textContent = `🔥 목표 ${stats.completionStreak || 0}일`;
    els.accuracyBadge.textContent = `정확도 ${accuracy == null ? "—" : `${accuracy}%`}`;
    els.todaySolved.textContent = `${stats.today.goalProgress}/${stats.today.goalTarget}`;
    els.wrongCountLabel.textContent = `저장된 오답 ${allWrongQuestions().length}개`;
    renderStorageNotices();
    renderTypeGrid();
    renderStatsPanel();
  }

  function renderStorageNotices() {
    els.migrationNotice.hidden = !stats.migration.noticePending;

    const storage = trainingStore.storageSnapshot();
    let message = "";
    if (!storage.durable) {
      message = "이 브라우저에서 IndexedDB를 사용할 수 없어 기록을 복구 저널에 임시 보관하고 있습니다. 앱을 닫기 전에 데이터를 내보내세요.";
    } else if (storage.recoveryPending > 0) {
      message = `저장 실패 기록 ${storage.recoveryPending}건을 복구 대기 중입니다. 다음 실행에서 자동으로 다시 저장합니다.`;
    } else if (!storage.cacheAvailable) {
      message = "상세 기록은 안전하지만 허브용 요약 캐시를 갱신하지 못했습니다. MKAT를 다시 열면 IndexedDB에서 재생성합니다.";
    }

    els.storageNotice.hidden = !message;
    els.storageNotice.textContent = message;
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
      <div class="stat-box"><span>경험한 문제</span><strong>${attemptedQuestions}/${bank.length}</strong></div>
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

  function sessionRecord() {
    return {
      sessionId: session.sessionId,
      bankVersion: data.bankVersion,
      mode: session.mode,
      typeId: session.typeId,
      status: session.status,
      queueQuestionIds: session.queue.map(question => question.id),
      currentIndex: session.index,
      score: session.score,
      answerCount: session.answers.length,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt
    };
  }

  async function saveSessionStatus(status) {
    if (!session) return;
    session.status = status;
    session.updatedAt = Date.now();
    if (status === "completed") session.completedAt = session.updatedAt;
    await trainingStore.saveSession(sessionRecord());
    renderStorageNotices();
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
      sessionId: createRecordId("session"),
      mode,
      typeId,
      queue,
      index: 0,
      score: 0,
      answers: [],
      locked: false,
      speed: mode === "speed",
      status: "active",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null
    };
    void trainingStore.saveSession(sessionRecord()).then(renderStorageNotices);
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
    els.options.dataset.questionId = q.id;

    q.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-button";
      button.dataset.index = index;
      button.dataset.optionId = option.id;
      button.setAttribute("aria-label", `${index + 1}번 보기`);
      let content = `<span class="option-index">${index + 1}</span>`;
      if (option.svg) content += `<span class="option-svg">${option.svg}</span>`;
      if (option.text != null) content += `<span class="option-text">${escapeHtml(option.text)}${option.suffix ? escapeHtml(option.suffix) : ""}</span>`;
      button.innerHTML = content;
      button.addEventListener("click", () => void answerQuestion(index));
      els.options.appendChild(button);
    });

    questionPresentedAt = Date.now();
    questionPresentedAtPerformance = performance.now();
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

  async function answerQuestion(selectedIndex) {
    if (session.locked) return;
    session.locked = true;
    const answeredSession = session;

    const q = session.queue[session.index];
    const submittedAt = Date.now();
    const elapsedMs = Math.max(
      0,
      Math.round(performance.now() - questionPresentedAtPerformance)
    );
    const wasOvertime =
      overtime || elapsedMs > (q.timeLimitSec || 45) * 1000;
    clearTimer();

    const correctIndex = q.options.findIndex(option => option.id === q.correctOptionId);
    const isCorrect = selectedIndex === correctIndex;
    if (isCorrect) session.score += 1;

    const buttons = $$(".option-button");
    buttons.forEach((button, index) => {
      button.disabled = true;
      if (index === correctIndex) button.classList.add("correct");
      if (index === selectedIndex) {
        button.classList.add("selected");
        if (!isCorrect) button.classList.add("wrong");
      }
    });

    const retry = session.mode === "retry";
    const eligibility = attemptEligibility({
      mode: session.mode,
      retry,
      hintUsed: false,
      overtime: wasOvertime,
      skipped: false
    });
    const selectedOptionId = q.options[selectedIndex].id;
    const attempt = {
      attemptId: createRecordId("attempt"),
      sessionId: session.sessionId,
      questionId: q.id,
      contentVersion: q.contentVersion,
      bankVersion: data.bankVersion,
      mode: session.mode,
      localDate: localDateKey(new Date(submittedAt)),

      selectedOptionId,
      presentedOptionIds: q.options.map(option => option.id),

      correct: isCorrect,
      firstPass: eligibility.firstPass,
      retry: eligibility.retry,
      hintUsed: false,
      elapsedMs,
      overtime: wasOvertime,
      skipped: false,

      inferredErrorTag: null,
      presentedAt: questionPresentedAt || submittedAt,
      submittedAt,

      eligibleForDailyGoal: eligibility.eligibleForDailyGoal,
      eligibleForMastery: eligibility.eligibleForMastery,
      eligibleForAbilityStats: eligibility.eligibleForAbilityStats,
      eligibleForSpeedStats: eligibility.eligibleForSpeedStats
    };

    session.answers.push({
      id: q.id,
      typeId: q.typeId,
      correct: isCorrect,
      overtime: wasOvertime,
      selectedIndex,
      selectedOptionId,
      elapsedMs,
      attemptId: attempt.attemptId
    });
    session.updatedAt = submittedAt;

    try {
      const persistence = await trainingStore.recordAttempt(
        attempt,
        sessionRecord()
      );
      stats = persistence.summary;
      renderStorageNotices();
    } catch (error) {
      console.error(error);
      els.storageNotice.hidden = false;
      els.storageNotice.textContent =
        "응시 기록을 저장하지 못했습니다. 앱을 닫기 전에 데이터를 내보내 주세요.";
    }

    if (session !== answeredSession) return;

    if (session.speed) {
      setTimeout(nextQuestion, 420);
      return;
    }

    els.feedback.classList.remove("hidden");
    els.feedback.classList.add(isCorrect ? "correct-feedback" : "wrong-feedback");
    els.feedbackIcon.textContent = isCorrect ? "✅" : "🔍";
    els.feedbackTitle.textContent = isCorrect ? "정답입니다." : "여기서 한 번 더 잡아냅시다.";
    els.feedbackSubtitle.textContent = wasOvertime ? "제한시간을 넘겼습니다." : `남은 시간 ${remaining}초`;
    els.explanation.textContent = q.explanation;
    els.trapBox.textContent = q.trap ? `실전 함정: ${q.trap}` : "정답을 선택한 뒤 개수·위치·방향을 마지막으로 확인하세요.";
    els.nextBtn.textContent = session.index === session.queue.length - 1 ? "결과 보기 →" : "다음 문제 →";
    els.feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    void saveSessionStatus("completed");
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
    if (session?.status === "active") {
      void saveSessionStatus("abandoned");
    }
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
  els.dismissMigrationNoticeBtn.addEventListener("click", async () => {
    stats = await trainingStore.dismissMigrationNotice();
    renderHome();
  });
  els.exportStatsBtn.addEventListener("click", async () => {
    els.exportStatsBtn.disabled = true;
    const originalLabel = els.exportStatsBtn.textContent;
    els.exportStatsBtn.textContent = "내보내는 중…";
    try {
      const exportData = await trainingStore.exportData();
      downloadTrainingExport(exportData);
    } catch (error) {
      console.error(error);
      alert("훈련 기록을 내보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      els.exportStatsBtn.disabled = false;
      els.exportStatsBtn.textContent = originalLabel;
    }
  });
  els.resetStatsBtn.addEventListener("click", async () => {
    if (!confirm("모든 풀이 기록과 오답 기록을 초기화할까요?")) return;
    els.resetStatsBtn.disabled = true;
    try {
      stats = await trainingStore.reset();
      renderHome();
    } catch (error) {
      console.error(error);
      alert("기록을 초기화하지 못했습니다. 저장 공간을 확인해 주세요.");
    } finally {
      els.resetStatsBtn.disabled = false;
    }
  });

  window.addEventListener("keydown", event => {
    if (views.quiz.classList.contains("hidden") || session?.locked) return;
    const num = Number(event.key);
    if (num >= 1 && num <= 9) {
      const q = session.queue[session.index];
      if (num <= q.options.length) void answerQuestion(num - 1);
    }
  });

  renderCategoryOptions();
  renderHome();
}

bootstrap();
