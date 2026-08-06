// 🌐 1달러 복리 프로젝트 전용 로직

// 구글 시트 CSV 링크 (동진님이 주신 주소)
const DOLLAR_MASTER_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv";
const DOLLAR_PORT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv";

let globalDollarMaster = [];
let globalDollarPort = [];
let currentDollarSortKey = 'efficiency'; // 기본 정렬 기준: 1달러 배당효율
let currentDollarSortAsc = false; // 기본: 내림차순(가장 높은게 위로)
let dollarCashflowChart = null; // 차트 객체 담을 변수

// 기존 main.js의 switchTab과 연동되도록 버튼 색상을 복원하는 커스텀 함수 추가
function resetAllTabButtons() {
    const tabs = ['btnTabQuant', 'btnTabPort', 'btnTabCalc', 'btnTabDiv', 'btnTabMdd', 'btnTabRsi', 'btnTabOneDollar'];
    tabs.forEach(tabId => {
        const btn = document.getElementById(tabId);
        if (btn) {
            btn.classList.remove('bg-slate-800', 'text-white');
            btn.classList.add('bg-white');
            if (tabId === 'btnTabOneDollar') {
                btn.classList.add('text-yellow-700');
            } else {
                btn.classList.add('text-slate-600');
            }
        }
    });
}

// 오버라이딩하여 $1 탭 처리 (기존 main.js 로직을 깨지 않기 위함)
const originalSwitchTab = typeof switchTab === 'function' ? switchTab : function(){};
window.switchTab = function(tabName) {
    // 기존 로직 실행
    if(tabName !== 'oneDollar') {
        originalSwitchTab(tabName);
        document.getElementById('viewOneDollar').classList.add('hidden');
        document.getElementById('viewOneDollar').classList.remove('block');
        return;
    }

    // $1 탭 전용 화면 전환 로직
    const views = ['viewQuant', 'viewPort', 'viewCalc', 'viewDiv', 'viewMdd', 'viewRsi'];
    views.forEach(v => {
        if(document.getElementById(v)) {
            document.getElementById(v).classList.add('hidden');
            document.getElementById(v).classList.remove('block');
        }
    });

    document.getElementById('viewOneDollar').classList.remove('hidden');
    document.getElementById('viewOneDollar').classList.add('block');
    
    resetAllTabButtons();
    const activeBtn = document.getElementById('btnTabOneDollar');
    activeBtn.classList.remove('bg-white', 'text-yellow-700');
    activeBtn.classList.add('bg-slate-800', 'text-white');
};

// 서브 탭 전환 로직
function switchDollarSubTab(tabName) {
    const btnScan = document.getElementById('btnDollarScanner');
    const btnMem = document.getElementById('btnDollarMember');
    const viewScan = document.getElementById('tab-dollar-scanner');
    const viewMem = document.getElementById('tab-dollar-member');

    if (tabName === 'scanner') {
        btnScan.className = "px-4 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm shadow-sm transition-all";
        btnMem.className = "px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-200 shadow-sm transition-all";
        viewScan.classList.remove('hidden');
        viewScan.classList.add('block');
        viewMem.classList.remove('block');
        viewMem.classList.add('hidden');
    } else {
        btnMem.className = "px-4 py-2 bg-slate-800 text-white rounded-lg font-bold text-sm shadow-sm transition-all";
        btnScan.className = "px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-200 shadow-sm transition-all";
        viewMem.classList.remove('hidden');
        viewMem.classList.add('block');
        viewScan.classList.remove('block');
        viewScan.classList.add('hidden');
    }
}

// CSV 간단 파서
function parseSimpleCSV(text) {
    const lines = text.split('\n').filter(l => l.trim() !== '');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        // 쉼표 안에 따옴표 처리 등의 복잡한 정규식 대비용
        const values = line.split(',');
        let obj = {};
        headers.forEach((h, i) => {
            obj[h] = values[i] ? values[i].trim() : '';
        });
        return obj;
    });
}

// 데이터 통합 로딩
async function loadDollarData() {
    if (globalDollarMaster.length > 0) return; // 이미 로딩되었으면 스킵
    
    try {
        const [masterRes, portRes] = await Promise.all([
            fetch(DOLLAR_MASTER_URL),
            fetch(DOLLAR_PORT_URL)
        ]);
        
        globalDollarMaster = parseSimpleCSV(await masterRes.text());
        globalDollarPort = parseSimpleCSV(await portRes.text());

        renderDollarTable();
        populateDollarMemberSelect();
    } catch (error) {
        console.error("$1 데이터 로딩 에러:", error);
        document.getElementById('dollar-table-body').innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 font-bold">데이터를 불러오는 중 오류가 발생했습니다. 구글 시트 공유 상태를 확인하세요.</td></tr>`;
    }
}

// 🔍 1. 생산성 스캐너 렌더링
function renderDollarTable() {
    const tbody = document.getElementById('dollar-table-body');
    const isLimitFilter = document.getElementById('filter-limit').checked;
    const isDecimalFilter = document.getElementById('filter-decimal').checked;

    // 데이터 정제
    let tableData = globalDollarMaster.map(row => {
        const price = parseFloat(row['주가']) || 0;
        const rawDiv = parseFloat(row['최근4주 평균 분배금(달러)']) || 0;
        const afterTaxDiv = rawDiv * 0.85; // 세후 15% 적용
        
        const efficiency = price > 0 ? (afterTaxDiv / price) : 0;
        const fxRate = 1420; // 현재 고정 환율. 필요시 실시간 API 연동 가능
        const efficiency_krw = efficiency * fxRate;

        return {
            ticker: row['종목이름'] || row['티커'],
            price: price,
            efficiency: efficiency,
            efficiency_krw: efficiency_krw,
            limit: row['구매제한'] || '-',
            decimal: row['소수점가능'] || '-'
        };
    }).filter(d => d.ticker && d.price > 0);

    // 체크박스 필터링
    if (isLimitFilter) tableData = tableData.filter(d => d.limit === 'X');
    if (isDecimalFilter) tableData = tableData.filter(d => d.decimal === 'O');

    // 오름차순/내림차순 정렬
    tableData.sort((a, b) => {
        let valA = a[currentDollarSortKey];
        let valB = b[currentDollarSortKey];
        return currentDollarSortAsc ? valA - valB : valB - valA;
    });

    // 화면 표출
    tbody.innerHTML = '';
    tableData.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors";
        
        // 상위 3위는 왕관 아이콘 표시
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
    if (currentDollarSortKey === key) {
        currentDollarSortAsc = !currentDollarSortAsc;
    } else {
        currentDollarSortKey = key;
        currentDollarSortAsc = false; // 새 항목 누르면 항상 내림차순(가장 좋은것부터)
    }
    renderDollarTable();
}

// 👥 2. 멤버별 자급자족 현황판
function populateDollarMemberSelect() {
    const select = document.getElementById('member-select');
    // 헤더 이름 확인 (동진님 시트에 맞게 '투자자' 또는 '이름' 등 매칭)
    let userKey = Object.keys(globalDollarPort[0] || {}).find(k => k.includes('투자자') || k.includes('이름')) || '투자자';
    
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

    let userKey = Object.keys(globalDollarPort[0] || {}).find(k => k.includes('투자자') || k.includes('이름')) || '투자자';
    const myPort = globalDollarPort.filter(d => d[userKey] === member);

    let weeklyIncome = 0;
    let weeklyExpense = 0;

    myPort.forEach(row => {
        // 시트 헤더명이 동진님 시트에 어떻게 적혀있는지 추론 (유연하게 대처)
        const ticker = row['종목이름'] || row['티커'] || row['종목'] || '';
        const holdQty = parseFloat(row['보유수량'] || row['거치수량'] || 0);
        const dailyBuy = parseFloat(row['모으기금액'] || row['일일모으기'] || row['일일모으기금액($)'] || 0);

        // 마스터 데이터에서 배당 화력 찾기
        const masterItem = globalDollarMaster.find(m => (m['종목이름'] || m['티커']) === ticker);
        if (masterItem) {
            const rawDiv = parseFloat(masterItem['최근4주 평균 분배금(달러)']) || 0;
            weeklyIncome += (holdQty * rawDiv * 0.85); // 세후 수입 누적
        }

        // 지출 (주 5일 장 기준)
        weeklyExpense += (dailyBuy * 5);
    });

    const netCash = weeklyIncome - weeklyExpense;
    const ratio = weeklyExpense > 0 ? ((weeklyIncome / weeklyExpense) * 100).toFixed(1) : (weeklyIncome > 0 ? "100+" : "0.0");
    const isSurplus = netCash >= 0;

    // 요약 카드 표출
    const cardHtml = `
        <div class="bg-gradient-to-br from-green-50 to-emerald-100 p-5 rounded-2xl border border-green-200 shadow-sm">
            <div class="text-xs font-bold text-green-700 mb-1">📈 주간 공짜 배당 수입</div>
            <div class="text-3xl font-black text-green-800 font-mono">$${weeklyIncome.toFixed(2)}</div>
        </div>
        <div class="bg-gradient-to-br from-red-50 to-rose-100 p-5 rounded-2xl border border-red-200 shadow-sm">
            <div class="text-xs font-bold text-red-700 mb-1">💸 주간 모으기 총 지출</div>
            <div class="text-3xl font-black text-red-800 font-mono">$${weeklyExpense.toFixed(2)}</div>
        </div>
        <div class="bg-gradient-to-br ${isSurplus ? 'from-blue-50 to-indigo-100 border-blue-200' : 'from-orange-50 to-amber-100 border-orange-200'} p-5 rounded-2xl border shadow-sm">
            <div class="text-xs font-bold ${isSurplus ? 'text-blue-700' : 'text-orange-700'} mb-1">
                ${isSurplus ? '🔥 무자본 자급자족 달성!' : '⚠️ 지출 초과 (예수금 방어 필요)'}
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
            labels: ['주간 자금 흐름 리포트'],
            datasets: [
                {
                    label: '주간 배당 수입 ($)',
                    data: [income],
                    backgroundColor: 'rgba(16, 185, 129, 0.8)', // Emerald
                    borderRadius: 8,
                    barPercentage: 0.4
                },
                {
                    label: '주간 모으기 지출 ($)',
                    data: [expense],
                    backgroundColor: 'rgba(239, 68, 68, 0.8)', // Red
                    borderRadius: 8,
                    barPercentage: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { family: 'Pretendard', weight: 'bold' } } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
            }
        }
    });
}
