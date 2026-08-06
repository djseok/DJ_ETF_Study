// 🌐 CSV 데이터 링크
const MASTER_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv";
const PORTFOLIO_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv";

let globalMasterData = [];
let globalPortfolioData = [];
let currentSortKey = 'efficiency';
let currentSortAsc = false; // 내림차순 기본
let cashflowChart = null;

// 🚀 $1 복리 프로젝트 탭 열기 (기존 화면 숨기고 이것만 표시)
function showOneDollarProject() {
    // 기존 대시보드 화면 숨기기 로직 (ID에 맞게 수정 필요)
    // document.getElementById('main-dashboard').style.display = 'none'; 
    document.getElementById('one-dollar-section').style.display = 'block';
    
    // 데이터 최초 1회 로드
    if (globalMasterData.length === 0) {
        loadDollarData();
    }
}

// 탭 전환
function switchDollarTab(tabName) {
    document.getElementById('tab-scanner').style.display = tabName === 'scanner' ? 'block' : 'none';
    document.getElementById('tab-member').style.display = tabName === 'member' ? 'block' : 'none';
}

// 데이터 비동기 Fetch
async function loadDollarData() {
    try {
        const [masterRes, portRes] = await Promise.all([
            fetch(MASTER_DATA_URL),
            fetch(PORTFOLIO_DATA_URL)
        ]);
        
        const masterText = await masterRes.text();
        const portText = await portRes.text();

        globalMasterData = parseCSV(masterText);
        globalPortfolioData = parseCSV(portText);

        renderDollarTable();
        populateMemberSelect();
    } catch (error) {
        console.error("데이터 로딩 실패:", error);
    }
}

// 간단한 CSV 파서 (첫 줄을 key로 사용)
function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',');
        let obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] ? values[i].trim() : '';
        });
        return obj;
    });
}

// 🔍 1. 스캐너 테이블 렌더링
function renderDollarTable() {
    const tbody = document.getElementById('dollar-table-body');
    tbody.innerHTML = '';

    const filterLimit = document.getElementById('filter-limit').checked;
    const filterDecimal = document.getElementById('filter-decimal').checked;

    // 데이터 가공 및 필터링
    let filteredData = globalMasterData.map(row => {
        const price = parseFloat(row['주가']) || 0;
        const divDollar = parseFloat(row['최근4주 평균 분배금(달러)']) || 0;
        // 세후 15% 공제 적용 및 1달러당 효율 계산
        const afterTaxDiv = divDollar * 0.85;
        const efficiency = price > 0 ? (afterTaxDiv / price) : 0;
        
        return {
            ticker: row['종목이름'] || row['티커'],
            price: price,
            efficiency: efficiency,
            efficiency_krw: efficiency * 1420, // 환율 하드코딩 또는 변수 연동
            limit: row['구매제한'],
            decimal: row['소수점가능']
        };
    });

    if (filterLimit) filteredData = filteredData.filter(d => d.limit === 'X');
    if (filterDecimal) filteredData = filteredData.filter(d => d.decimal === 'O');

    // 정렬 로직
    filteredData.sort((a, b) => {
        let valA = a[currentSortKey];
        let valB = b[currentSortKey];
        return currentSortAsc ? valA - valB : valB - valA;
    });

    // 화면 그리기
    filteredData.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${item.ticker}</strong></td>
            <td>$${item.price.toFixed(2)}</td>
            <td style="color:red; font-weight:bold;">$${item.efficiency.toFixed(5)}</td>
            <td style="color:blue;">${item.efficiency_krw.toFixed(1)}원</td>
            <td>${item.limit}</td>
            <td>${item.decimal}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 정렬 클릭 이벤트
function sortDollarTable(key) {
    if (currentSortKey === key) {
        currentSortAsc = !currentSortAsc;
    } else {
        currentSortKey = key;
        currentSortAsc = false;
    }
    renderDollarTable();
}

// 👥 2. 멤버별 자급자족 대시보드
function populateMemberSelect() {
    const select = document.getElementById('member-select');
    // 중복 없는 멤버 이름 추출
    const members = [...new Set(globalPortfolioData.map(d => d['투자자']).filter(v => v))];
    
    members.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        option.textContent = member;
        select.appendChild(option);
    });
}

function renderMemberDashboard() {
    const member = document.getElementById('member-select').value;
    if (member === 'all') return;

    // 해당 멤버의 포트폴리오 추출
    const memberPort = globalPortfolioData.filter(d => d['투자자'] === member);
    
    let weeklyIncome = 0;
    let weeklyExpense = 0;

    // 시트의 컬럼명에 맞춰 수정 필요 ('거치수량', '일일모으기금액($)' 등)
    memberPort.forEach(row => {
        const ticker = row['종목이름'] || row['티커'];
        const holdQty = parseFloat(row['보유수량']) || 0;
        const dailyBuy = parseFloat(row['모으기금액']) || 0;

        // 마스터 데이터에서 배당금 찾기
        const masterItem = globalMasterData.find(m => m['종목이름'] === ticker || m['티커'] === ticker);
        if (masterItem) {
            const divDollar = parseFloat(masterItem['최근4주 평균 분배금(달러)']) || 0;
            const afterTaxDiv = divDollar * 0.85;
            weeklyIncome += (holdQty * afterTaxDiv);
        }
        
        // 지출 (주 5일 매수 기준)
        weeklyExpense += (dailyBuy * 5);
    });

    const netCash = weeklyIncome - weeklyExpense;
    const ratio = weeklyExpense > 0 ? ((weeklyIncome / weeklyExpense) * 100).toFixed(1) : 0;

    // 요약 카드 렌더링
    document.getElementById('member-dashboard-cards').innerHTML = `
        <div style="padding:15px; background:#e8f5e9; border-radius:8px;">
            <h4>📈 주간 배당 수입</h4>
            <h2>$${weeklyIncome.toFixed(2)}</h2>
        </div>
        <div style="padding:15px; background:#ffebee; border-radius:8px;">
            <h4>💸 주간 모으기 지출</h4>
            <h2>$${weeklyExpense.toFixed(2)}</h2>
        </div>
        <div style="padding:15px; background:${netCash >= 0 ? '#e3f2fd' : '#fff3e0'}; border-radius:8px;">
            <h4>${netCash >= 0 ? '🔥 순수 흑자' : '⚠️ 부족 금액'}</h4>
            <h2>$${Math.abs(netCash).toFixed(2)}</h2>
            <p>자급자족률: <strong>${ratio}%</strong></p>
        </div>
    `;

    // Chart.js 그래프 렌더링
    drawCashflowChart(weeklyIncome, weeklyExpense);
}

function drawCashflowChart(income, expense) {
    const ctx = document.getElementById('memberCashflowChart').getContext('2d');
    
    if (cashflowChart) cashflowChart.destroy(); // 기존 차트 초기화

    cashflowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['주간 자금 흐름 ($)'],
            datasets: [
                {
                    label: '주간 배당 수입',
                    data: [income],
                    backgroundColor: 'rgba(76, 175, 80, 0.7)',
                    borderColor: 'rgba(76, 175, 80, 1)',
                    borderWidth: 1
                },
                {
                    label: '주간 모으기 지출',
                    data: [expense],
                    backgroundColor: 'rgba(244, 67, 54, 0.7)',
                    borderColor: 'rgba(244, 67, 54, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}
