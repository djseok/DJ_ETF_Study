// =========================================================
// 📈 퀀트 예측 엔진 (V12.0 모듈화 JSON 아키텍처 탑재)
// =========================================================

// 🔥 동진님의 비급(전문가용 매매 임계값 및 베타 설정)
const QUANT_STRATEGY = {
    "KODEX미국반도체": { buy: -2.5, sell: 3.0, beta: 1.5 },
    "RISE미국S&P500": { buy: -2.0, sell: 2.0, beta: 1.0 },
    "RISE미국나스닥100": { buy: -2.0, sell: 2.5, beta: 1.0 },
    "KODEX미국나스닥100데일리커버드콜OTM": { buy: -2.0, sell: 2.5, beta: 1.0 },
    "TIGER미국배당다우존스": { buy: -1.5, sell: 1.5, beta: 1.0 },
    "TIME글로벌AI인공지능액티브": { buy: -2.5, sell: 3.0, beta: 1.3 },
    "HANARO미국AI메모리반도체TOP4+": { buy: -2.5, sell: 3.0, beta: 1.5 }
};

function extractGlobalMacroVariables() {
    // macroData는 이제 Characteristic 시트의 데이터입니다. (0:구분, 1:티커, 2:종목명, 3:전일지수, 4:현재지수)
    macroData.forEach(row => {
        if (!row[0] || !row[2]) return;
        let name = String(row[2]).replace(/\s+/g, ''); // 원달러환율, 나스닥선물 등
        
        let prev = parseFloat(String(row[3]).replace(/,/g, '')) || 0;
        let live = parseFloat(String(row[4]).replace(/,/g, '')) || 0;
        let pct = prev > 0 ? ((live - prev) / prev * 100) : 0;
        let colorClass = pct >= 0 ? 'text-red-500' : 'text-blue-500';
        let sign = pct >= 0 ? '▲' : '▼';

        if(name.includes('나스닥')) {
            document.getElementById('macro-nasdaq').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toLocaleString()}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } else if(name.includes('원달러환율')) {
            globalFxDelta = prev > 0 ? (live - prev) / prev : 0;
            document.getElementById('macro-fx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">₩${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } else if(name.includes('VIX')) {
            globalVixValue = live;
            document.getElementById('macro-vix').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } else if(name.includes('TNX')) {
            document.getElementById('macro-tnx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}%</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        }
    });
}

function populateAssetDropdownSelector() {
    const selector = document.getElementById('assetSelector');
    // ETF_Quant_Signals 시트에서 '■'로 시작하는 줄을 찾아 ETF 목록 생성
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
    
    // 전략값 로드 (없으면 기본값 적용)
    let strategy = QUANT_STRATEGY[cleanTarget] || { buy: -2.0, sell: 2.0, beta: 1.0 };
    let tBuy = strategy.buy;
    let tSell = strategy.sell;
    let beta = strategy.beta;

    let comps = [];
    let isParsingTarget = false;

    // ETF_Quant_Signals 데이터를 순회하며 선택된 ETF의 종목들만 뽑아냄
    for (let i = 0; i < signalData.length; i++) {
        let r = signalData[i];
        let r0 = String(r[0] || "").trim();

        // 새로운 ETF 섹션 시작 확인
        if (r0.startsWith('■')) {
            let currentSectionName = r0.replace('■', '').replace(/\s+/g, '').toUpperCase();
            if (currentSectionName === cleanTarget) {
                isParsingTarget = true; // 타겟 발견! 아래부터 수집 시작
            } else {
                isParsingTarget = false; // 다른 ETF면 무시
            }
            continue;
        }

        // 현재 파싱 중일 때 '구성종목' 데이터 수집
        if (isParsingTarget && r0 === '구성종목') {
            comps.push({
                name: r[1],
                ticker: r[2],
                w: parseFloat(String(r[3]).replace(/,/g, '')) * 100 || 0, // 0.1814 -> 18.14%
                prev: parseFloat(String(r[4]).replace(/,/g, '')) || 0,
                live: parseFloat(String(r[5]).replace(/,/g, '')) || 0
            });
        }

        // 합계를 만나면 해당 ETF 수집 종료
        if (isParsingTarget && r0 === '합계') {
            break;
        }
    }

    // UI에 임계값 표시
    document.getElementById('threshBuyUI').innerText = `${tBuy}%`; 
    document.getElementById('threshSellUI').innerText = `+${tSell}%`;

    // 하위 종목 테이블 및 예상 변동률 렌더링
    let rawDelta = 0, tableHtml = "";
    let bPrev = 0, bLive = 0; // 이 예제에서는 본체(ETF) 가격 대신 가중합계를 사용하여 가격을 유추

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

    // 최종 복리 계산 엔진
    let vMult = (globalVixValue >= 25) ? 1.30 : (globalVixValue >= 20 ? 1.15 : 1.0);
    let finalRet = ((1 + rawDelta * beta) * (1 + globalFxDelta) - 1) * 100 * vMult;
    
    document.getElementById('mathPure').innerText = `${(rawDelta*100).toFixed(2)}%`;
    document.getElementById('mathBeta').innerText = `${beta}x`;
    document.getElementById('mathFx').innerText = `${(globalFxDelta*100).toFixed(2)}%`;
    document.getElementById('mathVix').innerText = `${vMult}x`;
    document.getElementById('predictedChange').innerText = `${finalRet>=0?'+':''}${finalRet.toFixed(2)}%`;
    document.getElementById('predictedChange').className = `text-4xl font-black mono ${finalRet>=0?'text-red-600':'text-blue-600'}`;

    // 매매 시그널 출력
    const c = document.getElementById('signalCard'), t = document.getElementById('signalTitle'), d = document.getElementById('signalDesc');
    c.className = "p-6 rounded-2xl shadow-md transition-all duration-300 relative overflow-hidden border border-slate-200 " + (finalRet <= tBuy ? "signal-buy-strong" : (finalRet >= tSell ? "signal-sell-strong" : "signal-hold"));
    
    if(finalRet <= tBuy) { t.innerHTML = "BUY 🛒🐕"; d.innerHTML = "기계적 매수 구간 통과 중."; }
    else if(finalRet >= tSell) { t.innerHTML = "SELL 💰🐕"; d.innerHTML = "목표 익절 구간 통과 중."; }
    else { t.innerHTML = "HOLD 💤🐕"; d.innerHTML = "박스권 안의 안정 자산 복리 관망 구간."; }
}
