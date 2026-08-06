// 🌐 1달러 복리 프로젝트 전용 엔진 (가장 깔끔하고 안전한 버전)

const DOLLAR_MASTER_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv";
const DOLLAR_PORT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv";

let globalDollarMaster = [];
let globalDollarPort = [];
let currentDollarSortKey = 'efficiency'; 
let currentDollarSortAsc = false; 
let dollarCashflowChart = null; 

// --- main.js 에서 호출할 전용 함수들 --- //

// $1 프로젝트 탭 열기
window.showOneDollarView = function() {
    // 기존 화면 강제 숨김
    ['viewQuant', 'viewPort', 'viewCalc', 'viewDiv', 'viewMdd', 'viewRsi'].forEach(v => {
        const el = document.getElementById(v);
        if(el) { el.classList.add('hidden'); el.classList.remove('block'); }
    });
    
    // 내 화면 켜기
    const viewOneDollar = document.getElementById('viewOneDollar');
    if (viewOneDollar) {
        viewOneDollar.classList.remove('hidden');
        viewOneDollar.classList.add('block');
    }
    
    // 버튼 색상 처리
    const tabs = ['btnTabQuant', 'btnTabPort', 'btnTabCalc', 'btnTabDiv', 'btnTabMdd', 'btnTabRsi'];
    tabs.forEach(id => {
        const btn = document.getElementById(id);
        if(btn) {
            btn.classList.remove('bg-slate-800', 'text-white');
            btn.classList.add('bg-white', 'text-slate-600');
        }
    });
    
    const activeBtn = document.getElementById('btnTabOneDollar');
    if(activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-yellow-700');
        activeBtn.classList.add('bg-slate-800', 'text-white');
    }
    
    loadDollarData(); // 데이터 로드
};

// $1 프로젝트 탭 숨기기 (다른 탭 눌렀을 때)
window.hideOneDollarView = function() {
    const viewOneDollar = document.getElementById('viewOneDollar');
    if (viewOneDollar) {
        viewOneDollar.classList.add('hidden');
        viewOneDollar.classList.remove('block');
    }
    const activeBtn = document.getElementById('btnTabOneDollar');
    if(activeBtn) {
        activeBtn.classList.remove('bg-slate-800', 'text-white');
        activeBtn.classList.add('bg-white', 'text-yellow-700');
    }
};

// --- 서브 기능들 --- //

function switchDollarSubTab(tabName) {
    const btnScan = document.getElementById('btnDollarScanner');
    const btnMem = document.getElementById('btnDollarMember');
    const viewScan = document.getElementById('tab-dollar-scanner');
    const viewMem = document.getElementById('tab-dollar-member');

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

function parseBulletproofCSV(text) {
    if(!text) return [];
    text = text.replace(/^\uFEFF/, '');
    const lines = text.split('\n').filter(l => l.trim() !== '');
    if(lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/\s/g, ''));
    
    return lines.slice(1).map(line => {
        const values = line.split(',');
        let obj = {};
        headers.forEach((h, i) => {
            let val = values[i] ? values[i].trim() : '';
            if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
            obj[h] = val;
        });
        return obj;
    });
}

async function loadDollarData() {
    if (globalDollarMaster.length > 0) return;
    try {
        const [masterRes, portRes] = await Promise.all([
            fetch(DOLLAR_MASTER_URL), fetch(DOLLAR_PORT_URL)
        ]);
        globalDollarMaster = parseBulletproofCSV(await masterRes.text());
        globalDollarPort = parseBulletproofCSV(await portRes.text());
        renderDollarTable();
        populateDollarMemberSelect();
    } catch (error) {
        console.error("$1 데이터 로딩 에러:", error);
        document.getElementById('dollar-table-body').innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-bold">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
    }
}

function renderDollarTable() {
    const tbody = document.getElementById('dollar-table-body');
    const isLimitFilter = document.getElementById('filter-limit').checked;
    const isDecimalFilter = document.getElementById('filter-decimal').checked;

    let tableData = globalDollarMaster.map(row => {
        const ticker = row['종목이름'] || row['티커'] || row['이름'] || '';
        const price = parseFloat(row['주가']) || 0;
        const rawDiv = parseFloat(row['최근4주평균분배금(달러)']) || 0;
        const afterTaxDiv = rawDiv * 0.85; 
        const efficiency = price > 0 ? (afterTaxDiv / price) : 0;
        const efficiency_krw = efficiency * 1420; 

        return { ticker: ticker, price: price, efficiency: efficiency, efficiency_krw: efficiency_krw, limit: row['구매제한'] || 'O', decimal: row['소수점가능'] || 'X' };
    }).filter(d => d.ticker && d.price > 0);

    if (isLimitFilter) tableData = tableData.filter(d => d.limit === 'X');
    if (isDecimalFilter) tableData = tableData.filter(d => d.decimal === 'O');

    tableData.sort((a, b) => {
        let valA = a[currentDollarSortKey];
        let valB = b[currentDollarSortKey];
        return currentDollarSortAsc ? valA - valB : valB - valA;
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
    if (currentDollarSortKey === key) { currentDollarSortAsc = !currentDollarSortAsc; } 
    else { currentDollarSortKey = key; currentDollarSortAsc = false; }
    renderDollarTable();
}

function populateDollarMemberSelect() {
    if (!globalDollarPort || globalDollarPort.length === 0) return;
    const select = document.getElementById('member-select');
    let userKey = Object.keys(globalDollarPort[0]).find(k => k.includes('투자자') || k.includes('이름')) || '투자자';
    const members = [...new Set(globalDollarPort.map(d => d[userKey]).filter(v => v))];
    
    select.innerHTML = '<option value="all">분석할 멤버 선택</option>';
    members.forEach(m => {
        let opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        select.appendChild(opt);
    });
}

function renderMemberDashboard() {
    const member = document.getElementById('member-select').value;
    if (member === 'all') {
        document.getElementById('member-dashboard-cards').innerHTML = '';
        if (dollarCashflowChart) dollarCashflowChart.destroy();
        return;
    }

    let userKey = Object.keys(globalDollarPort[0]).find(k => k.includes('투자자') || k.includes('이름')) || '투자자';
    const myPort = globalDollarPort.filter(d => d[userKey] === member);

    let weeklyIncome = 0;
    let weeklyExpense = 0;

    myPort.forEach(row => {
        const ticker = row['종목이름'] || row['티커'] || row['종목'] || '';
        const holdQty = parseFloat(row['보유수량'] || row['거치수량']) || 0;
        const dailyBuyStr = row['모으기금액'] || row['일일모으기금액($)'] || row['일일모으기'] || '0';
        const dailyBuy = parseFloat(dailyBuyStr) || 0;

        const masterItem = globalDollarMaster.find(m => (m['종목이름'] || m['티커']) === ticker);
        if (masterItem) {
            const rawDiv = parseFloat(masterItem['최근4주평균분배금(달러)']) || 0;
            weeklyIncome += (holdQty * rawDiv * 0.85); 
        }
        weeklyExpense += (dailyBuy * 5); 
    });

    const netCash = weeklyIncome - weeklyExpense;
    const ratio = weeklyExpense > 0 ? ((weeklyIncome / weeklyExpense) * 100).toFixed(1) : (weeklyIncome > 0 ? "100+" : "0.0");
    const isSurplus = netCash >= 0;

    const cardHtml = `
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
    `;
    document.getElementById('member-dashboard-cards').innerHTML = cardHtml;
    drawDollarChart(weeklyIncome, weeklyExpense);
}

function drawDollarChart(income, expense) {
    const ctx = document.getElementById('memberCashflowChart').getContext('2d');
    if (dollarCashflowChart) dollarCashflowChart.destroy();

    dollarCashflowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['주간 자금 흐름 ($)'],
            datasets: [
                { label: '주간 배당 수입', data: [income], backgroundColor: 'rgba(16, 185, 129, 0.85)', borderRadius: 8, barPercentage: 0.4 },
                { label: '주간 모으기 지출', data: [expense], backgroundColor: 'rgba(239, 68, 68, 0.85)', borderRadius: 8, barPercentage: 0.4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { position: 'top', labels: { font: { weight: 'bold' } } } },
            scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } }
        }
    });
}
