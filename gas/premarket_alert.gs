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
 *   6) installPremarketTrigger 실행 → 매일 07시대 자동 (토·일 제외)
 */

var PM_TAB_LOG = '개장전_예측';
var PM_DASHBOARD_URL = 'https://djseok.github.io/DJ_ETF_Study/';
var PM_KAKAO_MAX = 190; // 카카오 텍스트 메시지 1건 최대 200자

function previewPremarket() { runPremarket_(true); }
function sendPremarketAlert() { runPremarket_(false); }

function installPremarketTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'premarketDaily_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('premarketDaily_').timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  Logger.log('✅ 평일 아침 7시 30분대 개장 전 예상가 알림 트리거 설치');
}

function premarketDaily_() {
  var dow = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'u')); // 1=월 … 7=일
  if (dow >= 6) return;
  runPremarket_(false);
}

// =========================================================
// 계산
// =========================================================
function runPremarket_(dryRun) {
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
  var usMove = pmDailyMoves_(Object.keys(usTickers).concat(['SPY']));
  var usNote = '';
  if (!pmUsSessionFresh_()) { usMove = {}; usNote = '미국 휴장 → 종목 등락 0'; Logger.log('ℹ️ 지난밤 미국장 휴장으로 보고 종목 등락을 0으로 계산'); }

  // 선물 · 환율 · ETF 전일 종가
  var fut = { NQ: pmFuturesSinceClose_('NQ=F'), ES: pmFuturesSinceClose_('ES=F'), YM: pmFuturesSinceClose_('YM=F') };
  var fx = pmFxSinceKrClose_();
  var etfClose = pmEtfCloses_(etfs, master);

  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var rows = [];
  etfs.forEach(function (e) {
    var hs = holdings[hsNormName_(e.name)] || [];
    var p = params[hsNormName_(e.name)] || { buy: HS_DEFAULT_PARAMS.buy, sell: HS_DEFAULT_PARAMS.sell, beta: HS_DEFAULT_PARAMS.beta };
    var wAll = 0, wUsPriced = 0, wForeign = 0, usDelta = 0, wMissing = 0;
    hs.forEach(function (h) {
      wAll += h.w;
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
    var futKey = /S&P|S＆P/i.test(e.name) ? 'ES' : (/다우/.test(e.name) ? 'YM' : 'NQ');
    var f = fut[futKey] || 0;
    var ret = (1 + p.beta * usRet * usShare) * (1 + p.beta * f * usShare) * (1 + fx * foreignShare) - 1;
    var close = etfClose[e.code] || 0;
    var price = close ? Math.round(close * (1 + ret)) : 0;
    var pct = ret * 100;
    var signal = hs.length === 0 ? '-' : (pct <= p.buy ? 'BUY' : (pct >= p.sell ? 'SELL' : 'HOLD'));
    rows.push({
      date: today, name: e.name, code: e.code, group: e.group, close: close, pct: pct, price: price, signal: signal,
      usRet: usRet * 100, usShare: usShare * 100, fut: f * 100, futKey: futKey, fx: fx * 100, foreignShare: foreignShare * 100,
      beta: p.beta, buy: p.buy, sell: p.sell, domestic: usShare === 0, hasPdf: hs.length > 0, missing: wMissing
    });
  });

  // 로그
  Logger.log('선물(마감 후) NQ ' + pmPct_(fut.NQ * 100) + ' · ES ' + pmPct_(fut.ES * 100) + ' · YM ' + pmPct_(fut.YM * 100) + ' | 원/달러 ' + pmPct_(fx * 100));
  rows.forEach(function (r) {
    Logger.log((r.signal === 'BUY' ? '🔵' : r.signal === 'SELL' ? '🔴' : '⚪') + ' ' + r.name + ' ' + pmPct_(r.pct) + ' → ' + (r.price ? r.price.toLocaleString() + '원' : '종가?') +
      ' [' + r.signal + '] (미국 ' + pmPct_(r.usRet) + ' × 비중 ' + r.usShare.toFixed(0) + '% · ' + r.futKey + ' 선물 ' + pmPct_(r.fut) + ' · β' + r.beta +
      (r.missing > 0.5 ? ' · 가격없음 ' + r.missing.toFixed(1) + '%' : '') + ')');
  });
  var msgs = pmKakaoMessages_(rows, fut, fx, today, usNote);
  Logger.log('카톡 ' + msgs.length + '건:\n' + msgs.join('\n---\n'));
  if (dryRun) { Logger.log('[미리보기] 카톡·시트에 쓰지 않았어요.'); return; }

  pmWriteLog_(ss, rows, fut, fx);
  msgs.forEach(function (m) { kakaoSendToMe_(m); Utilities.sleep(400); });
  Logger.log('✅ 카톡 발송 완료');
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
function pmDailyMoves_(tickers) {
  var out = {};
  var res = hsFetchAll_(tickers.map(function (t) {
    return { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(hsToYahoo_(t)[0]) + '?range=5d&interval=1d', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
  }));
  tickers.forEach(function (t, i) {
    try {
      var r = JSON.parse(res[i].getContentText()).chart.result[0];
      var c = (r.indicators.quote[0].close || []).filter(function (x) { return x !== null && x > 0; });
      if (c.length >= 2) out[t] = c[c.length - 1] / c[c.length - 2] - 1;
    } catch (e) { }
  });
  return out;
}

// 선물: 미국 정규장 마감(뉴욕 16:00) 시점 대비 지금
function pmFuturesSinceClose_(sym) {
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
    return ref && now ? now / ref - 1 : 0;
  } catch (e) { Logger.log('⚠️ 선물 ' + sym + ' 조회 실패: ' + e); return 0; }
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
    return lastDay === Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
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
    sh.getRange(1, 1, 1, 16).setValues([['날짜', 'ETF', '코드', '대분류', '전일종가', '예상등락(%)', '예상가', '신호', '미국종목등락(%)', '미국비중(%)', '선물', '선물변동(%)', '환율변동(%)', '해외비중(%)', '베타', '기준(매수/매도)']]);
    sh.setFrozenRows(1);
  }
  var out = rows.map(function (r) {
    return [r.date, r.name, r.code, r.group, r.close, Math.round(r.pct * 100) / 100, r.price, r.signal, Math.round(r.usRet * 100) / 100,
      Math.round(r.usShare), r.futKey, Math.round(r.fut * 100) / 100, Math.round(r.fx * 100) / 100, Math.round(r.foreignShare), r.beta, r.buy + ' / ' + r.sell];
  });
  var start = sh.getLastRow() + 1;
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
    return mark + pmShort_(r.name) + ' ' + pmPct_(r.pct) + ' ' + (r.price ? r.price.toLocaleString() : '-');
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

function kakaoSendToMe_(text) {
  var tpl = { object_type: 'text', text: String(text).slice(0, 200), link: { web_url: PM_DASHBOARD_URL, mobile_web_url: PM_DASHBOARD_URL }, button_title: '대시보드' };
  var res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'post', headers: { Authorization: 'Bearer ' + kakaoAccessToken_() },
    payload: { template_object: JSON.stringify(tpl) }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('카톡 발송 실패: ' + res.getContentText());
}
