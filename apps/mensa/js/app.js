import { loadQuestionBank } from "./bank-loader.js";
import { hashString, shuffled } from "./random.js";
import {
  buildDetailedAnalytics,
  median
} from "./analytics-model.js";
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
import { resolveDailyQueue } from "./daily-queue-engine.js";
import {
  canonicalMode,
  examDurationMs,
  inferOptionLayout,
  modePolicy
} from "./mode-policy.js";

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
  const cognitiveDomains = data.cognitiveDomains || [];
  const errorTaxonomy = data.errorTaxonomy || [];
  const bankById = new Map(bank.map(question => [question.id, question]));
  const errorTaxonomyById = new Map(
    errorTaxonomy.map(item => [item.id, item])
  );

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const views = {
    home: $("#homeView"),
    stats: $("#statsView"),
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
    viewDetailedStatsBtn: $("#viewDetailedStatsBtn"),
    statsBackBtn: $("#statsBackBtn"),
    detailedStatsPanel: $("#detailedStatsPanel"),
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
    quizModeLabel: $("#quizModeLabel"),
    progressText: $("#progressText"),
    progressBar: $("#progressBar"),
    sessionScore: $("#sessionScore"),
    timer: $("#timer"),
    questionMeta: $("#questionMeta"),
    typeBadge: $("#typeBadge"),
    difficultyBadge: $("#difficultyBadge"),
    skillBadge: $("#skillBadge"),
    prompt: $("#prompt"),
    stimulus: $("#stimulus"),
    zoomStimulusBtn: $("#zoomStimulusBtn"),
    hintPanel: $("#hintPanel"),
    hintBtn: $("#hintBtn"),
    hintText: $("#hintText"),
    options: $("#options"),
    answerActions: $("#answerActions"),
    selectionCheck: $("#selectionCheck"),
    submitAnswerBtn: $("#submitAnswerBtn"),
    assessmentControls: $("#assessmentControls"),
    previousQuestionBtn: $("#previousQuestionBtn"),
    skipQuestionBtn: $("#skipQuestionBtn"),
    nextQuestionNavBtn: $("#nextQuestionNavBtn"),
    markReviewBtn: $("#markReviewBtn"),
    finishAssessmentBtn: $("#finishAssessmentBtn"),
    questionNavigator: $("#questionNavigator"),
    navigatorSummary: $("#navigatorSummary"),
    questionNumberGrid: $("#questionNumberGrid"),
    feedback: $("#feedback"),
    feedbackIcon: $("#feedbackIcon"),
    feedbackTitle: $("#feedbackTitle"),
    feedbackSubtitle: $("#feedbackSubtitle"),
    optionFeedback: $("#optionFeedback"),
    explanation: $("#explanation"),
    trapBox: $("#trapBox"),
    nextBtn: $("#nextBtn"),
    resultRing: $("#resultRing"),
    resultScore: $("#resultScore"),
    resultTitle: $("#resultTitle"),
    resultSummary: $("#resultSummary"),
    resultBreakdown: $("#resultBreakdown"),
    retryWrongBtn: $("#retryWrongBtn"),
    backHomeBtn: $("#backHomeBtn"),
    zoomDialog: $("#zoomDialog"),
    zoomViewport: $("#zoomViewport"),
    zoomContent: $("#zoomContent"),
    zoomOutBtn: $("#zoomOutBtn"),
    zoomResetBtn: $("#zoomResetBtn"),
    zoomInBtn: $("#zoomInBtn"),
    closeZoomBtn: $("#closeZoomBtn")
  };

  let stats = trainingStore.summary;
  let session = null;
  let restorableSession = null;
  let sessionNoticeMessage = "";
  let timerId = null;
  let questionSegmentBaseElapsedMs = 0;
  let questionSegmentStartedPerformance = null;
  let startingSession = false;
  let finalizingSession = false;

  const zoom = {
    scale: 1,
    x: 0,
    y: 0,
    pointers: new Map(),
    lastPanPoint: null,
    lastPinchDistance: null
  };

  function currentPolicy() {
    return modePolicy(session?.mode);
  }

  function modeLabel(mode) {
    return modePolicy(mode).label;
  }

  function showView(name) {
    Object.entries(views).forEach(([key, element]) => {
      element.classList.toggle("hidden", key !== name);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function questionStats(id) {
    return stats.questions[id] || {
      attempts: 0,
      correct: 0,
      wrong: 0,
      overtime: 0
    };
  }

  function reviewQuestions() {
    const today = localDateKey();
    return bank.filter(question => {
      const progress = trainingStore.getQuestionProgress(question.id);
      if (progress) {
        return (
          Boolean(progress.dueAt && progress.dueAt <= today) ||
          progress.lastReviewReason === "wrong"
        );
      }
      const aggregate = questionStats(question.id);
      return (aggregate.wrong || 0) > (aggregate.correct || 0);
    });
  }

  function typeAccuracy(typeId) {
    const typeQuestions = bank.filter(question => question.typeId === typeId);
    let attempts = 0;
    let correct = 0;
    typeQuestions.forEach(question => {
      const aggregate = questionStats(question.id);
      attempts += aggregate.attempts || 0;
      correct += aggregate.correct || 0;
    });
    return attempts ? Math.round(correct / attempts * 100) : null;
  }

  function compatibilityMessage(reason) {
    const messages = {
      "session-schema":
        "이전 형식의 진행 중 세션은 안전하게 복원할 수 없어 보관만 했습니다.",
      "session-status": "이미 종료된 세션은 이어서 풀 수 없습니다.",
      "session-items":
        "저장된 문제 목록이 없어 진행 중 세션을 복원하지 못했습니다.",
      "question-missing":
        "문제은행에서 세션의 문제를 찾을 수 없어 진행 기록을 보관하고 새 세션을 준비했습니다.",
      "content-version":
        "문제 내용이나 정답이 업데이트되어 기존 세션을 안전하게 복원할 수 없습니다.",
      "grading-fingerprint":
        "정답 의미가 변경된 문제가 있어 기존 세션을 안전하게 복원할 수 없습니다.",
      "option-set":
        "문제 보기가 변경되어 기존 표시 순서를 안전하게 복원할 수 없습니다.",
      "shuffle-version":
        "지원하지 않는 보기 셔플 형식이라 기존 세션을 복원할 수 없습니다.",
      "current-index":
        "저장된 진행 위치가 올바르지 않아 기존 세션을 복원할 수 없습니다."
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
        invalidateSessionSnapshot(latest, prepared.compatibility.reason)
      );
      return;
    }

    restorableSession = prepared.session;
    restorableSession.mode = canonicalMode(restorableSession.mode);
    restorableSession.speed = restorableSession.mode === "speed";
    restorableSession.sessionRevision += 1;
    restorableSession.updatedAt = Date.now();
    void trainingStore
      .saveSession(serializeSession(restorableSession))
      .then(renderStorageNotices);
  }

  function answeredCount(targetSession = session) {
    if (!targetSession) return 0;
    if (modePolicy(targetSession.mode).deferredCommit) {
      return Object.values(targetSession.responses || {})
        .filter(response => response.selectedOptionId).length;
    }
    return targetSession.answers.length;
  }

  function renderResumeNotice() {
    els.resumeNotice.hidden = !restorableSession;
    if (restorableSession) {
      const answered = answeredCount(restorableSession);
      const marked = restorableSession.markedQuestionIds?.length || 0;
      els.resumeTitle.textContent =
        `${modeLabel(restorableSession.mode)}을 이어서 풀 수 있습니다.`;
      els.resumeSummary.textContent =
        `${restorableSession.queue.length}문제 중 ${answered}문제에 답했습니다. ` +
        `${marked ? `검토 표시 ${marked}개와 ` : ""}` +
        "보기 순서·풀이시간을 그대로 복원합니다.";
    }

    els.sessionNotice.hidden = !sessionNoticeMessage;
    els.sessionNotice.textContent = sessionNoticeMessage;
  }

  function firstPassAccuracy() {
    const attempts = stats.v2?.firstPassAttempts || 0;
    return attempts
      ? Math.round((stats.v2.firstPassCorrect || 0) / attempts * 100)
      : null;
  }

  function renderHome() {
    const accuracy = firstPassAccuracy();
    els.streakBadge.textContent =
      `🔥 목표 ${stats.completionStreak || 0}일`;
    els.accuracyBadge.textContent =
      `첫 통과 ${accuracy == null ? "—" : `${accuracy}%`}`;
    els.todaySolved.textContent =
      `${stats.today.goalProgress}/${stats.today.goalTarget}`;
    els.wrongCountLabel.textContent =
      `복습 예정·최근 오답 ${reviewQuestions().length}개`;
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
      message =
        "이 브라우저에서 IndexedDB를 사용할 수 없어 기록을 복구 저널에 임시 보관하고 있습니다. 앱을 닫기 전에 데이터를 내보내세요.";
    } else if (storage.recoveryPending > 0) {
      message =
        `저장 실패 기록 ${storage.recoveryPending}건을 복구 대기 중입니다. ` +
        "다음 실행에서 자동으로 다시 저장합니다.";
    } else if (!storage.cacheAvailable) {
      message =
        "상세 기록은 안전하지만 허브용 요약 캐시를 갱신하지 못했습니다. MKAT를 다시 열면 IndexedDB에서 재생성합니다.";
    }

    els.storageNotice.hidden = !message;
    els.storageNotice.textContent = message;
  }

  function renderCategoryOptions() {
    const categories = [...new Set(types.map(type => type.category))];
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
        button.dataset.typeId = type.id;
        button.innerHTML = `
          <span class="type-code">${type.id} · ${type.category}</span>
          <strong>${escapeHtml(type.title)}</strong>
          <span class="type-accuracy">${
            accuracy == null ? "데이터 수집 중" : `${accuracy}%`
          }</span>
          <small>학습 ${type.count}문제 →</small>
        `;
        button.addEventListener("click", () => {
          void startSession("learn", type.id);
        });
        els.typeGrid.appendChild(button);
      });
  }

  function renderStatsPanel() {
    const accuracy = firstPassAccuracy();
    els.statsPanel.innerHTML = `
      <div class="stat-box">
        <span>오늘의 훈련</span>
        <strong>${stats.today.goalProgress}/${stats.today.goalTarget}</strong>
      </div>
      <div class="stat-box">
        <span>목표 완주 연속</span>
        <strong>${stats.completionStreak || 0}일</strong>
      </div>
      <div class="stat-box">
        <span>복습 예정</span>
        <strong>${stats.mastery?.reviewDue || 0}개</strong>
      </div>
      <div class="stat-box">
        <span>첫 통과 정확도</span>
        <strong>${accuracy == null ? "—" : `${accuracy}%`}</strong>
      </div>
    `;
  }

  function formatPercent(value) {
    return value == null ? "—" : `${value}%`;
  }

  function formatSeconds(value) {
    return value == null ? "—" : `${Math.round(value / 1000)}초`;
  }

  function renderDetailedStats() {
    const analytics = buildDetailedAnalytics({
      attempts: trainingStore.getAllAttempts(),
      questions: bank,
      types,
      cognitiveDomains,
      errorTaxonomy
    });
    const domainRows = analytics.domainRows.map(row => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${row.typeIds.join(" · ")}</td>
        <td>${row.attempts}</td>
        <td class="${row.sampleSufficient ? "" : "collecting"}">
          ${row.sampleSufficient
            ? formatPercent(row.accuracy)
            : "데이터 수집 중"}
        </td>
        <td>${formatSeconds(row.medianElapsedMs)}</td>
      </tr>
    `).join("");
    const supplementalRows = analytics.supplementalRows.map(row => `
      <tr>
        <td>${row.id}</td>
        <td>${escapeHtml(row.title)}</td>
        <td>${row.totalSamples}</td>
        <td class="${row.sampleSufficient ? "" : "collecting"}">
          ${row.sampleSufficient
            ? formatPercent(row.accuracy)
            : "데이터 수집 중"}
        </td>
        <td>${formatSeconds(row.medianElapsedMs)}</td>
      </tr>
    `).join("");
    const typeRows = analytics.typeRows.map(row => {
      return `
        <tr>
          <td>${row.id}</td>
          <td>${escapeHtml(row.title)}</td>
          <td>${row.scoreGroup === "core" ? "핵심" : "보조"}</td>
          <td>${row.totalSamples}</td>
          <td>${row.attempts}</td>
          <td class="${row.sampleSufficient ? "" : "collecting"}">
            ${row.sampleSufficient
              ? formatPercent(row.accuracy)
              : "데이터 수집 중"}
          </td>
          <td>${formatSeconds(row.medianElapsedMs)}</td>
        </tr>
      `;
    }).join("");
    const difficultyCards = analytics.difficultyRows.map(row => `
      <div class="difficulty-stat">
        <span>난이도 ${row.id}</span>
        <strong>${formatPercent(row.accuracy)}</strong>
        <small>${row.attempts}회 · ${formatSeconds(row.medianElapsedMs)}</small>
      </div>
    `).join("");
    const errorRows = analytics.errors.rows.slice(0, 8).map(row => `
      <div class="error-row">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <span>${row.count}회</span>
        </div>
        <div class="error-bar" aria-hidden="true">
          <span style="--error-share: ${Math.max(3, row.share || 0)}%"></span>
        </div>
        <small>${formatPercent(row.share)}</small>
      </div>
    `).join("");
    const recommendedTypes = analytics.recommendations.weakTypes.length
      ? analytics.recommendations.weakTypes
      : analytics.recommendations.collectingTypes;
    const recommendationLabel = analytics.recommendations.weakTypes.length
      ? "최근 정확도와 풀이시간을 기준으로 우선 복습"
      : "아직 약점 판정 표본이 부족해 우선 데이터 수집";
    const recommendationChips = recommendedTypes.length
      ? recommendedTypes.map(row => `
          <span class="recommendation-chip">
            ${row.id} · ${escapeHtml(row.title)}
          </span>
        `).join("")
      : '<span class="recommendation-empty">훈련 기록이 쌓이면 자동으로 추천합니다.</span>';
    const topErrorChips = analytics.recommendations.topErrors.length
      ? analytics.recommendations.topErrors.map(row => `
          <span class="error-chip">${escapeHtml(row.label)} ${row.count}회</span>
        `).join("")
      : '<span class="recommendation-empty">분류된 첫 제출 오답이 아직 없습니다.</span>';

    els.detailedStatsPanel.innerHTML = `
      <div class="analysis-metrics">
        <div class="analysis-metric">
          <span>첫 통과 정확도</span>
          <strong>${formatPercent(analytics.firstPass.accuracy)}</strong>
        </div>
        <div class="analysis-metric">
          <span>시간 내 정확도</span>
          <strong>${formatPercent(analytics.timedAccuracy)}</strong>
        </div>
        <div class="analysis-metric">
          <span>중앙 풀이시간</span>
          <strong>${formatSeconds(
            analytics.firstPass.medianElapsedMs
          )}</strong>
        </div>
        <div class="analysis-metric">
          <span>시간초과율</span>
          <strong>${formatPercent(analytics.firstPass.overtimeRate)}</strong>
        </div>
        <div class="analysis-metric">
          <span>숙달 문제</span>
          <strong>${stats.mastery?.mastered || 0}개</strong>
        </div>
        <div class="analysis-metric">
          <span>복습 예정</span>
          <strong>${stats.mastery?.reviewDue || 0}개</strong>
        </div>
        <div class="analysis-metric">
          <span>핵심 추론 정확도</span>
          <strong>${formatPercent(analytics.coreAbility.accuracy)}</strong>
        </div>
        <div class="analysis-metric">
          <span>보조 유형 정확도</span>
          <strong>${formatPercent(
            analytics.supplementalAbility.accuracy
          )}</strong>
        </div>
      </div>
      <section class="analysis-recommendation card">
        <div>
          <p class="eyebrow">NEXT TRAINING</p>
          <h2>다음 추천 훈련</h2>
          <p>${recommendationLabel}</p>
        </div>
        <div class="recommendation-chips">${recommendationChips}</div>
        <div class="recommendation-errors">
          <strong>자주 나타난 첫 제출 오류</strong>
          <div>${topErrorChips}</div>
        </div>
      </section>
      <section class="analysis-table-card card">
        <h2>핵심 추론 영역</h2>
        <p>T23 스트룹을 제외한 핵심 추론 능력 통계입니다.</p>
        <div class="analysis-table-wrap">
          <table class="analysis-table" data-analysis-table="domains">
            <thead>
              <tr>
                <th>영역</th>
                <th>유형</th>
                <th>표본</th>
                <th>정확도</th>
                <th>중앙 시간</th>
              </tr>
            </thead>
            <tbody>${domainRows}</tbody>
          </table>
        </div>
      </section>
      <section class="analysis-split">
        <article class="analysis-table-card card">
          <h2>난이도별 핵심 성과</h2>
          <p>다차원 프로필의 종합 난이도를 기준으로 묶었습니다.</p>
          <div class="difficulty-grid">${difficultyCards}</div>
        </article>
        <article class="analysis-table-card card">
          <h2>첫 제출 오답 원인</h2>
          <p>
            ${analytics.errors.totalWrongFirstPass}개 오답 중
            ${analytics.errors.classified}개를 선택지 근거로 분류했습니다.
          </p>
          <div class="error-list">
            ${errorRows ||
              '<p class="analysis-empty">분류할 오답이 아직 없습니다.</p>'}
          </div>
        </article>
      </section>
      <section class="analysis-table-card card">
        <h2>보조 지표</h2>
        <p>스트룹은 핵심 추론 점수와 분리해 보조 지표로 봅니다.</p>
        <div class="analysis-table-wrap">
          <table class="analysis-table" data-analysis-table="supplemental">
            <thead>
              <tr>
                <th>유형</th>
                <th>이름</th>
                <th>전체 표본</th>
                <th>최근 정확도</th>
                <th>중앙 시간</th>
              </tr>
            </thead>
            <tbody>${supplementalRows}</tbody>
          </table>
        </div>
      </section>
      <section class="analysis-table-card card">
        <h2>유형별 최근 10회</h2>
        <p>진단·실전·오늘의 훈련 첫 제출만 반영하며, 전체 표본 2회 미만은 약점으로 단정하지 않습니다.</p>
        <div class="analysis-table-wrap">
          <table class="analysis-table" data-analysis-table="types">
            <thead>
              <tr>
                <th>유형</th>
                <th>이름</th>
                <th>구분</th>
                <th>전체</th>
                <th>최근</th>
                <th>최근 정확도</th>
                <th>중앙 시간</th>
              </tr>
            </thead>
            <tbody>${typeRows}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  async function chooseDailyQuestions() {
    const date = localDateKey();
    const dailyQueues = await trainingStore.getDailyQueues();
    const storedQueue = dailyQueues[date] || null;
    const resolved = resolveDailyQueue({
      date,
      bankVersion: data.bankVersion,
      questions: bank,
      attempts: trainingStore.getAllAttempts(),
      questionProgress: trainingStore.getAllQuestionProgress(),
      recentDailyQueues: dailyQueues,
      storedQueue,
      now: Date.now()
    });
    if (resolved.changed) {
      await trainingStore.saveDailyQueue(resolved.queue);
    }

    return resolved.queue.items.map(item => ({
      ...bankById.get(item.questionId),
      selectionReason: item.reason
    }));
  }

  function chooseOnePerType(mode) {
    const seed = hashString(`${mode}-${Date.now()}`);
    return types.map((type, index) => {
      const questions = bank.filter(question => question.typeId === type.id);
      return questions[(seed + index * 7) % questions.length];
    });
  }

  function chooseSpeed15() {
    const weak = reviewQuestions();
    const pool = [...weak, ...bank];
    const unique = [];
    for (const question of shuffled(pool, Date.now())) {
      if (!unique.some(candidate => candidate.id === question.id)) {
        unique.push(question);
      }
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
    if (session.phase === "question") {
      pauseAndStoreCurrentQuestion();
    }
    session.status = status;
    touchSession();
    if (status === "completed") {
      session.completedAt = session.updatedAt;
      session.finalizedAt = session.updatedAt;
    }
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

  async function startSession(mode, typeId = null, suppliedQueue = null) {
    if (startingSession) return;
    startingSession = true;
    try {
      const normalizedMode = canonicalMode(mode);
      let queue;
      if (suppliedQueue) {
        queue = suppliedQueue;
      } else if (normalizedMode === "daily") {
        queue = await chooseDailyQuestions();
      } else if (normalizedMode === "diagnostic" ||
                 normalizedMode === "exam") {
        queue = chooseOnePerType(normalizedMode);
      } else if (normalizedMode === "speed") {
        queue = chooseSpeed15();
      } else if (normalizedMode === "review") {
        const due = reviewQuestions();
        if (!due.length) {
          alert("오늘 복습할 문제가 없습니다. 오늘의 훈련을 시작해 보세요.");
          return;
        }
        queue = shuffled(due, Date.now()).slice(0, 25);
      } else if (normalizedMode === "learn") {
        queue = shuffled(
          bank.filter(question => question.typeId === typeId),
          Date.now()
        );
      } else {
        queue = shuffled(bank, Date.now()).slice(0, 10);
      }

      const previousOrders =
        normalizedMode === "retry" && session
          ? new Map(
              session.items.map(item => [
                item.questionId,
                item.presentedOptionIds
              ])
            )
          : null;
      abandonRestorableSession();
      const now = Date.now();
      const snapshot = createSessionSnapshot({
        sessionId: createRecordId("session"),
        bankVersion: data.bankVersion,
        mode: normalizedMode,
        typeId,
        questions: queue,
        previousPresentedOptionIdsByQuestion: previousOrders,
        examEndsAt: normalizedMode === "exam"
          ? now + examDurationMs(queue)
          : null,
        now
      });
      const prepared = restoreSessionSnapshot({
        snapshot,
        questions: bank,
        currentBankVersion: data.bankVersion,
        now
      });
      if (!prepared.ok) {
        throw new Error("새 세션의 보기 순서를 구성하지 못했습니다.");
      }

      session = prepared.session;
      session.restored = false;
      session.speed = normalizedMode === "speed";
      showView("quiz");
      renderQuestion();
    } catch (error) {
      console.error(error);
      alert("훈련 세트를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      startingSession = false;
    }
  }

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function currentQuestionElapsedMs() {
    if (!session?.timer) return 0;
    if (
      session.timer.state !== "running" ||
      questionSegmentStartedPerformance == null
    ) {
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

  function formatClock(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function startTimer() {
    clearTimer();
    updateTimer();
    timerId = setInterval(updateTimer, 250);
  }

  function updateTimer() {
    if (!session) return;
    const policy = currentPolicy();
    if (policy.timer === "hard-session") {
      const remainingMs = Number(session.examEndsAt || 0) - Date.now();
      els.timer.textContent = formatClock(remainingMs);
      els.timer.classList.toggle("overtime", remainingMs <= 60000);
      if (remainingMs <= 0 && !finalizingSession) {
        clearTimer();
        void finalizeAssessment({ automatic: true });
      }
      return;
    }

    const elapsedMs = currentQuestionElapsedMs();
    const limitMs = session.timer?.limitMs || 45000;
    const overtime = elapsedMs > limitMs;
    els.timer.classList.toggle("overtime", overtime);
    if (policy.timer === "elapsed-question") {
      els.timer.textContent = formatClock(elapsedMs);
    } else {
      els.timer.textContent = formatClock(limitMs - elapsedMs);
    }
  }

  function beginQuestionClock(question) {
    const now = Date.now();
    const stored = session.questionTimers?.[question.id];
    const matchesCurrent =
      session.timer?.questionIndex === session.index &&
      session.timer?.questionId === question.id &&
      session.timer?.state !== "completed";
    const reusable = stored?.state !== "completed"
      ? stored
      : null;

    session.timer = matchesCurrent
      ? resumeQuestionClock(session.timer, now)
      : reusable
        ? resumeQuestionClock(reusable, now)
        : createQuestionClock({
            questionIndex: session.index,
            questionId: question.id,
            limitMs: (question.timeLimitSec || 45) * 1000,
            now
          });
    session.timer.questionIndex = session.index;
    session.questionTimers[question.id] = { ...session.timer };
    questionSegmentBaseElapsedMs = session.timer.elapsedMs;
    questionSegmentStartedPerformance = performance.now();
    startTimer();
  }

  function pauseAndStoreCurrentQuestion({ complete = false } = {}) {
    if (!session?.timer) return;
    const elapsedMs = currentQuestionElapsedMs();
    const now = Date.now();
    session.timer = complete
      ? completeQuestionClock(session.timer, { now, elapsedMs })
      : pauseQuestionClock(session.timer, { now, elapsedMs });
    if (session.timer?.questionId) {
      session.questionTimers[session.timer.questionId] = {
        ...session.timer
      };
    }
    questionSegmentBaseElapsedMs = session.timer?.elapsedMs || 0;
    questionSegmentStartedPerformance = null;
    clearTimer();
    updateTimer();
  }

  function resumeCurrentQuestion({ persist = false } = {}) {
    if (!session?.timer || session.timer.state === "completed") return;
    session.timer = resumeQuestionClock(session.timer, Date.now());
    session.questionTimers[session.timer.questionId] = {
      ...session.timer
    };
    questionSegmentBaseElapsedMs = session.timer.elapsedMs;
    questionSegmentStartedPerformance = performance.now();
    startTimer();
    if (persist) void persistSession();
  }

  function currentQuestion() {
    return session?.queue?.[session.index] || null;
  }

  function renderHint(question, policy) {
    els.hintPanel.classList.toggle("hidden", !policy.allowHint);
    const hints = Array.isArray(question.hints) && question.hints.length
      ? question.hints.slice(0, 2)
      : [
          `핵심 기술은 '${question.skills?.[0] || "조건 분리"}'입니다.`,
          "개수·위치·방향을 각각 나눠 마지막에 다시 결합하세요."
        ];
    const legacyUsed = session.hintUsedQuestionIds.includes(question.id);
    const level = Math.min(
      hints.length,
      Number(session.hintLevels?.[question.id]) || (legacyUsed ? 1 : 0)
    );
    els.hintText.hidden = level === 0;
    els.hintText.innerHTML = hints
      .slice(0, level)
      .map((hint, index) => `
        <p>
          <strong>힌트 ${index + 1}</strong>
          <span>${escapeHtml(hint)}</span>
        </p>
      `)
      .join("");
    els.hintBtn.textContent = level === 0
      ? "힌트 1 보기"
      : level < hints.length
        ? `힌트 ${level + 1} 보기`
        : "힌트 모두 확인";
    els.hintBtn.disabled = level >= hints.length;
  }

  function renderOptionButtons(question, policy) {
    els.options.innerHTML = "";
    els.options.dataset.questionId = question.id;
    els.options.className =
      `options-grid layout-${inferOptionLayout(question)}`;
    const response = session.responses?.[question.id];
    const candidateId =
      session.pendingSelectionId || response?.selectedOptionId || null;

    question.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-button";
      button.dataset.index = index;
      button.dataset.optionId = option.id;
      button.setAttribute("aria-label", `${index + 1}번 보기`);
      button.setAttribute(
        "aria-pressed",
        candidateId === option.id ? "true" : "false"
      );
      if (candidateId === option.id) button.classList.add("candidate");
      let content = `<span class="option-index">${index + 1}</span>`;
      if (option.svg) {
        content += `<span class="option-svg">${option.svg}</span>`;
      }
      if (option.text != null) {
        content +=
          `<span class="option-text">${escapeHtml(option.text)}` +
          `${option.suffix ? escapeHtml(option.suffix) : ""}</span>`;
      }
      button.innerHTML = content;
      button.addEventListener("click", () => {
        if (policy.submission === "instant") {
          void answerImmediate(index);
        } else {
          selectCandidate(option.id);
        }
      });
      els.options.appendChild(button);
    });
  }

  function renderSubmitControls(policy) {
    const candidate = Boolean(session.pendingSelectionId);
    els.answerActions.classList.toggle(
      "hidden",
      policy.submission === "instant"
    );
    els.submitAnswerBtn.disabled = !candidate || session.locked;
    els.submitAnswerBtn.textContent = policy.deferredCommit
      ? "답안 저장 후 다음"
      : "최종 제출";
    els.selectionCheck.textContent = candidate
      ? "선택한 보기의 개수·위치·방향·번호를 마지막으로 확인하세요."
      : "보기를 고른 뒤 개수·위치·방향·번호를 확인하세요.";

    els.assessmentControls.classList.toggle(
      "hidden",
      !policy.navigation
    );
    els.questionNavigator.classList.toggle(
      "hidden",
      !policy.navigation
    );
    if (policy.navigation) {
      els.previousQuestionBtn.disabled = session.index === 0;
      els.nextQuestionNavBtn.disabled =
        session.index === session.queue.length - 1;
      const marked = session.markedQuestionIds.includes(
        currentQuestion().id
      );
      els.markReviewBtn.setAttribute(
        "aria-pressed",
        marked ? "true" : "false"
      );
      els.markReviewBtn.textContent = marked
        ? "★ 다시 볼 문제"
        : "☆ 다시 볼 문제";
      els.finishAssessmentBtn.textContent =
        policy.id === "exam" ? "시험 제출" : "진단 제출";
      renderQuestionNavigator();
    }
  }

  function renderQuestionNavigator() {
    if (!session || !currentPolicy().navigation) return;
    const responses = session.responses || {};
    const answered = Object.values(responses).filter(
      response => response.selectedOptionId
    ).length;
    const skipped = Object.values(responses).filter(
      response => response.skipped && !response.selectedOptionId
    ).length;
    const unanswered = session.queue.length - answered - skipped;
    els.navigatorSummary.textContent =
      `답안 ${answered} · 건너뜀 ${skipped} · 미응답 ${unanswered}`;
    els.questionNumberGrid.innerHTML = "";
    session.queue.forEach((question, index) => {
      const response = responses[question.id];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-number-button";
      button.textContent = String(index + 1);
      button.setAttribute(
        "aria-label",
        `${index + 1}번 문제${
          response?.selectedOptionId
            ? ", 답안 저장됨"
            : response?.skipped
              ? ", 건너뜀"
              : ", 미응답"
        }`
      );
      if (response?.selectedOptionId) button.classList.add("answered");
      if (response?.skipped && !response.selectedOptionId) {
        button.classList.add("skipped");
      }
      if (session.markedQuestionIds.includes(question.id)) {
        button.classList.add("marked");
      }
      if (index === session.index) {
        button.classList.add("current");
        button.setAttribute("aria-current", "step");
      }
      button.addEventListener("click", () => navigateToQuestion(index));
      els.questionNumberGrid.appendChild(button);
    });
  }

  function renderQuestion() {
    clearTimer();
    const question = currentQuestion();
    const policy = currentPolicy();
    if (!question) return;

    session.locked = session.phase === "feedback";
    const deferred = policy.deferredCommit;
    const completed = deferred
      ? answeredCount()
      : session.answers.length;
    els.quizModeLabel.textContent = policy.label;
    els.progressText.textContent =
      `${session.index + 1} / ${session.queue.length}`;
    els.progressBar.style.width =
      `${completed / session.queue.length * 100}%`;
    els.sessionScore.textContent = deferred
      ? `답안 ${completed}`
      : `정답 ${session.score}`;
    els.questionMeta.classList.toggle("hidden", !policy.showQuestionMeta);
    els.typeBadge.textContent = `${question.typeId} · ${question.typeTitle}`;
    els.difficultyBadge.textContent = `난이도 ${question.difficulty}`;
    const profile = question.difficultyProfile;
    els.difficultyBadge.title = profile
      ? [
          `규칙 단계 ${profile.ruleSteps}`,
          `속성 부하 ${profile.attributeLoad}`,
          `작업 기억 ${profile.workingMemory}`,
          `시각 복잡도 ${profile.visualComplexity}`,
          `오답 유사도 ${profile.distractorSimilarity}`,
          `시간 압박 ${profile.timePressure}`
        ].join(" · ")
      : "";
    els.skillBadge.textContent = question.skills.slice(0, 2).join(" · ");
    els.prompt.textContent = question.prompt;
    els.stimulus.innerHTML = question.stimulusSvg || "";
    els.zoomStimulusBtn.hidden = !question.stimulusSvg;
    els.feedback.classList.add("hidden");
    els.feedback.classList.remove("correct-feedback", "wrong-feedback");
    els.optionFeedback.hidden = true;
    els.optionFeedback.replaceChildren();
    els.explanation.replaceChildren();
    renderHint(question, policy);

    if (deferred && session.pendingSelectionId == null) {
      session.pendingSelectionId =
        session.responses?.[question.id]?.selectedOptionId || null;
    }
    renderOptionButtons(question, policy);
    renderSubmitControls(policy);

    if (session.phase === "feedback") {
      questionSegmentBaseElapsedMs = session.timer?.elapsedMs || 0;
      questionSegmentStartedPerformance = null;
      updateTimer();
      const answer = session.answers.at(-1);
      if (answer?.id === question.id) {
        renderStoredFeedback(question, answer);
      }
      return;
    }

    beginQuestionClock(question);
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

  function selectCandidate(optionId) {
    if (!session || session.locked) return;
    session.pendingSelectionId = optionId;
    $$(".option-button").forEach(button => {
      const selected = button.dataset.optionId === optionId;
      button.classList.toggle("candidate", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    renderSubmitControls(currentPolicy());
    void persistSession();
  }

  function buildAttempt(question, response, sessionItem) {
    const submittedAt = response.submittedAt || Date.now();
    const selectedOption = question.options.find(
      option => option.id === response.selectedOptionId
    );
    const skipped = !selectedOption;
    const correct = !skipped &&
      response.selectedOptionId === question.correctOptionId;
    const elapsedMs = Math.max(0, Math.round(response.elapsedMs || 0));
    const overtime =
      elapsedMs > (question.timeLimitSec || 45) * 1000;
    const retry = session.mode === "retry";
    const hintUsed = Boolean(response.hintUsed);
    const eligibility = attemptEligibility({
      mode: session.mode,
      retry,
      hintUsed,
      overtime,
      skipped
    });

    return {
      attemptId: response.attemptId || createRecordId("attempt"),
      sessionId: session.sessionId,
      questionId: question.id,
      contentVersion: question.contentVersion,
      gradingFingerprint: question.gradingFingerprint,
      bankVersion: data.bankVersion,
      typeId: question.typeId,
      domainId: question.domainId || null,
      scoreGroup: question.scoreGroup || "core",
      difficulty: question.difficulty,
      mode: session.mode,
      localDate: localDateKey(new Date(submittedAt)),

      selectedOptionId: selectedOption?.id || null,
      presentedOptionIds: question.options.map(option => option.id),
      optionSeed: sessionItem.optionSeed,
      shuffleVersion: sessionItem.shuffleVersion,

      correct,
      firstPass: eligibility.firstPass,
      retry: eligibility.retry,
      hintUsed,
      elapsedMs,
      overtime,
      skipped,

      inferredErrorTag:
        !correct && selectedOption ? selectedOption.errorTag || null : null,
      presentedAt: response.presentedAt || submittedAt,
      submittedAt,

      eligibleForDailyGoal: eligibility.eligibleForDailyGoal,
      eligibleForMastery: eligibility.eligibleForMastery,
      eligibleForAbilityStats: eligibility.eligibleForAbilityStats,
      eligibleForSpeedStats: eligibility.eligibleForSpeedStats
    };
  }

  async function answerImmediate(selectedIndex) {
    if (!session || session.locked || finalizingSession) return;
    const selectedOption = currentQuestion()?.options?.[selectedIndex];
    if (!selectedOption) return;
    session.locked = true;
    const answeredSession = session;
    const question = currentQuestion();
    const submittedAt = Date.now();
    pauseAndStoreCurrentQuestion({ complete: true });
    const elapsedMs = session.timer?.elapsedMs || 0;
    const response = {
      questionId: question.id,
      selectedOptionId: selectedOption.id,
      attemptId: createRecordId("attempt"),
      elapsedMs,
      overtime: elapsedMs > (question.timeLimitSec || 45) * 1000,
      skipped: false,
      hintUsed: session.hintUsedQuestionIds.includes(question.id),
      presentedAt: session.timer?.presentedAt || submittedAt,
      submittedAt
    };
    const attempt = buildAttempt(
      question,
      response,
      session.items[session.index]
    );
    if (attempt.correct) session.score += 1;

    session.answers.push({
      id: question.id,
      typeId: question.typeId,
      correct: attempt.correct,
      overtime: attempt.overtime,
      selectedIndex,
      selectedOptionId: attempt.selectedOptionId,
      presentedOptionIds: attempt.presentedOptionIds,
      elapsedMs: attempt.elapsedMs,
      hintUsed: attempt.hintUsed,
      inferredErrorTag: attempt.inferredErrorTag,
      attemptId: attempt.attemptId
    });
    session.pendingSelectionId = null;
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
    if (currentPolicy().feedback === "none") {
      window.setTimeout(nextQuestion, 320);
      return;
    }
    renderStoredFeedback(question, session.answers.at(-1));
  }

  function renderExplanation(explanation) {
    const sections = typeof explanation === "string"
      ? [{ label: "해설", text: explanation }]
      : [
          { label: "규칙", text: explanation?.rule },
          { label: "적용", text: explanation?.application },
          { label: "검산", text: explanation?.verification }
        ].filter(section => section.text);

    els.explanation.replaceChildren();
    for (const section of sections) {
      const item = document.createElement("section");
      item.className = "explanation-step";
      const label = document.createElement("strong");
      label.textContent = section.label;
      const text = document.createElement("p");
      text.textContent = section.text;
      item.append(label, text);
      els.explanation.appendChild(item);
    }
  }

  function renderOptionFeedback(selectedOption) {
    const feedback = selectedOption?.feedback;
    els.optionFeedback.hidden = !feedback;
    els.optionFeedback.replaceChildren();
    if (!feedback) return;

    const label = errorTaxonomyById.get(selectedOption.errorTag)?.label ||
      "선택 과정 점검";
    const title = document.createElement("strong");
    title.textContent = `오답 원인 · ${label}`;
    const copy = document.createElement("p");
    copy.textContent = feedback;
    els.optionFeedback.append(title, copy);
  }

  function renderStoredFeedback(question, answer) {
    const correctIndex = question.options.findIndex(
      option => option.id === question.correctOptionId
    );
    const selectedIndex = question.options.findIndex(
      option => option.id === answer.selectedOptionId
    );
    const buttons = $$(".option-button");
    buttons.forEach((button, index) => {
      button.disabled = true;
      button.classList.remove("candidate");
      if (index === correctIndex) button.classList.add("correct");
      if (index === selectedIndex) {
        button.classList.add("selected");
        if (!answer.correct) button.classList.add("wrong");
      }
    });
    els.answerActions.classList.add("hidden");

    const remainingMs = Math.max(
      0,
      (question.timeLimitSec || 45) * 1000 - answer.elapsedMs
    );
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
      : `남은 시간 ${Math.ceil(remainingMs / 1000)}초`;
    const selectedOption = question.options.find(
      option => option.id === answer.selectedOptionId
    );
    renderOptionFeedback(answer.correct ? null : selectedOption);
    renderExplanation(question.explanation);
    els.trapBox.textContent = question.trap
      ? `실전 함정: ${question.trap}`
      : "정답을 선택한 뒤 개수·위치·방향을 마지막으로 확인하세요.";
    els.nextBtn.textContent =
      session.index === session.queue.length - 1
        ? "결과 보기 →"
        : "다음 문제 →";
    els.feedback.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }

  async function storeDeferredResponse({ skipped = false } = {}) {
    if (!session || !currentPolicy().deferredCommit) return;
    const question = currentQuestion();
    const selectedOptionId = skipped
      ? null
      : session.pendingSelectionId;
    if (!selectedOptionId && !skipped) return;
    pauseAndStoreCurrentQuestion();
    const now = Date.now();
    const previous = session.responses[question.id] || {};
    session.responses[question.id] = {
      questionId: question.id,
      selectedOptionId,
      attemptId: previous.attemptId || createRecordId("attempt"),
      elapsedMs: session.timer?.elapsedMs || previous.elapsedMs || 0,
      overtime:
        (session.timer?.elapsedMs || 0) >
        (question.timeLimitSec || 45) * 1000,
      skipped,
      hintUsed: false,
      presentedAt:
        previous.presentedAt || session.timer?.presentedAt || now,
      submittedAt: now
    };
    session.pendingSelectionId = null;
    touchSession();
    await trainingStore.saveSession(sessionRecord());
    renderStorageNotices();
    renderQuestionNavigator();

    const nextIndex = nextUnansweredIndex(session.index);
    if (nextIndex != null) {
      navigateToQuestion(nextIndex);
    } else {
      renderQuestion();
    }
  }

  function nextUnansweredIndex(fromIndex) {
    for (let offset = 1; offset < session.queue.length; offset += 1) {
      const index = (fromIndex + offset) % session.queue.length;
      const response = session.responses[session.queue[index].id];
      if (!response?.selectedOptionId && !response?.skipped) return index;
    }
    return fromIndex < session.queue.length - 1 ? fromIndex + 1 : null;
  }

  function navigateToQuestion(index) {
    if (
      !session ||
      !currentPolicy().navigation ||
      index < 0 ||
      index >= session.queue.length ||
      index === session.index
    ) {
      return;
    }
    pauseAndStoreCurrentQuestion();
    session.index = index;
    session.currentIndex = index;
    session.phase = "question";
    session.locked = false;
    session.pendingSelectionId =
      session.responses?.[session.queue[index].id]?.selectedOptionId || null;
    touchSession();
    renderQuestion();
  }

  function toggleMarkedQuestion() {
    if (!session || !currentPolicy().navigation) return;
    const questionId = currentQuestion().id;
    const marked = new Set(session.markedQuestionIds);
    if (marked.has(questionId)) marked.delete(questionId);
    else marked.add(questionId);
    session.markedQuestionIds = [...marked];
    renderSubmitControls(currentPolicy());
    void persistSession();
  }

  function deferredAttempts() {
    const now = Date.now();
    return session.queue.map((question, index) => {
      const response = session.responses[question.id] || {
        questionId: question.id,
        selectedOptionId: null,
        attemptId: createRecordId("attempt"),
        elapsedMs:
          session.questionTimers?.[question.id]?.elapsedMs || 0,
        skipped: true,
        hintUsed: false,
        presentedAt:
          session.questionTimers?.[question.id]?.presentedAt ||
          session.startedAt,
        submittedAt: now
      };
      const timer = session.questionTimers?.[question.id];
      const normalized = {
        ...response,
        elapsedMs: timer?.elapsedMs ?? response.elapsedMs ?? 0,
        skipped: !response.selectedOptionId,
        submittedAt: response.submittedAt || now
      };
      normalized.attemptId =
        response.attemptId || createRecordId("attempt");
      session.responses[question.id] = normalized;
      return buildAttempt(question, normalized, session.items[index]);
    });
  }

  async function finalizeAssessment({ automatic = false } = {}) {
    if (
      !session ||
      !currentPolicy().deferredCommit ||
      finalizingSession
    ) {
      return;
    }
    const unanswered = session.queue.length - answeredCount();
    if (
      !automatic &&
      unanswered > 0 &&
      !confirm(
        `답하지 않은 문제가 ${unanswered}개 있습니다. 그대로 제출할까요?`
      )
    ) {
      return;
    }

    finalizingSession = true;
    session.locked = true;
    pauseAndStoreCurrentQuestion();
    const attempts = deferredAttempts();
    session.answers = attempts.map(attempt => ({
      id: attempt.questionId,
      typeId: bankById.get(attempt.questionId)?.typeId || null,
      correct: attempt.correct,
      overtime: attempt.overtime,
      selectedOptionId: attempt.selectedOptionId,
      presentedOptionIds: attempt.presentedOptionIds,
      elapsedMs: attempt.elapsedMs,
      skipped: attempt.skipped,
      attemptId: attempt.attemptId
    }));
    session.score = attempts.filter(attempt => attempt.correct).length;
    session.status = "completed";
    session.phase = "question";
    session.pendingSelectionId = null;
    session.completedAt = Date.now();
    session.finalizedAt = session.completedAt;
    touchSession();

    try {
      const persistence = await trainingStore.recordAttemptBatch(
        attempts,
        sessionRecord()
      );
      stats = persistence.summary;
      renderStorageNotices();
      showResults({ automatic });
    } catch (error) {
      console.error(error);
      els.storageNotice.hidden = false;
      els.storageNotice.textContent =
        "테스트 결과를 저장하지 못했습니다. 앱을 닫지 말고 다시 제출해 주세요.";
      session.status = "active";
      session.locked = false;
    } finally {
      finalizingSession = false;
    }
  }

  function nextQuestion() {
    if (!session) return;
    if (session.index >= session.queue.length - 1) {
      void completeImmediateSession();
      return;
    }
    session.index += 1;
    session.currentIndex = session.index;
    session.phase = "question";
    session.timer = null;
    session.pendingSelectionId = null;
    session.locked = false;
    session.updatedAt = Date.now();
    renderQuestion();
  }

  async function completeImmediateSession() {
    clearTimer();
    await saveSessionStatus("completed");
    showResults();
  }

  function showResults({ automatic = false } = {}) {
    clearTimer();
    const total = session.queue.length;
    const percent = total
      ? Math.round(session.score / total * 100)
      : 0;
    const wrong = session.answers.filter(answer => !answer.correct);
    const skipped = session.answers.filter(answer => answer.skipped).length;
    const overtimeCount = session.answers.filter(
      answer => answer.overtime
    ).length;
    const medianSeconds = Math.round(
      median(session.answers.map(answer => answer.elapsedMs || 0)) / 1000
    );
    els.resultRing.style.setProperty(
      "--score-angle",
      `${percent * 3.6}deg`
    );
    els.resultScore.textContent = `${percent}%`;
    els.resultTitle.textContent = automatic
      ? "제한시간이 끝나 자동 제출했습니다."
      : percent >= 90
        ? "상위권 안정성에 가까워졌습니다."
        : percent >= 75
          ? "좋습니다. 실수를 더 줄이면 됩니다."
          : "오답은 약점 지도가 됩니다.";
    els.resultSummary.textContent =
      `${total}문제 중 ${session.score}문제를 맞혔습니다. ` +
      `틀리거나 건너뛴 ${wrong.length}문제는 바로 재훈련할 수 있습니다.`;
    els.resultBreakdown.innerHTML = `
      <div><span>정답</span><strong>${session.score}</strong></div>
      <div><span>오답</span><strong>${wrong.length - skipped}</strong></div>
      <div><span>건너뜀</span><strong>${skipped}</strong></div>
      <div><span>중앙 시간</span><strong>${medianSeconds}초</strong></div>
      <div><span>시간초과</span><strong>${overtimeCount}</strong></div>
    `;
    els.retryWrongBtn.disabled = !wrong.length;
    els.retryWrongBtn.style.opacity = wrong.length ? "1" : ".45";
    els.progressBar.style.width = "100%";
    showView("result");
  }

  function goHome({ abandon = true } = {}) {
    clearTimer();
    if (abandon && session?.status === "active") {
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
    session.mode = canonicalMode(session.mode);
    session.speed = session.mode === "speed";
    session.updatedAt = Date.now();
    showView("quiz");

    if (
      session.mode === "exam" &&
      session.examEndsAt &&
      Date.now() >= session.examEndsAt
    ) {
      void finalizeAssessment({ automatic: true });
      return;
    }
    if (session.speed && session.phase === "feedback") {
      nextQuestion();
      return;
    }
    renderQuestion();
  }

  function autoFinalizeExpiredExam() {
    if (
      !restorableSession ||
      restorableSession.mode !== "exam" ||
      !restorableSession.examEndsAt ||
      Date.now() < restorableSession.examEndsAt
    ) {
      return;
    }

    session = restorableSession;
    restorableSession = null;
    session.status = "active";
    session.speed = false;
    showView("quiz");
    void finalizeAssessment({ automatic: true });
  }

  function revealHint() {
    if (!session || !currentPolicy().allowHint) return;
    const question = currentQuestion();
    const questionId = question.id;
    const maxLevel = Math.min(
      2,
      Array.isArray(question.hints) && question.hints.length
        ? question.hints.length
        : 2
    );
    session.hintLevels ||= {};
    const currentLevel = Math.min(
      maxLevel,
      Number(session.hintLevels[questionId]) || 0
    );
    if (currentLevel >= maxLevel) return;
    session.hintLevels[questionId] = currentLevel + 1;
    if (!session.hintUsedQuestionIds.includes(questionId)) {
      session.hintUsedQuestionIds.push(questionId);
    }
    renderHint(question, currentPolicy());
    void persistSession();
  }

  function resetZoom() {
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    zoom.pointers.clear();
    zoom.lastPanPoint = null;
    zoom.lastPinchDistance = null;
    renderZoom();
  }

  function renderZoom() {
    zoom.scale = Math.min(4, Math.max(1, zoom.scale));
    if (zoom.scale === 1) {
      zoom.x = 0;
      zoom.y = 0;
    }
    els.zoomContent.style.transform =
      `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    els.zoomResetBtn.textContent = `${Math.round(zoom.scale * 100)}%`;
  }

  function openZoom() {
    const question = currentQuestion();
    if (!question?.stimulusSvg) return;
    els.zoomContent.innerHTML = question.stimulusSvg;
    resetZoom();
    els.zoomDialog.showModal();
  }

  function changeZoom(factor) {
    zoom.scale *= factor;
    renderZoom();
  }

  function pointerDistance() {
    const points = [...zoom.pointers.values()];
    if (points.length < 2) return null;
    return Math.hypot(
      points[0].x - points[1].x,
      points[0].y - points[1].y
    );
  }

  $$(".mode-card").forEach(button => {
    button.addEventListener("click", () => {
      void startSession(button.dataset.mode);
    });
  });
  els.categoryFilter.addEventListener("change", renderTypeGrid);
  els.viewDetailedStatsBtn.addEventListener("click", () => {
    renderDetailedStats();
    showView("stats");
  });
  els.statsBackBtn.addEventListener("click", () => {
    renderHome();
    showView("home");
  });
  els.submitAnswerBtn.addEventListener("click", () => {
    const policy = currentPolicy();
    if (policy.deferredCommit) {
      void storeDeferredResponse();
      return;
    }
    const selectedIndex = currentQuestion().options.findIndex(
      option => option.id === session.pendingSelectionId
    );
    if (selectedIndex >= 0) void answerImmediate(selectedIndex);
  });
  els.nextBtn.addEventListener("click", nextQuestion);
  els.previousQuestionBtn.addEventListener("click", () => {
    navigateToQuestion(session.index - 1);
  });
  els.nextQuestionNavBtn.addEventListener("click", () => {
    navigateToQuestion(session.index + 1);
  });
  els.skipQuestionBtn.addEventListener("click", () => {
    void storeDeferredResponse({ skipped: true });
  });
  els.markReviewBtn.addEventListener("click", toggleMarkedQuestion);
  els.finishAssessmentBtn.addEventListener("click", () => {
    void finalizeAssessment();
  });
  els.hintBtn.addEventListener("click", revealHint);
  els.quitBtn.addEventListener("click", () => {
    const hasProgress =
      answeredCount() > 0 ||
      Object.keys(session?.responses || {}).length > 0;
    if (
      !session ||
      !hasProgress ||
      confirm("현재 훈련을 종료하고 홈으로 돌아갈까요?")
    ) {
      goHome();
    }
  });
  els.homeBtn.addEventListener("click", () => {
    if (
      !session ||
      session.status !== "active" ||
      confirm("현재 훈련을 종료하고 홈으로 돌아갈까요?")
    ) {
      goHome();
    }
  });
  els.backHomeBtn.addEventListener("click", () => goHome({ abandon: false }));
  els.retryWrongBtn.addEventListener("click", () => {
    if (!session) return;
    const wrongIds = new Set(
      session.answers
        .filter(answer => !answer.correct)
        .map(answer => answer.id)
    );
    const retry = bank.filter(question => wrongIds.has(question.id));
    if (retry.length) {
      void startSession("retry", null, shuffled(retry, Date.now()));
    }
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

  els.zoomStimulusBtn.addEventListener("click", openZoom);
  els.closeZoomBtn.addEventListener("click", () => els.zoomDialog.close());
  els.zoomOutBtn.addEventListener("click", () => changeZoom(0.8));
  els.zoomInBtn.addEventListener("click", () => changeZoom(1.25));
  els.zoomResetBtn.addEventListener("click", resetZoom);
  els.zoomDialog.addEventListener("click", event => {
    if (event.target === els.zoomDialog) els.zoomDialog.close();
  });
  els.zoomViewport.addEventListener("wheel", event => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });
  els.zoomViewport.addEventListener("pointerdown", event => {
    els.zoomViewport.setPointerCapture(event.pointerId);
    zoom.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    zoom.lastPanPoint = { x: event.clientX, y: event.clientY };
    zoom.lastPinchDistance = pointerDistance();
    els.zoomViewport.classList.add("dragging");
  });
  els.zoomViewport.addEventListener("pointermove", event => {
    if (!zoom.pointers.has(event.pointerId)) return;
    const previous = zoom.pointers.get(event.pointerId);
    zoom.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (zoom.pointers.size >= 2) {
      const distance = pointerDistance();
      if (zoom.lastPinchDistance && distance) {
        zoom.scale *= distance / zoom.lastPinchDistance;
      }
      zoom.lastPinchDistance = distance;
    } else if (zoom.scale > 1 && previous) {
      zoom.x += event.clientX - previous.x;
      zoom.y += event.clientY - previous.y;
    }
    zoom.lastPanPoint = { x: event.clientX, y: event.clientY };
    renderZoom();
  });
  const endPointer = event => {
    zoom.pointers.delete(event.pointerId);
    zoom.lastPinchDistance = pointerDistance();
    if (!zoom.pointers.size) {
      zoom.lastPanPoint = null;
      els.zoomViewport.classList.remove("dragging");
    }
  };
  els.zoomViewport.addEventListener("pointerup", endPointer);
  els.zoomViewport.addEventListener("pointercancel", endPointer);

  window.addEventListener("keydown", event => {
    if (
      views.quiz.classList.contains("hidden") ||
      !session ||
      session.locked
    ) {
      return;
    }
    const number = Number(event.key);
    if (number >= 1 && number <= 9) {
      const question = currentQuestion();
      if (number <= question.options.length) {
        if (currentPolicy().submission === "instant") {
          void answerImmediate(number - 1);
        } else {
          selectCandidate(question.options[number - 1].id);
        }
      }
    } else if (event.key === "Enter" && session.pendingSelectionId) {
      els.submitAnswerBtn.click();
    } else if (currentPolicy().navigation && event.key === "ArrowLeft") {
      navigateToQuestion(session.index - 1);
    } else if (currentPolicy().navigation && event.key === "ArrowRight") {
      navigateToQuestion(session.index + 1);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (
      !session ||
      views.quiz.classList.contains("hidden") ||
      session.phase !== "question"
    ) {
      return;
    }
    if (session.mode === "exam") {
      void persistSession();
      if (!document.hidden) updateTimer();
      return;
    }
    if (document.hidden) {
      pauseAndStoreCurrentQuestion();
      void persistSession();
    } else {
      resumeCurrentQuestion({ persist: true });
    }
  });
  window.addEventListener("pagehide", () => {
    if (session?.phase !== "question") return;
    if (session.mode !== "exam") pauseAndStoreCurrentQuestion();
    void persistSession();
  });

  prepareRestorableSession();
  renderCategoryOptions();
  renderHome();
  autoFinalizeExpiredExam();
}

bootstrap();
