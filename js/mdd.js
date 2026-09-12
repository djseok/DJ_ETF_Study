// =========================================================
// 📉 실시간 API 연동형 고급 MDD 및 구간 회복률 계산 엔진 (야후 파이낸스 + 다중 프록시 터널)
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
    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-blue-500"></i> <b>${tickerInput}</b> 데이터를 분석 중입니다. 최적의 무료 데이터 터널을 찾는 중... ⏳`;
    statusMsg.className = "text-xs text-blue-600 mt-2 font-bold";
    resultContainer.classList.add('hidden'); 

    try {
        // 한국 주식 코드 입력 시 야후 파이낸스 규격(.KS)으로 자동 변환
        let queryTicker = tickerInput;
        if (/^\d{6}$/.test(tickerInput)) queryTicker = tickerInput + ".KS";

        // 1. 야후 파이낸스 5년치(1d 간격) 데이터 호출 URL
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${queryTicker}?range=5y&interval=1d`;
        
        // 2. RSI 모듈과 동일한 무적의 다중 프록시 (Fallback) 배열
        const proxies = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
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
                    break;
                }
            } catch (e) {
                console.warn(`[프록시 터널 막힘] 다음 서버로 자동 우회합니다: ${proxy}`);
                continue;
            }
        }

        if (!data) throw new Error("서버 응답 실패: 현재 사용 가능한 모든 무료 데이터 터널이 혼잡합니다.");
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) throw new Error("종목을 찾을 수 없거나 데이터가 없습니다.");

        const timestamps = data.chart.result[0].timestamp;
        const quote = data.chart.result[0].indicators.quote[0];
        
        // 야후 파이낸스는 종가를 순서대로 배열로 제공
        const rawPrices = quote.close; 

        let dates = [];
        let prices = [];
        
        // 데이터 정제 (null 제거 및 날짜 포맷팅)
        for(let i = 0; i < rawPrices.length; i++) {
            if(rawPrices[i] !== null && rawPrices[i] !== undefined) {
                const d = new Date(timestamps[i] * 1000);
                dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
                prices.push(rawPrices[i]);
            }
        }

        if (prices.length < 2) throw new Error("MDD를 계산하기 위한 데이터가 부족합니다.");

        // 3. 기본 시계열 연산 (ATH, MDD 추출)
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

        // 4. UI 텍스트 꽂아넣기
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

        // 5. 🔥 핵심: 구간별 회복률 고급 알고리즘 가동
        calculateRecoveryMatrix(prices, drawdowns);

        // 6. 차트 렌더링
        renderUnderwaterChart(dates, drawdowns, tickerInput);

        statusMsg.innerHTML = `✅ <b>${tickerInput}</b> 분석 완료 (다중 프록시 터널 가동 중)`;
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
