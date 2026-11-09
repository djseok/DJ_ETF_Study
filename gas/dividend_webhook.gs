/**
 * 📥 배당 봇 Webhook (동진_웹송출용_마스터시트 Apps Script 의 Code.gs 원본 사본)
 * - doPost : 배당 봇(scraper.py)이 보낸 배당 기록을 DB_종목 탭과 마스터데이터 탭에 기록 (토큰 필요)
 * - doGet  : action=tiger → 미래에셋 TIGER 분배 내역을 대신 조회해서 봇에 전달 (토큰 필요)
 *            action=rise  → KB자산운용 RISE 분배 내역을 대신 조회 (토큰 필요)
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
      masterSheet.appendRow(["종목명", "현재가", "최소 배당금", "평균 배당금", "최대 배당금", "평균 과세표준", "배당이력(회)"]);
      masterSheet.getRange("A1:G1").setFontWeight("bold").setBackground("#FFF2CC");
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
      const formulaCount = `=IFERROR(COUNT(${safeSheetName}!D:D), 0)`; // 대시보드 Top5: 이력이 짧은 종목 구분용

      masterSheet.appendRow([etfName, formulaPrice, formulaMin, formulaAvg, formulaMax, formulaAvgTax, formulaCount]);
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
  
  // RISE(KB자산운용) 분배 내역: kbam.co.kr 이 GitHub(해외) 서버의 접속을 받지 않아 구글이 대신 조회
  // id 는 kbam 상품 코드(예: 44J2)만 허용 → 다른 주소로는 못 쓰게
  if (e.parameter.action === 'rise' && e.parameter.id) {
    if (!isWebhookAuthorized_(e.parameter.token)) return unauthorizedResponse_();
    const id = String(e.parameter.id);
    if (!/^[0-9A-Za-z]{1,12}$/.test(id)) return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "bad id" })).setMimeType(ContentService.MimeType.JSON);
    const res = UrlFetchApp.fetch("https://kbam.co.kr/api/products/etfs/" + id + "/dividend", { muteHttpExceptions: true, headers: { "User-Agent": "Mozilla/5.0" } });
    if (res.getResponseCode() !== 200) return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "kbam HTTP " + res.getResponseCode() })).setMimeType(ContentService.MimeType.JSON);
    return ContentService.createTextOutput(res.getContentText()).setMimeType(ContentService.MimeType.JSON);
  }

  // 기존 네이버 API 우회 (유지) — 아무나 불러 할당량을 쓰지 않게 토큰 필요
  if (e.parameter.action === 'fetch' && e.parameter.code) {
    if (!isWebhookAuthorized_(e.parameter.token)) return unauthorizedResponse_();
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

// 🔎 편집기에서 실행: 구글 서버가 kbam.co.kr(RISE)에 접속되는지, 몇 초 걸리는지 확인 (시트에 쓰지 않음)
// 2026-10-21 배당 봇에서 action=rise 가 60초 넘게 응답 없음 → 막힌 건지 느린 건지 확인용
function testRiseFetch() {
  ['44J2', '44H1'].forEach(function (id) {
    const t0 = Date.now();
    try {
      const res = UrlFetchApp.fetch("https://kbam.co.kr/api/products/etfs/" + id + "/dividend", { muteHttpExceptions: true, headers: { "User-Agent": "Mozilla/5.0" } });
      const body = res.getContentText();
      Logger.log(id + ' → HTTP ' + res.getResponseCode() + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + '초, ' + body.length + '글자, history ' + ((JSON.parse(body).history || []).length) + '건');
    } catch (e) {
      Logger.log(id + ' → 실패 (' + ((Date.now() - t0) / 1000).toFixed(1) + '초): ' + e);
    }
  });
}

// 🔎 편집기에서 실행: kbam.co.kr 이 해외 서버를 막아서(2026-10-21 testRiseFetch 로 확인) RISE 분배금을 네이버에서 받을 수 있는지 확인
// 네이버 주소 후보를 그대로 찍어 보고, 응답 모양을 보고 나서 배당 봇에 연결 (시트에 쓰지 않음)
function testNaverDividend() {
  const urls = function (code) {
    return [
      "https://m.stock.naver.com/api/stock/" + code + "/dividend",
      "https://m.stock.naver.com/api/stock/" + code + "/dividend/history?pageSize=12&page=1",
      "https://m.stock.naver.com/api/etf/" + code + "/dividend"
    ];
  };
  ['0094M0', '475720'].forEach(function (code) {
    urls(code).forEach(function (u) {
      const t0 = Date.now();
      try {
        const res = UrlFetchApp.fetch(u, { muteHttpExceptions: true, headers: { "User-Agent": "Mozilla/5.0" } });
        Logger.log(u + '\n → HTTP ' + res.getResponseCode() + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + '초\n' + res.getContentText().slice(0, 700));
      } catch (e) {
        Logger.log(u + '\n → 실패: ' + e);
      }
    });
  });
}

// 🔎 편집기에서 실행: TIGER 조회가 0건일 때 미래에셋 사이트가 무엇을 돌려주는지 확인 (시트에 쓰지 않음)
// 응답 코드·길이·표 줄 수·앞부분 글자만 로그로 남김 → 사이트 개편인지, 구글 차단인지 구분
function testTigerRaw() {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const base = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/";
  const strip = function (t) { return String(t).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); };
  let cookies = "";
  try {
    const page = UrlFetchApp.fetch(base + "list.do", { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": UA } });
    const raw = [].concat(page.getAllHeaders()["Set-Cookie"] || []);
    cookies = raw.map(function (c) { return c.split(";")[0]; }).join("; ");
    const html = page.getContentText();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    Logger.log("list.do → HTTP " + page.getResponseCode() + ", " + html.length + "글자, 쿠키 " + raw.length + "개, 제목: " + strip(title).slice(0, 80));
    Logger.log("list.do 안에 list.ajax 글자 " + (html.indexOf("list.ajax") >= 0 ? "있음" : "없음") + ", selectYear " + (html.indexOf("selectYear") >= 0 ? "있음" : "없음"));
  } catch (e) { Logger.log("list.do → 실패: " + e); }
  const now = new Date();
  [0, 1].forEach(function (i) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    try {
      const res = UrlFetchApp.fetch(base + "list.ajax", {
        method: "post", muteHttpExceptions: true, followRedirects: false,
        payload: { pageIndex: "1", firstIndex: "0", listCnt: "20", orderC: "", orderType: "", orderB: "",
                   selectYear: String(d.getFullYear()), selectMonth: String(d.getMonth() + 1), q: "486290" },
        headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Cookie": cookies, "Referer": base + "list.do" }
      });
      const t = res.getContentText();
      const loc = res.getAllHeaders()["Location"] || "";
      Logger.log("list.ajax " + d.getFullYear() + "-" + (d.getMonth() + 1) + " → HTTP " + res.getResponseCode() + ", " + t.length + "글자, <tr> " + (t.match(/<tr/g) || []).length + "개" + (loc ? ", 이동: " + loc : ""));
      Logger.log("   앞부분: " + strip(t).slice(0, 300));
    } catch (e) { Logger.log("list.ajax → 실패: " + e); }
  });
}

// 🔎 편집기에서 실행: 미래에셋이 'overall' 분배 화면을 닫음(2026-11 확인, 403). 남은 'annual' 화면 구조를 확인 (시트에 쓰지 않음)
// 화면 안의 조회 주소(.ajax/.do), 입력칸 이름, annual/list.ajax 응답을 로그로 남김
function testTigerAnnual() {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const base = "https://investments.miraeasset.com/tigeretf/ko/distribution/annual/";
  const strip = function (t) { return String(t).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); };
  const uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
  let cookies = "";
  try {
    const page = UrlFetchApp.fetch(base + "list.do", { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": UA } });
    cookies = [].concat(page.getAllHeaders()["Set-Cookie"] || []).map(function (c) { return c.split(";")[0]; }).join("; ");
    const html = page.getContentText();
    Logger.log("annual/list.do → HTTP " + page.getResponseCode() + ", " + html.length + "글자");
    Logger.log("조회 주소: " + uniq(html.match(/[\w\/.-]*\.(?:ajax|do)\b/g) || []).slice(0, 20).join(" | "));
    Logger.log("입력칸: " + uniq((html.match(/name=["'][\w.-]+["']/g) || []).map(function (x) { return x.slice(6, -1); })).slice(0, 30).join(", "));
    Logger.log("<tr> " + (html.match(/<tr/g) || []).length + "개, 앞부분: " + strip(html).slice(0, 300));
  } catch (e) { Logger.log("annual/list.do → 실패: " + e); }
  const y = String(new Date().getFullYear());
  try {
    const res = UrlFetchApp.fetch(base + "list.ajax", {
      method: "post", muteHttpExceptions: true, followRedirects: false,
      payload: { pageIndex: "1", firstIndex: "0", listCnt: "20", selectYear: y, q: "486290" },
      headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Cookie": cookies, "Referer": base + "list.do" }
    });
    const t = res.getContentText();
    Logger.log("annual/list.ajax " + y + " → HTTP " + res.getResponseCode() + ", " + t.length + "글자, <tr> " + (t.match(/<tr/g) || []).length + "개");
    Logger.log("   앞부분: " + strip(t).slice(0, 400));
  } catch (e) { Logger.log("annual/list.ajax → 실패: " + e); }
}

// 국내 상장 종목코드(6자리) → ISIN (KR7 + 코드 + 00 + 검증숫자)
function krIsin_(code) {
  const body = "KR7" + String(code).toUpperCase() + "00";
  const digits = body.split("").map(function (ch) { return /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); }).join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return body + String((10 - sum % 10) % 10);
}

// 🔎 편집기에서 실행: TIGER·RISE 분배금(+과세표준)을 받을 대체 출처 확인 (시트에 쓰지 않음)
// 미래에셋 분배 화면(overall·annual) 403, 네이버 분배 API 404 확인 뒤(2026-11-06) 다른 경로를 찍어 봄
function testAltSources() {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const strip = function (t) { return String(t).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); };
  const tiger = krIsin_("486290"), rise = krIsin_("475720");
  Logger.log("ISIN 486290=" + tiger + ", 475720=" + rise);
  [
    "https://www.tigeretf.com/ko/distribution/overall/list.do",
    "https://investments.miraeasset.com/tigeretf/ko/product/search/detail/refDiv.do?ksdFund=" + tiger + "&pageIndex=1&listCnt=10",
    "https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=" + tiger,
    "https://www.funetf.co.kr/product/etf/view/" + tiger,
    "https://www.funetf.co.kr/product/etf/view/" + rise,
    "https://www.funetf.co.kr/product/etf/distribution"
  ].forEach(function (u) {
    const t0 = Date.now();
    try {
      const res = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": UA } });
      const html = res.getContentText();
      const text = strip(html);
      Logger.log(u + "\n → HTTP " + res.getResponseCode() + ", " + ((Date.now() - t0) / 1000).toFixed(1) + "초, " + html.length + "글자, <tr> " + (html.match(/<tr/g) || []).length + "개, '과세표준' " + (text.indexOf("과세표준") >= 0 ? "있음" : "없음") + ", '분배' " + (text.indexOf("분배") >= 0 ? "있음" : "없음"));
      const i = text.indexOf("과세표준");
      Logger.log("   " + (i >= 0 ? "과세표준 근처: " + text.slice(Math.max(0, i - 150), i + 250) : "앞부분: " + text.slice(0, 250)));
    } catch (e) {
      Logger.log(u + "\n → 실패 (" + ((Date.now() - t0) / 1000).toFixed(1) + "초): " + e);
    }
  });
}

// 🔎 편집기에서 실행: RISE 과세표준을 받을 수 있는 다른 공시처에 구글 서버가 접속되는지 확인 (시트에 쓰지 않음)
// kbam.co.kr 은 2026-10-21 기준 해외 서버 차단. 접속되는 곳이 있으면 그곳의 분배금 조회 경로를 이어서 확인
function testTaxSources() {
  [
    "https://www.riseetf.co.kr/",
    "https://seibro.or.kr/",
    "https://data.krx.co.kr/",
    "https://dis.kofia.or.kr/"
  ].forEach(function (u) {
    const t0 = Date.now();
    try {
      const res = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": "Mozilla/5.0" } });
      Logger.log(u + ' → HTTP ' + res.getResponseCode() + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + '초, ' + res.getContentText().length + '글자');
    } catch (e) {
      Logger.log(u + ' → 실패 (' + ((Date.now() - t0) / 1000).toFixed(1) + '초): ' + e);
    }
  });
}
