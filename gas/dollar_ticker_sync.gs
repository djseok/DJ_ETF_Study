/**
 * 💵 1달러 프로젝트 새 미국 티커 자동 등록 — 관리시트 Apps Script (새 파일로 추가)
 *
 * 개인일기장 '1달러 마스터 포토폴리오' B열에 새 미국 티커를 적으면,
 * '토스뱅크_동진_자동화시스템' 시트에
 *   ① 티커 이름의 탭 (A1 =GET_DIVIDENDS("티커") · C2 최근 4회 평균) 과
 *   ② '관리종목' 맨 아래 줄 (주가 · 분배금 · 1달러 효율 수식, 기존 줄과 같은 모양) 을 만들어
 * 1달러 탭과 대시보드 배당 카드에 주가·분배금이 자동으로 들어가게 합니다.
 *   - 이름은 1달러 탭 C열(한글 이름)을 씀. 비어 있으면 야후 영문 이름
 *   - L '구매제한' · M '소수점가능' 은 X · O 기본값 → 다르면 손으로 고치기
 *   - 이미 있는 줄·탭은 건드리지 않음
 *
 * ▶ 따로 실행할 필요 없음: 매일 06시 syncHoldings 끝에 같이 돌아감 (previewHoldings 는 미리보기만)
 *   직접 돌려 보려면 previewDollarTickers → syncDollarTickers
 */

var DT_TOSS_ID = '1Z7XSHt-m1SarM41hqN97e3Pj7L3K1msx4vYFy6aD2q4';   // 토스뱅크_동진_자동화시스템 (대시보드 DOLLAR_MASTER)
var DT_DIARY_ID = '1nVnpen14YDDWRxODwt36HVlG7GId-zKzFIyQYn9p7vY';  // 동진ETF공부_개인일기장
var DT_PORT_TAB = '1달러 마스터 포토폴리오';
var DT_LIST_TAB = '관리종목';

function previewDollarTickers() { dtSync_(true); }
function syncDollarTickers() { dtSync_(false); }

function dtSync_(dryRun) {
  var port = SpreadsheetApp.openById(DT_DIARY_ID).getSheetByName(DT_PORT_TAB);
  if (!port || port.getLastRow() < 2) { Logger.log('⚠️ 1달러: ' + DT_PORT_TAB + ' 탭을 못 찾음'); return; }
  var want = {}, order = [];
  port.getRange(2, 1, port.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
    var t = String(r[1]).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) return; // 미국 티커 모양만 (빈칸·한글·제목 줄 제외)
    if (!(t in want)) { want[t] = String(r[2]).trim(); order.push(t); }
    else if (!want[t]) want[t] = String(r[2]).trim();
  });

  var toss = SpreadsheetApp.openById(DT_TOSS_ID);
  var list = toss.getSheetByName(DT_LIST_TAB);
  if (!list) { Logger.log('⚠️ 1달러: 토스뱅크 시트에 ' + DT_LIST_TAB + ' 탭이 없음'); return; }
  var have = {};
  if (list.getLastRow() >= 3) list.getRange(3, 2, list.getLastRow() - 2, 1).getDisplayValues().forEach(function (r) {
    var t = String(r[0]).trim().toUpperCase();
    if (t) have[t] = true;
  });
  var missing = order.filter(function (t) { return !have[t]; });
  if (!missing.length) { Logger.log('💵 1달러 관리종목: 새 티커 없음 (' + order.length + '개 모두 등록됨)'); return; }

  // 이름이 비어 있으면 야후 영문 이름 (etf_holdings_sync.gs 의 조회 함수 재사용)
  var blank = missing.filter(function (t) { return !want[t]; });
  if (blank.length && typeof hsLookupEtfNames_ === 'function') {
    hsLookupEtfNames_(blank).forEach(function (x, i) { if (x && x.name) want[blank[i]] = x.name; });
  }

  missing.forEach(function (t) {
    var name = want[t] || t;
    if (dryRun) { Logger.log('[미리보기] 💵 ' + t + ' (' + name + '): 관리종목 줄 + 배당 탭 추가 예정'); return; }
    var tab = toss.getSheetByName(t);
    if (!tab) {
      tab = toss.insertSheet(t, toss.getSheets().length);
      tab.getRange('A1').setFormula('=GET_DIVIDENDS("' + t + '")');
      tab.getRange('C2').setFormula('=AVERAGE(B2:B5)');
    }
    var row = list.getLastRow() + 1;
    var ref = "'" + t.replace(/'/g, "''") + "'";
    list.getRange(row, 2, 1, 13).setValues([[
      t, /^[=+\-@]/.test(name) ? "'" + name : name,
      '=IFERROR(GOOGLEFINANCE($B' + row + ',"closeyest"), 0)',
      '=' + ref + '!C2',
      '=E' + row + '*$A$2',
      '=E' + row + ' / D' + row,
      '=G' + row + '*$A$2',
      '=RANK(G' + row + ', $G$3:$G$99)',
      '=G' + row + '*5',
      '=J' + row + '*$A$2',
      'X', 'O',
      '=K' + row + '*0.85'
    ]]);
    Logger.log('💵 ' + t + ' (' + name + '): 관리종목 ' + row + '행 + 배당 탭 추가. 구매제한 X · 소수점가능 O 기본값이니 다르면 L·M열 고쳐 주세요' +
      (row > 99 ? ' ⚠️ 99행을 넘어 1달러 효율 순위(RANK $G$3:$G$99)에서 빠짐' : ''));
  });
}
