import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { Readable } from "node:stream";

function pinnedFetch(url, options, addresses) {
  return new Promise((resolve, reject) => {
    // Connect only to the addresses just checked, including after redirects.
    const req = request(url, { ...options, lookup: (_host, opts, callback) => {
      if (opts.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    } }, response => resolve({
      status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
      headers: new Headers(Object.entries(response.headers).filter(([, v]) => v != null).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])),
      body: Readable.toWeb(response)
    }));
    req.on("error", reject); req.end();
  });
}

export function publicAddress(address) {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19].includes(b));
}
export async function publicText(value, { token, fetchImpl = pinnedFetch, lookupImpl = lookup, maxBytes = 3000000 } = {}) {
  let url = new URL(value);
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(url.hostname)) throw new Error("공개 HTTPS 주소만 조사할 수 있습니다.");
    const addresses = await lookupImpl(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error("사설·예약 네트워크 조사 거부");
    const headers = { "User-Agent": "PersonalTap-AI-Research/2.1", Accept: "*/*" };
    if (token && url.hostname === "api.github.com") headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20000) }, addresses);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || hop === 3) throw new Error("원문 리디렉션 한도 초과");
      url = new URL(location, url); continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; if (size > maxBytes) throw new Error("조사 응답 크기 초과");
      chunks.push(chunk);
    }
    return { text: Buffer.concat(chunks).toString("utf8"), url: url.href };
  }
}
