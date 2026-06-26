function initConcentrationView() {
    const selector = document.getElementById('concUserSelector');
    const names = Object.keys(globalParsedUsers);
    if(selector.options.length === 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.addEventListener('change', renderConcentrationView);
    }
    renderConcentrationView();
}

function renderConcentrationView() {
    const targetUser = document.getElementById('concUserSelector').value;
    const userObj = globalParsedUsers[targetUser];
    if(!userObj) return;

    let totalAssets = userObj.totalCurrent;
    let stockExposure = {};

    userObj.items.forEach(item => {
        if (item.current <= 0) return;
        let etfWeights = null;
        for (let key in ETF_COMPOSITION_MATRIX) {
            if (item.stock.replace(/\s+/g, '').includes(key.replace(/\s+/g, '')) || key.replace(/\s+/g, '').includes(item.stock.replace(/\s+/g, ''))) {
                etfWeights = ETF_COMPOSITION_MATRIX[key];
                break;
            }
        }
        if (etfWeights) {
            for (let singleStock in etfWeights) {
                if (!stockExposure[singleStock]) stockExposure[singleStock] = 0;
                stockExposure[singleStock] += item.current * etfWeights[singleStock];
            }
        }
    });

    let sortedStocks = Object.keys(stockExposure).map(s => {
        return { name: s, amount: stockExposure[s], percent: (stockExposure[s] / totalAssets) * 100 };
    }).sort((a, b) => b.percent - a.percent);

    let resultsHtml = '';
    if (sortedStocks.length === 0) {
        resultsHtml = `<div class="p-6 text-center text-slate-500 font-bold bg-slate-50 rounded-xl border border-slate-200">분석 가능한 하위 빅테크 종목 비중이 없습니다.</div>`;
    } else {
        sortedStocks.forEach(stock => {
            if(stock.percent < 0.5) return;
            let badgeClass = "bg-slate-50 text-slate-600";
            let barClass = "from-slate-400 to-slate-500";
            let warningText = "안정적";

            if (stock.percent >= 20) { badgeClass = "bg-red-50 text-red-600"; barClass = "from-red-400 to-red-500"; warningText = "위험 경고! 분산 필요"; }
            else if (stock.percent >= 10) { badgeClass = "bg-blue-50 text-blue-600"; barClass = "from-blue-400 to-blue-500"; warningText = "비중 주의"; }

            resultsHtml += `<div>
                <div class="flex justify-between items-end mb-2">
                    <span class="font-bold text-slate-800 text-lg">${stock.name}</span>
                    <span class="${badgeClass} font-black px-2 py-1 rounded text-sm shadow-sm">${stock.percent.toFixed(1)}% (${warningText})</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-5 overflow-hidden border border-slate-200 shadow-inner">
                    <div class="bg-gradient-to-r ${barClass} h-5 rounded-full transition-all duration-1000 ease-out" style="width: ${stock.percent}%"></div>
                </div>
            </div>`;
        });
    }
    document.getElementById('concResultsContainer').innerHTML = resultsHtml;
}
