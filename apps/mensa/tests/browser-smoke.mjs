import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..", "..");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function findBrowser() {
  const candidates = [];
  if (process.env.CHROMIUM_PATH) candidates.push(process.env.CHROMIUM_PATH);

  const playwrightRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "ms-playwright")
    : null;
  if (playwrightRoot && fs.existsSync(playwrightRoot)) {
    const entries = fs.readdirSync(playwrightRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith("chromium_headless_shell-"))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));

    for (const entry of entries) {
      candidates.push(path.join(
        playwrightRoot,
        entry.name,
        "chrome-headless-shell-win64",
        "chrome-headless-shell.exe"
      ));
    }
  }

  candidates.push(
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome"
  );

  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";

      const filePath = path.resolve(projectRoot, `.${pathname}`);
      if (!filePath.startsWith(projectRoot)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }

      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise(resolve => {
    const finish = exited => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);

    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopProcess(child) {
  if (await waitForProcessExit(child, 5000)) return;
  child.kill();
  await waitForProcessExit(child, 5000);
}

async function waitForJson(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser has not opened the debugging port yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`DevTools endpoint timeout: ${url}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });

    this.socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }

      const callbacks = this.listeners.get(message.method);
      if (!callbacks) return;
      callbacks.forEach(callback => callback(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) || new Set();
    callbacks.add(callback);
    this.listeners.set(method, callbacks);
    return () => callbacks.delete(callback);
  }

  waitFor(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const remove = this.on(method, params => {
        clearTimeout(timer);
        remove();
        resolve(params);
      });
      const timer = setTimeout(() => {
        remove();
        reject(new Error(`CDP event timeout: ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "브라우저 평가 오류");
  }
  return result.result.value;
}

async function waitForCondition(client, expression, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await evaluate(client, expression)) return;
    } catch {
      // Navigation can temporarily destroy the execution context.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`브라우저 조건 대기 실패: ${expression}`);
}

async function navigate(client, url) {
  const loaded = client.waitFor("Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await loaded;
}

async function readBrowserStore(client, storeName) {
  return evaluate(client, `new Promise((resolve, reject) => {
    const openRequest = indexedDB.open("mkat98-training-v2");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(${JSON.stringify(storeName)}, "readonly");
      const request = transaction.objectStore(${JSON.stringify(storeName)}).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        database.close();
        resolve(result);
      };
    };
  })`);
}

async function waitForBrowserStore(
  client,
  storeName,
  predicate,
  timeoutMs = 5000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const records = await readBrowserStore(client, storeName);
    if (predicate(records)) return records;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`${storeName} 저장소가 기대 상태가 되지 않았습니다.`);
}

async function run() {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error("Chromium 기반 브라우저를 찾을 수 없습니다. CHROMIUM_PATH를 지정하세요.");
  }

  const server = await startStaticServer();
  const serverPort = server.address().port;
  const debugPort = await reservePort();
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "personal-tap-smoke-"));
  const browser = spawn(browserPath, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    "about:blank"
  ], {
    stdio: "ignore",
    windowsHide: true
  });

  let client;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find(item => item.type === "page");
    assert.ok(target?.webSocketDebuggerUrl, "브라우저 페이지 target을 찾을 수 없습니다.");

    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Network.enable"),
      client.send("Log.enable")
    ]);

    const browserErrors = [];
    client.on("Runtime.exceptionThrown", event => {
      browserErrors.push(event.exceptionDetails?.exception?.description || "Runtime exception");
    });
    client.on("Log.entryAdded", event => {
      if (event.entry?.level === "error") browserErrors.push(event.entry.text);
    });

    const baseUrl = `http://127.0.0.1:${serverPort}`;
    await navigate(client, `${baseUrl}/`);
    await waitForCondition(
      client,
      "document.querySelectorAll('.app-card').length === 5"
    );
    assert.equal(await evaluate(client, "document.title"), "Personal Tap");
    await evaluate(client, `new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("mkat98-training-v2");
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
    })`);
    const legacyDate = await evaluate(client, `(() => {
      localStorage.clear();
      const date = new Date();
      date.setDate(date.getDate() - 1);
      const key = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
      localStorage.setItem("mkat98-stats-v1", JSON.stringify({
        attempts: 4,
        correct: 3,
        solvedByDate: { [key]: 4 },
        questions: {},
        streak: 37,
        lastActiveDate: key
      }));
      return key;
    })()`);

    await navigate(client, `${baseUrl}/apps/mensa/`);
    await waitForCondition(
      client,
      "!document.querySelector('#app').hidden && document.querySelectorAll('.type-card').length === 25"
    );

    const resourceNames = await evaluate(
      client,
      "performance.getEntriesByType('resource').map(entry => entry.name)"
    );
    assert.ok(resourceNames.some(name => name.endsWith("/data/question-bank.json")));
    assert.ok(!resourceNames.some(name => name.endsWith("/question-bank.js")));

    const migratedSummary = await evaluate(
      client,
      "JSON.parse(localStorage.getItem('mkat98-summary-v2'))"
    );
    assert.equal(migratedSummary.schemaVersion, 2);
    assert.equal(migratedSummary.legacy.legacyStreak, 37);
    assert.deepEqual(migratedSummary.legacy.practiceDays, [legacyDate]);
    assert.equal(migratedSummary.completionStreak, 0);
    assert.equal(migratedSummary.today.goalProgress, 0);
    assert.equal(
      await evaluate(
        client,
        "JSON.parse(localStorage.getItem('mkat98-stats-v1')).attempts"
      ),
      4
    );
    assert.equal(
      await evaluate(client, "!document.querySelector('#migrationNotice').hidden"),
      true
    );
    assert.equal(
      await evaluate(client, "Boolean(document.querySelector('#exportStatsBtn'))"),
      true
    );
    const metaRecords = await readBrowserStore(client, "meta");
    assert.ok(metaRecords.some(record => record.key === "migrationState"));
    assert.ok(metaRecords.some(record => record.key === "legacyBackup"));
    assert.ok(metaRecords.some(record => record.key === "settings"));
    await evaluate(
      client,
      "document.querySelector('#dismissMigrationNoticeBtn').click(); true"
    );
    await waitForCondition(
      client,
      "document.querySelector('#migrationNotice').hidden"
    );

    await evaluate(client, "document.querySelector('[data-mode=\"daily\"]').click(); true");
    await waitForCondition(client, "!document.querySelector('#quizView').classList.contains('hidden')");
    assert.equal(await evaluate(client, "document.querySelector('#progressText').textContent"), "1 / 10");
    assert.ok(await evaluate(client, "document.querySelectorAll('.option-button').length >= 6"));

    const initialPresentation = await evaluate(client, `(async () => {
      const questionId = document.querySelector("#options").dataset.questionId;
      const bank = await fetch("./data/question-bank.json").then(response => response.json());
      const question = bank.questions.find(item => item.id === questionId);
      return {
        questionId,
        originalOptionIds: question.options.map(option => option.id),
        presentedOptionIds: [...document.querySelectorAll(".option-button")]
          .map(button => button.dataset.optionId)
      };
    })()`);
    assert.notDeepEqual(
      initialPresentation.presentedOptionIds,
      initialPresentation.originalOptionIds
    );

    const activeBeforeReload = await waitForBrowserStore(
      client,
      "sessions",
      records => records.some(record =>
        record.status === "active" &&
        record.schemaVersion === 2 &&
        record.timer?.state === "running"
      )
    );
    const savedBeforeReload = activeBeforeReload.find(
      record => record.status === "active"
    );
    assert.deepEqual(
      savedBeforeReload.items[0].presentedOptionIds,
      initialPresentation.presentedOptionIds
    );
    assert.equal(savedBeforeReload.items[0].shuffleVersion, 1);
    assert.equal(typeof savedBeforeReload.items[0].optionSeed, "number");

    await navigate(client, `${baseUrl}/apps/mensa/?restore-smoke=1`);
    await waitForCondition(
      client,
      "!document.querySelector('#resumeNotice').hidden"
    );
    const pausedAfterReload = (await waitForBrowserStore(
      client,
      "sessions",
      records => records.some(record =>
        record.sessionId === savedBeforeReload.sessionId &&
        record.timer?.state === "paused"
      )
    )).find(record => record.sessionId === savedBeforeReload.sessionId);
    assert.ok(
      pausedAfterReload.timer.elapsedMs >= savedBeforeReload.timer.elapsedMs
    );

    await evaluate(
      client,
      "document.querySelector('#resumeSessionBtn').click(); true"
    );
    await waitForCondition(
      client,
      "!document.querySelector('#quizView').classList.contains('hidden')"
    );
    const restoredPresentation = await evaluate(client, `({
      questionId: document.querySelector("#options").dataset.questionId,
      presentedOptionIds: [...document.querySelectorAll(".option-button")]
        .map(button => button.dataset.optionId)
    })`);
    assert.equal(
      restoredPresentation.questionId,
      initialPresentation.questionId
    );
    assert.deepEqual(
      restoredPresentation.presentedOptionIds,
      initialPresentation.presentedOptionIds
    );

    const wrongSelection = await evaluate(client, `(async () => {
      const questionId = document.querySelector("#options").dataset.questionId;
      const bank = await fetch("./data/question-bank.json").then(response => response.json());
      const question = bank.questions.find(item => item.id === questionId);
      const wrongOption = question.options.find(
        option => option.id !== question.correctOptionId
      );
      document.querySelector(
        \`.option-button[data-option-id="\${wrongOption.id}"]\`
      ).click();
      return {
        questionId,
        correctOptionId: question.correctOptionId,
        selectedOptionId: wrongOption.id,
        bankVersion: bank.bankVersion
      };
    })()`);
    await waitForCondition(client, "!document.querySelector('#feedback').classList.contains('hidden')");

    const attempts = await readBrowserStore(client, "attempts");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].questionId, wrongSelection.questionId);
    assert.equal(attempts[0].selectedOptionId, wrongSelection.selectedOptionId);
    assert.notEqual(attempts[0].selectedOptionId, wrongSelection.correctOptionId);
    assert.equal(attempts[0].bankVersion, wrongSelection.bankVersion);
    assert.equal(attempts[0].contentVersion, 1);
    assert.equal(attempts[0].correct, false);
    assert.equal(attempts[0].firstPass, true);
    assert.equal(attempts[0].retry, false);
    assert.equal(attempts[0].eligibleForDailyGoal, true);
    assert.equal(attempts[0].eligibleForAbilityStats, true);
    assert.deepEqual(
      attempts[0].presentedOptionIds,
      initialPresentation.presentedOptionIds
    );
    assert.equal(attempts[0].shuffleVersion, 1);
    assert.equal(typeof attempts[0].optionSeed, "number");
    assert.equal(attempts[0].elapsedMs >= 0, true);

    await navigate(client, `${baseUrl}/apps/mensa/?feedback-restore=1`);
    await waitForCondition(
      client,
      "!document.querySelector('#resumeNotice').hidden"
    );
    await evaluate(
      client,
      "document.querySelector('#resumeSessionBtn').click(); true"
    );
    await waitForCondition(
      client,
      "!document.querySelector('#feedback').classList.contains('hidden')"
    );
    assert.equal(
      await evaluate(
        client,
        "document.querySelector('.option-button.selected')?.dataset.optionId"
      ),
      wrongSelection.selectedOptionId
    );
    assert.equal((await readBrowserStore(client, "attempts")).length, 1);

    const currentSummary = await evaluate(
      client,
      "JSON.parse(localStorage.getItem('mkat98-summary-v2'))"
    );
    assert.equal(currentSummary.attempts, 5);
    assert.equal(currentSummary.v2.attempts, 1);
    assert.equal(currentSummary.today.goalProgress, 1);
    assert.equal(currentSummary.completionStreak, 0);
    assert.equal(currentSummary.migration.noticePending, false);
    assert.equal((await readBrowserStore(client, "sessions")).length, 1);

    await evaluate(client, "document.querySelector('#quitBtn').click(); true");
    await waitForCondition(client, "!document.querySelector('#homeView').classList.contains('hidden')");

    await navigate(client, `${baseUrl}/`);
    await waitForCondition(
      client,
      "document.querySelectorAll('.app-card').length === 5"
    );
    const mkatMetric = await evaluate(client, `(() => {
      const card = [...document.querySelectorAll(".app-card")]
        .find(item => item.textContent.includes("MKAT 98"));
      return card?.querySelector(".app-metric")?.textContent || "";
    })()`);
    assert.match(mkatMetric, /오늘 1\/10/);
    assert.match(mkatMetric, /목표 0일 연속/);

    await navigate(client, `${baseUrl}/apps/mensa/`);
    await waitForCondition(client, "document.querySelectorAll('.type-card').length === 25");
    await evaluate(client, "document.querySelector('[data-mode=\"mixed25\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 25'");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");

    await evaluate(client, "document.querySelector('[data-mode=\"speed\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 15'");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");

    await evaluate(client, "document.querySelector('.type-card').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 5'");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");

    await navigate(client, `${baseUrl}/apps/mensa/`);
    await waitForCondition(client, "document.querySelectorAll('.type-card').length === 25");
    await evaluate(client, "document.querySelector('[data-mode=\"wrong\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 1'");

    await waitForCondition(
      client,
      "navigator.serviceWorker.controller !== null",
      15000
    );
    await client.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none"
    });
    await navigate(client, `${baseUrl}/apps/mensa/?offline-smoke=1`);
    await waitForCondition(
      client,
      "!document.querySelector('#app').hidden && document.querySelectorAll('.type-card').length === 25",
      15000
    );
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "wifi"
    });

    assert.deepEqual(browserErrors, []);
    console.log(
      "브라우저 스모크 성공: 허브 5카드, 유형 25개, " +
      "일일·혼합·속도·유형·오답 모드, v1 안전 이전, " +
      "IndexedDB 응시 이벤트, v2 요약 캐시, 오프라인 로드"
    );
  } finally {
    try {
      if (client) await client.send("Browser.close");
    } catch {
      browser.kill();
    }
    client?.close();
    await new Promise(resolve => server.close(resolve));
    await stopProcess(browser);

    const resolvedTemp = path.resolve(profilePath);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    if (!resolvedTemp.startsWith(resolvedOsTemp)) {
      throw new Error("브라우저 임시 프로필이 OS 임시 폴더 밖에 있습니다.");
    }
    fs.rmSync(resolvedTemp, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
