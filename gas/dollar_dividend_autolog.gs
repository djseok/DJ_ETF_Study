/**
 * 💵 1달러 프로젝트 받은 달러 배당 자동 기록 — 관리시트 Apps Script (새 파일로 추가)
 *
 * 매일 아침 한 번:
 *   ① 개인일기장 '1달러 마스터 포토폴리오' A~E(이름 · 티커 · 수량)를 '1달러_보유수량_기록' 탭에 저장 (바뀐 것만)
 *   ② 토스뱅크 시트의 티커 탭(배당락일 · 주당 배당금$, GET_DIVIDENDS)을 보고, 어제까지 배당락일이 지난 배당을
 *      "배당락일 아침 보유수량 × 주당 배당금 × 0.85(미국 원천징수 15%)" 로 계산해
 *      '1달러 마스터 포토폴리오' J~L(이름 · 티커 · 누적배당금$)의 해당 줄 L열에 더함 (줄이 없으면 아래에 새 줄)
 *   ③ 더한 내역은 '1달러_배당자동기록' 탭에 남김 → 같은 배당을 두 번 더하지 않음
 *
 * - 수량 기록이 시작되기 전 배당락일은 건드리지 않음 → 그 전 J~L 값(수기)은 그대로
 * - 실제 토스 입금액과 몇 센트 차이가 날 수 있음 (소수점 수량 · 환전 시점 차이)
 * - 자동 기록을 켠 뒤로는 J~L에 손으로 더하지 않기 (두 번 더해짐)
 *
 * ▶ 처음 한 번
 *   1) previewDollarDividends 실행 → 무엇을 기록할지 로그로 확인 (시트에 쓰지 않음)
 *   2) syncDollarDividends 실행 → 오늘 보유수량 저장 (첫날은 더할 배당 없음)
 *   3) installDollarDividendTrigger 실행 → 매일 아침 8시대 자동
 */

var DD_TOSS_ID = '1Z7XSHt-m1SarM41hqN97e3Pj7L3K1msx4vYFy6aD2q4';   // 토스뱅크_동진_자동화시스템 (티커 탭 = GET_DIVIDENDS)
var DD_DIARY_ID = '1nVnpen14YDDWRxODwt36HVlG7GId-zKzFIyQYn9p7vY';  // 동진ETF공부_개인일기장
var DD_PORT_TAB = '1달러 마스터 포토폴리오';
var DD_SNAP_TAB = '1달러_보유수량_기록';
var DD_LOG_TAB = '1달러_배당자동기록';
var DD_US_TAX = 0.15;

function previewDollarDividends() { ddRun_(true); }
function syncDollarDividends() { ddRun_(false); }

function installDollarDividendTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncDollarDividends') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncDollarDividends').timeBased().everyDays(1).atHour(8).inTimezone('Asia/Seoul').create();
  Logger.log('✅ 매일 아침 8시대에 syncDollarDividends 가 실행돼요.');
}

// ---------------------------------------------------------
function ddRun_(dryRun) {
  var diary = SpreadsheetApp.openById(DD_DIARY_ID);
  var port = diary.getSheetByName(DD_PORT_TAB);
  if (!port || port.getLastRow() < 2) { Logger.log('⚠️ ' + DD_PORT_TAB + ' 탭을 못 찾음'); return; }
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var data = port.getRange(1, 1, port.getLastRow(), 12).getValues();

  // ① 오늘 보유수량 (A열 이름이 비어 있으면 위 줄 이름을 이어 씀 — 1달러 탭 화면과 같은 규칙)
  var cur = {}, member = '';
  data.slice(1).forEach(function (r) {
    var m = ddMember_(r[0]);
    if (m) member = m;
    var t = String(r[1] || '').trim().toUpperCase();
    if (!member || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) return;
    var k = member + '|' + t;
    cur[k] = (cur[k] || 0) + ddNum_(r[4]);
  });

  var snap = diary.getSheetByName(DD_SNAP_TAB);
  var hist = {}; // "이름|티커" → [[날짜, 수량], ...] 날짜순
  if (snap && snap.getLastRow() >= 2) snap.getRange(2, 1, snap.getLastRow() - 1, 4).getValues().forEach(function (r) {
    var d = ddIso_(r[0]), k = ddMember_(r[1]) + '|' + String(r[2]).trim().toUpperCase();
    if (d) (hist[k] = hist[k] || []).push([d, ddNum_(r[3])]);
  });
  Object.keys(hist).forEach(function (k) { hist[k].sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); });
  var snapRows = [];
  Object.keys(cur).concat(Object.keys(hist)).forEach(function (k) {
    if (snapRows.some(function (x) { return x[1] + '|' + x[2] === k; })) return;
    var h = hist[k], last = h && h.length ? h[h.length - 1][1] : null, q = cur[k] || 0;
    if (last === null ? q > 0 : Math.abs(last - q) > 1e-9) {
      snapRows.push([today, k.split('|')[0], k.split('|')[1], q]);
      (hist[k] = hist[k] || []).push([today, q]);
    }
  });
  Logger.log((dryRun ? '[미리보기] ' : '') + '📦 보유수량 변경 ' + snapRows.length + '건 저장' + (dryRun ? ' 예정' : ''));

  // ② 배당락일이 지난 배당 → 더할 목록
  var logSheet = diary.getSheetByName(DD_LOG_TAB), done = {};
  if (logSheet && logSheet.getLastRow() >= 2) logSheet.getRange(2, 2, logSheet.getLastRow() - 1, 3).getValues().forEach(function (r) {
    done[ddMember_(r[0]) + '|' + String(r[1]).trim().toUpperCase() + '|' + ddIso_(r[2])] = true;
  });
  var toss = SpreadsheetApp.openById(DD_TOSS_ID), divCache = {}, credits = [];
  Object.keys(hist).forEach(function (k) {
    var t = k.split('|')[1];
    if (!(t in divCache)) {
      var tab = toss.getSheetByName(t);
      divCache[t] = tab && tab.getLastRow() >= 2 ? tab.getRange(2, 1, tab.getLastRow() - 1, 2).getDisplayValues()
        .map(function (r) { return { ex: ddIso_(r[0]), per: ddNum_(r[1]) }; }).filter(function (x) { return x.ex && x.per > 0; }) : null;
      if (!divCache[t]) Logger.log('ℹ️ ' + t + ': 토스뱅크 시트에 배당 탭이 없어 건너뜀');
    }
    (divCache[t] || []).forEach(function (d) {
      if (d.ex >= today || done[k + '|' + d.ex]) return;          // 배당락일 다음 날부터 · 이미 더한 것 제외
      var q = null;
      hist[k].forEach(function (h) { if (h[0] <= d.ex) q = h[1]; }); // 배당락일 아침(또는 그 전) 마지막 기록
      if (q === null || !(q > 0)) return;                          // 기록 시작 전이거나 보유 안 함
      credits.push({ member: k.split('|')[0], ticker: t, ex: d.ex, qty: q, per: d.per,
        net: Math.round(q * d.per * (1 - DD_US_TAX) * 10000) / 10000 });
    });
  });
  credits.sort(function (a, b) { return a.ex < b.ex ? -1 : 1; });
  credits.forEach(function (c) {
    Logger.log((dryRun ? '[미리보기] ' : '') + '💵 ' + c.member + ' ' + c.ticker + ' 배당락 ' + c.ex + ': ' + c.qty + '주 × $' + c.per + ' × 0.85 = $' + c.net);
  });
  if (!credits.length) Logger.log('💵 새로 더할 달러 배당 없음');
  if (dryRun) return;

  // 쓰기: 수량 기록 → J~L 누적 → 자동기록 로그
  if (snapRows.length) {
    if (!snap) { snap = diary.insertSheet(DD_SNAP_TAB); snap.appendRow(['기록일', '이름', '티커', '수량']); snap.setFrozenRows(1); }
    snap.getRange(snap.getLastRow() + 1, 1, snapRows.length, 4).setValues(snapRows);
  }
  if (!credits.length) return;
  var jl = data.map(function (r) { return [r[9], r[10], r[11]]; }), lastJ = 0, add = {};
  jl.forEach(function (r, i) { if (String(r[0]).trim() || String(r[1]).trim()) lastJ = i + 1; });
  credits.forEach(function (c) {
    var key = c.member + '|' + c.ticker;
    add[key] = (add[key] || 0) + c.net;
  });
  Object.keys(add).forEach(function (key) {
    var m = key.split('|')[0], t = key.split('|')[1], row = 0;
    for (var i = 1; i < jl.length; i++) {
      if (ddMember_(jl[i][0]) === m && String(jl[i][1]).trim().toUpperCase() === t) { row = i + 1; break; }
    }
    if (row) port.getRange(row, 12).setValue(Math.round((ddNum_(jl[row - 1][2]) + add[key]) * 10000) / 10000);
    else { lastJ++; port.getRange(lastJ, 10, 1, 3).setValues([[m, t, Math.round(add[key] * 10000) / 10000]]); }
  });
  if (!logSheet) { logSheet = diary.insertSheet(DD_LOG_TAB); logSheet.appendRow(['기록시각', '이름', '티커', '배당락일', '수량', '주당$', '세후$']); logSheet.setFrozenRows(1); }
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  logSheet.getRange(logSheet.getLastRow() + 1, 1, credits.length, 7).setValues(credits.map(function (c) {
    return [stamp, c.member, c.ticker, c.ex, c.qty, c.per, c.net];
  }));
  Logger.log('✅ 달러 배당 ' + credits.length + '건을 J~L에 더함');
}

function ddMember_(s) { return String(s || '').trim().replace(/님|포트폴리오/g, '').replace(/^이름$/, ''); }
function ddNum_(v) { var n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; }
function ddIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  var m = String(v || '').trim().match(/^(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}
