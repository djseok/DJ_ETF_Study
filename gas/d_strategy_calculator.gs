/**
 * D 전략 매수 계산기 (ISA) — 확정안 ③: 레버리지 60 / 나스닥 커버드콜 40
 * ---------------------------------------------------------------
 * 원칙
 *  1) 매수는 이 계산기가 알려준 종목·수량만 한다. (뇌동매매 금지)
 *  2) 계좌 1천만 원 미만(또는 레버리지 요건 미충족)  → 나스닥CC만 매수
 *     계좌 1천만 원 이상 + 레버리지 요건 충족        → 목표 비중(60/40)에서 모자란 종목부터 매수
 *  3) 적립금 + 분배금 + 예수금은 매달 전부 이 규칙으로 재투자한다.
 *  4) 매도는 수익 구간에서만. 목표 비중을 크게 넘은 종목만 익절 검토한다.
 *
 * 설치: '동진ETF공부_개인일기장' 시트 → 확장 프로그램 → Apps Script → 새 파일(+)로 붙여넣기 → 저장
 *   → 편집기 상단 함수 목록에서 dInstallMenu 선택 → [실행] 1회 (권한 승인)
 *   → 시트 새로고침 → [📈 D 전략] 메뉴 생성
 *   모든 이름이 d / D_ 로 시작해서 같은 프로젝트의 다른 파일(Code.gs 등)과 겹치지 않음. onOpen()도 건드리지 않음.
 *
 * 사용법
 *  - 시트 메뉴 [📈 D 전략] → ① 초기 세팅 (최초 1회) → D포토폴리오에서 보유 종목을 자동으로 불러옴
 *  - D_보유 시트 확인 (역할: LEV / NCC / HOLD)
 *  - D_설정 시트에 이번 달 신규 입금액, 분배금+예수금 입력
 *  - 메뉴 → ② 이번 달 매수 계산  →  D_매수계획 확인 후 그대로 주문
 *  - 주문 후 메뉴 → ③ 이번 달 계획 기록  (D_기록에 남김)
 */

const D_SHEET = {
  CFG: 'D_설정',
  HOLD: 'D_보유',
  PLAN: 'D_매수계획',
  LOG: 'D_기록',
};

// ───────────────────────────── 메뉴 ─────────────────────────────
function dStrategyMenu() {
  SpreadsheetApp.getUi()
    .createMenu('📈 D 전략')
    .addItem('① 초기 세팅 (최초 1회)', 'dSetup')
    .addSeparator()
    .addItem('② 이번 달 매수 계산', 'dRunMonthlyPlan')
    .addItem('③ 이번 달 계획 기록', 'dLogPlan')
    .addSeparator()
    .addItem('D포토폴리오에서 보유 다시 불러오기', 'dImportFromDPortfolio')
    .addItem('현재가만 갱신', 'dRefreshPrices')
    .addToUi();
}

// ───────────────────────────── 초기 세팅 ─────────────────────────────
function dSetup() {
  const ss = SpreadsheetApp.getActive();

  // D_설정
  const cfg = dGetOrCreate_(ss, D_SHEET.CFG);
  cfg.clear();
  const cfgRows = [
    ['항목', '값', '설명'],
    ['레버리지 종목코드', '418660', 'TIGER 미국나스닥100레버리지(합성) — 환노출. (H) 붙은 상품은 쓰지 않음'],
    ['나스닥CC 종목코드(신규 매수용)', '491620', 'RISE 미국테크100데일리고정커버드콜 (대안: 486290 TIGER) — 기존 494300은 NCC로 보유 유지(손실 중 매도 X)'],
    ['레버리지 목표 비중', 0.6, '확정안 ③'],
    ['나스닥CC 목표 비중', 0.4, '확정안 ③'],
    ['레버리지 활성 기준금액', 10000000, '증권사 기본예탁금 기준 (한투: 현금 + 보유주식 평가액×반영률)'],
    ['레버리지 사전교육 이수', true, '교육 이수 완료 시 체크'],
    ['익절 검토 밴드', 0.15, '목표 비중보다 15%p 이상 커지고 수익 중이면 익절 검토 표시'],
    ['올해 ISA 남은 납입한도', 10485964, '연 2,000만 원 한도 중 남은 금액 (매년 1월 갱신)'],
    ['이번 달 신규 입금액', 600000, '이번 달 ISA에 새로 넣는 적립금 (납입한도에서 차감됨)'],
    ['분배금 + 예수금', 0, '계좌에 이미 있는 현금 (납입한도 차감 없음)'],
    ['보유주식 예탁금 반영률', 0.7, '한투 앱에서 확인한 보유 ETF의 예탁금 인정 비율(대용가율). 모르면 앱 표시값을 아래 칸에'],
    ['앱 표시 기본예탁금 인정액(선택)', '', '한투 앱의 레버리지 기본예탁금 인정액(이번 달 입금 전 값)을 넣으면 이 값을 우선 사용'],
  ];
  cfg.getRange(1, 1, cfgRows.length, 3).setValues(cfgRows);
  cfg.getRange('B7').insertCheckboxes();
  cfg.getRange('B7').setValue(true);
  cfg.getRange('B4:B5').setNumberFormat('0%');
  cfg.getRange('B8').setNumberFormat('0%');
  cfg.getRange('B6').setNumberFormat('#,##0');
  cfg.getRange('B9:B11').setNumberFormat('#,##0');
  cfg.getRange('B12').setNumberFormat('0%');
  cfg.getRange('B13').setNumberFormat('#,##0');
  cfg.getRange('B13').setBackground('#fff7d6');
  cfg.getRange('A1:C1').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  cfg.getRange('B10:B11').setBackground('#fff7d6'); // 매달 입력하는 칸
  cfg.setColumnWidth(1, 230); cfg.setColumnWidth(2, 140); cfg.setColumnWidth(3, 520);
  cfg.setFrozenRows(1);

  // D_보유 — D포토폴리오 시트에서 자동으로 불러옴
  dImportFromDPortfolio(true);

  dGetOrCreate_(ss, D_SHEET.PLAN);
  const log = dGetOrCreate_(ss, D_SHEET.LOG);
  if (log.getLastRow() === 0) {
    log.appendRow(['기록일시', '단계', '계좌 총자산', '투입 현금', '레버리지 매수(주)', '레버리지 금액',
                   '나스닥CC 매수(주)', '나스닥CC 금액', '남는 현금', '매수 후 레버리지 비중', '메모']);
    log.getRange('A1:K1').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    log.setFrozenRows(1);
  }

  SpreadsheetApp.getUi().alert(
    '세팅 완료\n\n1) D_보유: D포토폴리오에서 불러온 종목·역할을 확인하세요.\n' +
    '   (ISA 계좌에 없는 종목은 행 삭제 / 코드를 모르는 종목은 D포토폴리오 현재가를 수동현재가로 씀)\n' +
    '2) D_설정: 이번 달 신규 입금액과 분배금+예수금을 입력하세요.\n' +
    '3) 메뉴 ② 이번 달 매수 계산을 누르세요.');
}


// ───────────────────────────── D포토폴리오 → D_보유 ─────────────────────────────
const D_CODE_MAP = {
  'KODEX 미국나스닥100데일리커버드콜OTM': '494300',
  'TIGER 미국나스닥100타겟데일리커버드콜': '486290',
  'TIGER 미국나스닥100커버드콜(합성)': '441680',
  'RISE 미국테크100데일리고정커버드콜': '491620',
  'TIGER 미국나스닥100레버리지(합성)': '418660',
  'RISE 미국나스닥100': '368590',
  'RISE 미국S&P500': '379780',
  'KODEX 미국반도체': '390390',
  'TIME 글로벌AI인공지능액티브': '456600',
};
function dRoleOf_(name) {
  const n = String(name);
  if (n.includes('레버리지')) return 'LEV';
  if ((n.includes('나스닥100') || n.includes('테크100')) && n.includes('커버드콜')) return 'NCC';
  return 'HOLD';
}
function dImportFromDPortfolio(silent) {
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName('D포토폴리오');
  const hold = dGetOrCreate_(ss, D_SHEET.HOLD);
  const header = ['종목코드', '종목명', '역할(LEV/NCC/HOLD)', '수량', '평균단가', '수동현재가(선택)', '현재가', '평가액', '손익률'];
  const rows = [];
  if (src) {
    src.getRange(2, 1, Math.max(1, src.getLastRow() - 1), 6).getValues().forEach(r => {
      // D포토폴리오: A 이름 | B 종목명 | C 목표비중 | D 평단가 | E 수량 | F 현재가
      if (String(r[0]).trim() !== 'D' || !r[1]) return;
      const name = String(r[1]).trim();
      const code = D_CODE_MAP[name] || '';
      rows.push([code, name, dRoleOf_(name), Number(r[4]) || 0, Number(String(r[3]).replace(/,/g, '')) || 0,
                 code ? '' : (Number(String(r[5]).replace(/,/g, '')) || ''), '', '', '']);
    });
  }
  // 전략 종목이 없으면 0주로 추가 (신규 매수 대상)
  const cfgSh = ss.getSheetByName(D_SHEET.CFG);
  const levCode = cfgSh ? String(cfgSh.getRange('B2').getValue()) : '418660';
  const nccCode = cfgSh ? String(cfgSh.getRange('B3').getValue()) : '491620';
  const nameOf = c => Object.keys(D_CODE_MAP).find(k => D_CODE_MAP[k] === c) || c;
  if (!rows.some(r => r[0] === levCode)) rows.push([levCode, nameOf(levCode), 'LEV', 0, 0, '', '', '', '']);
  if (!rows.some(r => r[0] === nccCode)) rows.push([nccCode, nameOf(nccCode), 'NCC', 0, 0, '', '', '', '']);

  hold.clear();
  hold.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) hold.getRange(2, 1, rows.length, header.length).setValues(rows);
  hold.getRange('A:A').setNumberFormat('@');
  hold.getRange('E:H').setNumberFormat('#,##0');
  hold.getRange('I:I').setNumberFormat('0.0%');
  hold.getRange('A1:I1').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['LEV', 'NCC', 'HOLD'], true).build();
  hold.getRange('C2:C50').setDataValidation(rule);
  hold.setColumnWidth(2, 290); hold.setColumnWidth(3, 140);
  hold.setFrozenRows(1);
  if (silent !== true) SpreadsheetApp.getUi().alert(`D포토폴리오에서 ${rows.length}개 종목을 불러왔어요. 역할을 확인하세요.`);
}

// ───────────────────────────── 현재가 ─────────────────────────────
function dFetchPrice_(code) {
  if (!code) return null;
  const urls = [
    'https://m.stock.naver.com/api/stock/' + code + '/basic',
    'https://polling.finance.naver.com/api/realtime/domestic/stock/' + code,
  ];
  for (const url of urls) {
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) continue;
      const j = JSON.parse(res.getContentText());
      const raw = j.closePrice || (j.datas && j.datas[0] && j.datas[0].closePrice);
      const p = Number(String(raw).replace(/,/g, ''));
      if (p > 0) return p;
    } catch (e) { /* 다음 URL 시도 */ }
  }
  return null;
}

function dRefreshPrices() {
  const sh = SpreadsheetApp.getActive().getSheetByName(D_SHEET.HOLD);
  const last = sh.getLastRow();
  if (last < 2) return;
  const data = sh.getRange(2, 1, last - 1, 9).getValues();
  const out = data.map(r => {
    const code = String(r[0]).trim();
    const qty = Number(r[3]) || 0;
    const avg = Number(r[4]) || 0;
    const manual = Number(r[5]) || 0;
    const price = manual > 0 ? manual : (dFetchPrice_(code) || 0);
    const value = price * qty;
    const pnl = avg > 0 && price > 0 ? price / avg - 1 : '';
    return [price || '', value, pnl];
  });
  sh.getRange(2, 7, out.length, 3).setValues(out);
}

// ───────────────────────────── 핵심 로직 (순수 함수) ─────────────────────────────
/**
 * @param {Array<{code,name,role,qty,avg,price}>} holdings
 * @param {number} cash 이번 달 투입 현금(신규 입금 + 분배금 + 예수금)
 * @param {object} cfg {levCode, nccCode, levName, nccName, wLev, wNcc, threshold, eligible, band, levPrice, nccPrice}
 */
function dPlanBuys_(holdings, cash, cfg) {
  const val = h => (h.price || 0) * (h.qty || 0);
  const accountTotal = holdings.reduce((s, h) => s + val(h), 0) + cash;
  const levVal = holdings.filter(h => h.role === 'LEV').reduce((s, h) => s + val(h), 0);
  const nccVal = holdings.filter(h => h.role === 'NCC').reduce((s, h) => s + val(h), 0);

  // 기본예탁금 인정액: 앱 표시값 우선, 없으면 현금 + 보유 평가액 × 반영률
  const depositBase = cfg.appDeposit > 0
    ? cfg.appDeposit + cash
    : cash + holdings.reduce((s, h) => s + val(h), 0) * (cfg.haircut > 0 ? cfg.haircut : 1);
  const phase2 = depositBase >= cfg.threshold && cfg.eligible === true;
  const targets = phase2 ? { LEV: cfg.wLev, NCC: cfg.wNcc } : { LEV: 0, NCC: 1 };
  const price = { LEV: cfg.levPrice, NCC: cfg.nccPrice };
  const cur = { LEV: levVal, NCC: nccVal };
  const base = levVal + nccVal + cash; // 전략 자산 기준 (HOLD 제외)

  // 1) 모자란 금액(need) 계산 → 2) 현금을 need 비율로 배분 (매도 없음)
  const need = {};
  ['LEV', 'NCC'].forEach(a => { need[a] = Math.max(0, targets[a] * base - cur[a]); });
  const needSum = need.LEV + need.NCC;
  const budget = { LEV: 0, NCC: 0 };
  if (needSum >= cash && needSum > 0) {
    ['LEV', 'NCC'].forEach(a => { budget[a] = cash * need[a] / needSum; });
  } else {
    const rem = cash - needSum;
    ['LEV', 'NCC'].forEach(a => { budget[a] = need[a] + rem * targets[a]; });
  }

  // 3) 주 단위로 내림 → 남는 현금으로 비중이 가장 모자란 종목 1주씩 추가
  const shares = { LEV: 0, NCC: 0 };
  let left = cash;
  ['LEV', 'NCC'].forEach(a => {
    if (targets[a] > 0 && price[a] > 0) {
      shares[a] = Math.floor(budget[a] / price[a]);
      left -= shares[a] * price[a];
    }
  });
  for (let guard = 0; guard < 1000; guard++) {
    const after = a => cur[a] + shares[a] * price[a];
    const gap = a => targets[a] * base - after(a);
    const cands = ['LEV', 'NCC']
      .filter(a => targets[a] > 0 && price[a] > 0 && price[a] <= left)
      .sort((x, y) => gap(y) - gap(x));
    if (!cands.length || gap(cands[0]) <= 0) break;
    shares[cands[0]] += 1;
    left -= price[cands[0]];
  }

  const afterLev = cur.LEV + shares.LEV * price.LEV;
  const afterNcc = cur.NCC + shares.NCC * price.NCC;
  const afterBase = afterLev + afterNcc;

  // 4) 익절 검토 (수익 중 + 목표보다 band 이상 초과) / HOLD 정리 후보
  const notes = [];
  if (phase2) {
    const pnl = role => {
      const hs = holdings.filter(h => h.role === role && h.qty > 0 && h.avg > 0);
      const cost = hs.reduce((s, h) => s + h.avg * h.qty, 0);
      return cost > 0 ? hs.reduce((s, h) => s + val(h), 0) / cost - 1 : 0;
    };
    [['LEV', afterLev, '레버리지'], ['NCC', afterNcc, '나스닥CC']].forEach(([a, v, label]) => {
      const w = afterBase > 0 ? v / afterBase : 0;
      if (w > targets[a] + cfg.band && pnl(a) > 0) {
        const amt = Math.round((w - targets[a]) * afterBase);
        notes.push(`익절 검토: ${label} 비중 ${(w * 100).toFixed(1)}% (목표 ${(targets[a] * 100).toFixed(0)}%), ` +
                   `수익 ${(pnl(a) * 100).toFixed(1)}% → 약 ${dFmt_(amt)}원 매도 후 다른 종목으로 이동 가능`);
      }
    });
  }
  holdings.filter(h => h.role === 'HOLD' && h.qty > 0 && h.avg > 0 && h.price > h.avg).forEach(h => {
    notes.push(`정리 후보: ${h.name} 수익 ${((h.price / h.avg - 1) * 100).toFixed(1)}% → 매도 시 그 돈은 다음 계산 때 투입 현금에 포함`);
  });

  return {
    phase2, accountTotal, base, cash, targets, shares, price, left,
    cost: { LEV: shares.LEV * price.LEV, NCC: shares.NCC * price.NCC },
    before: { LEV: cur.LEV, NCC: cur.NCC },
    after: { LEV: afterLev, NCC: afterNcc },
    depositBase,
    toThreshold: Math.max(0, cfg.threshold - depositBase),
    notes,
  };
}

// ───────────────────────────── 실행 ─────────────────────────────
function dReadCfg_() {
  const v = SpreadsheetApp.getActive().getSheetByName(D_SHEET.CFG).getRange('B2:B13').getValues().map(r => r[0]);
  return {
    levCode: String(v[0]).trim(), nccCode: String(v[1]).trim(),
    wLev: Number(v[2]), wNcc: Number(v[3]),
    threshold: Number(v[4]), eligible: v[5] === true, band: Number(v[6]),
    isaLeft: Number(v[7]), newDeposit: Number(v[8]) || 0, existingCash: Number(v[9]) || 0,
    haircut: Number(v[10]) || 0, appDeposit: Number(v[11]) || 0,
  };
}

function dReadHoldings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(D_SHEET.HOLD);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 9).getValues()
    .filter(r => r[1] !== '' || r[0] !== '')
    .map(r => ({
      code: String(r[0]).trim(), name: String(r[1]), role: String(r[2]).trim().toUpperCase() || 'HOLD',
      qty: Number(r[3]) || 0, avg: Number(r[4]) || 0, price: Number(r[6]) || 0,
    }));
}

function dRunMonthlyPlan() {
  const ui = SpreadsheetApp.getUi();
  dRefreshPrices();
  const cfg = dReadCfg_();
  const holdings = dReadHoldings_();

  const priceOf = code => {
    const h = holdings.find(x => x.code === code && x.price > 0);
    return h ? h.price : (dFetchPrice_(code) || 0);
  };
  cfg.levPrice = priceOf(cfg.levCode);
  cfg.nccPrice = priceOf(cfg.nccCode);
  if (!cfg.nccPrice) { ui.alert('나스닥CC 현재가를 가져오지 못했어요. D_보유의 수동현재가에 입력해 주세요.'); return; }

  const cash = cfg.newDeposit + cfg.existingCash;
  const p = dPlanBuys_(holdings, cash, cfg);

  // 출력
  const sh = dGetOrCreate_(SpreadsheetApp.getActive(), D_SHEET.PLAN);
  sh.clear();
  const pct = x => (x * 100).toFixed(1) + '%';
  const afterBase = p.after.LEV + p.after.NCC;
  const rows = [
    ['D 전략 이번 달 매수 계획', '', '', '', '', '', ''],
    ['계산 시각', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), '', '', '', '', ''],
    ['단계', p.phase2 ? '2단계: 레버리지 60 / 나스닥CC 40' : '1단계: 나스닥CC만 매수 (레버리지 대기)', '', '', '', '', ''],
    ['계좌 총자산(투입 현금 포함)', p.accountTotal, '', '', '', '', ''],
    ['기본예탁금 인정액(추정)', p.depositBase, cfg.appDeposit > 0 ? '앱 표시값 + 이번 달 현금' : `현금 + 보유 평가액 × ${(cfg.haircut * 100).toFixed(0)}%`, '', '', '', ''],
    ['레버리지 활성까지 남은 금액', p.phase2 ? 0 : p.toThreshold, cfg.eligible ? '' : '※ 사전교육 이수 체크 필요', '', '', '', ''],
    ['이번 달 투입 현금', cash, '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['종목', '현재가', '매수 수량(주)', '매수 금액', '현재 비중', '매수 후 비중', '목표 비중'],
    ['레버리지 (' + cfg.levCode + ')', p.price.LEV || '-', p.shares.LEV, p.cost.LEV,
     p.base - cash > 0 ? pct(p.before.LEV / (p.base - cash)) : '-', afterBase ? pct(p.after.LEV / afterBase) : '-', pct(p.targets.LEV)],
    ['나스닥CC (' + cfg.nccCode + ')', p.price.NCC, p.shares.NCC, p.cost.NCC,
     p.base - cash > 0 ? pct(p.before.NCC / (p.base - cash)) : '-', afterBase ? pct(p.after.NCC / afterBase) : '-', pct(p.targets.NCC)],
    ['남는 현금(다음 달로 이월)', '', '', p.left, '', '', ''],
    ['', '', '', '', '', '', ''],
    ['점검', '', '', '', '', '', ''],
  ];
  const checks = [];
  if (cfg.newDeposit > cfg.isaLeft) checks.push(`⚠ 이번 달 신규 입금액이 올해 남은 ISA 납입한도(${dFmt_(cfg.isaLeft)}원)를 넘어요.`);
  else checks.push(`ISA 납입한도 OK — 입금 후 올해 남은 한도: ${dFmt_(cfg.isaLeft - cfg.newDeposit)}원 (D_설정에서 직접 갱신)`);
  if (!p.phase2 && p.depositBase >= cfg.threshold && !cfg.eligible)
    checks.push('⚠ 예탁금은 기준을 넘었어요. 사전교육 이수 후 D_설정 체크박스를 켜세요.');
  if (!p.phase2 && p.depositBase < cfg.threshold && p.accountTotal >= cfg.threshold)
    checks.push('ℹ 평가액은 1천만 원이 넘지만, 보유주식은 예탁금에 일부만 반영돼 아직 레버리지 매수 불가로 계산했어요. 한투 앱 인정액으로 확인하세요.');
  checks.push('ℹ 레버리지 주문 직전 한투 앱에서 기본예탁금 충족 여부를 한 번 더 확인하세요.');
  if (!p.phase2) checks.push('1단계 규칙: 레버리지 몫까지 전부 나스닥CC로. 분배금도 나스닥CC로 재투자해 1천만 원 도달을 앞당김.');
  if (p.phase2 && p.before.LEV === 0) checks.push('2단계 첫 달: 레버리지 비중이 0%라 투입 현금이 레버리지에 몰리는 게 정상이에요. 기존 종목은 팔지 않아요.');
  checks.push('목록에 없는 종목은 매수하지 않습니다. 매도는 수익 구간에서만.');
  p.notes.forEach(n => checks.push(n));
  checks.forEach(c => rows.push([c, '', '', '', '', '', '']));

  sh.getRange(1, 1, rows.length, 7).setValues(rows);
  sh.getRange('A1').setFontSize(14).setFontWeight('bold');
  sh.getRange('B4:B7').setNumberFormat('#,##0');
  sh.getRange('B10:B11').setNumberFormat('#,##0');
  sh.getRange('D10:D12').setNumberFormat('#,##0');
  sh.getRange('A9:G9').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.getRange('C10:D11').setFontWeight('bold').setBackground('#e8f5e9');
  sh.getRange('A14').setFontWeight('bold');
  sh.setColumnWidth(1, 260); sh.setColumnWidths(2, 6, 120);
  SpreadsheetApp.getActive().setActiveSheet(sh);

  // 기록용 캐시
  PropertiesService.getDocumentProperties().setProperty('lastPlan', JSON.stringify({
    phase: p.phase2 ? 2 : 1, total: p.accountTotal, cash,
    levSh: p.shares.LEV, levAmt: p.cost.LEV, nccSh: p.shares.NCC, nccAmt: p.cost.NCC, left: p.left,
    levW: afterBase ? p.after.LEV / afterBase : 0,
  }));
}

function dLogPlan() {
  const raw = PropertiesService.getDocumentProperties().getProperty('lastPlan');
  if (!raw) { SpreadsheetApp.getUi().alert('먼저 ② 이번 달 매수 계산을 실행하세요.'); return; }
  const p = JSON.parse(raw);
  const memo = SpreadsheetApp.getUi().prompt('메모 (선택)', '예: 계획대로 체결 / 일부 미체결 등', SpreadsheetApp.getUi().ButtonSet.OK).getResponseText();
  SpreadsheetApp.getActive().getSheetByName(D_SHEET.LOG).appendRow([
    new Date(), p.phase, p.total, p.cash, p.levSh, p.levAmt, p.nccSh, p.nccAmt, p.left, p.levW, memo,
  ]);
}

// ───────────────────────────── 유틸 ─────────────────────────────
function dGetOrCreate_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function dFmt_(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// 메뉴 등록: 기존 onOpen()과 충돌하지 않도록 '설치형 트리거'를 씀.
// Apps Script 편집기에서 함수 목록을 dInstallMenu 로 고르고 [실행]을 한 번만 누르면 됨.
function dInstallMenu() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dStrategyMenu')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dStrategyMenu').forSpreadsheet(ss).onOpen().create();
  ss.toast('D 전략 메뉴를 등록했어요. 시트를 새로고침하세요.', 'D 전략', 8);
}

// Node 테스트용 (GAS에서는 무시됨)
if (typeof module !== 'undefined') module.exports = { dPlanBuys_ };
