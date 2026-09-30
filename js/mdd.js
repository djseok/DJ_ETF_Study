// =========================================================
// 📉 실시간 API 연동형 고급 MDD 계산기 (하이브리드 + 전용 GAS 터널 🚀)
// =========================================================

let mddChartInstance = null;

async function runAdvancedMDD() {
    const tickerInputElem = document.getElementById('mdd-ticker-input');
    if (!tickerInputElem) return;
    
    const tickerInput = tickerInputElem.value.trim().toUpperCase();
    let statusMsg = document.getElementById('mdd-status-msg');
    
    // 💡 [버그 수정] HTML에 상태 메시지 창이 누락되었을 경우 자바스크립트가 즉석에서 생성 (Null Safe)
    if (!statusMsg) {
        statusMsg = document.createElement('div');
        statusMsg.id = 'mdd-status-msg';
        statusMsg.className = "text-xs font-semibold text-slate-400 mt-3 flex items-center";
        // 검색창 바로 아래에 안전하게 붙여넣기
        tickerInputElem.parentElement.parentElement.appendChild(statusMsg);
    }

    const resultContainer = document.getElementById('mdd-result-container');
    if (!resultContainer) return;

    if (!tickerInput) {
        statusMsg.innerHTML = "⚠️ 종목 티커를 입력해주세요. (예: NVDA, QLD, 005930)";
        statusMsg.className = "text-xs text-red-500 mt-3 font-bold";
        return;
    }

    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-red-500 mr-1"></i> <b>${tickerInput}</b> 데이터를 분석 중입니다... ⏳`;
    statusMsg.className = "text-xs text-red-600 mt-3 font-bold";
    resultContainer.classList.add('hidden'); 

    try {
        let dates = [];
        let prices = [];
        // 가격 서버(GAS → 야후 파이낸스)에서 5년치 조회. 6자리 코드는 .KS(코스피) → .KQ(코스닥) 순서로 자동 시도
        statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-red-500 mr-1"></i> 전용 구글 서버(GAS) 연결 중... 🛡️`;
        const { data, ticker: foundTicker } = await fetchPriceChart(tickerInput, { range: '5y' }, { timeoutMs: 8000 });
        const isKorean = /\.K[SQ]$/.test(foundTicker);

        const timestamps = data.chart.result[0].timestamp;
        const rawPrices = data.chart.result[0].indicators.quote[0].close;
        for (let i = 0; i < rawPrices.length; i++) {
            if (rawPrices[i] !== null && rawPrices[i] !== undefined) {
                const d = new Date(timestamps[i] * 1000);
                dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
                prices.push(rawPrices[i]);
            }
        }
        statusMsg.innerHTML = `✅ <b>${foundTicker}</b> 분석 완료 (전용 GAS 터널 가동 중 🛡️)`;

        if (prices.length < 2) throw new Error("MDD를 계산하기 위한 데이터가 부족합니다.");

        // 3. 시계열 연산 및 차트 렌더링
        let currentPrice = prices[prices.length - 1];
        let currentDate = dates[dates.length - 1];
        let athPrice = prices[0];
        let athDate = dates[0];
        let maxDrawdown = 0;
        let maxDrawdownDate = dates[0];
        let drawdowns = [];
        let runningMax = prices[0];

        for (let i = 0; i < prices.length; i++) {
            if (prices[i] > runningMax) runningMax = prices[i];
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
        // 한국 종목은 원화(소수점 없음), 해외 종목은 달러(소수점 2자리)로 표시
        const fmtPrice = (v) => isKorean ? `₩${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;

        document.getElementById('mdd-current-price').innerText = fmtPrice(currentPrice);
        document.getElementById('mdd-current-date').innerText = currentDate;
        document.getElementById('mdd-ath-price').innerText = fmtPrice(athPrice);
        document.getElementById('mdd-ath-date').innerText = athDate;

        const ddDisplay = document.getElementById('mdd-current-drawdown');
        const badgeDisplay = document.getElementById('mdd-status-badge');
        const cardDisplay = document.getElementById('mdd-status-card');

        ddDisplay.innerText = `${currentDrawdown.toFixed(2)}%`;

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
        document.getElementById('price-drop-10').innerText = fmtPrice(athPrice * 0.90);
        document.getElementById('price-drop-20').innerText = fmtPrice(athPrice * 0.80);
        document.getElementById('price-drop-30').innerText = fmtPrice(athPrice * 0.70);
        document.getElementById('price-drop-40').innerText = fmtPrice(athPrice * 0.60);

        calculateRecoveryMatrix(prices, drawdowns);
        renderUnderwaterChart(dates, drawdowns, tickerInput);

        statusMsg.className = "text-xs text-green-600 mt-3 font-bold";
        resultContainer.classList.remove('hidden');

    } catch (error) {
        console.error(error);
        statusMsg.innerHTML = `❌ ${error.message}`;
        statusMsg.className = "text-xs text-red-500 mt-3 font-bold";
    }
}

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
                y: { beginAtZero: true, max: 0, ticks: { callback: value => value + '%', font: { weight: 'bold' } } }
            },
            plugins: {
                tooltip: { callbacks: { label: context => `하락률: ${context.parsed.y.toFixed(2)}%` } },
                legend: { display: false }
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('mdd-ticker-input');
    if(input) input.addEventListener('keypress', e => { if (e.key === 'Enter') runAdvancedMDD(); });
});
