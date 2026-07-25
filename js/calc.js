// =========================================================
// 🧮 구매 계산기 (V17 통합 포트폴리오 연동 완벽 패치 + 🚨 스트레스 테스트)
// =========================================================

document.getElementById('inputCash').addEventListener('input', calculateRebalancing);

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
    const cashInput = parseFloat(document.getElementById('inputCash').value) || 0;
    const userObj = globalParsedUsers[targetUser];
    
    if (!userObj || !userObj.items || userObj.items.length === 0) {
        document.getElementById('calcTableBody').innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">선택한 투자자의 데이터가 없습니다.</td></tr>`;
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
                    <input type="number" min="0" data-price="${item.currPrice}" data-stock="${item.stock}" 
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

    // 🚨 구매 계산기가 다시 그려질 때마다 스트레스 테스트도 최신 유저 기준으로 자동 갱신
    if (typeof runStressTest === 'function') runStressTest();
}

function updateManualCalculator() {
    let cashInput = parseFloat(document.getElementById('inputCash').value) || 0;
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
        guideHtml = `<div class="p-3 text-red-600 font-bold text-center"><i class="fas fa-exclamation-triangle mr-1"></i>입력하신 예수금을 초과했습니다! 매수 수량을 줄여주세요.</div>`;
    } else {
        guideData.forEach(g => g.needed = g.price - remainingCash);
        guideData.sort((a,b) => a.needed - b.needed);
        guideData.forEach((g, idx) => {
            let badge = g.needed <= 0 ? `<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-black">즉시 1주 추가가능!</span>` : `<span class="text-orange-500 font-bold mono">₩${Math.round(g.needed).toLocaleString()} 추가 필요</span>`;
            guideHtml += `<div class="flex justify-between items-center bg-white p-3 rounded-lg border border-blue-50 mb-2"><div class="text-sm font-bold text-slate-700"><span class="text-blue-400 font-mono mr-1">${idx+1}.</span> ${g.stock}</div><div class="text-right text-xs"><div class="text-slate-400 mono mb-0.5">1주 가격: ₩${Math.round(g.price).toLocaleString()}</div>${badge}</div></div>`;
        });
    }
    const extraGuide = document.getElementById('extraBuyGuide');
    if (extraGuide) extraGuide.innerHTML = guideHtml;
}

// =========================================================
// 🚨 추가: 폭락장 스트레스 테스트 계산 로직
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
    const stressSlider = document.getElementById('stressSlider');
    const userSelector = document.getElementById('calcUserSelector');
    
    if (stressSlider) {
        stressSlider.addEventListener('input', runStressTest);
    }
    if (userSelector) {
        userSelector.addEventListener('change', runStressTest);
    }
});

function runStressTest() {
    const slider = document.getElementById('stressSlider');
    const userSelector = document.getElementById('calcUserSelector');
    if (!slider || !userSelector || !userSelector.value) return;

    const dropPct = parseFloat(slider.value) * -1; // 예: -5
    document.getElementById('stressDropLabel').innerText = `${dropPct}%`;
    document.getElementById('stressUserName').innerText = userSelector.value;

    const userObj = globalParsedUsers[userSelector.value];
    if (!userObj || !userObj.items) return;

    // 대략적인 종목별 베타(Beta) 하드코딩 매핑 (안전망)
    const betaMap = {
        '반도체': 1.5,
        '나스닥': 1.2,
        'S&P': 1.0,
        '글로벌AI': 1.3,
        '배당': 0.8,
        '커버드콜': 0.6
    };

    let originalTotal = 0;
    let stressedTotal = 0;

    userObj.items.forEach(item => {
        if (item.qty <= 0) return;
        originalTotal += item.current;

        // 종목명 기반 베타 유추
        let assetBeta = 1.0;
        for (let key in betaMap) {
            if (item.stock.includes(key)) {
                assetBeta = betaMap[key];
                break;
            }
        }

        // 스트레스 적용 가격 계산 (시장 하락률 * 베타)
        let assetDrop = dropPct * assetBeta;
        let expectedPrice = item.currPrice * (1 + (assetDrop / 100));
        stressedTotal += (expectedPrice * item.qty);
    });

    let totalLoss = stressedTotal - originalTotal;

    const balanceEl = document.getElementById('stressResultBalance');
    const lossEl = document.getElementById('stressResultLoss');

    if (balanceEl) balanceEl.innerText = `₩${Math.round(stressedTotal).toLocaleString()}`;
    if (lossEl) {
        lossEl.innerText = `${totalLoss >= 0 ? '+' : ''}₩${Math.round(totalLoss).toLocaleString()}`;
        lossEl.className = `text-xl font-black mono px-3 py-1 rounded-lg ${totalLoss >= 0 ? 'text-blue-500 bg-blue-100/50' : 'text-red-500 bg-red-100/50'}`;
    }
}
