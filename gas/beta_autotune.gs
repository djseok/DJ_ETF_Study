/**
 * 🎯 베타(β) 자동 보정 — 관리시트 Apps Script (premarket_alert.gs 와 같은 프로젝트)
 *
 * 매주 금요일 16:10, 실제 시가 기록(recordActualsDaily_) 직후에 한 번 돕니다. 새 트리거 설치는 필요 없어요.
 *   1) '개장전_예측' 탭의 최근 20영업일 기록(실제 시가가 채워진 날)만 봅니다
 *   2) 미국 종목 ETF만 (기록의 미국비중 > 0). 국내 ETF는 β가 아니라 EWY 입력 문제라 건드리지 않음
 *   3) 시가 = 전일종가(시가등락 0.00%) 줄은 뺍니다 (동시호가 체결이 없어 생기는 값으로 추정)
 *   4) 역산 β = Σ(x·y) ÷ Σ(x²)
 *        y = (1 + 실제 시가등락) ÷ (1 + 환율변동 × 해외비중) − 1     (환율 몫은 β와 무관하니 뺌)
 *        x = 구성종목 변동 + 선물변동 × 미국비중                       (구성종목 변동은 기록된 예상등락에서 공식을 거꾸로 풀어 복원)
 *   5) 목표 = 역산 β 를 0.5~1.5 로 자른 값. 지금 β 에서 목표 쪽으로 한 주에 최대 ±0.1 만 옮김
 *   6) 쓸 수 있는 줄이 10개 미만이면 그 ETF는 그대로
 *   7) 바꾼 값은 ETF_Quant_Signals 의 '베타' 행 C열에 쓰고, '베타_자동보정' 탭에 전·후를 남김 (바꾸지 않은 ETF도 남김)
 *
 * 근거: reviews 2026-11-02 개장전 예측 20영업일 분석 — 지난 20일에 이 규칙을 적용해 보면 미국 ETF 오차 0.81 → 0.77%p.
 *
 * ▶ 직접 돌려보기
 *   previewBetaAutotune  : 계산만 하고 로그로 보여줌 (시트 안 바꿈)
 *   runBetaAutotune      : 지금 바로 한 번 적용 (요일 무관)
 * ▶ 끄기: 스크립트 속성 BETA_AUTOTUNE = off
 */

var BT_TAB_LOG = '베타_자동보정';
var BT_WINDOW_DAYS = 20;   // 최근 몇 영업일을 볼지
var BT_MIN_ROWS = 10;      // 이보다 적으면 보정 안 함
var BT_STEP = 0.1;         // 한 주 최대 변화
var BT_MIN = 0.5, BT_MAX = 1.5;
var BT_LOG_HEADER = ['실행일', 'ETF', '이전 β', '역산 β', '목표(0.5~1.5)', '새 β', '사용 줄', '기간', '메모'];

function previewBetaAutotune() { btRun_(true); }
function runBetaAutotune() { btRun_(false); }

// recordActualsDaily_ 가 부름: 금요일만, 끄기 설정이 없을 때
function betaAutotuneWeekly_() {
  if (Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'u')) !== 5) return;
  if (String(PropertiesService.getScriptProperties().getProperty('BETA_AUTOTUNE') || '').toLowerCase() === 'off') { Logger.log('ℹ️ 베타 자동 보정 꺼짐 (BETA_AUTOTUNE=off)'); return; }
  btRun_(false);
}

function btRun_(dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(PM_TAB_LOG);
  var sig = ss.getSheetByName(HS_TAB_SIGNAL);
  if (!log || !sig || log.getLastRow() < 2) { Logger.log('ℹ️ 베타 자동 보정: 기록 없음'); return []; }

  var rows = btParseLog_(log.getRange(2, 1, log.getLastRow() - 1, 21).getDisplayValues());
  var days = btRecentDays_(rows, BT_WINDOW_DAYS);
  if (!days.length) { Logger.log('ℹ️ 베타 자동 보정: 실제값이 채워진 날 없음'); return []; }
  var inWin = {}; days.forEach(function (d) { inWin[d] = true; });

  // ETF_Quant_Signals '베타' 행 위치와 지금 값
  var sv = sig.getRange(1, 1, sig.getLastRow(), 3).getValues();
  var betaRow = {}, cur = null;
  sv.forEach(function (r, i) {
    var a = String(r[0]).trim();
    if (a.indexOf('■') === 0) cur = hsNormName_(a.replace('■', ''));
    else if (cur && a === '베타' && betaRow[cur] === undefined) betaRow[cur] = { row: i + 1, beta: Number(r[2]) };
  });

  var byName = {};
  rows.forEach(function (r) { if (inWin[r.date]) (byName[r.name] = byName[r.name] || []).push(r); });

  var period = days[0] + '~' + days[days.length - 1];
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var results = [];
  Object.keys(byName).forEach(function (name) {
    var list = byName[name];
    if (!list.some(function (r) { return r.us > 0; })) return;              // 국내 ETF 제외
    var b = betaRow[hsNormName_(name)];
    if (!b || !isFinite(b.beta) || b.beta <= 0) {
      results.push({ name: name, before: '', fit: NaN, target: NaN, after: '', n: 0, note: 'ETF_Quant_Signals 에 베타 행 없음' });
      return;
    }
    var use = list.filter(function (r) { return r.us > 0 && r.open !== 0; });
    var fit = btFitBeta_(use);
    var step = btNextBeta_(b.beta, fit, use.length);
    results.push({ name: name, before: b.beta, fit: fit, target: step.target, after: step.beta, n: use.length, note: step.note, row: b.row });
  });

  results.forEach(function (x) {
    Logger.log((x.after !== '' && x.after !== x.before ? '🎯 ' : '· ') + x.name + ' β ' + x.before + ' → ' + x.after +
      ' (역산 ' + (isFinite(x.fit) ? x.fit.toFixed(2) : '-') + ', ' + x.n + '줄' + (x.note ? ', ' + x.note : '') + ')');
  });
  if (dryRun) { Logger.log('ℹ️ 미리보기라 시트는 바꾸지 않았어요. 기간 ' + period); return results; }

  var changed = results.filter(function (x) { return x.row && x.after !== x.before; });
  changed.forEach(function (x) { sig.getRange(x.row, 3).setValue(x.after); });

  var out = results.map(function (x) {
    return [today, x.name, x.before, isFinite(x.fit) ? r2_(x.fit) : '', isFinite(x.target) ? r2_(x.target) : '', x.after, x.n, period, x.note || (x.after !== x.before ? '변경' : '그대로')];
  });
  var lt = ss.getSheetByName(BT_TAB_LOG);
  if (!lt) { lt = ss.insertSheet(BT_TAB_LOG); lt.getRange(1, 1, 1, BT_LOG_HEADER.length).setValues([BT_LOG_HEADER]); lt.setFrozenRows(1); }
  if (out.length) lt.getRange(lt.getLastRow() + 1, 1, out.length, BT_LOG_HEADER.length).setValues(out);
  Logger.log('✅ 베타 자동 보정: ' + changed.length + '개 변경 / ' + results.length + '개 검토 (' + period + ')');

  if (changed.length && typeof kakaoSendToMe_ === 'function') {
    try {
      var msg = '🎯 베타 자동 보정 ' + changed.length + '개: ' + changed.map(function (x) { return pmShort_(x.name) + ' ' + x.before + '→' + x.after; }).join(', ');
      if (msg.length > PM_KAKAO_MAX) msg = '🎯 베타 자동 보정 ' + changed.length + '개 (관리시트 \'' + BT_TAB_LOG + '\' 탭)';
      kakaoSendToMe_(msg);
    } catch (e) { Logger.log('⚠️ 카톡 알림 실패: ' + e); }
  }
  return results;
}

// '개장전_예측' 표시값 → 숫자 (비율). 실제 시가가 없는 줄은 뺌
function btParseLog_(v) {
  var num = function (s) { var t = String(s).replace(/[,%\s]/g, ''); return t === '' ? NaN : Number(t); };
  var out = [];
  v.forEach(function (r) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r[0]).trim()) || r[16] === '' || r[17] === '') return;
    var x = { date: String(r[0]).trim(), name: String(r[1]).trim(), pred: num(r[5]) / 100, us: num(r[9]) / 100, fut: num(r[11]) / 100,
      fx: num(r[12]) / 100, fs: num(r[13]) / 100, beta: num(r[14]), open: num(r[17]) / 100 };
    if ([x.pred, x.us, x.fut, x.fx, x.fs, x.beta, x.open].every(isFinite) && x.beta > 0) out.push(x);
  });
  return out;
}

function btRecentDays_(rows, n) {
  var set = {};
  rows.forEach(function (r) { set[r.date] = true; });
  return Object.keys(set).sort().slice(-n);
}

// 역산 β (원점 회귀). 줄이 없거나 x 가 모두 0 이면 NaN
function btFitBeta_(rows) {
  var sxy = 0, sxx = 0;
  rows.forEach(function (r) {
    var raw = ((1 + r.pred) / (1 + r.beta * r.fut * r.us) / (1 + r.fx * r.fs) - 1) / r.beta;
    var y = (1 + r.open) / (1 + r.fx * r.fs) - 1;
    var x = raw + r.fut * r.us;
    sxy += x * y; sxx += x * x;
  });
  return sxx > 0 ? sxy / sxx : NaN;
}

// 다음 β: 목표(0.5~1.5) 쪽으로 최대 ±0.1, 소수 둘째 자리
function btNextBeta_(cur, fit, n) {
  if (n < BT_MIN_ROWS) return { beta: cur, target: NaN, note: '줄 부족(' + n + '<' + BT_MIN_ROWS + ')' };
  if (!isFinite(fit)) return { beta: cur, target: NaN, note: '역산 불가' };
  var target = Math.min(BT_MAX, Math.max(BT_MIN, fit));
  var next = cur + Math.max(-BT_STEP, Math.min(BT_STEP, target - cur));
  next = Math.round(Math.min(BT_MAX, Math.max(BT_MIN, next)) * 100) / 100;
  return { beta: next, target: target, note: '' };
}
