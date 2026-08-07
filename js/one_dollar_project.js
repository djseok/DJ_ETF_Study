// =========================================================
// 🌐 $1 복리 프로젝트 전용 엔진 (URL 타임스탬프 오류 완벽 해결)
// =========================================================

const DOLLAR_TIMESTAMP = typeof timestamp !== 'undefined' ? timestamp : new Date().getTime();

// 🔴 수정된 부분: 주소 맨 끝에 &t= 가 확실하게 들어가도록 분리해서 적었습니다. 🔴
const DOLLAR_MASTER_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv";
const DOLLAR_MASTER_URL = DOLLAR_MASTER_BASE + "&t=" + DOLLAR_TIMESTAMP;

const DOLLAR_PORT_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv";
const DOLLAR_PORT_URL = DOLLAR_PORT_BASE + "&t=" + DOLLAR_TIMESTAMP;

const dollarApp = {
    masterData: [],
    portData: [],
    sortKey: 'efficiency',
    sortAsc: false
};

function switchDollarSubTab(tabName) {
    const btnScan = document.getElementById('btnDollarScanner');
    const btnMem = document.getElementById('btnDollarMember');
    const viewScan = document.getElementById('tab-dollar-scanner');
    const viewMem = document.getElementById('tab-dollar-member');

    if (!btnScan || !btnMem || !viewScan || !viewMem) return;

    if (tabName === 'scanner') {
        btnScan.className = "px-4 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm shadow-sm transition-all";
        btnMem.className = "px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-200 shadow-sm transition-all";
        viewScan.classList.remove('hidden'); viewScan.classList.add('block');
        viewMem.classList.remove('block'); viewMem.classList.add('hidden');
    } else {
        btnMem.className = "px-4 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm shadow-sm transition-all";
        btnScan.className = "px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-200 shadow-sm transition-all";
        viewMem.classList.remove('hidden'); viewMem.classList.add('block');
        viewScan.classList.remove('block'); viewScan.classList.add('hidden');
    }
}

// 순수 배열 형태로만 파싱하는 안전 함수
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

async function loadDollarData() {
    if (dollarApp.masterData.length > 0) return;
    try {
        const [masterRes, portRes] = await Promise.all([
            fetch(DOLLAR_MASTER_URL), fetch(DOLLAR_PORT_URL)
        ]);
        
        dollarApp.masterData = parseSimpleArrayCSV(await masterRes.text());
        dollarApp.portData = parseSimpleArrayCSV(await portRes.text());
        
        renderDollarTable();
        populateDollarMemberSelect();
    } catch (error) {
        console.error("$1 데이터 로딩 에러:", error);
        const tbody = document.getElementById('dollar-table-body');
        if(tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-bold">데이터 로딩 에러 발생</td></tr>`;
    }
}

function renderDollarTable() {
    const tbody = document.getElementById('dollar-table-body');
    if(!tbody || dollarApp.masterData.length <= 1) return;
    
    const isLimitFilter = document.getElementById('filter-limit') ? document.getElementById('filter-limit').checked : false;
    const isDecimalFilter = document.getElementById('filter-decimal') ? document.getElementById('filter-decimal').checked : false;

    let tableData = [];
    for (let i = 1; i < dollarApp.masterData.length; i++) {
        const row = dollarApp.masterData[i];
        if (!row || row.length < 5) continue;

        const ticker = row[1] || '';
        const price = parseFloat(row[2]) || 0;
        const rawDiv = parseFloat(row[3]) || 0;
        
        if (!ticker || price <= 0) continue;

        const afterTaxDiv = rawDiv * 0.85; 
        const efficiency = price > 0 ? (afterTaxDiv / price) : 0;
        const efficiency_krw = efficiency * 1420; 

        tableData.push({ 
            ticker: ticker, 
            price: price, 
            efficiency: efficiency, 
            efficiency_krw: efficiency_krw, 
            limit: row[10] || 'X', 
            decimal: row[11] || 'O' 
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
            <td class="px-4 py-3 font-bold text-slate-800">${rankBadge}${item.ticker}</td>
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

function populateDollarMemberSelect() {
    if (!dollarApp.portData || dollarApp.portData.length <= 1) return;
    const select = document.getElementById('member-select');
    if(!select) return;
    
    let members = [];
    for(let i=1; i<dollarApp.portData.length; i++) {
        let name = dollarApp.portData[i][0];
        if(name && !members.includes(name)) members.push(name);
    }
    
    select.innerHTML = '<option value="all">분석할 멤버 선택</option>';
    members.forEach(m => {
        let opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        select.appendChild(opt);
    });
}

function renderMemberDashboard() {
    const member = document.getElementById('member-select').value;
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
        if (row[0] !== member) continue; 

        const ticker = row[1] || ''; 
        const stockName = row[2] || ticker; 
        const stockType = row[3] || ''; 
        const holdQty = parseFloat(row[4]) || 0;
        const dailyBuy = parseFloat(row[5]) || 0;

        let divExpected = 0;
        
        for(let j=1; j<dollarApp.masterData.length; j++) {
            let mRow = dollarApp.masterData[j];
            let mTicker = mRow[1] || ''; 
            
            if (mTicker === stockName || mTicker === ticker || mTicker.includes(stockName)) {
                let rawDiv = parseFloat(mRow[3]) || 0; 
                divExpected = (holdQty * rawDiv * 0.85);
                weeklyIncome += divExpected;
                break;
            }
        }
        
        const expenseExpected = (dailyBuy * 5); 
        weeklyExpense += expenseExpected; 

        if(holdQty > 0 || dailyBuy > 0) {
            listRows += `
                <tr class="border-b border-slate-100 hover:bg-slate-50">
                    <td class="p-3">
                        <div class="font-bold text-slate-700">${stockName}</div>
                        <div class="text-[10px] text-slate-400 font-mono">${ticker}</div>
                    </td>
                    <td class="p-3 text-center"><span class="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded font-bold">${stockType}</span></td>
                    <td class="p-3 text-right"><span class="text-xs bg-slate-100 px-2 py-1 rounded text-slate-500 font-bold">${holdQty}주</span></td>
                    <td class="p-3 text-right text-green-600 font-mono font-bold">+$${divExpected.toFixed(2)}</td>
                    <td class="p-3 text-right text-red-500 font-mono font-bold">-$${expenseExpected.toFixed(2)}</td>
                </tr>
            `;
        }
    }

    const netCash = weeklyIncome - weeklyExpense;
    const ratio = weeklyExpense > 0 ? ((weeklyIncome / weeklyExpense) * 100).toFixed(1) : (weeklyIncome > 0 ? "100+" : "0.0");
    const isSurplus = netCash >= 0;

    const uiHtml = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div class="bg-gradient-to-br from-green-50 to-emerald-100 p-5 rounded-2xl border border-green-200 shadow-sm">
                <div class="text-xs font-bold text-green-700 mb-1">📈 주간 공짜 배당 수입</div>
                <div class="text-3xl font-black text-green-800 font-mono">$${weeklyIncome.toFixed(2)}</div>
            </div>
            <div class="bg-gradient-to-br from-red-50 to-rose-100 p-5 rounded-2xl border border-red-200 shadow-sm">
                <div class="text-xs font-bold text-red-700 mb-1">💸 주간 모으기 총 지출</div>
                <div class="text-3xl font-black text-red-800 font-mono">$${weeklyExpense.toFixed(2)}</div>
            </div>
            <div class="bg-gradient-to-br ${isSurplus ? 'from-blue-50 to-indigo-100 border-blue-200' : 'from-orange-50 to-amber-100 border-orange-200'} p-5 rounded-2xl border shadow-sm flex flex-col justify-between">
                <div class="text-xs font-bold ${isSurplus ? 'text-blue-700' : 'text-orange-700'} mb-1">
                    ${isSurplus ? '🔥 무자본 자급자족 상태!' : '⚠️ 자급자족 미달 (보충 필요)'}
                </div>
                <div class="text-3xl font-black ${isSurplus ? 'text-blue-800' : 'text-orange-800'} font-mono flex items-end justify-between">
                    <span>${isSurplus ? '+' : '-'}$${Math.abs(netCash).toFixed(2)}</span>
                    <span class="text-sm bg-white/50 px-2 py-1 rounded-lg">효율 ${ratio}%</span>
                </div>
            </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="bg-slate-800 text-white p-3 font-bold text-sm">📋 ${member}님의 1달러 파이프라인 명세서</div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left whitespace-nowrap">
                    <thead class="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-xs">
                        <tr>
                            <th class="p-3">종목명/티커</th>
                            <th class="p-3 text-center">전략 유형</th>
                            <th class="p-3 text-right">거치 수량</th>
                            <th class="p-3 text-right">예상 주수입</th>
                            <th class="p-3 text-right">모으기 주지출</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${listRows || '<tr><td colspan="5" class="p-4 text-center text-slate-400">데이터가 없습니다.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    container.innerHTML = uiHtml;
}
