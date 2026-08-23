// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-08-24",
  "effectiveThrough": "2026-08-30",
  "calculatedAt": "2026-08-24T01:00:11.979+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "87ddb15daea643b656123c151ade8b9b8859ed72eb129c7eedf887d1fa89b104",
  "fitStart": "2021-08-24",
  "fitEndExclusive": "2026-08-24",
  "holdoutStart": "2025-08-25",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7583445504132509,
  "bearPercent": 1.9603742481410618,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7583445504132509,
      "rangeRawSampleCount": 670,
      "rangeUsedSampleCount": 646,
      "safePercent": 0.7116322084110538,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.04718693284936,
      "selectionWilson95Low": 72.37755672423745,
      "walkForwardSampleCount": 135,
      "walkForwardHitRate": 80.74074074074075,
      "walkForwardWilson95Low": 73.27603609110855,
      "walkForwardWilson95High": 86.50437871077696,
      "walkForwardBlock95Low": 70.26971186062096,
      "walkForwardBlock95High": 89.76377952755905,
      "currentWindowSampleCount": 670,
      "currentWindowUsedCount": 645
    },
    "bear": {
      "rangeMeanPercent": 1.9603742481410618,
      "rangeRawSampleCount": 590,
      "rangeUsedSampleCount": 561,
      "safePercent": 0.8085623123057056,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.22281639928698,
      "selectionWilson95Low": 73.39448803174096,
      "walkForwardSampleCount": 118,
      "walkForwardHitRate": 77.11864406779661,
      "walkForwardWilson95Low": 68.75595657058834,
      "walkForwardWilson95High": 83.7713199570052,
      "walkForwardBlock95Low": 67.42180468046804,
      "walkForwardBlock95High": 86.40019417475729,
      "currentWindowSampleCount": 590,
      "currentWindowUsedCount": 564
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3595381228038516,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.54110135674381,
      "selectionWilson95Low": 73.31658560528236,
      "walkForwardSampleCount": 253,
      "walkForwardHitRate": 74.30830039525692,
      "walkForwardWilson95Low": 68.58881936049755,
      "walkForwardWilson95High": 79.30064543415175,
      "walkForwardBlock95Low": 69.35483870967742,
      "walkForwardBlock95High": 78.82352941176471,
      "currentWindowSampleCount": 1260,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.2948699258556102,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.01995211492418,
      "selectionWilson95Low": 73.80262483749172,
      "walkForwardSampleCount": 253,
      "walkForwardHitRate": 73.12252964426878,
      "walkForwardWilson95Low": 67.34398002631164,
      "walkForwardWilson95High": 78.20941331494014,
      "walkForwardBlock95Low": 66.79841897233202,
      "walkForwardBlock95High": 79.13385826771653,
      "currentWindowSampleCount": 1260,
      "currentWindowUsedCount": 1199
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 19.4%, 하락 25.3%로 안전선에 부적합"
  }
});
