/**
 * 📈 대시보드 가격 프록시 (웹 앱) — 관리시트 Apps Script
 *
 * 대시보드(js/common.js 의 PRICE_PROXY_URL, ?ticker=티커)가 야후 5년 일봉을 받을 때
 * 브라우저에서 바로 부르면 CORS 로 막혀서 구글 서버가 대신 받아 그대로 돌려줌.
 * 예전 편집기 파일 'mdd' 를 그대로 옮긴 것.
 *
 * ⚠️ 웹 앱은 배포할 때의 버전으로 돌아가요. 이 파일을 고친 뒤에는 편집기
 *    배포 → 배포 관리 → ✏️ → 버전 '새 버전' 으로 바꿔야 반영됩니다 (주소는 그대로).
 */
function doGet(e) {
  var ticker = e.parameter.ticker;
  if (!ticker) {
    return ContentService.createTextOutput(JSON.stringify({ error: "티커가 없습니다." })).setMimeType(ContentService.MimeType.JSON);
  }
  var url = "https://query2.finance.yahoo.com/v8/finance/chart/" + ticker + "?range=5y&interval=1d";
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return ContentService.createTextOutput(response.getContentText()).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
