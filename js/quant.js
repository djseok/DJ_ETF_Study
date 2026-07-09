// =========================================================
// 📈 퀀트 예측 엔진 (V12.0 실시간 검색 및 선물 10% 연동 장착)
// =========================================================

let currentMainFilter = 'all';
let currentSubFilter = 'all';
let currentSearchText = '';
let globalFuturesDelta = 0; // 🌟 선물 변동률 저장 변수

function extractGlobalMacroVariables() {
    if (!macroData || macroData.length === 0) return;

    // 양쪽 시트(macroData, masterData)를 모두 검색하도록 범위 확장
    let searchPool = macroData.concat(masterData || []);

    searchPool.forEach(row => {
        let gubun = String(row[0] || "").replace(/\s+/g, '');
        if (!gubun.includes('지표')) return;

        let ticker = String(row[1] || "").replace(/\s+/g, '');
        let name = String(row[2] || "").replace(/\s+/g, '');
        let combinedText = (ticker + name).toUpperCase();
        
        let prev = parseFloat(String(row[3] || "").replace(/[^0-9.-]/g, '')) || 0;
        let live = parseFloat(String(row[4] || "").replace(/[^0-9.-]/g, '')) || 0;
        
        let pct = prev > 0 ? ((live - prev) / prev * 100) : 0;
        let colorClass = pct >= 0 ? 'text-red-500' : 'text-blue-500';
        let sign = pct >= 0 ? '▲' : '▼';

        // 🌟 선물 데이터 캐치 (시트 '나스닥선물지수' 또는 '크롤링' 행)
        if (ticker === '나스닥선물지수' || name === '크롤링' || combinedText.includes('크롤링')) {
            globalFuturesDelta = prev > 0 ? (live - prev) / prev : 0;
            if(document.getElementById('macro-futures')) {
                document.getElementById('macro-futures').innerHTML = `
                    <div class="text-xl md:text-2xl font-extrabold mono text-slate-800">${live.toLocaleString()}</div>
                    <div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>
                `;
            }
        } 
        // 🌟 본장 데이터 
        else if (ticker === '나스닥' || combinedText.includes('IXIC') || combinedText.includes('NDX')) {
            if(document.getElementById('macro-nasdaq')) {
                document.getElementById('macro-nasdaq').innerHTML = `
                    <div class="text-xl md:text-2xl font-extrabold mono text-slate-800">${live.toLocaleString()}</div>
                    <div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>
                `;
            }
        }
        else if (combinedText.includes('환율') || combinedText.includes('USDKRW')) {
            globalFxDelta = prev > 0 ? (live - prev) / prev : 0;
            if(document.getElementById('macro-fx')) document.getElementById('macro-fx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono text-slate-800">₩${live.toLocaleString()}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        }
        else if (combinedText.includes('VIX')) {
            globalVixValue = live;
            if(document.getElementById('macro-vix')) document.getElementById('macro-vix').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono text-slate-800">${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        }
        else if (combinedText.includes('TNX') || combinedText.includes('국채')) {
            if(document.getElementById('macro-tnx')) document.getElementById('macro-tnx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono text-slate-800">${live.toFixed(2)}%</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        }
    });
}

// ... (populateAssetDropdownSelector, initFilters 함수는 기존과 동일하게 유지) ...

function renderTargetAssetDashboard(target) {
    if(!target) return;
    
    let cleanTarget = target.replace(/\s+/g, '').toUpperCase();
    let tBuy = -2.0, tSell = 2.0, beta = 1.0;
    
    let bPrev = 0, bLive = 0;
    masterData.forEach(row => {
        if (!row[2]) return;
        let rowAssetName = String(row[2]).replace(/\s+/g, '').toUpperCase();
        if (rowAssetName === cleanTarget) {
            bPrev = parseFloat(String(row[3]).replace(/,/g, '')) || 0; 
            bLive = parseFloat(String(row[4]).replace(/,/g, '')) || 0; 
        }
    });
    
    // ... (기존 comps 계산 및 rawDelta 도출 로직 그대로 유지) ...
    // ... (중간 tableHtml 생성 루프 유지) ...

    let vMult = (globalVixValue >= 25) ? 1.30 : (globalVixValue >= 20 ? 1.15 : 1.0);
    
    // 🌟 1. 기존 예측 엔진 (본장 100% 기준)
    let baseRet = ((1 + rawDelta * beta) * (1 + globalFxDelta) - 1) * 100 * vMult;
    
    // 🌟 2. 나스닥 선물 믹스 적용 (최종 예측 = 본장 90% + 선물 10%)
    let finalRet = (baseRet * 0.9) + ((globalFuturesDelta * 100) * 0.1);
    
    // UI 업데이트
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
        </div>`;
        
    // ... (기존 signalCard 클래스 제어 로직 유지) ...
}
