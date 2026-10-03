// =========================================================
// 🎯 D 전략 (ISA · 레버리지 60 / 나스닥CC 40)
// - 데이터: 동진ETF공부_개인일기장 D_월별예상 · D_실적기록 탭 (웹 게시 CSV)
// - 계산은 시트 수식이 하고, 여기서는 읽어서 보여주기만 합니다.
// =========================================================

var dPlanChart = null;
var dPlanLoaded = false;

function dNum(v) {
    if (v === undefined || v === null) return NaN;
    var s = String(v).replace(/[,\s원M]/g, '');
    if (s === '' || s === '-') return NaN;
    var pct = s.endsWith('%');
    var n = parseFloat(pct ? s.slice(0, -1) : s);
    return pct ? n / 100 : n;
}
function dMan(v) { return isNaN(v) ? '-' : Math.round(v / 1e4).toLocaleString('ko-KR') + '만'; }
function dWon(v) { return isNaN(v) ? '-' : Math.round(v).toLocaleString('ko-KR') + '원'; }
function dPct(v) { return isNaN(v) ? '-' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

// 라벨로 값 찾기: 라벨 칸 바로 오른쪽 값
function dFindLabel(m, label) {
    for (var r = 0; r < m.length; r++) {
        for (var c = 0; c < m[r].length - 1; c++) {
            if (String(m[r][c]).trim() === label) return m[r][c + 1];
        }
    }
    return '';
}

async function loadDStrategyView(force) {
    if (dPlanLoaded && !force) return;
    var box = document.getElementById('dPlanStatus');
    if (box) box.textContent = '데이터를 불러오는 중입니다...';
    try {
        var res = await Promise.all([fetch(sheetUrl('D_PLAN')), fetch(sheetUrl('D_ACTUAL'))]);
        if (!res[0].ok) throw new Error('D_월별예상 탭을 불러오지 못했어요 (' + res[0].status + ')');
        var plan = parseCsv(await res[0].text());
        var actual = res[1].ok ? parseCsv(await res[1].text()) : [];
        renderDStrategy(plan, actual);
        dPlanLoaded = true;
        if (box) box.textContent = '';
    } catch (e) {
        if (box) box.textContent = '⚠️ ' + e.message + ' — 시트의 [파일 → 공유 → 웹에 게시]에 D_월별예상 탭이 포함됐는지 확인해 주세요.';
    }
}

function renderDStrategy(plan, actual) {
    // 요약
    var kpi = {
        start: dFindLabel(plan, '출발 회차'),
        last: dFindLabel(plan, '마지막 기록일'),
        v60: dNum(dFindLabel(plan, '60M 예상 총평가액')),
        hit: dFindLabel(plan, '목표 금액 도달 회차'),
        lev: dFindLabel(plan, '레버리지 매수 시작 회차'),
        div60: dNum(dFindLabel(plan, '60M 월 분배금')),
        ret60: dNum(dFindLabel(plan, '60M 원금 대비 수익률')),
        mode: dFindLabel(plan, '가정 적용 방식')
    };
    var setText = function (id, t) { var el = document.getElementById(id); if (el) el.textContent = t; };
    setText('dKpiV60', dMan(kpi.v60));
    setText('dKpiRet60', '원금 대비 ' + dPct(kpi.ret60));
    setText('dKpiHit', kpi.hit || '-');
    setText('dKpiLev', kpi.lev || '-');
    setText('dKpiDiv', dWon(kpi.div60));
    setText('dKpiMode', '가정: ' + (kpi.mode || '-') + ' · 마지막 기록 ' + (kpi.last || '-') + ' (' + (kpi.start || '-') + 'M)');

    // 월별 표
    var h = -1;
    for (var r = 0; r < plan.length; r++) if (String(plan[r][0]).trim() === '회차(M)') { h = r; break; }
    var rows = h < 0 ? [] : plan.slice(h + 1).filter(function (x) { return String(x[0]).trim() !== ''; });

    // 이번 달 매수 (첫 줄)
    if (rows.length) {
        var f = rows[0];
        setText('dNowTitle', f[0] + ' (' + f[1] + ') 예상 매수');
        setText('dNowCash', dWon(dNum(f[4])));
        setText('dNowLev', dWon(dNum(f[7])));
        setText('dNowCc', dWon(dNum(f[8])));
        setText('dNowPhase', dNum(f[6]) === 2 ? '2단계: 레버리지 60 / CC 40에서 모자란 종목부터' : '1단계: 기본예탁금 1천만 원 전 → 나스닥CC(491620)만');
    }

    var tb = document.getElementById('dPlanTable');
    if (tb) {
        tb.innerHTML = rows.map(function (x) {
            var m = parseInt(x[0], 10);
            var hl = (m % 12 === 0 || dNum(x[3]) > 0) ? ' class="bg-blue-50 font-bold"' : '';
            var ret = dNum(x[15]);
            return '<tr' + hl + '>' +
                '<td class="px-2 py-1.5">' + x[0] + '</td><td class="px-2 py-1.5">' + x[1] + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + dMan(dNum(x[4])) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + dMan(dNum(x[7])) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + dMan(dNum(x[8])) + '</td>' +
                '<td class="px-2 py-1.5 text-right font-bold">' + dMan(dNum(x[13])) + '</td>' +
                '<td class="px-2 py-1.5 text-right ' + (ret >= 0 ? 'text-red-600' : 'text-blue-600') + '">' + dPct(ret) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + dMan(dNum(x[12])) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + x[16] + '</td></tr>';
        }).join('');
    }

    // 차트: 예상 총평가액 · 누적 원금 · 실제 기록
    var labels = rows.map(function (x) { return x[0]; });
    var actualMap = {};
    if (actual.length > 1) {
        actual.slice(1).forEach(function (x) {
            var m = String(x[1]).trim(), v = dNum(x[12]);
            if (m && !isNaN(v)) actualMap[m + 'M'] = v / 1e4;
        });
    }
    var actPoints = labels.map(function (l) { return actualMap[l] !== undefined ? actualMap[l] : null; });
    var ctx = document.getElementById('dPlanChart');
    if (ctx && typeof Chart !== 'undefined') {
        if (dPlanChart) dPlanChart.destroy();
        dPlanChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: '예상 총평가액', data: rows.map(function (x) { return dNum(x[13]) / 1e4; }), borderColor: '#2563eb', borderWidth: 2.5, pointRadius: 0, tension: 0.2 },
                    { label: '누적 납입 원금', data: rows.map(function (x) { return dNum(x[14]) / 1e4; }), borderColor: '#f59e0b', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
                    { label: '실제 기록', data: actPoints, borderColor: '#dc2626', backgroundColor: '#dc2626', showLine: false, pointRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + (c.raw === null ? '-' : Math.round(c.raw).toLocaleString('ko-KR') + '만'); } } } },
                scales: { y: { ticks: { callback: function (v) { return v.toLocaleString('ko-KR') + '만'; } } } }
            }
        });
    }
}


// =========================================================
// 🧮 구매 계산기 연동: D 선택 시 D 전략 규칙으로 장바구니 계산
//   시트 D_매수계획 과 같은 공식 (D_설정 · D_보유 탭 사용)
// =========================================================
var dCalcCache = null;
var dCalcCashSet = false;

async function dLoadCalcData() {
    if (dCalcCache) return dCalcCache;
    var res = await Promise.all([fetch(sheetUrl('D_CFG')), fetch(sheetUrl('D_HOLD'))]);
    if (!res[0].ok || !res[1].ok) throw new Error('D_설정 · D_보유 탭을 불러오지 못했어요');
    var cfgM = parseCsv(await res[0].text()), holdM = parseCsv(await res[1].text());
    var get = function (label) { return dFindLabel(cfgM, label); };
    var cfg = {
        levCode: String(get('레버리지 종목코드')).trim(),
        nccCode: String(get('나스닥CC 종목코드(신규 매수용)')).trim(),
        wLev: dNum(get('레버리지 목표 비중')),
        threshold: dNum(get('레버리지 활성 기준금액')),
        eligible: String(get('레버리지 사전교육 이수')).toUpperCase() === 'TRUE',
        cash: (dNum(get('이번 달 신규 입금액')) || 0) + (dNum(get('분배금 + 예수금')) || 0),
        haircut: dNum(get('보유주식 예탁금 반영률')),
        appDeposit: dNum(get('앱 표시 기본예탁금 인정액(선택)'))
    };
    // D_보유: A 코드 · B 종목명 · C 역할 · D 수량 · E 평단 · F 수동가 · G 현재가 · H 평가액
    var rows = holdM.slice(1).filter(function (r) { return String(r[1] || '').trim(); }).map(function (r) {
        return { code: String(r[0]).trim(), name: String(r[1]).trim(), role: String(r[2]).trim().toUpperCase(), price: dNum(r[6]) || 0, value: dNum(r[7]) || 0 };
    });
    dCalcCache = { cfg: cfg, rows: rows };
    return dCalcCache;
}

// 순수 계산 (시트 D_매수계획 과 같은 규칙)
function dStrategyPlan(cfg, rows, cash) {
    var sum = function (role) { return rows.filter(function (r) { return !role || r.role === role; }).reduce(function (s, r) { return s + r.value; }, 0); };
    var lev = sum('LEV'), ncc = sum('NCC'), total = sum(null);
    var dep = cfg.appDeposit > 0 ? cfg.appDeposit + cash : cash + total * (cfg.haircut > 0 ? cfg.haircut : 1);
    var phase2 = dep >= cfg.threshold && cfg.eligible;
    var priceOf = function (code) { var r = rows.find(function (x) { return x.code === code; }); return r ? r.price : 0; };
    var pLev = priceOf(cfg.levCode), pCc = priceOf(cfg.nccCode);
    var levBudget = phase2 ? Math.min(cash, Math.max(0, cfg.wLev * (lev + ncc + cash) - lev)) : 0;
    var levQty = phase2 && pLev > 0 ? Math.floor(levBudget / pLev) : 0;
    var ccQty = pCc > 0 ? Math.floor((cash - levQty * pLev) / pCc) : 0;
    return { phase2: phase2, dep: dep, toGo: Math.max(0, cfg.threshold - dep), lev: lev, ncc: ncc, pLev: pLev, pCc: pCc,
        levQty: levQty, ccQty: ccQty, levTarget: phase2 ? cfg.wLev : 0 };
}

function dStrategyNameOf(rows, code) { var r = rows.find(function (x) { return x.code === code; }); return r ? r.name : code; }

async function dStrategyCalc(cashInput) {
    var body = document.getElementById('calcTableBody'), note = document.getElementById('calcStrategyNote');
    try {
        var d = await dLoadCalcData();
        var input = document.getElementById('inputCash');
        // 처음 D 를 고르면 예수금 칸을 시트 D_설정 금액(이번 달 입금 + 분배금·예수금)으로 채움
        if (!dCalcCashSet && input && d.cfg.cash > 0) { dCalcCashSet = true; input.value = Math.round(d.cfg.cash); cashInput = d.cfg.cash; }
        var p = dStrategyPlan(d.cfg, d.rows, cashInput);
        var rowHtml = function (code, name, weight, price, qty) {
            var alloc = qty * price;
            return '<tr class="hover:bg-slate-50 transition-colors">' +
                '<td class="px-6 py-4 font-bold text-slate-800">' + name + ' <span class="text-xs text-slate-400">' + code + '</span></td>' +
                '<td class="px-6 py-4 text-right font-bold text-slate-400">' + Math.round(weight * 100) + '%</td>' +
                '<td class="px-6 py-4 text-right font-mono text-slate-600">₩' + Math.round(price).toLocaleString() + '</td>' +
                '<td class="px-6 py-4 text-right font-mono text-orange-600 font-bold bg-orange-50/40">₩' + Math.round(alloc).toLocaleString() + '</td>' +
                '<td class="px-6 py-4 text-right bg-blue-50/20 border-l border-blue-100"><div class="flex items-center justify-end">' +
                '<input type="number" min="0" data-price="' + price + '" data-stock="' + name + '" class="calc-manual-qty w-20 bg-white border border-blue-300 text-blue-700 font-black text-center rounded-lg shadow-inner p-1.5" value="' + qty + '">' +
                '<span class="ml-2 text-slate-500 font-bold">주</span></div></td>' +
                '<td class="px-6 py-4 text-right font-mono text-slate-800 font-black row-actual-cost">₩0</td></tr>';
        };
        body.innerHTML = rowHtml(d.cfg.levCode, dStrategyNameOf(d.rows, d.cfg.levCode), p.levTarget, p.pLev, p.levQty) +
                         rowHtml(d.cfg.nccCode, dStrategyNameOf(d.rows, d.cfg.nccCode), 1 - p.levTarget, p.pCc, p.ccQty);
        if (note) {
            note.classList.remove('hidden');
            note.innerHTML = '<b>🎯 D 전략 (ISA) 규칙으로 계산</b> · ' +
                (p.phase2 ? '2단계: 레버리지 60 / 나스닥CC 40에서 모자란 종목부터'
                          : '1단계: 기본예탁금 1천만 원 전 → 나스닥CC만 (레버리지까지 남은 ' + Math.round(p.toGo / 1e4).toLocaleString() + '만 원)') +
                '<br><span class="text-xs text-slate-500">기본예탁금 인정액(추정) ' + Math.round(p.dep).toLocaleString() + '원 · 기존 보유 종목은 사지도 팔지도 않음 · 기준 값은 시트 D_설정에서 변경</span>';
        }
        document.querySelectorAll('.calc-manual-qty').forEach(function (i) { i.addEventListener('input', updateManualCalculator); });
        updateManualCalculator();
        if (typeof runStressTest === 'function') runStressTest();
    } catch (e) {
        if (body) body.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">⚠️ ' + e.message + '</td></tr>';
    }
}
