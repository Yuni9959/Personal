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
import {
  completeQuestionClock,
  createQuestionClock,
  createSessionSnapshot,
  invalidateSessionSnapshot,
  pauseQuestionClock,
  restoreSessionSnapshot,
  resumeQuestionClock,
  serializeSession
} from "./session-engine.js";

const bootStatus = document.querySelector("#bootStatus");
const appRoot = document.querySelector("#app");

async function bootstrap() {
  try {
    const data = await loadQuestionBank();
    const trainingStore = await createTrainingStore({
      bankVersion: data.bankVersion
    });
    const activeSessions = await trainingStore.getSessionsByStatus("active");
    bootStatus.hidden = true;
    appRoot.hidden = false;
    initializeApp(data, trainingStore, activeSessions);
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

function initializeApp(data, trainingStore, activeSessions = []) {
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
    resumeNotice: $("#resumeNotice"),
    resumeTitle: $("#resumeTitle"),
    resumeSummary: $("#resumeSummary"),
    resumeSessionBtn: $("#resumeSessionBtn"),
    discardSessionBtn: $("#discardSessionBtn"),
    sessionNotice: $("#sessionNotice"),
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
  let restorableSession = null;
  let sessionNoticeMessage = "";
  let timerId = null;
  let remaining = 0;
  let overtime = false;
  let questionSegmentBaseElapsedMs = 0;
  let questionSegmentStartedPerformance = null;

  const modeLabels = {
    daily: "오늘의 10문제",
    mixed25: "전 유형 25문제",
    wrong: "오답 다시 풀기",
    speed: "속도 훈련",
    type: "유형별 집중훈련",
    retry: "이번 오답 재도전"
  };

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

  function compatibilityMessage(reason) {
    const messages = {
      "session-schema": "이전 형식의 진행 중 세션은 안전하게 복원할 수 없어 보관만 했습니다.",
      "session-status": "이미 종료된 세션은 이어서 풀 수 없습니다.",
      "session-items": "저장된 문제 목록이 없어 진행 중 세션을 복원하지 못했습니다.",
      "question-missing": "문제은행에서 세션의 문제를 찾을 수 없어 진행 기록을 보관하고 새 세션을 준비했습니다.",
      "content-version": "문제 내용이나 정답이 업데이트되어 기존 세션을 안전하게 복원할 수 없습니다.",
      "grading-fingerprint": "정답 의미가 변경된 문제가 있어 기존 세션을 안전하게 복원할 수 없습니다.",
      "option-set": "문제 보기가 변경되어 기존 표시 순서를 안전하게 복원할 수 없습니다.",
      "shuffle-version": "지원하지 않는 보기 셔플 형식이라 기존 세션을 복원할 수 없습니다.",
      "current-index": "저장된 진행 위치가 올바르지 않아 기존 세션을 복원할 수 없습니다."
    };
    return messages[reason] ||
      "진행 중 세션을 안전하게 복원할 수 없어 기록만 보관했습니다.";
  }

  function prepareRestorableSession() {
    if (!activeSessions.length) return;

    const [latest, ...older] = activeSessions;
    const prepared = restoreSessionSnapshot({
      snapshot: latest,
      questions: bank,
      currentBankVersion: data.bankVersion,
      now: Date.now()
    });

    for (const oldSession of older) {
      void trainingStore.saveSession(
        invalidateSessionSnapshot(oldSession, "superseded-active-session")
      );
    }

    if (!prepared.ok) {
      sessionNoticeMessage = compatibilityMessage(
        prepared.compatibility.reason
      );
      void trainingStore.saveSession(
        invalidateSessionSnapshot(
          latest,
          prepared.compatibility.reason
        )
      );
      return;
    }

    restorableSession = prepared.session;
    restorableSession.sessionRevision += 1;
    restorableSession.updatedAt = Date.now();
    void trainingStore
      .saveSession(serializeSession(restorableSession))
      .then(renderStorageNotices);
  }

  function renderResumeNotice() {
    els.resumeNotice.hidden = !restorableSession;
    if (restorableSession) {
      const label = modeLabels[restorableSession.mode] ||
        restorableSession.mode;
      const answered = restorableSession.answers.length;
      els.resumeTitle.textContent = `${label}을 이어서 풀 수 있습니다.`;
      els.resumeSummary.textContent =
        `${restorableSession.queue.length}문제 중 ${answered}문제를 제출했습니다. ` +
        `보기 순서와 풀이시간도 그대로 복원됩니다.`;
    }

    els.sessionNotice.hidden = !sessionNoticeMessage;
    els.sessionNotice.textContent = sessionNoticeMessage;
  }

  function renderHome() {
    const accuracy = stats.attempts ? Math.round(stats.correct / stats.attempts * 100) : null;
    els.streakBadge.textContent = `🔥 목표 ${stats.completionStreak || 0}일`;
    els.accuracyBadge.textContent = `정확도 ${accuracy == null ? "—" : `${accuracy}%`}`;
    els.todaySolved.textContent = `${stats.today.goalProgress}/${stats.today.goalTarget}`;
    els.wrongCountLabel.textContent = `저장된 오답 ${allWrongQuestions().length}개`;
    renderStorageNotices();
    renderResumeNotice();
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
    return serializeSession(session);
  }

  function touchSession() {
    session.sessionRevision = Number(session.sessionRevision || 0) + 1;
    session.updatedAt = Date.now();
  }

  async function persistSession() {
    if (!session) return;
    touchSession();
    await trainingStore.saveSession(sessionRecord());
    renderStorageNotices();
  }

  async function saveSessionStatus(status) {
    if (!session) return;
    if (session.phase === "question") pauseCurrentQuestion();
    session.status = status;
    touchSession();
    if (status === "completed") session.completedAt = session.updatedAt;
    await trainingStore.saveSession(sessionRecord());
    renderStorageNotices();
  }

  function abandonRestorableSession(reason = "replaced-by-new-session") {
    if (!restorableSession) return;
    const abandoned = {
      ...restorableSession,
      status: "abandoned",
      sessionRevision:
        Number(restorableSession.sessionRevision || 0) + 1,
      updatedAt: Date.now(),
      invalidationReason: reason
    };
    restorableSession = null;
    void trainingStore
      .saveSession(serializeSession(abandoned))
      .then(renderStorageNotices);
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

    const previousPresentedOptionIdsByQuestion = mode === "retry" && session
      ? new Map(
          session.items.map(item => [
            item.questionId,
            item.presentedOptionIds
          ])
        )
      : null;
    abandonRestorableSession();
    const snapshot = createSessionSnapshot({
      sessionId: createRecordId("session"),
      bankVersion: data.bankVersion,
      mode,
      typeId,
      questions: queue,
      previousPresentedOptionIdsByQuestion,
      now: Date.now()
    });
    const prepared = restoreSessionSnapshot({
      snapshot,
      questions: bank,
      currentBankVersion: data.bankVersion,
      now: Date.now()
    });
    if (!prepared.ok) {
      throw new Error("새 세션의 보기 순서를 구성하지 못했습니다.");
    }

    session = prepared.session;
    session.restored = false;
    showView("quiz");
    renderQuestion();
  }

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function currentQuestionElapsedMs() {
    if (!session?.timer) return 0;
    if (session.timer.state !== "running" ||
        questionSegmentStartedPerformance == null) {
      return Math.max(0, Math.round(session.timer.elapsedMs || 0));
    }
    return Math.max(
      0,
      Math.round(
        questionSegmentBaseElapsedMs +
        performance.now() -
        questionSegmentStartedPerformance
      )
    );
  }

  function startTimer() {
    clearTimer();
    updateTimer();
    timerId = setInterval(updateTimer, 250);
  }

  function updateTimer() {
    const elapsedMs = currentQuestionElapsedMs();
    const limitMs = session?.timer?.limitMs || 45000;
    remaining = Math.max(0, Math.ceil((limitMs - elapsedMs) / 1000));
    overtime = elapsedMs > limitMs;
    els.timer.classList.toggle("overtime", overtime);
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    els.timer.textContent = `${mm}:${ss}`;
  }

  function beginQuestionClock(q) {
    const now = Date.now();
    const matchesCurrentQuestion =
      session.timer?.questionIndex === session.index &&
      session.timer?.questionId === q.id &&
      session.timer?.state !== "completed";

    session.timer = matchesCurrentQuestion
      ? resumeQuestionClock(session.timer, now)
      : createQuestionClock({
          questionIndex: session.index,
          questionId: q.id,
          limitMs: (q.timeLimitSec || 45) * 1000,
          now
        });
    questionSegmentBaseElapsedMs = session.timer.elapsedMs;
    questionSegmentStartedPerformance = performance.now();
    startTimer();
  }

  function pauseCurrentQuestion({ persist = false } = {}) {
    if (!session?.timer || session.timer.state !== "running") return;
    const elapsedMs = currentQuestionElapsedMs();
    session.timer = pauseQuestionClock(session.timer, {
      now: Date.now(),
      elapsedMs
    });
    questionSegmentBaseElapsedMs = session.timer.elapsedMs;
    questionSegmentStartedPerformance = null;
    clearTimer();
    updateTimer();
    if (persist) void persistSession();
  }

  function resumeCurrentQuestion({ persist = false } = {}) {
    if (!session?.timer || session.timer.state === "completed") return;
    session.timer = resumeQuestionClock(session.timer, Date.now());
    questionSegmentBaseElapsedMs = session.timer.elapsedMs;
    questionSegmentStartedPerformance = performance.now();
    startTimer();
    if (persist) void persistSession();
  }

  function renderQuestion() {
    clearTimer();
    const q = session.queue[session.index];
    session.locked = session.phase === "feedback";
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

    if (session.phase === "feedback") {
      questionSegmentBaseElapsedMs = session.timer?.elapsedMs || 0;
      questionSegmentStartedPerformance = null;
      updateTimer();
      const answer = session.answers.at(-1);
      if (answer?.id === q.id) renderStoredFeedback(q, answer);
      return;
    }

    beginQuestionClock(q);
    void persistSession();
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
    const elapsedMs = currentQuestionElapsedMs();
    session.timer = completeQuestionClock(session.timer, {
      now: submittedAt,
      elapsedMs
    });
    questionSegmentBaseElapsedMs = elapsedMs;
    questionSegmentStartedPerformance = null;
    const wasOvertime = elapsedMs > (q.timeLimitSec || 45) * 1000;
    clearTimer();
    updateTimer();

    const correctIndex = q.options.findIndex(option => option.id === q.correctOptionId);
    const isCorrect = selectedIndex === correctIndex;
    if (isCorrect) session.score += 1;

    const retry = session.mode === "retry";
    const eligibility = attemptEligibility({
      mode: session.mode,
      retry,
      hintUsed: false,
      overtime: wasOvertime,
      skipped: false
    });
    const selectedOptionId = q.options[selectedIndex].id;
    const sessionItem = session.items[session.index];
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
      optionSeed: sessionItem.optionSeed,
      shuffleVersion: sessionItem.shuffleVersion,

      correct: isCorrect,
      firstPass: eligibility.firstPass,
      retry: eligibility.retry,
      hintUsed: false,
      elapsedMs,
      overtime: wasOvertime,
      skipped: false,

      inferredErrorTag: null,
      presentedAt: session.timer?.presentedAt || submittedAt,
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
      presentedOptionIds: q.options.map(option => option.id),
      elapsedMs,
      attemptId: attempt.attemptId
    });
    session.phase = "feedback";
    touchSession();

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

    renderStoredFeedback(q, session.answers.at(-1));
  }

  function renderStoredFeedback(q, answer) {
    const correctIndex = q.options.findIndex(
      option => option.id === q.correctOptionId
    );
    const selectedIndex = q.options.findIndex(
      option => option.id === answer.selectedOptionId
    );
    const buttons = $$(".option-button");
    buttons.forEach((button, index) => {
      button.disabled = true;
      if (index === correctIndex) button.classList.add("correct");
      if (index === selectedIndex) {
        button.classList.add("selected");
        if (!answer.correct) button.classList.add("wrong");
      }
    });

    const limitMs = (q.timeLimitSec || 45) * 1000;
    remaining = Math.max(
      0,
      Math.ceil((limitMs - answer.elapsedMs) / 1000)
    );
    overtime = answer.overtime;
    els.feedback.classList.remove("hidden");
    els.feedback.classList.add(
      answer.correct ? "correct-feedback" : "wrong-feedback"
    );
    els.feedbackIcon.textContent = answer.correct ? "✅" : "🔍";
    els.feedbackTitle.textContent = answer.correct
      ? "정답입니다."
      : "여기서 한 번 더 잡아냅시다.";
    els.feedbackSubtitle.textContent = answer.overtime
      ? "제한시간을 넘겼습니다."
      : `남은 시간 ${remaining}초`;
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
    session.currentIndex = session.index;
    session.phase = "question";
    session.timer = null;
    session.locked = false;
    session.updatedAt = Date.now();
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

  function resumeSavedSession() {
    if (!restorableSession) return;
    session = restorableSession;
    restorableSession = null;
    session.status = "active";
    session.updatedAt = Date.now();
    showView("quiz");

    if (session.speed && session.phase === "feedback") {
      nextQuestion();
      return;
    }
    renderQuestion();
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
    const retry = bank.filter(q => wrongIds.has(q.id));
    if (retry.length) startSession("retry", null, shuffled(retry, Date.now()));
  });
  els.resumeSessionBtn.addEventListener("click", resumeSavedSession);
  els.discardSessionBtn.addEventListener("click", () => {
    abandonRestorableSession("discarded-by-user");
    renderHome();
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

  document.addEventListener("visibilitychange", () => {
    if (!session ||
        views.quiz.classList.contains("hidden") ||
        session.phase !== "question") {
      return;
    }
    if (document.hidden) {
      pauseCurrentQuestion({ persist: true });
    } else {
      resumeCurrentQuestion({ persist: true });
    }
  });
  window.addEventListener("pagehide", () => {
    if (session?.phase === "question") {
      pauseCurrentQuestion({ persist: true });
    }
  });

  prepareRestorableSession();
  renderCategoryOptions();
  renderHome();
}

bootstrap();
