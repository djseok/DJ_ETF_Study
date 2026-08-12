// ---------------------------------------------------------
// 3. 멤버별 자급자족 현황판 (💎 TR & 🌟 J~L열 총 누적배당 전광판 연동)
// ---------------------------------------------------------
function renderMemberDashboard() {
    const memberSelect = document.getElementById('member-select');
    if(!memberSelect) return;
    const member = memberSelect.value;
    const container = document.getElementById('member-dashboard-cards');
    if (!container) return;

    container.className = "space-y-6 w-full";

    if (member === 'all') { 
        container.innerHTML = `
            <div class="p-8 bg-slate-50 rounded-2xl border border-slate-200 text-center text-slate-400 font-bold">
                <i class="fas fa-user-circle text-3xl mb-2 text-slate-300 block"></i>
                상단 드롭다운 메뉴에서 분석하고 싶은 멤버(D, S, J)를 선택해 주세요!
            </div>
        `; 
        return; 
    }

    // 🌟 [J, K, L열 스캔] 선택된 멤버의 종목별 & 전체 총 누적 배당금 연산
    let accumulatedDivs = {};
    let totalMemberAccDiv = 0; // 🌟 멤버가 여지껏 받은 전체 배당금 총합 (재투자 원금)

    for(let i = 1; i < dollarApp.portData.length; i++) {
        let r = dollarApp.portData[i];
        if (!r || r.length < 12) continue; // L열(인덱스 11) 존재 확인

        let logName = (r[9] || '').trim().replace(/님|포트폴리오/g, '').toUpperCase();
        let logTicker = (r[10] || '').trim().toUpperCase();
        let logAmount = cleanNumber(r[11]);

        if (logName === member.trim().toUpperCase() && logTicker !== '') {
            if (!accumulatedDivs[logTicker]) accumulatedDivs[logTicker] = 0;
            accumulatedDivs[logTicker] += logAmount;
            totalMemberAccDiv += logAmount; // 🌟 멤버 전체 배당금 자동 합산
        }
    }

    let weeklyIncome = 0;
    let weeklyExpense = 0;
    let stockCardsHtml = '';
    let currentMember = '';

    for(let i = 1; i < dollarApp.portData.length; i++) {
        let row = dollarApp.portData[i];
        if (!row || row.length < 2) continue;

        let rawMemberName = (row[0] || '').trim().replace(/님|포트폴리오/g, '').toUpperCase();
        if (rawMemberName !== '') {
            currentMember = rawMemberName;
        }

        if (currentMember !== member.trim().toUpperCase()) continue;

        const ticker = (row[1] || '').trim(); 
        const stockName = (row[2] || '').trim() || ticker; 
        const stockType = (row[3] || '').trim() || '거치'; 
        
        if(!ticker) continue; 

        const holdQty = cleanNumber(row[4]);      // E열 보유수량
        const dailyBuy = cleanNumber(row[5]);     // F열 일일모으기금액
        const price = getLivePrice(ticker);        // 현재주가
        
        // H열 평단가 및 수익률/차익 연산
        const avgPrice = cleanNumber(row[7]);     
        let principal = holdQty * avgPrice;                   
        let valuation = holdQty * price;                      
        let capitalGains = valuation - principal;             
        let returnRate = avgPrice > 0 ? ((price - avgPrice) / avgPrice) * 100 : 0; 
        
        // 배당금 연산
        let rawDiv = getDividend(ticker, stockName);
        let divExpected = (holdQty * rawDiv * 0.85); // 세후 15% 공제
        weeklyIncome += divExpected;
        
        const expenseExpected = (dailyBuy * 5); 
        weeklyExpense += expenseExpected; 

        const itemNet = divExpected - expenseExpected;

        // J~L열에서 추출한 종목별 누적 수령 배당금
        let accDivAmount = accumulatedDivs[ticker.toUpperCase()] || 0;

        // Total Return (TR) = 차익 + (입력된 실수령 배당이 있으면 적용, 없으면 주간 예상배당 적용)
        let appliedDivForTR = accDivAmount > 0 ? accDivAmount : divExpected;
        let trCash = capitalGains + appliedDivForTR;
        let trPct = principal > 0 ? (trCash / principal) * 100 : 0;

        if(holdQty > 0 || dailyBuy > 0) {
            let formattedQty = holdQty === 0 ? "0" : (Number.isInteger(holdQty) ? holdQty.toLocaleString() : holdQty.toFixed(4).replace(/\.?0+$/, ''));
            
            stockCardsHtml += `
                <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden">
                    <div>
                        <div class="flex items-start justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-base leading-snug truncate">${stockName}</h4>
                                <span class="text-xs text-slate-400 font-mono font-bold">${ticker}</span>
                            </div>
                            <span class="text-xs ${stockType.includes('거치') ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'} px-2.5 py-1 rounded-lg font-black shrink-0">
                                ${stockType}
                            </span>
                        </div>

                        <div class="grid grid-cols-2 gap-2 mb-3">
                            <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                <span class="text-[11px] font-bold text-slate-400 block mb-0.5">📦 보유 수량</span>
                                <span class="text-sm font-extrabold text-slate-800 font-mono">${formattedQty} <span class="text-xs font-normal">주</span></span>
                            </div>
                            <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                <span class="text-[11px] font-bold text-slate-400 block mb-0.5">💵 현재 주가</span>
                                <span class="text-sm font-extrabold text-slate-800 font-mono">$${price > 0 ? price.toFixed(2) : '-'}</span>
                            </div>
                        </div>

                        ${(holdQty > 0 && avgPrice > 0) ? `
                        <div class="bg-slate-50/80 p-3 rounded-xl border border-slate-200 mb-3 flex justify-between items-center">
                            <div>
                                <span class="text-[11px] font-bold text-slate-500 block mb-0.5">⚖️ 평단가</span>
                                <span class="text-sm font-extrabold text-slate-800 font-mono">$${avgPrice.toFixed(2)}</span>
                            </div>
                            <div class="text-right">
                                <span class="text-[11px] font-bold text-slate-500 block mb-0.5">📈 주가 차익 (수익률)</span>
                                <span class="text-sm font-black font-mono ${capitalGains >= 0 ? 'text-red-500' : 'text-blue-500'}">
                                    ${capitalGains >= 0 ? '+' : ''}$${capitalGains.toFixed(2)} 
                                    <span class="text-xs">(${capitalGains >= 0 ? '+' : ''}${returnRate.toFixed(2)}%)</span>
                                </span>
                            </div>
                        </div>
                        
                        ${accDivAmount > 0 ? `
                        <div class="bg-emerald-50/80 p-2.5 rounded-xl border border-emerald-200 mb-3 flex justify-between items-center shadow-sm">
                            <span class="text-[11px] font-extrabold text-emerald-800"><i class="fas fa-piggy-bank mr-1 text-emerald-500"></i>이 종목 누적 수령 배당금</span>
                            <span class="text-sm font-black font-mono text-emerald-600">+$${accDivAmount.toFixed(2)} <span class="text-[10px] text-slate-400">(₩${Math.round(accDivAmount * dollarApp.liveFxRate).toLocaleString()})</span></span>
                        </div>
                        ` : ''}

                        <div class="bg-indigo-50/80 p-3 rounded-xl border border-indigo-200 mb-3 flex flex-col gap-1 shadow-sm">
                            <div class="flex justify-between items-center">
                                <span class="text-[11px] font-extrabold text-indigo-800"><i class="fas fa-crown mr-1 text-yellow-500"></i>Total Return (TR)</span>
                                <span class="text-sm font-black font-mono ${trCash >= 0 ? 'text-red-600' : 'text-blue-600'}">
                                    ${trCash >= 0 ? '+' : ''}$${trCash.toFixed(2)} 
                                    <span class="text-xs">(${trCash >= 0 ? '+' : ''}${trPct.toFixed(2)}%)</span>
                                </span>
                            </div>
                            <div class="flex justify-between items-center text-[10px] text-indigo-600 font-bold border-t border-indigo-200/60 pt-1.5 mt-0.5">
                                <span>차익: ${capitalGains >= 0 ? '+' : ''}$${capitalGains.toFixed(2)}</span>
                                <span>배당: +$${appliedDivForTR.toFixed(2)} ${accDivAmount > 0 ? '(실수령)' : '(예상)'}</span>
                            </div>
                        </div>
                        ` : ''}

                        <div class="space-y-1.5 text-xs font-medium bg-slate-50/60 p-3 rounded-xl border border-slate-100 mb-3">
                            <div class="flex justify-between items-center">
                                <span class="text-slate-500 font-bold">📈 주간 예상 배당:</span>
                                <span class="font-extrabold text-emerald-600 font-mono">+$${divExpected.toFixed(2)} <span class="text-[10px] text-slate-400">(₩${Math.round(divExpected * dollarApp.liveFxRate).toLocaleString()})</span></span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-slate-500 font-bold">💸 주간 모으기 지출:</span>
                                <span class="font-extrabold text-rose-500 font-mono">-$${expenseExpected.toFixed(2)} <span class="text-[10px] text-slate-400">(₩${Math.round(expenseExpected * dollarApp.liveFxRate).toLocaleString()})</span></span>
                            </div>
                        </div>
                    </div>

                    <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold">
                        <span class="text-slate-400">종목 수지:</span>
                        ${itemNet >= 0 
                            ? `<span class="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 font-mono"><i class="fas fa-check-circle mr-1"></i>흑자 +$${itemNet.toFixed(2)}</span>` 
                            : `<span class="text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200 font-mono"><i class="fas fa-minus-circle mr-1"></i>적자 -$${Math.abs(itemNet).toFixed(2)}</span>`
                        }
                    </div>
                </div>
            `;
        }
    }

    const netCash = weeklyIncome - weeklyExpense;
    const ratio = weeklyExpense > 0 ? ((weeklyIncome / weeklyExpense) * 100).toFixed(1) : (weeklyIncome > 0 ? "100+" : "0.0");
    const isSurplus = netCash >= 0;

    container.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-gradient-to-br from-emerald-50 to-teal-100 p-5 rounded-2xl border border-emerald-200 shadow-sm flex flex-col justify-between">
                <div class="text-xs font-bold text-emerald-700 mb-1 flex items-center gap-1">
                    <i class="fas fa-arrow-trend-up"></i> 주간 예상 배당 수입 (세후)
                </div>
                <div class="text-2xl font-black text-emerald-800 font-mono">$${weeklyIncome.toFixed(2)}</div>
                <div class="text-xs text-emerald-600/80 font-bold mt-1 font-mono">≈ ₩${Math.round(weeklyIncome * dollarApp.liveFxRate).toLocaleString()} 원</div>
            </div>

            <div class="bg-gradient-to-br from-purple-50 to-indigo-100 p-5 rounded-2xl border border-purple-200 shadow-sm flex flex-col justify-between">
                <div class="text-xs font-bold text-purple-700 mb-1 flex items-center gap-1">
                    <i class="fas fa-vault text-purple-600"></i> ${member}님 총 누적 실수령 배당금
                </div>
                <div class="text-2xl font-black text-purple-900 font-mono">$${totalMemberAccDiv.toFixed(2)}</div>
                <div class="text-xs text-purple-700/80 font-bold mt-1 font-mono">≈ ₩${Math.round(totalMemberAccDiv * dollarApp.liveFxRate).toLocaleString()} 원 (재투자 총액)</div>
            </div>

            <div class="bg-gradient-to-br from-rose-50 to-red-100 p-5 rounded-2xl border border-rose-200 shadow-sm flex flex-col justify-between">
                <div class="text-xs font-bold text-rose-700 mb-1 flex items-center gap-1">
                    <i class="fas fa-coins"></i> 주간 모으기 지출 (5일 기준)
                </div>
                <div class="text-2xl font-black text-rose-800 font-mono">$${weeklyExpense.toFixed(2)}</div>
                <div class="text-xs text-rose-600/80 font-bold mt-1 font-mono">≈ ₩${Math.round(weeklyExpense * dollarApp.liveFxRate).toLocaleString()} 원</div>
            </div>

            <div class="bg-gradient-to-br ${isSurplus ? 'from-indigo-50 to-blue-100 border-indigo-200' : 'from-amber-50 to-orange-100 border-amber-200'} p-5 rounded-2xl border shadow-sm flex flex-col justify-between">
                <div class="text-xs font-bold ${isSurplus ? 'text-indigo-700' : 'text-amber-700'} mb-1 flex items-center gap-1">
                    ${isSurplus ? '<i class="fas fa-fire text-blue-600"></i> 자급자족 성공!' : '<i class="fas fa-triangle-exclamation text-amber-600"></i> 보충 필요'}
                </div>
                <div class="text-2xl font-black ${isSurplus ? 'text-indigo-900' : 'text-amber-900'} font-mono flex items-end justify-between">
                    <span>${isSurplus ? '+' : '-'}$${Math.abs(netCash).toFixed(2)}</span>
                    <span class="text-xs bg-white/80 text-slate-700 px-2 py-0.5 rounded-lg font-extrabold border border-slate-200">충당률 ${ratio}%</span>
                </div>
                <div class="text-xs ${isSurplus ? 'text-indigo-700' : 'text-amber-700'} font-bold mt-1 font-mono">
                    ${isSurplus ? '배당금으로 연속 재투자 가동 🚀' : `주간 $${Math.abs(netCash).toFixed(2)} 추가 필요`}
                </div>
            </div>
        </div>

        <div class="space-y-4 pt-2">
            <div class="flex items-center justify-between px-1">
                <h3 class="font-extrabold text-slate-800 text-base flex items-center gap-2">
                    <i class="fas fa-cubes text-yellow-500"></i> ${member}님의 종목별 $1 파이프라인 카드
                </h3>
                <span class="text-xs font-bold text-slate-400">실시간 연산 가동 중</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${stockCardsHtml || '<div class="col-span-full p-8 bg-white rounded-2xl border border-slate-200 text-center text-slate-400 font-bold">보유 중이거나 모으는 종목 데이터가 없습니다.</div>'}
            </div>
        </div>
    `;
}
