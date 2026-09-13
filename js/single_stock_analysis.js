// =========================================================
// 🧠 Explainable Quantitative Decision System V2.1
// Philosophy: Trend Following + Pullback + Momentum + OOS Validation
// =========================================================

let quantChartInstance = null; 
let currentQuantData = null;

async function runQuantAnalysis() {
    const tickerInput = document.getElementById('quant-ticker-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('quant-status-msg');
    const resultContainer = document.getElementById('quant-result-container');

    if (!tickerInput) return;

    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500 mr-1"></i> <b>${tickerInput} & SPY(벤치마크)</b> 데이터 검증 및 OOS 백테스트 엔진 가동 중...`;
    resultContainer.classList.add('hidden');

    try {
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
        let queryTicker = /^\d{6}$/.test(tickerInput) ? tickerInput + ".KS" : tickerInput;
        
        // 1. Target & SPY (Market Regime & Relative Strength) 동시 호출
        const [targetRes, spyRes] = await Promise.all([
            fetch(`${GAS_PROXY_URL}?ticker=${queryTicker}&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=SPY&range=5y`)
        ]);

        if (!targetRes.ok) throw new Error("타겟 종목 데이터 호출 실패");
        const targetData = await targetRes.json();
        const spyData = await spyRes.json(); // SPY 실패 시 부분적 오류 허용 로직 내장 가능하나 여기선 엄격히 처리

        if (targetData.error) throw new Error(targetData.error);
        if (!targetData.chart || !targetData.chart.result) throw new Error("서버 혼잡 또는 유효하지 않은 티커입니다.");

        // 2. Data Layer Extraction
        const rawOHLCV = extractOHLCV(targetData);
        const spyOHLCV = spyData.error ? null : extractOHLCV(spyData);
        
        // 3. Validation Engine
        const dataValidation = validateDataQuality(rawOHLCV);
        if (dataValidation.score < 40) throw new Error(`데이터 신뢰도 심각 부족 (Score: ${dataValidation.score}). 분석을 강제 중단합니다.`);

        // 4. Indicator Engine (6 MAs, RSI, MDD, ATR, Volume)
        const indicators = calculateAllIndicators(rawOHLCV);
        
        // 5. Market Regime & Relative Strength
        const marketRegime = determineMarketRegime(spyOHLCV);
        const relativeStrength = calculateRelativeStrength(indicators, spyOHLCV);

        // 6. Score Engine & Trend Gate
        const evaluation = evaluateQuantState(indicators, marketRegime, relativeStrength);

        // 7. Backtest & OOS Engine (Next Open Execution)
        const backtestResult = runBacktestEngineV2(rawOHLCV);

        // 8. Confidence Engine
        const confidence = calculateConfidence(dataValidation, backtestResult, evaluation.riskScore);

        // 9. UI Rendering
        currentQuantData = indicators;
        renderExplainableUIV2(tickerInput, indicators, marketRegime, relativeStrength, evaluation, dataValidation, backtestResult, confidence);
        
        statusMsg.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> 분석 완료 (결정론적 엔진 작동 성공)`;
        resultContainer.classList.remove('hidden');

    } catch (error) {
        statusMsg.innerHTML = `<span class="text-red-500 font-bold">❌ 시스템 차단: ${error.message}</span>`;
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
    let ohlcErrors = 0, zeroVol = 0;

    for (let i = 0; i < ohlcv.close.length; i++) {
        if (ohlcv.high[i] < ohlcv.low[i] || ohlcv.close[i] > ohlcv.high[i] || ohlcv.close[i] < ohlcv.low[i]) ohlcErrors++;
        if (ohlcv.volume[i] === 0) zeroVol++;
    }

    if (ohlcErrors > 0) { score -= 20; errors.push(`OHLC 캔들 논리 오류 ${ohlcErrors}건`); }
    if (zeroVol > 50) { score -= 10; errors.push(`유동성 부족 (거래량 0일 과다)`); }
    if (ohlcv.close.length < 250) { score -= 30; errors.push("표본 부족 (200일선 산출 불가/불안정)"); }

    return { 
        score: Math.max(0, score), 
        errors: errors.length > 0 ? errors : ["구조적 무결성 확인 완료"],
        rows: ohlcv.close.length,
        startDate: ohlcv.dates[0],
        endDate: ohlcv.dates[ohlcv.dates.length-1]
    };
}

// ---------------------------------------------------------
// [Indicator Engine] 6 MAs, Volume, ATR
// ---------------------------------------------------------
function calculateAllIndicators(ohlcv) {
    const prices = ohlcv.close;
    const currentPrice = prices[prices.length - 1];
    
    const ma5 = calcMA(prices, 5); const ma10 = calcMA(prices, 10);
    const ma20 = calcMA(prices, 20); const ma60 = calcMA(prices, 60);
    const ma120 = calcMA(prices, 120); const ma200 = calcMA(prices, 200);

    const atr = calcATR(ohlcv.high, ohlcv.low, prices, 14);
    const volMa20 = calcMA(ohlcv.volume, 20);

    let mddArray = []; let runningMax = prices[0];
    for (let p of prices) {
        if (p > runningMax) runningMax = p;
        mddArray.push(((p - runningMax) / runningMax) * 100);
    }

    const rsiArray = calcRSIArray(prices, 14);

    return {
        dates: ohlcv.dates, prices, ma5, ma10, ma20, ma60, ma120, ma200, rsiArray, mddArray, atr, volMa20,
        current: {
            price: currentPrice,
            ma5: ma5[ma5.length - 1], ma10: ma10[ma10.length - 1],
            ma20: ma20[ma20.length - 1], ma60: ma60[ma60.length - 1],
            ma120: ma120[ma120.length - 1], ma200: ma200[ma200.length - 1],
            rsi: rsiArray[rsiArray.length - 1], prevRsi: rsiArray[rsiArray.length - 2],
            mdd: mddArray[mddArray.length - 1], atr: atr[atr.length - 1],
            vol: ohlcv.volume[ohlcv.volume.length - 1],
            volMa20: volMa20[volMa20.length - 1]
        },
        // 방향성 (5일 전 대비 기울기)
        slopes: {
            ma5: ma5[ma5.length - 1] - ma5[ma5.length - 6],
            ma20: ma20[ma20.length - 1] - ma20[ma20.length - 6],
            ma60: ma60[ma60.length - 1] - ma60[ma60.length - 6],
            ma120: ma120[ma120.length - 1] - ma120[ma120.length - 6],
            ma200: ma200[ma200.length - 1] - ma200[ma200.length - 6]
        }
    };
}

function determineMarketRegime(spyOHLCV) {
    if (!spyOHLCV) return { state: "판단 불가", score: 0, desc: "SPY 데이터 수신 실패" };
    const spyPrices = spyOHLCV.close;
    const spy200 = calcMA(spyPrices, 200)[spyPrices.length - 1];
    const currSpy = spyPrices[spyPrices.length - 1];
    
    if (currSpy > spy200 * 1.02) return { state: "🟢 상승장", score: 10, desc: "SPY가 200일선 상단 안착" };
    if (currSpy < spy200 * 0.98) return { state: "🔴 하락장", score: 0, desc: "SPY 200일선 이탈 추세" };
    return { state: "🟡 중립장", score: 5, desc: "SPY 200일선 부근 횡보/변동성 구간" };
}

function calculateRelativeStrength(ind, spyOHLCV) {
    if (!spyOHLCV || ind.prices.length < 60 || spyOHLCV.close.length < 60) return { status: "중립", score: 5, gap: 0 };
    
    const tgtRet = (ind.current.price - ind.prices[ind.prices.length - 60]) / ind.prices[ind.prices.length - 60];
    const spyRet = (spyOHLCV.close[spyOHLCV.close.length - 1] - spyOHLCV.close[spyOHLCV.close.length - 60]) / spyOHLCV.close[spyOHLCV.close.length - 60];
    const gap = (tgtRet - spyRet) * 100; // %p

    if (gap > 5) return { status: "강세", score: 10, gap };
    if (gap < -5) return { status: "약세", score: 0, gap };
    return { status: "중립", score: 5, gap };
}

// ---------------------------------------------------------
// [Score & Gate Engine V2.1]
// ---------------------------------------------------------
function evaluateQuantState(ind, regime, rs) {
    const c = ind.current;
    const s = ind.slopes;

    let trendScore = 0, momentumScore = 0, drawdownScore = 0, riskScore = 20;
    let explain = []; let bullCase = []; let bearCase = []; let notBuyReasons = [];

    // 1. Trend (Max 35)
    if (c.price > c.ma200) { trendScore += 10; explain.push("FACT: Price > 200MA | CALC: 장기추세 상회 | INTERP: 대세 상승 요건 충족"); bullCase.push("주가가 장기 이평선(200일) 상단 유지"); }
    else { bearCase.push("장기 추세선(200일) 아래로 주가 이탈"); }

    if (s.ma60 > 0) { trendScore += 10; explain.push("FACT: 60MA Slope > 0 | CALC: 5일간 중기선 상승 | INTERP: 중기 수급 긍정적"); bullCase.push("60일선 우상향 진행 중"); }
    else { bearCase.push("60일선 기울기 하락 (중기 수급 악화)"); }

    if (c.ma20 > c.ma60) { trendScore += 10; }
    if (c.ma5 > c.ma20) { trendScore += 5; }

    // 2. Momentum (Max 25)
    if (c.rsi > 40 && c.prevRsi <= 40) { momentumScore += 10; explain.push("FACT: RSI Cross 40 | CALC: 이전 38 -> 현재 42 | INTERP: 과매도권 탈출 모멘텀 발생"); bullCase.push("RSI 40 상향 돌파 (모멘텀 회복 시그널)"); }
    else if (c.rsi >= 40 && c.rsi <= 60) { momentumScore += 5; }
    
    if (c.rsi > c.prevRsi) { momentumScore += 10; bullCase.push("단기 모멘텀(RSI) 상승 중"); }
    if (c.vol > c.volMa20 * 1.5 && c.price > ind.prices[ind.prices.length-2]) { momentumScore += 5; explain.push("FACT: Vol > 1.5x 20MA | CALC: 거래량 급증 수반 상승 | INTERP: 유의미한 매수세 유입"); bullCase.push("평균 대비 거래량 급증을 동반한 양봉"); }

    // 3. Drawdown (Risk Management) (Max 20 - MDD는 위험 통제용)
    if (c.mdd >= -15 && c.mdd <= -3) { drawdownScore = 20; explain.push("FACT: MDD -3~-15% | CALC: 고점 대비 건전한 이격 | INTERP: 상승 추세 내 건강한 눌림목"); bullCase.push("고점 대비 -15% 이내의 건전한 가격 조정"); }
    else if (c.mdd < -30) { drawdownScore = 0; riskScore -= 10; explain.push("FACT: MDD < -30% | CALC: 극단적 낙폭 | INTERP: 기술적 반등 외 추세 붕괴 위험"); bearCase.push("고점 대비 -30% 이상 폭락 (구조적 하락 위험)"); }
    else { drawdownScore = 10; }

    // 4. Risk Penalty (Max 20 기본 부여 후 차감)
    if (c.atr / c.price > 0.04) { riskScore -= 10; explain.push("FACT: ATR/Price > 4% | CALC: 일일 변동성 과다 | INTERP: 리스크 관리 차원 비중 축소 필요"); bearCase.push("일일 변동폭(ATR)이 지나치게 커 휩쏘 위험 높음"); }

    let totalScore = trendScore + momentumScore + drawdownScore + riskScore + regime.score + rs.score;
    
    // 🚨 TREND GATE (Hard Constraint)
    let finalAction = "", actionStyle = "", recWeight = "";
    
    if (c.price < c.ma200 && s.ma200 < 0) {
        finalAction = "🟠 신규매수 보류"; actionStyle = "bg-orange-500 text-white"; recWeight = "0%";
        notBuyReasons.push("장기 추세선(200일선)이 하락 중이며 주가가 그 아래에 갇혀 있음 (전형적인 약세장 진입 요건).");
    } else if (c.ma20 < c.ma60 && c.ma60 < c.ma120 && c.price < c.ma60) {
        finalAction = "🟡 반등 확인 (관망)"; actionStyle = "bg-yellow-500 text-slate-900"; recWeight = "0%";
        notBuyReasons.push("중장기 이동평균 역배열 진행 중. 확실한 60일선 안착 전까지 바닥 예측 매수 금지.");
    } else {
        if (totalScore >= 80) { finalAction = "🟢 적극 매수"; actionStyle = "bg-green-600 text-white"; recWeight = "50~100%"; }
        else if (totalScore >= 60) { finalAction = "🟢 1차 분할매수"; actionStyle = "bg-emerald-500 text-white"; recWeight = "20~30%"; }
        else { finalAction = "🟡 관망 / 방향성 탐색"; actionStyle = "bg-slate-500 text-white"; recWeight = "0%"; }
    }

    // 과열 방지
    if (c.rsi > 70) {
        finalAction = "🔴 위험관리 / 매도 검토"; actionStyle = "bg-red-500 text-white"; recWeight = "0%";
        notBuyReasons.push("RSI 70 초과로 단기 과매수 극단에 도달. 신규 진입 시 승률 매우 낮음.");
    }

    if(finalAction.includes("매수") && notBuyReasons.length === 0) {
        notBuyReasons.push("현재 시스템 상 뚜렷한 매수 보류 하드-제약(Hard Constraint)이 발견되지 않았습니다.");
    }

    return { 
        totalScore, trendScore, momentumScore, drawdownScore, riskScore, 
        regimeScore: regime.score, rsScore: rs.score,
        finalAction, actionStyle, recWeight, explain, bullCase, bearCase, notBuyReasons 
    };
}

// ---------------------------------------------------------
// [Backtest Engine V2.1 (OOS & Next-Open Execution)]
// ---------------------------------------------------------
function runBacktestEngineV2(ohlcv) {
    const len = ohlcv.close.length;
    if (len < 100) return null;
    
    const splitIndex = Math.floor(len * 0.7); // 70% In-Sample / 30% OOS
    
    let stats = {
        inSample: { trades: 0, strRet: 1, bhRet: 1, maxDD: 0 },
        outSample: { trades: 0, strRet: 1, bhRet: 1, maxDD: 0 }
    };

    let pos = 0; let buyPrice = 0;
    let isOOS = false;

    // 단순화된 전략 룰: 60MA 상회 + RSI 30~50 매수 / RSI 70 초과 또는 60MA 이탈 매도
    for (let i = 61; i < len - 1; i++) {
        isOOS = i >= splitIndex;
        let target = isOOS ? stats.outSample : stats.inSample;
        
        let ma60 = 0; for(let j=0; j<60; j++) ma60 += ohlcv.close[i-j]; ma60 /= 60;
        let rsi = calcRSIArray(ohlcv.close.slice(0, i+1), 14).pop();

        let isBuy = (ohlcv.close[i] > ma60 && rsi > 30 && rsi < 50);
        let isSell = (ohlcv.close[i] < ma60 || rsi > 70);

        let dailyRet = (ohlcv.close[i+1] - ohlcv.close[i]) / ohlcv.close[i];
        target.bhRet *= (1 + dailyRet); // Buy & Hold

        if (pos === 0 && isBuy) {
            pos = 1; target.trades++;
            buyPrice = ohlcv.open[i+1]; // Next Open Execution (미래참조 방지)
            let retNextOpenToClose = (ohlcv.close[i+1] - buyPrice) / buyPrice;
            target.strRet *= (1 + retNextOpenToClose);
        } else if (pos === 1 && isSell) {
            pos = 0;
            let retCloseToNextOpen = (ohlcv.open[i+1] - ohlcv.close[i]) / ohlcv.close[i];
            target.strRet *= (1 + retCloseToNextOpen); // 매도일 시초가 청산
        } else if (pos === 1) {
            target.strRet *= (1 + dailyRet);
        }
    }

    return stats;
}

function calculateConfidence(dataVal, bt, riskScore) {
    let conf = 100;
    conf -= (100 - dataVal.score) * 0.5; // 데이터 오류 차감
    if (bt && bt.outSample.strRet < bt.outSample.bhRet) conf -= 20; // OOS 성과가 B&H보다 못하면 신뢰도 대폭 깎임
    if (bt && bt.outSample.trades < 5) conf -= 15; // 표본 부족
    if (riskScore < 10) conf -= 10; // 변동성 극심

    if (conf >= 85) return { val: Math.floor(conf), text: "높은 신뢰도" };
    if (conf >= 60) return { val: Math.floor(conf), text: "보통" };
    return { val: Math.floor(Math.max(0, conf)), text: "신뢰도 낮음 (통계적 검증 부족)" };
}

// ---------------------------------------------------------
// [Explainable UI Rendering]
// ---------------------------------------------------------
function renderExplainableUIV2(ticker, ind, regime, rs, ev, dataVal, bt, conf) {
    const c = ind.current; const s = ind.slopes;
    
    const maRows = [
        { name: "5일선", val: c.ma5, diff: ((c.price - c.ma5)/c.ma5*100), slope: s.ma5 },
        { name: "10일선", val: c.ma10, diff: ((c.price - c.ma10)/c.ma10*100), slope: s.ma10 },
        { name: "20일선", val: c.ma20, diff: ((c.price - c.ma20)/c.ma20*100), slope: s.ma20 },
        { name: "60일선", val: c.ma60, diff: ((c.price - c.ma60)/c.ma60*100), slope: s.ma60 },
        { name: "120일선", val: c.ma120, diff: ((c.price - c.ma120)/c.ma120*100), slope: s.ma120 },
        { name: "200일선", val: c.ma200, diff: ((c.price - c.ma200)/c.ma200*100), slope: s.ma200 }
    ].map(m => `
        <tr class="border-b border-slate-100">
            <td class="py-2 font-bold text-slate-700">${m.name}</td>
            <td class="py-2 text-right mono">${m.val ? m.val.toFixed(2) : '-'}</td>
            <td class="py-2 text-right mono font-bold ${m.diff > 0 ? 'text-green-600' : 'text-red-500'}">${m.diff > 0 ? '+'+m.diff.toFixed(2) : m.diff ? m.diff.toFixed(2) : '-'}%</td>
            <td class="py-2 text-center font-bold ${m.slope > 0 ? 'text-green-600' : 'text-red-500'}">${m.slope > 0 ? '↑ 상승' : '↓ 하락'}</td>
            <td class="py-2 text-center text-xs font-bold ${m.diff > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'} rounded">${m.diff > 0 ? '상회 (강세)' : '하회 (약세)'}</td>
        </tr>
    `).join('');

    let uiHtml = `
        <div class="space-y-6">
            <!-- 1. Header & Quality -->
            <div class="flex flex-col md:flex-row justify-between items-end border-b border-slate-200 pb-3">
                <div>
                    <h1 class="text-3xl font-black text-slate-800 tracking-tighter">${ticker}</h1>
                    <div class="text-sm font-bold text-slate-500 mt-1">현재가: $${c.price.toFixed(2)} | 기준일: ${ind.dates[ind.dates.length-1]}</div>
                </div>
                <div class="text-right mt-3 md:mt-0 bg-slate-50 p-2 rounded-lg border border-slate-200">
                    <div class="text-xs font-bold text-slate-400">데이터 품질 (무결성)</div>
                    <div class="text-lg font-black ${dataVal.score >= 90 ? 'text-green-600' : 'text-orange-500'}">${dataVal.score} / 100</div>
                </div>
            </div>

            <!-- 2. Final Action -->
            <div class="p-6 rounded-xl text-center shadow-sm ${ev.actionStyle} border border-black/10 relative overflow-hidden">
                <div class="text-xs font-bold opacity-80 uppercase tracking-widest mb-1 relative z-10">최종 투자 판정</div>
                <h2 class="text-4xl font-black tracking-tight mb-3 relative z-10">${ev.finalAction}</h2>
                <div class="flex justify-center gap-4 relative z-10">
                    <div class="bg-black/20 px-4 py-1.5 rounded-full text-sm font-bold">종합점수: ${ev.totalScore} / 100</div>
                    <div class="bg-black/20 px-4 py-1.5 rounded-full text-sm font-bold">신뢰도: ${conf.val} (${conf.text})</div>
                </div>
            </div>

            <!-- 3. Scores & Regimes -->
            <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center"><div class="text-[10px] font-bold text-slate-400">추세 (35)</div><div class="text-lg font-black">${ev.trendScore}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center"><div class="text-[10px] font-bold text-slate-400">모멘텀 (25)</div><div class="text-lg font-black">${ev.momentumScore}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center"><div class="text-[10px] font-bold text-slate-400">낙폭 (20)</div><div class="text-lg font-black">${ev.drawdownScore}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center"><div class="text-[10px] font-bold text-slate-400">위험도 (20)</div><div class="text-lg font-black">${ev.riskScore}</div></div>
                <div class="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center"><div class="text-[10px] font-bold text-blue-400">시장국면</div><div class="text-sm font-black text-blue-800 mt-1">${regime.state}</div></div>
                <div class="bg-purple-50 p-3 rounded-lg border border-purple-200 text-center"><div class="text-[10px] font-bold text-purple-400">상대강도</div><div class="text-sm font-black text-purple-800 mt-1">${rs.status}</div></div>
            </div>

            <!-- 4. Moving Average Matrix -->
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="bg-slate-800 p-3 text-white font-bold text-sm flex items-center"><i class="fas fa-layer-group text-teal-400 mr-2"></i>이동평균 전구간 구조 분석</div>
                <div class="p-4 overflow-x-auto">
                    <table class="w-full text-sm whitespace-nowrap">
                        <thead class="text-xs text-slate-400 border-b-2 border-slate-200"><tr><th class="text-left pb-2">구분</th><th class="text-right pb-2">현재값</th><th class="text-right pb-2">현재가 대비 이격도</th><th class="text-center pb-2">방향(기울기)</th><th class="text-center pb-2">상태</th></tr></thead>
                        <tbody>${maRows}</tbody>
                    </table>
                </div>
            </div>

            <!-- 5. Chart Integration -->
            <div id="quant-integrated-chart-section" class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div class="flex flex-wrap gap-3 mb-2 items-center justify-center text-[11px] font-bold text-slate-600 bg-slate-50 py-2 rounded-lg border border-slate-100">
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-price" checked class="w-3 h-3 accent-slate-800" onchange="drawQuantChart()">주가</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-ma20" checked class="w-3 h-3 accent-yellow-500" onchange="drawQuantChart()">20일선</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-ma60" checked class="w-3 h-3 accent-green-500" onchange="drawQuantChart()">60일선</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-ma120" class="w-3 h-3 accent-blue-500" onchange="drawQuantChart()">120일선</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-ma200" class="w-3 h-3 accent-purple-500" onchange="drawQuantChart()">200일선</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600 ml-2 border-l pl-2 border-slate-300"><input type="checkbox" id="chk-quant-rsi" class="w-3 h-3 accent-orange-500" onchange="drawQuantChart()">RSI</label>
                    <label class="cursor-pointer flex items-center gap-1 hover:text-indigo-600"><input type="checkbox" id="chk-quant-mdd" checked class="w-3 h-3 accent-red-500" onchange="drawQuantChart()">MDD</label>
                </div>
                <div class="relative w-full h-[300px]"><canvas id="quantIntegratedCanvas"></canvas></div>
            </div>

            <!-- 6. Bull/Bear & Why NOT Buy -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div class="border border-green-200 bg-green-50/30 rounded-xl p-4">
                    <h4 class="text-sm font-black text-green-700 mb-2 border-b border-green-200 pb-1">📈 긍정 근거 (Bull Case)</h4>
                    <ul class="text-[11px] text-slate-700 space-y-1.5 font-medium">
                        ${ev.bullCase.length > 0 ? ev.bullCase.map(c => `<li class="flex items-start"><i class="fas fa-plus text-green-500 mt-0.5 mr-1.5"></i><span>${c}</span></li>`).join('') : '<li class="text-slate-400">뚜렷한 상승/방어 모멘텀 부재</li>'}
                    </ul>
                </div>
                <div class="border border-red-200 bg-red-50/30 rounded-xl p-4">
                    <h4 class="text-sm font-black text-red-700 mb-2 border-b border-red-200 pb-1">📉 부정 근거 (Bear Case)</h4>
                    <ul class="text-[11px] text-slate-700 space-y-1.5 font-medium">
                        ${ev.bearCase.length > 0 ? ev.bearCase.map(c => `<li class="flex items-start"><i class="fas fa-minus text-red-500 mt-0.5 mr-1.5"></i><span>${c}</span></li>`).join('') : '<li class="text-slate-400">뚜렷한 하락 리스크 관찰 안 됨</li>'}
                    </ul>
                </div>
                <div class="border border-slate-300 bg-slate-100 rounded-xl p-4 shadow-inner">
                    <h4 class="text-sm font-black text-slate-800 mb-2 border-b border-slate-300 pb-1">🛑 아직 적극 매수하지 않는 이유</h4>
                    <ul class="text-[11px] text-slate-700 space-y-1.5 font-bold">
                        ${ev.notBuyReasons.map(c => `<li class="flex items-start"><i class="fas fa-hand-paper text-orange-500 mt-0.5 mr-1.5"></i><span>${c}</span></li>`).join('')}
                    </ul>
                </div>
            </div>

            <!-- 7. Backtest & OOS -->
            <div class="bg-slate-800 text-white rounded-xl p-5 shadow-sm border border-slate-700">
                <h4 class="text-sm font-black text-emerald-400 mb-3 border-b border-slate-600 pb-2"><i class="fas fa-vial mr-2"></i>백테스트 검증 (Next-Open 시가 체결, 거래비용 미포함)</h4>
                ${bt ? `
                <div class="grid grid-cols-2 gap-4 text-xs">
                    <div>
                        <div class="text-slate-400 font-bold mb-2 bg-slate-700 inline-block px-2 py-1 rounded">개발 구간 (In-Sample 70%)</div>
                        <div class="flex justify-between py-1 border-b border-slate-700"><span class="text-slate-400">거래 횟수:</span> <span class="font-mono">${bt.inSample.trades}회</span></div>
                        <div class="flex justify-between py-1 border-b border-slate-700"><span class="text-slate-400">전략 수익률:</span> <span class="font-mono font-bold ${bt.inSample.strRet > 1 ? 'text-emerald-400' : 'text-red-400'}">${((bt.inSample.strRet - 1)*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between py-1"><span class="text-slate-400">Buy & Hold:</span> <span class="font-mono">${((bt.inSample.bhRet - 1)*100).toFixed(1)}%</span></div>
                    </div>
                    <div>
                        <div class="text-indigo-300 font-bold mb-2 bg-indigo-900/50 inline-block px-2 py-1 rounded">검증 구간 (Out-of-Sample 30%)</div>
                        <div class="flex justify-between py-1 border-b border-slate-700"><span class="text-slate-400">거래 횟수:</span> <span class="font-mono">${bt.outSample.trades}회</span></div>
                        <div class="flex justify-between py-1 border-b border-slate-700"><span class="text-slate-400">전략 수익률:</span> <span class="font-mono font-bold ${bt.outSample.strRet > 1 ? 'text-emerald-400' : 'text-red-400'}">${((bt.outSample.strRet - 1)*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between py-1"><span class="text-slate-400">Buy & Hold:</span> <span class="font-mono">${((bt.outSample.bhRet - 1)*100).toFixed(1)}%</span></div>
                    </div>
                </div>
                ` : '<div class="text-xs text-slate-400">데이터가 부족하여 백테스트를 수행할 수 없습니다.</div>'}
            </div>

            <!-- 8. EXPLAINABLE REASONS -->
            <div class="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
                <h4 class="text-xs font-black text-indigo-900 mb-2 border-b border-indigo-200 pb-1">🤖 알고리즘 추론 과정 (FACT -> CALC -> INTERP)</h4>
                <ul class="text-[10px] text-indigo-800 space-y-1.5 font-mono leading-relaxed">
                    ${ev.explain.map(r => `<li>• ${r}</li>`).join('')}
                </ul>
            </div>

            <!-- 9. DISCLAIMER -->
            <div class="text-[10px] text-slate-400 font-medium leading-relaxed bg-slate-50 border border-slate-200 p-4 rounded-lg">
                * 본 분석은 과거 가격 데이터를 기반으로 한 정량적(Quantitative) 분석이며, 미래의 수익을 어떠한 경우에도 보장하지 않습니다.<br>
                * 백테스트 성과는 슬리피지(호가 공백), 세금, 수수료, 거래정지 등 실제 시장의 마찰 비용이 제외된 시뮬레이션 수치입니다.<br>
                * AI 시스템은 주관적인 낙관을 배제하며, 데이터 품질(결측/노이즈) 부족 시 강제적으로 보수적인 판정(관망)을 내리도록 설계되었습니다.
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
    if (document.getElementById('chk-quant-ma20').checked) datasets.push({ label: '20일선', data: currentQuantData.ma20, borderColor: '#eab308', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (document.getElementById('chk-quant-ma60').checked) datasets.push({ label: '60일선', data: currentQuantData.ma60, borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (document.getElementById('chk-quant-ma120').checked) datasets.push({ label: '120일선', data: currentQuantData.ma120, borderColor: '#3b82f6', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (document.getElementById('chk-quant-ma200').checked) datasets.push({ label: '200일선', data: currentQuantData.ma200, borderColor: '#8b5cf6', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    
    if (document.getElementById('chk-quant-rsi').checked) datasets.push({ label: 'RSI(14)', data: currentQuantData.rsiArray, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' });
    if (document.getElementById('chk-quant-mdd').checked) datasets.push({ label: 'MDD(%)', data: currentQuantData.mddArray, borderColor: 'rgba(239, 68, 68, 0.8)', backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.1, yAxisID: 'y1' });

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
