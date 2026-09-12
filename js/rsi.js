// =========================================================
// 📈 RSI 계산기 모듈 (Yahoo Finance API + 다중 프록시 터널 장착)
// =========================================================

let currentRsiPeriod = 14;
const rsiCache = {}; // API 중복 호출을 막기 위한 캐시 저장소

// 1. 기간 선택 버튼 UI 업데이트
function setRSIPeriod(days) {
    currentRsiPeriod = days;
    document.querySelectorAll('.rsi-period-btn').forEach(btn => {
        btn.classList.remove('bg-slate-800', 'text-white', 'border-transparent');
        btn.classList.add('text-slate-600', 'hover:bg-slate-200', 'border-slate-300');
    });
    
    const activeBtn = document.getElementById(`btnRsi${days}`);
    if (activeBtn) {
        activeBtn.classList.remove('text-slate-600', 'hover:bg-slate-200', 'border-slate-300');
        activeBtn.classList.add('bg-slate-800', 'text-white', 'border-transparent');
    }

    // 이미 결과가 화면에 나와 있는 상태라면, 버튼을 누를 때마다 서버 호출 없이 즉시 재계산
    const resultBox = document.getElementById('rsiResultBox');
    if (resultBox && !resultBox.classList.contains('hidden')) {
        const tickerInput = document.getElementById('rsiTickerInput');
        if (tickerInput) {
            const ticker = tickerInput.value.trim().toUpperCase();
            if (ticker && rsiCache[ticker]) {
                displayRSI(ticker, rsiCache[ticker], currentRsiPeriod);
            } else {
                if (typeof calculateManualRSI === 'function') calculateManualRSI(); // 수동 입력 폼일 경우
            }
        }
    }
}

// 2. 📈 정통 RSI 연산 엔진 (수학 공식 적용)
function calculateRSIMath(prices, period) {
    if (!prices || prices.length <= period) return null; // 데이터가 부족할 경우

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let currentGain = diff >= 0 ? diff : 0;
        let currentLoss = diff < 0 ? -diff : 0;
        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100; // 하락이 아예 없었을 경우 무조건 100
    
    let rs = avgGain / avgLoss;
    let rsi = 100 - (100 / (1 + rs));
    
    return rsi.toFixed(2);
}

// 3. 🎨 화면에 결과 렌더링
function displayRSI(title, priceArray, period) {
    const rsiValue = calculateRSIMath(priceArray, period);
    const box = document.getElementById('rsiResultBox');
    const vText = document.getElementById('rsiResultValue');
    const msg = document.getElementById('rsiResultMessage');
    
    if (!box || !vText || !msg) return;

    box.classList.remove('hidden', 'border-green-400', 'bg-green-50', 'border-yellow-400', 'bg-yellow-50', 'border-red-400', 'bg-red-50');

    if (!rsiValue) {
        alert("데이터가 부족합니다. 최소 " + (period + 1) + "일 이상의 가격 데이터가 필요합니다.");
        return;
    }

    const titleEl = document.getElementById('rsiResultTicker');
    if (titleEl) titleEl.innerText = `${title} (${period}일 RSI)`;
    
    vText.innerText = rsiValue;

    // RSI 수치에 따른 신호 및 색상 변경
    if (rsiValue < 30) {
        box.classList.add('border-green-400', 'bg-green-50');
        vText.className = "text-6xl font-black mb-3 font-mono tracking-tighter text-green-600";
        msg.innerText = "🟢 많이 빠졌다 (과매도 구간 - 분할 매수 기회 🛒)";
        msg.className = "text-xl font-bold text-green-700 relative z-10";
    } else if (rsiValue <= 70) {
        box.classList.add('border-yellow-400', 'bg-yellow-50');
        vText.className = "text-6xl font-black mb-3 font-mono tracking-tighter text-yellow-600";
        msg.innerText = "🟡 보통 수준 (박스권 관망 💤)";
        msg.className = "text-xl font-bold text-yellow-700 relative z-10";
    } else {
        box.classList.add('border-red-400', 'bg-red-50');
        vText.className = "text-6xl font-black mb-3 font-mono tracking-tighter text-red-500";
        msg.innerText = "🔴 많이 올랐다 (과매수 구간 - 단기 과열 조심 💰)";
        msg.className = "text-xl font-bold text-red-600 relative z-10";
    }
}

// 4. 수동 입력 데이터 처리
function calculateManualRSI() {
    const inputEl = document.getElementById('rsiManualInput');
    if (!inputEl) return;
    
    const input = inputEl.value;
    if (!input) return;

    // 쉼표로 구분된 문자열을 숫자 배열로 변환
    const priceArray = input.split(',').map(val => parseFloat(val.trim())).filter(val => !isNaN(val));
    
    if (priceArray.length > 0) {
        displayRSI('수동 입력 데이터', priceArray, currentRsiPeriod);
    }
}

// 5. 🔍 티커 검색 및 데이터 Fetch (야후 파이낸스 + 다중 우회)
async function fetchAndCalculateRSI() {
    const tickerInput = document.getElementById('rsiTickerInput');
    if (!tickerInput) return;
    
    let ticker = tickerInput.value.trim().toUpperCase();
    if (!ticker) {
        alert("티커를 입력해 주세요!");
        return;
    }

    // 캐시에 이미 데이터가 있으면 즉시 계산 (속도 100배 최적화)
    if (rsiCache[ticker]) {
        console.log("캐시된 데이터를 사용합니다: ", ticker);
        displayRSI(ticker, rsiCache[ticker], currentRsiPeriod);
        return;
    }

    const btn = document.querySelector('button[onclick*="fetchAndCalculateRSI"]');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>조회 중...';
        btn.disabled = true;
    }

    try {
        const resultBox = document.getElementById('rsiResultBox');
        if (resultBox) resultBox.classList.add('hidden');
        
        let queryTicker = ticker;
        if (/^\d{6}$/.test(ticker)) queryTicker = ticker + ".KS"; // 한국 주식 지원

        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${queryTicker}?range=3mo&interval=1d`;
        
        // 다중 프록시(Fallback) 배열 적용: 하나가 막히면 다음 서버로 자동 우회
        const proxies = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
            `https://thingproxy.freeboard.io/fetch/${targetUrl}`
        ];

        let data = null;

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

        if (!data) throw new Error("현재 사용 가능한 모든 무료 데이터 터널이 혼잡합니다.");
        if (!data.chart || !data.chart.result || !data.chart.result[0].indicators.quote[0].close) {
            throw new Error("야후 파이낸스에서 유효한 주가 데이터를 반환하지 않았습니다.");
        }

        const closePrices = data.chart.result[0].indicators.quote[0].close.filter(p => p !== null);

        // 캐시 저장
        rsiCache[ticker] = closePrices;
        
        // 결과 출력
        displayRSI(ticker, closePrices, currentRsiPeriod);
        
    } catch (err) {
        console.error("RSI Fetch Error:", err);
        alert(`데이터를 가져올 수 없습니다. 티커(${ticker})가 정확한지 확인해 주세요.`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '📈 조회하기';
        }
    }
}
