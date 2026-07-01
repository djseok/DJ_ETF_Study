// =========================================================
// 🧮 구매 계산기 (목표 비중 0% 필터링 업그레이드 버전)
// =========================================================

// 예수금 입력값이 바뀔 때마다 즉시 실시간 연산 수행
document.getElementById('inputCash').addEventListener('input', calculateRebalancing);

async function renderCalculatorView() {
    const selector = document.getElementById('calcUserSelector');
    if (!selector) return;

    // 메모리에 포트폴리오 정보가 없으면 로드 함수 강제 호출
    if (!globalParsedUsers || Object.keys(globalParsedUsers).length === 0) {
        if (typeof loadPortfolioData === 'function') {
            document.getElementById('calcTableBody').innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">포트폴리오 데이터를 동기화 중입니다... 🐕</td></tr>`;
            await loadPortfolioData('calc');
            return;
        }
    }

    const names = Object.keys(globalParsedUsers);
    
    // 셀렉터 옵션 목록을 포트폴리오에 등록된 실제 투자자 이름(동진, S, D, J)으로 빌드
    if (selector.options.length !== names.length && names.length > 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        // 투자자 선택이 바뀔 때마다 재계산
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
        document.getElementById('calcTableBody').innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">선택한 투자자의 포트폴리오 데이터가 없습니다.</td></tr>`;
        return;
    }

    let tableHtml = "";
    userObj.items.forEach(item => {
        // 구글 시트에서 비중이 25% 형태(즉 숫자 25)로 오는지, 0.25로 오는지 판독하여 규격 통일
        let weightRaw = item.targetWeight;
        let actualWeight = weightRaw > 1 ? weightRaw / 100 : weightRaw; 
        
        // 🚨 [피드백 반영] C열 목표 비중이 0%이거나 비어있다면 장바구니에 띄우지 않고 그냥 건너뜁니다!
        if (actualWeight <= 0) return;

        // 투입 예수금 * 개인 포트폴리오상 목표 비중 = 종목별 할당 금액
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

    // 만약 모든 종목 비중이 0%여서 노출할 종목이 아예 없다면 예외 안내 문구 표시
    document.getElementById('calcTableBody').innerHTML = tableHtml || `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">목표 비중(>0%)이 설정된 종목이 없습니다.</td></tr>`;
    
    // 수동 주수 변경 감지 이벤트 바인딩
    document.querySelectorAll('.calc-manual-qty').forEach(input => {
        input.addEventListener('input', updateManualCalculator);
    });
    updateManualCalculator();
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

        // 개별 행의 실제 매수 금액 계산
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
        cashUI.className = remainingCash < 0 ? "px-6 py-3 text-right text-red-600 font-black mono" : "px
