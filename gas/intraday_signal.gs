/**
 * ⚡ 장중 신호 알림 — 관리시트 Apps Script (premarket_alert.gs · etf_holdings_sync.gs 와 같은 프로젝트)
 *
 * 평일 국내장(09:05~15:25) 동안 10분마다 MasterData '본체ETF' 의 실제 등락(현재가 ÷ 전일 종가 − 1)을 보고
 *   · ETF_Quant_Signals 기준 매수 %(예: -1.5) 이하로 처음 내려가면 🔵 매수 구간 진입
 *   · 기준 매도 %(예: +2) 이상으로 처음 올라가면 🔴 매도 구간 진입
 * 을 카톡(나에게 보내기)으로 알리고 '장중_신호' 탭에 기록합니다.
 *   · 같은 날 같은 ETF·같은 방향은 1번만 (기준에서 1%p 더 벌어지면 '추가 하락/상승' 으로 1번 더)
 *   · 가격: 야후 → 네이버 실시간 → 안 되면 MasterData D(전일종가)·E(현재가, GOOGLEFINANCE)
 *   · 국내 휴장일(premarket_alert.gs 의 PM_KR_HOLIDAYS)은 쉼
 *
 * ▶ 처음 한 번: previewIntraday 실행(로그만) → installIntradayTrigger 실행
 * ▶ 끄기: removeIntradayTrigger 실행
 */

var ID_TAB_LOG = '장중_신호';
var ID_STEP = 1; // 기준에서 이만큼(%p) 더 벌어지면 한 번 더 알림

function previewIntraday() { runIntraday_(true); }

function installIntradayTrigger() {
  removeIntradayTrigger();
  ScriptApp.newTrigger('intradayCheck_').timeBased().everyMinutes(10).create();
  Logger.log('✅ 장중 신호 알림 설치: 10분마다 (평일 09:05~15:25 에만 동작)');
}

function removeIntradayTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'intradayCheck_') ScriptApp.deleteTrigger(t);
  });
}

function intradayCheck_() {
  // 자동 배포 실패 알림 (deploy_watch.gs, 30분에 한 번만 확인 · 실패해도 장중 신호에는 영향 없음)
  if (typeof dwCheckDeploy_ === 'function') { try { dwCheckDeploy_(false); } catch (e) { Logger.log('⚠️ 배포 확인 실패: ' + e); } }
  var now = new Date();
  var dow = Number(Utilities.formatDate(now, 'Asia/Seoul', 'u'));
  var hm = Utilities.formatDate(now, 'Asia/Seoul', 'HHmm');
  if (dow >= 6 || hm < '0905' || hm > '1525') return;
  if (typeof pmKrHoliday_ === 'function' && pmKrHoliday_()) return;
  runIntraday_(false);
  if (typeof wrMarkRun_ === 'function' && hm >= '1500') wrMarkRun_('intraday'); // 장 끝날 무렵까지 돌았으면 그날 정상
}

function runIntraday_(dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(HS_TAB_MASTER);
  var etfs = pmEtfList_(master);
  var params = pmParams_(ss);
  var quotes = idQuotes_(etfs, master);
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var time = Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm');

  var props = PropertiesService.getScriptProperties();
  var sentKey = 'ID_SENT_' + today;
  var sent = JSON.parse(props.getProperty(sentKey) || '{}');

  var hits = [];
  etfs.forEach(function (e) {
    var q = quotes[e.code];
    if (!q || !(q.prev > 0) || !(q.price > 0)) return;
    var pct = (q.price / q.prev - 1) * 100;
    var p = params[hsNormName_(e.name)] || HS_DEFAULT_PARAMS;
    var side = pct <= p.buy ? 'BUY' : (pct >= p.sell ? 'SELL' : '');
    var line = (side ? (side === 'BUY' ? '🔵' : '🔴') : '⚪') + ' ' + e.name + ' ' + pmPct_(pct) + ' (' + Math.round(q.price).toLocaleString() + '원, 기준 ' + p.buy + ' / +' + p.sell + ', ' + q.src + ')';
    if (dryRun) Logger.log(line);
    if (!side) return;
    // 같은 방향으로 몇 단계째인지: 1단계 = 기준 통과, 2단계 = 기준에서 1%p 더
    var th = side === 'BUY' ? p.buy : p.sell;
    var level = 1 + Math.floor(Math.abs(pct - th) / ID_STEP);
    var k = e.code + ':' + side;
    if ((sent[k] || 0) >= level) return;
    hits.push({ e: e, q: q, pct: pct, side: side, th: th, level: level, first: !sent[k], key: k });
  });

  if (dryRun) { Logger.log('[미리보기] 새로 알릴 신호 ' + hits.length + '건 (카톡·시트 안 씀)'); return; }
  if (!hits.length) return;

  // 카톡 (200자 제한 → 나눠서)
  var msgs = [], cur = { text: '⚡ 장중 신호 ' + time, hits: [] };
  hits.forEach(function (h) {
    var tag = h.side === 'BUY' ? (h.first ? '🔵 매수 구간 진입' : '🔵 추가 하락') : (h.first ? '🔴 매도 구간 진입' : '🔴 추가 상승');
    var add = '\n' + tag + '\n' + pmShort_(h.e.name) + ' ' + pmPct_(h.pct) + ' · ' + Math.round(h.q.price).toLocaleString() + '원 (기준 ' + (h.th > 0 ? '+' : '') + h.th + '%)';
    if ((cur.text + add).length > PM_KAKAO_MAX) { msgs.push(cur); cur = { text: '⚡ 장중 신호 ' + time + ' (계속)', hits: [] }; }
    cur.text += add; cur.hits.push(h);
  });
  msgs.push(cur);
  // 보낸 메시지에 들어간 신호만 '보냄'으로 기록 → 중간에 카톡이 실패해도 이미 간 알림이 10분마다 반복되지 않게
  var done = [], failed = null;
  for (var i = 0; i < msgs.length; i++) {
    try { kakaoSendToMe_(msgs[i].text); done = done.concat(msgs[i].hits); Utilities.sleep(300); }
    catch (e) { failed = e; break; }
  }
  done.forEach(function (h) { sent[h.key] = h.level; });
  props.setProperty(sentKey, JSON.stringify(sent));
  idCleanupProps_(props, sentKey);
  if (done.length) idWriteLog_(ss, today, time, done);
  Logger.log('⚡ 장중 신호 ' + done.length + '/' + hits.length + '건 발송');
  if (failed) throw failed; // 못 보낸 신호는 다음 실행(10분 뒤)에 다시 시도
}

// 현재가·전일 종가: 야후(1분봉 메타) → MasterData D·E
function idQuotes_(etfs, master) {
  var out = {};
  var res = hsFetchAll_(etfs.map(function (e) {
    return { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + e.code + '.KS?range=1d&interval=5m', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
  }));
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  etfs.forEach(function (e, i) {
    try {
      var m = JSON.parse(res[i].getContentText()).chart.result[0].meta;
      var t = Utilities.formatDate(new Date(m.regularMarketTime * 1000), 'Asia/Seoul', 'yyyy-MM-dd');
      if (t === today && m.regularMarketPrice > 0 && m.chartPreviousClose > 0) out[e.code] = { price: m.regularMarketPrice, prev: m.chartPreviousClose, src: '야후' };
    } catch (err) { }
  });
  // 야후에 없는 종목(영문 섞인 새 코드 등) → 네이버 실시간
  var miss = etfs.filter(function (e) { return !out[e.code]; }).map(function (e) { return e.code; });
  if (miss.length) {
    try {
      var nv = UrlFetchApp.fetch('https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:' + miss.join(','), { muteHttpExceptions: true, headers: { 'User-Agent': HS_UA } });
      JSON.parse(nv.getContentText('EUC-KR')).result.areas[0].datas.forEach(function (x) {
        if (x.nv > 0 && x.sv > 0) out[String(x.cd).toUpperCase()] = { price: x.nv, prev: x.sv, src: '네이버' };
      });
    } catch (err) { }
  }
  master.getRange(3, 1, master.getLastRow() - 2, 5).getValues().forEach(function (r) {
    if (String(r[0]).trim() !== '본체ETF') return;
    var code = String(r[1]).replace(/^KRX:/i, '').trim().toUpperCase();
    var prev = Number(String(r[3]).replace(/,/g, '')), price = Number(String(r[4]).replace(/,/g, ''));
    if (!out[code] && prev > 0 && price > 0) out[code] = { price: price, prev: prev, src: '시트' };
  });
  return out;
}

function idWriteLog_(ss, today, time, hits) {
  var sh = ss.getSheetByName(ID_TAB_LOG);
  if (!sh) {
    sh = ss.insertSheet(ID_TAB_LOG);
    sh.getRange(1, 1, 1, 8).setValues([['날짜', '시각', 'ETF', '코드', '신호', '단계', '등락(%)', '가격']]);
    sh.setFrozenRows(1);
  }
  var rows = hits.map(function (h) { return [today, time, h.e.name, h.e.code, h.side, h.level, Math.round(h.pct * 100) / 100, Math.round(h.q.price)]; });
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, 4).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, 8).setValues(rows);
}

// 지난 날짜의 발송 기록(스크립트 속성) 정리
function idCleanupProps_(props, keep) {
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf('ID_SENT_') === 0 && k !== keep) props.deleteProperty(k);
  });
}
