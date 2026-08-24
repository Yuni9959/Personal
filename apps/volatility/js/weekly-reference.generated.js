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
  "calculatedAt": "2026-08-24T21:55:46.623+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "da3b0daa49887d46d9df0c0f47c5af75673b64315f12a6e188cb90affbabc1f8",
  "fitStart": "2021-08-24",
  "fitEndExclusive": "2026-08-24",
  "holdoutStart": "2025-08-25",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7593685542238118,
  "bearPercent": 1.9603742481410618,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7593685542238118,
      "rangeRawSampleCount": 670,
      "rangeUsedSampleCount": 646,
      "safePercent": 0.7132796780684104,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.04718693284936,
      "selectionWilson95Low": 72.37755672423745,
      "walkForwardSampleCount": 135,
      "walkForwardHitRate": 81.48148148148148,
      "walkForwardWilson95Low": 74.09068999035055,
      "walkForwardWilson95High": 87.13021673447194,
      "walkForwardBlock95Low": 71.53260501764393,
      "walkForwardBlock95High": 90.22556390977444,
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
      "safePercent": 0.3603545691123524,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.54110135674381,
      "selectionWilson95Low": 73.31658560528236,
      "walkForwardSampleCount": 253,
      "walkForwardHitRate": 74.70355731225297,
      "walkForwardWilson95Low": 69.00487546332465,
      "walkForwardWilson95High": 79.66327981579049,
      "walkForwardBlock95Low": 69.87856186651368,
      "walkForwardBlock95High": 79.2156862745098,
      "currentWindowSampleCount": 1260,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.29505120096620113,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.01995211492418,
      "selectionWilson95Low": 73.80262483749172,
      "walkForwardSampleCount": 253,
      "walkForwardHitRate": 73.51778656126481,
      "walkForwardWilson95Low": 67.75837960746507,
      "walkForwardWilson95High": 78.57370421825253,
      "walkForwardBlock95Low": 67.1875,
      "walkForwardBlock95High": 79.44664031620553,
      "currentWindowSampleCount": 1260,
      "currentWindowUsedCount": 1199
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 19.4%, 하락 25.3%로 안전선에 부적합"
  }
});
