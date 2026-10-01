// =========================================================
// 🧮 예측 공식 (대시보드 quant.js · 카톡 알림 gas/premarket_alert.gs 공통)
//   두 곳의 함수 본문이 같아야 합니다 → tests/parity.test.js 가 PR 마다 자동 확인
// =========================================================

// 예상 등락(비율) = (1 + β × 구성종목 변동) × (1 + β × 선물 마감후 변동 × 미국 비중) × (1 + 환율 변동 × 해외 비중) − 1
function predictRet(rawDelta, beta, futDelta, usShare, fxDelta, foreignShare) {
  return (1 + beta * rawDelta) * (1 + beta * futDelta * usShare) * (1 + fxDelta * foreignShare) - 1;
}

// ETF 이름으로 따라갈 선물: S&P → ES, 다우 → YM, 나머지 → NQ
function futKeyFor(name) {
  return /S&P|S＆P/i.test(String(name || '')) ? 'ES' : (/다우/.test(String(name || '')) ? 'YM' : 'NQ');
}

// 신호: 예상 등락(%)이 매수 기준 이하면 BUY, 매도 기준 이상이면 SELL
function signalFor(pct, buy, sell) {
  return pct <= buy ? 'BUY' : (pct >= sell ? 'SELL' : 'HOLD');
}
