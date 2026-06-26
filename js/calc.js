function renderCalculatorView() {
    const selector = document.getElementById('calcUserSelector');
    const names = Object.keys(globalParsedUsers);
    if(selector.options.length === 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.addEventListener('change', calculateRebalancing);
    }
    calculateRebalancing();
}

function calculateRebalancing() {
    const targetUser = document.getElementById('calcUserSelector').value;
    const cashInput = parseFloat(document.getElementById('inputCash').value) || 0;
    const userObj = globalParsedUsers[targetUser];
    if(!userObj) return;

    let tableHtml = "";
    userObj.items.forEach(item => {
        let targetMoney = cashInput * item.targetWeight;
        let recommendedQty = item.currPrice > 0 ? Math.floor(targetMoney / item.currPrice) : 0;
        
        tableHtml += `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-slate-800">${item.stock}</td>
            <td class="px-6 py-4 text-right font-bold text-slate-400">${(item.targetWeight * 100).toFixed(0)}%</td>
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

    document.getElementById('calcTableBody').innerHTML = tableHtml || `<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">구매 전략 데이터가 없습니다.</td></tr>`;
    
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

        input.closest('tr').querySelector('.row-actual-cost').innerText = `₩${Math.round(rowCost).toLocaleString()}`;
        if (price > 0) guideData.push({ stock: stock, price: price });
    });

    let remainingCash = cashInput - totalCost;
    document.getElementById('calcTotalCost').innerText = `₩${Math.round(totalCost).toLocaleString()}`;
    let cashUI = document.getElementById('calcRemainingCash');
    cashUI.innerText = `₩${Math.round(remainingCash).toLocaleString()}`;
    cashUI.className = remainingCash < 0 ? "px-6 py-3 text-right text-red-600 font-black mono" : "px-6 py-3 text-right text-orange-600 font-black mono";

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
    document.getElementById('extraBuyGuide').innerHTML = guideHtml;
}
