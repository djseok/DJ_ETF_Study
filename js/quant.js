// =========================================================
// 📈 퀀트 예측 엔진 (V12.0 실시간 검색 및 선물 10% 연동 장착)
// =========================================================

let currentMainFilter = 'all';
let currentSubFilter = 'all';
let currentSearchText = '';
let globalFuturesDelta = 0; // 🌟 나스닥 선물: 미국장 마감(뉴욕 16:00) 이후 변동률
let globalFutures = { NQ: 0, ES: 0, YM: 0 }; // 나스닥 · S&P · 다우 선물 (마감 이후 변동률)

function extractGlobalMacroVariables() {
    if (!macroData || macroData.length === 0) return;

    // 양쪽 시트(macroData, masterData)를 모두 검색하도록 범위 확장
    let searchPool = [];
    if (typeof macroData !== 'undefined') searchPool = searchPool.concat(macroData);
    if (typeof masterData !== 'undefined') searchPool = searchPool.concat(masterData);

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

        // 🌟 선물 (Characteristic: 전일지수 = 미국장 마감 시점 가격, 현재지수 = 지금) → 마감 이후 변동률
        if (ticker === 'S&P선물지수' || ticker === '다우선물지수') {
            globalFutures[ticker === 'S&P선물지수' ? 'ES' : 'YM'] = prev > 0 ? (live - prev) / prev : 0;
        }
        else if (ticker === '나스닥선물지수' || name === '크롤링') {
            globalFuturesDelta = prev > 0 ? (live - prev) / prev : 0;
            globalFutures.NQ = globalFuturesDelta;
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
            if (combinedText.includes('엔화') || combinedText.includes('JPY')) return;
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

function populateAssetDropdownSelector() {
    const selector = document.getElementById('assetSelector');
    if(!selector) return;

    const uniqueAssets = [];
    if(signalData && signalData.length > 0) {
        signalData.forEach(row => {
            if (row[0] && String(row[0]).startsWith('■')) {
                let assetName = String(row[0]).replace('■', '').trim();
                uniqueAssets.push(assetName);
            }
        });
    }

    let categoryMap = {};
    if(masterData && masterData.length > 0) {
        masterData.forEach(row => {
            let name = String(row[2] || "").replace(/\s+/g, '').toUpperCase();
            if(name) {
                categoryMap[name] = {
                    main: String(row[7] || "").trim(),
                    sub: String(row[8] || "").trim() 
                };
            }
        });
    }

    const filteredAssets = uniqueAssets.filter(asset => {
        let cleanAsset = asset.replace(/\s+/g, '').toUpperCase();
        let cat = categoryMap[cleanAsset] || {main: "", sub: ""};
        
        let matchText = currentSearchText === "" || asset.toLowerCase().includes(currentSearchText);
        let matchMain = currentMainFilter === 'all' || cat.main === currentMainFilter;
        let matchSub = currentSubFilter === 'all' || cat.sub === currentSubFilter;

        return matchText && matchMain && matchSub;
    });

    if (filteredAssets.length === 0) {
        selector.innerHTML = `<option value="">검색 결과가 없습니다</option>`;
    } else {
        selector.innerHTML = filteredAssets.map(asset => `<option value="${asset}">${asset}</option>`).join('');
    }

    if (filteredAssets.length > 0 && typeof renderTargetAssetDashboard === 'function') {
        renderTargetAssetDashboard(selector.value);
    }
}

function initFilters() {
    const searchInput = document.getElementById('assetSearchInput');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchText = e.target.value.toLowerCase().trim();
            populateAssetDropdownSelector();
        });
    }

    document.querySelectorAll('.filter-main-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-main-btn').forEach(b => {
                b.classList.remove('bg-slate-800', 'text-white');
                b.classList.add('bg-slate-100', 'text-slate-600');
            });
            e.currentTarget.classList.remove('bg-slate-100', 'text-slate-600');
            e.currentTarget.classList.add('bg-slate-800', 'text-white');
            
            currentMainFilter = e.currentTarget.getAttribute('data-filter');
            populateAssetDropdownSelector();
        });
    });

    document.querySelectorAll('.filter-sub-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-sub-btn').forEach(b => {
                b.classList.remove('bg-slate-800', 'text-white');
                b.classList.add('bg-slate-100', 'text-slate-600');
            });
            e.currentTarget.classList.remove('bg-slate-100', 'text-slate-600');
            e.currentTarget.classList.add('bg-slate-800', 'text-white');
            
            currentSubFilter = e.currentTarget.getAttribute('data-filter');
            populateAssetDropdownSelector();
        });
    });
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
            bPrev = parseFloat(String(row[3]).replace(/,/g, '')) || 0; 
            bLive = parseFloat(String(row[4]).replace(/,/g, '')) || 0; 
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

    if(document.getElementById('threshBuyUI')) document.getElementById('threshBuyUI').innerText = `${tBuy}%`; 
    if(document.getElementById('threshSellUI')) document.getElementById('threshSellUI').innerText = `+${tSell}%`;

    let rawDelta = 0, tableHtml = "";
    // 비중 구분: 현금(티커 없음) · 가격 없음(계산 제외) · 국내 · 미국 · 그 밖의 해외(일본·중국 등)
    const isDomestic = (t) => /^(KRX:|KOSDAQ:)?(\d[0-9A-Z]{5}|\d{1,5})$/i.test(String(t || '').trim()); // 숫자로 저장돼 앞자리 0이 빠진 코드(88980)도 국내
    const isUs = (t) => { t = String(t || '').trim(); return t !== '' && !isDomestic(t) && !/^(TYO|TPE|HKG|SHE|SHA):|\.(T|TW|HK|SZ|SS)$/i.test(t); };
    let wTotal = 0, wMissing = 0, wForeign = 0, wUs = 0, missingNames = [];
    comps.forEach(c => {
        const hasTicker = String(c.ticker || '').trim() !== '';
        wTotal += c.w;
        if (hasTicker && !(c.prev > 0)) { wMissing += c.w; missingNames.push(c.name); return; }
        if (hasTicker && !isDomestic(c.ticker)) wForeign += c.w;
        if (isUs(c.ticker)) wUs += c.w;
    });
    // 가격 없는 종목은 빼고 나머지 비중으로 다시 맞춤 (예: 합계 100% 중 3%가 가격 없음 → 97% 기준으로 환산)
    const priced = wTotal - wMissing;
    const scale = priced > 0 ? 100 / priced : 1;
    const foreignShare = priced > 0 ? Math.min(1, wForeign / priced) : 1;
    const usShare = priced > 0 ? Math.min(1, wUs / priced) : 0;
    
    comps.forEach(c => {
        let live = (isNaN(c.live) || c.live === 0) ? c.prev : c.live;
        let d = c.prev > 0 ? (live - c.prev) / c.prev : 0;
        let cont = d * (c.w / 100) * scale;
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

    // 🌟 예측 공식 (개장 전 카톡 알림 premarket_alert.gs 와 동일)
    //   예상 = (1 + 베타 × 구성종목 변동) × (1 + 베타 × 선물 마감후 변동 × 미국 비중) × (1 + 환율 변동 × 해외 비중) − 1
    //   선물: 이름에 S&P → S&P 선물, 다우 → 다우 선물, 나머지는 나스닥 선물 / VIX 는 곱하지 않고 경고 배지로만 표시
    const futKey = futKeyFor(target);
    const futDelta = globalFutures[futKey] || 0;
    const futLabel = { NQ: '나스닥', ES: 'S&P', YM: '다우' }[futKey];
    let baseRet = predictRet(rawDelta, beta, 0, usShare, globalFxDelta, foreignShare) * 100;
    let finalRet = predictRet(rawDelta, beta, futDelta, usShare, globalFxDelta, foreignShare) * 100;
    const vixWarn = globalVixValue >= 20;
    
    // UI 업데이트
    if(document.getElementById('mathPure')) document.getElementById('mathPure').innerText = `${(rawDelta*100).toFixed(2)}%`;
    if(document.getElementById('mathBeta')) document.getElementById('mathBeta').innerText = `${beta}x`;
    if(document.getElementById('mathFx')) document.getElementById('mathFx').innerText = `${(globalFxDelta*100).toFixed(2)}% × 해외 ${(foreignShare*100).toFixed(0)}%`;
    const coverEl = document.getElementById('mathCoverage');
    if (coverEl) {
        coverEl.innerHTML = wMissing > 0
            ? `⚠️ 가격 없는 ${missingNames.length}개 종목(비중 ${wMissing.toFixed(1)}%)을 빼고 나머지 비중으로 환산: ${missingNames.slice(0, 5).join(', ')}${missingNames.length > 5 ? ' 외' : ''}`
            : `구성종목 ${comps.length}개 · 비중 합계 ${wTotal.toFixed(1)}% · 해외 비중 ${(foreignShare*100).toFixed(0)}%`;
    }
    if(document.getElementById('mathVix')) {
        const el = document.getElementById('mathVix');
        el.innerText = vixWarn ? `${Number(globalVixValue).toFixed(1)} ⚠️ 변동성 경계` : `${Number(globalVixValue).toFixed(1)}`;
    }
    
    if(document.getElementById('mathBase')) document.getElementById('mathBase').innerText = `${baseRet.toFixed(2)}%`;
    if(document.getElementById('mathFutures')) document.getElementById('mathFutures').innerText = `${futLabel} ${(futDelta*100).toFixed(2)}%`;
    if(document.getElementById('mathFutMix')) document.getElementById('mathFutMix').innerText = `β × 미국 ${(usShare*100).toFixed(0)}%`;

    if(document.getElementById('predictedChange')) {
        document.getElementById('predictedChange').innerText = `${finalRet>=0?'+':''}${finalRet.toFixed(2)}%`;
        document.getElementById('predictedChange').className = `text-4xl font-black mono ${finalRet>=0?'text-red-600':'text-blue-600'}`;
    }

    let expectedPrice = bPrev * (1 + finalRet / 100);
    
    if(document.getElementById('predictedPrice')) {
        document.getElementById('predictedPrice').innerHTML = `
            <div class="text-slate-500 text-xs font-semibold space-y-0.5">
                <div>• 전일 종가: <span class="mono text-slate-800 font-bold">₩${bPrev > 0 ? Math.round(bPrev).toLocaleString() : '0'}</span></div>
                <div class="text-blue-600 font-bold text-sm mt-1">▶ 오늘 예상가: <span class="mono text-base font-black text-blue-700">₩${bPrev > 0 ? Math.round(expectedPrice).toLocaleString() : '0'}</span></div>
            </div>`;
    }
        
    if(document.getElementById('currentLivePrice')) {
        document.getElementById('currentLivePrice').innerHTML = `
            <div class="text-slate-500 text-xs font-semibold">
                <div>• 실시간 현재가: <span class="mono text-slate-800 font-bold">₩${bLive > 0 ? Math.round(bLive).toLocaleString() : '0'}</span></div>
            </div>`;
    }

    const c = document.getElementById('signalCard'), t = document.getElementById('signalTitle'), d = document.getElementById('signalDesc');
    if(c && t && d) {
        c.className = "p-6 rounded-2xl shadow-md transition-all duration-300 relative overflow-hidden border border-slate-200 " + (finalRet <= tBuy ? "signal-buy-strong" : (finalRet >= tSell ? "signal-sell-strong" : "signal-hold"));
        
        if(finalRet <= tBuy) { t.innerHTML = "BUY 🛒🐕"; d.innerHTML = "기계적 매수 구간 통과 중."; }
        else if(finalRet >= tSell) { t.innerHTML = "SELL 💰🐕"; d.innerHTML = "목표 익절 구간 통과 중."; }
        else { t.innerHTML = "HOLD 💤🐕"; d.innerHTML = "박스권 안의 안정 자산 복리 관망 구간."; }
    }
}
