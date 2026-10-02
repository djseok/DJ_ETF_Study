/**
 * D 전략 매수 계산기 (ISA) — 레버리지 60 / 나스닥 커버드콜 40
 * ---------------------------------------------------------------
 * 계산은 시트 수식이 실시간으로 합니다 (이 스크립트는 메뉴와 기록만 담당).
 *   D_설정    : 종목코드·비중·기준금액·이번 달 입금액 (노란 칸만 매달 입력)
 *   D_보유    : D포토폴리오 수량·평단 + GOOGLEFINANCE 현재가 (수식)
 *   D_매수계획 : 이번 달 살 종목·수량 (수식, 시트를 열면 현재가로 다시 계산)
 *   D_기록    : 메뉴 ② 를 누르면 그달 계획이 한 줄씩 쌓임
 *
 * 원칙: 계산기가 알려준 종목·수량만 매수 / 1천만 원(기본예탁금) 전에는 나스닥CC만 /
 *       분배금·예수금도 매달 같은 규칙으로 재투자 / 매도는 수익 구간에서만.
 *
 * 설치: 개인일기장 → 확장 프로그램 → Apps Script → 이 파일 내용으로 교체 → 저장
 *   → 위쪽 함수 목록에서 dInstallMenu 선택 → [실행] 1회 (권한 허용) → 시트 새로고침
 *   모든 이름이 d / D_ 로 시작해서 같은 프로젝트의 다른 파일과 겹치지 않음. onOpen()도 쓰지 않음.
 */

const D_SHEET = { CFG: 'D_설정', HOLD: 'D_보유', PLAN: 'D_매수계획', LOG: 'D_기록' };

function dStrategyMenu() {
  SpreadsheetApp.getUi()
    .createMenu('📈 D 전략')
    .addItem('① 이번 달 매수 계획 보기', 'dShowPlan')
    .addItem('② 이번 달 계획 기록 (주문 후)', 'dLogPlan')
    .addToUi();
}

function dShowPlan() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(D_SHEET.PLAN);
  if (!sh) { SpreadsheetApp.getUi().alert('D_매수계획 탭이 없어요.'); return; }
  SpreadsheetApp.flush();
  ss.setActiveSheet(sh);
  ss.toast('현재가 기준으로 다시 계산했어요. C10:D11 의 수량대로 주문하세요.', 'D 전략', 8);
}

function dLogPlan() {
  const ss = SpreadsheetApp.getActive();
  const plan = ss.getSheetByName(D_SHEET.PLAN);
  if (!plan) { SpreadsheetApp.getUi().alert('D_매수계획 탭이 없어요.'); return; }
  SpreadsheetApp.flush();
  const v = plan.getRange('A1:G25').getValues();
  const phase = v[20][1], total = v[3][1], cash = v[6][1];
  const levSh = v[9][2], levAmt = v[9][3], nccSh = v[10][2], nccAmt = v[10][3], left = v[11][3], levW = v[9][5];
  const ui = SpreadsheetApp.getUi();
  const memo = ui.prompt('메모 (선택)', '예: 계획대로 체결 / 일부 미체결 등', ui.ButtonSet.OK_CANCEL);
  if (memo.getSelectedButton() !== ui.Button.OK) return;
  let log = ss.getSheetByName(D_SHEET.LOG);
  if (!log) {
    log = ss.insertSheet(D_SHEET.LOG);
    log.appendRow(['기록일시', '단계', '계좌 총자산', '투입 현금', '레버리지 매수(주)', '레버리지 금액',
                   '나스닥CC 매수(주)', '나스닥CC 금액', '남는 현금', '매수 후 레버리지 비중', '메모']);
  }
  log.appendRow([new Date(), phase, total, cash, levSh, levAmt, nccSh, nccAmt, left, levW, memo.getResponseText()]);
  ss.toast('D_기록에 남겼어요.', 'D 전략', 5);
}

// 메뉴 등록: 기존 onOpen()과 충돌하지 않도록 '설치형 트리거'를 씀. 편집기에서 한 번만 실행.
function dInstallMenu() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dStrategyMenu')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dStrategyMenu').forSpreadsheet(ss).onOpen().create();
  ss.toast('D 전략 메뉴를 등록했어요. 시트를 새로고침하세요.', 'D 전략', 8);
}
