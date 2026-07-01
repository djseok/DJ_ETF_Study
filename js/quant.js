// =========================================================
// 📈 퀀트 예측 엔진 (V13.1 Characteristic 시트 연동 완벽 패치)
// =========================================================

function extractGlobalMacroVariables() {
    // 🔥 중요: 지표 데이터는 masterData가 아니라 macroData 배열에 들어있습니다!
    if (!macroData || macroData.length === 0) return;

    macroData.forEach(row => {
        let gubun = String(row[0] || "").replace(/\s+/g, '');
        if (!gubun.includes('지표')) return; // 구분 열이 '지표'인 것만 필터링

        // 동진님의 Characteristic 시트 구조:
        // row[0]=구분, row[1]=티커/코드, row[2]=종목명, row[3]=전일지수, row[4]=현재지수
        let ticker = String(row[1] || "").replace(/\s+/g, '').toUpperCase();
        let name = String(row[2] || "").replace(/\s+/g, '').toUpperCase();
        let combinedText = ticker + name;
        
        let prevStr = String(row[3] || "").replace(/[^0-9.]/g, '');
        let liveStr = String(row[4] || "").replace(/[^0-9.]/g, '');
        
        let prev = parseFloat(prevStr) || 0;
        let live = parseFloat(liveStr) || 0;
        
        let pct = prev > 0 ? ((live - prev) / prev * 100) : 0;
        let colorClass = pct >= 0 ? 'text-red-500' : 'text-blue-500';
        let sign = pct >= 0 ? '▲' : '▼';

        // 1. 나스닥지수 (.IXIC 또는 NDX 또는 나스닥)
        if (combinedText.includes('나스닥') || combinedText.includes('IXIC') || combinedText.includes('NDX')) {
            // 선물과 본장이 같이 있다면 공식 본장 지수인 .IXIC 데이터를 위젯에 우선 고정
            if (combinedText.includes('선물') && document.getElementById('macro-nasdaq').innerHTML.includes('mono')) {
                return; 
            }
            document.getElementById('macro-nasdaq').innerHTML = `
                <div class="text-xl md:text-2xl font-extrabold mono text-slate-800">${live.toLocaleString()}</div>
                <div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>
            `;
        } 
        // 2. 환율 (원달러, USDKRW)
        else if (combinedText.includes('환율') || combinedText.includes('USDKRW')) {
            if (combinedText.includes('엔화') || combinedText.includes('JPY')) return; // 엔화는 통계에서 제외
            globalFxDelta = prev > 0 ? (live - prev) / prev : 0;
            document.getElementById('macro-fx').innerHTML = `
                <div class="text-xl md:text-2xl font-extrabold mono text-slate-800">₩${live.toLocaleString()}</div>
                <div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>
            `;
        } 
        // 3. VIX 공포지수
        else if (combinedText.includes('VIX')) {
            globalVixValue = live;
            document.getElementById('macro-vix').innerHTML = `
                <div class="text-xl md:text-2xl font-extrabold mono text-slate-800">${live.toFixed(2)}</div>
                <div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>
            `;
        } 
        // 4. 10년물 국채 금리 (TNX)
        else if (combinedText.includes('TNX') || combinedText.includes('국채')) {
            document.getElementById('macro-tnx').innerHTML = `
                <div class="text-xl md:text-2xl font-extrabold mono text-slate-800">${live.toFixed(2)}%</div>
                <div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>
            `;
        }
    });
}

function populateAssetDropdownSelector() {
    const selector = document.getElementById('assetSelector');
    const uniqueAssets = [];
    signalData.forEach(row => {
        if (row[0] && String(row[0]).startsWith('■')) {
            let assetName = String(row[0]).replace('■', '').trim();
            uniqueAssets.push(assetName);
        }
    });
    selector.innerHTML = uniqueAssets.map(asset => `<option value="${asset}">${asset}</option>`).join('');
}

function renderTargetAssetDashboard(target) {
    if(!target) return;
    
    let cleanTarget = target.replace(/\s+/g, '').toUpperCase();
    let tBuy = -2.0, tSell = 2.0, beta = 1.0;
    
    let bPrev = 0, bLive = 0;
    masterData.forEach(row => {
        if (!row[2]) return;
        let rowAssetName = String(row[2]).replace(/\s+/g, '').toUpperCase();
        
        if (rowAssetName === cleanTarget) {
            let p3 = parseFloat(String(row[3]).replace(/,/g, '')) || 0; 
            let p4 = parseFloat(String(row[4]).replace(/,/g, '')) || 0; 
            
            bPrev = p3;
            bLive = p4;
        }
    });
    
    let comps = [];
    let isParsingTarget = false;

    for (let i = 0; i < signalData.length; i++) {
        let r = signalData[i];
        if (!r || r.length === 0) continue;
        
        let r0 = String(r[0] || "").replace(/\s+/g, '').toUpperCase();

        if (r0.startsWith('■')) {
            let currentSectionName = r0.replace('■', '').replace(/\s+/g, '').toUpperCase();
            isParsingTarget = (currentSectionName === cleanTarget); 
            continue;
        }

        if (isParsingTarget) {
            if (r0 === '기준') {
                tBuy = parseFloat(String(r[2]).replace(/,/g, '')) || tBuy;
                tSell = parseFloat(String(r[3]).replace(/,/g, '')) || tSell;
            } 
            else if (r0 === '베타') {
                beta = parseFloat(String(r[2]).replace(/,/g, '')) || beta;
            } 
            else if (r0 === '구성종목') {
                let rawWeightStr = String(r[3]).replace(/,/g, '').trim();
                let parsedNum = parseFloat(rawWeightStr) || 0;
                let finalWeight = 0;
                
                if (rawWeightStr.includes('%')) {
                    finalWeight = parsedNum;
                } else if (parsedNum > 0 && parsedNum <= 1.0) {
                    finalWeight = parsedNum * 100;
                } else {
                    finalWeight = parsedNum;
                }

                comps.push({
                    name: r[1],
                    ticker: r[2],
                    w: finalWeight,
                    prev: parseFloat(String(r[4]).replace(/,/g, '')) || 0,
                    live: parseFloat(String(r[5]).replace(/,/g, '')) || 0
                });
            } 
            else if (r0 === '합계') {
                break; 
            }
        }
    }

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
                <div class="text-[10px] text-slate-400 font-semibold mb-0.5">전일 ${c.prev.toLocaleString()}</div>
                <div class="font-black ${d > 0 ? 'text-red-500' : (d < 0 ? 'text-blue-500' : 'text-slate-700')}">현재 ${live.toLocaleString()}</div>
            </td>
            <td class="px-6 py-4 text-right mono font-bold ${d>=0?'text-red-500':'text-blue-500'}">${d>=0?'+':''}${(d*100).toFixed(2)}%</td>
            <td class="px-6 py-4 text-right mono text-slate-400">${c.w.toFixed(2)}%</td>
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

    document.getElementById('predictedPrice').innerHTML = `
        <div class="text-slate-500 text-xs font-semibold space-y-0.5">
            <div>• 전일 종가: <span class="mono text-slate-800 font-bold">₩${bPrev > 0 ? Math.round(bPrev).toLocaleString() : '0'}</span></div>
            <div class="text-blue-600 font-bold text-sm mt-1">▶ 오늘 예상가: <span class="mono text-base font-black text-blue-700">₩${bPrev > 0 ? Math.round(expectedPrice).toLocaleString() : '0'}</span></div>
        </div>
    `;
    document.getElementById('currentLivePrice').innerHTML = `
        <div class="text-slate-500 text-xs font-semibold">
            <div>• 실시간 현재가: <span class="mono text-slate-800 font-bold">₩${bLive > 0 ? Math.round(bLive).toLocaleString() : '0'}</span></div>
        </div>
    `;

    const c = document.getElementById('signalCard'), t = document.getElementById('signalTitle'), d = document.getElementById('signalDesc');
    c.className = "p-6 rounded-2xl shadow-md transition-all duration-300 relative overflow-hidden border border-slate-200 " + (finalRet <= tBuy ? "signal-buy-strong" : (finalRet >= tSell ? "signal-sell-strong" : "signal-hold"));
    
    if(finalRet <= tBuy) { t.innerHTML = "BUY 🛒🐕"; d.innerHTML = "기계적 매수 구간 통과 중."; }
    else if(finalRet >= tSell) { t.innerHTML = "SELL 💰🐕"; d.innerHTML = "목표 익절 구간 통과 중."; }
    else { t.innerHTML = "HOLD 💤🐕"; d.innerHTML = "박스권 안의 안정 자산 복리 관망 구간."; }
}
