// =========================================================
// 🧠 Explainable Quant Engine: Pullback + Trend Following (Chart Integration)
// =========================================================

let quantChartInstance = null; // 통합 차트 인스턴스
let currentQuantData = null;   // 체크박스 필터링 시 재사용할 메모리 캐시

async function runQuantAnalysis() {
    const tickerInput = document.getElementById('quant-ticker-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('quant-status-msg');
    const resultContainer = document.getElementById('quant-result-container');

    if (!tickerInput) return;

    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500 mr-1"></i> <b>${tickerInput}</b> 과거 시계열 데이터 및 지표를 연산 중입니다...`;
    resultContainer.classList.add('hidden');

    try {
        // 🔥 무료 프록시 접속 차단(CORS) 해결: 동진님 전용 무적 GAS 터널
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
        let queryTicker = /^\d{6}$/.test(tickerInput) ? tickerInput + ".KS" : tickerInput;
        const targetUrl = `${GAS_PROXY_URL}?ticker=${queryTicker}`;

        const response = await fetch(targetUrl);
        if (!response.ok) throw new Error("데이터 호출 실패");
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) throw new Error("서버 혼잡. 잠시 후 다시 시도해주세요.");

        const timestamps = data.chart.result[0].timestamp;
        const quote = data.chart.result[0].indicators.quote[0];
        const rawPrices = quote.close; 
        
        let prices = [];
        let dates = [];
        for(let i = 0; i < rawPrices.length; i++) {
            if(rawPrices[i] !== null && rawPrices[i] !== undefined) {
                const d = new Date(timestamps[i] * 1000);
                dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
                prices.push(rawPrices[i]);
            }
        }

        if (prices.length < 200) throw new Error("200일선 연산을 위한 과거 데이터가 부족합니다.");

        // 1. 지표 연산 및 캐싱
        currentQuantData = calculateAllIndicators(prices, dates, tickerInput);
        
        // 2. 상태(State) 판별 및 스코어링
        const evaluation = evaluateQuantState(currentQuantData);

        // 3. UI 렌더링 및 동적 차트 삽입 (B안 레이아웃)
        renderQuantUI(tickerInput, currentQuantData, evaluation);
        
        statusMsg.innerHTML = `<i class="fas fa-check text-green-500 mr-1"></i> 분석 완료`;
        resultContainer.classList.remove('hidden');

    } catch (error) {
        statusMsg.innerHTML = `<span class="text-red-500">❌ 에러 발생: ${error.message}</span>`;
    }
}

// 🧮 1. 지표 일괄 계산 모듈 (배열 데이터 포함)
function calculateAllIndicators(prices, dates, ticker) {
    const currentPrice = prices[prices.length - 1];
    
    // MA 계산
    const ma5 = calcMA(prices, 5);
    const ma20 = calcMA(prices, 20);
    const ma60 = calcMA(prices, 60);
    const ma120 = calcMA(prices, 120);
    const ma200 = calcMA(prices, 200);

    const ma60Rising = ma60[ma60.length - 1] > ma60[ma60.length - 5];
    const ma120Rising = ma120[ma120.length - 1] > ma120[ma120.length - 5];

    // MDD 배열 계산
    let mddArray = [];
    let runningMax = prices[0];
    for (let p of prices) {
        if (p > runningMax) runningMax = p;
        let dd = ((p - runningMax) / runningMax) * 100;
        mddArray.push(dd);
    }
    const currentMDD = mddArray[mddArray.length - 1];

    // RSI 계산
    const rsiArray = calcRSIArray(prices, 14);
    const currentRSI = rsiArray[rsiArray.length - 1];
    const prevRSI = rsiArray[rsiArray.length - 3];
    const rsiRising = currentRSI > prevRSI;
    const rsiCrossed40 = prevRSI < 40 && currentRSI >= 40;

    return {
        ticker, dates, prices, ma5, ma20, ma60, ma120, ma200, rsiArray, mddArray,
        price: currentPrice,
        ma20Val: ma20[ma20.length - 1], ma60Val: ma60[ma60.length - 1], 
        ma120Val: ma120[ma120.length - 1], ma200Val: ma200[ma200.length - 1],
        ma60Rising, ma120Rising,
        currentMDD, currentRSI, prevRSI, rsiRising, rsiCrossed40
    };
}

// 🧠 2. 상태 분류 및 하드 필터링 엔진
function evaluateQuantState(ind) {
    let trendScore = 0, momentumScore = 0, drawdownScore = 0;
    let reasons = [];

    // --- Trend Score ---
    if (ind.ma20Val > ind.ma60Val && ind.ma60Val > ind.ma120Val) {
        trendScore += 20; reasons.push("단기/중기 이동평균 정배열 (추세 상승)");
    }
    if (ind.ma60Rising && ind.ma120Rising) {
        trendScore += 10; reasons.push("60일 및 120일선 우상향 (장기 체력 우수)");
    }
    if (ind.price < ind.ma20Val && ind.price > ind.ma60Val) {
        trendScore += 10; reasons.push("20일선 이탈 후 60일선 지지 부근 (건강한 Pullback 가산점)");
    }

    // --- Momentum Score ---
    if (ind.currentRSI >= 30 && ind.currentRSI <= 45) {
        momentumScore += 10; reasons.push("RSI 30~45 구간 (과매도 해소 및 상승 턴어라운드 타점)");
    } else if (ind.currentRSI > 45 && ind.currentRSI <= 60) {
        momentumScore += 5; reasons.push("RSI 중립 이상 (안정적 모멘텀)");
    } else if (ind.currentRSI > 70) {
        reasons.push("RSI 70 초과 (과열 구간 - 추격 매수 주의)");
    }
    if (ind.rsiRising) {
        momentumScore += 10; reasons.push(`RSI 반등 확인 (${ind.prevRSI.toFixed(1)} ➡️ ${ind.currentRSI.toFixed(1)})`);
    }
    if (ind.rsiCrossed40) {
        momentumScore += 10; reasons.push("RSI 40 상향 돌파 (강력한 추세 전환 신호)");
    }

    // --- Drawdown Score ---
    if (ind.currentMDD >= -15 && ind.currentMDD <= -5) {
        drawdownScore += 30; reasons.push(`MDD ${ind.currentMDD.toFixed(1)}% (가장 이상적인 1차 눌림목 깊이)`);
    } else if (ind.currentMDD >= -20 && ind.currentMDD < -15) {
        drawdownScore += 20; reasons.push(`MDD ${ind.currentMDD.toFixed(1)}% (깊은 조정 - 반등 확인 후 진입 권장)`);
    } else if (ind.currentMDD < -20) {
        if (trendScore >= 30) {
            drawdownScore += 10; reasons.push("MDD -20% 이하이나 장기 추세가 살아있어 과매도 줍줍 후보");
        } else {
            reasons.push("MDD -20% 이하 및 추세 악화 (떨어지는 칼날 위험)");
        }
    }

    let totalScore = trendScore + momentumScore + drawdownScore;
    let state = "", action = "", style = "", weight = "0%";
    const isTrendBroken = (ind.price < ind.ma120Val) || (ind.ma20Val < ind.ma60Val && ind.ma60Val < ind.ma120Val);

    if (isTrendBroken) {
        state = "[F] 추세 붕괴 구간";
        action = "🔴 매도 또는 관망";
        style = "bg-red-500 text-white";
        reasons.push("🚨 [경고] 주가가 120일선 아래이거나 완전 역배열 상태. 모든 매수 시그널을 무효화합니다.");
        totalScore = Math.min(totalScore, 40);
    } else if (ind.price > ind.ma20Val && ind.ma20Val > ind.ma60Val && ind.currentRSI > 50) {
        state = "[A] 강한 상승 추세";
        action = "🟡 보유 / 신규 진입 자제 (추가 상승 기대)";
        style = "bg-yellow-500 text-white";
        weight = "기존 비중 유지";
    } else if (ind.ma60Val > ind.ma120Val && ind.currentMDD >= -15 && ind.currentRSI >= 30 && ind.currentRSI <= 45 && ind.rsiRising) {
        state = "[B] 상승 추세 내 완벽한 Pullback";
        action = "🟢 1차 분할매수 (적극 권장)";
        style = "bg-green-600 text-white";
        weight = "목표 비중의 20~30%";
        totalScore = Math.max(totalScore, 85);
    } else if (ind.currentMDD < -15 && ind.rsiCrossed40) {
        state = "[C] 과매도 후 기술적 반등 성공";
        action = "🟢 1차 분할매수 (단기 타점)";
        style = "bg-emerald-500 text-white";
        weight = "목표 비중의 20%";
    } else if (ind.currentMDD < -20 && ind.currentRSI < 30) {
        state = "[D] 하락 추세 속 극단적 과매도";
        action = "🟠 신규매수 보류 (떨어지는 칼날)";
        style = "bg-orange-500 text-white";
    } else if (ind.currentRSI > 70) {
        state = "[E] 탐욕/과열 구간";
        action = "🔴 매도 / 익절 검토";
        style = "bg-red-500 text-white";
    } else {
        state = "방향성 탐색 구간";
        action = "🟡 관망 / 반등 확인";
        style = "bg-slate-500 text-white";
    }

    return { totalScore, state, action, style, weight, reasons };
}

// 🎨 3. UI 렌더링 및 동적 차트 삽입
function renderQuantUI(ticker, ind, eval) {
    const banner = document.getElementById('quant-action-banner');
    banner.className = `p-4 rounded-xl mb-6 text-center ${eval.style}`;
    
    document.getElementById('quant-action-title').innerText = eval.action;
    document.getElementById('quant-score-text').innerText = `종합 퀀트 스코어: ${eval.totalScore} / 100 점 | 현재 상태: ${eval.state}`;

    document.getElementById('quant-val-mdd').innerText = `${ind.currentMDD.toFixed(2)}%`;
    document.getElementById('quant-val-rsi').innerText = `${ind.currentRSI.toFixed(1)} ${ind.rsiRising ? '↗️' : '↘️'}`;
    const maStatus = ind.price > ind.ma20Val ? `<span class="text-green-600">회복 (${ind.ma20Val.toFixed(2)})</span>` : `<span class="text-red-500">이탈 (${ind.ma20Val.toFixed(2)})</span>`;
    document.getElementById('quant-val-ma').innerHTML = maStatus;

    const list = document.getElementById('quant-reasons-list');
    list.innerHTML = "";
    eval.reasons.forEach(r => {
        let li = document.createElement('li');
        li.innerHTML = `• ${r}`;
        list.appendChild(li);
    });

    if (eval.weight !== "0%") {
        let liW = document.createElement('li');
        liW.innerHTML = `• 🛒 <b>시스템 권장 액션:</b> 현재 ${eval.weight} 투입을 권장합니다.`;
        liW.className = "mt-3 pt-3 border-t border-indigo-200 text-indigo-900";
        list.appendChild(liW);
    }

    // 📈 B안 레이아웃: 차트 섹션이 없으면 '세부 수치 패널'과 'AI 판단 근거' 사이에 동적으로 삽입
    let chartSection = document.getElementById('quant-integrated-chart-section');
    if (!chartSection) {
        chartSection = document.createElement('div');
        chartSection.id = 'quant-integrated-chart-section';
        chartSection.className = 'bg-white p-5 rounded-2xl border border-slate-200 mb-6 shadow-sm';
        chartSection.innerHTML = `
            <div class="flex flex-wrap gap-4 mb-4 items-center justify-center text-sm font-bold text-slate-700 bg-slate-50 py-3 rounded-xl border border-slate-100">
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors"><input type="checkbox" id="chk-quant-price" checked class="w-4 h-4 accent-slate-800" onchange="drawQuantChart()"> 주가</label>
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors"><input type="checkbox" id="chk-quant-ma5" checked class="w-4 h-4 accent-pink-500" onchange="drawQuantChart()"> 5일선</label>
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors"><input type="checkbox" id="chk-quant-ma20" checked class="w-4 h-4 accent-yellow-500" onchange="drawQuantChart()"> 20일선</label>
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors"><input type="checkbox" id="chk-quant-ma60" checked class="w-4 h-4 accent-green-500" onchange="drawQuantChart()"> 60일선</label>
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors"><input type="checkbox" id="chk-quant-ma120" class="w-4 h-4 accent-blue-500" onchange="drawQuantChart()"> 120일선</label>
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors"><input type="checkbox" id="chk-quant-ma200" class="w-4 h-4 accent-purple-500" onchange="drawQuantChart()"> 200일선</label>
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors ml-4 border-l pl-4 border-slate-300"><input type="checkbox" id="chk-quant-rsi" class="w-4 h-4 accent-orange-500" onchange="drawQuantChart()"> RSI</label>
                <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 transition-colors"><input type="checkbox" id="chk-quant-mdd" checked class="w-4 h-4 accent-red-500" onchange="drawQuantChart()"> MDD</label>
            </div>
            <div class="relative w-full h-[400px]">
                <canvas id="quantIntegratedCanvas"></canvas>
            </div>
        `;
        const resultContainer = document.getElementById('quant-result-container');
        const reasonsBox = document.querySelector('#quant-result-container > .bg-indigo-50');
        resultContainer.insertBefore(chartSection, reasonsBox);
    }
    drawQuantChart(); // 차트 렌더링
}

// 📊 4. 듀얼 축(Dual Axis) 통합 차트 그리기
function drawQuantChart() {
    if (!currentQuantData) return;

    const ctx = document.getElementById('quantIntegratedCanvas').getContext('2d');
    if (quantChartInstance) quantChartInstance.destroy();

    let datasets = [];
    
    // 왼쪽 Y축 (가격/MA)
    if (document.getElementById('chk-quant-price').checked) {
        datasets.push({ label: '주가', data: currentQuantData.prices, borderColor: '#1e293b', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y', order: 10 });
    }
    if (document.getElementById('chk-quant-ma5').checked) {
        datasets.push({ label: '5일선', data: currentQuantData.ma5, borderColor: '#ec4899', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    }
    if (document.getElementById('chk-quant-ma20').checked) {
        datasets.push({ label: '20일선', data: currentQuantData.ma20, borderColor: '#eab308', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    }
    if (document.getElementById('chk-quant-ma60').checked) {
        datasets.push({ label: '60일선', data: currentQuantData.ma60, borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    }
    if (document.getElementById('chk-quant-ma120').checked) {
        datasets.push({ label: '120일선', data: currentQuantData.ma120, borderColor: '#3b82f6', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    }
    if (document.getElementById('chk-quant-ma200').checked) {
        datasets.push({ label: '200일선', data: currentQuantData.ma200, borderColor: '#8b5cf6', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    }

    // 오른쪽 Y축 (RSI/MDD %비율)
    if (document.getElementById('chk-quant-rsi').checked) {
        datasets.push({ label: 'RSI (0~100)', data: currentQuantData.rsiArray, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' });
    }
    if (document.getElementById('chk-quant-mdd').checked) {
        datasets.push({ label: 'MDD (%)', data: currentQuantData.mddArray, borderColor: 'rgba(239, 68, 68, 0.8)', backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.1, yAxisID: 'y1' });
    }

    quantChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: currentQuantData.dates, datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { weight: 'bold' } } },
                y: { 
                    type: 'linear', position: 'left',
                    ticks: { font: { weight: 'bold' } }
                },
                y1: { 
                    type: 'linear', position: 'right', min: -100, max: 100,
                    grid: { drawOnChartArea: false }, // 가격선과 격자선 충돌 방지
                    ticks: { callback: value => value + '%', font: { weight: 'bold', color: '#64748b' } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' }
            }
        }
    });
}

// --- 유틸리티 함수 ---
function calcMA(prices, window) {
    let result = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < window - 1) result.push(null);
        else {
            let sum = 0;
            for (let j = 0; j < window; j++) sum += prices[i - j];
            result.push(sum / window);
        }
    }
    return result;
}

function calcRSIArray(prices, period) {
    let rsiArr = new Array(prices.length).fill(null);
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period; let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let currentGain = diff >= 0 ? diff : 0;
        let currentLoss = diff < 0 ? -diff : 0;
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiArr[i] = 100 - (100 / (1 + rs));
    }
    return rsiArr;
}

// 엔터 키 연동
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('quant-ticker-input');
    if(input) input.addEventListener('keypress', e => { if (e.key === 'Enter') runQuantAnalysis(); });
});
