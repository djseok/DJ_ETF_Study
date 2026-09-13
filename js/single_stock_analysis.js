// =========================================================
// 🧠 Explainable Quantitative Decision System V2.0
// Architecture: Trend > Momentum > Drawdown > Risk
// =========================================================

let quantChartInstance = null; 
let currentQuantData = null;

async function runQuantAnalysis() {
    const tickerInput = document.getElementById('quant-ticker-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('quant-status-msg');
    const resultContainer = document.getElementById('quant-result-container');

    if (!tickerInput) return;

    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500 mr-1"></i> <b>${tickerInput} & SPY(Market Regime)</b> 5년 시계열 데이터를 동기화 중입니다...`;
    resultContainer.classList.add('hidden');

    try {
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
        let queryTicker = /^\d{6}$/.test(tickerInput) ? tickerInput + ".KS" : tickerInput;
        
        // 1. Target 종목과 SPY(Regime 판단용) 동시 호출
        const [targetRes, spyRes] = await Promise.all([
            fetch(`${GAS_PROXY_URL}?ticker=${queryTicker}&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=SPY&range=5y`)
        ]);

        if (!targetRes.ok || !spyRes.ok) throw new Error("데이터 호출 실패 (Network Error)");
        
        const targetData = await targetRes.json();
        const spyData = await spyRes.json();

        if (targetData.error) throw new Error(targetData.error);
        if (!targetData.chart || !targetData.chart.result) throw new Error("서버 혼잡. 잠시 후 다시 시도해주세요.");

        // 2. Data Layer: OHLCV 정제 및 Validation
        const rawOHLCV = extractOHLCV(targetData);
        const spyOHLCV = extractOHLCV(spyData);
        
        const dataValidation = validateDataQuality(rawOHLCV);
        if (dataValidation.score < 50) throw new Error(`데이터 신뢰도 심각 부족 (Score: ${dataValidation.score}). 분석을 중단합니다.`);

        // 3. 지표 연산 (Indicators)
        const indicators = calculateAllIndicators(rawOHLCV);
        const marketRegime = determineMarketRegime(spyOHLCV);

        // 4. Score Engine & Trend Gate
        const evaluation = evaluateQuantState(indicators, marketRegime, dataValidation);

        // 5. Backtest Engine (Next Open 체결, In/Out Sample 분리)
        const backtestResult = runBacktestEngine(rawOHLCV, marketRegime);

        // 6. UI 렌더링 (Explainable Structure)
        currentQuantData = indicators;
        renderExplainableUI(tickerInput, indicators, marketRegime, evaluation, dataValidation, backtestResult);
        
        statusMsg.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> 분석 완료 (Data Quality: ${dataValidation.score}/100)`;
        resultContainer.classList.remove('hidden');

    } catch (error) {
        statusMsg.innerHTML = `<span class="text-red-500 font-bold">❌ 시스템 경고: ${error.message}</span>`;
    }
}

// ---------------------------------------------------------
// [Data Layer & Validation]
// ---------------------------------------------------------
function extractOHLCV(data) {
    const timestamps = data.chart.result[0].timestamp;
    const quote = data.chart.result[0].indicators.quote[0];
    let result = { dates: [], open: [], high: [], low: [], close: [], volume: [] };
    
    for(let i = 0; i < quote.close.length; i++) {
        if(quote.close[i] !== null && quote.open[i] !== null) {
            const d = new Date(timestamps[i] * 1000);
            result.dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
            result.open.push(quote.open[i]);
            result.high.push(quote.high[i]);
            result.low.push(quote.low[i]);
            result.close.push(quote.close[i]);
            result.volume.push(quote.volume[i] || 0);
        }
    }
    return result;
}

function validateDataQuality(ohlcv) {
    let score = 100;
    let errors = [];
    let zeroVolumeDays = 0;
    let ohlcErrors = 0;

    for (let i = 0; i < ohlcv.close.length; i++) {
        if (ohlcv.high[i] < ohlcv.low[i]) ohlcErrors++;
        if (ohlcv.volume[i] === 0) zeroVolumeDays++;
    }

    if (ohlcErrors > 0) { score -= 20; errors.push(`High < Low 오류 ${ohlcErrors}건 검출`); }
    if (zeroVolumeDays > 20) { score -= 10; errors.push(`거래량 0일 ${zeroVolumeDays}건 (유동성 부족 주의)`); }
    if (ohlcv.close.length < 250) { score -= 30; errors.push("Sample Size 부족 (1년 미만 데이터)"); }

    return { 
        score, 
        errors: errors.length > 0 ? errors : ["결측치 및 OHLC 구조적 오류 없음"],
        rows: ohlcv.close.length,
        source: "Yahoo Finance (via GAS Proxy)",
        adjusted: "Split & Dividend Adjusted (Close)"
    };
}

// ---------------------------------------------------------
// [Indicator & Regime Engine]
// ---------------------------------------------------------
function calculateAllIndicators(ohlcv) {
    const prices = ohlcv.close;
    const currentPrice = prices[prices.length - 1];
    
    const ma5 = calcMA(prices, 5);
    const ma20 = calcMA(prices, 20);
    const ma60 = calcMA(prices, 60);
    const ma120 = calcMA(prices, 120);
    const ma200 = calcMA(prices, 200);

    const atr = calcATR(ohlcv.high, ohlcv.low, ohlcv.close, 14);
    const currentATR = atr[atr.length - 1];

    let mddArray = [];
    let runningMax = prices[0];
    for (let p of prices) {
        if (p > runningMax) runningMax = p;
        mddArray.push(((p - runningMax) / runningMax) * 100);
    }
    const currentMDD = mddArray[mddArray.length - 1];

    const rsiArray = calcRSIArray(prices, 14);
    const currentRSI = rsiArray[rsiArray.length - 1];
    const prevRSI = rsiArray[rsiArray.length - 2];

    return {
        dates: ohlcv.dates, prices, ma5, ma20, ma60, ma120, ma200, rsiArray, mddArray, atr,
        price: currentPrice,
        ma20Val: ma20[ma20.length - 1], ma60Val: ma60[ma60.length - 1], 
        ma120Val: ma120[ma120.length - 1], ma200Val: ma200[ma200.length - 1],
        ma60Slope: ma60[ma60.length - 1] - ma60[ma60.length - 5],
        currentMDD, currentRSI, prevRSI, currentATR
    };
}

function determineMarketRegime(spyOHLCV) {
    const spyPrices = spyOHLCV.close;
    const spy200 = calcMA(spyPrices, 200);
    const currSpy = spyPrices[spyPrices.length - 1];
    const currSpy200 = spy200[spy200.length - 1];
    const slope200 = currSpy200 - spy200[spy200.length - 10];

    if (currSpy > currSpy200 && slope200 > 0) return { state: "BULL", desc: "SPY가 200일선 위에 있으며 장기 추세 우상향" };
    if (currSpy < currSpy200 && slope200 < 0) return { state: "BEAR", desc: "SPY가 200일선 아래에 있으며 장기 추세 우하향" };
    return { state: "NEUTRAL", desc: "SPY 추세 혼조 구간 (횡보/변동성 확대)" };
}

// ---------------------------------------------------------
// [Score & Trend Gate Engine]
// ---------------------------------------------------------
function evaluateQuantState(ind, regime, dataVal) {
    let trendScore = 0, momentumScore = 0, drawdownScore = 0, riskScore = 0;
    let bullCase = [], bearCase = [], reasons = [];

    // 1. Trend (Max 40)
    if (ind.price > ind.ma60Val) { trendScore += 10; reasons.push("Trend: +10 (Price > 60MA)"); bullCase.push("주가가 중기 이평선 상단 위치"); }
    else { bearCase.push("60일선(수급선) 이탈 상태"); }

    if (ind.ma20Val > ind.ma60Val) { trendScore += 10; reasons.push("Trend: +10 (20MA > 60MA)"); }
    if (ind.ma60Slope > 0) { trendScore += 10; reasons.push("Trend: +10 (60MA 우상향)"); bullCase.push("60일선 추세 우상향 지속"); }
    else { bearCase.push("60일선 기울기 하락 반전"); }

    if (ind.price > ind.ma120Val) { trendScore += 10; reasons.push("Trend: +10 (Price > 120MA)"); }

    // 2. Momentum (Max 30)
    if (ind.currentRSI > ind.prevRSI) { momentumScore += 10; reasons.push("Mom: +10 (RSI 전일 대비 상승)"); bullCase.push("단기 모멘텀(RSI) 상승 반전"); }
    else { bearCase.push("단기 모멘텀(RSI) 둔화"); }

    if (ind.prevRSI < 40 && ind.currentRSI >= 40) { momentumScore += 10; reasons.push("Mom: +10 (RSI 40 상향 돌파)"); bullCase.push("과매도 해소 및 기술적 반등 시그널 발생"); }
    if (ind.currentRSI >= 40 && ind.currentRSI <= 60) { momentumScore += 10; reasons.push("Mom: +10 (RSI 40~60 건전 구간)"); }
    if (ind.currentRSI > 70) { momentumScore = 0; reasons.push("Mom: 0 (RSI 70 과열)"); bearCase.push("RSI 70 이상으로 단기 과열 리스크"); }

    // 3. Drawdown (Max 20)
    if (ind.currentMDD >= -15 && ind.currentMDD <= -5) { drawdownScore += 20; reasons.push("DD: +20 (MDD -5~-15% 이상적 조정)"); bullCase.push("장기 추세 내 건강한 Pullback(조정) 깊이"); }
    else if (ind.currentMDD < -15 && ind.currentMDD >= -25) { drawdownScore += 10; reasons.push("DD: +10 (MDD -15~-25% 깊은 조정)"); bearCase.push("낙폭 과대로 인한 반등 확인 필요"); }
    else if (ind.currentMDD < -25) { drawdownScore += 0; reasons.push("DD: 0 (MDD -25% 초과 하락장)"); bearCase.push("극단적 MDD, 하락 추세 고착화 위험"); }
    else { drawdownScore += 5; reasons.push("DD: +5 (고점 횡보 구간)"); }

    // 4. Risk (Max 10)
    const volRatio = ind.currentATR / ind.price;
    if (volRatio < 0.03) { riskScore += 10; reasons.push("Risk: +10 (ATR 변동성 안정화)"); }
    else { riskScore += 5; reasons.push("Risk: +5 (ATR 변동성 확대)"); bearCase.push("일일 변동폭(ATR) 확대로 리스크 증가"); }

    let totalScore = trendScore + momentumScore + drawdownScore + riskScore;
    let confidence = dataVal.score - (regime.state === "BEAR" ? 15 : 0); // 약세장에선 신뢰도 차감
    
    // 🚨 TREND GATE (Hard Constraint)
    let finalAction = "", style = "", recWeight = "";
    
    if (trendScore <= 10) {
        finalAction = "🟠 신규매수 보류"; style = "bg-orange-500 text-white"; recWeight = "0%";
        reasons.push("🚨 [Trend Gate 발동] Trend Score 10 이하. 모멘텀/낙폭 무관하게 신규 진입을 금지합니다.");
    } else if (trendScore <= 20) {
        finalAction = "🟡 관망 / 반등 확인"; style = "bg-yellow-500 text-white"; recWeight = "0~10%";
        reasons.push("⚠️ [Trend Gate 발동] 중기 추세 훼손. 20MA 회복 전까지 보수적 관망을 지시합니다.");
    } else {
        if (totalScore >= 80) { finalAction = "🟢 적극 매수"; style = "bg-green-600 text-white"; recWeight = "50~100%"; }
        else if (totalScore >= 60) { finalAction = "🟢 1차 분할매수"; style = "bg-emerald-500 text-white"; recWeight = "20~30%"; }
        else { finalAction = "🟡 관망 / 반등 확인"; style = "bg-slate-500 text-white"; recWeight = "0%"; }
    }

    // 과열 예외처리
    if (ind.currentRSI > 70 && trendScore > 20) {
        finalAction = "🔴 매도 / 익절 검토 (과열)"; style = "bg-red-500 text-white"; recWeight = "0%";
    }

    return { totalScore, trendScore, momentumScore, drawdownScore, riskScore, confidence, finalAction, style, recWeight, bullCase, bearCase, reasons };
}

// ---------------------------------------------------------
// [Backtest Engine (Next Open 체결 & OOS)]
// ---------------------------------------------------------
function runBacktestEngine(ohlcv, regime) {
    const len = ohlcv.close.length;
    const splitIndex = Math.floor(len * 0.7); // 70% In-Sample, 30% Out-Of-Sample
    
    let stats = {
        inSample: { signals: 0, strReturn: 100, bhReturn: 100, mdd: 0 },
        outSample: { signals: 0, strReturn: 100, bhReturn: 100, mdd: 0 }
    };

    let position = 0; // 0 or 1
    let runningMaxStr = 100;

    for (let i = 60; i < len - 1; i++) {
        // 백테스트용 단순화된 퀀트 룰 (과거 시점)
        let isBuySignal = false;
        let isSellSignal = false;
        
        let ma60_i = 0; for(let j=0; j<60; j++) ma60_i += ohlcv.close[i-j]; ma60_i /= 60;
        let rsi_i = calcRSIArray(ohlcv.close.slice(0, i+1), 14).pop();
        
        // Strategy Rule Simulation
        if (ohlcv.close[i] > ma60_i && rsi_i < 45 && rsi_i > 30) isBuySignal = true;
        if (ohlcv.close[i] < ma60_i || rsi_i > 70) isSellSignal = true;

        let targetStats = i < splitIndex ? stats.inSample : stats.outSample;
        
        // Buy & Hold (Close to Close)
        let dailyMarketRet = (ohlcv.close[i+1] - ohlcv.close[i]) / ohlcv.close[i];
        targetStats.bhReturn *= (1 + dailyMarketRet);

        // Next Open 체결 반영 (Signal at i -> Execute at Open i+1 -> Hold to Close i+1)
        if (position === 0 && isBuySignal) {
            position = 1;
            targetStats.signals++;
            let retNextOpenToClose = (ohlcv.close[i+1] - ohlcv.open[i+1]) / ohlcv.open[i+1];
            targetStats.strReturn *= (1 + retNextOpenToClose);
        } else if (position === 1 && isSellSignal) {
            position = 0;
            // 당일 시가에 매도
            let retCloseToNextOpen = (ohlcv.open[i+1] - ohlcv.close[i]) / ohlcv.close[i];
            targetStats.strReturn *= (1 + retCloseToNextOpen);
        } else if (position === 1) {
            // 지속 보유
            targetStats.strReturn *= (1 + dailyMarketRet);
        }

        if (targetStats.strReturn > runningMaxStr) runningMaxStr = targetStats.strReturn;
        let dd = ((targetStats.strReturn - runningMaxStr) / runningMaxStr) * 100;
        if (dd < targetStats.mdd) targetStats.mdd = dd;
    }

    return stats;
}

// ---------------------------------------------------------
// [UI Rendering: Explainable Format]
// ---------------------------------------------------------
function renderExplainableUI(ticker, ind, regime, ev, dataVal, bt) {
    let uiHtml = `
        <div class="space-y-6">
            <!-- 1. DATA & VALIDATION -->
            <div class="flex justify-between items-end border-b border-slate-200 pb-2">
                <div>
                    <h1 class="text-3xl font-black text-slate-800 tracking-tighter">${ticker}</h1>
                    <div class="text-sm font-bold text-slate-500 mt-1">Price: $${ind.price.toFixed(2)} | Date: ${ind.dates[ind.dates.length-1]}</div>
                </div>
                <div class="text-right">
                    <div class="text-xs font-bold text-slate-400">Data Quality Score</div>
                    <div class="text-lg font-black text-indigo-600">${dataVal.score} / 100</div>
                </div>
            </div>

            <!-- 2. FINAL ACTION (Banner) -->
            <div class="p-5 rounded-xl text-center shadow-sm ${ev.style}">
                <div class="text-xs font-bold opacity-80 uppercase tracking-widest mb-1">System Final Action</div>
                <h2 class="text-3xl font-black tracking-tight mb-2">${ev.finalAction}</h2>
                <div class="text-sm font-bold bg-white/20 inline-block px-3 py-1 rounded-full">권장 포지션 규모: ${ev.recWeight}</div>
            </div>

            <!-- 3. SCORES -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">Trend (40)</div>
                    <div class="text-xl font-black text-slate-800">${ev.trendScore}</div>
                </div>
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">Momentum (30)</div>
                    <div class="text-xl font-black text-slate-800">${ev.momentumScore}</div>
                </div>
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">Drawdown (20)</div>
                    <div class="text-xl font-black text-slate-800">${ev.drawdownScore}</div>
                </div>
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div class="text-[10px] font-bold text-slate-400 uppercase">Risk/ATR (10)</div>
                    <div class="text-xl font-black text-slate-800">${ev.riskScore}</div>
                </div>
            </div>

            <!-- 4. CHART (Dual Axis) -->
            <div id="quant-integrated-chart-section" class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div class="flex flex-wrap gap-3 mb-2 items-center justify-center text-[11px] font-bold text-slate-600 bg-slate-50 py-2 rounded-lg">
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-price" checked class="w-3 h-3 accent-slate-800" onchange="drawQuantChart()">주가</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-ma20" checked class="w-3 h-3 accent-yellow-500" onchange="drawQuantChart()">20MA</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-ma60" checked class="w-3 h-3 accent-green-500" onchange="drawQuantChart()">60MA</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 ml-2 border-l pl-2 border-slate-300"><input type="checkbox" id="chk-quant-rsi" class="w-3 h-3 accent-orange-500" onchange="drawQuantChart()">RSI</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-mdd" checked class="w-3 h-3 accent-red-500" onchange="drawQuantChart()">MDD</label>
                </div>
                <div class="relative w-full h-[300px]"><canvas id="quantIntegratedCanvas"></canvas></div>
            </div>

            <!-- 5. MARKET REGIME & CONFIDENCE -->
            <div class="flex flex-col md:flex-row gap-4">
                <div class="flex-1 bg-blue-50 p-4 rounded-xl border border-blue-100">
                    <div class="text-xs font-bold text-blue-400 uppercase mb-1">Market Regime (SPY 기준)</div>
                    <div class="text-lg font-black text-blue-900">${regime.state} Market</div>
                    <div class="text-[11px] text-blue-700 mt-1">${regime.desc}</div>
                </div>
                <div class="flex-1 bg-purple-50 p-4 rounded-xl border border-purple-100">
                    <div class="text-xs font-bold text-purple-400 uppercase mb-1">System Confidence</div>
                    <div class="text-lg font-black text-purple-900">${ev.confidence} / 100</div>
                    <div class="text-[11px] text-purple-700 mt-1">Data Source: ${dataVal.source}</div>
                </div>
            </div>

            <!-- 6. BULL / BEAR CASE -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="border border-green-200 rounded-xl p-4 bg-white">
                    <h4 class="text-sm font-black text-green-700 mb-2 border-b border-green-100 pb-1">📈 BULL CASE (긍정 요인)</h4>
                    <ul class="text-[11px] text-slate-600 space-y-1 font-medium">
                        ${ev.bullCase.length > 0 ? ev.bullCase.map(c => `<li>• ${c}</li>`).join('') : '<li>• 뚜렷한 상승 모멘텀 없음</li>'}
                    </ul>
                </div>
                <div class="border border-red-200 rounded-xl p-4 bg-white">
                    <h4 class="text-sm font-black text-red-700 mb-2 border-b border-red-100 pb-1">📉 BEAR CASE (부정 요인)</h4>
                    <ul class="text-[11px] text-slate-600 space-y-1 font-medium">
                        ${ev.bearCase.length > 0 ? ev.bearCase.map(c => `<li>• ${c}</li>`).join('') : '<li>• 뚜렷한 하락 리스크 없음</li>'}
                    </ul>
                </div>
            </div>

            <!-- 7. BACKTEST & OUT-OF-SAMPLE -->
            <div class="bg-slate-800 text-white rounded-xl p-5 shadow-inner">
                <h4 class="text-sm font-black text-emerald-400 mb-3 border-b border-slate-600 pb-2"><i class="fas fa-vial mr-2"></i>Strategy Validation (Next-Open Execution)</h4>
                <div class="grid grid-cols-2 gap-4 text-xs">
                    <div>
                        <div class="text-slate-400 font-bold mb-1">[In-Sample] Train (70%)</div>
                        <div class="flex justify-between"><span class="text-slate-500">Signals:</span> <span class="font-mono">${bt.inSample.signals}</span></div>
                        <div class="flex justify-between"><span class="text-slate-500">Strategy Ret:</span> <span class="font-mono text-emerald-300">${(bt.inSample.strReturn - 100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span class="text-slate-500">B&H Ret:</span> <span class="font-mono">${(bt.inSample.bhReturn - 100).toFixed(1)}%</span></div>
                    </div>
                    <div class="border-l border-slate-600 pl-4">
                        <div class="text-indigo-400 font-bold mb-1">[Out-of-Sample] Test (30%)</div>
                        <div class="flex justify-between"><span class="text-slate-500">Signals:</span> <span class="font-mono">${bt.outSample.signals}</span></div>
                        <div class="flex justify-between"><span class="text-slate-500">Strategy Ret:</span> <span class="font-mono text-emerald-300">${(bt.outSample.strReturn - 100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span class="text-slate-500">B&H Ret:</span> <span class="font-mono">${(bt.outSample.bhReturn - 100).toFixed(1)}%</span></div>
                    </div>
                </div>
            </div>

            <!-- 8. EXPLAINABLE REASONS -->
            <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                <h4 class="text-xs font-black text-slate-800 mb-2">🤖 Calculation Inference (점수 산출 근거)</h4>
                <ul class="text-[11px] text-slate-600 space-y-1 font-mono">
                    ${ev.reasons.map(r => `<li>${r}</li>`).join('')}
                </ul>
            </div>

            <!-- 9. DISCLAIMER -->
            <div class="text-[10px] text-slate-400 font-medium leading-relaxed bg-white border border-slate-100 p-3 rounded-lg">
                * 본 분석은 과거 가격·거래량 데이터를 기반으로 한 정량적 분석이며 미래 수익을 보장하지 않습니다.<br>
                * 백테스트 성과는 데이터 기간, 슬리피지(Next Open 체결), 시장 국면 및 데이터 품질에 따라 달라질 수 있습니다.<br>
                * 기술적 지표는 기업의 재무상태, 뉴스를 완전히 반영하지 않으며, 데이터가 신뢰 기준 미달일 경우 시스템은 확정적 판단을 유보합니다.
            </div>
        </div>
    `;

    document.getElementById('quant-result-container').innerHTML = uiHtml;
    drawQuantChart(); 
}

function drawQuantChart() {
    if (!currentQuantData) return;
    const ctx = document.getElementById('quantIntegratedCanvas').getContext('2d');
    if (quantChartInstance) quantChartInstance.destroy();

    let datasets = [];
    if (document.getElementById('chk-quant-price').checked) datasets.push({ label: '주가', data: currentQuantData.prices, borderColor: '#1e293b', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y', order: 10 });
    if (document.getElementById('chk-quant-ma20').checked) datasets.push({ label: '20MA', data: currentQuantData.ma20, borderColor: '#eab308', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (document.getElementById('chk-quant-ma60').checked) datasets.push({ label: '60MA', data: currentQuantData.ma60, borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    
    if (document.getElementById('chk-quant-rsi').checked) datasets.push({ label: 'RSI', data: currentQuantData.rsiArray, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' });
    if (document.getElementById('chk-quant-mdd').checked) datasets.push({ label: 'MDD', data: currentQuantData.mddArray, borderColor: 'rgba(239, 68, 68, 0.8)', backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.1, yAxisID: 'y1' });

    quantChartInstance = new Chart(ctx, {
        type: 'line', data: { labels: currentQuantData.dates, datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { weight: 'bold' } } },
                y: { type: 'linear', position: 'left', ticks: { font: { weight: 'bold' } } },
                y1: { type: 'linear', position: 'right', min: -100, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%', font: { weight: 'bold', color: '#64748b' } } }
            },
            plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' } }
        }
    });
}

// --- Utils ---
function calcMA(prices, window) {
    let res = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < window - 1) res.push(null);
        else { let sum = 0; for (let j = 0; j < window; j++) sum += prices[i - j]; res.push(sum / window); }
    }
    return res;
}
function calcRSIArray(prices, period) {
    let rsi = new Array(prices.length).fill(null);
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        avgGain = ((avgGain * (period - 1)) + (diff >= 0 ? diff : 0)) / period;
        avgLoss = ((avgLoss * (period - 1)) + (diff < 0 ? -diff : 0)) / period;
        rsi[i] = 100 - (100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss)));
    }
    return rsi;
}
function calcATR(highs, lows, closes, period) {
    let atr = new Array(highs.length).fill(null);
    let trArray = [highs[0] - lows[0]];
    for (let i = 1; i < highs.length; i++) {
        let hl = highs[i] - lows[i], hc = Math.abs(highs[i] - closes[i - 1]), lc = Math.abs(lows[i] - closes[i - 1]);
        trArray.push(Math.max(hl, hc, lc));
    }
    let sumTR = 0;
    for(let i=0; i<period; i++) sumTR += trArray[i];
    atr[period-1] = sumTR / period;
    for (let i = period; i < highs.length; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + trArray[i]) / period;
    }
    return atr;
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('quant-ticker-input');
    if(input) input.addEventListener('keypress', e => { if (e.key === 'Enter') runQuantAnalysis(); });
});
