// =========================================================
// 🧾 금융소득종합과세 사전 점검 (2026년 세법 기준 · 참고용 추정)
//   - 연봉 등 입력값은 이 브라우저(localStorage)에만 저장 — 시트·GitHub 어디에도 보내지 않음
//   - 금융소득 = 올해 받은 배당(과세표준 기준) + 남은 예상 배당(과세표준 비율) + 해외주식형 ETF 매도차익 + 기타 이자·배당 − ISA·연금계좌 분
//   - 2,000만원 초과 → 비교과세: max(근로 과세표준 + 초과분을 누진세율 + 2,000만×14%, 근로 누진세 + 금융소득×14%)
//   - 건강보험(직장가입자): 보수 외 소득이 2,000만원 초과 시 초과분 × (7.19% + 0.9448%) — 금융소득은 1,000만원 넘으면 전액 반영
//   ETF 분배금은 배당가산(Gross-up) 대상이 아니라 계산에 넣지 않음
// =========================================================
var TAX_LIMIT = 20000000, TAX_HI_LIMIT = 10000000;
var TAX_HI_RATE = 0.0719 + 0.009448; // 2026 건강보험료율 + 장기요양보험료율 (소득 대비)
var TAX_BRACKETS = [ // [상한, 세율, 누진공제] 2026 종합소득세
    [14000000, 0.06, 0], [50000000, 0.15, 1260000], [88000000, 0.24, 5760000], [150000000, 0.35, 15440000],
    [300000000, 0.38, 19940000], [500000000, 0.40, 25940000], [1000000000, 0.42, 35940000], [Infinity, 0.45, 65940000]
];
var TAX_FIELDS = ['salary', 'baseOverride', 'otherFin', 'etfGain', 'isa'];

function taxProgressive(base) {
    if (!(base > 0)) return 0;
    for (var i = 0; i < TAX_BRACKETS.length; i++) if (base <= TAX_BRACKETS[i][0]) return base * TAX_BRACKETS[i][1] - TAX_BRACKETS[i][2];
    return 0;
}
function taxMarginalRate(base) {
    for (var i = 0; i < TAX_BRACKETS.length; i++) if (base <= TAX_BRACKETS[i][0]) return TAX_BRACKETS[i][1];
    return 0.45;
}
// 근로소득공제 (한도 2,000만원)
function taxWageDeduction(s) {
    var d = s <= 5e6 ? s * 0.7 : s <= 15e6 ? 3.5e6 + (s - 5e6) * 0.4 : s <= 45e6 ? 7.5e6 + (s - 15e6) * 0.15 : s <= 1e8 ? 12e6 + (s - 45e6) * 0.05 : 14.75e6 + (s - 1e8) * 0.02;
    return Math.min(d, 2e7);
}
// 연봉 → 근로소득 과세표준 대략 (근로소득공제 · 본인 기본공제 150만 · 4대보험 본인분). 원천징수영수증 값이 있으면 그걸 쓰는 게 정확
function taxEstimateWageBase(salary) {
    if (!(salary > 0)) return 0;
    var social = Math.min(salary, 76440000) * 0.0475 + salary * (0.03595 + 0.004724 + 0.009);
    return Math.max(0, salary - taxWageDeduction(salary) - 1500000 - social);
}

function taxStoreKey(member) { return 'djTax_' + new Date().getFullYear() + '_' + member; }
function taxLoadInputs(member) {
    try { return JSON.parse(localStorage.getItem(taxStoreKey(member)) || '{}'); } catch (e) { return {}; }
}
function taxSaveInputs(member, v) {
    try { localStorage.setItem(taxStoreKey(member), JSON.stringify(v)); } catch (e) { }
}
function taxNum(id) { var el = document.getElementById(id); return el ? (parseFloat(String(el.value).replace(/[^0-9.]/g, '')) || 0) : 0; }
function taxWon(v) { return '₩' + Math.round(v).toLocaleString(); }

async function loadTaxView() {
    await Promise.all([
        typeof loadDivHistory === 'function' ? loadDivHistory() : null,
        typeof loadDynamicDividendRules === 'function' ? loadDynamicDividendRules() : null,
        typeof loadPortfolioData === 'function' ? loadPortfolioData('tax') : null
    ]);
    var sel = document.getElementById('taxMember');
    var names = Object.keys(globalParsedUsers || {}).filter(function (n) { return !/^test/i.test(n); });
    if (sel.options.length !== names.length) {
        var last = ''; try { last = localStorage.getItem('djTax_lastMember') || ''; } catch (e) { }
        sel.innerHTML = names.map(function (n) { return '<option value="' + n + '"' + (n === last ? ' selected' : '') + '>' + n + '</option>'; }).join('');
        sel.onchange = function () { try { localStorage.setItem('djTax_lastMember', sel.value); } catch (e) { } taxFillInputs(); renderTax(); };
        TAX_FIELDS.forEach(function (f) {
            var el = document.getElementById('tax_' + f);
            el.oninput = function () {
                var v = {}; TAX_FIELDS.forEach(function (k) { v[k] = taxNum('tax_' + k); });
                taxSaveInputs(sel.value, v); renderTax();
            };
        });
    }
    taxFillInputs();
    renderTax();
}

function taxFillInputs() {
    var v = taxLoadInputs(document.getElementById('taxMember').value);
    TAX_FIELDS.forEach(function (f) { document.getElementById('tax_' + f).value = v[f] ? Math.round(v[f]) : ''; });
}

function taxClearInputs() {
    var m = document.getElementById('taxMember').value;
    try { localStorage.removeItem(taxStoreKey(m)); } catch (e) { }
    taxFillInputs(); renderTax();
}

// 올해 남은 예상 배당 (과세표준 비율 적용) — 배당&총알 탭과 같은 규칙
function taxExpectedRemaining(member) {
    var now = new Date(), cm = now.getMonth() + 1, key = member.trim().toUpperCase(), received = {};
    (globalActualDividendLogs || []).forEach(function (l) {
        if (String(l.userName || '').trim().toUpperCase() === key && l.jsDate.getFullYear() === now.getFullYear() && l.parsedMonth === cm) received[taxNorm(l.stockName)] = true;
    });
    var u = (globalParsedUsers || {})[member], gross = 0, taxable = 0;
    ((u && u.items) || []).forEach(function (it) {
        if (!(it.qty > 0)) return;
        var rule = typeof findDividendRule === 'function' ? findDividendRule(it.stock) : null;
        if (!rule || rule.expectedAmount <= 0) return;
        var ratio = divTaxRatio(it.stock, null).ratio;
        rule.payMonths.forEach(function (m) {
            if (m < cm || (m === cm && received[taxNorm(it.stock)])) return;
            var g = rule.expectedAmount * it.qty;
            gross += g; taxable += g * ratio;
        });
    });
    return { gross: gross, taxable: taxable };
}

function renderTax() {
    var member = document.getElementById('taxMember').value;
    if (!member) return;
    var year = new Date().getFullYear();
    var got = divTotalsFor(member, year);
    var exp = taxExpectedRemaining(member);
    var salary = taxNum('tax_salary'), baseOv = taxNum('tax_baseOverride');
    var other = taxNum('tax_otherFin'), etfGain = taxNum('tax_etfGain'), isa = taxNum('tax_isa');

    var fin = Math.max(0, got.taxable + exp.taxable + other + etfGain - isa);
    var wageBase = baseOv > 0 ? baseOv : taxEstimateWageBase(salary);
    var sepTax = taxProgressive(wageBase) + fin * 0.14;          // 분리과세였을 때 (근로세 + 금융 14%)
    var compTax = sepTax;
    if (fin > TAX_LIMIT) {
        var general = taxProgressive(wageBase + (fin - TAX_LIMIT)) + TAX_LIMIT * 0.14;
        compTax = Math.max(general, sepTax);                      // 비교과세
    }
    var extraTax = Math.max(0, compTax - sepTax) * 1.1;           // 지방소득세 10% 포함
    var hiIncome = fin > TAX_HI_LIMIT ? fin : 0;
    var extraHi = hiIncome > TAX_LIMIT ? (hiIncome - TAX_LIMIT) * TAX_HI_RATE : 0;
    var room = TAX_LIMIT - fin;
    var pct = Math.min(100, fin / TAX_LIMIT * 100);

    var set = function (id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; };
    set('taxFinTotal', taxWon(fin));
    set('taxBar', '<div class="h-full rounded-full ' + (fin > TAX_LIMIT ? 'bg-red-500' : (pct > 75 ? 'bg-amber-500' : 'bg-emerald-500')) + '" style="width:' + pct.toFixed(1) + '%"></div>'
        + '<div class="absolute top-0 bottom-0 border-l-2 border-dashed border-slate-400" style="left:50%" title="건강보험 금융소득 1,000만원"></div>');
    set('taxRoom', fin > TAX_LIMIT
        ? '<span class="text-red-600">기준을 ' + taxWon(-room) + ' 넘었어요 → 종합과세 대상</span>'
        : '종합과세 기준까지 <b class="text-emerald-700">' + taxWon(room) + '</b> 남았어요');
    set('taxBreakdown',
        '<tr><td class="py-2 text-slate-500">올해 받은 배당 (과세표준 기준)</td><td class="py-2 text-right mono">' + taxWon(got.taxable) + '</td><td class="py-2 text-right text-xs text-slate-400 mono">받은 금액 ' + taxWon(got.gross) + '</td></tr>'
        + '<tr><td class="py-2 text-slate-500">남은 예상 배당 (과세표준 비율)</td><td class="py-2 text-right mono">' + taxWon(exp.taxable) + '</td><td class="py-2 text-right text-xs text-slate-400 mono">예상 ' + taxWon(exp.gross) + '</td></tr>'
        + '<tr><td class="py-2 text-slate-500">해외주식형 ETF 매도 차익 (과세분)</td><td class="py-2 text-right mono">' + taxWon(etfGain) + '</td><td></td></tr>'
        + '<tr><td class="py-2 text-slate-500">예금이자 · 다른 배당</td><td class="py-2 text-right mono">' + taxWon(other) + '</td><td></td></tr>'
        + '<tr><td class="py-2 text-slate-500">ISA · 연금계좌 분 (제외)</td><td class="py-2 text-right mono text-blue-500">−' + taxWon(isa) + '</td><td></td></tr>'
        + (got.estimatedGross > 0 ? '<tr><td colspan="3" class="py-2 text-[11px] text-amber-600">ℹ️ 과세표준 공시를 못 찾은 배당 ' + taxWon(got.estimatedGross) + '은 전액 과세로 계산했어요 (실제보다 크게 잡힐 수 있음)</td></tr>' : ''));

    var wageNote = baseOv > 0 ? '원천징수영수증 과세표준 사용' : (salary > 0 ? '연봉으로 추정한 근로소득 과세표준 ' + taxWon(wageBase) + ' (한계세율 ' + Math.round(taxMarginalRate(wageBase) * 100) + '%)' : '연봉을 넣으면 종합과세 시 추가 세금을 추정해요');
    set('taxWageNote', wageNote);
    set('taxExtraTax', fin > TAX_LIMIT ? taxWon(extraTax) : '₩0');
    set('taxExtraTaxNote', fin > TAX_LIMIT
        ? (salary > 0 || baseOv > 0 ? '내년 5월 종합소득세 신고 때 더 낼 세금 (지방세 포함, 추정)' : '⚠️ 연봉을 넣어야 정확해요')
        : '2,000만원 이하 → 15.4% 원천징수로 끝 (분리과세)');
    set('taxExtraHi', extraHi > 0 ? taxWon(extraHi) + '<span class="text-sm font-bold text-slate-400"> /년</span>' : '₩0');
    set('taxExtraHiNote', hiIncome > 0
        ? (extraHi > 0 ? '보수 외 소득 2,000만원 초과분 × 8.13% (월 ' + taxWon(extraHi / 12) + ', 본인 100% 부담)' : '금융소득이 1,000만원을 넘어 전액 집계되지만 2,000만원 이하라 추가 보험료 없음')
        : '금융소득 1,000만원 이하 → 건보료 집계 제외');

    // 상황별 안내
    var tips = [];
    if (fin > TAX_LIMIT * 0.75 && fin <= TAX_LIMIT) tips.push('기준의 75%를 넘었어요. 연말까지 받을 분배금을 다시 확인하고, 추가 매수는 ISA·연금저축·IRP 계좌를 먼저 고려해 보세요.');
    if (fin > TAX_LIMIT) tips.push('종합과세는 2,000만원을 넘는 부분만 근로소득과 합산돼 한계세율로 과세돼요. 넘는 금액이 작다면 분배금 기준일 전 매도·계좌 이동으로 조절할 여지가 있는지 살펴보세요.');
    if (etfGain === 0) tips.push('해외주식형·채권형 등 국내상장 ETF를 팔아 생긴 이익도 배당소득으로 과세돼 금융소득에 들어가요 (국내주식형 ETF 매매차익은 비과세).');
    if (isa === 0) tips.push('ISA·연금계좌 안에서 받은 분배금은 종합과세 집계에서 빠져요. 해당 금액이 있으면 위에 입력하세요.');
    tips.push('부부·가족 명의로 나눠 보유하면 1인당 2,000만원 기준이 각각 적용돼요.');
    set('taxTips', tips.map(function (t) { return '<li>' + t + '</li>'; }).join(''));
}
