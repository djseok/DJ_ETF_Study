// =========================================================
// 📈 퀀트 예측 엔진 (V12.3 데이터 오차 완벽 방어형 아키텍처)
// =========================================================

function extractGlobalMacroVariables() {
    globalFxDelta = 0;
    globalVixValue = 15;

    // Characteristic 시트에서 매크로 지표 추출 (열이 밀려도 마지막 두 숫자를 알아서 찾음)
    macroData.forEach(row => {
        let text = row.join('').replace(/\s+/g, '').toUpperCase();
        let nums = row.map(x => parseFloat(String(x).replace(/,/g, ''))).filter(x => !isNaN(x));
        if (nums.length < 2) return;

        let prev = nums[nums.length - 2]; // 무조건 뒤에서 두 번째 숫자가 전일가
        let live = nums[nums.length - 1]; // 무조건 맨 마지막 숫자가 현재가
        let pct = prev > 0 ? ((live - prev) / prev * 100) : 0;
        let colorClass = pct >= 0 ? 'text-red-500' : 'text-blue-500';
        let sign = pct >= 0 ? '▲' : '▼';

        if (text.includes('나스닥') && !text.includes('KODEX') && !text.includes('TIGER') && !text.includes('RISE')) {
            let el = document.getElementById('macro-nasdaq');
            if(el) el.innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toLocaleString()}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } 
        else if ((text.includes('환율') || text.includes('USDKRW')) && !text.includes('엔') && !text.includes('JPY')) {
            globalFxDelta = prev > 0 ? (live - prev) / prev : 0;
            let el = document.getElementById('macro-fx');
            if(el) el.innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">₩${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } 
        else if (text.includes('VIX')) {
            globalVixValue = live;
            let el = document.getElementById('macro-vix');
            if(el) el.innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } 
        else if (text.includes('TNX')) {
            let el = document.getElementById('macro-tnx');
            if(el) el.innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}%</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        }
    });
}

function populateAssetDropdownSelector() {
    const selector = document.getElementById('assetSelector');
    const uniqueAssets = [];
    signalData.forEach(row => {
        let r0 = String(row[0] || "").trim();
        if (r0.startsWith('■')) {
            uniqueAssets.push(r0.replace('■', '').trim());
        }
    });
    if(selector) selector.innerHTML = uniqueAssets.map(asset => `<option value="${asset}">${asset}</option>`).join('');
}

function renderTargetAssetDashboard(target) {
    if(!target) return;
    
    let cleanTarget = target.replace(/\s+/g, '').toUpperCase();
    let tBuy = -2.0, tSell = 2.0, beta = 1.0;
    let comps = [];
    let isParsingTarget = false;

    // ETF_Quant_Signals 시트 파싱 (열 위치에 구애받지 않는 스마트 탐색)
    for (let i = 0; i < signalData.length; i++) {
        let r = signalData[i];
        let r0 = String(r[0] || "").replace(/\s+/g, '').toUpperCase();

        if (r0.startsWith('■')) {
            let currentSectionName = r0.replace('■', '');
            isParsingTarget = (currentSectionName === cleanTarget); 
            continue;
        }

        if (isParsingTarget) {
            if (r0 === '기준') {
                let nums = r.map(x => parseFloat(String(x).replace(/,/g, ''))).filter(x => !isNaN(x));
                if (nums.length >= 2) { tBuy = nums[0]; tSell = nums[1]; }
                else if (nums.length === 1) { tBuy = nums[0]; }
            } 
            else if (r0 === '베타') {
                let nums = r.map(x => parseFloat(String(x).replace(/,/g, ''))).filter(x => !isNaN(x));
                if (nums.length >= 1) { beta = nums[0]; }
            } 
            else if (r0 === '구성종목') {
                // 비중(%) 입력 방식 완벽 방어: 0.18이든 18.14든 18.14%든 찰떡같이 변환
                let w_raw = parseFloat(String(r[3]).replace(/%/g, '').replace(/,/g, '')) || 0;
                let w = (w_raw > 0 && w_raw <= 1.0) ? w_raw * 100 : w_raw; 
                
                comps.push({
                    name: r[1] || "Unknown",
                    ticker: r[2] || "-",
                    w: w,
                    prev: parseFloat(String(r[4]).replace(/,/g, '')) || 0,
                    live: parseFloat(String(r[5]).replace(/,/g, '')) || 0
                });
            } 
            else if (r0.includes('합계')) {
                break; 
            }
        }
    }

    if(document.getElementById('threshBuyUI')) document.getElementById('threshBuyUI').innerText = `${tBuy}%`; 
    if(document.getElementById('threshSellUI')) document.getElementById('threshSellUI').innerText = `+${tSell}%`;

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
                <div class="text-[10px] text-slate-400 font-semibold mb-0.5">전일 ${c.prev.toLocaleString()}</div>
                <div class="font-black ${d > 0 ? 'text-red-500' : (d < 0 ? 'text-blue-500' : 'text-slate-700')}">현재 ${live.toLocaleString()}</div>
            </td>
            <td class="px-6 py-4 text-right mono font-bold ${d>=0?'text-red-500':'text-blue-500'}">${d>=0?'+':''}${(d*100).toFixed(2)}%</td>
            <td class="px-6 py-4 text-right mono text-slate-400">${c.w.toFixed(2)}%</td>
            <td class="px-6 py-4 text-right mono font-black bg-orange-50/30 ${cont>=0?'text-red-600':'text-blue-600'}">${cont>=0?'+':''}${(cont*100).toFixed(2)}%</td>
        </tr>`;
    });
    
    if(document.getElementById('componentTableBody')) document.getElementById('componentTableBody').innerHTML = tableHtml;

    let vMult = (globalVixValue >= 25) ? 1.30 : (globalVixValue >= 20 ? 1.15 : 1.0);
    let finalRet = ((1 + rawDelta * beta) * (1 + globalFxDelta) - 1) * 100 * vMult;
    
    if(document.getElementById('mathPure')) document.getElementById('mathPure').innerText = `${(rawDelta*100).toFixed(2)}%`;
    if(document.getElementById('mathBeta')) document.getElementById('mathBeta').innerText = `${beta}x`;
    if(document.getElementById('mathFx')) document.getElementById('mathFx').innerText = `${(globalFxDelta*100).toFixed(2)}%`;
    if(document.getElementById('mathVix')) document.getElementById('mathVix').innerText = `${vMult}x`;
    
    if(document.getElementById('predictedChange')) {
        document.getElementById('predictedChange').innerText = `${finalRet>=0?'+':''}${finalRet.toFixed(2)}%`;
        document.getElementById('predictedChange').className = `text-4xl font-black mono ${finalRet>=0?'text-red-600':'text-blue-600'}`;
    }

    const c = document.getElementById('signalCard'), t = document.getElementById('signalTitle'), d = document.getElementById('signalDesc');
    if(c && t && d) {
        c.className = "p-6 rounded-2xl shadow-md transition-all duration-300 relative overflow-hidden border border-slate-200 " + (finalRet <= tBuy ? "signal-buy-strong" : (finalRet >= tSell ? "signal-sell-strong" : "signal-hold"));
        if(finalRet <= tBuy) { t.innerHTML = "BUY 🛒🐕"; d.innerHTML = "기계적 매수 구간 통과 중."; }
        else if(finalRet >= tSell) { t.innerHTML = "SELL 💰🐕"; d.innerHTML = "목표 익절 구간 통과 중."; }
        else { t.innerHTML = "HOLD 💤🐕"; d.innerHTML = "박스권 안의 안정 자산 복리 관망 구간."; }
    }
}
