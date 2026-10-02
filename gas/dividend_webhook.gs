/**
 * 📥 배당 봇 Webhook (동진_웹송출용_마스터시트 Apps Script 의 Code.gs 원본 사본)
 * - doPost : 배당 봇(scraper.py)이 보낸 배당 기록을 DB_종목 탭과 마스터데이터 탭에 기록 (토큰 필요)
 * - doGet  : action=tiger → 미래에셋 TIGER 분배 내역을 대신 조회해서 봇에 전달 (토큰 필요)
 * 배포: 배포 관리 → 기존 배포(AKfycbyQ65…) → 새 버전  /  토큰 함수는 webhook_security.gs
 * 이 파일을 고치면 Apps Script 쪽에도 똑같이 반영하고 새 버전으로 배포해야 합니다.
 */
// 1️⃣ [V18.1 실전 엔진] 개별 DB 기입 + 마스터데이터 연동 (기존과 동일)
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    if (!isWebhookAuthorized_(params.token)) return unauthorizedResponse_(); // 🔐 토큰이 맞는 요청만 기록
    const etfName = params.etfName;       
    const code = params.code;             
    const recordDate = params.recordDate; 
    const payDate = params.payDate;       
    const dividend = Number(params.dividend);
    const taxBase = Number(params.taxBase);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dbSheetName = "DB_" + etfName;
    let dbSheet = ss.getSheetByName(dbSheetName);

    if (!dbSheet) {
      dbSheet = ss.insertSheet(dbSheetName);
      dbSheet.appendRow(["지급기준일", "실지급일", "당일 종가", "1주당 실지급 배당금", "1주당 과세표준액"]);
      dbSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#D9E1F2");
      SpreadsheetApp.flush(); 
    }

    // 마스터데이터 줄은 '중복' 응답보다 먼저 확인 → 줄이 빠져도 다음 봇 실행 때 스스로 채워짐
    ensureMasterRow_(ss, etfName, code, dbSheetName);

    const lastRow = dbSheet.getLastRow();
    if (lastRow >= 2) {
      const existingDates = dbSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < existingDates.length; i++) {
        if (!existingDates[i][0]) continue;
        let exDate = Utilities.formatDate(new Date(existingDates[i][0]), "GMT+9", "yyyy-MM-dd");
        if (exDate === recordDate) {
          return ContentService.createTextOutput(JSON.stringify({"status": "duplicate", "message": "이미 기록된 데이터입니다."})).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }

    const newRow = lastRow + 1;
    const formulaC = `=IFERROR(INDEX(GOOGLEFINANCE("KRX:${code}", "close", WORKDAY(A${newRow}+1, -1)), 2, 2), "")`;
    dbSheet.appendRow([recordDate, payDate, "", dividend, taxBase]);
    dbSheet.getRange(newRow, 3).setFormula(formulaC);

    return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "성공"})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// 마스터데이터 탭에 종목 줄이 없으면 추가 (시세 실패 시 DB_ 탭의 '가장 최근' 종가로 대체)
function ensureMasterRow_(ss, etfName, code, dbSheetName) {
    const masterSheetName = "마스터데이터";
    let masterSheet = ss.getSheetByName(masterSheetName);

    if (!masterSheet) {
      masterSheet = ss.insertSheet(masterSheetName);
      masterSheet.appendRow(["종목명", "현재가", "최소 배당금", "평균 배당금", "최대 배당금", "평균 과세표준"]);
      masterSheet.getRange("A1:F1").setFontWeight("bold").setBackground("#FFF2CC");
      masterSheet.setFrozenRows(1);
      SpreadsheetApp.flush();
    }

    const masterLastRow = masterSheet.getLastRow();
    let isExistInMaster = false;
    if (masterLastRow >= 1) { 
      const masterNames = masterSheet.getRange(1, 1, masterLastRow, 1).getValues();
      for (let i = 0; i < masterNames.length; i++) {
        if (masterNames[i][0] === etfName) {
          isExistInMaster = true;
          break;
        }
      }
    }

    if (!isExistInMaster) {
      const safeSheetName = `'${dbSheetName}'`; 
      const formulaPrice = `=IFERROR(GOOGLEFINANCE("KRX:${code}", "price"), IFERROR(LOOKUP(2, 1/(${safeSheetName}!C2:C<>""), ${safeSheetName}!C2:C), 0))`;
      const formulaMin = `=IFERROR(MIN(${safeSheetName}!D:D), 0)`;
      const formulaAvg = `=IFERROR(AVERAGE(${safeSheetName}!D:D), 0)`;
      const formulaMax = `=IFERROR(MAX(${safeSheetName}!D:D), 0)`;
      const formulaAvgTax = `=IFERROR(AVERAGE(${safeSheetName}!E:E), 0)`;

      masterSheet.appendRow([etfName, formulaPrice, formulaMin, formulaAvg, formulaMax, formulaAvgTax]);
    }
}

// 2️⃣ [NEW] 구글 서버를 활용한 TIGER IP 차단 우회 프록시 통로
function doGet(e) {
  // 깃허브 로봇이 TIGER 데이터를 요청할 경우 구글이 대신 다녀옵니다.
  if (e.parameter.action === 'tiger' && e.parameter.code) {
    if (!isWebhookAuthorized_(e.parameter.token)) return unauthorizedResponse_(); // 🔐 배당 봇만 사용
    const months = Math.min(Number(e.parameter.months) || 12, 36);
    const result = { resultList: fetchTigerDistributions_(e.parameter.code, months) };
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  
  // 기존 네이버 API 우회 (유지)
  if (e.parameter.action === 'fetch' && e.parameter.code) {
    const url = "https://m.stock.naver.com/api/stock/" + e.parameter.code + "/dividend";
    const options = { "method": "get", "muteHttpExceptions": true };
    const response = UrlFetchApp.fetch(url, options);
    return ContentService.createTextOutput(response.getContentText()).setMimeType(ContentService.MimeType.JSON);
  }
}

// 3️⃣ TIGER 분배 내역 조회 (2026-09 미래에셋 사이트 개편 대응)
// - 새 조회 주소 list.ajax 는 종목코드(q) + 연도·월이 꼭 필요하고, 결과를 표(HTML)로 돌려줌
// - 최근 N개월을 한꺼번에(fetchAll) 조회해서 봇이 쓰던 예전 JSON 형식으로 바꿔 돌려줌
function fetchTigerDistributions_(code, months) {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const base = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/";

  // 목록 페이지를 먼저 열어 세션 쿠키 받기
  const page = UrlFetchApp.fetch(base + "list.do", { muteHttpExceptions: true, headers: { "User-Agent": UA } });
  const cookies = [].concat(page.getAllHeaders()["Set-Cookie"] || []).map(function (c) { return c.split(";")[0]; }).join("; ");

  const requests = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    requests.push({
      url: base + "list.ajax", method: "post", muteHttpExceptions: true,
      payload: { pageIndex: "1", firstIndex: "0", listCnt: "20", orderC: "", orderType: "", orderB: "",
                 selectYear: String(d.getFullYear()), selectMonth: String(d.getMonth() + 1), q: code },
      headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Cookie": cookies, "Referer": base + "list.do" }
    });
  }

  const list = [];
  const seen = {};
  UrlFetchApp.fetchAll(requests).forEach(function (res) {
    if (res.getResponseCode() !== 200) return;
    (res.getContentText().match(/<tr[\s\S]*?<\/tr>/g) || []).forEach(function (tr) {
      const cells = (tr.match(/<td[\s\S]*?<\/td>/g) || []).map(function (td) {
        return td.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      });
      // 칸 순서: 종목명(코드) | 유형 | 지급기준일 | 실지급일 | 주당분배금 | 주당과세표준액 | 분배율
      if (cells.length < 6 || cells[0].indexOf("(" + code + ")") === -1) return;
      const num = function (s) { return Number(String(s).replace(/[^0-9.-]/g, "")) || 0; };
      const item = { recordDate: cells[2], paymentDate: cells[3], dividendAmt: num(cells[4]), taxStandardAmt: num(cells[5]) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.recordDate) || seen[item.recordDate]) return;
      seen[item.recordDate] = true;
      list.push(item);
    });
  });
  // 최신순 (예전 TIGER 응답과 같은 순서)
  list.sort(function (a, b) { return a.recordDate < b.recordDate ? 1 : -1; });
  return list;
}

// 🔎 편집기에서 실행해 보는 확인용 (배포와 무관, 시트에 쓰지 않음)
function testTigerFetch() {
  ['482730', '474220'].forEach(function (code) {
    const list = fetchTigerDistributions_(code, 12);
    Logger.log(code + ' → ' + list.length + '건');
    list.slice(0, 3).forEach(function (i) { Logger.log('   ' + JSON.stringify(i)); });
  });
}
