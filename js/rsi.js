// =========================================================
// 📈 RSI 계산기 모듈 (Yahoo Finance API + CORS 우회 장착)
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
    activeBtn.classList.remove('text-slate-600', 'hover:bg-slate-200', 'border-slate-300');
    activeBtn.classList.add('bg-slate-800', 'text-white', 'border-transparent');

    if (!document.getElementById('rsiResultBox').classList.contains('hidden')) {
        const ticker = document.getElementById('rsiTickerInput').value.trim().toUpperCase();
        if (ticker && rsiCache[ticker]) {
            displayRSI(ticker, rsiCache[ticker], currentRsiPeriod);
        } else {
            calculateManualRSI();
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
    box.classList.remove('hidden', 'border-green-400', 'bg-green-50', 'border-yellow-400', 'bg-yellow-50', 'border-red-400', 'bg-red-50');

    if (!rsiValue) {
        alert("데이터 부족: 최소 " + (period + 1) + "일치 데이터가 필요합니다.");
        return;
    }
    document.getElementById('rsiResultTicker').innerText = `${title} (${period}일 RSI)`;
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

async function fetchAndCalculateRSI() {
    const ticker = document.getElementById('rsiTickerInput').value.trim().toUpperCase();
    if (!ticker) return alert("티커를 입력하세요!");

    const btn = document.querySelector('button[onclick*="fetchAndCalculateRSI"]');
    btn.disabled = true;
    btn.innerHTML = '조회 중...';

    try {
        // [CORS 우회 적용] AllOrigins API를 사용하여 야후 파이낸스 데이터 획득
        const encodedUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1mo&interval=1d`);
        const response = await fetch(`https://api.allorigins.win/get?url=${encodedUrl}`);
        const data = await response.json();
        
        const chartData = JSON.parse(data.contents);
        const prices = chartData.chart.result[0].indicators.quote[0].close.filter(p => p !== null);
        
        rsiCache[ticker] = prices;
        displayRSI(ticker, prices, currentRsiPeriod);
    } catch (err) {
        console.error(err);
        alert("데이터를 가져올 수 없습니다. 티커를 확인하세요.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '📈 조회하기';
    }
}
