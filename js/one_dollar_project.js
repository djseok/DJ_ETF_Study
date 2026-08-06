// =========================================================
// 🌐 $1 복리 프로젝트 전용 엔진 (충돌 방지 및 표(Table) 최적화 버전)
// =========================================================

// main.js에 있는 timestamp를 빌려와 캐시 갱신 (없으면 현재 시간)
const DOLLAR_TIMESTAMP = typeof timestamp !== 'undefined' ? timestamp : new Date().getTime();
const DOLLAR_MASTER_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv&t=" + DOLLAR_TIMESTAMP;
const DOLLAR_PORT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv&t=" + DOLLAR_TIMESTAMP;

// 충돌을 막기 위해 모든 변수를 하나의 객체(Object) 안에 가둬둡니다.
const dollarApp = {
    masterData: [],
    portData: [],
    sortKey: 'efficiency',
    sortAsc: false,
    chartInstance: null
};

// ---------------------------------------------------------
// 1. UI 전환 및 파싱 함수
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// 2. 데이터 다운로드 엔진
// ---------------------------------------------------------
async function loadDollarData() {
    if (dollarApp.masterData.length > 0) return; // 이미 있으면 패스
    try {
        const [masterRes, portRes] = await Promise.all([
            fetch(DOLLAR_MASTER_URL), fetch(DOLLAR_PORT_URL)
        ]);
        dollarApp.masterData = parseBulletproofCSV(await masterRes.text());
        dollarApp.portData = parseBulletproofCSV(await portRes.text());
        renderDollarTable();
        populateDollarMemberSelect();
    } catch (error) {
        console.error("$1 데이터 로딩 에러:", error);
        const tbody = document.getElementById('dollar-table-body');
        if(tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-bold">데이터를 불러오는 중 오류가 발생했습니다. 구글 시트 웹 게시 상태를 확인하세요.</td></tr>`;
    }
}

// ---------------------------------------------------------
// 3. 생산성 스캐너 렌더링 (테이블)
// ---------------------------------------------------------
function renderDollarTable() {
    const tbody = document.getElementById('dollar-table-body');
    if(!tbody) return;
    
    const filterLimitObj = document.getElementById('filter-limit');
    const filterDecimalObj = document.getElementById('filter-decimal');
    const isLimitFilter = filterLimitObj ? filterLimitObj.checked : false;
    const isDecimalFilter = filterDecimalObj ? filterDecimalObj.checked : false;

    let tableData = dollarApp.masterData.map(row => {
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

// ---------------------------------------------------------
// 4. 멤버별 자급자족 현황 (그래프 제외, 카드 + 표 UI 적용)
// ---------------------------------------------------------
function populateDollarMemberSelect() {
    if (!dollarApp.portData || dollarApp.portData.length === 0) return;
    const select = document.getElementById('member-select');
    if(!select) return;
    
    let userKey = Object.keys(dollarApp.portData[0]).find(k => k.includes('투자자') || k.includes('이름')) || '투자자';
    const members = [...new Set(dollarApp.portData.map(d => d[userKey]).filter(v => v))];
    
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

    let userKey = Object.keys(dollarApp.portData[0]).find(k => k.includes('투자자') || k.includes('이름')) || '투자자';
    const myPort = dollarApp.portData.filter(d => d[userKey] === member);

    let weeklyIncome = 0;
    let weeklyExpense = 0;
    let listRows = '';

    myPort.forEach(row => {
        const ticker = row['종목이름'] || row['티커'] || row['종목'] || '';
        const holdQty = parseFloat(row['보유수량'] || row['거치수량']) || 0;
        const dailyBuyStr = row['모으기금액'] || row['일일모으기금액($)'] || row['일일모으기'] || '0';
        const dailyBuy = parseFloat(dailyBuyStr) || 0;

        let divExpected = 0;
        const masterItem = dollarApp.masterData.find(m => (m['종목이름'] || m['티커']) === ticker);
        if (masterItem) {
            const rawDiv = parseFloat(masterItem['최근4주평균분배금(달러)']) || 0;
            divExpected = (holdQty * rawDiv * 0.85);
            weeklyIncome += divExpected; 
        }
        
        const expenseExpected = (dailyBuy * 5);
        weeklyExpense += expenseExpected; 

        // 종목별 표에 들어갈 데이터 조립
        if(holdQty > 0 || dailyBuy > 0) {
            listRows += `
                <tr class="border-b border-slate-100 hover:bg-slate-50">
                    <td class="p-3 font-bold text-slate-700">${ticker}</td>
                    <td class="p-3 text-right"><span class="text-xs bg-slate-100 px-2 py-1 rounded text-slate-500">${holdQty}주</span></td>
                    <td class="p-3 text-right text-green-600 font-mono font-bold">+$${divExpected.toFixed(2)}</td>
                    <td class="p-3 text-right text-red-500 font-mono font-bold">-$${expenseExpected.toFixed(2)}</td>
                </tr>
            `;
        }
    });

    const netCash = weeklyIncome - weeklyExpense;
    const ratio = weeklyExpense > 0 ? ((weeklyIncome / weeklyExpense) * 100).toFixed(1) : (weeklyIncome > 0 ? "100+" : "0.0");
    const isSurplus = netCash >= 0;

    // 카드를 깔끔하게 그리기 + 그 아래에 상세 표(Table) 붙이기
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
            <div class="bg-slate-800 text-white p-3 font-bold text-sm">📋 ${member}님의 종목별 주간 현금흐름 요약</div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left whitespace-nowrap">
                    <thead class="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-xs">
                        <tr>
                            <th class="p-3">종목명</th>
                            <th class="p-3 text-right">거치 수량</th>
                            <th class="p-3 text-right">예상 주수입</th>
                            <th class="p-3 text-right">모으기 주지출</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${listRows || '<tr><td colspan="4" class="p-4 text-center text-slate-400">데이터가 없습니다.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    container.innerHTML = uiHtml;
    
    // 차트는 안 쓰기로 했으므로 캔버스 숨김 처리
    const chartArea = document.getElementById('memberCashflowChart');
    if(chartArea) chartArea.parentElement.style.display = 'none';
}
