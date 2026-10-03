// =========================================================
// 🧮 구매 계산기 (V17 통합 포트폴리오 연동 완벽 패치)
// =========================================================

document.getElementById('inputCash').addEventListener('input', calculateRebalancing);

// ---------------------------------------------------------
// 📆 매수 주기 (월 1회 / 매주 / 매일)
//  - 예수금 칸은 항상 "한 달 총액", 회차당 금액 = 총액 ÷ 매수 횟수
//  - 장바구니 표는 "1회차에 살 수량", 아래 일정표는 한 달 전체(잔돈 종목별 이월)
// ---------------------------------------------------------
let calcFreq = 'month';
try { const f = localStorage.getItem('calcFreq'); if (f === 'week' || f === 'day') calcFreq = f; } catch (e) {}

// 이번 달 평일 수 · 평일이 들어 있는 주 수 (한국 시간 기준, 공휴일은 모름)
function calcMonthCounts(now) {
    const kst = new Date((now || new Date()).getTime() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let weekdays = 0; const weeks = new Set();
    for (let d = 1; d <= last; d++) {
        const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
        if (dow === 0 || dow === 6) continue;
        weekdays++;
        weeks.add(Math.floor((d - 1 + ((new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7)) / 7)); // 월요일 시작 주 번호
    }
    return { weekdays: weekdays, weeks: weeks.size, month: m + 1 };
}

function calcSessionCount() {
    if (calcFreq === 'month') return 1;
    const n = parseInt(document.getElementById('inputSessions').value, 10);
    return n >= 1 ? Math.min(n, 31) : 1;
}
function calcMonthlyCash() { return parseFloat(document.getElementById('inputCash').value) || 0; }
function calcPerSessionCash() { return calcMonthlyCash() / calcSessionCount(); }

function calcSetFreq(freq, keepCount) {
    calcFreq = (freq === 'week' || freq === 'day') ? freq : 'month';
    try { localStorage.setItem('calcFreq', calcFreq); } catch (e) {}
    document.querySelectorAll('.calc-freq-btn').forEach(b => {
        const on = b.dataset.freq === calcFreq;
        b.className = 'calc-freq-btn py-3 rounded-xl text-sm font-bold border ' +
            (on ? 'bg-orange-500 border-orange-500 text-white' : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100');
    });
    const box = document.getElementById('calcSessionsBox');
    const c = calcMonthCounts();
    if (box) box.classList.toggle('hidden', calcFreq === 'month');
    const input = document.getElementById('inputSessions'), hint = document.getElementById('calcSessionsHint');
    if (calcFreq === 'week') {
        if (!keepCount && input) input.value = c.weeks;
        if (hint) hint.textContent = '(' + c.month + '월은 평일이 있는 주 ' + c.weeks + '주)';
    } else if (calcFreq === 'day') {
        if (!keepCount && input) input.value = c.weekdays;
        if (hint) hint.textContent = '(' + c.month + '월 평일 ' + c.weekdays + '일 · 공휴일은 직접 빼주세요)';
    }
    calculateRebalancing();
}
document.getElementById('inputSessions').addEventListener('input', calculateRebalancing);

function calcUpdatePerSessionNote() {
    const el = document.getElementById('calcPerSessionNote');
    if (!el) return;
    const n = calcSessionCount();
    if (n <= 1) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '🧾 회차당 투입 ₩' + Math.round(calcPerSessionCash()).toLocaleString() +
        ' <span class="font-normal text-slate-500">(₩' + Math.round(calcMonthlyCash()).toLocaleString() + ' ÷ ' + n + '회 · ' +
        (calcFreq === 'week' ? '매주' : '매일') + ') · 아래 장바구니는 <b>이번 회차</b>에 살 수량이에요</span>';
}

// 순수 계산: 종목별 잔돈을 다음 회차로 넘기며 n회 매수
// items: [{stock, price, weight(0~1)}] · 가격은 지금 가격으로 고정한 가정
function calcBuildSchedule(items, monthlyCash, n) {
    const carry = items.map(() => 0), totQty = items.map(() => 0), totCost = items.map(() => 0);
    const sessions = [];
    for (let s = 0; s < n; s++) {
        const row = items.map((it, i) => {
            if (!(it.price > 0) || !(it.weight > 0)) return 0;
            carry[i] += monthlyCash * it.weight / n;
            const q = Math.floor(carry[i] / it.price + 1e-9);
            carry[i] -= q * it.price; totQty[i] += q; totCost[i] += q * it.price;
            return q;
        });
        sessions.push({ qty: row, cost: row.reduce((a, q, i) => a + q * items[i].price, 0) });
    }
    const spent = totCost.reduce((a, b) => a + b, 0);
    return { sessions: sessions, totQty: totQty, totCost: totCost, spent: spent, left: monthlyCash - spent };
}

function calcRenderSchedule() {
    const card = document.getElementById('calcScheduleCard');
    if (!card) return;
    const n = calcSessionCount();
    const items = [...document.querySelectorAll('.calc-manual-qty')].map(i => ({
        stock: i.dataset.stock, price: parseFloat(i.dataset.price) || 0, weight: parseFloat(i.dataset.weight) || 0
    })).filter(it => it.weight > 0);
    if (n <= 1 || items.length === 0) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const monthly = calcMonthlyCash(), r = calcBuildSchedule(items, monthly, n);
    const unit = calcFreq === 'week' ? '주차' : '일차';
    document.getElementById('calcScheduleHead').innerHTML = '<tr><th class="px-4 py-3 text-left">회차</th>' +
        items.map(it => '<th class="px-4 py-3 text-right">' + it.stock + '<div class="text-[10px] font-normal text-slate-400">₩' + Math.round(it.price).toLocaleString() + '</div></th>').join('') +
        '<th class="px-4 py-3 text-right">회차 결제액</th></tr>';
    document.getElementById('calcScheduleBody').innerHTML = r.sessions.map((s, k) => '<tr class="hover:bg-slate-50">' +
        '<td class="px-4 py-2 font-bold text-slate-500">' + (k + 1) + unit + '</td>' +
        s.qty.map(q => '<td class="px-4 py-2 text-right mono ' + (q > 0 ? 'text-blue-700 font-black' : 'text-slate-300') + '">' + (q > 0 ? q + '주' : '–') + '</td>').join('') +
        '<td class="px-4 py-2 text-right mono">₩' + Math.round(s.cost).toLocaleString() + '</td></tr>').join('');
    document.getElementById('calcScheduleFoot').innerHTML = '<tr><td class="px-4 py-3 text-slate-600">한 달 합계</td>' +
        r.totQty.map((q, i) => '<td class="px-4 py-3 text-right mono text-slate-800">' + q + '주<div class="text-[10px] font-normal text-slate-400">₩' + Math.round(r.totCost[i]).toLocaleString() + '</div></td>').join('') +
        '<td class="px-4 py-3 text-right mono text-slate-900 font-black">₩' + Math.round(r.spent).toLocaleString() + '</td></tr>' +
        '<tr><td colspan="' + (items.length + 1) + '" class="px-4 py-2 text-right text-xs text-slate-500">월말에 남는 현금</td><td class="px-4 py-2 text-right mono text-orange-600 font-black">₩' + Math.round(r.left).toLocaleString() + '</td></tr>';
    const never = items.filter((it, i) => r.totQty[i] === 0).map(it => it.stock);
    document.getElementById('calcScheduleNote').innerHTML =
        '※ 모든 회차를 <b>지금 가격</b>으로 가정한 계획이라, 실제로는 가격이 바뀌면 수량도 달라져요 (매 회차 장바구니를 다시 열어 확인).' +
        (never.length ? ' <span class="text-red-500 font-bold">⚠️ ' + never.join(', ') + ' 은(는) 이번 달 배정 금액이 1주 가격보다 작아 한 번도 못 사요 — 매수 횟수를 줄이거나 예수금을 늘려야 해요.</span>' : '') +
        ' 소수점 매수는 반영하지 않았어요.';
}

async function renderCalculatorView() {
    const selector = document.getElementById('calcUserSelector');
    if (!selector) return;

    // 데이터가 아직 없으면 기다리기
    if (!globalParsedUsers || Object.keys(globalParsedUsers).length === 0) {
        document.getElementById('calcTableBody').innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">포트폴리오 데이터를 불러오는 중입니다... 🐕</td></tr>`;
        return;
    }

    const names = Object.keys(globalParsedUsers);
    
    // 유저 선택창 빌드
    if (selector.options.length !== names.length && names.length > 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.removeEventListener('change', calculateRebalancing);
        selector.addEventListener('change', calculateRebalancing);
    }
    
    calculateRebalancing();
}

function calculateRebalancing() {
    const selector = document.getElementById('calcUserSelector');
    if (!selector || !selector.value) return;

    const targetUser = selector.value;
    const cashInput = calcPerSessionCash();   // 회차당 금액 (월 1회면 한 달 총액 그대로)
    calcUpdatePerSessionNote();

    // D 는 ISA D 전략 규칙(레버리지 60 / 나스닥CC 40, 1천만 원 전에는 나스닥CC만)으로 계산 → js/d_strategy.js
    const dNote = document.getElementById('calcStrategyNote');
    if (targetUser === 'D' && typeof dStrategyCalc === 'function') { dStrategyCalc(calcMonthlyCash(), calcSessionCount()); return; }
    if (dNote) dNote.classList.add('hidden');
    const userObj = globalParsedUsers[targetUser];
    
    if (!userObj || !userObj.items || userObj.items.length === 0) {
        document.getElementById('calcTableBody').innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">선택한 투자자의 데이터가 없습니다.</td></tr>`;
        calcRenderSchedule();
        return;
    }

    let tableHtml = "";
    userObj.items.forEach(item => {
        let actualWeight = item.targetWeight > 1 ? item.targetWeight / 100 : item.targetWeight; 
        
        // 목표 비중이 없거나 0이면 건너뛰기
        if (actualWeight <= 0) return;

        let targetMoney = cashInput * actualWeight;
        let recommendedQty = item.currPrice > 0 ? Math.floor(targetMoney / item.currPrice) : 0;
        
        tableHtml += `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-slate-800">${item.stock}</td>
            <td class="px-6 py-4 text-right font-bold text-slate-400">${(actualWeight * 100).toFixed(0)}%</td>
            <td class="px-6 py-4 text-right font-mono text-slate-600">₩${Math.round(item.currPrice).toLocaleString()}</td>
            <td class="px-6 py-4 text-right font-mono text-orange-600 font-bold bg-orange-50/40">₩${Math.round(targetMoney).toLocaleString()}</td>
            <td class="px-6 py-4 text-right bg-blue-50/20 border-l border-blue-100">
                <div class="flex items-center justify-end">
                    <input type="number" min="0" data-price="${item.currPrice}" data-stock="${item.stock}" data-weight="${actualWeight}" 
                        class="calc-manual-qty w-20 bg-white border border-blue-300 text-blue-700 font-black text-center rounded-lg shadow-inner p-1.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all" 
                        value="${recommendedQty}">
                    <span class="ml-2 text-slate-500 font-bold">주</span>
                </div>
            </td>
            <td class="px-6 py-4 text-right font-mono text-slate-800 font-black row-actual-cost">₩0</td>
        </tr>`;
    });

    document.getElementById('calcTableBody').innerHTML = tableHtml || `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">목표 비중이 설정된 종목이 없습니다.</td></tr>`;
    
    document.querySelectorAll('.calc-manual-qty').forEach(input => {
        input.addEventListener('input', updateManualCalculator);
    });
    updateManualCalculator();
    calcRenderSchedule();
}

function updateManualCalculator() {
    let cashInput = calcPerSessionCash();
    let totalCost = 0;
    let guideData = [];

    document.querySelectorAll('.calc-manual-qty').forEach(input => {
        let qty = parseInt(input.value) || 0;
        let price = parseFloat(input.dataset.price) || 0;
        let stock = input.dataset.stock;
        let rowCost = qty * price;
        totalCost += rowCost;

        const parentTr = input.closest('tr');
        if (parentTr) {
            const costEl = parentTr.querySelector('.row-actual-cost');
            if (costEl) costEl.innerText = `₩${Math.round(rowCost).toLocaleString()}`;
        }
        if (price > 0) guideData.push({ stock: stock, price: price });
    });

    let remainingCash = cashInput - totalCost;
    document.getElementById('calcTotalCost').innerText = `₩${Math.round(totalCost).toLocaleString()}`;
    let cashUI = document.getElementById('calcRemainingCash');
    if (cashUI) {
        cashUI.innerText = `₩${Math.round(remainingCash).toLocaleString()}`;
        cashUI.className = remainingCash < 0 ? "px-6 py-3 text-right text-red-600 font-black mono" : "px-6 py-3 text-right text-orange-600 font-black mono";
    }

    let guideHtml = "";
    if(remainingCash < 0) {
        guideHtml = `<div class="p-3 text-red-600 font-bold text-center"><i class="fas fa-exclamation-triangle mr-1"></i>${calcSessionCount() > 1 ? '이번 회차 금액' : '입력하신 예수금'}을 초과했습니다! 매수 수량을 줄여주세요.</div>`;
    } else {
        guideData.forEach(g => g.needed = g.price - remainingCash);
        guideData.sort((a,b) => a.needed - b.needed);
        guideData.forEach((g, idx) => {
            let badge = g.needed <= 0 ? `<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-black">즉시 1주 추가가능!</span>` : `<span class="text-orange-500 font-bold mono">₩${Math.round(g.needed).toLocaleString()} 추가 필요</span>`;
            guideHtml += `<div class="flex justify-between items-center bg-white p-3 rounded-lg border border-blue-50 mb-2"><div class="text-sm font-bold text-slate-700"><span class="text-blue-400 font-mono mr-1">${idx+1}.</span> ${g.stock}</div><div class="text-right text-xs"><div class="text-slate-400 mono mb-0.5">1주 가격: ₩${Math.round(g.price).toLocaleString()}</div>${badge}</div></div>`;
        });
    }
    if (calcSessionCount() > 1 && remainingCash >= 0) {
        guideHtml = `<div class="p-3 mb-2 rounded-lg bg-amber-50 border border-amber-100 text-xs font-bold text-amber-800">📆 분할 매수 중에는 남은 잔돈을 쓰지 않고 다음 회차로 넘기면, 1주가 비싼 종목을 나중 회차에 살 수 있어요 (아래 일정표가 이 방식).</div>` + guideHtml;
    }
    const extraGuide = document.getElementById('extraBuyGuide');
    if (extraGuide) extraGuide.innerHTML = guideHtml;
}

calcSetFreq(calcFreq);
