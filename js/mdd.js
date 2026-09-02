// =========================================================
// 📉 실시간 API 연동형 고급 MDD 및 구간 회복률 계산 엔진
// =========================================================

let mddChartInstance = null; // Chart.js 인스턴스 초기화용

async function runAdvancedMDD() {
    const tickerInput = document.getElementById('mdd-ticker-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('mdd-status-msg');
    const resultContainer = document.getElementById('mdd-result-container');

    if (!tickerInput) {
        statusMsg.innerHTML = "⚠️ 종목 티커를 입력해주세요. (예: QQQ, SPY)";
        statusMsg.className = "text-xs text-red-500 mt-2 font-bold";
        return;
    }

    // 로딩 UI 시작
    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-blue-500"></i> <b>${tickerInput}</b> 데이터를 분석 중입니다. 최적의 데이터 터널을 찾는 중... ⏳`;
    statusMsg.className = "text-xs text-blue-600 mt-2 font-bold";
    resultContainer.classList.add('hidden'); 

    try {
        // 1. 야후 파이낸스 5년치 일봉 데이터 호출
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${tickerInput}?range=5y&interval=1d`;
        
        // 💡 핵심: 무적의 다중 프록시 (Fallback) 배열
        const proxies = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
            `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
            `https://thingproxy.freeboard.io/fetch/${targetUrl}`
        ];

        let data = null;

        // 프록시 서버가 막히면 다음 서버로 자동 재시도
        for (let proxy of proxies) {
            try {
                const response = await fetch(proxy);
                if (response.ok) {
                    data = await response.json();
                    break; // 성공하면 즉시 루프 탈출
                }
            } catch (e) {
                console.warn(`[프록시 터널 막힘] 다음 서버로 자동 우회합니다: ${proxy}`);
                continue;
            }
        }

        // 모든 프록시가 차단되었을 경우의 예외 처리
        if (!data) throw new Error("서버 응답 실패: 현재 사용 가능한 모든 무료 데이터 터널이 혼잡합니다.");
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) throw new Error("종목 없음");

        const timestamps = data.chart.result[0].timestamp;
        const quote = data.chart.result[0].indicators.quote[0];
        const rawPrices = quote.close; 

        let dates = [];
        let prices = [];
        
        // 데이터 정제 (null 제거)
        for(let i = 0; i < rawPrices.length; i++) {
            if(rawPrices[i] !== null && rawPrices[i] !== undefined) {
                const d = new Date(timestamps[i] * 1000);
                dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
                prices.push(rawPrices[i]);
            }
        }

        if (prices.length < 2) throw new Error("데이터 부족");

        // 2. 기본 시계열 연산 (ATH, MDD 추출)
        let currentPrice = prices[prices.length - 1];
        let currentDate = dates[dates.length - 1];
        
        let athPrice = prices[0];
        let athDate = dates[0];
        
        let maxDrawdown = 0;
        let maxDrawdownDate = dates[0];
        
        let drawdowns = [];
        let runningMax = prices[0];

        for (let i = 0; i < prices.length; i++) {
            if (prices[i] > runningMax) {
                runningMax = prices[i];
            }
            if (prices[i] > athPrice) {
                athPrice = prices[i];
                athDate = dates[i];
            }
            
            const currentDD = ((prices[i] - runningMax) / runningMax) * 100;
            drawdowns.push(currentDD);
            
            if (currentDD < maxDrawdown) {
                maxDrawdown = currentDD;
                maxDrawdownDate = dates[i];
            }
        }

        let currentDrawdown = ((currentPrice - athPrice) / athPrice) * 100;

        // 3. UI 텍스트 꽂아넣기
        document.getElementById('mdd-current-price').innerText = `$${currentPrice.toFixed(2)}`;
        document.getElementById('mdd-current-date').innerText = currentDate;
        document.getElementById('mdd-ath-price').innerText = `$${athPrice.toFixed(2)}`;
        document.getElementById('mdd-ath-date').innerText = athDate;

        const ddDisplay = document.getElementById('mdd-current-drawdown');
        const badgeDisplay = document.getElementById('mdd-status-badge');
        const cardDisplay = document.getElementById('mdd-status-card');

        ddDisplay.innerText = `${currentDrawdown.toFixed(2)}%`;

        // 상태 조건부 컬러링
        if(currentDrawdown >= -5) {
            badgeDisplay.innerText = "🙂 소폭 조정 (안정권)";
            cardDisplay.className = "bg-green-50 p-5 rounded-2xl shadow-sm border border-green-200 flex flex-col justify-center items-center";
            ddDisplay.className = "text-4xl font-black text-green-600 font-mono tracking-tighter drop-shadow-sm";
        } else if (currentDrawdown >= -15) {
            badgeDisplay.innerText = "🟡 단기 조정 구간";
            cardDisplay.className = "bg-yellow-50 p-5 rounded-2xl shadow-sm border border-yellow-200 flex flex-col justify-center items-center";
            ddDisplay.className = "text-4xl font-black text-yellow-600 font-mono tracking-tighter drop-shadow-sm";
        } else if (currentDrawdown >= -30) {
            badgeDisplay.innerText = "🟠 약세장 진입 (분할 매수)";
            cardDisplay.className = "bg-orange-50 p-5 rounded-2xl shadow-sm border border-orange-200 flex flex-col justify-center items-center";
            ddDisplay.className = "text-4xl font-black text-orange-600 font-mono tracking-tighter drop-shadow-sm";
        } else {
            badgeDisplay.innerText = "🔥 역대급 폭락 (기회 포착)";
            cardDisplay.className = "bg-red-50 p-5 rounded-2xl shadow-sm border border-red-200 flex flex-col justify-center items-center";
            ddDisplay.className = "text-4xl font-black text-red-600 font-mono tracking-tighter drop-shadow-sm";
        }

        document.getElementById('stat-max-dd').innerText = `${maxDrawdown.toFixed(2)}%`;
        document.getElementById('stat-max-date').innerText = maxDrawdownDate;
        document.getElementById('stat-start-date').innerText = dates[0];
        document.getElementById('stat-total-days').innerText = `${prices.length.toLocaleString()}일`;

        document.getElementById('price-drop-10').innerText = `$${(athPrice * 0.90).toFixed(2)}`;
        document.getElementById('price-drop-20').innerText = `$${(athPrice * 0.80).toFixed(2)}`;
        document.getElementById('price-drop-30').innerText = `$${(athPrice * 0.70).toFixed(2)}`;
        document.getElementById('price-drop-40').innerText = `$${(athPrice * 0.60).toFixed(2)}`;

        // 4. 구간별 회복률 가동
        calculateRecoveryMatrix(prices, drawdowns);

        // 5. 차트 렌더링
        renderUnderwaterChart(dates, drawdowns, tickerInput);

        statusMsg.innerHTML = `✅ <b>${tickerInput}</b> 분석 완료 (최신 시세 동기화)`;
        statusMsg.className = "text-xs text-green-600 mt-2 font-bold";
        resultContainer.classList.remove('hidden');

    } catch (error) {
        console.error(error);
        statusMsg.innerHTML = `❌ ${error.message}`;
        statusMsg.className = "text-xs text-red-500 mt-2 font-bold";
    }
}

// 📊 [구간별 회복률] 동적 연산 및 테이블 생성 함수
function calculateRecoveryMatrix(prices, drawdowns) {
    const totalDays = prices.length;
    const levels = [-5, -10, -15, -20, -25, -30, -35, -40, -45, -50];
    let html = "";

    levels.forEach(level => {
        let reachedCount = 0;   
        let recoveredCount = 0; 

        for (let i = 0; i < totalDays; i++) {
            if (drawdowns[i] <= level) {
                reachedCount++;
                let isRecovered = false;
                let localMax = prices[0];
                for(let k = 0; k <= i; k++) {
                    if(prices[k] > localMax) localMax = prices[k];
                }

                for (let j = i + 1; j < totalDays; j++) {
                    if (prices[j] >= localMax) {
                        isRecovered = true;
                        break;
                    }
                }
                if (isRecovered) recoveredCount++;
            }
        }

        const pctOfTotal = totalDays > 0 ? (reachedCount / totalDays) * 100 : 0;
        const recoveryRate = reachedCount > 0 ? (recoveredCount / reachedCount) * 100 : 0;

        let barColor = "bg-blue-500";
        if (recoveryRate < 100) barColor = "bg-orange-500";
        if (reachedCount === 0) barColor = "bg-slate-300";

        let rateText = reachedCount > 0 ? `${recoveryRate.toFixed(0)}%` : "0% (미도달)";
        if (reachedCount > 0 && recoveryRate === 100) rateText = "100% 👑";

        html += `
            <tr class="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                <td class="px-4 py-3 text-center font-black text-slate-700 bg-slate-50/50">${level}%</td>
                <td class="px-4 py-3 text-right font-mono font-bold">${reachedCount}일</td>
                <td class="px-4 py-3 text-right font-mono text-slate-500">${pctOfTotal.toFixed(1)}%</td>
                <td class="px-4 py-3 text-center font-black ${recoveryRate === 100 ? 'text-blue-600' : 'text-slate-700'}">${rateText}</td>
                <td class="px-4 py-3">
                    <div class="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200 shadow-inner">
                        <div class="${barColor} h-3 rounded-full transition-all duration-1000" style="width: ${reachedCount > 0 ? recoveryRate : 0}%"></div>
                    </div>
                </td>
            </tr>
        `;
    });

    document.getElementById('recovery-table-body').innerHTML = html;
}

// 🎨 차트 생성 소스
function renderUnderwaterChart(dates, drawdowns, ticker) {
    const ctx = document.getElementById('mddChartCanvas').getContext('2d');
    if (mddChartInstance) mddChartInstance.destroy();

    mddChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '하락률 (%)',
                data: drawdowns,
                borderColor: 'rgba(239, 68, 68, 0.8)',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
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
                x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { weight: 'bold' } } },
                y: { 
                    beginAtZero: true, 
                    max: 0, 
                    ticks: { callback: value => value + '%', font: { weight: 'bold' } } 
                }
            },
            plugins: {
                tooltip: { callbacks: { label: context => `하락률: ${context.parsed.y.toFixed(2)}%` } },
                legend: { display: false }
            }
        }
    });
}

// 엔터 키 연동
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('mdd-ticker-input');
    if(input) input.addEventListener('keypress', e => { if (e.key === 'Enter') runAdvancedMDD(); });
});
