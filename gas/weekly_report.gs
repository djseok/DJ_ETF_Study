/**
 * 📅 주간 리포트 (금요일 17:10 카톡 이미지) — 관리시트 Apps Script
 *   (premarket_alert.gs · etf_holdings_sync.gs 와 같은 프로젝트 — 카톡·GitHub 설정을 같이 씁니다)
 *
 * 한 장에 담는 것
 *   · 관리 ETF 주간 등락 (지난주 마지막 거래일 종가 → 이번 주 종가, 네이버 일봉)
 *   · 코스피 · 나스닥 · 원/달러 주간 변동
 *   · 멤버 현황: 평가액 · 수익률 · 지난주 리포트 대비 수익률 변화 · 이번 주 받은 배당 (개인일기장 '마스터 포토폴리오' 읽기만)
 *   · 이번 주 받은 배당 합계 · 다음 주 예정 배당 (ETF 배당주기 × 클럽 보유수량)
 *   · 07:30 예측 오차·방향 적중률 · 장중 신호
 *
 * ▶ 처음 한 번: previewWeekly 실행(로그만) → sendWeeklyReport 로 테스트 → installWeeklyTrigger
 */

var WR_DIARY_ID = '1nVnpen14YDDWRxODwt36HVlG7GId-zKzFIyQYn9p7vY'; // 동진ETF공부_개인일기장 (읽기만)
var WR_DIARY_TAB = '마스터 포토폴리오';

function previewWeekly() { runWeekly_(true); }
function sendWeeklyReport() { runWeekly_(false); }

function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'weeklyReport_') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklyReport_').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(17).nearMinute(10).create();
  Logger.log('✅ 주간 리포트 설치: 매주 금요일 17:10');
}
function weeklyReport_() { runWeekly_(false); }

function runWeekly_(dryRun) {
  PM_T0 = Date.now();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var now = new Date();
  var mon = wrMonday_(now), fri = new Date(mon.getTime() + 4 * 864e5);
  var ymd = function (d) { return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'); };
  var md = function (d) { return Utilities.formatDate(d, 'Asia/Seoul', 'M/d'); };
  var monS = ymd(mon), friS = ymd(fri);

  // 1) ETF 주간 등락
  var etfs = pmEtfList_(ss.getSheetByName(HS_TAB_MASTER));
  var weekly = wrNaverWeekly_(etfs.map(function (e) { return e.code; }), monS);
  var etfRows = etfs.filter(function (e) { return weekly[e.code]; })
    .map(function (e) { var w = weekly[e.code]; return [e.name, r2_((w.last / w.base - 1) * 100), Math.round(w.last)]; });
  pmLap_('ETF 주간 등락 ' + etfRows.length + '/' + etfs.length);

  // 2) 지수 칩
  var chips = [[md(mon) + ' ~ ' + md(fri), null]];
  [['코스피', '^KS11'], ['나스닥', '^IXIC'], ['원/달러', 'KRW=X']].forEach(function (x) {
    try {
      var r = pmChart_(x[1], '1mo', '1d'), c = r.indicators.quote[0].close, base = null, last = null;
      r.timestamp.forEach(function (t, i) {
        if (c[i] == null) return;
        var d = Utilities.formatDate(new Date(t * 1000), x[1] === '^IXIC' ? 'America/New_York' : 'Asia/Seoul', 'yyyy-MM-dd');
        if (d < monS) base = c[i]; else last = c[i];
      });
      if (base && last) chips.push([x[0], r2_((last / base - 1) * 100)]);
    } catch (e) { }
  });

  // 3) 멤버 · 배당
  var diary = wrDiary_(monS, friS, wrTaxRatios_(ss));
  var props = PropertiesService.getScriptProperties();
  var snap = JSON.parse(props.getProperty('WR_SNAP') || '{}');
  var members = diary.members.map(function (m) {
    var prev = snap[m.name];
    var withDiv = m.invest > 0 ? (m.current + m.divNet - m.invest) / m.invest * 100 : 0;
    return [m.name, Math.round(m.current), r2_(m.ret), prev === undefined ? null : r2_(m.ret - prev), Math.round(m.weekDiv), r2_(withDiv)];
  });
  var divWeek = diary.members.reduce(function (s, m) { return s + m.weekDiv; }, 0);
  var next = wrNextDividends_(ss, diary.holdings, fri);

  // 4) 예측 · 신호
  var acc = wrAccuracy_(ss, monS, friS);
  var status = wrRunStatus_(mon);
  var signals = wrSignals_(ss, monS, friS);

  var payload = {
    kind: 'weekly', stamp: Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd_HHmm'),
    title: md(now) + '(' + '월화수목금토일'.charAt(Number(Utilities.formatDate(now, 'Asia/Seoul', 'u')) - 1) + ') 주간 리포트',
    chips: chips, vix: 0, note: '',
    etfs: etfRows, members: members, divWeek: Math.round(divWeek),
    divNext: next.items.slice(0, 5), divNextTotal: Math.round(next.total),
    acc: acc, signals: signals, status: status
  };
  Logger.log(JSON.stringify(payload));
  if (dryRun) { Logger.log('[미리보기] 카톡·기록 안 함'); return; }

  // 다음 주 비교용 수익률 저장
  var ns = {}; diary.members.forEach(function (m) { ns[m.name] = r2_(m.ret); });
  props.setProperty('WR_SNAP', JSON.stringify(ns));

  var summary = ('이번 주 받은 배당 ' + Math.round(divWeek).toLocaleString() + '원 · 다음 주 예정 ' + Math.round(next.total).toLocaleString() + '원' +
    (acc.days ? '\n예측 오차 ' + acc.mae.toFixed(2) + '%p · 방향 ' + Math.round(acc.hit) + '% · 장중 신호 ' + signals.count + '건' : '')).slice(0, 190);
  var token = props.getProperty('GH_DISPATCH_TOKEN');
  var ok = false;
  if (token) {
    try {
      var url = wrRequestImage_(token, payload);
      if (url) {
        kakaoSendFeed_(payload.title, summary, url, PM_IMAGE_BASE + 'view.html?s=' + payload.stamp + '&k=W', 1080, 1300);
        ok = true;
      }
    } catch (e) { Logger.log('⚠️ 이미지 실패 → 글자로: ' + e); }
  }
  if (!ok) kakaoSendToMe_('📅 ' + payload.title + '\n' + summary);
  Logger.log('✅ 주간 리포트 발송' + (ok ? ' (이미지)' : ' (글자)'));
}

// ── 자동화 실행 기록 (각 스크립트가 끝날 때 wrMarkRun_ 호출 → 스크립트 속성 RUNLOG) ──
function wrMarkRun_(key) {
  try {
    var props = PropertiesService.getScriptProperties();
    var log = JSON.parse(props.getProperty('RUNLOG') || '{}');
    var d = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    var list = (log[key] || []).filter(function (x) { return x !== d; });
    list.push(d);
    log[key] = list.slice(-15);
    props.setProperty('RUNLOG', JSON.stringify(log));
  } catch (e) { }
}

// 이번 주 평일(국내 휴장일 제외) 중 며칠 돌았는지 → '07:30 알림 5/5 · …'
function wrRunStatus_(mon) {
  var log = JSON.parse(PropertiesService.getScriptProperties().getProperty('RUNLOG') || '{}');
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'), days = [];
  for (var i = 0; i < 5; i++) {
    var d = Utilities.formatDate(new Date(mon.getTime() + i * 864e5), 'Asia/Seoul', 'yyyy-MM-dd');
    if (d > today) break;
    if (typeof PM_KR_HOLIDAYS !== 'undefined' && PM_KR_HOLIDAYS.indexOf(d) >= 0) continue;
    days.push(d);
  }
  var items = [['premarket', '07:30 알림'], ['actuals', '16:10 기록'], ['intraday', '장중 신호'], ['holdings', '보유종목'], ['dividend', '배당주기']];
  var bad = 0;
  var parts = items.map(function (it) {
    var n = days.filter(function (d) { return (log[it[0]] || []).indexOf(d) >= 0; }).length;
    // 오늘 16:10 기록·장중 신호는 리포트(17:10) 전에 끝나므로 오늘 포함
    if (n < days.length) bad++;
    return it[1] + ' ' + n + '/' + days.length;
  });
  return { text: '자동화 이번 주: ' + parts.join(' · '), ok: bad === 0 };
}

// 이번 주 월요일 00:00 (KST)
function wrMonday_(d) {
  var dow = Number(Utilities.formatDate(d, 'Asia/Seoul', 'u'));
  var s = Utilities.formatDate(new Date(d.getTime() - (dow - 1) * 864e5), 'Asia/Seoul', 'yyyy-MM-dd');
  return new Date(s + 'T00:00:00+09:00');
}

// 네이버 일봉: 이번 주 월요일 전 마지막 종가(base) → 가장 최근 종가(last)
function wrNaverWeekly_(codes, monS) {
  var out = {};
  var res = hsFetchAll_(codes.map(function (c) {
    return { url: 'https://fchart.stock.naver.com/sise.nhn?symbol=' + c + '&timeframe=day&count=15&requestType=0', muteHttpExceptions: true, headers: { 'User-Agent': HS_UA } };
  }));
  codes.forEach(function (c, i) {
    try {
      var items = res[i].getContentText('EUC-KR').match(/data="[^"]+"/g) || [];
      var base = null, last = null, monKey = monS.replace(/-/g, '');
      items.forEach(function (it) {
        var f = it.slice(6, -1).split('|'), day = f[0], close = Number(f[4]);
        if (!(close > 0)) return;
        if (day < monKey) base = close; else last = close;
      });
      if (base && last) out[c] = { base: base, last: last };
    } catch (e) { }
  });
  return out;
}

// 개인일기장 '마스터 포토폴리오' (A 이름 · B 종목 · D 평단 · E 수량 · F 현재가 · H 이름 · I 날짜 · J 종목 · K 수량 · L 금액)
function wrDiary_(monS, friS, taxOf) {
  var v = SpreadsheetApp.openById(WR_DIARY_ID).getSheetByName(WR_DIARY_TAB).getDataRange().getValues();
  var num = function (x) { return Number(String(x).replace(/[^0-9.-]/g, '')) || 0; };
  var by = {}, order = [], holdings = {};
  for (var i = 1; i < v.length; i++) {
    var r = v[i], name = String(r[0] || '').trim(), stock = String(r[1] || '').trim();
    if (name && stock) {
      var qty = num(r[4]), avg = num(r[3]), cur = num(r[5]) || avg; // 현재가가 비면 평단가 (대시보드와 같은 방식)
      if (!by[name]) { by[name] = { name: name, invest: 0, current: 0, weekDiv: 0, divNet: 0 }; order.push(name); }
      if (qty > 0) {
        by[name].invest += avg * qty; by[name].current += cur * qty;
        var k = hsNormName_(stock);
        holdings[k] = holdings[k] || { name: stock, qty: 0 };
        holdings[k].qty += qty;
      }
    }
    var dn = String(r[7] || '').trim(), dd = wrDate_(r[8]), amt = num(r[11]);
    if (dn && dd && amt > 0) {
      if (!by[dn]) { by[dn] = { name: dn, invest: 0, current: 0, weekDiv: 0, divNet: 0 }; order.push(dn); }
      by[dn].divNet += amt * (1 - 0.154 * taxOf(String(r[9] || ''), dd)); // 지금까지 받은 배당 (세후, 과세표준 기준)
      if (dd >= monS && dd <= friS) by[dn].weekDiv += amt;
    }
  }
  // 리포트에서 뺄 멤버: 이름이 Test 로 시작 + 스크립트 속성 WR_EXCLUDE (쉼표로 구분, 예: JBF)
  var excl = (PropertiesService.getScriptProperties().getProperty('WR_EXCLUDE') || '').split(',')
    .map(function (x) { return x.trim().toUpperCase(); }).filter(String);
  var members = order.map(function (n) { var m = by[n]; m.ret = m.invest > 0 ? (m.current / m.invest - 1) * 100 : 0; return m; })
    .filter(function (m) { return (m.invest > 0 || m.weekDiv > 0) && !/^test/i.test(m.name) && excl.indexOf(m.name.toUpperCase()) < 0; });
  return { members: members, holdings: holdings };
}

// 'ETF들 배당이력' E열(1주당 과세표준)로 회차별 과세 비율 → function(종목, 'yyyy-MM-dd') → 0~1
//   가까운 회차(±6일) → 같은 ETF 평균 → 없으면 1 (전액 과세)
function wrTaxRatios_(ss) {
  var sh = ss.getSheetByName('ETF들 배당이력'), map = {};
  if (sh && sh.getLastRow() > 0) {
    sh.getRange(1, 1, sh.getLastRow(), 5).getValues().forEach(function (r) {
      var amt = Number(r[2]), d = r[1] instanceof Date ? r[1].getTime() : NaN;
      if (!r[0] || !(amt > 0) || isNaN(d)) return;
      var k = hsNormName_(r[0]);
      (map[k] = map[k] || []).push({ t: d, amt: amt, tax: r[4] === '' || r[4] === null ? null : Number(r[4]) });
    });
  }
  return function (stock, ymd) {
    var list = map[hsNormName_(stock)] || [], t = new Date(ymd + 'T00:00:00+09:00').getTime(), best = null;
    list.forEach(function (h) { if (h.tax !== null && Math.abs(h.t - t) <= 6 * 864e5 && (!best || Math.abs(h.t - t) < Math.abs(best.t - t))) best = h; });
    if (best) return Math.min(1, best.tax / best.amt);
    var known = list.filter(function (h) { return h.tax !== null; });
    if (!known.length) return 1;
    var a = 0, x = 0; known.forEach(function (h) { a += h.amt; x += h.tax; });
    return a > 0 ? Math.min(1, x / a) : 1;
  };
}

function wrDate_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, 'Asia/Seoul', 'yyyy-MM-dd');
  var m = String(x || '').replace(/\s+/g, '').match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}

// 다음 주(토~다음 금) 예정 배당: ETF 배당주기(A 이름 · B 지급월 · C 1주당 · E 최근 지급일) × 클럽 보유수량
function wrNextDividends_(ss, holdings, fri) {
  var sh = ss.getSheetByName('ETF 배당주기');
  var items = [], total = 0;
  if (!sh) return { items: items, total: 0 };
  var start = new Date(fri.getTime() + 864e5), end = new Date(fri.getTime() + 8 * 864e5 - 1);
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 5).getDisplayValues().forEach(function (r) {
    var h = holdings[hsNormName_(r[0])];
    var per = Number(String(r[2]).replace(/[^0-9.]/g, '')) || 0;
    var months = String(r[1]).split(',').map(function (x) { return parseInt(x, 10); });
    var dm = String(r[4]).match(/^\d{4}-\d{2}-(\d{2})/);
    if (!h || !(per > 0) || !dm) return;
    [start, end].forEach(function (ref, idx) {
      var y = Number(Utilities.formatDate(ref, 'Asia/Seoul', 'yyyy')), mo = Number(Utilities.formatDate(ref, 'Asia/Seoul', 'M'));
      if (idx === 1 && mo === Number(Utilities.formatDate(start, 'Asia/Seoul', 'M'))) return; // 같은 달 두 번 방지
      if (months.indexOf(mo) < 0) return;
      var d = new Date(y + '-' + ('0' + mo).slice(-2) + '-' + dm[1] + 'T12:00:00+09:00');
      while (['6', '7'].indexOf(Utilities.formatDate(d, 'Asia/Seoul', 'u')) >= 0) d = new Date(d.getTime() + 864e5);
      if (d < start || d > end) return;
      var amt = per * h.qty;
      total += amt;
      items.push([Utilities.formatDate(d, 'Asia/Seoul', 'M/d') + '(' + '월화수목금토일'.charAt(Number(Utilities.formatDate(d, 'Asia/Seoul', 'u')) - 1) + ')', r[0], Math.round(amt), d.getTime()]);
    });
  });
  items.sort(function (a, b) { return a[3] - b[3]; });
  return { items: items.map(function (x) { return x.slice(0, 3); }), total: total };
}

// 이번 주 07:30 예측 오차 (실제 시가가 채워진 줄)
function wrAccuracy_(ss, monS, friS) {
  var sh = ss.getSheetByName(PM_TAB_LOG);
  if (!sh || sh.getLastRow() < 2) return { days: 0 };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 18).getDisplayValues();
  var days = {}, n = 0, abs = 0, mv = 0, hit = 0;
  v.forEach(function (r) {
    if (r[0] < monS || r[0] > friS || r[17] === '') return;
    var p = Number(r[5]), a = Number(r[17]);
    if (!isFinite(p) || !isFinite(a)) return;
    days[r[0]] = 1; n++; abs += Math.abs(p - a);
    if (p !== 0) { mv++; if ((p > 0 && a > 0) || (p < 0 && a < 0) || (Math.abs(p) < 0.05 && Math.abs(a) < 0.05)) hit++; }
  });
  return n ? { days: Object.keys(days).length, mae: r2_(abs / n), hit: mv ? Math.round(hit / mv * 100) : 0 } : { days: 0 };
}

function wrSignals_(ss, monS, friS) {
  var sh = ss.getSheetByName('장중_신호');
  if (!sh || sh.getLastRow() < 2) return { count: 0, items: [] };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getDisplayValues()
    .filter(function (r) { return r[0] >= monS && r[0] <= friS; });
  return {
    count: v.length,
    items: v.slice(-4).map(function (r) { return [r[0].slice(5).replace(/^0/, '').replace('-', '/'), r[2], r[4], Number(r[6])]; })
  };
}

function wrRequestImage_(token, payload) {
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + PM_REPO + '/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ event_type: 'weekly-image', client_payload: { data: JSON.stringify(payload) } })
  });
  if (res.getResponseCode() !== 204) throw new Error('GitHub 요청 실패 ' + res.getResponseCode());
  var url = PM_IMAGE_BASE + payload.stamp + '_W.png';
  for (var i = 0; i < 20 && Date.now() + 15000 < PM_T0 + 330000; i++) {
    Utilities.sleep(15000);
    if (UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getResponseCode() === 200) return url;
  }
  return null;
}
