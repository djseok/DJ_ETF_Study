// 📌 토스뱅크_동진_자동화시스템 시트에 묶인 Apps Script (편집기 파일 이름 'Code', gas/deploy.json 의 toss)
//    티커 탭 A1 =GET_DIVIDENDS("MSTY") → 배당락일·주당 배당금($) 표. dollar_dividend_autolog.gs · 대시보드 1달러 탭이 이 결과를 읽어요.
/**
 * 야후 파이낸스 배당금 전체 이력 추출기 V2.1 (순수 숫자 데이터 반환형)
 * 구글 시트 AVERAGE 연산 오류(#DIV/0!) 완벽 해결
 */
function GET_DIVIDENDS(ticker) {
  if (!ticker) return "티커를 입력하세요";
  
  var url = "https://query2.finance.yahoo.com/v8/finance/chart/" + ticker + "?interval=1d&events=div&period1=0&period2=2000000000";
  
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    
    if (response.getResponseCode() === 200) {
      var json = JSON.parse(response.getContentText());
      var result = [["배당락일", "주당 배당금($)"]]; 
      
      if (json.chart && json.chart.result && json.chart.result[0].events && json.chart.result[0].events.dividends) {
        var divData = json.chart.result[0].events.dividends;
        
        var divArray = Object.keys(divData).map(function(key) {
          return divData[key];
        });
        
        divArray.sort(function(a, b) {
          return b.date - a.date;
        });
        
        divArray.forEach(function(item) {
          var date = new Date(item.date * 1000);
          var year = date.getFullYear();
          var month = ("0" + (date.getMonth() + 1)).slice(-2);
          var day = ("0" + date.getDate()).slice(-2);
          
          // [핵심 교정] toFixed를 제거하고 pure Number로 전달해야 시트가 숫자로 인식합니다!
          var amount = Number(item.amount); 
          
          result.push([year + "-" + month + "-" + day, amount]);
        });
        
        return result;
      } else {
        return [["알림", "해당 종목의 배당 이력이 없습니다."]];
      }
    } else {
      return [["서버 오류", "상태코드: " + response.getResponseCode()]];
    }
  } catch (e) {
    return [["시스템 오류", e.message]];
  }
}