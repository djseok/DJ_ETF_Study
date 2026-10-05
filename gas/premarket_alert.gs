/**
 * 🌅 개장 전 예상가 알림 (카카오톡 나에게 보내기) — 관리시트 Apps Script
 *   (etf_holdings_sync.gs 와 같은 프로젝트에 두세요. 그 파일의 hsFetchAll_ 등 도우미를 함께 씁니다)
 *
 * 평일 아침 7시대에 MasterData '본체ETF' 전부에 대해
 *   예상 등락률 = [ 미국 구성종목의 전일 미국장 등락 × 비중 ] × 베타
 *              + [ 미국장 마감(05:00) 이후 새벽 선물 변동 × 베타 ] × 미국 비중
 *              + [ 어제 국내장 마감 이후 원/달러 변동 ] × 해외 비중
 *   예상가 = 전일 종가 × (1 + 예상 등락률)
 * 을 계산해 '개장전_예측' 탭에 기록하고 카카오톡으로 보냅니다.
 *   · 국내·일본·중국 종목은 어제 국내장 마감 전에 이미 가격에 반영돼 있어 0으로 봅니다
 *   · 선물: 이름에 S&P → ES=F, 다우 → YM=F, 그 밖에는 나스닥(NQ=F)
 *   · 신호: ETF_Quant_Signals 의 기준(매수 %, 매도 %)과 비교해 BUY / SELL / HOLD
 *
 * ▶ 처음 한 번 (카카오 설정은 README 의 순서대로)
 *   1) 프로젝트 설정 → 스크립트 속성에 KAKAO_REST_KEY, KAKAO_REDIRECT_URI (+ 쓰는 경우 KAKAO_CLIENT_SECRET)
 *   2) kakaoAuthUrl 실행 → 로그의 주소를 브라우저로 열어 동의 → 이동한 주소의 code= 값을 스크립트 속성 KAKAO_AUTH_CODE 에 저장
 *   3) kakaoExchangeCode 실행 → 토큰 저장 (KAKAO_AUTH_CODE 는 지워도 됨)
 *   4) previewPremarket 실행 → 계산 결과를 로그로 확인 (카톡·시트 안 씀)
 *   5) sendPremarketAlert 실행 → 실제 카톡 발송 테스트
 *   6) 스크립트 속성 GH_DISPATCH_TOKEN (GitHub 토큰, README 참고) → 이미지 A·B 를 GitHub Actions 가 그려서 카톡으로 발송
 *   7) installPremarketTrigger 실행 → 평일 07:30 알림 · 16:10 실제 시가·종가 기록 · 05:40 선물 기준가 갱신
 *
 * 대시보드 예측 엔진(js/quant.js)과 같은 공식:
 *   예상 = (1 + 베타 × 구성종목 변동) × (1 + 베타 × 선물 마감후 변동 × 미국 비중) × (1 + 환율 변동 × 해외 비중) − 1
 *   VIX 는 곱하지 않고 20 이상이면 '변동성 경계' 배지
 */

var PM_TAB_LOG = '개장전_예측';
var PM_DASHBOARD_URL = 'https://djseok.github.io/DJ_ETF_Study/';
var PM_KAKAO_MAX = 190; // 카카오 텍스트 메시지 1건 최대 200자
var PM_REPO = 'djseok/DJ_ETF_Study';
var PM_IMAGE_BASE = 'https://djseok.github.io/DJ_ETF_Study/alerts/';
var PM_TAB_MACRO = 'Characteristic';
var PM_FUT_ROWS = [ // Characteristic 행: 전일지수(D) = 미국장 마감 시점 가격 (이 스크립트가 매일 기록), 현재지수(E) = 실시간
  { key: 'NQ', sym: 'NQ=F', ticker: '나스닥선물지수', name: '크롤링' },
  { key: 'ES', sym: 'ES=F', ticker: 'S&P선물지수', name: 'ES=F' },
  { key: 'YM', sym: 'YM=F', ticker: '다우선물지수', name: 'YM=F' }
];

function previewPremarket() { runPremarket_(true); }
function sendPremarketAlert() { runPremarket_(false); }

function installPremarketTrigger() {
  var names = ['premarketDaily_', 'recordActualsDaily_', 'futuresRefDaily_'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('premarketDaily_').timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  ScriptApp.newTrigger('recordActualsDaily_').timeBased().everyDays(1).atHour(16).nearMinute(10).create();
  ScriptApp.newTrigger('futuresRefDaily_').timeBased().everyDays(1).atHour(6).nearMinute(20).create(); // 미국장 마감: 여름 05:00 · 겨울 06:00 (KST)
  Logger.log('✅ 트리거 설치: 평일 07:30 개장 전 알림 · 16:10 실제 시가·종가 기록 · 매일 06:20 선물·EWY 기준값 갱신');
}

function futuresRefDaily_() { var info = pmFuturesAll_(); info.EWY = pmUsSessionFresh_() ? pmEwyInfo_() : { open: 0, close: 0, delta: 0 }; pmUpdateFuturesRows_(info); if (typeof wrMarkRun_ === 'function') wrMarkRun_('futures'); }
function recordActualsDaily_() {
  var dow = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'u'));
  if (dow >= 6 || pmKrHoliday_()) return;
  recordActuals();
  if (typeof wrMarkRun_ === 'function') wrMarkRun_('actuals');
}

function premarketDaily_() {
  var dow = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'u')); // 1=월 … 7=일
  if (dow >= 6) return;
  if (pmKrHoliday_()) { Logger.log('ℹ️ 오늘은 국내 증시 휴장일이라 알림을 보내지 않아요.'); return; }
  runPremarket_(false);
  if (typeof wrMarkRun_ === 'function') wrMarkRun_('premarket');
}

// 국내 증시(KRX) 평일 휴장일 — 해마다 12월에 다음 해 날짜 추가 (스크립트 속성 PM_KR_HOLIDAYS 에 'yyyy-MM-dd,…' 로 더할 수도 있음)
var PM_KR_HOLIDAYS = [
  '2026-10-05', '2026-10-09', '2026-12-25', '2026-12-31', // 10-05 개천절 대체공휴일
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-08-16',
  '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-04', '2027-10-11', '2027-12-27', '2027-12-31'
];
function pmKrHoliday_(ymd) {
  var today = ymd || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var extra = (PropertiesService.getScriptProperties().getProperty('PM_KR_HOLIDAYS') || '').split(',').map(function (x) { return x.trim(); });
  return PM_KR_HOLIDAYS.indexOf(today) >= 0 || extra.indexOf(today) >= 0;
}

// =========================================================
// 계산
// =========================================================
var PM_T0 = 0;
function pmLap_(label) { Logger.log('⏱ ' + label + ' ' + Math.round((Date.now() - PM_T0) / 1000) + '초'); }

function runPremarket_(dryRun) {
  PM_T0 = Date.now();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(HS_TAB_MASTER);
  var etfs = pmEtfList_(master);
  var params = pmParams_(ss);
  var holdings = pmHoldings_(ss);

  // 미국 구성종목 전일 등락
  var usTickers = {};
  Object.keys(holdings).forEach(function (k) {
    holdings[k].forEach(function (h) { if (h.market === '미국' && h.ticker) usTickers[h.ticker] = true; });
  });
  pmLap_('시트 읽기');
  var usMove = pmDailyMoves_(Object.keys(usTickers).concat(['SPY']));
  pmLap_('미국 종목 ' + Object.keys(usMove).length + '/' + (Object.keys(usTickers).length + 1) + '개 등락');
  var usNote = '';
  if (!pmUsSessionFresh_()) { Object.keys(usTickers).forEach(function (t) { usMove[t] = 0; }); usNote = '미국 휴장 → 종목 등락 0'; Logger.log('ℹ️ 지난밤 미국장 휴장으로 보고 종목 등락을 0으로 계산'); }

  // 선물 · 환율 · ETF 전일 종가
  var futInfo = pmFuturesAll_();
  // 국내 구성종목: 미국에 상장된 한국 ETF(EWY)의 지난밤 미국장 시가→종가 변동으로 추정 (국내장 마감 이후의 움직임)
  futInfo.EWY = usNote ? { open: 0, close: 0, delta: 0 } : pmEwyInfo_();
  var krMove = futInfo.EWY.delta || 0;
  // 야후 장애로 미국 종목 가격을 절반 넘게 못 받으면 예측이 '국내/HOLD' 쪽으로 쏠림 → 조용히 보내지 않고 알림에 경고 표시
  var usNeed = Object.keys(usTickers).length, usGot = Object.keys(usTickers).filter(function (t) { return usMove[t] !== undefined; }).length;
  if (!usNote && usNeed > 0 && usGot < usNeed * 0.5) {
    usNote = '⚠️ 미국 종목 가격 ' + usGot + '/' + usNeed + '개만 받음 → 예측 부정확';
    Logger.log('⚠️ 미국 종목 가격을 ' + usGot + '/' + usNeed + '개만 받아 알림에 경고 표시 (야후 응답 확인)');
  }
  var fut = { NQ: futInfo.NQ.delta, ES: futInfo.ES.delta, YM: futInfo.YM.delta };
  var fx = pmFxSinceKrClose_();
  var vix = pmVix_();
  var etfClose = pmEtfCloses_(etfs, master);
  pmLap_('선물·환율·VIX·ETF 종가');

  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var rows = [];
  etfs.forEach(function (e) {
    var hs = holdings[hsNormName_(e.name)] || [];
    var p = params[hsNormName_(e.name)] || { buy: HS_DEFAULT_PARAMS.buy, sell: HS_DEFAULT_PARAMS.sell, beta: HS_DEFAULT_PARAMS.beta };
    var wAll = 0, wUsPriced = 0, wForeign = 0, usDelta = 0, wMissing = 0, wKr = 0;
    hs.forEach(function (h) {
      wAll += h.w;
      if (h.market === '한국') wKr += h.w;
      if (h.market === '미국') {
        var d = usMove[h.ticker];
        if (d === undefined) { wMissing += h.w; return; }
        usDelta += d * h.w; wUsPriced += h.w; wForeign += h.w;
      } else if (h.market && h.market !== '한국' && h.market !== '현금' && h.market !== '파생') wForeign += h.w;
    });
    var base = wAll - wMissing;
    var usShare = base > 0 ? wUsPriced / base : 0;
    var foreignShare = base > 0 ? wForeign / base : 0;
    var usRet = wUsPriced > 0 ? usDelta / wUsPriced : 0;          // 미국 부분의 평균 등락
    var krShare = base > 0 ? wKr / base : 0;
    var futKey = futKeyFor_(e.name);
    var f = fut[futKey] || 0;
    var ret = predictRet_(usRet * usShare + krMove * krShare, p.beta, f, usShare, fx, foreignShare);
    var close = etfClose[e.code] || 0;
    var price = close ? Math.round(close * (1 + ret)) : 0;
    var pct = ret * 100;
    var signal = hs.length === 0 ? '-' : signalFor_(pct, p.buy, p.sell);
    rows.push({
      date: today, name: e.name, code: e.code, group: e.group, close: close, pct: pct, price: price, signal: signal,
      usRet: usRet * 100, usShare: usShare * 100, fut: f * 100, futKey: futKey, fx: fx * 100, foreignShare: foreignShare * 100,
      beta: p.beta, buy: p.buy, sell: p.sell, domestic: usShare === 0 && !(krShare > 0 && krMove !== 0), hasPdf: hs.length > 0, missing: wMissing,
      krShare: krShare * 100, krMove: krMove * 100
    });
  });

  // 로그
  Logger.log('선물(마감 후) NQ ' + pmPct_(fut.NQ * 100) + ' · ES ' + pmPct_(fut.ES * 100) + ' · YM ' + pmPct_(fut.YM * 100) + ' | 원/달러 ' + pmPct_(fx * 100));
  rows.forEach(function (r) {
    Logger.log((r.signal === 'BUY' ? '🔵' : r.signal === 'SELL' ? '🔴' : '⚪') + ' ' + r.name + ' ' + pmPct_(r.pct) + ' → ' + (r.price ? r.price.toLocaleString() + '원' : '종가?') +
      ' [' + r.signal + '] (미국 ' + pmPct_(r.usRet) + ' × 비중 ' + r.usShare.toFixed(0) + '%' + (r.krShare > 0 ? ' · 국내(EWY) ' + pmPct_(r.krMove) + ' × 비중 ' + r.krShare.toFixed(0) + '%' : '') + ' · ' + r.futKey + ' 선물 ' + pmPct_(r.fut) + ' · β' + r.beta +
      (r.missing > 0.5 ? ' · 가격없음 ' + r.missing.toFixed(1) + '%' : '') + ')');
  });
  Logger.log('VIX ' + (vix ? vix.toFixed(1) : '?') + (vix >= 20 ? ' ⚠️ 변동성 경계' : ''));
  var weekly = pmWeeklyAccuracy_(ss);
  if (weekly) Logger.log('📏 ' + weekly);
  var payload = pmImagePayload_(rows, fut, fx, vix, usNote, krMove);
  var summary = pmSummaryText_(rows, fut, fx, vix, usNote, weekly);
  Logger.log('이미지 데이터: ' + payload.rows.length + '개 ETF · 국내 제외 ' + payload.domestic + '개');
  Logger.log('카톡 요약:\n' + summary);
  if (dryRun) { Logger.log('[미리보기] 카톡·시트에 쓰지 않았어요.'); return; }

  pmUpdateFuturesRows_(futInfo);
  pmWriteLog_(ss, rows, fut, fx);

  // 이미지: GitHub Actions 에 그려달라고 요청 → 올라오면 카톡 사진 메시지 2건, 실패하면 글자 메시지로 대신
  var sentImages = false;
  var token = PropertiesService.getScriptProperties().getProperty('GH_DISPATCH_TOKEN');
  if (token) {
    try {
      var urls = pmRequestImages_(token, payload);
      if (urls) {
        // 카톡 사진은 미리보기라 작게 잘려 보임 → 누르면 확대 가능한 보기 페이지(alerts/view.html)로 연결
        var view = PM_IMAGE_BASE + 'view.html?s=' + payload.stamp;
        var n = payload.rows.length;
        kakaoSendFeed_(payload.titleShort + ' 개장 전 예상 등락률', summary, urls.A, view + '#A', 1080, Math.round((1.55 + 0.52 * n + 0.95 + 0.72) * 100));
        Utilities.sleep(400);
        kakaoSendFeed_(payload.titleShort + ' 개장 전 예상가', '👆 사진을 누르면 크게 볼 수 있어요 (두 손가락 확대)', urls.B, view + '#B', 1080, Math.round((1.55 + 0.46 * (n + 1) + 0.9 + 0.72) * 100));
        sentImages = true;
      }
    } catch (e) { Logger.log('⚠️ 이미지 발송 실패 → 글자 메시지로 대신: ' + e); }
  } else {
    Logger.log('ℹ️ GH_DISPATCH_TOKEN 이 없어 이미지 없이 글자 메시지로 보냅니다.');
  }
  if (!sentImages) {
    pmKakaoMessages_(rows, fut, fx, today, usNote).forEach(function (m) { kakaoSendToMe_(m); Utilities.sleep(400); });
  }
  Logger.log('✅ 카톡 발송 완료' + (sentImages ? ' (이미지 A·B)' : ' (글자)'));
}

// 이미지 그리기에 넘길 데이터
function pmImagePayload_(rows, fut, fx, vix, usNote, krMove) {
  var now = new Date();
  var md = Utilities.formatDate(now, 'Asia/Seoul', 'M/d') + '(' + '월화수목금토일'.charAt(Number(Utilities.formatDate(now, 'Asia/Seoul', 'u')) - 1) + ')';
  var show = rows.filter(function (r) { return r.hasPdf && !r.domestic; }).sort(function (a, b) { return b.pct - a.pct; });
  return {
    date: Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd'),
    stamp: Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd_HHmm'),
    title: md + ' ' + Utilities.formatDate(now, 'Asia/Seoul', 'HH:mm') + ' 기준',
    titleShort: md,
    chips: [['나스닥 선물', r2_(fut.NQ * 100)], ['S&P 선물', r2_(fut.ES * 100)], ['원/달러', r2_(fx * 100)]].concat(krMove ? [['한국 EWY', r2_(krMove * 100)]] : []),
    vix: vix ? Math.round(vix * 10) / 10 : 0,
    note: usNote || '',
    domestic: rows.length - show.length,
    rows: show.map(function (r) { return [r.name, Math.round(r.close), r2_(r.pct), r.price, r.signal === 'BUY' || r.signal === 'SELL' ? r.signal : '']; })
  };
}
function r2_(v) { return Math.round(v * 100) / 100; }

// ── 예측 공식: 대시보드 js/quant_core.js 와 본문이 같아야 함 (tests/parity.test.js 가 자동 확인) ──
function predictRet_(rawDelta, beta, futDelta, usShare, fxDelta, foreignShare) {
  return (1 + beta * rawDelta) * (1 + beta * futDelta * usShare) * (1 + fxDelta * foreignShare) - 1;
}
function futKeyFor_(name) {
  return /S&P|S＆P/i.test(String(name || '')) ? 'ES' : (/다우/.test(String(name || '')) ? 'YM' : 'NQ');
}
function signalFor_(pct, buy, sell) {
  return pct <= buy ? 'BUY' : (pct >= sell ? 'SELL' : 'HOLD');
}

// 사진 메시지 설명(요약)
function pmSummaryText_(rows, fut, fx, vix, usNote, weekly) {
  var sig = rows.filter(function (r) { return r.signal === 'BUY' || r.signal === 'SELL'; });
  return ('선물(마감후) 나스닥 ' + pmPct_(fut.NQ * 100) + ' · 원/달러 ' + pmPct_(fx * 100) +
    (vix >= 20 ? ' · ⚠️VIX ' + vix.toFixed(1) : '') + (usNote ? ' · ' + usNote : '') + '\n' +
    (sig.length ? '신호: ' + sig.map(function (r) { return (r.signal === 'BUY' ? '🔵' : '🔴') + pmShort_(r.name); }).join(', ') : '신호: 모두 HOLD') +
    (weekly ? '\n' + weekly : '')).slice(0, 190);
}

// GitHub Actions 에 이미지 요청 → GitHub Pages 에 올라올 때까지 기다림 (최대 약 5분)
function pmRequestImages_(token, payload) {
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + PM_REPO + '/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ event_type: 'premarket-image', client_payload: { data: JSON.stringify(payload) } })
  });
  if (res.getResponseCode() !== 204) throw new Error('GitHub 요청 실패 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  var urls = { A: PM_IMAGE_BASE + payload.stamp + '_A.png', B: PM_IMAGE_BASE + payload.stamp + '_B.png' };
  var limit = PM_T0 + 330000; // 실행 한도 6분 안에서 기다림 (끝나기 30초 전까지)
  for (var i = 0; i < 20 && Date.now() + 15000 < limit; i++) {
    Utilities.sleep(15000);
    var a = UrlFetchApp.fetch(urls.A, { muteHttpExceptions: true, followRedirects: true }).getResponseCode();
    var b = UrlFetchApp.fetch(urls.B, { muteHttpExceptions: true, followRedirects: true }).getResponseCode();
    if (a === 200 && b === 200) { Logger.log('🖼 이미지 준비 완료 (' + ((i + 1) * 15) + '초)'); return urls; }
  }
  Logger.log('⚠️ 시간 안에 이미지가 올라오지 않았어요 (GitHub Actions 실행 기록 확인) → 글자 메시지로 대신');
  return null;
}

// =========================================================
// 정확도: 실제 시가·종가 기록 (평일 16:10) · 주간 요약
// =========================================================
var PM_LOG_HEADER = ['날짜', 'ETF', '코드', '대분류', '전일종가', '예상등락(%)', '예상가', '신호', '미국종목등락(%)', '미국비중(%)', '선물', '선물변동(%)', '환율변동(%)', '해외비중(%)', '베타', '기준(매수/매도)',
  '실제시가', '시가등락(%)', '오차(%p)', '실제종가', '종가등락(%)'];

function recordActuals() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PM_TAB_LOG);
  if (!sh || sh.getLastRow() < 2) return;
  if (sh.getLastColumn() < PM_LOG_HEADER.length) sh.getRange(1, 1, 1, PM_LOG_HEADER.length).setValues([PM_LOG_HEADER]);
  var n = sh.getLastRow() - 1;
  var v = sh.getRange(2, 1, n, PM_LOG_HEADER.length).getDisplayValues();
  var since = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), 'Asia/Seoul', 'yyyy-MM-dd');
  var todo = [];
  v.forEach(function (r, i) { if (r[0] >= since && r[16] === '' && Number(String(r[4]).replace(/,/g, '')) > 0) todo.push(i); });
  if (!todo.length) { Logger.log('기록할 실제값 없음'); return; }
  var codes = {};
  todo.forEach(function (i) { codes[v[i][2]] = true; });
  var list = Object.keys(codes);
  var res = hsFetchAll_(list.map(function (c) { return { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + c + '.KS?range=1mo&interval=1d', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true }; }));
  var bars = {};
  list.forEach(function (c, k) {
    try {
      var r = JSON.parse(res[k].getContentText()).chart.result[0], q = r.indicators.quote[0];
      bars[c] = {};
      r.timestamp.forEach(function (t, j) {
        if (q.open[j] && q.close[j]) bars[c][Utilities.formatDate(new Date(t * 1000), 'Asia/Seoul', 'yyyy-MM-dd')] = { o: q.open[j], c: q.close[j] };
      });
    } catch (e) { }
  });
  var done = 0;
  todo.forEach(function (i) {
    var r = v[i], b = bars[r[2]] && bars[r[2]][r[0]];
    if (!b) return;
    var prev = Number(String(r[4]).replace(/,/g, '')), pred = Number(r[5]);
    var openPct = (b.o / prev - 1) * 100, closePct = (b.c / prev - 1) * 100;
    sh.getRange(i + 2, 17, 1, 5).setValues([[Math.round(b.o), r2_(openPct), r2_(pred - openPct), Math.round(b.c), r2_(closePct)]]);
    done++;
  });
  Logger.log('✅ 실제 시가·종가 ' + done + '건 기록');
}

// 월요일 알림에 붙일 지난주 요약 (해외 ETF, 오차 = 예상 − 실제 시가 등락)
function pmWeeklyAccuracy_(ss) {
  if (Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'u')) !== 1) return '';
  var sh = ss.getSheetByName(PM_TAB_LOG);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 19) return '';
  var since = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), 'Asia/Seoul', 'yyyy-MM-dd');
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 19).getDisplayValues().filter(function (r) { return r[0] >= since && r[18] !== '' && Number(r[9]) > 0; });
  if (!v.length) return '';
  var absErr = 0, hit = 0, cnt = 0;
  v.forEach(function (r) {
    var pred = Number(r[5]), act = Number(r[17]);
    absErr += Math.abs(Number(r[18]));
    if (Math.abs(act) >= 0.05) { cnt++; if ((pred >= 0) === (act >= 0)) hit++; }
  });
  return '지난주 정확도: 평균 오차 ' + (absErr / v.length).toFixed(2) + '%p · 방향 적중 ' + (cnt ? Math.round(hit / cnt * 100) : 0) + '% (' + v.length + '건)';
}

// 본체ETF 목록 (MasterData A='본체ETF', H=대분류)
function pmEtfList_(master) {
  return master.getRange(3, 1, master.getLastRow() - 2, 9).getValues()
    .filter(function (r) { return String(r[0]).trim() === '본체ETF' && r[1] && r[2]; })
    .map(function (r) { return { code: String(r[1]).replace(/^KRX:/i, '').trim().toUpperCase(), name: String(r[2]).trim(), group: String(r[7]).trim() }; });
}

// ETF_Quant_Signals 의 기준·베타
function pmParams_(ss) {
  var out = {}, cur = null, sh = ss.getSheetByName(HS_TAB_SIGNAL);
  if (!sh) return out;
  sh.getRange(1, 1, sh.getLastRow(), 4).getValues().forEach(function (r) {
    var a = String(r[0]).trim();
    if (a.indexOf('■') === 0) { cur = hsNormName_(a.replace('■', '')); out[cur] = { buy: HS_DEFAULT_PARAMS.buy, sell: HS_DEFAULT_PARAMS.sell, beta: HS_DEFAULT_PARAMS.beta }; }
    else if (cur && a === '기준') { out[cur].buy = Number(r[2]) || out[cur].buy; out[cur].sell = Number(r[3]) || out[cur].sell; }
    else if (cur && a === '베타') { out[cur].beta = Number(r[2]) || out[cur].beta; }
  });
  return out;
}

// PDF_자동 → { 정규화이름: [{ticker, market, w}] }  (현금 포함 · 파생 제외)
function pmHoldings_(ss) {
  var out = {}, sh = ss.getSheetByName(HS_TAB_PDF);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().forEach(function (r) {
    var w = Number(r[8]) || 0, kind = String(r[6]).trim();
    if (w <= 0 || kind === '파생' || kind === '미확인') return;
    var k = hsNormName_(r[0]);
    (out[k] = out[k] || []).push({ ticker: hsTickerStr_(r[5]), market: kind, w: w });
  });
  return out;
}

// 미국 종목: 가장 최근 미국장 종가 / 그 전날 종가 - 1
//   야후 spark 로 20개씩 묶어 조회(요청 수 1/20) → 빠진 종목만 하나씩 조회. 전체 150초를 넘기면 남은 종목은 '가격 없음'
function pmDailyMoves_(tickers) {
  var out = {}, budget = PM_T0 + 150000;
  var sym = {}; tickers.forEach(function (t) { sym[t] = hsToYahoo_(t)[0]; });
  var groups = [];
  for (var i = 0; i < tickers.length; i += 20) groups.push(tickers.slice(i, i + 20));
  var res = hsFetchAll_(groups.map(function (g) {
    return { url: 'https://query1.finance.yahoo.com/v8/finance/spark?range=5d&interval=1d&symbols=' + encodeURIComponent(g.map(function (t) { return sym[t]; }).join(',')),
      headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
  }));
  groups.forEach(function (g, k) {
    try {
      var j = JSON.parse(res[k].getContentText());
      // 응답 형태 두 가지 모두 처리: { "AAPL": {close:[…]} } 또는 { spark: { result: [{ symbol, response:[{ indicators… }] }] } }
      if (j && j.spark && j.spark.result) {
        var flat = {};
        j.spark.result.forEach(function (r) {
          try { flat[r.symbol] = { close: r.response[0].indicators.quote[0].close }; } catch (e) { }
        });
        j = flat;
      }
      g.forEach(function (t) {
        var d = j[sym[t]];
        var c = d && (d.close || []).filter(function (x) { return x !== null && x > 0; });
        if (c && c.length >= 2) out[t] = c[c.length - 1] / c[c.length - 2] - 1;
      });
    } catch (e) { }
  });
  var miss = tickers.filter(function (t) { return out[t] === undefined; });
  if (miss.length) Logger.log('ℹ️ spark 로 못 받은 ' + miss.length + '개는 하나씩 조회');
  for (var m = 0; m < miss.length && Date.now() < budget; m += 40) {
    var chunk = miss.slice(m, m + 40);
    var r2 = hsFetchAll_(chunk.map(function (t) {
      return { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym[t]) + '?range=5d&interval=1d', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
    }));
    chunk.forEach(function (t, i) {
      try {
        var q = JSON.parse(r2[i].getContentText()).chart.result[0].indicators.quote[0];
        var c = (q.close || []).filter(function (x) { return x !== null && x > 0; });
        if (c.length >= 2) out[t] = c[c.length - 1] / c[c.length - 2] - 1;
      } catch (e) { }
    });
  }
  if (Date.now() >= budget) Logger.log('⚠️ 시간 초과 방지: 일부 종목 가격 없이 계산 (야후 응답 지연)');
  return out;
}

// 선물: 미국 정규장 마감(뉴욕 16:00) 시점 대비 지금
function pmFuturesInfo_(sym) {
  try {
    var r = pmChart_(sym, '5d', '5m');
    var ts = r.timestamp, c = r.indicators.quote[0].close;
    var ref = null, now = null;
    for (var i = 0; i < ts.length; i++) {
      if (c[i] === null) continue;
      now = c[i];
      var hm = Utilities.formatDate(new Date(ts[i] * 1000), 'America/New_York', 'HH:mm');
      if (hm >= '15:50' && hm <= '15:55') ref = c[i]; // 15:55 봉의 종가 ≈ 16:00
    }
    return { ref: ref, now: now, delta: ref && now ? now / ref - 1 : 0 };
  } catch (e) { Logger.log('⚠️ 선물 ' + sym + ' 조회 실패: ' + e); return { ref: null, now: null, delta: 0 }; }
}

function pmFuturesAll_() {
  var out = {};
  PM_FUT_ROWS.forEach(function (f) { out[f.key] = pmFuturesInfo_(f.sym); });
  return out;
}

// 대시보드용: Characteristic 의 선물 행 전일지수(D)에 '미국장 마감 시점 가격'을 값으로 기록 (없으면 행 추가)
function pmUpdateFuturesRows_(info) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PM_TAB_MACRO);
  if (!sh) return;
  var last = sh.getLastRow();
  var v = sh.getRange(1, 1, last, 3).getValues();
  PM_FUT_ROWS.forEach(function (f) {
    var ref = info[f.key] && info[f.key].ref;
    if (!ref) return;
    var row = 0;
    for (var i = 0; i < v.length; i++) if (String(v[i][1]).trim() === f.ticker) { row = i + 1; break; }
    if (!row) {
      row = sh.getLastRow() + 1;
      sh.getRange(row, 1, 1, 5).setValues([['지표', f.ticker, f.name, ref, '=IFERROR(GET_YAHOO_FUTURES("' + f.sym + '", "price"), D' + row + ')']]);
      v.push(['지표', f.ticker, f.name]);
    } else {
      sh.getRange(row, 4).setValue(ref);
    }
  });
  // EWY 행: D=미국장 시가 · E=종가 · C=갱신 날짜 (대시보드가 오늘 날짜일 때만 개장 전 국내 종목에 반영)
  var ewy = info.EWY;
  if (ewy && ewy.open > 0) {
    var erow = 0;
    for (var j = 0; j < v.length; j++) if (String(v[j][1]).trim() === 'EWY') { erow = j + 1; break; }
    if (!erow) erow = sh.getLastRow() + 1;
    sh.getRange(erow, 1, 1, 5).setValues([['지표', 'EWY', '한국ETF 미국장 ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'), ewy.open, ewy.close]]);
  }
}

// EWY(미국 상장 한국 ETF) 가장 최근 미국장 시가 → 종가
function pmEwyInfo_() {
  try {
    var r = pmChart_('EWY', '5d', '1d'), q = r.indicators.quote[0];
    for (var i = r.timestamp.length - 1; i >= 0; i--) {
      if (q.open[i] > 0 && q.close[i] > 0) return { open: q.open[i], close: q.close[i], delta: q.close[i] / q.open[i] - 1 };
    }
  } catch (e) { Logger.log('⚠️ EWY 조회 실패: ' + e); }
  return { open: 0, close: 0, delta: 0 };
}

function pmVix_() {
  try { return pmChart_('^VIX', '5d', '1d').meta.regularMarketPrice || 0; } catch (e) { return 0; }
}

// 원/달러: 어제(마지막 국내 영업일) 15:30 대비 지금
function pmFxSinceKrClose_() {
  try {
    var r = pmChart_('KRW=X', '5d', '15m');
    var ts = r.timestamp, c = r.indicators.quote[0].close;
    var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    var ref = null, now = null;
    for (var i = 0; i < ts.length; i++) {
      if (c[i] === null) continue;
      now = c[i];
      var d = new Date(ts[i] * 1000);
      var day = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'), hm = Utilities.formatDate(d, 'Asia/Seoul', 'HH:mm');
      var dow = Number(Utilities.formatDate(d, 'Asia/Seoul', 'u'));
      if (day < today && dow <= 5 && hm <= '15:30') ref = c[i];
    }
    return ref && now ? now / ref - 1 : 0;
  } catch (e) { Logger.log('⚠️ 환율 조회 실패: ' + e); return 0; }
}

// ETF 전일 종가 (야후 → 실패 시 MasterData E열)
function pmEtfCloses_(etfs, master) {
  var out = {};
  var res = hsFetchAll_(etfs.map(function (e) {
    return { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + e.code + '.KS?range=5d&interval=1d', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
  }));
  etfs.forEach(function (e, i) {
    try {
      var r = JSON.parse(res[i].getContentText()).chart.result[0];
      var c = (r.indicators.quote[0].close || []).filter(function (x) { return x !== null && x > 0; });
      if (c.length) out[e.code] = c[c.length - 1];
    } catch (err) { }
  });
  var v = master.getRange(3, 1, master.getLastRow() - 2, 5).getValues();
  v.forEach(function (r) {
    if (String(r[0]).trim() !== '본체ETF') return;
    var code = String(r[1]).replace(/^KRX:/i, '').trim().toUpperCase();
    if (!out[code] && Number(r[4]) > 0) out[code] = Number(r[4]);
  });
  return out;
}

// 지난밤 미국장이 열렸는지: SPY 마지막 일봉 날짜 = 뉴욕 기준 가장 최근 평일
function pmUsSessionFresh_() {
  try {
    var r = pmChart_('SPY', '5d', '1d');
    var last = r.timestamp[r.timestamp.length - 1];
    var lastDay = Utilities.formatDate(new Date(last * 1000), 'America/New_York', 'yyyy-MM-dd');
    var d = new Date();
    for (var k = 0; k < 7; k++) {
      var dow = Number(Utilities.formatDate(d, 'America/New_York', 'u'));
      var hm = Utilities.formatDate(d, 'America/New_York', 'HH:mm');
      if (dow <= 5 && !(k === 0 && hm < '16:00')) break; // 오늘(뉴욕)이 평일이고 장 마감 후면 오늘이 기대 날짜
      d = new Date(d.getTime() - 864e5);
    }
    return lastDay >= Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd'); // 장중이면 오늘 봉이 있어 더 최근
  } catch (e) { return true; }
}

function pmChart_(sym, range, interval) {
  var res = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + range + '&interval=' + interval,
    { headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true });
  return JSON.parse(res.getContentText()).chart.result[0];
}

function pmPct_(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

// =========================================================
// 기록 · 메시지
// =========================================================
function pmWriteLog_(ss, rows, fut, fx) {
  var sh = ss.getSheetByName(PM_TAB_LOG);
  if (!sh) {
    sh = ss.insertSheet(PM_TAB_LOG);
    sh.getRange(1, 1, 1, PM_LOG_HEADER.length).setValues([PM_LOG_HEADER]);
    sh.setFrozenRows(1);
  }
  var out = rows.map(function (r) {
    return [r.date, r.name, r.code, r.group, r.close, Math.round(r.pct * 100) / 100, r.price, r.signal, Math.round(r.usRet * 100) / 100,
      Math.round(r.usShare), r.futKey, Math.round(r.fut * 100) / 100, Math.round(r.fx * 100) / 100, Math.round(r.foreignShare), r.beta, r.buy + ' / ' + r.sell];
  });
  // 같은 날짜를 다시 실행하면(테스트 후 07:30 실행 등) 그날 기록을 지우고 새로 씀 → 오차 통계 중복 방지
  var day = out.length ? out[0][0] : '';
  if (day && sh.getLastRow() > 1) {
    var dates = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (var i = dates.length - 1; i >= 0; i--) if (dates[i][0] === day) sh.deleteRow(i + 2);
  }
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, out.length, 1).setNumberFormat('@'); // 날짜는 글자로 (비교·조회용)
  sh.getRange(start, 3, out.length, 1).setNumberFormat('@');
  sh.getRange(start, 1, out.length, 16).setValues(out);
}

// 카톡 텍스트 1건 200자 제한 → 요약 1건 + ETF 목록 여러 건으로 나눔
function pmKakaoMessages_(rows, fut, fx, today, usNote) {
  var d = Utilities.formatDate(new Date(), 'Asia/Seoul', 'M/d') + '(' + '월화수목금토일'.charAt(Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'u')) - 1) + ')';
  var sorted = rows.filter(function (r) { return r.hasPdf && !r.domestic; }).sort(function (a, b) { return b.pct - a.pct; });
  var sig = rows.filter(function (r) { return r.signal === 'BUY' || r.signal === 'SELL'; });
  var head = '🌅 ' + d + ' 개장 전 예상\n' +
    '선물(마감후) 나스닥 ' + pmPct_(fut.NQ * 100) + ' S&P ' + pmPct_(fut.ES * 100) + '\n' +
    '원/달러 ' + pmPct_(fx * 100) + (usNote ? ' · ' + usNote : '') + '\n' +
    (sig.length ? '신호: ' + sig.map(function (r) { return (r.signal === 'BUY' ? '🔵' : '🔴') + pmShort_(r.name); }).join(', ') : '신호: 모두 HOLD');
  var msgs = [head.slice(0, PM_KAKAO_MAX)];

  var lines = sorted.map(function (r) {
    var mark = r.signal === 'BUY' ? '🔵' : (r.signal === 'SELL' ? '🔴' : (r.pct >= 0 ? '▲' : '▼'));
    // 종목명 등락% 전일종가→오늘예상가
    return mark + pmShort_(r.name) + ' ' + pmPct_(r.pct) + ' ' + (r.close ? Math.round(r.close).toLocaleString() : '-') + '→' + (r.price ? r.price.toLocaleString() : '-');
  });
  var dom = rows.filter(function (r) { return r.domestic || !r.hasPdf; });
  if (dom.length) lines.push('🇰🇷국내 ' + dom.length + '개는 장중 계산(대시보드)');
  var buf = '';
  lines.forEach(function (l) {
    if ((buf + '\n' + l).length > PM_KAKAO_MAX) { msgs.push(buf); buf = l; }
    else buf = buf ? buf + '\n' + l : l;
  });
  if (buf) msgs.push(buf);
  return msgs;
}

// 이름 줄이기 (카톡 글자 수 절약)
function pmShort_(name) {
  return String(name).replace(/데일리/g, '').replace(/커버드콜|커브드콜/g, 'CC').replace(/액티브/g, 'A').replace(/\s+/g, '')
    .replace(/^KODEX/, 'KD').replace(/^TIGER/, 'TG').replace(/^KIWOOM/, 'KW').replace(/^HANARO/, 'HN').replace(/미국/g, '美');
}

// =========================================================
// 카카오톡 나에게 보내기
// =========================================================
function kakaoAuthUrl() {
  var p = PropertiesService.getScriptProperties();
  var key = p.getProperty('KAKAO_REST_KEY'), uri = p.getProperty('KAKAO_REDIRECT_URI');
  if (!key || !uri) throw new Error('스크립트 속성에 KAKAO_REST_KEY, KAKAO_REDIRECT_URI 를 먼저 넣어주세요.');
  Logger.log('아래 주소를 브라우저에서 열고 동의 → 이동한 주소의 code= 뒤 값을 스크립트 속성 KAKAO_AUTH_CODE 에 저장하세요:\n' +
    'https://kauth.kakao.com/oauth/authorize?client_id=' + key + '&redirect_uri=' + encodeURIComponent(uri) + '&response_type=code&scope=talk_message');
}

function kakaoExchangeCode() {
  var p = PropertiesService.getScriptProperties();
  var payload = { grant_type: 'authorization_code', client_id: p.getProperty('KAKAO_REST_KEY'), redirect_uri: p.getProperty('KAKAO_REDIRECT_URI'), code: p.getProperty('KAKAO_AUTH_CODE') };
  if (p.getProperty('KAKAO_CLIENT_SECRET')) payload.client_secret = p.getProperty('KAKAO_CLIENT_SECRET');
  var res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', { method: 'post', payload: payload, muteHttpExceptions: true });
  var j = JSON.parse(res.getContentText());
  if (!j.refresh_token) throw new Error('토큰 발급 실패: ' + res.getContentText() + '\n(인가 코드는 1회용·10분 유효 → kakaoAuthUrl 부터 다시)');
  p.setProperty('KAKAO_REFRESH_TOKEN', j.refresh_token);
  p.setProperty('KAKAO_ACCESS_TOKEN', j.access_token);
  p.deleteProperty('KAKAO_AUTH_CODE');
  Logger.log('✅ 카카오 토큰 저장 완료 (리프레시 토큰은 매일 자동 연장). 이제 kakaoTest 를 실행해 보세요.');
}

function kakaoTest() { kakaoSendToMe_('✅ DJ ETF 알림 연결 테스트'); Logger.log('카톡을 확인하세요.'); }

var PM_KAKAO_TOKEN_CACHE = null;
function kakaoAccessToken_() {
  if (PM_KAKAO_TOKEN_CACHE) return PM_KAKAO_TOKEN_CACHE;
  var p = PropertiesService.getScriptProperties();
  var payload = { grant_type: 'refresh_token', client_id: p.getProperty('KAKAO_REST_KEY'), refresh_token: p.getProperty('KAKAO_REFRESH_TOKEN') };
  if (!payload.refresh_token) throw new Error('카카오 토큰이 없어요. kakaoAuthUrl → kakaoExchangeCode 를 먼저 실행하세요.');
  if (p.getProperty('KAKAO_CLIENT_SECRET')) payload.client_secret = p.getProperty('KAKAO_CLIENT_SECRET');
  var j = JSON.parse(UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', { method: 'post', payload: payload, muteHttpExceptions: true }).getContentText());
  if (!j.access_token) throw new Error('카카오 토큰 갱신 실패: ' + JSON.stringify(j) + ' → kakaoAuthUrl 부터 다시 진행');
  if (j.refresh_token) p.setProperty('KAKAO_REFRESH_TOKEN', j.refresh_token); // 만료 1개월 전부터 새 토큰이 옴
  PM_KAKAO_TOKEN_CACHE = j.access_token;
  return j.access_token;
}

// 사진 메시지 (링크가 열리려면 카카오 앱 > 플랫폼 > Web 사이트 도메인에 https://djseok.github.io 등록 필요)
function kakaoSendFeed_(title, desc, imageUrl, viewUrl, w, h) {
  var link = { web_url: viewUrl || imageUrl, mobile_web_url: viewUrl || imageUrl };
  var content = { title: String(title).slice(0, 60), description: String(desc).slice(0, 190), image_url: imageUrl, link: link };
  if (w && h) { content.image_width = w; content.image_height = h; } // 세로로 긴 사진이 덜 잘리게 크기 알려줌
  var tpl = {
    object_type: 'feed',
    content: content,
    buttons: [{ title: '크게 보기', link: link }, { title: '대시보드', link: { web_url: PM_DASHBOARD_URL, mobile_web_url: PM_DASHBOARD_URL } }]
  };
  var res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'post', headers: { Authorization: 'Bearer ' + kakaoAccessToken_() },
    payload: { template_object: JSON.stringify(tpl) }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('카톡 사진 메시지 실패: ' + res.getContentText());
}

function kakaoSendToMe_(text) {
  var tpl = { object_type: 'text', text: String(text).slice(0, 200), link: { web_url: PM_DASHBOARD_URL, mobile_web_url: PM_DASHBOARD_URL }, button_title: '대시보드' };
  var res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'post', headers: { Authorization: 'Bearer ' + kakaoAccessToken_() },
    payload: { template_object: JSON.stringify(tpl) }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('카톡 발송 실패: ' + res.getContentText());
}
