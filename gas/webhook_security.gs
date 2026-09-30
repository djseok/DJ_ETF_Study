/**
 * 🔐 배당 봇 Webhook 토큰 검사 (배당 봇이 기록하는 시트의 Apps Script에 추가)
 *
 * 배당 봇(scraper.py)이 데이터를 보내는 Apps Script 웹앱 주소는 예전에 public 저장소에 올라가 있었습니다.
 * 주소만 알면 누구나 시트에 가짜 배당 기록을 넣을 수 있으므로,
 * "토큰(비밀번호)을 함께 보낸 요청만 기록"하도록 바꿉니다.
 *
 * 적용 순서는 gas/README.md 의 [배당 봇 Webhook 보안] 을 따라주세요. (순서가 바뀌면 봇이 하루 멈출 수 있어요)
 */

// ① 토큰 만들기 — 처음 한 번 실행하면 스크립트 속성에 저장하고 로그에 한 번 보여줍니다
function setupWebhookToken() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('WEBHOOK_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('WEBHOOK_TOKEN', token);
    Logger.log('✅ 새 토큰을 만들었어요.');
  } else {
    Logger.log('이미 토큰이 있어요. 기존 토큰을 보여줍니다.');
  }
  Logger.log('GitHub Secret "WEBHOOK_TOKEN" 에 아래 값을 그대로 넣으세요:');
  Logger.log(token);
}

// ② 토큰 확인 도우미 — doPost / doGet 맨 앞에서 사용
function isWebhookAuthorized_(token) {
  var saved = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
  return !!saved && token === saved;
}

function unauthorizedResponse_() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/*
 * ③ 기존 doPost / doGet 맨 앞에 아래 줄을 추가 (기존 코드는 그대로 두고 첫 줄로만 넣으면 됩니다)
 *
 * function doPost(e) {
 *   var body = JSON.parse(e.postData.contents);
 *   if (!isWebhookAuthorized_(body.token)) return unauthorizedResponse_();   // ← 추가
 *   ... 기존 코드 ...
 * }
 *
 * function doGet(e) {
 *   if (e.parameter.action === 'tiger' && !isWebhookAuthorized_(e.parameter.token)) return unauthorizedResponse_(); // ← 추가
 *   ... 기존 코드 ...
 * }
 *   (doGet 이 다른 용도로도 쓰일 수 있어서, 배당 봇이 쓰는 action=tiger 요청만 검사합니다)
 *
 * ⚠️ 이미 doPost 안에서 JSON.parse(e.postData.contents) 를 하고 있다면,
 *    그 변수 이름(예: data)을 그대로 써서  if (!isWebhookAuthorized_(data.token)) return unauthorizedResponse_();
 *    처럼 한 줄만 넣으면 됩니다.
 */
