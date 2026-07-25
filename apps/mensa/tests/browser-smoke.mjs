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
    await evaluate(client, "localStorage.clear(); true");

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

    await evaluate(client, "document.querySelector('[data-mode=\"daily\"]').click(); true");
    await waitForCondition(client, "!document.querySelector('#quizView').classList.contains('hidden')");
    assert.equal(await evaluate(client, "document.querySelector('#progressText').textContent"), "1 / 10");
    assert.ok(await evaluate(client, "document.querySelectorAll('.option-button').length >= 6"));

    await evaluate(client, "document.querySelector('.option-button').click(); true");
    await waitForCondition(client, "!document.querySelector('#feedback').classList.contains('hidden')");
    assert.equal(
      await evaluate(client, "JSON.parse(localStorage.getItem('mkat98-stats-v1')).attempts"),
      1
    );
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");
    await waitForCondition(client, "!document.querySelector('#homeView').classList.contains('hidden')");

    await evaluate(client, "document.querySelector('[data-mode=\"mixed25\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 25'");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");

    await evaluate(client, "document.querySelector('[data-mode=\"speed\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 15'");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");

    await evaluate(client, "document.querySelector('.type-card').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 5'");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");

    await evaluate(client, `(() => {
      const stats = JSON.parse(localStorage.getItem("mkat98-stats-v1"));
      stats.attempts += 1;
      stats.questions["T01-01"] = {
        attempts: 1,
        correct: 0,
        wrong: 1,
        overtime: 0,
        lastAnswered: Date.now()
      };
      localStorage.setItem("mkat98-stats-v1", JSON.stringify(stats));
      return true;
    })()`);
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
      "일일·혼합·속도·유형·오답 모드, v1 통계, 오프라인 로드"
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
