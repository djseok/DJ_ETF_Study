function extractGlobalMacroVariables() {
    masterRawData.forEach(row => {
        if(row[0] === '지표') {
            let prev = parseFloat(String(row[3]).replace(/,/g, ''))||0;
            let live = parseFloat(String(row[4]).replace(/,/g, ''))||0;
            let pct = prev > 0 ? ((live - prev) / prev * 100) : 0;
            let colorClass = pct >= 0 ? 'text-red-500' : 'text-blue-500';
            let sign = pct >= 0 ? '▲' : '▼';

            if(row[1] === '나스닥') {
                document.getElementById('macro-nasdaq').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toLocaleString()}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
            } else if(row[1] === '환율') {
                globalFxDelta = prev > 0 ? (live - prev) / prev : 0;
                document.getElementById('macro-fx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">₩${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
            } else if(row[1].toUpperCase() === 'VIX') {
                globalVixValue = live;
                document.getElementById('macro-vix').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
            } else if(row[1].replace(/\s+/g, '').includes('TNX')) {
                document.getElementById('macro-tnx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}%</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
            }
        }
    });
}

function populateAssetDropdownSelector() {
    const selector = document.getElementById('assetSelector');
    const uniqueAssets = [...new Set(masterRawData.filter(row => row[0] === '기준').map(row => row[1]))];
    selector.innerHTML = uniqueAssets.map(asset => `<option value="${asset}">${asset}</option>`).join('');
}

function renderTargetAssetDashboard(target) {
    let tBuy = -2.5, tSell = 3.0, beta = 1.0, bPrev = 0, bLive = 0, comps = [];
    masterRawData.forEach(r => {
        if(r[1] !== target && r[0] !== target) return;
        let val3 = parseFloat(String(r[3]).replace(/,/g, ''))||0;
        let val4 = parseFloat(String(r[4]).replace(/,/g, ''))||0;
        let val5 = parseFloat(String(r[5]).replace(/,/g, ''))||0;
        if(r[0] === '기준') { tBuy = val3; tSell = val4; }
        else if(r[0] === '베타') { beta = val3; }
        else if(r[0] === '본체') { bPrev = val3; bLive = val4; }
        else if(r[0] === target) { comps.push({ name: r[1], ticker: r[2], prev: val3, live: val4, w: val5 }); }
    });

    document.getElementById('threshBuyUI').innerText = `${tBuy}%`; 
    document.getElementById('threshSellUI').innerText = `+${tSell}%`;

    let rawDelta = 0, tableHtml = "";
    comps.forEach(c => {
        let live = (isNaN(c.live) || c.live === 0) ? c.prev : c.live;
        let d = c.prev > 0 ? (live - c.prev) / c.prev : 0;
        let cont = d * (c.w / 100);
        rawDelta += cont;
        
        tableHtml += `<tr class="hover:bg-slate-50">
            <td class="px-6 py-4 font-bold text-slate-800">${c.name}</td>
            <td class="px-6 py-4 text-xs font-mono"><span class="bg-slate-100 text-slate-500 px-2 py-1 rounded">${c.ticker}</span></td>
            <td class="px-6 py-4 text-right mono">
                <div class="text-[10px] text-slate-400 font-semibold mb-0.5">전일 ₩${c.prev.toLocaleString()}</div>
                <div class="font-black ${d > 0 ? 'text-red-500' : (d < 0 ? 'text-blue-500' : 'text-slate-700')}">현재 ₩${live.toLocaleString()}</div>
            </td>
            <td class="px-6 py-4 text-right mono font-bold ${d>=0?'text-red-500':'text-blue-500'}">${d>=0?'+':''}${(d*100).toFixed(2)}%</td>
            <td class="px-6 py-4 text-right mono text-slate-400">${c.w}%</td>
            <td class="px-6 py-4 text-right mono font-black bg-orange-50/30 ${cont>=0?'text-red-600':'text-blue-600'}">${cont>=0?'+':''}${(cont*100).toFixed(2)}%</td>
        </tr>`;
    });
    document.getElementById('componentTableBody').innerHTML = tableHtml;

    let vMult = (globalVixValue >= 25) ? 1.30 : (globalVixValue >= 20 ? 1.15 : 1.0);
    let finalRet = ((1 + rawDelta * beta) * (1 + globalFxDelta) - 1) * 100 * vMult;
    
    document.getElementById('mathPure').innerText = `${(rawDelta*100).toFixed(2)}%`;
    document.getElementById('mathBeta').innerText = `${beta}x`;
    document.getElementById('mathFx').innerText = `${(globalFxDelta*100).toFixed(2)}%`;
    document.getElementById('mathVix').innerText = `${vMult}x`;
    document.getElementById('predictedChange').innerText = `${finalRet>=0?'+':''}${finalRet.toFixed(2)}%`;
    document.getElementById('predictedChange').className = `text-4xl font-black mono ${finalRet>=0?'text-red-600':'text-blue-600'}`;

    let expectedPrice = bPrev * (1 + finalRet / 100);
    document.getElementById('predictedPrice').innerText = `오늘 예상가: ₩${Math.round(expectedPrice).toLocaleString()}`;
    document.getElementById('currentLivePrice').innerText = `실시간 현재가: ₩${bLive > 0 ? Math.round(bLive).toLocaleString() : Math.round(bPrev).toLocaleString()}`;

    const c = document.getElementById('signalCard'), t = document.getElementById('signalTitle'), d = document.getElementById('signalDesc');
    c.className = "p-6 rounded-2xl shadow-md transition-all duration-300 relative overflow-hidden border border-slate-200 " + (finalRet <= tBuy ? "signal-buy-strong" : (finalRet >= tSell ? "signal-sell-strong" : "signal-hold"));
    if(finalRet <= tBuy) { t.innerHTML = "BUY 🛒🐕"; d.innerHTML = "기계적 매수 구간 통과 중."; }
    else if(finalRet >= tSell) { t.innerHTML = "SELL 💰🐕"; d.innerHTML = "목표 익절 구간 통과 중."; }
    else { t.innerHTML = "HOLD 💤🐕"; d.innerHTML = "박스권 안의 안정 자산 복리 관망 구간."; }
}
