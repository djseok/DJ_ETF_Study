// =====================================================
// 📈 배당 실수령 시각화 전용 모듈 (V17.0 종목별 분리 및 통합 패치)
// =====================================================

let myDivChart = null; 

// 🔥 차트를 예쁘게 꾸며줄 종목별 자동 할당 컬러 팔레트
const CHART_COLORS = [
    'rgba(54, 162, 235, 0.7)',  // 파랑 (배당다우존스)
    'rgba(255, 99, 132, 0.7)',  // 빨강 (나스닥 커버드콜)
    'rgba(255, 206, 86, 0.7)',  // 노랑 (S&P500 커버드콜)
    'rgba(75, 192, 192, 0.7)',  // 초록
    'rgba(153, 102, 255, 0.7)', // 보라
    'rgba(255, 159, 64, 0.7)'   // 주황
];

// 이미 main.js/port.js에서 배당 데이터를 파싱했으므로 별도의 CSV Fetch 함수는 지웁니다.
// 대신 화면에 데이터를 뿌려주는 메인 컨트롤러 함수를 만듭니다.
function renderActualDividendView() {
    initDividendUserSelector();
    calculateAndDrawDividends();
}

function initDividendUserSelector() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const names = Object.keys(globalParsedUsers);
    
    if(selector.options.length !== names.length && names.length > 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.removeEventListener('change', calculateAndDrawDividends);
        selector.addEventListener('change', calculateAndDrawDividends);
    }
}

// 🔥 개인별 실수령액 계산 및 종목별 차트 분리 함수
function calculateAndDrawDividends() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    
    const targetUser = selector.value || Object.keys(globalParsedUsers)[0];
    if(!targetUser) return;

    let totalReceived = 0;
    let actualLogsHtml = "";
    
    // 종목별 12개월 데이터를 담을 그릇 세팅
    let chartDatasetsByStock = {}; 
    let totalMonthlyCalendar = new Array(12).fill(0); 

    // 배당 내역 최신순 정렬
    let sortedActualLogs = [...globalActualDividendLogs].sort((a,b) => new Date(b.date) - new Date(a.date));

    sortedActualLogs.forEach(log => {
        // 선택한 유저의 데이터만 솎아내기
        if (log.userName.includes(targetUser) || targetUser.includes(log.userName)) {
            totalReceived += log.amount;
            
            // 1. 하단 표(테이블) HTML 생성
            actualLogsHtml += `
                <tr class="hover:bg-blue-50 transition-colors border-b border-blue-50">
                    <td class="px-6 py-4 font-mono text-slate-500 text-xs">${log.date}</td>
                    <td class="px-6 py-4 font-bold text-slate-800 text-xs">${log.stockName}</td>
                    <td class="px-6 py-4 text-right font-black text-blue-600 mono text-base">₩${log.amount.toLocaleString()}</td>
                </tr>
            `;

            // 2. 월별/종목별 차트 데이터 분류 작업
            // 수령일자("2024. 6. 10." 또는 "2024-06-10")에서 '월(Month)'만 추출
            let monthMatch = log.date.match(/\b([1-9]|1[0-2])\b/); 
            if (monthMatch) {
                let mIndex = parseInt(monthMatch[0]) - 1; // 배열은 0부터 시작하므로 -1
                
                // 캘린더용 총합 누적
                totalMonthlyCalendar[mIndex] += log.amount;
                
                // 종목별 차트용 배열 초기화 및 누적
                if (!chartDatasetsByStock[log.stockName]) {
                    chartDatasetsByStock[log.stockName] = new Array(12).fill(0);
                }
                chartDatasetsByStock[log.stockName][mIndex] += log.amount;
            }
        }
    });

    // 💡 화면 텍스트 갱신
    const nameLabel = document.getElementById("actual-received-name-label");
    if(nameLabel) nameLabel.innerText = `[${targetUser}]님의 실수령 배당금 현황`;
    
    const divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = `₩${Math.round(totalReceived).toLocaleString()}`;
    
    const annualPure = document.getElementById("annual-dividend-pure");
    if(annualPure) annualPure.innerText = `₩${Math.round(totalReceived).toLocaleString()}`; // 금년 총 누적액

    const tableBody = document.getElementById("actual-dividend-table-body");
    if(tableBody) tableBody.innerHTML = actualLogsHtml || `<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">배당금 수령 내역이 없습니다.</td></tr>`;

    // 💡 캘린더 블록 그리기
    let calendarHtml = "";
    for (let i = 0; i < 12; i++) {
        let amount = totalMonthlyCalendar[i];
        let monthStr = `${i + 1}월`;
        let isHighMonth = amount > (totalReceived / 12) * 1.5; 
        let bgClass = amount > 0 ? (isHighMonth ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200") : "bg-slate-50 border-slate-100 opacity-60";
        let textClass = amount > 0 ? "text-emerald-700" : "text-slate-400";
        
        calendarHtml += `
            <div class="${bgClass} border rounded-xl p-3 text-center shadow-sm flex flex-col justify-center h-full transition-all">
                <div class="text-xs font-bold text-slate-500 mb-1 flex items-center justify-center">
                    ${monthStr} ${isHighMonth ? '<i class="fas fa-star text-yellow-400 ml-1 text-[10px]"></i>' : ''}
                </div>
                <div class="text-sm md:text-base font-black ${textClass} mono">
                    ${amount > 0 ? '₩' + Math.round(amount).toLocaleString() : '-'}
                </div>
            </div>
        `;
    }
    const calendarDiv = document.getElementById("dividend-calendar");
    if(calendarDiv) calendarDiv.innerHTML = calendarHtml;

    // 💡 종목별 스택(Stacked) 차트 호출
    renderStackedDividendChart(chartDatasetsByStock);
}

// 🔥 차트 렌더링 엔진: 종목별 누적(Stacked) 막대 차트
function renderStackedDividendChart(datasetsByStock) {
    const ctx = document.getElementById('dividendChart');
    if(!ctx) return;

    let labels = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

    let finalDatasets = [];
    let colorIndex = 0;
    
    // 종목별로 색상을 부여하고 데이터셋을 조립합니다.
    for (let stockName in datasetsByStock) {
        let monthlyArray = datasetsByStock[stockName];
        let hasData = monthlyArray.some(val => val > 0);
        
        // 데이터가 존재하는 종목만 차트 범례에 추가
        if (hasData) {
            let chartColor = CHART_COLORS[colorIndex % CHART_COLORS.length];
            finalDatasets.push({
                label: stockName,
                data: monthlyArray,
                backgroundColor: chartColor,
                borderColor: chartColor.replace('0.7', '1'),
                borderWidth: 1,
                borderRadius: 4
            });
            colorIndex++;
        }
    }

    // 기존 차트가 있다면 파괴하고 새로 그림 (초기화)
    if(myDivChart) myDivChart.destroy();

    myDivChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: finalDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: true, 
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 10 } }
                } 
            },
            scales: {
                x: { 
                    stacked: true, // x축 위로 색깔별로 쌓아 올리기
                    grid: { display: false } 
                },
                y: { 
                    stacked: true, // y축 금액 합산 모드
                    beginAtZero: true, 
                    grid: { color
