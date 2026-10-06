/**
 * 📋 ETF 구성종목 시트 함수 + '🤖 퀀트 봇' 메뉴 — 관리시트 Apps Script
 *
 * 예전에 편집기에만 있던 Code · ETF_NOW · auto 세 파일(같은 함수가 세 벌씩 겹쳐 있었음)을 하나로 합친 것.
 * 겹칠 때 실제로 쓰이던 쪽(마지막 파일 auto, 에프엔가이드는 ETF_NOW)과 똑같이 동작해요.
 *   · 시트 수식: 'ETF 구성종목가져오기' A1 =getETFholdingsByWiseReport(F1)
 *   · 메뉴: 시트를 열면 위쪽에 '🤖 퀀트 봇' → 지금 보는 탭의 6자리 ETF 코드 아래 종목 비중을 최신으로 덮어씀
 * 매일 자동 수집은 etf_holdings_sync.gs(syncHoldings, 06시)가 따로 해요. 이 파일은 손으로 쓰는 도구.
 */

/**
 * ETF 구성종목 (와이즈리포트 기본, 'fnguide' 를 주면 에프엔가이드 상위 10개)
 * @param {string} code ETF 종목코드 6자리
 * @param {string} provider 'wisefn'(기본) 또는 'fnguide'
 * @customfunction
 */
function getETFholdings(code, provider) {
  if (!provider) provider = "wisefn";
  switch (String(provider).toLowerCase()) {
    case "fnguide": return getETFholdingsByFnguide(code);
    default: return getETFholdingsByWiseReport(code);
  }
}

/**
 * ETF 구성종목 전체 (와이즈리포트): 이름 줄, 머리글, 순번·종목명·주식수·구성비율·기준일
 * @param {string} code ETF 종목코드 6자리
 * @customfunction
 */
function getETFholdingsByWiseReport(code) {
  var url = 'https://navercomp.wisereport.co.kr/v2/ETF/index.aspx?cmp_cd=' + code;
  var html = UrlFetchApp.fetch(url).getContentText();
  var searchstring = 'var CU_data = ';
  var ETFarr = [];
  var index = html.search(searchstring);

  if (index >= 0) {
    var v = html.substring(index + searchstring.length).split(";")[0];
    var r = /var summary_data = {\"CMP_KOR\":\"(.+?)\",\"URL\"/g.exec(html);
    var giname = r ? r[1] : code;
    var arr = JSON.parse(v)["grid_data"];
    ETFarr.push([giname, "", "", "", ""]);
    ETFarr.push(["순번", "종목명", "주식수", "구성비율", "기준일"]);
    if (arr) {
      for (var i = 0; i < arr.length; i++) {
        var weight = arr[i].ETF_WEIGHT;
        if (weight == null || weight === "") { // 비중 칸 이름이 바뀌었을 때 대비
          var keys = Object.keys(arr[i]);
          for (var k = 0; k < keys.length; k++) {
            var upperKey = keys[k].toUpperCase();
            if (upperKey.indexOf('WGT') !== -1 || upperKey.indexOf('WEIGHT') !== -1 || upperKey.indexOf('RT') !== -1) { weight = arr[i][keys[k]]; break; }
          }
        }
        weight = (weight == null || weight === "") ? "" : weight + "%";
        ETFarr.push([i + 1, arr[i].STK_NM_KOR, arr[i].AGMT_STK_CNT, weight, arr[i].TRD_DT]);
      }
    }
  }
  return ETFarr;
}

/**
 * ETF 상위 10개 구성종목 (에프엔가이드): 이름 줄, 머리글, 순번·종목명·구성비율
 * @param {string} code ETF 종목코드 6자리
 * @customfunction
 */
function getETFholdingsByFnguide(code) {
  var url = 'http://comp.fnguide.com/svo2/asp/etf_snapshot.asp?pGB=1&cID=&MenuYn=Y&ReportGB=&NewMenuID=401&stkGb=770&gicode=A' + code;
  var html = UrlFetchApp.fetch(url).getContentText();
  var searchstring = 'var DataTop10 = ';
  var ETFarr = [];
  var index = html.search(searchstring);
  var r = /var giname = '(.+)';/g.exec(html);
  var giname = r ? r[1].replace("&nbsp;", " ").replace("&nbsp;", " ") : code;

  if (index >= 0) {
    var v = html.substring(index + searchstring.length).split(";")[0];
    var arr = JSON.parse(v)["01"];
    ETFarr.push(giname);
    ETFarr.push(["순번", "종목명", "구성비율"]);
    if (arr) {
      for (var i = 0; i < arr.length; i++) {
        var weight = arr[i].FUND_RT;
        weight = (weight !== undefined && weight !== null && weight !== "") ? weight + "%" : "";
        ETFarr.push([arr[i].RANK, arr[i].ITEM_NM, weight]);
      }
    }
  }
  return ETFarr;
}

// ── '🤖 퀀트 봇' 메뉴 ─────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🤖 퀀트 봇')
    .addItem('⚡ ETF 비중 실시간 업데이트 (클릭)', 'runAutoUpdate')
    .addToUi();
}

// 지금 보는 탭: 6자리 ETF 코드가 있는 줄을 만나면 그 ETF 구성종목을 받아 두고, 아래 종목 줄의 비중 칸만 최신 값으로
function runAutoUpdate() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var ui = SpreadsheetApp.getUi();
  var currentETFData = null, updateCount = 0;
  var nameColIdx = 1, weightColIdx = 3; // 머리글을 찾으면 그 칸으로 바뀜

  ui.toast("크롤링을 시작합니다. ETF 개수에 따라 10~20초 정도 소요됩니다.", "🤖 퀀트 봇");

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    for (var c = 0; c < row.length; c++) {
      var cellVal = String(row[c]).replace(/\s+/g, '');
      if (cellVal.includes("종목명") || cellVal === "구성종목명" || cellVal === "구성종목") nameColIdx = c;
      if (cellVal.includes("비중") || cellVal.includes("구성비율")) weightColIdx = c;
    }

    var foundCode = false;
    for (var c2 = 0; c2 < row.length; c2++) {
      var cellText = String(row[c2]).trim();
      if (/^\d{6}$/.test(cellText) || /^[A-Z0-9]{6}$/.test(cellText)) {
        Logger.log(cellText + " 코드 발견! 크롤링 시작...");
        currentETFData = parseCrawledData(getETFholdings(cellText, "wisefn"));
        foundCode = true;
        break;
      }
    }
    if (foundCode) continue;

    var stockName = String(row[nameColIdx]).trim();
    if (currentETFData && stockName && !stockName.includes("종목") && !stockName.includes("합계")) {
      var newWeight = findWeight(currentETFData, stockName);
      if (newWeight !== null) {
        sheet.getRange(i + 1, weightColIdx + 1).setValue(newWeight);
        updateCount++;
      }
    }
  }
  ui.alert("✅ 업데이트 완료!\n총 " + updateCount + "개 하위 종목의 비중(%)이 최신화되었습니다.");
}

// 와이즈리포트 결과 → { 공백 뺀 소문자 종목명: 비중(0~1) }
function parseCrawledData(rawArr) {
  var dict = {};
  for (var i = 2; i < rawArr.length; i++) {
    if (rawArr[i].length >= 4) {
      var sName = String(rawArr[i][1]).replace(/\s+/g, '').toLowerCase();
      var numWeight = parseFloat(String(rawArr[i][3]).replace(/[^0-9.]/g, '')) / 100;
      if (!isNaN(numWeight)) dict[sName] = numWeight;
    }
  }
  return dict;
}

// 이름이 같거나 한쪽이 다른 쪽을 포함하면 그 비중
function findWeight(dict, stockName) {
  var cleanName = String(stockName).replace(/\s+/g, '').toLowerCase();
  for (var key in dict) {
    if (key.includes(cleanName) || cleanName.includes(key)) return dict[key];
  }
  return null;
}
