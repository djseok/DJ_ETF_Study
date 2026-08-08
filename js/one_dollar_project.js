// =========================================================
// 🌐 $1 복리 프로젝트 전용 엔진 (거치 시뮬레이션 종합 탑재)
// =========================================================

const DOLLAR_TIMESTAMP = typeof timestamp !== 'undefined' ? timestamp : new Date().getTime();
const DOLLAR_MASTER_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv";
const DOLLAR_MASTER_URL = DOLLAR_MASTER_BASE + "&t=" + DOLLAR_TIMESTAMP;
const DOLLAR_PORT_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv";
const DOLLAR_PORT_URL = DOLLAR_PORT_BASE + "&t=" + DOLLAR_TIMESTAMP;

const dollarApp = {
    masterData: [],
    portData: [],
    sortKey: 'efficiency',
    sortAsc: false,
    liveFxRate: 1420,
    selectedLumpTickers: []
};

// ---------------------------------------------------------
// 1. 서브 탭 전환 제어
// ---------------------------------------------------------
function switchDollarSubTab(tabName) {
    const btnScan = document.getElementById('btnDollarScanner');
    const btnMem = document.getElementById('btnDollarMember');
    const btnLump = document.getElementById('btnDollarLump');
    
    const viewScan = document.getElementById('tab-dollar-scanner');
    const viewMem = document.getElementById('tab-dollar-member');
    const viewLump = document.getElementById('tab-dollar-lump');

    if (!btnScan || !btnMem || !viewScan || !viewMem) return;

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
        initLumpSimulatorView();
    }
}

// 순수 2차원 배열 CSV 파서
function parseSimpleArrayCSV(text) {
    if(!text) return [];
    text = text.replace(/^\uFEFF/, '');
    const lines = text.split('\n').filter(l => l.trim() !== '');
    if(lines.length === 0) return [];
    
    return lines.map(line => {
        const values = line.split(',');
        return values.map(val => {
            val = val ? val.trim() : '';
            if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
            return val;
        });
    });
}

// 데이터 다운로드 및 A2 실시간 환율 추출
async function loadDollarData() {
    if (dollarApp.masterData.length > 0) return;
    try {
        const [masterRes, portRes] = await Promise.all([
            fetch(DOLLAR_MASTER_URL), fetch(DOLLAR_PORT_URL)
        ]);
        
        dollarApp.masterData = parseSimpleArrayCSV(await masterRes.text());
        dollarApp.portData = parseSimpleArrayCSV(await portRes.text());

        // 🎯 A2 셀(마스터 데이터 0행/1행의 0열)에서 실시간 환율 감지
        if (dollarApp.masterData.length > 0) {
            let candidate0 = parseFloat(dollarApp.masterData[0][0]);
            let candidate1 = dollarApp.masterData[1] ? parseFloat(dollarApp.masterData[1][0]) : NaN;
            
            if (!isNaN(candidate0) && candidate0 > 1000 && candidate0 < 2500) {
                dollarApp.liveFxRate = candidate0;
            } else if (!isNaN(candidate1) && candidate1 > 1000 && candidate1 < 2500) {
                dollarApp.liveFxRate = candidate1;
            }
        }
        
        renderDollarTable();
        populateDollarMemberSelect();
    } catch (error) {
        console.error("$1 데이터 로딩 에러:", error);
        const tbody = document.getElementById('dollar-table-body');
        if(tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-bold">데이터 로딩 에러가 발생했습니다.</td></tr>`;
    }
}

// ---------------------------------------------------------
// 2. 1달러 생산성 스캐너
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

        const ticker = row[1] || '';           // B열
        const name = row[2] || '';             // C열
        const price = parseFloat(row[3]) || 0; // D열
        const rawDiv = parseFloat(row[4]) || 0;// E열
        
        const limit = row[11] || 'X';          // L열
        const decimal = row[12] || 'O';        // M열
        
        if (!ticker || price <= 0) continue;

        const afterTaxDiv = rawDiv * 0.85; 
        const efficiency = price > 0 ? (afterTaxDiv / price) : 0;
        const efficiency_krw = efficiency * dollarApp.liveFxRate; 

        const displayName = `${ticker} <span class="text-xs text-slate-400 ml-1">(${name})</span>`;

        tableData.push({ 
            displayName: displayName, 
            price: price, 
            efficiency: efficiency, 
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
        let rankBadge = '';
        if (idx === 0) rankBadge = '<i class="fas fa-crown text-yellow-500 mr-1"></i>';
        else if (idx === 1) rankBadge = '<i class="fas fa-medal text-slate-400 mr-1"></i>';
        else if (idx === 2) rankBadge = '<i class="fas fa-medal text-orange-400 mr-1"></i>';

        tr.innerHTML = `
            <td class="px-4 py-3 font-bold text-slate-800">${rankBadge}${item.displayName}</td>
            <td class="px-4 py-3 text-right font-mono text-slate-600">$${item.price.toFixed(2)}</td>
            <td class="px-4 py-3 text-right font-mono font-black text-red-600 bg-red-50/30">$${item.efficiency.toFixed(5)}</td>
            <td class="px-4 py-3 text-right font-mono font-black text-blue-600 bg-blue-50/30">${item.efficiency_krw.toFixed(1)}원</td>
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
// 3. 멤버별 자급자족 현황판
// ---------------------------------------------------------
function populateDollarMemberSelect() {
    if (!dollarApp.portData || dollarApp.portData.length <= 1) return;
    const select = document.getElementById('member-select');
    const lumpSelect = document.getElementById('lump-member-select');
    if(!select) return;
    
    let members = [];
    for(let i=1; i<dollarApp.portData.length; i++) {
        let name = dollarApp.portData[i][0];
        if(name && !members.includes(name)) members.push(name);
    }
    
    select.innerHTML = '<option value="all">분석할 멤버 선택</option>';
    if(lumpSelect) lumpSelect.innerHTML = '<option value="all">멤버 선택 안 함 (독립 연산 전용)</option>';
    
    members.forEach(m => {
        let opt = document.createElement('option');
        opt.value = m; opt.textContent = m + " 님";
        select.appendChild(opt);

        if(lumpSelect) {
            let opt2 = document.createElement('option');
            opt2.value = m; opt2.textContent = m + " 님 (기존 계좌 결합 연산)";
            lumpSelect.appendChild(opt2);
        }
    });
}

function renderMemberDashboard() {
    const memberSelect = document.getElementById('member-select');
    if(!memberSelect) return;
    const member = memberSelect.value;
    const container = document.getElementById('member-dashboard-cards');
    if (!container) return;

    if (member === 'all') {
        container.innerHTML = '';
        return;
    }

    let weeklyIncome = 0;
    let weeklyExpense = 0;
    let listRows = '';

    for(let i=1; i<dollarApp.portData.length; i++) {
        let row = dollarApp.portData[i];
        if (!row || row.length < 5) continue;
        if (row[0] !== member) continue;

        const ticker = row[1] || ''; 
        const stockName = row[2] || ticker; 
        const stockType = row[3] || '거치'; 
        const holdQty = parseFloat(row[4]) || 0;
        const dailyBuy = parseFloat(row[5]) || 0;

        let divExpected = 0;
        
        for(let j=1; j<dollarApp.masterData.length; j++) {
            let mRow = dollarApp.masterData[j];
            if (!mRow || mRow.length < 5) continue;
            let mTicker = mRow[1] || ''; 
            let mName = mRow[2] || '';   
            
            if (mTicker === ticker || mName === stockName || (mTicker && ticker && mTicker.toUpperCase() === ticker.toUpperCase())) {
                let rawDiv = parseFloat(mRow[4]) || 0; 
                divExpected = (holdQty * rawDiv * 0.85); 
                weeklyIncome += divExpected;
                break;
            }
        }
        
        const expenseExpected = (dailyBuy * 5); 
        weeklyExpense += expenseExpected; 

        if(holdQty > 0 || dailyBuy > 0) {
            let formattedQty = holdQty === 0 ? "0" : (Number.isInteger(holdQty) ? holdQty.toLocaleString() : holdQty.toFixed(4).replace(/\.?0+$/, ''));
            listRows += `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td class="p-3 pl-4">
                        <div class="font-bold text-slate-800">${stockName}</div>
                        <div class="text-[11px] text-slate-400 font-mono">${ticker}</div>
                    </td>
                    <td class="p-3 text-center">
                        <span class="text-xs ${stockType === '거치' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'} px-2.5 py-1 rounded-md font-bold">${stockType}</span>
                    </td>
                    <td class="p-3 text-right">
                        <span class="text-xs bg-slate-100 px-2.5 py-1 rounded-md text-slate-700 font-bold font-mono">${formattedQty}주</span>
                    </td>
                    <td class="p-3 text-right text-emerald-600 font-mono font-bold">+$${divExpected.toFixed(2)}</td>
                    <td class="p-3 text-right pr-4 text-rose-500 font-mono font-bold">-$${expenseExpected.toFixed(2)}</td>
                </tr>
            `;
        }
    }

    const netCash = weeklyIncome - weeklyExpense;
    const ratio = weeklyExpense > 0 ? ((weeklyIncome / weeklyExpense) * 100).toFixed(1) : (weeklyIncome > 0 ? "100+" : "0.0");
    const isSurplus = netCash >= 0;

    const uiHtml = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div class="bg-gradient-to-br from-emerald-50 to-teal-100 p-5 rounded-2xl border border-emerald-200 shadow-sm">
                <div class="text-xs font-bold text-emerald-700 mb-1 flex items-center gap-1">
                    <i class="fas fa-arrow-trend-up"></i> 주간 예상 배당 수입 (세후)
                </div>
                <div class="text-3xl font-black text-emerald-800 font-mono">$${weeklyIncome.toFixed(2)}</div>
            </div>
            <div class="bg-gradient-to-br from-rose-50 to-red-100 p-5 rounded-2xl border border-rose-200 shadow-sm">
                <div class="text-xs font-bold text-rose-700 mb-1 flex items-center gap-1">
                    <i class="fas fa-coins"></i> 주간 모으기 지출 (5일 기준)
                </div>
                <div class="text-3xl font-black text-rose-800 font-mono">$${weeklyExpense.toFixed(2)}</div>
            </div>
            <div class="bg-gradient-to-br ${isSurplus ? 'from-indigo-50 to-blue-100 border-indigo-200' : 'from-amber-50 to-orange-100 border-amber-200'} p-5 rounded-2xl border shadow-sm flex flex-col justify-between">
                <div class="text-xs font-bold ${isSurplus ? 'text-indigo-700' : 'text-amber-700'} mb-1 flex items-center gap-1">
                    ${isSurplus ? '<i class="fas fa-fire text-blue-600"></i> 무자본 자급자족 상태!' : '<i class="fas fa-triangle-exclamation text-amber-600"></i> 자급자족 미달 (보충 필요)'}
                </div>
                <div class="text-3xl font-black ${isSurplus ? 'text-indigo-900' : 'text-amber-900'} font-mono flex items-end justify-between">
                    <span>${isSurplus ? '+' : '-'}$${Math.abs(netCash).toFixed(2)}</span>
                    <span class="text-xs bg-white/70 text-slate-700 px-2 py-1 rounded-lg font-bold">충당률 ${ratio}%</span>
                </div>
            </div>
        </div>

        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="bg-slate-800 text-white p-4 font-bold text-sm flex items-center justify-between">
                <span class="flex items-center gap-2"><i class="fas fa-clipboard-list text-yellow-400"></i> ${member}님의 $1 파이프라인 명세서</span>
                <span class="text-xs font-normal text-slate-300">주 5일 연산 기준</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left whitespace-nowrap">
                    <thead class="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-xs">
                        <tr>
                            <th class="p-3.5 pl-4">종목명 / 티커</th>
                            <th class="p-3.5 text-center">전략 유형</th>
                            <th class="p-3.5 text-right">보유 수량</th>
                            <th class="p-3.5 text-right">주간 예상 수입</th>
                            <th class="p-3.5 text-right pr-4">주간 모으기 지출</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 font-medium">
                        ${listRows || '<tr><td colspan="5" class="p-6 text-center text-slate-400 font-bold">등록된 종목 데이터가 없습니다.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    container.innerHTML = uiHtml;
}

// ---------------------------------------------------------
// 🚀 4. 거치 시뮬레이션 전용 연산 및 UI 엔진
// ---------------------------------------------------------
function initLumpSimulatorView() {
    const rateText = document.getElementById('lump-fx-rate-text');
    if(rateText) rateText.textContent = `₩${dollarApp.liveFxRate.toLocaleString()}`;
    
    syncLumpAmount('usd');
    renderLumpStockSelector();
}

// 달러($) <-> 원화(₩) 실시간 입력 연동
function syncLumpAmount(changedSource) {
    const usdInput = document.getElementById('lump-amount-usd');
    const krwInput = document.getElementById('lump-amount-krw');
    if (!usdInput || !krwInput) return;

    const fx = dollarApp.liveFxRate || 1420;

    if (changedSource === 'usd') {
        const usdVal = parseFloat(usdInput.value) || 0;
        krwInput.value = Math.round(usdVal * fx);
    } else {
        const krwVal = parseFloat(krwInput.value) || 0;
        usdInput.value = (krwVal / fx).toFixed(2);
    }
    renderLumpSimulator();
}

// 비교 종목 체크박스 리스트 렌더링
function renderLumpStockSelector() {
    const grid = document.getElementById('lump-stock-checkbox-grid');
    if(!grid || dollarApp.masterData.length <= 1) return;

    const isLimitFilter = document.getElementById('lump-filter-limit') ? document.getElementById('lump-filter-limit').checked : false;
    const isDecimalFilter = document.getElementById('lump-filter-decimal') ? document.getElementById('lump-filter-decimal').checked : false;

    let availableStocks = [];
    for(let i=1; i<dollarApp.masterData.length; i++) {
        let row = dollarApp.masterData[i];
        if(!row || row.length < 5) continue;

        let ticker = row[1] || '';
        let name = row[2] || '';
        let price = parseFloat(row[3]) || 0;
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
    if(countSpan) {
        countSpan.textContent = `(${dollarApp.selectedLumpTickers.length}/4개 선택)`;
    }
}

// 🎯 복리(DRIP) 회복 주수 계산 함수
function calculateDRIPPaybackWeeks(startShares, payoutPerShare, price, targetInvestAmount) {
    if (targetInvestAmount <= 0 || payoutPerShare <= 0 || price <= 0) return 9999;
    
    let currentShares = startShares;
    let cumDiv = 0;
    let weeks = 0;
    
    // 최대 10년 (520주) 안전 루프
    while (cumDiv < targetInvestAmount && weeks < 520) {
        weeks++;
        let weeklyDiv = currentShares * payoutPerShare;
        cumDiv += weeklyDiv;
        let newShares = weeklyDiv / price;
        currentShares += newShares;
    }
    return weeks;
}

// 🎯 거치 시뮬레이션 대시보드 렌더링
function renderLumpSimulator() {
    const container = document.getElementById('lump-comparison-cards');
    if(!container) return;

    if (dollarApp.selectedLumpTickers.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-8 bg-white rounded-2xl border border-slate-200 text-center text-slate-400 font-bold">
                <i class="fas fa-hand-pointer text-yellow-400 text-2xl mb-2 block"></i>
                위 종목 리스트에서 비교하고 싶은 종목을 1~4개 선택해주세요!
            </div>
        `;
        return;
    }

    const usdInput = document.getElementById('lump-amount-usd');
    const investUsd = parseFloat(usdInput ? usdInput.value : 1000) || 0;
    const investKrw = Math.round(investUsd * dollarApp.liveFxRate);

    const memberSelect = document.getElementById('lump-member-select');
    const selectedMember = memberSelect ? memberSelect.value : 'all';

    let html = '';

    dollarApp.selectedLumpTickers.forEach(ticker => {
        // 마스터 데이터 검색
        let mRow = dollarApp.masterData.find(r => r && r[1] === ticker);
        if(!mRow) return;

        let name = mRow[2] || ticker;
        let price = parseFloat(mRow[3]) || 0;
        let rawDiv = parseFloat(mRow[4]) || 0;
        let limit = mRow[11] || 'X';
        let decimal = mRow[12] || 'O';
        let netDivPerShare = rawDiv * 0.85; // 세후 15% 적용

        if(price <= 0) return;

        // 1. 매수 가능 주수 연산
        let newBoughtShares = 0;
        let remainingCash = 0;
        if (decimal === 'O') {
            newBoughtShares = investUsd / price;
        } else {
            newBoughtShares = Math.floor(investUsd / price);
            remainingCash = investUsd - (newBoughtShares * price);
        }

        // 2. 독립형 연산 (순수 목돈)
        let indepWeeklyIncUsd = newBoughtShares * netDivPerShare;
        let indepWeeklyIncKrw = indepWeeklyIncUsd * dollarApp.liveFxRate;

        // 단리 회복 기간 (주/년)
        let simpleWeeksIndep = indepWeeklyIncUsd > 0 ? (investUsd / indepWeeklyIncUsd) : 9999;
        let simpleYearsIndep = (simpleWeeksIndep / 52).toFixed(1);

        // 복리(DRIP) 회복 기간 (주/년)
        let dripWeeksIndep = calculateDRIPPaybackWeeks(newBoughtShares, netDivPerShare, price, investUsd);
        let dripYearsIndep = (dripWeeksIndep / 52).toFixed(1);

        // 3. 결합형 연산 (선택한 멤버의 기존 계좌 보유수량 파악)
        let existingMemberShares = 0;
        if (selectedMember !== 'all' && dollarApp.portData.length > 1) {
            for(let k=1; k<dollarApp.portData.length; k++) {
                let pRow = dollarApp.portData[k];
                if(pRow[0] === selectedMember && pRow[1] === ticker) {
                    existingMemberShares += parseFloat(pRow[4]) || 0;
                }
            }
        }

        let combinedTotalShares = existingMemberShares + newBoughtShares;
        let combinedWeeklyIncUsd = combinedTotalShares * netDivPerShare;
        let combinedWeeklyIncKrw = combinedWeeklyIncUsd * dollarApp.liveFxRate;

        // 결합형 DRIP 엔진 (기존 주식 + 신규 거치주 합쳐서 $투자금 회수까지 걸리는 주수)
        let dripWeeksComb = calculateDRIPPaybackWeeks(combinedTotalShares, netDivPerShare, price, investUsd);
        let dripYearsComb = (dripWeeksComb / 52).toFixed(1);

        html += `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden">
                <div class="border-b border-slate-100 pb-3 mb-3">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-black font-mono">${ticker}</span>
                        <span class="text-[11px] font-bold ${limit === 'X' ? 'text-green-600' : 'text-red-500'}">구매제한:${limit}</span>
                    </div>
                    <h5 class="font-extrabold text-slate-800 text-base truncate">${name}</h5>
                    <div class="text-xs text-slate-500 font-mono mt-1">현재가: <span class="font-bold text-slate-800">$${price.toFixed(2)}</span> (₩${Math.round(price * dollarApp.liveFxRate).toLocaleString()})</div>
                </div>

                <div class="bg-yellow-50/70 border border-yellow-200/80 rounded-xl p-3 mb-3">
                    <div class="text-[11px] font-bold text-yellow-800 mb-0.5"><i class="fas fa-shopping-bag mr-1"></i>$${investUsd.toLocaleString()} 거치 구매 시</div>
                    <div class="text-xl font-black text-slate-900 font-mono">
                        ${newBoughtShares.toFixed(decimal==='O'?2:0)} <span class="text-xs font-bold text-slate-600">주 구매</span>
                    </div>
                    ${remainingCash > 0 ? `<div class="text-[10px] text-amber-700 mt-0.5 font-bold">잔돈: $${remainingCash.toFixed(2)}</div>` : ''}
                </div>

                <div class="space-y-2 mb-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div class="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                        <i class="fas fa-bolt text-amber-500"></i> 독립 연산 (목돈 단독)
                    </div>
                    <div class="flex justify-between items-center text-xs">
                        <span class="text-slate-500 font-bold">주간 배당수입:</span>
                        <span class="font-black text-emerald-600 font-mono">+$${indepWeeklyIncUsd.toFixed(2)} <span class="text-[10px] text-slate-400">(₩${Math.round(indepWeeklyIncKrw).toLocaleString()})</span></span>
                    </div>
                    <div class="flex justify-between items-center text-xs border-t border-slate-200/60 pt-1.5">
                        <span class="text-slate-500 font-bold">원금회복(단리):</span>
                        <span class="font-bold text-slate-700 font-mono">${simpleYearsIndep}년 <span class="text-[10px] text-slate-400">(${Math.round(simpleWeeksIndep)}주)</span></span>
                    </div>
                    <div class="flex justify-between items-center text-xs">
                        <span class="text-slate-500 font-bold">원금회복(DRIP복리):</span>
                        <span class="font-black text-indigo-600 font-mono">${dripYearsIndep}년 <span class="text-[10px] text-indigo-400">(${dripWeeksIndep}주)</span></span>
                    </div>
                </div>

                ${selectedMember !== 'all' ? `
                    <div class="space-y-2 bg-gradient-to-br from-indigo-50/60 to-blue-50/60 p-3 rounded-xl border border-indigo-100">
                        <div class="text-[11px] font-bold text-indigo-900 flex items-center gap-1">
                            <i class="fas fa-layer-group text-indigo-600"></i> ${selectedMember}님 계좌 결합 시
                        </div>
                        <div class="flex justify-between items-center text-xs">
                            <span class="text-slate-500 font-bold">총 합산 수량:</span>
                            <span class="font-bold text-slate-800 font-mono">${combinedTotalShares.toFixed(2)}주 <span class="text-[10px] text-slate-400">(기존:${existingMemberShares}주)</span></span>
                        </div>
                        <div class="flex justify-between items-center text-xs">
                            <span class="text-slate-500 font-bold">총 주간 배당수입:</span>
                            <span class="font-black text-emerald-600 font-mono">+$${combinedWeeklyIncUsd.toFixed(2)} <span class="text-[10px] text-slate-400">(₩${Math.round(combinedWeeklyIncKrw).toLocaleString()})</span></span>
                        </div>
                        <div class="flex justify-between items-center text-xs border-t border-indigo-200/60 pt-1.5">
                            <span class="text-indigo-900 font-bold">결합회복(DRIP복리):</span>
                            <span class="font-black text-blue-700 font-mono">${dripYearsComb}년 <span class="text-[10px] text-blue-500">(${dripWeeksComb}주)</span></span>
                        </div>
                    </div>
                ` : `
                    <div class="text-[11px] text-center text-slate-400 font-bold bg-slate-50 p-2 rounded-lg border border-slate-100">
                        상단에서 멤버 선택 시 결합 시너지 표출
                    </div>
                `}
            </div>
        `;
    });

    container.innerHTML = html;
}
