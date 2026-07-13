// ==========================================
// 📉 고급 실시간 MDD 시뮬레이터 엔진 (mddcalc.com 클론)
// ==========================================

let mddChartInstance = null;

async function runAdvancedMDD() {
    const tickerInput = document.getElementById('mdd-ticker-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('mdd-status-msg');
    const resultContainer = document.getElementById('mdd-result-container');

    if (!tickerInput) {
        statusMsg.innerHTML = "⚠️ 종목 티커를 입력해주세요.";
        statusMsg.className = "text-xs text-red-500 mt-2 font-bold";
        return;
    }

    // 로딩 시작
    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-blue-500"></i> ${tickerInput}의 과거 데이터를 로드하고 분석 중입니다...`;
    statusMsg.className = "text-xs text-blue-600 mt-2 font-bold";
    resultContainer.classList.add('hidden'); // 계산 전까지 결과창 숨김

    try {
        // 5년치 일봉 데이터 호출 (야후 파이낸스)
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${tickerInput}?range=5y&interval=1d`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error("서버 응답 오류");
        
        const data = await response.json();
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) throw new Error("종목 없음");

        const timestamps = data.chart.result[0].timestamp;
        const quote = data.chart.result[0].indicators.quote[0];
        // mddcalc는 보통 고가(High)를 기준으로 하거나 종가(Close)를 씁니다. 여기선 보수적으로 Close 사용.
        const rawPrices = quote.close; 

        let dates = [];
        let prices = [];
        
        // 데이터 정제 (null 제거 및 날짜 변환)
        for(let i = 0; i < rawPrices.length; i++) {
            if(rawPrices[i] !== null) {
                const d = new Date(timestamps[i] * 1000);
                dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
                prices.push(rawPrices[i]);
            }
        }

        if (prices.length < 2) throw new Error("데이터 부족");

        // --- 핵심 통계 계산 로직 ---
        let currentPrice = prices[prices.length - 1];
        let currentDate = dates[dates.length - 1];
        
        let athPrice = prices[0];
        let athDate = dates[0];
        
        let maxDrawdown = 0;
        let maxDrawdownDate = dates[0];
        
        let drawdowns = [];
        let runningMax = prices[0];

        for (let i = 0; i < prices.length; i++) {
            // 전고점(ATH) 갱신 기록
            if (prices[i] > runningMax) {
                runningMax = prices[i];
            }
            if (prices[i] > athPrice) {
                athPrice = prices[i];
                athDate = dates[i];
            }
            
            // 하락률 계산
            const currentDD = ((prices[i] - runningMax) / runningMax) * 100;
            drawdowns.push(currentDD);
            
            // 최대 낙폭 기록
            if (currentDD < maxDrawdown) {
                maxDrawdown = currentDD;
                maxDrawdownDate = dates[i];
            }
        }

        let currentDrawdown = ((currentPrice - athPrice) / athPrice) * 100;

        // --- UI 업데이트 (DOM 조작) ---
        document.getElementById('mdd-current-price').innerText = `$${currentPrice.toFixed(2)}`;
        document.getElementById('mdd-current-date').innerText = currentDate;
        
        document.getElementById('mdd-ath-price').innerText = `$${athPrice.toFixed(2)}`;
        document.getElementById('mdd-ath-date').innerText = athDate;

        const ddDisplay = document.getElementById('mdd-current-drawdown');
        const badgeDisplay = document.getElementById('mdd-status-badge');
        const cardDisplay = document.getElementById('mdd-status-card');

        ddDisplay.innerText = `${currentDrawdown.toFixed(2)}%`;

        // 상태 뱃지 판별 로직
        if(currentDrawdown >= -5) {
            badgeDisplay.innerText = "🙂 소폭 조정 (안정권)";
            cardDisplay.className = "bg-green-50 p-5 rounded-2xl shadow-sm border border-green-200 text-center";
            ddDisplay.className = "text-4xl font-black text-green-600 font-mono";
            document.querySelector('#mdd-status-card .text-sm').className = "text-sm font-bold text-green-600 mb-1";
        } else if (currentDrawdown >= -15) {
            badgeDisplay.innerText = "🟡 단기 조정 구간";
            cardDisplay.className = "bg-yellow-50 p-5 rounded-2xl shadow-sm border border-yellow-200 text-center";
            ddDisplay.className = "text-4xl font-black text-yellow-600 font-mono";
            document.querySelector('#mdd-status-card .text-sm').className = "text-sm font-bold text-yellow-600 mb-1";
        } else if (currentDrawdown >= -30) {
            badgeDisplay.innerText = "🟠 약세장 진입 (분할 매수)";
            cardDisplay.className = "bg-orange-50 p-5 rounded-2xl shadow-sm border border-orange-200 text-center";
            ddDisplay.className = "text-4xl font-black text-orange-600 font-mono";
            document.querySelector('#mdd-status-card .text-sm').className = "text-sm font-bold text-orange-600 mb-1";
        } else {
            badgeDisplay.innerText = "🔥 역대급 폭락 (기업가치 점검)";
            cardDisplay.className = "bg-red-50 p-5 rounded-2xl shadow-sm border border-red-200 text-center";
            ddDisplay.className = "text-4xl font-black text-red-600 font-mono";
            document.querySelector('#mdd-status-card .text-sm').className = "text-sm font-bold text-red-600 mb-1";
        }

        // 주요 통계창 업데이트
        document.getElementById('stat-max-dd').innerText = `${maxDrawdown.toFixed(2)}%`;
        document.getElementById('stat-max-date').innerText = maxDrawdownDate;
        document.getElementById('stat-start-date').innerText = dates[0];
        document.getElementById('stat-total-days').innerText = `${prices.length.toLocaleString()}일`;

        // 할인 가격표 업데이트
        document.getElementById('price-drop-10').innerText = `$${(athPrice * 0.90).toFixed(2)}`;
        document.getElementById('price-drop-20').innerText = `$${(athPrice * 0.80).toFixed(2)}`;
        document.getElementById('price-drop-30').innerText = `$${(athPrice * 0.70).toFixed(2)}`;
        document.getElementById('price-drop-40').innerText = `$${(athPrice * 0.60).toFixed(2)}`;

        // 성공 메시지 및 결과창 표시
        statusMsg.innerHTML = `✅ ${tickerInput} 데이터 ${prices.length}일치 로드 완료!`;
        statusMsg.className = "text-xs text-green-600 mt-2 font-bold";
        resultContainer.classList.remove('hidden');

        // 차트 그리기
        renderUnderwaterChart(dates, drawdowns, tickerInput);

    } catch (error) {
        console.error(error);
        statusMsg.innerHTML = `❌ 데이터를 불러오지 못했습니다. 티커명을 확인해주세요.`;
        statusMsg.className = "text-xs text-red-500 mt-2 font-bold";
    }
}

function renderUnderwaterChart(dates, drawdowns, ticker) {
    const ctx = document.getElementById('mddChartCanvas').getContext('2d');
    if (mddChartInstance) mddChartInstance.destroy();

    mddChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '고점 대비 하락률 (%)',
                data: drawdowns,
                borderColor: 'rgba(239, 68, 68, 0.8)',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                borderWidth: 1.5,
                fill: true,
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } },
                y: { 
                    beginAtZero: true, 
                    max: 0, 
                    ticks: { callback: value => value + '%' } 
                }
            },
            plugins: {
                tooltip: { callbacks: { label: context => `하락률: ${context.parsed.y.toFixed(2)}%` } },
                legend: { display: false }
            }
        }
    });
}

// 엔터키 지원
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('mdd-ticker-input');
    if(input) input.addEventListener('keypress', e => { if (e.key === 'Enter') runAdvancedMDD(); });
});
