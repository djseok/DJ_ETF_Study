/**
 * 💸 실수령 배당 자동 기록 — "배당 입력 폼" Apps Script 프로젝트에 새 파일로 추가
 *
 * ① 매일 밤: 멤버 탭(D포토폴리오, S포토폴리오 …)의 종목별 보유수량을 '보유수량_기록' 탭에 저장 (바뀐 것만)
 * ② 매일 아침: 관리시트 'ETF들 배당이력'(지급일 · 1주당 분배금 · 기준일)을 보고,
 *    지급일이 된 분배금을 "기준일 당시 보유수량 × 1주당 분배금"으로 계산해 멤버 탭 H~L열에 기록 (M열 '자동')
 *
 * - 금액은 지금까지 적어온 방식과 같은 세전 금액
 * - 같은 종목의 기록이 지급일 ±5일 안에 이미 있으면(수기·자동 모두) 건너뜀
 * - 폼으로 수기 입력하면 같은 종목·비슷한 날짜의 자동 기록을 수기 값으로 바꿈 (dividend_form.gs)
 * - 'ETF 배당주기'에 없는 종목(분배금 자동 수집 안 됨)은 기록하지 않음 → 지금처럼 폼으로 입력
 *
 * ▶ 처음 한 번
 *   1) snapshotHoldings 실행 → 오늘 보유수량 저장 (보유수량_기록 탭 생성)
 *   2) previewDividendAutoLog 실행 → 기록될 내용 미리보기 (시트에 쓰지 않음)
 *   3) installDividendAutoLogTriggers 실행 → 매일 밤 11시대 수량 저장, 매일 아침 8시대 기록
 */

var AL_DIARY_ID = '1nVnpen14YDDWRxODwt36HVlG7GId-zKzFIyQYn9p7vY';   // 동진ETF공부_개인일기장
var AL_MANAGE_ID = '1r91WUqYvIfQ1jrehEKiBPUbO7a0iH7iIl3tgNsZoKRc';  // 관리시트
var AL_SNAPSHOT_TAB = '보유수량_기록';
var AL_HISTORY_TAB = 'ETF들 배당이력';
var AL_MEMBER_SUFFIX = '포토폴리오';
var AL_EXCLUDED = ['마스터 포토폴리오', '1달러 마스터 포토폴리오'];
var AL_AUTO_MARK = '자동';
// 첫 수량 기록을 이 날짜부터 유효한 것으로 봄 (자동 기록 시작 직전 지급분까지 챙기기 위해).
// 이 날짜 이전 기준일의 분배금은 자동 기록하지 않음 → 그 전 기록은 지금처럼 수기
var AL_SEED_FROM = '2026-09-25';

// ---------------------------------------------------------
// ① 보유수량 저장
// ---------------------------------------------------------
function snapshotHoldings() {
  var ss = SpreadsheetApp.openById(AL_DIARY_ID);
  var snap = ss.getSheetByName(AL_SNAPSHOT_TAB);
  if (!snap) {
    snap = ss.insertSheet(AL_SNAPSHOT_TAB);
    snap.appendRow(['기록일', '이름', '종목', '수량']);
    snap.setFrozenRows(1);
  }
  var latest = latestSnapshot_(snap);           // "이름|종목" → 수량
  var isFirst = Object.keys(latest).length === 0;
  var today = isFirst ? alDate_(AL_SEED_FROM) : alToday_();
  var current = {}, rows = [];

  alMemberTabs_(ss).forEach(function (m) {
    var last = m.sheet.getLastRow();
    if (last < 2) return;
    m.sheet.getRange(2, 1, last - 1, 5).getValues().forEach(function (r) {
      var stock = String(r[1] || '').trim();
      if (!stock) return;
      var key = m.name + '|' + alNorm_(stock);
      current[key] = (current[key] || 0) + (Number(String(r[4]).replace(/[^0-9.-]/g, '')) || 0);
      if (!current[key + '#name']) current[key + '#name'] = stock;
    });
  });
  Object.keys(current).forEach(function (key) {
    if (key.indexOf('#name') > 0) return;
    if (latest[key] === undefined ? current[key] !== 0 : latest[key] !== current[key]) {
      rows.push([today, key.split('|')[0], current[key + '#name'], current[key]]);
    }
  });
  // 멤버 탭에서 사라진 종목 → 0주로 기록
  Object.keys(latest).forEach(function (key) {
    if (key.indexOf('#name') > 0) return;
    if (current[key] === undefined && latest[key] !== 0) rows.push([today, key.split('|')[0], latest[key + '#name'] || key.split('|')[1], 0]);
  });
  if (rows.length) {
    snap.getRange(snap.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    snap.getRange(2, 1, snap.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd');
  }
  Logger.log('보유수량 ' + (isFirst ? '첫 기록(' + AL_SEED_FROM + '부터 유효)' : '변경') + ' ' + rows.length + '건 저장');
}

// ---------------------------------------------------------
// ② 실수령 자동 기록
// ---------------------------------------------------------
function recordDividendsAuto() { return runAutoLog_(false); }
function previewDividendAutoLog() { return runAutoLog_(true); }

function runAutoLog_(dryRun) {
  var diary = SpreadsheetApp.openById(AL_DIARY_ID);
  var snap = diary.getSheetByName(AL_SNAPSHOT_TAB);
  if (!snap || snap.getLastRow() < 2) { Logger.log('먼저 snapshotHoldings 를 실행해 주세요.'); return; }
  var history = snapshotHistory_(snap);         // "이름|종목" → [{date, qty}] 날짜순
  var seedFrom = alDate_(AL_SEED_FROM);
  var today = alToday_();

  // 1주당 분배금 기록 (지급일, 금액, 기준일) — 종목별
  var divs = {};
  var hs = SpreadsheetApp.openById(AL_MANAGE_ID).getSheetByName(AL_HISTORY_TAB);
  hs.getRange(1, 1, hs.getLastRow(), 4).getValues().forEach(function (r) {
    if (!r[0] || !(r[1] instanceof Date) || !(r[3] instanceof Date)) return; // 기준일 없는 수기 기록은 제외
    var k = alNorm_(r[0]);
    (divs[k] = divs[k] || []).push({ pay: r[1], rec: r[3], amt: Number(r[2]) || 0 });
  });

  var planned = [];
  alMemberTabs_(diary).forEach(function (m) {
    var logs = memberLogs_(m.sheet);
    Object.keys(history).forEach(function (key) {
      var parts = key.split('|');
      if (parts[0] !== m.name) return;
      var stockKey = parts[1];
      (divs[stockKey] || []).forEach(function (d) {
        if (d.pay > today || d.rec < seedFrom || d.amt <= 0) return;           // 아직 지급 전 / 자동 기록 시작 전
        var qty = qtyAt_(history[key], entitlementDate_(d.rec));
        if (qty === null || qty <= 0) return;                                   // 그때 수량을 모름 / 보유 안 함
        var dup = logs.some(function (l) { return l.stock === stockKey && Math.abs(l.date - d.pay) <= 5 * 864e5; });
        if (dup) return;
        var name = history[key].displayName;
        planned.push({ sheet: m.sheet, member: m.name, row: [m.name, d.pay, name, qty, Math.round(qty * d.amt)], rec: d.rec, amt: d.amt });
        logs.push({ stock: stockKey, date: d.pay });
      });
    });
  });

  planned.forEach(function (p) {
    Logger.log((dryRun ? '[미리보기] ' : '✅ ') + p.member + ' | ' + alFmt_(p.row[1]) + ' | ' + p.row[2] + ' | ' + p.row[3] + '주 × ' + p.amt + '원 = ' + p.row[4] + '원 (기준일 ' + alFmt_(p.rec) + ')');
    if (dryRun) return;
    var r = alNextEmptyLogRow_(p.sheet);
    p.sheet.getRange(r, 8, 1, 5).setValues([p.row]);
    p.sheet.getRange(r, 9).setNumberFormat('yyyy. m. d');
    p.sheet.getRange(r, 13).setValue(AL_AUTO_MARK);
  });
  Logger.log((dryRun ? '미리보기: ' : '완료: ') + planned.length + '건');
}

function installDividendAutoLogTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'snapshotHoldings' || f === 'recordDividendsAuto') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('snapshotHoldings').timeBased().everyDays(1).atHour(23).inTimezone('Asia/Seoul').create();
  ScriptApp.newTrigger('recordDividendsAuto').timeBased().everyDays(1).atHour(8).inTimezone('Asia/Seoul').create();
  Logger.log('✅ 매일 밤 11시대 보유수량 저장, 매일 아침 8시대 실수령 자동 기록');
}

// ---------------------------------------------------------
// 도우미
// ---------------------------------------------------------
function alMemberTabs_(ss) {
  return ss.getSheets().filter(function (s) {
    var n = s.getName();
    return n.slice(-AL_MEMBER_SUFFIX.length) === AL_MEMBER_SUFFIX && AL_EXCLUDED.indexOf(n) === -1;
  }).map(function (s) { return { name: s.getName().slice(0, -AL_MEMBER_SUFFIX.length), sheet: s }; });
}

function snapshotHistory_(snap) {
  var map = {};
  snap.getRange(2, 1, snap.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (!(r[0] instanceof Date) || !r[1] || !r[2]) return;
    var key = r[1] + '|' + alNorm_(r[2]);
    (map[key] = map[key] || []).push({ date: r[0], qty: Number(r[3]) || 0 });
    map[key].displayName = String(r[2]);
  });
  Object.keys(map).forEach(function (k) { map[k].sort(function (a, b) { return a.date - b.date; }); });
  return map;
}

function latestSnapshot_(snap) {
  var latest = {};
  if (snap.getLastRow() < 2) return latest;
  var h = snapshotHistory_(snap);
  Object.keys(h).forEach(function (k) { latest[k] = h[k][h[k].length - 1].qty; latest[k + '#name'] = h[k].displayName; });
  return latest;
}

// 그 날짜에 보유하던 수량 (그 전 마지막 기록). 첫 기록보다 이전이면 모름(null)
function qtyAt_(list, date) {
  var q = null;
  for (var i = 0; i < list.length; i++) { if (list[i].date <= date) q = list[i].qty; else break; }
  return q;
}

// 분배금을 받으려면 기준일 2영업일 전까지 매수(T+2 결제) → 그 날 기준 보유수량을 사용
function entitlementDate_(rec) {
  var d = new Date(rec.getFullYear(), rec.getMonth(), rec.getDate()), n = 0;
  while (n < 2) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return d;
}

function memberLogs_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 8, last - 1, 3).getValues().map(function (r) {
    var date = r[1] instanceof Date ? r[1] : alParseKoDate_(r[1]);
    return date && r[2] ? { stock: alNorm_(r[2]), date: date } : null;
  }).filter(Boolean);
}

function alNextEmptyLogRow_(sheet) {
  var last = Math.max(sheet.getLastRow(), 2);
  var v = sheet.getRange(2, 8, last - 1, 2).getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === '' && v[i][1] === '') return i + 2;
  return last + 1;
}

function alNorm_(s) { return String(s || '').replace(/\s+/g, '').toUpperCase().replace(/커브드/g, '커버드'); }
function alToday_() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function alDate_(iso) { var p = iso.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function alFmt_(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function alParseKoDate_(s) {
  var p = String(s || '').replace(/\s+/g, '').replace(/\.$/, '').split(/[.\-\/]/);
  return p.length >= 3 ? new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) : null;
}
