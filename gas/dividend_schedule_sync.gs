/**
 * 📅 ETF 배당주기 자동 갱신 — 관리시트 Apps Script
 *
 * 'ETF 배당주기' 탭의 종목마다 최근 12개월 지급 기록을 모아
 *   ① 'ETF들 배당이력' 탭(종목명 · 지급일 · 분배금 · 기준일)을 새 기록으로 바꾸고  → C열 수식(평균)이 자동으로 최신화
 *   ② 'ETF 배당주기' B열(지급월)과 D·E열(출처, 최근 지급일)을 갱신합니다.
 *
 * 출처 우선순위
 *   1) 커버드콜: 동진_웹송출용_마스터시트의 DB_종목명 탭 (배당 봇이 매일 수집)
 *   2) 그 밖의 종목: 운용사 공식 API 직접 조회 (KODEX · RISE · ACE · SOL · TIGER · KIWOOM)
 *   3) 수집할 수 없는 종목(TIME, HANARO 등): 기존 기록 그대로 유지 (수기)
 *   조회에 실패한 종목도 기존 기록을 그대로 둡니다.
 *
 * ▶ 처음 한 번
 *   1) previewDividendSchedule 실행 → 종목별로 무엇이 바뀔지 로그로 확인 (시트에 쓰지 않음)
 *   2) syncDividendSchedule 실행 → 실제 갱신
 *   3) installDividendScheduleTrigger 실행 → 매일 아침 7시대 자동 갱신 (배당 봇 자정 실행 후)
 */

var DS_MASTER_SHEET_ID = '1UcY_X1GOMQAg9ceojcs2paiR6uIsXYV7NMy8IID7TDE'; // 동진_웹송출용_마스터시트
var DS_SCHEDULE_TAB = 'ETF 배당주기';
var DS_HISTORY_TAB = 'ETF들 배당이력';
var DS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function previewDividendSchedule() { runDividendSchedule_(true); }
function syncDividendSchedule() { runDividendSchedule_(false); }

function installDividendScheduleTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncDividendSchedule') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncDividendSchedule').timeBased().everyDays(1).atHour(7).inTimezone('Asia/Seoul').create();
  Logger.log('✅ 매일 아침 7시대에 syncDividendSchedule 이 실행돼요.');
}

// ---------------------------------------------------------
function runDividendSchedule_(dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var schedule = ss.getSheetByName(DS_SCHEDULE_TAB);
  var historySheet = ss.getSheetByName(DS_HISTORY_TAB);
  var lastRow = schedule.getLastRow();
  var sched = schedule.getRange(2, 1, Math.max(lastRow - 1, 1), 3).getDisplayValues();

  var ctx = { cache: {}, master: SpreadsheetApp.openById(DS_MASTER_SHEET_ID), local: ss };
  var today = new Date();
  var from = new Date(today.getTime() - 365 * 864e5), to = new Date(today.getTime() + 40 * 864e5);
  var updated = {}; // 정규화 이름 → { rows, source }
  var report = [];

  sched.forEach(function (r, i) {
    var name = String(r[0]).trim();
    if (!name) return;
    var result;
    try { result = getHistory_(name, ctx); } catch (e) { result = { source: '조회 실패', rows: null, error: String(e) }; }
    // 최근 지급일(발표된 다음 지급 포함)부터 거꾸로 12개월
    var valid = (result.rows || []).filter(function (x) { var d = new Date(x.pay); return x.pay && x.amt > 0 && d > from && d <= to; });
    valid.sort(function (a, b) { return a.pay < b.pay ? 1 : -1; });
    var recent = valid.length ? valid.filter(function (x) { return dsDate_(x.pay) > new Date(dsDate_(valid[0].pay).getTime() - 360 * 864e5); }) : [];

    var line = { row: i + 2, name: name, source: result.source, oldMonths: r[1], oldAvg: r[2] };
    var oldMonthCount = String(r[1]).split(',').filter(function (s) { return s.trim(); }).length;
    if (result.rows && recent.length === 1 && oldMonthCount > 1) {
      // 1년에 1건뿐인데 기존 값은 여러 번 지급 → 조회 누락일 수 있어 덮어쓰지 않음
      result.source = '확인 필요';
      line.source = result.source;
      line.keep = '⚠️ 기록 1건 (' + recent[0].pay + ', ' + recent[0].amt + '원) — 확인 필요, 기존 값 유지';
    } else if (result.rows && recent.length) {
      var months = monthsOf_(recent);
      var avg = recent.reduce(function (s, x) { return s + x.amt; }, 0) / recent.length;
      updated[dsNorm_(name)] = { name: name, rows: recent, source: result.source };
      line.newMonths = months; line.newAvg = Math.round(avg * 10) / 10; line.count = recent.length; line.lastPay = recent[0].pay;
    } else {
      line.keep = result.error || (result.rows ? '최근 12개월 기록 없음' : '수집 불가 → 기존 값 유지');
    }
    report.push(line);
  });

  report.forEach(function (l) {
    if (l.keep) Logger.log('➖ ' + l.name + ' [' + l.source + '] ' + l.keep + ' (지급월 ' + l.oldMonths + ', 평균 ' + l.oldAvg + ')');
    else Logger.log('🔄 ' + l.name + ' [' + l.source + '] ' + l.count + '건, 최근 ' + l.lastPay +
      ' | 지급월 ' + l.oldMonths + ' → ' + l.newMonths + ' | 평균 ' + l.oldAvg + ' → ' + l.newAvg);
  });
  var n = Object.keys(updated).length;
  Logger.log((dryRun ? '[미리보기] ' : '') + '자동 갱신 ' + n + '개 / 유지 ' + (report.length - n) + '개');
  if (dryRun || !n) return;

  // ① 배당이력: 자동 갱신 종목의 옛 기록은 지우고 최근 12개월로 교체, 나머지 종목 기록은 그대로
  var hLast = historySheet.getLastRow();
  var old = hLast ? historySheet.getRange(1, 1, hLast, 4).getValues() : [];
  var keep = old.filter(function (r) { return r[0] && !updated[dsNorm_(r[0])]; });
  var fresh = [];
  Object.keys(updated).forEach(function (k) {
    updated[k].rows.forEach(function (x) { fresh.push([updated[k].name, dsDate_(x.pay), x.amt, x.rec ? dsDate_(x.rec) : '']); });
  });
  var all = keep.concat(fresh);
  historySheet.getRange(1, 1, Math.max(hLast, all.length), 4).clearContent();
  if (all.length) {
    historySheet.getRange(1, 1, all.length, 4).setValues(all);
    historySheet.getRange(1, 2, all.length, 1).setNumberFormat('yyyy-mm-dd');
    historySheet.getRange(1, 4, all.length, 1).setNumberFormat('yyyy-mm-dd'); // D열: 지급기준일 (실수령 자동 기록에서 사용)
  }

  // ② 배당주기: 지급월(B), 출처(D), 최근 지급일·건수(E) — C열 수식은 건드리지 않음
  if (!schedule.getRange('D1').getValue()) schedule.getRange('D1:E1').setValues([['출처', '최근 지급일 (최근 12개월 건수)']]);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  report.forEach(function (l) {
    if (l.keep) {
      if (l.source === '수집 불가') schedule.getRange(l.row, 4).setValue('수기');
      else if (l.source === '조회 실패') schedule.getRange(l.row, 4).setValue('⚠️ 조회 실패 (기존 값 유지)');
      else if (l.source === '확인 필요') schedule.getRange(l.row, 4).setValue(l.keep);
      return;
    }
    schedule.getRange(l.row, 2).setValue(l.newMonths);
    schedule.getRange(l.row, 4, 1, 2).setValues([['자동 · ' + l.source + ' · ' + stamp, l.lastPay + ' (' + l.count + '건)']]);
  });
  Logger.log('✅ 갱신 완료');
}

// ---------------------------------------------------------
// 종목 하나의 지급 기록: [{ pay: 'YYYY-MM-DD', amt: Number }]
// ---------------------------------------------------------
function getHistory_(name, ctx) {
  // 1) 마스터시트 DB_ 탭 (커버드콜)
  var db = ctx.master.getSheetByName('DB_' + name) || findSheetByNorm_(ctx.master, 'DB_' + name);
  if (db && db.getLastRow() >= 2) {
    var v = db.getRange(2, 1, db.getLastRow() - 1, 4).getDisplayValues();
    return { source: '마스터시트', rows: v.map(function (r) { return { rec: dsIso_(r[0]), pay: dsIso_(r[1]), amt: dsNum_(r[3]) }; }).filter(function (x) { return x.pay; }) };
  }
  var brand = name.toUpperCase().split(' ')[0];
  switch (brand) {
    case 'KODEX': return { source: 'KODEX 공식', rows: kodexHistory_(name, ctx) };
    case 'RISE': return { source: 'RISE 공식', rows: riseHistory_(name, ctx) };
    case 'ACE': return { source: 'ACE 공식', rows: aceHistory_(name, ctx) };
    case 'SOL': return { source: 'SOL 공식', rows: solHistory_(name, ctx) };
    case 'TIGER': return { source: 'TIGER 공식', rows: tigerHistory_(name) };
    case 'KIWOOM': return { source: 'KIWOOM 공식', rows: kiwoomHistory_(name, ctx) };
    default: return { source: '수집 불가', rows: null };
  }
}

function kodexHistory_(name, ctx) {
  if (!ctx.cache.kodex) {
    var map = {}, base = 'https://m.samsungfund.com/api/v1/kodex/product.do';
    for (var p = 1; p <= 60; p++) {
      var list = dsJson_(base + (p > 1 ? '?pageNo=' + p : ''));
      if (!list.length) break;
      list.forEach(function (it) { if (it.fNm && it.fId) map[dsNorm_(it.fNm)] = it.fId; });
      var total = Number(list[0].totalCnt) || 0;
      if (total && p * 20 >= total) break;
    }
    ctx.cache.kodex = map;
  }
  var id = ctx.cache.kodex[dsNorm_(name)];
  if (!id) throw new Error('KODEX 목록에서 이름을 못 찾음');
  var d = dsJson_('https://m.samsungfund.com/api/v1/kodex/divid-info.do?id=' + id);
  return (d.dividList || []).map(function (x) { return { rec: dsIso_(x.basicD), pay: dsIso_(x.payD), amt: dsNum_(x.dividA) }; });
}

function riseHistory_(name, ctx) {
  if (!ctx.cache.rise) {
    var map = {};
    for (var p = 1; p <= 20; p++) {
      var items = dsJson_('https://kbam.co.kr/api/products/etfs?page=' + p + '&page_size=100').page_items || [];
      items.forEach(function (it) { if (it.name && it.fund_cd) map[dsNorm_(it.name)] = it.fund_cd; });
      if (items.length < 100) break;
    }
    ctx.cache.rise = map;
  }
  var id = ctx.cache.rise[dsNorm_(name)];
  if (!id) throw new Error('RISE 목록에서 이름을 못 찾음');
  var d = dsJson_('https://kbam.co.kr/api/products/etfs/' + id + '/dividend');
  return (d.history || []).map(function (x) { return { rec: dsIso_(x.base_date), pay: dsIso_(x.payment_date), amt: dsNum_(x.amount) }; });
}

function aceHistory_(name, ctx) {
  if (!ctx.cache.ace) {
    var map = {};
    (dsJson_('https://papi.aceetf.co.kr/api/funds?size=500').data || []).forEach(function (it) {
      if (it.fundNm && it.fundCd) map[dsNorm_(it.fundNm)] = it.fundCd;
    });
    ctx.cache.ace = map;
  }
  var id = ctx.cache.ace[dsNorm_(name)];
  if (!id) throw new Error('ACE 목록에서 이름을 못 찾음');
  var d = dsJson_('https://papi.aceetf.co.kr/api/funds/' + id + '/dividend?page=1');
  return (d.dividendList || []).map(function (x) { return { rec: dsIso_(x.std_DT), pay: dsIso_(x.dividend_DT), amt: dsNum_(x.dividend_PRI) }; });
}

function solHistory_(name, ctx) {
  if (!ctx.cache.sol) {
    var html = UrlFetchApp.fetch('https://www.soletf.com/ko/fund', { muteHttpExceptions: true, headers: { 'User-Agent': DS_UA } }).getContentText();
    var map = {}, re = /\/ko\/fund\/etf\/(\d+)/g, links = [], m;
    while ((m = re.exec(html)) !== null) links.push({ id: m[1], pos: m.index });
    links.forEach(function (link, i) {
      var end = i + 1 < links.length ? links[i + 1].pos : link.pos + 800;
      var text = html.slice(link.pos, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      var c = text.match(/(SOL[^()]*?)\s*\(([0-9][0-9A-Z]{5})\)/);
      if (c && !map[dsNorm_(c[1])]) map[dsNorm_(c[1])] = link.id;
    });
    ctx.cache.sol = map;
  }
  var id = ctx.cache.sol[dsNorm_(name)];
  if (!id) throw new Error('SOL 목록에서 이름을 못 찾음');
  var d = dsJson_('https://www.soletf.com/api/etf/pds/dividend/' + id);
  return (d.items || []).map(function (x) { return { rec: dsIso_(x.WORK_DT), pay: dsIso_(x.DIVIDEND_DT), amt: dsNum_(x.DIVIDEND_PRI) }; });
}

// TIGER: 미래에셋 분배 내역(list.ajax)을 종목명으로 13개월 조회
function tigerHistory_(name) {
  var base = 'https://investments.miraeasset.com/tigeretf/ko/distribution/overall/';
  var page = UrlFetchApp.fetch(base + 'list.do', { muteHttpExceptions: true, headers: { 'User-Agent': DS_UA } });
  var cookies = [].concat(page.getAllHeaders()['Set-Cookie'] || []).map(function (c) { return c.split(';')[0]; }).join('; ');
  var reqs = [], now = new Date();
  for (var i = 0; i < 13; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    reqs.push({ url: base + 'list.ajax', method: 'post', muteHttpExceptions: true,
      payload: { pageIndex: '1', firstIndex: '0', listCnt: '50', orderC: '', orderType: '', orderB: '',
                 selectYear: String(d.getFullYear()), selectMonth: String(d.getMonth() + 1), q: name },
      headers: { 'User-Agent': DS_UA, 'X-Requested-With': 'XMLHttpRequest', 'Cookie': cookies, 'Referer': base + 'list.do' } });
  }
  var out = [], seen = {}, key = dsNorm_(name);
  UrlFetchApp.fetchAll(reqs).forEach(function (res) {
    if (res.getResponseCode() !== 200) return;
    (res.getContentText().match(/<tr[\s\S]*?<\/tr>/g) || []).forEach(function (tr) {
      var cells = (tr.match(/<td[\s\S]*?<\/td>/g) || []).map(function (td) {
        return td.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      });
      if (cells.length < 6) return;
      // 종목명(코드) | 유형 | 지급기준일 | 실지급일 | 주당분배금 | 주당과세표준액 | 분배율
      if (dsNorm_(cells[0].replace(/\([0-9A-Z]{6}\)\s*$/, '')) !== key) return;
      if (seen[cells[2]]) return;
      seen[cells[2]] = true;
      out.push({ rec: dsIso_(cells[2]), pay: dsIso_(cells[3]), amt: dsNum_(cells[4]) });
    });
  });
  return out;
}

// KIWOOM: 관리시트 MasterData에서 종목코드를 찾고, 키움 ETF 상품 페이지의 분배금 표를 읽음
function kiwoomHistory_(name, ctx) {
  var code = codeFromMasterData_(name, ctx);
  if (!code) throw new Error('MasterData에서 종목코드를 못 찾음');
  var html = UrlFetchApp.fetch('https://www.kiwoometf.com/service/etf/KO02010200M?gcode=' + code,
    { muteHttpExceptions: true, headers: { 'User-Agent': DS_UA } }).getContentText();
  var tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
  for (var t = 0; t < tables.length; t++) {
    if (tables[t].replace(/\s/g, '').indexOf('주당분배금') === -1) continue;
    var rows = tables[t].match(/<tr[\s\S]*?<\/tr>/g) || [];
    return rows.map(function (tr) {
      var c = (tr.match(/<td[\s\S]*?<\/td>/g) || []).map(function (td) { return td.replace(/<[^>]+>/g, '').trim(); });
      return c.length >= 3 ? { rec: dsIso_(c[0]), pay: dsIso_(c[1]), amt: dsNum_(c[2]) } : null; // 기준일 | 지급일 | 주당분배금 | ...
    }).filter(function (x) { return x && x.pay; });
  }
  return [];
}

function codeFromMasterData_(name, ctx) {
  if (!ctx.cache.codes) {
    var sh = ctx.local.getSheetByName('MasterData'), map = {};
    if (sh) sh.getRange(1, 2, sh.getLastRow(), 2).getDisplayValues().forEach(function (r) {
      var code = String(r[0]).replace(/^KRX:/, '').trim();
      if (/^[0-9][0-9A-Z]{5}$/.test(code)) map[dsNorm_(r[1])] = code;
    });
    ctx.cache.codes = map;
  }
  return ctx.cache.codes[dsNorm_(name)] || '';
}

// ---------------------------------------------------------
// 도우미
// ---------------------------------------------------------
function dsJson_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': DS_UA, 'Accept': 'application/json, text/plain, */*' } });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ' ' + url);
  return JSON.parse(res.getContentText());
}
function dsNorm_(s) { return String(s || '').replace(/\s+/g, '').toUpperCase().replace(/커브드/g, '커버드'); }
function dsNum_(s) { return Number(String(s == null ? '' : s).replace(/[^0-9.-]/g, '')) || 0; }
function dsIso_(s) {
  var t = String(s == null ? '' : s).trim().replace(/[.\/]/g, '-').replace(/\s+/g, '');
  if (/^\d{8}$/.test(t)) return t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
  var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}
function dsDate_(iso) { var p = iso.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
// 지급월: 실제 지급일의 월. 기록이 짧아도 지급 간격으로 주기를 추정해 1년치로 채움
//   간격 약 1개월 → 매월, 약 3개월 → 분기(3개월마다), 약 6개월 → 반기
function monthsOf_(rows) {
  var set = {};
  rows.forEach(function (x) { set[Number(x.pay.slice(5, 7))] = true; });
  var observed = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  if (observed.length >= 10) return '1,2,3,4,5,6,7,8,9,10,11,12';
  if (rows.length >= 2) {
    var sorted = rows.map(function (x) { return dsDate_(x.pay).getTime(); }).sort(function (a, b) { return a - b; });
    var gaps = [];
    for (var i = 1; i < sorted.length; i++) gaps.push((sorted[i] - sorted[i - 1]) / 864e5);
    gaps.sort(function (a, b) { return a - b; });
    var median = gaps[Math.floor(gaps.length / 2)];
    var step = median <= 45 ? 1 : (median >= 75 && median <= 110 ? 3 : (median >= 160 && median <= 200 ? 6 : 0));
    if (step === 1) return '1,2,3,4,5,6,7,8,9,10,11,12';
    if (step) {
      var base = observed[0], out = {};
      for (var m = 0; m < 12; m += step) out[((base - 1 + m) % 12) + 1] = true;
      observed.forEach(function (x) { out[x] = true; });
      return Object.keys(out).map(Number).sort(function (a, b) { return a - b; }).join(',');
    }
  }
  return observed.join(',');
}
function findSheetByNorm_(ss, title) {
  var key = dsNorm_(title), found = null;
  ss.getSheets().forEach(function (s) { if (!found && dsNorm_(s.getName()) === key) found = s; });
  return found;
}
