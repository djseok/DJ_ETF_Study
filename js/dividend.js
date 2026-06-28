// 전역 변수로 차트 객체 선언 (중복 생성 에러 방지)
let myDivChart = null;

function renderDividendChart(monthlyData, currentMonth) {
    const ctx = document.getElementById('dividendChart');
    if(!ctx) return;

    // 12개월 라벨 배열 생성 (현재 월부터 12월까지)
    let labels = [];
    let chartData = [];
    for(let m = currentMonth; m <= 12; m++) {
        labels.push(m + "월");
        chartData.push(Math.round(monthlyData[m - 1]));
    }

    // 기존 차트가 있으면 폐기하고 새로 그리기
    if(myDivChart) myDivChart.destroy();

    myDivChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '예상 배당금 (₩)',
                data: chartData,
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                borderColor: 'rgba(16, 185, 129, 1)',
                borderWidth: 2,
                borderRadius: 8,
                barPercentage: 0.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'monospace' } } },
                x: { grid: { display: false } }
            }
        }
    });
}

// 💡 기존 calculateExpectedDividends() 함수 맨 마지막 줄에 아래 코드를 쏙 넣어주세요!
// renderDividendChart(monthlyCalendar, currentMonth);
