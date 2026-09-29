/**
 * 💰 배당금 간편 입력 폼 (동진ETF공부_개인일기장 시트용 Apps Script)
 *
 * 멤버가 휴대폰에서 구글 폼으로 배당 입금을 적으면,
 * 그 멤버의 "○포토폴리오" 탭 H~L열(이름·수령일자·종목·당시수량·실수령액) 빈 줄에 자동으로 기록합니다.
 * "마스터 포토폴리오" 탭은 수식이 각 멤버 탭을 모아 보여주므로 대시보드에 바로 반영됩니다.
 *
 * ▶ 처음 한 번만:
 *   1) 스프레드시트 [확장 프로그램] → [Apps Script] 에 이 파일 내용을 붙여넣고 저장
 *   2) 함수 선택에서 createDividendForm 을 고르고 [실행] → 권한 허용
 *   3) 실행 로그에 나오는 "멤버 공유용 링크"를 단톡방에 공유
 *
 * ▶ 종목을 새로 샀거나 멤버가 늘었을 때:
 *   refreshFormChoices 를 한 번 실행하면 폼의 이름·종목 목록이 시트 기준으로 갱신됩니다.
 *   (createDividendForm 실행 시 매일 새벽 자동 갱신도 함께 설정됩니다)
 */

// 기록할 스프레드시트: 동진ETF공부_개인일기장
// (시트에서 [확장 프로그램 → Apps Script]로 열었든, script.google.com에서 따로 만들었든 동작하도록 ID로 지정)
var SPREADSHEET_ID = '1nVnpen14YDDWRxODwt36HVlG7GId-zKzFIyQYn9p7vY';

// 모아보기용 탭이라 멤버 목록에서 제외할 탭 이름
var EXCLUDED_TABS = ['마스터 포토폴리오', '1달러 마스터 포토폴리오'];
var TAB_SUFFIX = '포토폴리오';

var Q_NAME = '이름';
var Q_DATE = '수령일자';
var Q_STOCK = '종목';
var Q_QTY = '당시수량 (비우면 현재 보유수량으로 기록)';
var Q_AMOUNT = '실수령액 (원)';

// ---------------------------------------------------------
// 1. 폼 만들기 (처음 한 번만 실행)
// ---------------------------------------------------------
function createDividendForm() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('DIVIDEND_FORM_ID');
  if (existingId) {
    try {
      var existing = FormApp.openById(existingId);
      Logger.log('이미 만든 폼이 있어요. 목록만 갱신합니다.');
      refreshFormChoices();
      Logger.log('멤버 공유용 링크: ' + existing.getPublishedUrl());
      return;
    } catch (e) {
      // 폼이 삭제된 경우 새로 만듭니다
    }
  }

  var form = FormApp.create('💰 배당금 입금 기록 (동진 투자 공부실)');
  form.setDescription('증권사 앱에서 배당금 입금을 확인하면 여기에 적어주세요. 30초면 끝나요!');
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('기록 완료! 대시보드 [배당] 탭에 곧 반영돼요 🐕');

  form.addListItem().setTitle(Q_NAME).setRequired(true);
  form.addDateItem().setTitle(Q_DATE).setHelpText('통장에 입금된 날짜').setRequired(true);
  form.addListItem().setTitle(Q_STOCK).setRequired(true);
  form.addTextItem().setTitle(Q_QTY)
    .setValidation(FormApp.createTextValidation().requireNumber().build());
  form.addTextItem().setTitle(Q_AMOUNT).setHelpText('세금 떼기 전/후 상관없이 평소 적던 방식 그대로')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation().requireNumber().build());

  props.setProperty('DIVIDEND_FORM_ID', form.getId());

  // 폼 제출 시 시트에 기록하는 트리거
  ScriptApp.newTrigger('onDividendFormSubmit').forForm(form).onFormSubmit().create();
  // 매일 새벽 4시 이름·종목 목록 자동 갱신
  ScriptApp.newTrigger('refreshFormChoices').timeBased().everyDays(1).atHour(4).create();

  refreshFormChoices();
  Logger.log('✅ 폼을 만들었어요.');
  Logger.log('멤버 공유용 링크: ' + form.getPublishedUrl());
  Logger.log('폼 편집 링크(동진님용): ' + form.getEditUrl());
}

// ---------------------------------------------------------
// 2. 이름·종목 선택지를 시트 기준으로 갱신
// ---------------------------------------------------------
function refreshFormChoices() {
  var form = getDividendForm_();
  var members = getMemberTabs_();
  var stocks = {};

  members.forEach(function (m) {
    var last = m.sheet.getLastRow();
    if (last < 2) return;
    m.sheet.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) {
      var s = String(r[0] || '').trim();
      if (s) stocks[s] = true;
    });
  });

  var stockList = Object.keys(stocks).sort();
  stockList.push('기타 (목록에 없음)');

  form.getItems(FormApp.ItemType.LIST).forEach(function (item) {
    var list = item.asListItem();
    if (item.getTitle() === Q_NAME) list.setChoiceValues(members.map(function (m) { return m.name; }));
    if (item.getTitle() === Q_STOCK) list.setChoiceValues(stockList);
  });
  Logger.log('선택지 갱신: 멤버 ' + members.length + '명, 종목 ' + (stockList.length - 1) + '개');
}

// ---------------------------------------------------------
// 3. 폼 제출 → 해당 멤버 탭 H~L 빈 줄에 기록
// ---------------------------------------------------------
function onDividendFormSubmit(e) {
  var answers = {};
  e.response.getItemResponses().forEach(function (r) {
    answers[r.getItem().getTitle()] = r.getResponse();
  });

  var name = String(answers[Q_NAME] || '').trim();
  var stock = String(answers[Q_STOCK] || '').trim();
  var amount = Number(String(answers[Q_AMOUNT] || '').replace(/[^0-9.-]/g, ''));
  var qtyRaw = String(answers[Q_QTY] || '').replace(/[^0-9.-]/g, '');
  var dateParts = String(answers[Q_DATE] || '').split('-'); // 폼 날짜 응답은 "YYYY-MM-DD"
  var date = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));

  var sheet = getSpreadsheet_().getSheetByName(name + TAB_SUFFIX);
  if (!sheet) throw new Error('탭을 찾을 수 없어요: ' + name + TAB_SUFFIX);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 두 명이 동시에 제출해도 같은 줄에 겹쳐 쓰지 않도록
  try {
    var qty = qtyRaw === '' ? findHoldingQty_(sheet, stock) : Number(qtyRaw);
    var row = findNextEmptyLogRow_(sheet);
    sheet.getRange(row, 8, 1, 5).setValues([[name, date, stock, qty, amount]]);
    sheet.getRange(row, 9).setNumberFormat('yyyy. m. d');
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------
// 내부 도우미
// ---------------------------------------------------------
function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getDividendForm_() {
  var id = PropertiesService.getScriptProperties().getProperty('DIVIDEND_FORM_ID');
  if (!id) throw new Error('먼저 createDividendForm 을 실행해 주세요.');
  return FormApp.openById(id);
}

function getMemberTabs_() {
  return getSpreadsheet_().getSheets()
    .filter(function (s) {
      var n = s.getName();
      return n.slice(-TAB_SUFFIX.length) === TAB_SUFFIX && EXCLUDED_TABS.indexOf(n) === -1;
    })
    .map(function (s) { return { name: s.getName().slice(0, -TAB_SUFFIX.length), sheet: s }; });
}

// H열(이름)과 I열(수령일자)이 모두 비어 있는 첫 줄 (2행부터)
function findNextEmptyLogRow_(sheet) {
  var last = Math.max(sheet.getLastRow(), 2);
  var values = sheet.getRange(2, 8, last - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === '' && values[i][1] === '') return i + 2;
  }
  return last + 1;
}

// 수량을 비워두면 이 멤버 탭의 현재 보유수량(E열)으로 채움
function findHoldingQty_(sheet, stock) {
  var last = sheet.getLastRow();
  if (last < 2) return '';
  var key = stock.replace(/\s+/g, '').toUpperCase();
  var rows = sheet.getRange(2, 2, last - 1, 4).getValues(); // B~E
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).replace(/\s+/g, '').toUpperCase() === key) return Number(rows[i][3]) || '';
  }
  return '';
}
