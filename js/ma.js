// =========================================================
// 📈 실시간 API 연동형 이평선(MA) 분석 엔진
// =========================================================

let maChartInstance = null; // Chart.js 인스턴스
let currentMaData = { dates: [], prices: [], ticker: "" }; // 체크박스 토글 시 재사용할 데이터 캐시

// 🎨 이평선별 고정 색상 팔레트
const MA_COLORS = {
    "5": "#ec4899",   // 핑크
    "20": "#eab308",  // 옐로우
    "60": "#22c55e",  // 그린
    "120": "#3b82f6", // 블루
    "200": "#8b5cf6"  // 퍼플
};

async function runMACalculation() {
    const tickerInput = document.getElementById('ma-ticker-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('ma-status-msg');
    const resultContainer = document.getElementById('ma-result-container');

    if (!tickerInput) {
        statusMsg.innerHTML = "⚠️ 종목 티커를 입력해주세요.";
        statusMsg.className = "text-xs text-red-500 font-bold";
        return;
    }

    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500"></i> <b>${tickerInput}</b> 데이터를 분석 중입니다... ⏳`;
    statusMsg.className = "text-xs text-indigo-600 font-bold";
    resultContainer.classList.add('hidden'); 

    try {
        let dates = [];
        let prices = [];
        let fetchSuccess = false;
        
        let isKorean = /^\d{6}$/.test(tickerInput) || tickerInput.endsWith('.KS');
        let queryTicker = /^\d{6}$/.test(tickerInput) ? tickerInput + ".KS" : tickerInput;

        // 1. FMP API 다이렉트 호출 (미국주식 우선)
        if (!isKorean) {
            try {
                const FMP_API_KEY = "UJT2GZE4YWddOWp4SczYFpYufroPrlAy"; // 동진님 기존 FMP 키 재사용
                const fmpUrl = `https://financialmodelingprep.com/api/v3/historical-price-full/${tickerInput}?timeseries=500&apikey=${FMP_API_KEY}`;
                
                const fmpRes = await fetch(fmpUrl);
                if (fmpRes.ok) {
                    const fmpData = await fmpRes.json();
                    if (fmpData.historical && fmpData.historical.length > 0) {
                        const historical = fmpData.historical.reverse();
                        historical.forEach(item => { dates.push(item.date); prices.push(item.close); });
                        fetchSuccess = true;
                    }
                }
            } catch(e) { console.warn("FMP 막힘, 야후로 우회"); }
        }

        // 2. 야후 파이낸스 다중 프록시 터널 (한국주식 & ETF 백업)
        if (!fetchSuccess) {
            const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${queryTicker}?range=2y&interval=1d`;
            const proxies = [
                `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
                `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
                `https://thingproxy.freeboard.io/fetch/${targetUrl}`
            ];

            let data = null;
            for (let proxy of proxies) {
                try {
                    const response = await fetch(proxy);
                    if (response.ok) { data = await response.json(); break; }
                } catch (e) { continue; }
            }

            if (!data || !data.chart || !data.chart.result) throw new Error("서버 혼잡. 잠시 후 다시 시도해주세요.");

            const timestamps = data.chart.result[0].timestamp;
            const rawPrices = data.chart.result[0].indicators.quote[0].close; 
            
            for(let i = 0; i < rawPrices.length; i++) {
                if(rawPrices[i] !== null && rawPrices[i] !== undefined) {
                    const d = new Date(timestamps[i] * 1000);
                    dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
                    prices.push(rawPrices[i]);
                }
            }
        }

        if (prices.length < 20) throw new Error("데이터가 부족합니다.");

        // 메모리에 캐싱하여 체크박스 클릭 시 재연산 방지
        currentMaData = { dates, prices, ticker: tickerInput };
        
        statusMsg.innerHTML = `✅ <b>${tickerInput}</b> 차트 렌더링 완료. (체크박스를 눌러 이평선을 조정하세요)`;
        statusMsg.className = "text-xs text-green-600 font-bold";
        resultContainer.classList.remove('hidden');

        updateMAChart(); // 차트 최초 그리기

    } catch (error) {
        statusMsg.innerHTML = `❌ ${error.message}`;
        statusMsg.className = "text-xs text-red-500 font-bold";
    }
}

// 🧮 특정 기간의 이동평균선(SMA)을 계산하는 함수
function calculateSMA(prices, window) {
    let sma = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < window - 1) {
            sma.push(null); // 데이터가 부족한 초반부는 렌더링 생략
        } else {
            let sum = 0;
            for (let j = 0; j < window; j++) sum += prices[i - j];
            sma.push(sum / window);
        }
    }
    return sma;
}

// 🎨 체크박스 상태를 읽어 차트를 업데이트하는 함수
function updateMAChart() {
    if (!currentMaData.prices || currentMaData.prices.length === 0) return;

    const ctx = document.getElementById('maChartCanvas').getContext('2d');
    if (maChartInstance) maChartInstance.destroy(); // 기존 차트 초기화

    // 1. 기본 주가 데이터셋 세팅
    let datasets = [{
        label: `${currentMaData.ticker} 주가`,
        data: currentMaData.prices,
        borderColor: '#1e293b', // 짙은 네이비
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        order: 10 // 주가가 가장 위에 올라오도록 설정
    }];

    // 2. 체크된 이평선만 찾아 데이터셋에 추가
    const checkboxes = document.querySelectorAll('.ma-checkbox:checked');
    checkboxes.forEach(cb => {
        const period = parseInt(cb.value);
        const maData = calculateSMA(currentMaData.prices, period);
        
        datasets.push({
            label: `${period}일선`,
            data: maData,
            borderColor: MA_COLORS[period.toString()],
            borderWidth: 1.5,
            pointRadius: 0,
            borderDash: period >= 120 ? [5, 5] : [], // 장기 이평선은 점선 처리
            tension: 0.4
        });
    });

    // 3. 차트 렌더링
    maChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: currentMaData.dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { weight: 'bold' } } },
                y: { ticks: { font: { weight: 'bold' } } }
            },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, font: { weight: 'bold' } } },
                tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' }
            }
        }
    });
}

// 엔터 키 연동
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('ma-ticker-input');
    if(input) input.addEventListener('keypress', e => { if (e.key === 'Enter') runMACalculation(); });
});
