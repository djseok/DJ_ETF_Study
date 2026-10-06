/**
 * 📈 야후 파이낸스 시세 사용자 함수 — 관리시트 Apps Script (편집기 파일 이름: 지수)
 *
 *   =GET_YAHOO_FUTURES("NQ=F", "price")       현재가
 *   =GET_YAHOO_FUTURES("285A.T", "prevClose") 전일 종가 ("closeyest" 도 같은 뜻)
 *
 * 조회에 실패하면 글자 대신 오류를 내서 IFERROR(…, 대체값) 이 작동하게 합니다.
 *   (예전에는 "통신 에러" · "데이터 없음" 글자를 돌려줘 IFERROR 를 지나쳤고, 대시보드는 이를 0 으로 읽어
 *    나스닥 선물 −100% 같은 값이 나왔음)
 * 실패할 때마다 시간 · 티커 · 이유를 스크립트 속성에 모아 두고, 매일 06:20 선물 기준가 갱신 때
 * '야후_조회_실패' 탭에 옮겨 적습니다. (사용자 함수는 시트에 직접 쓸 수 없어서)
 */

var YF_FAIL_PROP = 'YF_FAIL_LOG';
var YF_FAIL_TAB = '야후_조회_실패';
var YF_FAIL_MAX = 200;

/**
 * 야후 파이낸스 현재가 · 전일 종가
 * @param {string} ticker 야후 티커 (예: NQ=F, ^KS200, 285A.T)
 * @param {string} type "price" (현재가) 또는 "prevClose" / "closeyest" (전일 종가)
 * @return 가격
 * @customfunction
 */
function GET_YAHOO_FUTURES(ticker, type) {
  if (!ticker) throw new Error('티커 없음');
  var t = String(type || 'price');
  var key = t === 'price' ? 'regularMarketPrice' : (t === 'prevClose' || t === 'closeyest' ? 'chartPreviousClose' : '');
  if (!key) throw new Error('type 은 price · prevClose · closeyest 중 하나');

  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) +
    '?region=US&lang=en-US&includePrePost=true&interval=1d&range=1d';
  var reason = '';
  for (var attempt = 0; attempt < 2; attempt++) {
    if (attempt) Utilities.sleep(1000);
    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var code = res.getResponseCode();
      if (code !== 200) { reason = 'HTTP ' + code; continue; }
      var data = JSON.parse(res.getContentText());
      var err = data && data.chart && data.chart.error;
      if (err) { reason = '야후 오류: ' + (err.description || err.code || JSON.stringify(err)); break; }
      var meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
      var v = meta ? Number(meta[key]) : NaN;
      if (v > 0) return v;
      reason = '값 없음 (' + key + '=' + (meta ? meta[key] : '응답에 meta 없음') + ')';
      break;
    } catch (e) {
      reason = '통신 오류: ' + (e && e.message ? e.message : e);
    }
  }
  yfLogFail_(ticker, t, reason);
  throw new Error(ticker + ' ' + reason);
}

// 실패 기록을 스크립트 속성에 쌓음 (기록이 실패해도 본래 오류는 그대로 냄)
function yfLogFail_(ticker, type, reason) {
  try {
    console.warn('야후 조회 실패 ' + ticker + ' ' + type + ' — ' + reason);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return;
    try {
      var p = PropertiesService.getScriptProperties();
      var list = JSON.parse(p.getProperty(YF_FAIL_PROP) || '[]');
      list.push([Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), String(ticker), type, reason]);
      if (list.length > YF_FAIL_MAX) list = list.slice(-YF_FAIL_MAX);
      p.setProperty(YF_FAIL_PROP, JSON.stringify(list));
    } finally { lock.releaseLock(); }
  } catch (e) { }
}

// 쌓인 실패 기록을 '야후_조회_실패' 탭 맨 아래에 옮겨 적고 비움 (선물 기준가 갱신 때 자동, 편집기에서 직접 실행해도 됨)
function yahooFailLogToSheet() {
  var p = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var list;
  try {
    list = JSON.parse(p.getProperty(YF_FAIL_PROP) || '[]');
    p.deleteProperty(YF_FAIL_PROP);
  } finally { lock.releaseLock(); }
  if (!list.length) return 0;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(YF_FAIL_TAB);
  if (!sh) {
    sh = ss.insertSheet(YF_FAIL_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['시간(KST)', '티커', '종류', '이유']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.getRange(sh.getLastRow() + 1, 1, list.length, 4).setValues(list);
  return list.length;
}
