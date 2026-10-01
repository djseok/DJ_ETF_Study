/**
 * 📦 ETF 보유종목(PDF) 자동 수집 → 예측 엔진 자동 갱신 — 관리시트 Apps Script
 *
 * 매일 아침
 *   ① MasterData 의 '본체ETF' 줄마다 WiseReport 에서 전체 보유종목(PDF)을 받아
 *   ② 종목명 → 티커를 찾고 (매핑테이블 · MasterData → 없으면 야후/네이버 검색 후 매핑테이블에 '자동'으로 추가)
 *   ③ 비중이 없는 해외주식 ETF 는 주식수 × 현재가(원화 환산)로 비중을 계산해
 *   ④ 'PDF_자동' 탭에 저장하고, MasterData 에 없는 종목은 가격 수식과 함께 추가한 뒤
 *   ⑤ 'ETF_Quant_Signals' 를 최신 보유종목으로 다시 만듭니다. (기준·베타 값은 그대로 유지, 쓰기 전 백업)
 *
 * ▶ 처음 한 번
 *   1) previewHoldings   : 무엇이 바뀔지 로그로만 확인 (시트에 쓰지 않음)
 *   2) syncHoldings      : 실제 갱신 (PDF_자동 · 매핑테이블 · MasterData · ETF_Quant_Signals)
 *   3) installHoldingsTrigger : 매일 아침 6시대 자동 실행
 *
 * ▶ 새 ETF 추가: MasterData 맨 아래에 A '본체ETF', B 'KRX:코드', C 이름, H 대분류(성장/배당), I 중분류(해외/국내)만 적으면
 *   다음 날 아침 자동으로 ⓐ D~G 가격 수식 ⓑ H가 '배당'이면 'ETF 배당주기'에 등록
 *   ⓒ 이름에 '커버드콜'이 있고 H가 '배당'이면 마스터시트 '관리코드'에도 등록 (C열 주소는 밤 10시 자동 채우기)
 *
 * ▶ 티커를 못 찾은 종목이 있으면
 *   '매핑테이블' A열에 로그에 나온 종목명 그대로, B열에 티커(예: NVDA, KRX:005930, TYO:6981)를 적고 다시 실행
 */

var HS_TAB_MASTER = 'MasterData';
var HS_TAB_MAP = '매핑테이블';
var HS_TAB_PDF = 'PDF_자동';
var HS_TAB_SIGNAL = 'ETF_Quant_Signals';
var HS_TAB_SIGNAL_BACKUP = 'ETF_Quant_Signals_백업';
var HS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
var HS_TAB_SCHEDULE = 'ETF 배당주기';
var HS_MASTER_SHEET_ID = '1UcY_X1GOMQAg9ceojcs2paiR6uIsXYV7NMy8IID7TDE'; // 동진_웹송출용_마스터시트 (관리코드 탭)
var HS_DEFAULT_PARAMS = { buy: -1.5, sell: 2, beta: 1 }; // 새 ETF 의 기본 기준·베타

// 현금·파생 분류 (가격 계산에서 제외)
var HS_CASH_RE = /(현금|예금|증거금|미수|미지급|원천세|분배금|콜론|\bCASH\b|\bRP\b)/i;
var HS_DERIV_RE = /(선물|옵션|위클리|FUTURE|\bFUT\b|E-?MINI|\bCALL\b|\bPUT\b|\bINDEX$|\s[CP]\s\d{3,}|\d{2}\/\d{2}\/\d{2,4})/i;

function previewHoldings() { runHoldings_(true); }
function syncHoldings() { runHoldings_(false); if (typeof wrMarkRun_ === 'function') wrMarkRun_('holdings'); }

function installHoldingsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncHoldings') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncHoldings').timeBased().everyDays(1).atHour(6).create();
  Logger.log('✅ 매일 아침 6시대 보유종목 자동 갱신 트리거 설치');
}

// =========================================================
// 본체
// =========================================================
function runHoldings_(dryRun) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(HS_TAB_MASTER);
  var mapSheet = ss.getSheetByName(HS_TAB_MAP);
  var t0 = Date.now();

  hsRegisterNewEtfs_(ss, master, dryRun);
  var targets = hsTargets_(master);
  Logger.log('대상 ETF ' + targets.length + '개');

  // 1) 보유종목 받기
  var responses = hsFetchAll_(targets.map(function (t) {
    return { url: 'https://navercomp.wisereport.co.kr/v2/ETF/index.aspx?cmp_cd=' + t.code, headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
  }));
  targets.forEach(function (t, i) { t.rows = hsParseWise_(responses[i]); t.date = t.rows.length ? t.rows[0].date : ''; });

  // 2) 이름 → 티커
  var index = hsNameIndex_(master, mapSheet);
  var unresolved = {};
  targets.forEach(function (t) {
    t.rows.forEach(function (r) {
      r.kind = HS_CASH_RE.test(r.name) ? '현금' : (HS_DERIV_RE.test(r.name) ? '파생' : '');
      if (r.kind) return;
      var hit = index.byName[hsNormName_(r.name)];
      if (hit) { r.ticker = hit.ticker; r.mapSrc = hit.src; } else unresolved[r.name] = true;
    });
  });
  var found = hsSearchTickers_(Object.keys(unresolved)); // { 이름: {ticker, src} }
  var newMaps = [];
  targets.forEach(function (t) {
    t.rows.forEach(function (r) {
      if (r.kind || r.ticker) return;
      var f = found[r.name];
      if (f) { r.ticker = f.ticker; r.mapSrc = f.src; }
      else { r.kind = '미확인'; }
    });
  });
  Object.keys(found).forEach(function (n) { newMaps.push([n, found[n].ticker, found[n].src, hsToday_()]); });

  // 이미 MasterData 에 같은 코드가 있으면 그 표기(KRX:000660 / 000660 등)를 그대로 사용 → 중복 방지
  targets.forEach(function (t) {
    t.rows.forEach(function (r) {
      if (!r.ticker) return;
      var existing = index.byCode[hsCodeKey_(r.ticker)];
      if (existing) r.ticker = existing;
      r.market = hsMarket_(r.ticker);
    });
  });

  // 3) 비중: 공시 비중이 있으면 그대로, 없으면 주식수 × 현재가(원화)로 계산
  var needPrice = {};
  targets.forEach(function (t) {
    t.hasWeight = t.rows.some(function (r) { return r.weight > 0 && !r.kind; });
    if (!t.hasWeight) t.rows.forEach(function (r) { if (r.ticker && r.shares > 0) needPrice[r.ticker] = true; });
  });
  var quotes = hsQuotes_(Object.keys(needPrice)); // { ticker: 원화가격 }
  targets.forEach(function (t) {
    if (t.hasWeight) { t.rows.forEach(function (r) { r.wSrc = r.weight > 0 ? '공시' : ''; }); return; }
    var total = 0;
    t.rows.forEach(function (r) {
      r.value = (r.ticker && r.shares > 0 && quotes[r.ticker]) ? r.shares * quotes[r.ticker] : 0;
      total += r.value;
    });
    t.rows.forEach(function (r) {
      r.weight = total > 0 && r.value > 0 ? r.value / total * 100 : 0;
      r.wSrc = r.value > 0 ? '계산' : (r.ticker && !r.kind ? '가격없음' : '');
    });
  });

  // 4) 로그
  var newMaster = hsNewMasterRows_(targets, index);
  targets.forEach(function (t) {
    var eq = t.rows.filter(function (r) { return !r.kind; });
    var sumW = t.rows.reduce(function (s, r) { return s + (r.weight || 0); }, 0);
    var miss = t.rows.filter(function (r) { return r.kind === '미확인' || r.wSrc === '가격없음'; });
    Logger.log((t.rows.length ? '📦 ' : '❌ ') + t.name + ' (' + t.code + ') ' + (t.date || '-') + ' | 종목 ' + eq.length +
      '개 | 비중 ' + (t.hasWeight ? '공시' : '계산') + ' 합계 ' + sumW.toFixed(1) + '%' +
      (miss.length ? ' | ⚠️ 제외 ' + miss.length + '개: ' + miss.slice(0, 8).map(function (r) { return r.name + (r.kind === '미확인' ? '(티커?)' : '(가격?)'); }).join(', ') : ''));
    if (t.rows.length) {
      var top = eq.slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); }).slice(0, 5);
      Logger.log('    상위: ' + top.map(function (r) { return r.name + '→' + (r.ticker || '?') + ' ' + (r.weight || 0).toFixed(2) + '%'; }).join(' / '));
    }
  });
  Logger.log('🔎 새로 찾은 티커 ' + newMaps.length + '개' + (newMaps.length ? ': ' + newMaps.slice(0, 40).map(function (m) { return m[0] + '→' + m[1]; }).join(', ') : ''));
  var unknown = {};
  targets.forEach(function (t) { t.rows.forEach(function (r) { if (r.kind === '미확인') unknown[r.name] = true; }); });
  if (Object.keys(unknown).length) Logger.log('❓ 티커를 못 찾은 종목 (매핑테이블에 직접 추가): ' + Object.keys(unknown).join(', '));
  Logger.log('➕ MasterData 에 추가할 종목 ' + newMaster.length + '개' + (newMaster.length ? ': ' + newMaster.slice(0, 40).map(function (r) { return r[1]; }).join(', ') : ''));
  Logger.log('⏱ ' + Math.round((Date.now() - t0) / 1000) + '초');
  if (dryRun) { Logger.log('[미리보기] 시트에는 쓰지 않았어요.'); return; }

  // 5) 쓰기 — 받아온 게 하나도 없으면 아무것도 바꾸지 않음
  var ok = targets.filter(function (t) { return t.rows.length; });
  if (!ok.length) { Logger.log('❌ 보유종목을 하나도 받지 못해 중단 (기존 시트 유지)'); return; }
  if (newMaps.length) mapSheet.getRange(mapSheet.getLastRow() + 1, 1, newMaps.length, 4).setValues(newMaps);
  hsFixMasterCodes_(master);
  if (newMaster.length) hsAppendMaster_(master, newMaster);
  hsWritePdf_(ss, targets);
  hsRebuildSignals_(ss, targets);
  Logger.log('✅ 갱신 완료 (' + Math.round((Date.now() - t0) / 1000) + '초)');
}

// =========================================================
// 대상 ETF · WiseReport
// =========================================================
// 새로 적은 본체ETF 줄 마무리: 가격 수식 · 배당주기 등록 · 관리코드 등록
function hsRegisterNewEtfs_(ss, master, dryRun) {
  var last = master.getLastRow();
  if (last < 3) return;
  var v = master.getRange(3, 1, last - 2, 9).getValues();
  var norm = function (x) { return String(x || '').replace(/\s+/g, '').replace(/커브드/g, '커버드').toUpperCase(); };

  var schedule = ss.getSheetByName(HS_TAB_SCHEDULE);
  var schedNames = {};
  if (schedule && schedule.getLastRow() >= 2) schedule.getRange(2, 1, schedule.getLastRow() - 1, 1).getValues().forEach(function (r) { schedNames[norm(r[0])] = true; });
  var codeSheet = null, codeKeys = {};
  try {
    codeSheet = SpreadsheetApp.openById(HS_MASTER_SHEET_ID).getSheetByName('관리코드');
    if (codeSheet && codeSheet.getLastRow() >= 1) codeSheet.getRange(1, 1, codeSheet.getLastRow(), 2).getDisplayValues().forEach(function (r) { codeKeys[norm(r[0])] = true; codeKeys[norm(r[1])] = true; });
  } catch (e) { Logger.log('⚠️ 마스터시트 관리코드 탭을 열 수 없어요: ' + e); }

  var log = [];
  v.forEach(function (r, i) {
    if (String(r[0]).trim() !== '본체ETF' || !r[1] || !r[2]) return;
    var row = i + 3, name = String(r[2]).trim(), code = String(r[1]).replace(/^KRX:/i, '').trim().toUpperCase();
    var isDiv = String(r[7]).trim() === '배당';

    // ⓐ 가격 수식 (D열이 비어 있을 때만)
    if (r[3] === '' || r[3] === null) {
      log.push('💲 ' + name + ': MasterData ' + row + '행 D~G 가격 수식');
      if (!dryRun) master.getRange(row, 4, 1, 4).setValues([[
        '=IFERROR(GOOGLEFINANCE(SUBSTITUTE($B' + row + ',"KRX:",""), "closeyest"), 0)',
        '=IFERROR(GOOGLEFINANCE(SUBSTITUTE($B' + row + ',"KRX:",""), "price"), D' + row + ')',
        '=D' + row, '=E' + row]]);
    }
    // ⓑ 배당주기 등록
    if (isDiv && schedule && !schedNames[norm(name)]) {
      log.push('📅 ' + name + ': ETF 배당주기에 등록 (지급월·평균은 아침 7시 자동 갱신)');
      if (!dryRun) {
        var sr = schedule.getLastRow() + 1;
        schedule.getRange(sr, 1, 1, 4).setValues([[name, '',
          "=IFERROR(AVERAGEIF('ETF들 배당이력'!$A$1:$A, A" + sr + ", 'ETF들 배당이력'!$C$1:$C), 0)", '신규 (자동 등록 ' + hsToday_() + ')']]);
      }
      schedNames[norm(name)] = true;
    }
    // ⓒ 관리코드 등록 (월배당 커버드콜)
    if (isDiv && /커버드콜|커브드콜/.test(name) && codeSheet && !codeKeys[norm(name)] && !codeKeys[norm(code)]) {
      log.push('🧩 ' + name + ': 마스터시트 관리코드에 등록 (C열 주소는 밤 10시, 배당 수집은 자정 봇)');
      if (!dryRun) {
        var cr = codeSheet.getLastRow() + 1;
        codeSheet.getRange(cr, 2).setNumberFormat('@');
        codeSheet.getRange(cr, 1, 1, 2).setValues([[name, code]]);
      }
      codeKeys[norm(name)] = true; codeKeys[norm(code)] = true;
    }
  });
  if (log.length) Logger.log('🆕 새 ETF 등록' + (dryRun ? ' (미리보기)' : '') + '\n' + log.join('\n'));
}

function hsTargets_(master) {
  var v = master.getRange(3, 1, master.getLastRow() - 2, 3).getValues();
  return v.filter(function (r) { return String(r[0]).trim() === '본체ETF' && r[1]; })
    .map(function (r) { return { code: String(r[1]).replace(/^KRX:/i, '').trim().toUpperCase(), name: String(r[2]).trim(), rows: [] }; });
}

function hsParseWise_(res) {
  if (!res || res.getResponseCode() !== 200) return [];
  var html = res.getContentText();
  var i = html.indexOf('var CU_data = ');
  if (i < 0) return [];
  var arr = (JSON.parse(html.substring(i + 14).split(';')[0]).grid_data) || [];
  return arr.map(function (x, k) {
    return {
      no: k + 1, name: String(x.STK_NM_KOR || '').trim(), shares: Number(x.AGMT_STK_CNT) || 0,
      weight: x.ETF_WEIGHT === null || x.ETF_WEIGHT === undefined || x.ETF_WEIGHT === '' ? 0 : Number(x.ETF_WEIGHT), date: x.TRD_DT || ''
    };
  }).filter(function (r) { return r.name; });
}

// =========================================================
// 이름 → 티커
// =========================================================
// 대소문자·기호·흔한 회사 접미어 무시 (단, CL A / CL C 같은 주식 종류는 구분)
function hsNormName_(s) {
  var t = String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/\(.*?\)/g, ' ')
    .replace(/[^0-9A-Z가-힣]+/g, ' ').trim().split(' ');
  var drop = { INC: 1, CORP: 1, CORPORATION: 1, CO: 1, LTD: 1, PLC: 1, NV: 1, SA: 1, AG: 1, THE: 1, COMPANY: 1, LIMITED: 1, HOLDINGS: 1, HOLDING: 1, GROUP: 1, SE: 1, ADR: 1, SPONSORED: 1, SHS: 1 };
  return t.filter(function (w) { return w && !drop[w]; }).join('');
}

// 셀 값 → 티커 문자열 (숫자로 저장된 국내 코드 88980 → '088980')
function hsTickerStr_(v) {
  var t = String(v === null || v === undefined ? '' : v).trim();
  if (/^\d{1,5}$/.test(t)) t = ('000000' + t).slice(-6);
  return t;
}

// 코드 비교용: KRX:000660 / 000660 / 000660.KS → 000660, TYO:6981 / 6981.T → 6981.T, BRK.B / BRK-B → BRK-B
function hsCodeKey_(ticker) {
  var t = hsTickerStr_(ticker).toUpperCase();
  var m = t.match(/^(?:KRX:|KOSDAQ:)?(\d[0-9A-Z]{5})(?:\.K[SQ])?$/);
  if (m) return m[1];
  m = t.match(/^TYO:(\w+)$/); if (m) return m[1] + '.T';
  m = t.match(/^TPE:(\w+)$/); if (m) return m[1] + '.TW';
  m = t.match(/^HKG:(\w+)$/); if (m) return m[1] + '.HK';
  m = t.match(/^SHE:(\w+)$/); if (m) return m[1] + '.SZ';
  m = t.match(/^SHA:(\w+)$/); if (m) return m[1] + '.SS';
  if (/\.(T|TW|HK|SZ|SS)$/.test(t)) return t;
  return t.replace(/\./g, '-');
}

function hsMarket_(ticker) {
  var k = hsCodeKey_(ticker);
  if (/^\d[0-9A-Z]{5}$/.test(k)) return '한국';
  if (/\.T$/.test(k)) return '일본';
  if (/\.TW$/.test(k)) return '대만';
  if (/\.HK$/.test(k)) return '홍콩';
  if (/\.(SZ|SS)$/.test(k)) return '중국';
  return '미국';
}

function hsNameIndex_(master, mapSheet) {
  var byName = {}, byCode = {};
  var m = master.getRange(3, 1, master.getLastRow() - 2, 3).getValues();
  m.forEach(function (r) {
    if (!r[1] || String(r[0]).trim() === '지표' || String(r[0]).trim() === '본체ETF') return;
    var tk = hsTickerStr_(r[1]);
    byCode[hsCodeKey_(tk)] = byCode[hsCodeKey_(tk)] || tk;
    var n = hsNormName_(r[2]);
    if (n && !byName[n]) byName[n] = { ticker: tk, src: 'MasterData' };
  });
  if (mapSheet && mapSheet.getLastRow() >= 2) {
    mapSheet.getRange(2, 1, mapSheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
      var n = hsNormName_(r[0]);
      if (n && r[1]) byName[n] = { ticker: hsTickerStr_(r[1]), src: '매핑테이블' }; // 매핑테이블이 우선 (아래 줄이 위 줄보다 우선)
    });
  }
  return { byName: byName, byCode: byCode };
}

// 못 찾은 이름: 한글 → 네이버 자동완성, 영문 → 야후 검색
function hsSearchTickers_(names) {
  var out = {};
  if (!names.length) return out;
  var reqs = names.map(function (n) {
    if (/[가-힣]/.test(n)) return { url: 'https://ac.stock.naver.com/ac?q=' + encodeURIComponent(n) + '&target=stock%2Cetf', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
    // 검색어 다듬기: '/THE', 'ORD.', 'Equity', '-CLASS A', '-A' 같은 꼬리 제거
    var q = n.replace(/\/.*$/, '').replace(/\b(EQUITY|ORD)\b\.?/gi, ' ')
      .replace(/[-\s]+CL(?:ASS)?\s+[A-C]\b.*$/i, '').replace(/-CL(?:ASS)?[A-C]?\b.*$/i, '')
      .replace(/\s*-\s*[A-C]$/i, '').replace(/[.\s]+$/, '').replace(/\s+/g, ' ').trim();
    return { url: 'https://query2.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=6&newsCount=0', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
  });
  var res = hsFetchAll_(reqs);
  names.forEach(function (n, i) {
    try {
      if (!res[i] || res[i].getResponseCode() !== 200) return;
      var j = JSON.parse(res[i].getContentText());
      if (/[가-힣]/.test(n)) {
        var items = (j.items || []).filter(function (x) { return x.code && /^\d[0-9A-Z]{5}$/.test(x.code); });
        var exact = items.filter(function (x) { return hsNormName_(x.name) === hsNormName_(n); })[0] || items[0];
        if (exact) out[n] = { ticker: exact.code, src: '자동(네이버)' }; // 국내는 6자리 코드 그대로 (GOOGLEFINANCE 가 코스피·코스닥 모두 인식)
      } else {
        // 주식(EQUITY) 우선 — 이름에 ETF/TRUST/FUND 가 있을 때만 ETF 허용 (예: TESLA → TSLY(ETF) 오답 방지)
        var wantEtf = /\b(ETF|TRUST|FUND)\b/i.test(n);
        var qs = (j.quotes || []).filter(function (x) {
          return x.symbol && (x.quoteType === 'EQUITY' || (wantEtf && x.quoteType === 'ETF')) && x.symbol.charAt(0) !== '^';
        });
        // 미국 본 상장 우선, 없으면 본국 거래소(일본·홍콩·중국·대만·한국)만 — 독일·싱가포르 등 2차 상장은 제외
        var us = qs.filter(function (x) { return /^(NMS|NYQ|NGM|NCM|ASE|PCX|BTS|NYS|NAS)$/i.test(x.exchange || '') && /^[A-Z]{1,5}([.-][A-Z])?$/.test(x.symbol); })[0];
        var home = qs.filter(function (x) { return /\.(T|HK|SS|SZ|TW|KS|KQ)$/.test(x.symbol); })[0];
        var pick = us || home;
        if (pick) out[n] = { ticker: hsFromYahoo_(pick.symbol), src: '자동(야후)' };
      }
    } catch (e) { /* 다음 실행에서 다시 시도 */ }
  });
  return out;
}

// 야후 심볼 → 시트 표기
function hsFromYahoo_(sym) {
  var s = String(sym).toUpperCase(), m;
  if ((m = s.match(/^(\d[0-9A-Z]{5})\.K[SQ]$/))) return m[1];
  if ((m = s.match(/^(\w+)\.T$/))) return 'TYO:' + m[1];
  if ((m = s.match(/^(\w+)\.TW$/))) return 'TPE:' + m[1];
  if ((m = s.match(/^(\w+)\.HK$/))) return 'HKG:' + m[1];
  if ((m = s.match(/^(\w+)\.SZ$/))) return 'SHE:' + m[1];
  if ((m = s.match(/^(\w+)\.SS$/))) return 'SHA:' + m[1];
  return s.replace(/-/g, '.'); // BRK-B → BRK.B
}

// 시트 표기 → 야후 심볼 후보
function hsToYahoo_(ticker) {
  var k = hsCodeKey_(ticker);
  if (/^\d[0-9A-Z]{5}$/.test(k)) return [k + '.KS', k + '.KQ'];
  return [k];
}

// =========================================================
// 가격 (야후, 원화 환산) — 비중 계산용
// =========================================================
function hsQuotes_(tickers) {
  var out = {}, pending = tickers.map(function (t) { return { ticker: t, cands: hsToYahoo_(t) }; });
  var meta = {};
  for (var round = 0; round < 2 && pending.length; round++) {
    var res = hsFetchAll_(pending.map(function (p) {
      return { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(p.cands[round] || p.cands[0]) + '?range=5d&interval=1d', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true };
    }));
    var next = [];
    pending.forEach(function (p, i) {
      try {
        var r = JSON.parse(res[i].getContentText()).chart.result[0].meta;
        if (r && r.regularMarketPrice > 0) { meta[p.ticker] = r; return; }
      } catch (e) { }
      if (p.cands[round + 1]) next.push(p);
    });
    pending = next;
  }
  // 통화 → 원화 환율
  var curs = {};
  Object.keys(meta).forEach(function (t) { var c = meta[t].currency || 'USD'; if (c !== 'KRW') curs[c] = true; });
  var fx = { KRW: 1 };
  var cl = Object.keys(curs);
  var fres = hsFetchAll_(cl.map(function (c) { return { url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + c + 'KRW=X?range=5d&interval=1d', headers: { 'User-Agent': HS_UA }, muteHttpExceptions: true }; }));
  cl.forEach(function (c, i) { try { fx[c] = JSON.parse(fres[i].getContentText()).chart.result[0].meta.regularMarketPrice; } catch (e) { } });
  Object.keys(meta).forEach(function (t) {
    var c = meta[t].currency || 'USD';
    var p = meta[t].regularMarketPrice;
    if (c === 'GBp' || c === 'GBX') { p = p / 100; c = 'GBP'; }
    if (fx[c]) out[t] = p * fx[c];
  });
  return out;
}

// =========================================================
// 시트 쓰기
// =========================================================
function hsWritePdf_(ss, targets) {
  var sh = ss.getSheetByName(HS_TAB_PDF) || ss.insertSheet(HS_TAB_PDF);
  var rows = [['본체ETF명', 'ETF코드', '기준일', '순번', '구성종목명', '티커', '구분', '주식수', '비중(%)', '비중출처', '티커출처']];
  targets.forEach(function (t) {
    t.rows.forEach(function (r) {
      rows.push([t.name, t.code, r.date, r.no, r.name, r.ticker || '', r.kind || r.market || '', r.shares, Math.round((r.weight || 0) * 10000) / 10000, r.wSrc || '', r.mapSrc || '']);
    });
  });
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, 12).setValue('갱신: ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'));
}

// MasterData 에 없는 티커 → 가격 수식과 함께 추가할 줄
function hsNewMasterRows_(targets, index) {
  var seen = {}, rows = [];
  targets.forEach(function (t) {
    t.rows.forEach(function (r) {
      if (!r.ticker || r.kind) return;
      var key = hsCodeKey_(r.ticker);
      if (index.byCode[key] || seen[key]) return;
      seen[key] = true;
      rows.push([hsMarket_(r.ticker) + '주식', r.ticker, r.name]);
    });
  });
  return rows;
}

function hsAppendMaster_(master, rows) {
  var start = master.getLastRow() + 1;
  var out = rows.map(function (r, i) {
    var n = start + i, mk = hsMarket_(r[1]);
    var cur = { 대만: 'TWD', 홍콩: 'HKD', 중국: 'CNY' }[mk];
    var fx = mk === '한국' ? '' : (mk === '일본' ? '*Characteristic!$E$4' : (mk === '미국' ? '*Characteristic!$E$3' :
      '*GOOGLEFINANCE("CURRENCY:' + cur + 'KRW")'));
    // 일본 종목은 GOOGLEFINANCE·IMPORTXML 이 0 을 주는 경우가 많아 관리시트의 GET_YAHOO_FUTURES(야후 조회 함수)로 가져옴
    var ysym = hsCodeKey_(r[1]);
    var px = mk === '일본'
      ? ['=IFERROR(VALUE(GET_YAHOO_FUTURES("' + ysym + '","prevClose")), E' + n + ')',
         '=IFERROR(GET_YAHOO_FUTURES("' + ysym + '","price"), 0)']
      : ['=IFERROR(GOOGLEFINANCE($B' + n + ',"closeyest"), 0)', '=IFERROR(GOOGLEFINANCE($B' + n + ',"price"), 0)'];
    return [r[0], r[1], r[2], px[0], px[1],
      mk === '한국' ? '=D' + n : '=ROUND($D' + n + fx + ')',
      mk === '한국' ? '=E' + n : '=ROUND($E' + n + fx + ')'];
  });
  master.getRange(start, 2, out.length, 1).setNumberFormat('@'); // 국내 코드 앞자리 0 유지
  master.getRange(start, 1, out.length, 7).setValues(out);
}

// MasterData 에 숫자로 저장된 국내 코드(88980)를 6자리 글자('088980')로 — VLOOKUP 이 글자/숫자 구분 없이 맞도록
function hsFixMasterCodes_(master) {
  var n = master.getLastRow() - 2;
  if (n < 1) return;
  var rng = master.getRange(3, 2, n, 1);
  var v = rng.getValues(), changed = 0;
  var out = v.map(function (r) {
    if (typeof r[0] === 'number') { changed++; return [hsTickerStr_(r[0])]; }
    return [r[0]];
  });
  if (!changed) return;
  rng.setNumberFormat('@');
  rng.setValues(out);
  Logger.log('🔧 MasterData 국내 코드 ' + changed + '개를 6자리 글자로 정리');
}

// ETF_Quant_Signals 다시 만들기 (기준·베타 유지, 백업 후)
function hsRebuildSignals_(ss, targets) {
  var sh = ss.getSheetByName(HS_TAB_SIGNAL);
  var params = {};
  if (sh && sh.getLastRow() > 0) {
    // 백업 (하루 한 벌, 덮어씀)
    var old = ss.getSheetByName(HS_TAB_SIGNAL_BACKUP);
    if (old) ss.deleteSheet(old);
    sh.copyTo(ss).setName(HS_TAB_SIGNAL_BACKUP);
    var cur = null;
    sh.getRange(1, 1, sh.getLastRow(), 4).getValues().forEach(function (r) {
      var a = String(r[0]).trim();
      if (a.indexOf('■') === 0) { cur = hsNormName_(a.replace('■', '')); params[cur] = {}; }
      else if (cur && a === '기준') { params[cur].buy = r[2]; params[cur].sell = r[3]; }
      else if (cur && a === '베타') { params[cur].beta = r[2]; }
    });
  } else if (!sh) sh = ss.insertSheet(HS_TAB_SIGNAL);

  var out = [['본체 ETF 자동 추종 및 퀀트 엔진 대시보드 (ETF_Quant_Signals) · 보유종목 자동 갱신 ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '']];
  targets.forEach(function (t) {
    if (!t.rows.length) return;
    var p = params[hsNormName_(t.name)] || {};
    out.push(['■ ' + t.name, '', '', '', '', '', '', 'PDF 기준일 ' + t.date]);
    out.push(['구분', '구성종목명', '티커/코드', '자동추종비중', '전일종가', '실시간현재가', '종목변동률', '가중변동률']);
    out.push(['기준', '', p.buy !== undefined && p.buy !== '' ? p.buy : HS_DEFAULT_PARAMS.buy, p.sell !== undefined && p.sell !== '' ? p.sell : HS_DEFAULT_PARAMS.sell, '', '', '', '']);
    out.push(['베타', '', p.beta !== undefined && p.beta !== '' ? p.beta : HS_DEFAULT_PARAMS.beta, '', '', '', '', '']);
    var first = out.length + 1;
    var comps = t.rows.filter(function (r) { return (r.weight || 0) > 0 && r.kind !== '파생'; })
      .sort(function (a, b) { return b.weight - a.weight; });
    comps.forEach(function (r) {
      var n = out.length + 1;
      var isCash = r.kind === '현금';
      out.push(['구성종목', r.name, isCash ? '' : (r.ticker || ''), r.weight / 100,
        isCash ? 0 : '=IFERROR(VLOOKUP($C' + n + ', MasterData!$B:$G, 5, FALSE), 0)',
        isCash ? 0 : '=IFERROR(VLOOKUP($C' + n + ', MasterData!$B:$G, 6, FALSE), 0)',
        '=IFERROR((F' + n + '-E' + n + ')/E' + n + ', 0)', '=G' + n + '*D' + n]);
    });
    var last = out.length;
    out.push(['합계', '', '', last >= first ? '=SUM(D' + first + ':D' + last + ')' : 0, '', '', '', last >= first ? '=SUM(H' + first + ':H' + last + ')' : 0]);
    out.push(['', '', '', '', '', '', '', '']);
  });

  sh.clear();
  sh.getRange(1, 3, out.length, 1).setNumberFormat('@'); // 티커 열: 국내 코드 앞자리 0 유지
  out.forEach(function (r) { if (r[0] === '기준' || r[0] === '베타') { r[2] = String(r[2]); if (r[0] === '기준') r[3] = Number(r[3]); } });
  sh.getRange(1, 1, out.length, 8).setValues(out);
  // 서식: 비중·변동률 %
  sh.getRange(1, 4, out.length, 1).setNumberFormat('0.00%');
  sh.getRange(1, 7, out.length, 2).setNumberFormat('0.00%');
  sh.getRange(1, 5, out.length, 2).setNumberFormat('#,##0');
  // 기준·베타 줄은 숫자 그대로
  out.forEach(function (r, i) {
    if (r[0] === '기준' || r[0] === '베타') sh.getRange(i + 1, 3, 1, 2).setNumberFormat('0.##');
    if (String(r[0]).indexOf('■') === 0) sh.getRange(i + 1, 1).setFontWeight('bold');
  });
}

// =========================================================
// 도우미
// =========================================================
function hsFetchAll_(reqs) {
  var out = [];
  for (var i = 0; i < reqs.length; i += 40) {
    var chunk = reqs.slice(i, i + 40);
    try { out = out.concat(UrlFetchApp.fetchAll(chunk)); }
    catch (e) {
      chunk.forEach(function (r) { try { out.push(UrlFetchApp.fetch(r.url, r)); } catch (e2) { out.push(null); } });
    }
    if (i + 40 < reqs.length) Utilities.sleep(300);
  }
  return out;
}

function hsToday_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }
