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
const runtimeBank = JSON.parse(fs.readFileSync(
  path.join(projectRoot, "apps", "mensa", "data", "question-bank.json"),
  "utf8"
));
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function delayedMnqFixture() {
  const start = Date.parse("2026-08-13T22:00:00.000Z") / 1000;
  const end = Date.parse("2026-08-14T06:20:00.000Z") / 1000;
  const timestamp = [];
  for (let value = start; value <= end; value += 300) timestamp.push(value);
  const open = timestamp.map((_, index) => 30000 + (index % 16) * 0.25);
  const close = open.map((value, index) => value + (index % 2 === 0 ? 0.25 : -0.25));
  const high = open.map((value, index) => Math.max(value, close[index]) + 1);
  const low = open.map((value, index) => Math.min(value, close[index]) - 1);
  const marketHigh = Math.max(...high);
  const marketLow = Math.min(...low);
  const marketCurrent = close.at(-1);
  const missingIndex = 72;
  for (const values of [open, high, low, close]) values[missingIndex] = null;
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol: "MNQ=F",
          dataGranularity: "5m",
          instrumentType: "FUTURE",
          exchangeName: "CME",
          exchangeTimezoneName: "America/New_York",
          currency: "USD",
          regularMarketDayHigh: marketHigh,
          regularMarketDayLow: marketLow,
          regularMarketPrice: marketCurrent,
          regularMarketTime: timestamp.at(-1)
        },
        timestamp,
        indicators: { quote: [{
          open,
          high,
          low,
          close
        }] }
      }]
    }
  };
}

function delayedMnqSourceUrl(fetchedAt = new Date("2026-08-14T06:30:00.000Z")) {
  const period2 = Math.floor(fetchedAt.getTime() / 60000) * 60;
  const url = new URL("https://query2.finance.yahoo.com/v8/finance/chart/MNQ=F");
  url.searchParams.set("interval", "5m");
  url.searchParams.set("period1", String(period2 - 2 * 24 * 60 * 60));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("includePrePost", "true");
  url.searchParams.set("events", "div,splits");
  return url.href;
}

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
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), 1000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return response.json();
    } catch {
      // Browser has not opened the debugging port yet.
    } finally {
      clearTimeout(requestTimeout);
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
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }

      const callbacks = this.listeners.get(message.method);
      if (!callbacks) return;
      callbacks.forEach(callback => callback(message.params));
    });
    this.socket.addEventListener("close", () => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP 연결 종료: command ${id}`));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
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

async function captureOptionalScreenshot(client, name) {
  const outputDirectory = process.env.SMOKE_SCREENSHOT_DIR;
  if (!outputDirectory) return;

  fs.mkdirSync(outputDirectory, { recursive: true });
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  fs.writeFileSync(
    path.join(outputDirectory, `${name}.png`),
    Buffer.from(screenshot.data, "base64")
  );
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
    "--disable-dev-shm-usage",
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
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 1250,
      deviceScaleFactor: 1,
      mobile: false
    });
    await navigate(client, `${baseUrl}/`);
    await waitForCondition(
      client,
      "document.querySelectorAll('.app-card').length === 6"
    );
    assert.equal(await evaluate(client, "document.title"), "Personal Tap");
    assert.equal(
      await evaluate(
        client,
        "getComputedStyle(document.querySelector('.app-grid')).gridTemplateColumns.split(' ').filter(Boolean).length"
      ),
      3
    );
    const desktopHubLayout = await evaluate(client, `(() => {
      const grid = document.querySelector(".app-grid");
      const welcome = document.querySelector(".welcome-panel");
      const cards = [...document.querySelectorAll(".app-card")];
      const rowTops = [...new Set(cards.map(card => Math.round(card.getBoundingClientRect().top)))];
      return {
        gridBeforeWelcome: grid.getBoundingClientRect().top < welcome.getBoundingClientRect().top,
        rows: rowTops.length,
        firstRowSize: cards.filter(card => Math.abs(card.getBoundingClientRect().top - cards[0].getBoundingClientRect().top) < 2).length
      };
    })()`);
    assert.deepEqual(desktopHubLayout, {
      gridBeforeWelcome: true,
      rows: 2,
      firstRowSize: 3
    });
    const hubAccessibility = await evaluate(client, `(() => {
      const enabled = [...document.querySelectorAll(".app-card.enabled")];
      const disabled = [...document.querySelectorAll(".app-card.disabled")];
      const first = enabled[0];
      first.focus();
      const descriptionsResolve = [...document.querySelectorAll(".app-card")].every(card =>
        (card.getAttribute("aria-describedby") || "").split(/\\s+/).every(id => document.getElementById(id))
      );
      return {
        enabledAreLinks: enabled.every(card => card.tagName === "A" && card.href),
        disabledAreInert: disabled.every(card => card.tagName === "ARTICLE" && card.getAttribute("aria-disabled") === "true"),
        keyboardFocus: document.activeElement === first,
        actionHeight: first.querySelector(".app-action").getBoundingClientRect().height,
        descriptionsResolve,
        touchAction: getComputedStyle(first).touchAction,
        headingOrder: [...document.querySelectorAll("main h1, main h2")].map(heading => heading.tagName)
      };
    })()`);
    assert.equal(hubAccessibility.enabledAreLinks, true);
    assert.equal(hubAccessibility.disabledAreInert, true);
    assert.equal(hubAccessibility.keyboardFocus, true);
    assert.equal(hubAccessibility.descriptionsResolve, true);
    assert.equal(hubAccessibility.actionHeight >= 44, true);
    assert.equal(hubAccessibility.touchAction, "manipulation");
    assert.deepEqual(hubAccessibility.headingOrder, ["H1", "H2"]);
    const volatilityCard = await evaluate(client, `(() => {
      const card = [...document.querySelectorAll(".app-card")]
        .find(item => item.textContent.includes("Volatility"));
      return { href: card?.getAttribute("href"), text: card?.textContent || "" };
    })()`);
    assert.equal(volatilityCard.href, "./apps/volatility/");
    assert.match(volatilityCard.text, /실전선.*상승 0\.360%.*하락 0\.295%/s);
    const universityAdmissionCard = await evaluate(client, `(() => {
      const card = document.querySelector('[data-app-id="university-admission"]');
      const describedBy = (card?.getAttribute("aria-describedby") || "")
        .split(/\\s+/).filter(Boolean);
      return {
        tag: card?.tagName,
        href: card?.href,
        target: card?.target,
        rel: card?.rel,
        labelResolves: Boolean(document.getElementById(card?.getAttribute("aria-labelledby"))),
        descriptionsResolve: describedBy.length > 0 && describedBy.every(id => document.getElementById(id)),
        text: card?.textContent || ""
      };
    })()`);
    assert.deepEqual(universityAdmissionCard, {
      tag: "A",
      href: "https://university-admission-private-preview-yuni14.vercel.app/",
      target: "_blank",
      rel: "noopener noreferrer",
      labelResolves: true,
      descriptionsResolve: true,
      text: universityAdmissionCard.text
    });
    assert.match(universityAdmissionCard.text, /대학 입학정보/);
    assert.match(universityAdmissionCard.text, /새 창에서 열기/);
    await evaluate(client, "document.activeElement?.blur(); true");
    await captureOptionalScreenshot(client, "hub-desktop");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 760,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });
    assert.equal(
      await evaluate(
        client,
        "getComputedStyle(document.querySelector('.app-grid')).gridTemplateColumns.split(' ').filter(Boolean).length"
      ),
      3
    );
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 700,
      deviceScaleFactor: 1,
      mobile: true
    });
    await navigate(client, `${baseUrl}/?hub-mobile-smoke=1`);
    await waitForCondition(
      client,
      "document.querySelectorAll('.app-card').length === 6"
    );
    const mobileHubLayout = await evaluate(client, `(() => {
      const cardRects = [...document.querySelectorAll(".app-card")].map(card => {
        const rect = card.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      });
      const rowTops = [...new Set(cardRects.map(card => card.top))];
      return {
        columns: getComputedStyle(document.querySelector(".app-grid"))
          .gridTemplateColumns.split(" ").filter(Boolean).length,
        fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
        cardWidth: document.querySelector(".app-card").getBoundingClientRect().width,
        gridBeforeWelcome: document.querySelector(".app-grid").getBoundingClientRect().top <
          document.querySelector(".welcome-panel").getBoundingClientRect().top,
        rows: rowTops.length,
        cardsPerRow: rowTops.map(top => cardRects.filter(card => Math.abs(card.top - top) < 2).length),
        allCardsAboveFold: Math.max(...cardRects.map(card => card.bottom)) <= window.innerHeight,
        cardRects
      };
    })()`);
    assert.equal(mobileHubLayout.columns, 3);
    assert.equal(mobileHubLayout.fitsViewport, true);
    assert.equal(mobileHubLayout.cardWidth >= 110, true);
    assert.equal(mobileHubLayout.gridBeforeWelcome, true);
    assert.equal(mobileHubLayout.rows, 2);
    assert.deepEqual(mobileHubLayout.cardsPerRow, [3, 3]);
    assert.equal(mobileHubLayout.allCardsAboveFold, true);
    assert.equal(
      mobileHubLayout.cardRects.every(rect =>
        rect.height >= 168 && rect.width >= 110 && rect.left >= 0 && rect.right <= 390
      ),
      true,
      JSON.stringify(mobileHubLayout.cardRects)
    );
    await captureOptionalScreenshot(client, "hub-mobile");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 700,
      deviceScaleFactor: 1,
      mobile: true
    });
    const narrowHubLayout = await evaluate(client, `(() => ({
      columns: getComputedStyle(document.querySelector(".app-grid"))
        .gridTemplateColumns.split(" ").filter(Boolean).length,
      fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
      cardsPerRow: [...document.querySelectorAll(".app-card")]
        .filter((card, _, cards) => Math.abs(
          card.getBoundingClientRect().top - cards[0].getBoundingClientRect().top
        ) < 2).length
    }))()`);
    assert.deepEqual(narrowHubLayout, {
      columns: 3,
      fitsViewport: true,
      cardsPerRow: 3
    });
    await client.send("Emulation.clearDeviceMetricsOverride");
    const fixedTimeScript = await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const NativeDate = Date;
        const fixedNow = Date.parse("2026-08-14T06:30:00.000Z");
        class FixedDate extends NativeDate {
          constructor(...args) { super(...(args.length ? args : [fixedNow])); }
          static now() { return fixedNow; }
        }
        globalThis.Date = FixedDate;
      })();`
    });
    let readerRequestCount = 0;
    const removeYahooFixture = client.on("Fetch.requestPaused", params => {
      readerRequestCount += 1;
      const targetUrl = delayedMnqSourceUrl();
      if (params.request.url !== `https://r.jina.ai/${targetUrl}`) {
        browserErrors.push(`Unexpected Jina Reader URL: ${params.request.url}`);
      }
      const fixtureBody = Buffer.from(JSON.stringify({
        code: 200,
        status: 200,
        data: {
          title: "",
          description: "",
          url: targetUrl,
          content: JSON.stringify(delayedMnqFixture())
        }
      })).toString("base64");
      client.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "application/json; charset=utf-8" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Cache-Control", value: "no-store" }
        ],
        body: fixtureBody
      }).catch(error => browserErrors.push(`Jina Reader fixture: ${error.message}`));
    });
    await client.send("Fetch.enable", {
      patterns: [{ urlPattern: "https://r.jina.ai/*", requestStage: "Request" }]
    });
    const errorsBeforeVolatility = browserErrors.length;
    await navigate(client, `${baseUrl}/apps/volatility/`);
    await waitForCondition(client, "document.body.dataset.ready === 'true'");
    await client.send("Fetch.disable");
    removeYahooFixture();
    assert.equal(await evaluate(client, "document.title"), "Volatility | Personal Tap");
    assert.equal(await evaluate(client, "document.querySelector('#currentPrice').textContent !== '—'"), true);
    const delayedQuoteGate = await evaluate(client, `({
      locked: !document.querySelector("#calculationLock").hidden,
      calculationsHidden: document.querySelector("#automaticCalculations").hidden,
      status: document.querySelector("#dataStatus").textContent,
      notice: document.querySelector("#dataNotice").textContent,
      upLine: document.querySelector("#operationalUpLine").textContent,
      refreshText: document.querySelector("#refreshBtn").textContent.trim(),
      refreshInTopbar: document.querySelector(".topbar-actions")
        .contains(document.querySelector("#refreshBtn")),
      liveLabels: [
        document.querySelector("#bullLiveLabel").textContent,
        document.querySelector("#bearLiveLabel").textContent
      ],
      conditionalLabels: [
        document.querySelector("#bullConditionalLabel").textContent,
        document.querySelector("#bearConditionalLabel").textContent
      ],
      atr: document.querySelector("#atrValue").textContent,
      autoAtrDisabled: document.querySelector("#useAutoAtrBtn").disabled,
      reachDisclaimer: document.querySelector(".scenario-warning").textContent
    })`);
    assert.equal(readerRequestCount, 1);
    assert.equal(delayedQuoteGate.locked, false);
    assert.equal(delayedQuoteGate.calculationsHidden, false);
    assert.equal(delayedQuoteGate.status, "시세 사용 가능");
    assert.match(delayedQuoteGate.upLine, /pt/);
    assert.equal(delayedQuoteGate.refreshText, "오늘 시세 새로고침");
    assert.equal(delayedQuoteGate.refreshInTopbar, true);
    assert.deepEqual(delayedQuoteGate.liveLabels, [
      "장중 기본 상승선 · OOS 72.7%",
      "장중 기본 하락선 · OOS 73.5%"
    ]);
    assert.deepEqual(delayedQuoteGate.conditionalLabels, [
      "양봉 마감 조건부 복기선 · OOS 79.6%",
      "음봉 마감 조건부 복기선 · OOS 79.3%"
    ]);
    assert.equal(delayedQuoteGate.atr, "—");
    assert.equal(delayedQuoteGate.autoAtrDisabled, true);
    assert.match(delayedQuoteGate.notice, /5분봉 1개 결손/);
    assert.match(delayedQuoteGate.notice, /시가는 첫 세션봉 기준/);
    assert.match(delayedQuoteGate.reachDisclaimer, /가격선 도달률이지 매매 성공률이 아닙니다/);
    const webLockGate = await evaluate(client, `(async () => {
      const guard = await import("./js/request-guard.js");
      let releaseFirst;
      let operationCount = 0;
      const first = guard.withExclusiveRequest(async () => {
        operationCount += 1;
        return new Promise(resolve => { releaseFirst = resolve; });
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      const second = await guard.withExclusiveRequest(async () => { operationCount += 1; });
      releaseFirst("done");
      const firstResult = await first;
      return {
        firstAcquired: firstResult.acquired,
        secondAcquired: second.acquired,
        operationCount
      };
    })()`);
    assert.deepEqual(webLockGate, {
      firstAcquired: true,
      secondAcquired: false,
      operationCount: 1
    });
    const volatilityNetworkErrors = browserErrors.splice(errorsBeforeVolatility);
    assert.deepEqual(volatilityNetworkErrors, []);
    await evaluate(client, `(() => {
      const future = Date.now() + 10_000;
      localStorage.setItem("personal-tap-volatility-last-request-v1", JSON.stringify(future));
      document.querySelector("#refreshBtn").click();
      return true;
    })()`);
    await waitForCondition(client, `
      JSON.parse(localStorage.getItem("personal-tap-volatility-last-request-v1")) === Date.now() &&
      /60초|중복 요청/.test(document.querySelector("#dataNotice").textContent)
    `);
    const rollbackGuard = await evaluate(client, `(() => ({
        stored: JSON.parse(localStorage.getItem("personal-tap-volatility-last-request-v1")),
        now: Date.now(),
        notice: document.querySelector("#dataNotice").textContent
    }))()`);
    assert.equal(rollbackGuard.stored, rollbackGuard.now);
    assert.match(rollbackGuard.notice, /60초|중복 요청/);
    assert.equal(readerRequestCount, 1);
    const manualApplied = await evaluate(client, `(() => {
      document.querySelector("#manualToggleBtn").click();
      const values = { manualOpen: 30000, manualHigh: 30100, manualLow: 29900, manualCurrent: 30050, manualAtr: 40.34778 };
      for (const [id, value] of Object.entries(values)) document.querySelector("#" + id).value = value;
      document.querySelector("#manualConfirm").checked = true;
      document.querySelector("#manualPanel").requestSubmit();
      document.querySelector("#manualToggleBtn").click();
      return {
        status: document.querySelector("#dataStatus").textContent,
        current: document.querySelector("#currentPrice").textContent
      };
    })()`);
    assert.match(manualApplied.status, /수동 입력/);
    assert.equal(manualApplied.current, "30,050.00");
    const safeLines = await evaluate(client, `({
      up: document.querySelector("#operationalUpLine").textContent,
      down: document.querySelector("#operationalDownLine").textContent,
      bullConditional: document.querySelector("#bullSafeLine").textContent,
      bearConditional: document.querySelector("#bearSafeLine").textContent
    })`);
    assert.equal(safeLines.up, "30,000.00 + 107.75 pt = 30,107.75");
    assert.equal(safeLines.down, "30,000.00 − 88.50 pt = 29,911.50");
    assert.equal(safeLines.bullConditional, "30,000.00 + 212.25 = 30,212.25");
    assert.equal(safeLines.bearConditional, "30,000.00 − 244.50 = 29,755.50");
    await evaluate(client, "document.querySelector('#scenarioTitle').scrollIntoView(); true");
    await captureOptionalScreenshot(client, "volatility-safe-lines-desktop");
    const volatilityResult = await evaluate(client, `(() => {
      const current = Number(document.querySelector("#currentPrice").textContent.replaceAll(",", ""));
      const set = (selector, value) => {
        const element = document.querySelector(selector);
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("#positionDirection", "long");
      set("#entryPrice", current - 100);
      set("#quantity", 2);
      set("#enteredAt", new Date(Date.now() - 11 * 60000).toISOString().slice(0, 16));
      set("#positionAtr", 20);
      set("#ema1h", "bearish");
      set("#rsi1h", 44);
      set("#atrPercentile", 80);
      const favorable = document.querySelector("#noFavorableExcursion");
      favorable.checked = true;
      favorable.dispatchEvent(new Event("input", { bubbles: true }));
      const hesitation = document.querySelector("#stopHesitation");
      hesitation.checked = true;
      hesitation.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        positionVisible: !document.querySelector("#positionResults").hidden,
        p6: document.querySelector("#p6Result strong").textContent,
        kill: document.querySelector("#killResult strong").textContent,
        p7: document.querySelector("#p7Result strong").textContent
      };
    })()`);
    assert.equal(volatilityResult.positionVisible, true);
    assert.match(volatilityResult.p6, /P6 shadow 경고 후보/);
    assert.match(volatilityResult.kill, /기존 OR 규칙 감지 · 비활성/);
    assert.match(volatilityResult.p7, /P7 입력 기반 안전 알림 · 미검증/);
    const fixedAtrBefore = await evaluate(client, `(() => ({
      atr: document.querySelector("#positionAtr").value,
      stop: document.querySelector("#positionSummary article:nth-child(2) strong").textContent
    }))()`);
    const fixedAtrAfter = await evaluate(client, `(() => {
      const values = {
        manualOpen: 30000,
        manualHigh: 30125,
        manualLow: 29875,
        manualCurrent: 30075,
        manualAtr: 80.12345
      };
      for (const [id, value] of Object.entries(values)) document.querySelector("#" + id).value = value;
      document.querySelector("#manualConfirm").checked = true;
      document.querySelector("#manualPanel").requestSubmit();
      return {
        atr: document.querySelector("#positionAtr").value,
        stop: document.querySelector("#positionSummary article:nth-child(2) strong").textContent
      };
    })()`);
    assert.deepEqual(fixedAtrBefore, fixedAtrAfter);
    assert.equal(fixedAtrAfter.atr, "20");
    await captureOptionalScreenshot(client, "volatility-desktop");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    assert.equal(
      await evaluate(client, "document.documentElement.scrollWidth <= window.innerWidth"),
      true
    );
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 720,
      deviceScaleFactor: 1,
      mobile: true
    });
    const volatilityTopbar320 = await evaluate(client, `(() => {
      const button = document.querySelector("#refreshBtn");
      const rect = button.getBoundingClientRect();
      return {
        text: button.textContent.trim(),
        visible: rect.width > 0 && rect.height >= 40,
        inViewport: rect.left >= 0 && rect.right <= window.innerWidth,
        fitsViewport: document.documentElement.scrollWidth <= window.innerWidth
      };
    })()`);
    assert.deepEqual(volatilityTopbar320, {
      text: "오늘 시세 새로고침",
      visible: true,
      inViewport: true,
      fitsViewport: true
    });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await captureOptionalScreenshot(client, "volatility-mobile");
    await evaluate(client, "document.querySelector('#positionTitle').scrollIntoView(); true");
    await captureOptionalScreenshot(client, "volatility-position-mobile");
    await evaluate(client, "document.querySelector('#riskTitle').scrollIntoView(); true");
    await captureOptionalScreenshot(client, "volatility-risk-mobile");
    await client.send("Emulation.clearDeviceMetricsOverride");
    const errorsBeforeLockedFallback = browserErrors.length;
    let rateLimitRequestCount = 0;
    const removeYahooFailure = client.on("Fetch.requestPaused", params => {
      rateLimitRequestCount += 1;
      client.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 429,
        responseHeaders: [
          { name: "Content-Type", value: "application/json; charset=utf-8" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Access-Control-Expose-Headers", value: "Retry-After" },
          { name: "Cache-Control", value: "no-store" },
          { name: "Retry-After", value: "120" }
        ],
        body: Buffer.from("{}").toString("base64")
      }).catch(error => browserErrors.push(`Jina Reader failure fixture: ${error.message}`));
    });
    await client.send("Fetch.enable", {
      patterns: [{ urlPattern: "https://r.jina.ai/*", requestStage: "Request" }]
    });
    await evaluate(client, `localStorage.setItem(
      "personal-tap-volatility-last-request-v1",
      JSON.stringify(Date.now() - 60_001)
    ); true`);
    await navigate(client, `${baseUrl}/apps/volatility/?provider-failure-smoke=1`);
    await waitForCondition(client, "document.body.dataset.ready === 'true'");
    const lockedFallback = await evaluate(client, `(() => ({
      locked: !document.querySelector("#calculationLock").hidden,
      calculationsHidden: document.querySelector("#automaticCalculations").hidden,
      atr: document.querySelector("#atrValue").textContent,
      current: document.querySelector("#currentPrice").textContent,
      manualValues: ["manualOpen", "manualHigh", "manualLow", "manualCurrent", "manualAtr"]
        .map(id => document.querySelector("#" + id).value),
      manualConfirmed: document.querySelector("#manualConfirm").checked,
      notice: document.querySelector("#dataNotice").textContent,
      status: document.querySelector("#dataStatus").textContent,
      refreshText: document.querySelector("#refreshBtn").textContent.trim(),
      rateLimitUntil: JSON.parse(localStorage.getItem(
        "personal-tap-volatility-rate-limit-until-v1"
      ))
    }))()`);
    assert.equal(rateLimitRequestCount, 1);
    assert.equal(lockedFallback.locked, true);
    assert.equal(lockedFallback.calculationsHidden, true);
    assert.equal(lockedFallback.atr, "—");
    assert.equal(lockedFallback.current, "—");
    assert.deepEqual(lockedFallback.manualValues, ["", "", "", "", ""]);
    assert.equal(lockedFallback.manualConfirmed, false);
    assert.match(lockedFallback.notice, /현재 시세 숫자는 숨겼으며|계산에 사용하지 않습니다/);
    assert.equal(lockedFallback.status, "시세 만료");
    assert.equal(lockedFallback.refreshText, "오늘 시세 새로고침");
    assert.equal(lockedFallback.rateLimitUntil, Date.parse("2026-08-14T06:32:00.000Z"));
    assert.match(lockedFallback.notice, /120초/);
    await evaluate(client, `(() => {
      localStorage.setItem(
        "personal-tap-volatility-last-request-v1",
        JSON.stringify(Date.now() - 60_001)
      );
      document.querySelector("#refreshBtn").click();
      return true;
    })()`);
    await waitForCondition(client, `
      /120초/.test(document.querySelector("#dataNotice").textContent)
    `);
    assert.equal(rateLimitRequestCount, 1);
    await client.send("Fetch.disable");
    removeYahooFailure();
    const lockedFallbackErrors = browserErrors.splice(errorsBeforeLockedFallback);
    assert.equal(lockedFallbackErrors.every(message => /429/.test(message)), true);
    await client.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: fixedTimeScript.identifier
    });
    await navigate(client, `${baseUrl}/`);
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
      "!document.querySelector('#app').hidden && document.querySelectorAll('.type-card').length === 59"
    );
    console.log("[smoke] MKAT 초기화");
    assert.equal(
      await evaluate(
        client,
        "getComputedStyle(document.querySelector('#bootStatus')).display"
      ),
      "none"
    );
    await evaluate(client, "window.confirm = () => true; true");
    assert.equal(
      await evaluate(client, "document.querySelectorAll('.mode-card').length"),
      5
    );
    const bankInventory = await evaluate(client, `(async () => {
      const bank = await fetch("./data/question-bank.json")
        .then(response => response.json());
      const sourceCounts = bank.questions.reduce((counts, question) => {
        const sourceId = question.provenance?.sourceId || "missing";
        counts[sourceId] = (counts[sourceId] || 0) + 1;
        return counts;
      }, {});
      return {
        questionCount: bank.questions.length,
        typeIds: bank.types.map(type => type.id),
        sourceCounts,
        hasRetiredT19: bank.types.some(type => type.id === "T19") ||
          bank.questions.some(question => question.typeId === "T19"),
        hasRetiredT26: bank.types.some(type => type.id === "T26") ||
          bank.questions.some(question => question.typeId === "T26"),
        retiredTypeIds: bank.policy?.retiredTypeIds || []
      };
    })()`);
    assert.equal(bankInventory.questionCount, 990);
    assert.deepEqual(bankInventory.sourceCounts, {
      "foundation-v1": 120,
      "advanced-v1": 232,
      "mkat-original-300-v1": 288,
      "mkat-mensano-350-v1": 350
    });
    assert.equal(bankInventory.typeIds.length, 59);
    assert.equal(bankInventory.typeIds.includes("T26"), false);
    assert.equal(bankInventory.typeIds.includes("S35"), true);
    assert.equal(bankInventory.hasRetiredT19, false);
    assert.equal(bankInventory.hasRetiredT26, false);
    assert.deepEqual(bankInventory.retiredTypeIds, ["T19", "T26"]);
    assert.equal(
      await evaluate(
        client,
        "document.querySelector('[data-type-id=\"T26\"]')"
      ),
      null
    );
    assert.match(
      await evaluate(
        client,
        "document.querySelector('[data-type-id=\"S35\"]').textContent"
      ),
      /학습 10문제/
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
    await evaluate(
      client,
      "document.querySelector('#viewDetailedStatsBtn').click(); true"
    );
    await waitForCondition(
      client,
      "!document.querySelector('#statsView').classList.contains('hidden')"
    );
    assert.equal(
      await evaluate(
        client,
        "document.querySelectorAll('[data-analysis-table=\"types\"] tbody tr').length"
      ),
      59
    );
    assert.equal(
      await evaluate(
        client,
        "document.querySelectorAll('[data-analysis-table=\"domains\"] tbody tr').length"
      ),
      5
    );
    assert.equal(
      await evaluate(
        client,
        "document.querySelectorAll('[data-analysis-table=\"supplemental\"] tbody tr').length"
      ),
      1
    );
    assert.equal(
      await evaluate(client, "document.querySelectorAll('.difficulty-stat').length"),
      5
    );
    assert.equal(
      await evaluate(client, "document.querySelectorAll('.analysis-metric').length"),
      8
    );
    await evaluate(client, "document.querySelector('#statsBackBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );

    await evaluate(client, "document.querySelector('[data-mode=\"daily\"]').click(); true");
    await waitForCondition(client, "!document.querySelector('#quizView').classList.contains('hidden')");
    assert.equal(await evaluate(client, "document.querySelector('#progressText').textContent"), "1 / 10");
    assert.ok(await evaluate(client, "document.querySelectorAll('.option-button').length >= 6"));
    assert.equal(
      await evaluate(client, "document.querySelector('#questionMeta').classList.contains('hidden')"),
      true
    );
    assert.equal(
      await evaluate(client, "document.querySelector('#submitAnswerBtn').disabled"),
      true
    );
    assert.match(
      await evaluate(client, "document.querySelector('#options').className"),
      /layout-(?:grid|compact|list)/
    );
    await evaluate(client, "document.querySelector('#zoomStimulusBtn').click(); true");
    await waitForCondition(client, "document.querySelector('#zoomDialog').open");
    assert.ok(
      await evaluate(client, "document.querySelector('#zoomContent svg') !== null")
    );
    await evaluate(client, "document.querySelector('#closeZoomBtn').click(); true");
    await waitForCondition(client, "!document.querySelector('#zoomDialog').open");

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
    assert.ok(
      savedBeforeReload.items.every(item =>
        typeof item.selectionReason === "string"
      )
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
      "window.confirm = () => true; " +
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
        bankVersion: bank.bankVersion,
        contentVersion: question.contentVersion,
        gradingFingerprint: question.gradingFingerprint,
        typeId: question.typeId,
        domainId: question.domainId,
        scoreGroup: question.scoreGroup,
        difficulty: question.difficulty,
        errorTag: wrongOption.errorTag,
        feedback: wrongOption.feedback
      };
    })()`);
    assert.equal(
      await evaluate(client, "document.querySelector('#feedback').classList.contains('hidden')"),
      true
    );
    assert.equal((await readBrowserStore(client, "attempts")).length, 0);
    assert.equal(
      await evaluate(client, "document.querySelector('#submitAnswerBtn').disabled"),
      false
    );
    assert.equal(
      await evaluate(
        client,
        "document.querySelector('.option-button.candidate')?.dataset.optionId"
      ),
      wrongSelection.selectedOptionId
    );
    await evaluate(
      client,
      "document.querySelector('#submitAnswerBtn').click(); true"
    );
    await waitForCondition(client, "!document.querySelector('#feedback').classList.contains('hidden')");
    console.log("[smoke] 일일 선택 후 제출");

    const attempts = await readBrowserStore(client, "attempts");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].questionId, wrongSelection.questionId);
    assert.equal(attempts[0].selectedOptionId, wrongSelection.selectedOptionId);
    assert.notEqual(attempts[0].selectedOptionId, wrongSelection.correctOptionId);
    assert.equal(attempts[0].bankVersion, wrongSelection.bankVersion);
    assert.equal(attempts[0].contentVersion, wrongSelection.contentVersion);
    assert.equal(
      attempts[0].gradingFingerprint,
      wrongSelection.gradingFingerprint
    );
    assert.equal(attempts[0].typeId, wrongSelection.typeId);
    assert.equal(attempts[0].domainId, wrongSelection.domainId);
    assert.equal(attempts[0].scoreGroup, wrongSelection.scoreGroup);
    assert.equal(attempts[0].difficulty, wrongSelection.difficulty);
    assert.equal(attempts[0].inferredErrorTag, wrongSelection.errorTag);
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
    assert.equal(
      await evaluate(client, "document.querySelector('#optionFeedback').hidden"),
      false
    );
    assert.ok(
      (await evaluate(
        client,
        "document.querySelector('#optionFeedback').textContent"
      )).includes(wrongSelection.feedback.slice(0, 18))
    );
    assert.equal(
      await evaluate(client, "document.querySelectorAll('.explanation-step').length"),
      3
    );
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    assert.equal(
      await evaluate(
        client,
        "document.documentElement.scrollWidth <= window.innerWidth"
      ),
      true
    );
    await captureOptionalScreenshot(client, "feedback-mobile");
    await client.send("Emulation.clearDeviceMetricsOverride");
    const [questionProgress] = await readBrowserStore(
      client,
      "questionProgress"
    );
    assert.equal(questionProgress.questionId, wrongSelection.questionId);
    assert.equal(
      questionProgress.gradingFingerprint,
      wrongSelection.gradingFingerprint
    );
    assert.equal(questionProgress.level, 0);
    assert.equal(questionProgress.status, "new");
    assert.equal(questionProgress.lastReviewReason, "wrong");
    assert.match(questionProgress.dueAt, /^\d{4}-\d{2}-\d{2}$/);

    await navigate(client, `${baseUrl}/apps/mensa/?feedback-restore=1`);
    await waitForCondition(
      client,
      "!document.querySelector('#resumeNotice').hidden"
    );
    await evaluate(
      client,
      "window.confirm = () => true; " +
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
    assert.equal(currentSummary.mastery.tracked, 1);
    assert.equal(currentSummary.migration.noticePending, false);
    assert.equal((await readBrowserStore(client, "sessions")).length, 1);
    const dailyQueuesRecord = (await readBrowserStore(client, "meta"))
      .find(record => record.key === "dailyQueues");
    const [dailyQueue] = Object.values(dailyQueuesRecord.value);
    assert.equal(dailyQueue.items.length, 10);
    assert.equal(
      new Set(dailyQueue.items.map(item => item.questionId)).size,
      10
    );
    const runtimeQuestionById = new Map(
      runtimeBank.questions.map(question => [question.id, question])
    );
    assert.equal(
      new Set(dailyQueue.items.map(item =>
        runtimeQuestionById.get(item.questionId).typeId
      )).size,
      10
    );
    assert.equal(dailyQueue.strategy, "cold-start");
    assert.equal(dailyQueue.strategyVersion, 3);

    await evaluate(client, "document.querySelector('#quitBtn').click(); true");
    await waitForCondition(client, "!document.querySelector('#homeView').classList.contains('hidden')");

    await evaluate(
      client,
      "document.querySelector('[data-mode=\"daily\"]').click(); true"
    );
    await waitForCondition(
      client,
      "!document.querySelector('#quizView').classList.contains('hidden')"
    );
    const sessionsAfterDailyRestart = await waitForBrowserStore(
      client,
      "sessions",
      records => records.some(record =>
        record.status === "active" &&
        record.mode === "daily" &&
        record.sessionId !== savedBeforeReload.sessionId
      )
    );
    const restartedDaily = sessionsAfterDailyRestart.find(record =>
      record.status === "active" &&
      record.mode === "daily" &&
      record.sessionId !== savedBeforeReload.sessionId
    );
    assert.deepEqual(
      restartedDaily.queueQuestionIds,
      dailyQueue.items.map(item => item.questionId)
    );
    console.log("[smoke] 일일 큐 재사용");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );

    await navigate(client, `${baseUrl}/`);
    await waitForCondition(
      client,
      "document.querySelectorAll('.app-card').length === 6"
    );
    const mkatMetric = await evaluate(client, `(() => {
      const card = [...document.querySelectorAll(".app-card")]
        .find(item => item.textContent.includes("MKAT 98"));
      return card?.querySelector(".app-metric")?.textContent || "";
    })()`);
    assert.match(mkatMetric, /오늘 1\/10/);
    assert.match(mkatMetric, /목표 0일 연속/);

    await navigate(client, `${baseUrl}/apps/mensa/`);
    await waitForCondition(client, "document.querySelectorAll('.type-card').length === 59");
    await evaluate(client, "window.confirm = () => true; true");
    await evaluate(client, "document.querySelector('[data-mode=\"diagnostic\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 59'");
    assert.equal(
      await evaluate(client, "document.querySelector('#questionMeta').classList.contains('hidden')"),
      true
    );
    assert.equal(
      await evaluate(client, "document.querySelector('#questionNavigator').classList.contains('hidden')"),
      false
    );
    assert.equal(
      await evaluate(client, "document.querySelectorAll('.question-number-button').length"),
      59
    );
    assert.equal(
      await evaluate(client, "document.querySelector('#timer').textContent"),
      "00:00"
    );
    await evaluate(
      client,
      "document.querySelector('.option-button').click(); " +
      "document.querySelector('#submitAnswerBtn').click(); true"
    );
    await waitForCondition(
      client,
      "document.querySelector('#progressText').textContent === '2 / 59'"
    );
    assert.equal(
      await evaluate(client, "document.querySelector('#feedback').classList.contains('hidden')"),
      true
    );
    assert.equal((await readBrowserStore(client, "attempts")).length, 1);
    const diagnosticSession = (await waitForBrowserStore(
      client,
      "sessions",
      records => records.some(record =>
        record.status === "active" &&
        record.mode === "diagnostic" &&
        Object.keys(record.responses || {}).length === 1
      )
    )).find(record =>
      record.status === "active" && record.mode === "diagnostic"
    );
    assert.equal(
      Object.values(diagnosticSession.responses)[0].attemptId.startsWith("attempt-"),
      true
    );
    console.log("[smoke] 진단 답안 지연 저장");

    await navigate(client, `${baseUrl}/apps/mensa/?diagnostic-restore=1`);
    await waitForCondition(client, "!document.querySelector('#resumeNotice').hidden");
    await evaluate(client, "window.confirm = () => true; document.querySelector('#resumeSessionBtn').click(); true");
    await waitForCondition(
      client,
      "document.querySelector('#progressText').textContent === '2 / 59'"
    );
    assert.equal(
      await evaluate(client, "document.querySelectorAll('.question-number-button.answered').length"),
      1
    );
    assert.equal((await readBrowserStore(client, "attempts")).length, 1);
    await evaluate(
      client,
      "document.querySelector('#finishAssessmentBtn').click(); true"
    );
    await waitForCondition(
      client,
      "!document.querySelector('#resultView').classList.contains('hidden')"
    );
    const attemptsAfterDiagnostic = await readBrowserStore(
      client,
      "attempts"
    );
    assert.equal(attemptsAfterDiagnostic.length, 60);
    assert.equal(
      attemptsAfterDiagnostic.filter(attempt =>
        attempt.sessionId === diagnosticSession.sessionId
      ).length,
      59
    );
    assert.equal(
      attemptsAfterDiagnostic.filter(attempt =>
        attempt.sessionId === diagnosticSession.sessionId &&
        attempt.skipped
      ).length,
      58
    );
    assert.match(
      await evaluate(client, "document.querySelector('#resultRing').style.getPropertyValue('--score-angle')"),
      /deg/
    );
    console.log("[smoke] 진단 일괄 제출");
    await evaluate(client, "document.querySelector('#backHomeBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );

    await evaluate(client, "document.querySelector('[data-mode=\"exam\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 59'");
    const activeExam = (await waitForBrowserStore(
      client,
      "sessions",
      records => records.some(record =>
        record.status === "active" &&
        record.mode === "exam" &&
        Number(record.examEndsAt) > Number(record.startedAt)
      )
    )).find(record => record.status === "active" && record.mode === "exam");
    assert.ok(activeExam.examEndsAt - activeExam.startedAt >= 600000);
    assert.equal(
      await evaluate(client, "document.querySelector('#assessmentControls').classList.contains('hidden')"),
      false
    );
    await evaluate(client, `new Promise((resolve, reject) => {
      const openRequest = indexedDB.open("mkat98-training-v2");
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => {
        const database = openRequest.result;
        const transaction = database.transaction("sessions", "readwrite");
        const store = transaction.objectStore("sessions");
        const request = store.get(${JSON.stringify(activeExam.sessionId)});
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const record = request.result;
          record.examEndsAt = Date.now() - 1000;
          record.sessionRevision = Number(record.sessionRevision || 0) + 100;
          record.updatedAt = Date.now();
          store.put(record);
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(true);
        };
        transaction.onerror = () => reject(transaction.error);
      };
    })`);
    await navigate(client, `${baseUrl}/apps/mensa/?expired-exam=1`);
    await waitForCondition(
      client,
      "!document.querySelector('#resultView').classList.contains('hidden')",
      10000
    );
    await evaluate(client, "window.confirm = () => true; true");
    assert.match(
      await evaluate(client, "document.querySelector('#resultTitle').textContent"),
      /자동 제출/
    );
    const examAttempts = (await readBrowserStore(client, "attempts"))
      .filter(attempt => attempt.sessionId === activeExam.sessionId);
    assert.equal(examAttempts.length, 59);
    assert.equal(examAttempts.every(attempt => attempt.skipped), true);
    console.log("[smoke] 실전 시간 만료 자동 제출");
    await evaluate(client, "document.querySelector('#backHomeBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );

    await evaluate(client, "document.querySelector('[data-mode=\"speed\"]').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 15'");
    assert.equal(
      await evaluate(client, "document.querySelector('#answerActions').classList.contains('hidden')"),
      true
    );
    const attemptsBeforeSpeed = (await readBrowserStore(client, "attempts")).length;
    await evaluate(client, "document.querySelector('.option-button').click(); true");
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '2 / 15'");
    assert.equal(
      (await readBrowserStore(client, "attempts")).length,
      attemptsBeforeSpeed + 1
    );
    console.log("[smoke] 속도 즉시 제출");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );

    await evaluate(
      client,
      "document.querySelector('[data-type-id=\"T01\"]').click(); true"
    );
    await waitForCondition(client, "document.querySelector('#progressText').textContent === '1 / 27'");
    const mixedTypeSession = (await waitForBrowserStore(
      client,
      "sessions",
      records => records.some(record =>
        record.status === "active" &&
        record.mode === "learn" &&
        record.typeId === "T01"
      )
    )).find(record =>
      record.status === "active" &&
      record.mode === "learn" &&
      record.typeId === "T01"
    );
    assert.equal(mixedTypeSession.queueQuestionIds.length, 27);
    assert.equal(mixedTypeSession.queueQuestionIds.includes("T01-01"), true);
    assert.equal(mixedTypeSession.queueQuestionIds.includes("T01-06"), true);
    assert.equal(mixedTypeSession.queueQuestionIds.includes("T01-16"), true);
    assert.equal(
      await evaluate(client, "document.querySelector('#questionMeta').classList.contains('hidden')"),
      false
    );
    assert.equal(
      await evaluate(client, "document.querySelector('#hintPanel').classList.contains('hidden')"),
      false
    );
    const hintQuestionId = await evaluate(
      client,
      "document.querySelector('#options').dataset.questionId"
    );
    await evaluate(client, "document.querySelector('#hintBtn').click(); true");
    assert.equal(
      await evaluate(client, "document.querySelector('#hintText').hidden"),
      false
    );
    assert.equal(
      await evaluate(client, "document.querySelectorAll('#hintText p').length"),
      1
    );
    assert.equal(
      await evaluate(client, "document.querySelector('#hintBtn').disabled"),
      false
    );
    await evaluate(client, "document.querySelector('#hintBtn').click(); true");
    assert.equal(
      await evaluate(client, "document.querySelectorAll('#hintText p').length"),
      2
    );
    assert.equal(
      await evaluate(client, "document.querySelector('#hintBtn').disabled"),
      true
    );
    const hintSession = (await waitForBrowserStore(
      client,
      "sessions",
      records => records.some(record =>
        record.status === "active" &&
        record.mode === "learn" &&
        record.hintLevels?.[hintQuestionId] === 2
      )
    )).find(record =>
      record.status === "active" && record.mode === "learn"
    );
    assert.equal(hintSession.hintUsedQuestionIds.includes(hintQuestionId), true);
    console.log("[smoke] 기존·심화·신규 혼합 유형 학습과 2단계 힌트");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await evaluate(
      client,
      "document.querySelector('[data-type-id=\"S35\"]').click(); true"
    );
    await waitForCondition(
      client,
      "document.querySelector('#progressText').textContent === '1 / 10'"
    );
    assert.match(
      await evaluate(
        client,
        "document.querySelector('#options').dataset.questionId"
      ),
      /^S35-/
    );
    assert.equal(
      await evaluate(
        client,
        "document.querySelectorAll('.option-button').length"
      ),
      6
    );
    assert.equal(
      await evaluate(
        client,
        "document.documentElement.scrollWidth <= window.innerWidth"
      ),
      true
    );
    await captureOptionalScreenshot(client, "s35-learning-mobile");
    await evaluate(client, "document.querySelector('#quitBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );
    await client.send("Emulation.clearDeviceMetricsOverride");
    console.log("[smoke] Mensa Norway S35 390px 모바일 렌더링");
    await evaluate(
      client,
      "document.querySelector('#viewDetailedStatsBtn').click(); true"
    );
    await waitForCondition(
      client,
      "!document.querySelector('#statsView').classList.contains('hidden')"
    );
    assert.ok(
      await evaluate(client, "document.querySelectorAll('.error-row').length >= 1")
    );
    assert.ok(
      await evaluate(
        client,
        "document.querySelectorAll('.recommendation-chip').length >= 1"
      )
    );
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    assert.equal(
      await evaluate(
        client,
        "document.documentElement.scrollWidth <= window.innerWidth"
      ),
      true
    );
    assert.equal(
      await evaluate(
        client,
        "getComputedStyle(document.querySelector('.analysis-split')).gridTemplateColumns.split(' ').length"
      ),
      1
    );
    await captureOptionalScreenshot(client, "analytics-mobile");
    await client.send("Emulation.clearDeviceMetricsOverride");
    await evaluate(client, "document.querySelector('#statsBackBtn').click(); true");
    await waitForCondition(
      client,
      "!document.querySelector('#homeView').classList.contains('hidden')"
    );

    await navigate(client, `${baseUrl}/apps/mensa/`);
    await waitForCondition(client, "document.querySelectorAll('.type-card').length === 59");
    await evaluate(client, "document.querySelector('[data-mode=\"review\"]').click(); true");
    await waitForCondition(
      client,
      "document.querySelector('#progressText').textContent.startsWith('1 / ')"
    );
    assert.ok(
      Number(
        (await evaluate(
          client,
          "document.querySelector('#progressText').textContent"
        )).split("/")[1]
      ) >= 1
    );

    await waitForCondition(
      client,
      "navigator.serviceWorker.controller !== null",
      15000
    );
    const errorsBeforeOffline = browserErrors.length;
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
      "!document.querySelector('#app').hidden && document.querySelectorAll('.type-card').length === 59",
      15000
    );
    await navigate(client, `${baseUrl}/apps/volatility/?offline-smoke=1`);
    await waitForCondition(
      client,
      "document.body.dataset.ready === 'true'",
      15000
    );
    const offlineVolatility = await evaluate(client, `(() => ({
      status: document.querySelector("#dataStatus").textContent,
      locked: !document.querySelector("#calculationLock").hidden,
      calculationsHidden: document.querySelector("#automaticCalculations").hidden,
      current: document.querySelector("#currentPrice").textContent,
      manualPanelVisible: !document.querySelector("#manualPanel").hidden
    }))()`);
    assert.equal(offlineVolatility.status, "시세 없음");
    assert.equal(offlineVolatility.locked, true);
    assert.equal(offlineVolatility.calculationsHidden, true);
    assert.equal(offlineVolatility.current, "—");
    assert.equal(offlineVolatility.manualPanelVisible, true);
    await navigate(client, `${baseUrl}/?offline-hub-smoke=1`);
    await waitForCondition(
      client,
      "document.querySelectorAll('.app-card').length === 6",
      15000
    );
    const offlineUniversityCard = await evaluate(client, `(() => {
      const card = document.querySelector('[data-app-id="university-admission"]');
      return { href: card?.href, target: card?.target, rel: card?.rel };
    })()`);
    assert.deepEqual(offlineUniversityCard, {
      href: "https://university-admission-private-preview-yuni14.vercel.app/",
      target: "_blank",
      rel: "noopener noreferrer"
    });
    const offlineNetworkErrors = browserErrors.splice(errorsBeforeOffline);
    assert.equal(offlineNetworkErrors.every(message =>
      /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(message)
    ), true);
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "wifi"
    });

    assert.deepEqual(browserErrors, []);
    console.log(
      "브라우저 스모크 성공: 허브 6카드·대학 입학정보 Vercel 링크·Volatility 데스크톱/모바일, 유형 59개, " +
      "일일·진단·실전·속도·유형학습·복습 큐, 선택 후 제출, " +
      "진단 원자 저장·실전 자동 제출·확대 보기, v1 안전 이전, " +
      "IndexedDB 응시·숙달 이벤트, 유형 중복 없는 일일 고정 큐, 세션 복원, " +
      "2단계 힌트·구조화 피드백·인지 영역 분석·390px 모바일, " +
      "v2 요약 캐시, 허브·MKAT·Volatility 오프라인 로드"
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
