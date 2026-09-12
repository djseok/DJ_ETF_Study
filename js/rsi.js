// =========================================================
// 📈 RSI 계산기 모듈 (전용 GAS 터널 장착)
// =========================================================

let currentRsiPeriod = 14;
const rsiCache = {}; 

function setRSIPeriod(days) {
    currentRsiPeriod = days;
    document.querySelectorAll('.rsi-period-btn').forEach(btn => {
        btn.classList.remove('bg-slate-800', 'text-white', 'border-transparent');
        btn.classList.add('text-slate-600', 'hover:bg-slate-200', 'border-slate-300');
    });
    const activeBtn = document.getElementById(`btnRsi${days}`);
    if(activeBtn) {
        activeBtn.classList.remove('text-slate-600', 'hover:bg-slate-200', 'border-slate-300');
        activeBtn.classList.add('bg-slate-800', 'text-white', 'border-transparent');
    }

    const resultBox = document.getElementById('rsiResultBox');
    if (resultBox && !resultBox.classList.contains('hidden')) {
        const ticker = document.getElementById('rsiTickerInput').value.trim().toUpperCase();
        if (ticker && rsiCache[ticker]) {
            displayRSI(ticker, rsiCache[ticker], currentRsiPeriod);
        } else {
            if(typeof calculateManualRSI === 'function') calculateManualRSI();
        }
    }
}

function calculateRSIMath(prices, period) {
    if (!prices || prices.length <= period) return null;
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
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return (100 - (100 / (1 + rs))).toFixed(2);
}

function displayRSI(title, priceArray, period) {
    const rsiValue = calculateRSIMath(priceArray, period);
    const box = document.getElementById('rsiResultBox');
    const vText = document.getElementById('rsiResultValue');
    const msg = document.getElementById('rsiResultMessage');
    
    if(!box || !vText || !msg) return;

    box.classList.remove('hidden', 'border-green-400', 'bg-green-50', 'border-yellow-400', 'bg-yellow-50', 'border-red-400', 'bg-red-50');

    if (!rsiValue) {
        alert("데이터 부족: 최소 " + (period + 1) + "일치 데이터가 필요합니다.");
        return;
    }
    const titleEl = document.getElementById('rsiResultTicker');
    if(titleEl) titleEl.innerText = `${title} (${period}일 RSI)`;
    vText.innerText = rsiValue;

    if (rsiValue < 30) {
        box.classList.add('border-green-400', 'bg-green-50');
        vText.className = "text-6xl font-black mb-3 font-mono tracking-tighter text-green-600";
        msg.innerText = "🟢 과매도 (분할 매수 기회 🛒)";
        msg.className = "text-xl font-bold text-green-700 relative z-10";
    } else if (rsiValue <= 70) {
        box.classList.add('border-yellow-400', 'bg-yellow-50');
        vText.className = "text-6xl font-black mb-3 font-mono tracking-tighter text-yellow-600";
        msg.innerText = "🟡 보통 수준 (관망 💤)";
        msg.className = "text-xl font-bold text-yellow-700 relative z-10";
    } else {
        box.classList.add('border-red-400', 'bg-red-50');
        vText.className = "text-6xl font-black mb-3 font-mono tracking-tighter text-red-500";
        msg.innerText = "🔴 과매수 (익절 고려 💰)";
        msg.className = "text-xl font-bold text-red-600 relative z-10";
    }
}

function calculateManualRSI() {
    const inputEl = document.getElementById('rsiManualInput');
    if (!inputEl) return;
    const input = inputEl.value;
    if (!input) return;
    const priceArray = input.split(',').map(val => parseFloat(val.trim())).filter(val => !isNaN(val));
    if (priceArray.length > 0) {
        displayRSI('수동 입력 데이터', priceArray, currentRsiPeriod);
    }
}

async function fetchAndCalculateRSI() {
    const tickerInput = document.getElementById('rsiTickerInput');
    if (!tickerInput) return;
    
    let ticker = tickerInput.value.trim().toUpperCase();
    if (!ticker) return alert("티커를 입력하세요!");

    if (rsiCache[ticker]) {
        displayRSI(ticker, rsiCache[ticker], currentRsiPeriod);
        return;
    }

    const btn = document.querySelector('button[onclick*="fetchAndCalculateRSI"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>조회 중...';
    }

    try {
        const resultBox = document.getElementById('rsiResultBox');
        if (resultBox) resultBox.classList.add('hidden');
        
        let queryTicker = ticker;
        if (/^\d{6}$/.test(ticker)) queryTicker = ticker + ".KS";

        // 동진님 전용 GAS 웹 앱 URL 적용
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
        const targetUrl = `${GAS_PROXY_URL}?ticker=${queryTicker}`;

        const response = await fetch(targetUrl);
        if (!response.ok) throw new Error(`서버 응답 오류: ${response.status}`);
        
        const data = await response.json(); 
        if (data.error) throw new Error(`야후 파이낸스 데이터 호출 오류: ${data.error}`);
        if (!data.chart || !data.chart.result || !data.chart.result[0].indicators.quote[0].close) {
            throw new Error("유효한 주가 데이터를 반환하지 않았습니다.");
        }

        const prices = data.chart.result[0].indicators.quote[0].close.filter(p => p !== null);
        rsiCache[ticker] = prices;
        displayRSI(ticker, prices, currentRsiPeriod);
        
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
