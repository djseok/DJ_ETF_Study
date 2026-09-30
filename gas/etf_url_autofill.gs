/**
 * 🧩 관리코드 C열(운용사 배당 API 주소) 자동 채우기 — 동진_웹송출용_마스터시트 Apps Script
 *
 * 관리코드 탭에 A열 이름, B열 종목코드만 적으면
 * KODEX · RISE · ACE · SOL 종목의 C열 주소를 운용사 상품 목록에서 찾아 채웁니다.
 * (TIGER · KIWOOM 은 원래 C열이 필요 없음)
 *
 * ▶ 처음 한 번
 *   1) verifyEtfUrlResolver 실행 → 이미 채워진 줄과 자동으로 찾은 주소가 같은지 확인 (시트에 쓰지 않음)
 *   2) previewAutoFillEtfUrls 실행 → 빈 C열에 무엇을 쓸지 미리보기 (시트에 쓰지 않음)
 *   3) installAutoFillTrigger 실행 → 매일 밤 10시대에 자동 실행 (배당 봇 자정 실행 전)
 *   직접 채우고 싶을 때는 autoFillEtfUrls 실행
 */

var AUTOFILL_SHEET = '관리코드';
var AUTOFILL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 운용사별: 이름 앞글자, 목록에서 코드→번호 사전 만들기, 번호→C열 주소
var ETF_PROVIDERS = {
  KODEX: { url: function (id) { return 'https://m.samsungfund.com/api/v1/kodex/divid-info.do?id=' + id; }, load: loadKodexIds_ },
  RISE:  { url: function (id) { return 'https://kbam.co.kr/api/products/etfs/' + id + '/dividend'; },      load: loadRiseIds_ },
  ACE:   { url: function (id) { return 'https://papi.aceetf.co.kr/api/funds/' + id + '/dividend?page=1'; }, load: loadAceIds_ },
  SOL:   { url: function (id) { return 'https://www.soletf.com/api/etf/pds/dividend/' + id; },             load: loadSolIds_ }
};

// ---------------------------------------------------------
// 실행용 함수
// ---------------------------------------------------------
function autoFillEtfUrls() { return runAutoFill_(false); }
function previewAutoFillEtfUrls() { return runAutoFill_(true); }

// 이미 채워진 줄로 정확도 검증 (시트에 쓰지 않음)
function verifyEtfUrlResolver() {
  var rows = readRows_();
  var cache = {}, ok = 0, bad = 0, skip = 0;
  rows.forEach(function (r) {
    if (!r.provider || !r.url) { skip++; return; }
    var found = resolveUrl_(r.provider, r.code, cache);
    if (found === r.url) { ok++; Logger.log('✅ ' + r.name + ' (' + r.code + ')'); }
    else { bad++; Logger.log('❌ ' + r.name + ' (' + r.code + ')\n    시트: ' + r.url + '\n    자동: ' + (found || '못 찾음')); }
  });
  Logger.log('검증 결과: 일치 ' + ok + ' / 불일치 ' + bad + ' / 대상 아님 ' + skip);
}

function installAutoFillTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoFillEtfUrls') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoFillEtfUrls').timeBased().everyDays(1).atHour(22).inTimezone('Asia/Seoul').create();
  Logger.log('✅ 매일 밤 10시대에 autoFillEtfUrls 가 실행돼요 (배당 봇은 자정).');
}

// ---------------------------------------------------------
// 내부
// ---------------------------------------------------------
function runAutoFill_(dryRun) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTOFILL_SHEET);
  var rows = readRows_();
  var cache = {}, filled = 0, missing = 0;
  rows.forEach(function (r) {
    if (!r.provider || r.url) return; // 대상 운용사가 아니거나 이미 채워짐
    var found = resolveUrl_(r.provider, r.code, cache);
    var value = found || '⚠️ 번호를 못 찾음 (자동) — 종목코드를 확인하세요';
    Logger.log((dryRun ? '[미리보기] ' : '') + (found ? '✅ ' : '⚠️ ') + r.row + '행 ' + r.name + ' (' + r.code + ') → ' + value);
    if (!dryRun) sheet.getRange(r.row, 3).setValue(value);
    found ? filled++ : missing++;
  });
  Logger.log((dryRun ? '미리보기 끝: ' : '완료: ') + '채움 ' + filled + ' / 못 찾음 ' + missing);
}

function readRows_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTOFILL_SHEET);
  var last = sheet.getLastRow();
  if (last < 1) return [];
  return sheet.getRange(1, 1, last, 3).getDisplayValues().map(function (v, i) {
    var name = String(v[0]).trim();
    var code = String(v[1]).trim().toUpperCase();
    if (/^\d{1,5}$/.test(code)) code = ('000000' + code).slice(-6); // 숫자로 저장돼 앞자리 0이 빠진 경우
    var url = String(v[2]).trim();
    if (url.indexOf('⚠️') === 0) url = ''; // 예전에 못 찾았던 줄은 다시 시도
    var upper = name.toUpperCase(), provider = null;
    Object.keys(ETF_PROVIDERS).forEach(function (p) { if (upper.indexOf(p + ' ') === 0) provider = p; });
    return { row: i + 1, name: name, code: code, url: url, provider: provider };
  }).filter(function (r) { return r.name && r.code; });
}

function resolveUrl_(provider, code, cache) {
  if (!cache[provider]) {
    try { cache[provider] = ETF_PROVIDERS[provider].load(); }
    catch (e) { Logger.log(provider + ' 목록 조회 오류: ' + e); cache[provider] = {}; }
    Logger.log(provider + ' 목록 ' + Object.keys(cache[provider]).length + '개');
  }
  var id = cache[provider][code];
  return id ? ETF_PROVIDERS[provider].url(id) : '';
}

function getJson_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': AUTOFILL_UA, 'Accept': 'application/json, text/plain, */*' } });
  if (res.getResponseCode() !== 200) throw new Error(url + ' → HTTP ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

// RISE: /api/products/etfs?page=N&page_size=100 → page_items[].{krx_cd, fund_cd}
function loadRiseIds_() {
  var map = {};
  for (var page = 1; page <= 20; page++) {
    var items = getJson_('https://kbam.co.kr/api/products/etfs?page=' + page + '&page_size=100').page_items || [];
    items.forEach(function (it) { if (it.krx_cd && it.fund_cd) map[String(it.krx_cd).toUpperCase()] = it.fund_cd; });
    if (items.length < 100) break;
  }
  return map;
}

// ACE: /api/funds → { data: [].{stockCd: 'KR7' + 종목코드6 + ..., fundCd}, page: {page, totalPages} }
//      10개씩 나뉘어 있고 다음 페이지 요청 방식이 공개돼 있지 않아서, 실제로 다른 목록이 오는 방식을 자동으로 찾음
function loadAceIds_() {
  var base = 'https://papi.aceetf.co.kr/api/funds';
  var map = {};
  var add = function (res) {
    (res.data || []).forEach(function (it) {
      var isin = String(it.stockCd || '');
      if (isin.length >= 9 && it.fundCd) map[isin.slice(3, 9).toUpperCase()] = it.fundCd;
    });
  };
  var first = getJson_(base);
  add(first);
  var totalPages = (first.page && first.page.totalPages) || 1;
  var firstFund = first.data && first.data[0] ? first.data[0].fundCd : null;
  if (totalPages <= 1) return map;

  // 1) 한 번에 많이 받는 방식
  var sizeNames = ['size', 'pageSize', 'limit', 'rows', 'rowCount', 'perPage', 'per_page', 'listSize', 'cnt'];
  for (var i = 0; i < sizeNames.length; i++) {
    try {
      var big = getJson_(base + '?' + sizeNames[i] + '=500');
      if ((big.data || []).length > 10) { add(big); Logger.log('ACE 방식: ' + sizeNames[i] + '=500'); return map; }
    } catch (e) {}
  }
  // 2) 페이지를 넘기는 방식 (주소 뒤에 붙이기 → POST 순서로 시도)
  var pageNames = ['page', 'pageNo', 'pageIndex', 'currentPage', 'pageNum', 'p'];
  var fetchers = [];
  pageNames.forEach(function (n) {
    fetchers.push({ label: 'GET ' + n, get: function (p) { return getJson_(base + '?' + n + '=' + p); } });
    fetchers.push({ label: 'GET ' + n + '(0부터)', get: function (p) { return getJson_(base + '?' + n + '=' + (p - 1)); } });
  });
  pageNames.forEach(function (n) {
    fetchers.push({ label: 'POST ' + n, get: function (p) {
      var body = {}; body[n] = p;
      var res = UrlFetchApp.fetch(base, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
        muteHttpExceptions: true, headers: { 'User-Agent': AUTOFILL_UA, 'Accept': 'application/json' } });
      return JSON.parse(res.getContentText());
    } });
  });
  for (var f = 0; f < fetchers.length; f++) {
    try {
      var second = fetchers[f].get(2);
      if (second.data && second.data.length && second.data[0].fundCd !== firstFund) {
        Logger.log('ACE 방식: ' + fetchers[f].label);
        add(second);
        for (var p = 3; p <= Math.min(totalPages, 50); p++) add(fetchers[f].get(p));
        return map;
      }
    } catch (e) {}
  }
  Logger.log('⚠️ ACE 다음 페이지 요청 방식을 찾지 못했어요. 첫 페이지 ' + Object.keys(map).length + '개만 사용해요.');
  return map;
}

// SOL: 상품 목록 페이지의 "종목명 (코드)" 링크 → /ko/fund/etf/{번호}
function loadSolIds_() {
  var html = UrlFetchApp.fetch('https://www.soletf.com/ko/fund', { muteHttpExceptions: true, headers: { 'User-Agent': AUTOFILL_UA } }).getContentText();
  var map = {};
  var re = /\/ko\/fund\/etf\/(\d+)/g, links = [], m;
  while ((m = re.exec(html)) !== null) links.push({ id: m[1], pos: m.index });
  links.forEach(function (link, i) {
    // 링크 글자는 "종목명 (코드)" → 이 링크 뒤, 다음 링크 앞 사이의 첫 "(코드)"
    var end = i + 1 < links.length ? links[i + 1].pos : link.pos + 800;
    var c = html.slice(link.pos, end).match(/\(([0-9][0-9A-Z]{5})\)/);
    if (c && !map[c[1]]) map[c[1]] = link.id;
  });
  return map;
}

// KODEX: /api/v1/kodex/product.do (20개씩) → [].{stkTicker, fId}
//        페이지 넘김 방식이 공개돼 있지 않아서, 두 번째 페이지가 실제로 달라지는 이름을 자동으로 찾음
function loadKodexIds_() {
  var base = 'https://m.samsungfund.com/api/v1/kodex/product.do';
  var map = {};
  var add = function (list) { (list || []).forEach(function (it) { if (it.stkTicker && it.fId) map[String(it.stkTicker).toUpperCase()] = it.fId; }); };
  var first = getJson_(base);
  add(first);
  var firstId = first.length ? first[0].fId : null;
  var total = first.length ? Number(first[0].totalCnt) || 0 : 0;

  var params = ['pageNo', 'page', 'pageIndex', 'currentPage', 'pageNum', 'curPage'];
  var working = null;
  for (var i = 0; i < params.length && !working; i++) {
    try {
      var second = getJson_(base + '?' + params[i] + '=2');
      if (second.length && second[0].fId !== firstId) { working = params[i]; add(second); }
    } catch (e) {}
  }
  if (working) {
    var pages = total ? Math.ceil(total / 20) : 30;
    for (var p = 3; p <= Math.min(pages, 60); p++) {
      var list = getJson_(base + '?' + working + '=' + p);
      if (!list.length) break;
      add(list);
    }
  } else {
    Logger.log('KODEX 페이지 넘김 방식을 찾지 못해 첫 페이지와 추천 목록만 사용해요.');
  }
  // 추천 목록(now/product.do)에도 상품이 있어서 함께 사용
  try {
    (getJson_('https://m.samsungfund.com/api/v1/kodex/now/product.do') || []).forEach(function (g) { add(g.productList); });
  } catch (e) {}
  Logger.log('KODEX 페이지 방식: ' + (working || '없음') + ', 전체 ' + total + '개 중 ' + Object.keys(map).length + '개 확보');
  return map;
}
