// =========================================================
// 🌐 $1 복리 프로젝트 전용 엔진 (💎 TR & J/K/L 누적배당 연동 완벽 패치)
// =========================================================

const DOLLAR_TIMESTAMP = typeof timestamp !== 'undefined' ? timestamp : new Date().getTime();
const DOLLAR_MASTER_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv";
const DOLLAR_MASTER_URL = DOLLAR_MASTER_BASE + "&t=" + DOLLAR_TIMESTAMP;
const DOLLAR_PORT_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv";
const DOLLAR_PORT_URL = DOLLAR_PORT_BASE + "&t=" + DOLLAR_TIMESTAMP;

const dollarApp = {
    masterData: [],
    portData: [],
    sortKey: 'efficiency_krw',
    sortAsc: false,
    liveFxRate: 1420,
    selectedLumpTickers: []
};

// ---------------------------------------------------------
// 1. 유틸리티 및 파서 함수 
// ---------------------------------------------------------
function switchDollarSubTab(tabName) {
    const btnScan = document.getElementById('btnDollarScanner');
    const btnMem = document.getElementById('btnDollarMember');
    const btnLump = document.getElementById('btnDollarLump');
    
    const viewScan = document.getElementById('tab-dollar-scanner');
    const viewMem = document.getElementById('tab-dollar-member');
    const viewLump = document.getElementById('tab-dollar-lump');

    if (!btnScan || !btnMem || !viewScan || !viewMem || !viewLump) return;

    [btnScan, btnMem, btnLump].forEach(btn => {
        if(btn) btn.className = "px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-200 shadow-sm transition-all";
    });
    
    [viewScan, viewMem, viewLump].forEach(view => {
        if(view) { view.classList.remove('block'); view.classList.add('hidden'); }
    });

    if (tabName === 'scanner') {
        if(btnScan) btnScan.className = "px-4 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm shadow-sm transition-all";
        if(viewScan) { viewScan.classList.remove('hidden'); viewScan.classList.add('block'); }
    } else if (tabName === 'member') {
        if(btnMem) btnMem.className = "px-4 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm shadow-sm transition-all";
        if(viewMem) { viewMem.classList.remove('hidden'); viewMem.classList.add('block'); }
    } else if (tabName === 'lump') {
        if(btnLump) btnLump.className = "px-4 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm shadow-sm transition-all";
        if(viewLump) { viewLump.classList.remove('hidden'); viewLump.classList.add('block'); }
        if(typeof initLumpSimulatorView === 'function') initLumpSimulatorView();
    }
}

function parseSimpleArrayCSV(text) {
    if(!text) return [];
    text = text.replace(/^\uFEFF/, '');
    const lines = text.split('\n').filter(l => l.trim() !== '');
    return lines.map(line => {
        const values = line.split(',');
        return values.map(val => {
            val = val ? val.trim() : '';
            if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
            return val;
        });
    });
}

function cleanNumber(val) {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) || !isFinite(val) ? 0 : val;
    let str = String(val).replace(/,/g, '').replace(/\$/g, '').replace(/₩/g, '').replace(/원/g, '').replace(/주/g, '').replace(/%/g, '').trim();
    let num = parseFloat(str);
    return isNaN(num) || !isFinite(num) ? 0 : num;
}

function getLivePrice(ticker) {
    if (!ticker) return 0;
    const t = ticker.toUpperCase().trim();
    
    for (let i = 1; i < dollarApp.portData.length; i++) {
        let pTicker = (dollarApp.portData[i][1] || '').toUpperCase().trim();
        if (pTicker === t) {
            let price = cleanNumber(dollarApp.portData[i][6]);
            if (price > 0) return price;
        }
    }
    for (let i = 1; i < dollarApp.masterData.length; i++) {
        let mTicker = (dollarApp.masterData[i][1] || '').toUpperCase().trim();
        if (mTicker === t) {
            let price = cleanNumber(dollarApp.masterData[i][3]);
            if (price > 0) return price;
        }
    }
    return 0;
}

function getDividend(ticker, stockName) {
    const t = ticker ? ticker.toUpperCase().trim() : '';
    const n = stockName ? stockName.toUpperCase().trim() : '';

    for (let i = 1; i < dollarApp.masterData.length; i++) {
        let mTicker = (dollarApp.masterData[i][1] || '').toUpperCase().trim();
        let mName = (dollarApp.masterData[i][2] || '').toUpperCase().trim();

        if ((t && mTicker === t) || (n && (mName === n || mName.includes(n)))) {
            let div = cleanNumber(dollarApp.masterData[i][4]);
            if (div > 0) return div;
        }
    }
    return 0;
}

async function loadDollarData() {
    if (dollarApp.masterData.length > 0) return;
    try {
        const [masterRes, portRes] = await Promise.all([
            fetch(DOLLAR_MASTER_URL), fetch(DOLLAR_PORT_URL)
        ]);
        
        dollarApp.masterData = parseSimpleArrayCSV(await masterRes.text());
        dollarApp.portData = parseSimpleArrayCSV(await portRes.text());

        if (dollarApp.masterData.length > 0) {
            let candidate0 = cleanNumber(dollarApp.masterData[0][0]);
            let candidate1 = dollarApp.masterData[1] ? cleanNumber(dollarApp.masterData[1][0]) : 0;
            
            if (candidate0 > 1000 && candidate0 < 2500) dollarApp.liveFxRate = candidate0;
            else if (candidate1 > 1000 && candidate1 < 2500) dollarApp.liveFxRate = candidate1;
        }
        
        renderDollarTable();
        populateDollarMemberSelect();
    } catch (error) {
        console.error("$1 데이터 로딩 에러:", error);
    }
}

// ---------------------------------------------------------
// 2. 1달러 생산성 스캐너 렌더링
// ---------------------------------------------------------
function renderDollarTable() {
    const tbody = document.getElementById('dollar-table-body');
    if(!tbody || dollarApp.masterData.length <= 1) return;
    
    const isLimitFilter = document.getElementById('filter-limit') ? document.getElementById('filter-limit').checked : false;
    const isDecimalFilter = document.getElementById('filter-decimal') ? document.getElementById('filter-decimal').checked : false;

    let tableData = [];
    for (let i = 1; i < dollarApp.masterData.length; i++) {
        const row = dollarApp.masterData[i];
        if (!row || row.length < 5) continue;

        const ticker = (row[1] || '').trim();
        const name = (row[2] || '').trim();
        const price = getLivePrice(ticker); 
        const rawDiv = cleanNumber(row[4]); 
        const limit = row[11] || 'X';
        const decimal = row[12] || 'O';
        
        if (!ticker || price <= 0) continue;

        const afterTaxDiv = rawDiv * 0.85; 
        const efficiency_usd = price > 0 ? (afterTaxDiv / price) : 0;
        let sheetH_krw = row[7] ? cleanNumber(row[7]) : 0;
        const efficiency_krw = sheetH_krw > 0 ? sheetH_krw : (efficiency_usd * dollarApp.liveFxRate);

        tableData.push({ 
            displayName: `${ticker} <span class="text-xs text-slate-400 ml-1">(${name})</span>`, 
            price: price, 
            efficiency: efficiency_usd, 
            efficiency_krw: efficiency_krw,
            limit: limit, 
            decimal: decimal 
        });
    }

    if (isLimitFilter) tableData = tableData.filter(d => d.limit === 'X');
    if (isDecimalFilter) tableData = tableData.filter(d => d.decimal === 'O');

    tableData.sort((a, b) => {
        let valA = a[dollarApp.sortKey];
        let valB = b[dollarApp.sortKey];
        return dollarApp.sortAsc ? valA - valB : valB - valA;
    });

    tbody.innerHTML = '';
    tableData.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors border-b border-slate-50";
        let rankBadge = idx === 0 ? '<i class="fas fa-crown text-yellow-500 mr-1"></i>' : (idx === 1 ? '<i class="fas fa-medal text-slate-400 mr-1"></i>' : (idx === 2 ? '<i class="fas fa-medal text-orange-400 mr-1"></i>' : ''));

        tr.innerHTML = `
            <td class="px-4 py-3 font-bold text-slate-800">${rankBadge}${item.displayName}</td>
            <td class="px-4 py-3 text-right font-mono text-slate-600">$${item.price.toFixed(2)}</td>
            <td class="px-4 py-3 text-right font-mono font-bold text-slate-700 bg-slate-50/50">$${item.efficiency.toFixed(5)}</td>
            <td class="px-4 py-3 text-right font-mono font-black text-blue-600 bg-blue-50/30">${item.efficiency_krw.toFixed(1)}원 <span class="text-[10px] text-slate-400 font-normal">(H열)</span></td>
            <td class="px-4 py-3 text-center text-xs font-bold ${item.limit === 'X' ? 'text-green-600' : 'text-red-500'}">${item.limit}</td>
            <td class="px-4 py-3 text-center text-xs font-bold ${item.decimal === 'O' ? 'text-blue-600' : 'text-slate-400'}">${item.decimal}</td>
        `;
        tbody.appendChild(tr);
    });
}

function sortDollarTable(key) {
    if (dollarApp.sortKey === key) { dollarApp.sortAsc = !dollarApp.sortAsc; } 
    else { dollarApp.sortKey = key; dollarApp.sortAsc = false; }
    renderDollarTable();
}

// ---------------------------------------------------------
// 3. 멤버별 자급자족 현황판 (💎 TR & 🌟 J~L열 총 누적배당 전광판 연동)
// ---------------------------------------------------------
function populateDollarMemberSelect() {
    if (!dollarApp.portData || dollarApp.portData.length <= 1) return;
    const select = document.getElementById('member-select');
    const lumpSelect = document.getElementById('lump-member-select');
    
    let members = [];
    let currentMem = '';
    for(let i=1; i<dollarApp.portData.length; i++) {
        let name = (dollarApp.portData[i][0] || '').trim();
        if(name !== '') currentMem = name;
        if(currentMem && !members.includes(currentMem)) members.push(currentMem);
    }
    
    if(select) {
        select.innerHTML = '<option value="all">분석할 멤버 선택</option>';
        members.forEach(m => select.innerHTML += `<option value="${m}">${m} 님</option>`);
    }
    
    if(lumpSelect) {
        lumpSelect.innerHTML = '<option value="all">멤버 선택 안 함 (독립 연산 전용)</option>';
        members.forEach(m => lumpSelect.innerHTML += `<option value="${m}">${m} 님 (기존 계좌 결합 연산)</option>`);
    }
}

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

// ---------------------------------------------------------
// 4. 거치 시뮬레이션 전용 연산 및 UI 엔진
// ---------------------------------------------------------
function initLumpSimulatorView() {
    const rateText = document.getElementById('lump-fx-rate-text');
    if(rateText) rateText.textContent = `₩${dollarApp.liveFxRate.toLocaleString()}`;
    
    syncLumpAmount('usd');
    renderLumpStockSelector();
}

function syncLumpAmount(changedSource) {
    const usdInput = document.getElementById('lump-amount-usd');
    const krwInput = document.getElementById('lump-amount-krw');
    if (!usdInput || !krwInput) return;

    const fx = dollarApp.liveFxRate || 1420;

    if (changedSource === 'usd') {
        const usdVal = cleanNumber(usdInput.value);
        krwInput.value = Math.round(usdVal * fx);
    } else {
        const krwVal = cleanNumber(krwInput.value);
        usdInput.value = (krwVal / fx).toFixed(2);
    }
    renderLumpSimulator();
}

function renderLumpStockSelector() {
    const grid = document.getElementById('lump-stock-checkbox-grid');
    if(!grid || dollarApp.masterData.length <= 1) return;

    const isLimitFilter = document.getElementById('lump-filter-limit') ? document.getElementById('lump-filter-limit').checked : false;
    const isDecimalFilter = document.getElementById('lump-filter-decimal') ? document.getElementById('lump-filter-decimal').checked : false;

    let availableStocks = [];
    for(let i=1; i<dollarApp.masterData.length; i++) {
        let row = dollarApp.masterData[i];
        if(!row || row.length < 5) continue;

        let ticker = (row[1] || '').trim();
        let name = (row[2] || '').trim();
        let price = getLivePrice(ticker); 
        let limit = row[11] || 'X';
        let decimal = row[12] || 'O';

        if(!ticker || price <= 0) continue;
        if (isLimitFilter && limit !== 'X') continue;
        if (isDecimalFilter && decimal !== 'O') continue;

        availableStocks.push({ ticker, name, price, limit, decimal });
    }

    grid.innerHTML = '';
    availableStocks.forEach(s => {
        const isChecked = dollarApp.selectedLumpTickers.includes(s.ticker);
        const div = document.createElement('div');
        div.className = `flex items-center gap-2 p-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${isChecked ? 'bg-yellow-50 border-yellow-400 text-yellow-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`;
        div.onclick = (e) => {
            if(e.target.tagName !== 'INPUT') {
                const cb = div.querySelector('input');
                if(cb) { cb.checked = !cb.checked; toggleLumpStockSelection(s.ticker, cb.checked); }
            }
        };

        div.innerHTML = `
            <input type="checkbox" value="${s.ticker}" ${isChecked ? 'checked' : ''} onchange="toggleLumpStockSelection('${s.ticker}', this.checked)" class="w-3.5 h-3.5 accent-yellow-500 cursor-pointer">
            <div class="truncate">
                <span class="font-black text-slate-800">${s.ticker}</span>
                <span class="text-[10px] text-slate-400 block truncate">${s.name}</span>
            </div>
        `;
        grid.appendChild(div);
    });

    updateLumpCountText();
    renderLumpSimulator();
}

function toggleLumpStockSelection(ticker, isChecked) {
    if (isChecked) {
        if (dollarApp.selectedLumpTickers.length >= 4) {
            alert("종목 비교는 최대 4개까지만 가능합니다!");
            renderLumpStockSelector();
            return;
        }
        if(!dollarApp.selectedLumpTickers.includes(ticker)) dollarApp.selectedLumpTickers.push(ticker);
    } else {
        dollarApp.selectedLumpTickers = dollarApp.selectedLumpTickers.filter(t => t !== ticker);
    }
    updateLumpCountText();
    renderLumpSimulator();
}

function updateLumpCountText() {
    const countSpan = document.getElementById('lump-select-count');
    if(countSpan) countSpan.textContent = `(${dollarApp.selectedLumpTickers.length}/4개 선택)`;
}

function calculateDRIPPaybackWeeks(startShares, payoutPerShare, price, targetInvestAmount) {
    if (targetInvestAmount <= 0 || payoutPerShare <= 0 || price <= 0) return 9999;
    
    let currentShares = startShares;
    let cumDiv = 0;
    let weeks = 0;
    
    while (cumDiv < targetInvestAmount && weeks < 520) {
        weeks++;
        let weeklyDiv = currentShares * payoutPerShare;
        cumDiv += weeklyDiv;
        let newShares = weeklyDiv / price;
        currentShares += newShares;
    }
    return weeks;
}

function renderLumpSimulator() {
    const container = document.getElementById('lump-comparison-cards');
    if(!container) return;

    if (dollarApp.selectedLumpTickers.length === 0) {
        container.innerHTML = `<div class="col-span-full p-8 bg-white rounded-2xl border border-slate-200 text-center text-slate-400 font-bold"><i class="fas fa-hand-pointer text-yellow-400 text-2xl mb-2 block"></i>위 종목 리스트에서 비교하고 싶은 종목을 1~4개 선택해주세요!</div>`;
        return;
    }

    const usdInput = document.getElementById('lump-amount-usd');
    const investUsd = cleanNumber(usdInput ? usdInput.value : 1000);
    const investKrw = Math.round(investUsd * dollarApp.liveFxRate);

    const memberSelect = document.getElementById('lump-member-select');
    const selectedMember = memberSelect ? memberSelect.value : 'all';

    let html = '';

    dollarApp.selectedLumpTickers.forEach(ticker => {
        let mRow = dollarApp.masterData.find(r => r && r[1] === ticker);
        if(!mRow) return;

        let name = mRow[2] || ticker;
        let limit = mRow[11] || 'X';
        let decimal = mRow[12] || 'O';
        
        let price = getLivePrice(ticker);
        let rawDiv = getDividend(ticker, name);
        let netDivPerShare = rawDiv * 0.85; 

        if(price <= 0) {
            html += `<div class="bg-red-50 rounded-2xl border border-red-200 p-5 flex flex-col justify-center items-center text-center"><i class="fas fa-exclamation-triangle text-red-400 text-3xl mb-2"></i><span class="text-sm font-bold text-red-700">${ticker}</span><span class="text-xs text-red-500 mt-1">주가 데이터가 시트에 없습니다.</span></div>`;
            return;
        }

        let newBoughtShares = 0;
        let remainingCash = 0;
        if (decimal === 'O') {
            newBoughtShares = investUsd / price;
        } else {
            newBoughtShares = Math.floor(investUsd / price);
            remainingCash = investUsd - (newBoughtShares * price);
        }

        let indepWeeklyIncUsd = newBoughtShares * netDivPerShare;
        let indepWeeklyIncKrw = indepWeeklyIncUsd * dollarApp.liveFxRate;

        let simpleWeeksIndep = indepWeeklyIncUsd > 0 ? (investUsd / indepWeeklyIncUsd) : 9999;
        let simpleYearsIndep = simpleWeeksIndep === 9999 ? "∞" : (simpleWeeksIndep / 52).toFixed(1);

        let dripWeeksIndep = calculateDRIPPaybackWeeks(newBoughtShares, netDivPerShare, price, investUsd);
        let dripYearsIndep = dripWeeksIndep === 9999 ? "∞" : (dripWeeksIndep / 52).toFixed(1);

        let existingMemberShares = 0;
        if (selectedMember !== 'all') {
            let currentMem = '';
            for(let k=1; k<dollarApp.portData.length; k++) {
                let pRow = dollarApp.portData[k];
                if(!pRow || pRow.length < 2) continue;
                let mName = (pRow[0] || '').trim();
                if(mName !== '') currentMem = mName;

                if(currentMem === selectedMember && (pRow[1]||'').trim().toUpperCase() === ticker.toUpperCase()) {
                    existingMemberShares += cleanNumber(pRow[4]); 
                }
            }
        }

        let combinedTotalShares = existingMemberShares + newBoughtShares;
        let combinedWeeklyIncUsd = combinedTotalShares * netDivPerShare;
        let combinedWeeklyIncKrw = combinedWeeklyIncUsd * dollarApp.liveFxRate;

        let dripWeeksComb = calculateDRIPPaybackWeeks(combinedTotalShares, netDivPerShare, price, investUsd);
        let dripYearsComb = dripWeeksComb === 9999 ? "∞" : (dripWeeksComb / 52).toFixed(1);

        html += `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden">
                <div class="border-b border-slate-100 pb-3 mb-3">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-black font-mono">${ticker}</span>
                        <span class="text-[11px] font-bold ${limit === 'X' ? 'text-green-600' : 'text-red-500'}">구매제한:${limit}</span>
                    </div>
                    <h5 class="font-extrabold text-slate-800 text-base truncate">${name}</h5>
                    <div class="text-xs text-slate-500 font-mono mt-1">현재가: <span class="font-bold text-slate-800">$${price.toFixed(2)}</span> <span class="text-[10px]">(₩${Math.round(price * dollarApp.liveFxRate).toLocaleString()})</span></div>
                </div>

                <div class="bg-yellow-50/70 border border-yellow-200/80 rounded-xl p-3 mb-3">
                    <div class="text-[11px] font-bold text-yellow-800 mb-0.5"><i class="fas fa-shopping-bag mr-1"></i>$${investUsd.toLocaleString()} 거치 구매 시</div>
                    <div class="text-xl font-black text-slate-900 font-mono">
                        ${newBoughtShares.toFixed(decimal==='O'?2:0)} <span class="text-xs font-bold text-slate-600">주 구매</span>
                    </div>
                    ${remainingCash > 0 ? `<div class="text-[10px] text-amber-700 mt-0.5 font-bold">잔돈: $${remainingCash.toFixed(2)}</div>` : ''}
                </div>

                <div class="space-y-2 mb-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div class="text-[11px] font-bold text-slate-600 flex items-center gap-1"><i class="fas fa-bolt text-amber-500"></i> 독립 연산 (목돈 단독)</div>
                    <div class="flex justify-between items-center text-xs">
                        <span class="text-slate-500 font-bold">주간 배당:</span>
                        <span class="font-black text-emerald-600 font-mono">+$${indepWeeklyIncUsd.toFixed(2)} <span class="text-[10px] text-slate-400">(₩${Math.round(indepWeeklyIncKrw).toLocaleString()})</span></span>
                    </div>
                    <div class="flex justify-between items-center text-xs border-t border-slate-200/60 pt-1.5">
                        <span class="text-slate-500 font-bold">회복(단리):</span>
                        <span class="font-bold text-slate-700 font-mono">${simpleYearsIndep}년 <span class="text-[10px] text-slate-400">(${simpleWeeksIndep===9999?'-':Math.round(simpleWeeksIndep)}주)</span></span>
                    </div>
                    <div class="flex justify-between items-center text-xs">
                        <span class="text-slate-500 font-bold">회복(DRIP):</span>
                        <span class="font-black text-indigo-600 font-mono">${dripYearsIndep}년 <span class="text-[10px] text-indigo-400">(${dripWeeksIndep===9999?'-':dripWeeksIndep}주)</span></span>
                    </div>
                </div>

                ${selectedMember !== 'all' ? `
                    <div class="space-y-2 bg-gradient-to-br from-indigo-50/60 to-blue-50/60 p-3 rounded-xl border border-indigo-100">
                        <div class="text-[11px] font-bold text-indigo-900 flex items-center gap-1"><i class="fas fa-layer-group text-indigo-600"></i> ${selectedMember}님 계좌 결합</div>
                        <div class="flex justify-between items-center text-xs">
                            <span class="text-slate-500 font-bold">총 합산수량:</span>
                            <span class="font-bold text-slate-800 font-mono">${combinedTotalShares.toFixed(2)}주 <span class="text-[10px] text-slate-400">(기존:${existingMemberShares})</span></span>
                        </div>
                        <div class="flex justify-between items-center text-xs">
                            <span class="text-slate-500 font-bold">합산 주간배당:</span>
                            <span class="font-black text-emerald-600 font-mono">+$${combinedWeeklyIncUsd.toFixed(2)}</span>
                        </div>
                        <div class="flex justify-between items-center text-xs border-t border-indigo-200/60 pt-1.5">
                            <span class="text-indigo-900 font-bold">결합회복(DRIP):</span>
                            <span class="font-black text-blue-700 font-mono">${dripYearsComb}년 <span class="text-[10px] text-blue-500">(${dripWeeksComb===9999?'-':dripWeeksComb}주)</span></span>
                        </div>
                    </div>
                ` : `<div class="text-[11px] text-center text-slate-400 font-bold bg-slate-50 p-2 rounded-lg border border-slate-100">멤버 선택 시 결합 시너지 표출</div>`}
            </div>
        `;
    });

    container.innerHTML = html;
}
