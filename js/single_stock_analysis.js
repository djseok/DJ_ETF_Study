// =========================================================
// 🧠 Explainable Quantitative Decision System (EQDS) V2.2
// =========================================================

let quantChartInstance = null;
let currentQuantData = null;

async function runQuantAnalysis() {
    const tickerInput = document.getElementById('quant-ticker-input').value.trim().toUpperCase();
    const statusMsg = document.getElementById('quant-status-msg');
    const resultContainer = document.getElementById('quant-result-container');

    if (!tickerInput) return;

    statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500 mr-1"></i> <b>${tickerInput}</b> 5년 시계열 검증 및 Market(S&P500/NASDAQ-100) 동기화 중...`;
    resultContainer.classList.add('hidden');

    try {
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
        let queryTicker = /^\d{6}$/.test(tickerInput) ? tickerInput + ".KS" : tickerInput;

        // 1. Target, SPY(S&P500), QQQ(NASDAQ-100) 병렬 동시 호출
        const [targetRes, spyRes, qqqRes] = await Promise.all([
            fetch(`${GAS_PROXY_URL}?ticker=${queryTicker}&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=SPY&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=QQQ&range=5y`)
        ]);

        if (!targetRes.ok) throw new Error("타겟 종목 데이터 호출 실패");
        const targetData = await targetRes.json();
        const spyData = await spyRes.json();
        const qqqData = await qqqRes.json();

        if (targetData.error) throw new Error(targetData.error);
        if (!targetData.chart || !targetData.chart.result) throw new Error("서버 혼잡 또는 유효하지 않은 티커입니다.");

        // 2. Data Layer Extraction & Validation
        const rawOHLCV = extractOHLCV(targetData);
        const spyOHLCV = spyData.error ? null : extractOHLCV(spyData);
        const qqqOHLCV = qqqData.error ? null : extractOHLCV(qqqData);

        const dataValidation = validateDataQuality(rawOHLCV);
        if (dataValidation.score < 40) throw new Error(`데이터 신뢰도 심각 부족 (Score: ${dataValidation.score}).`);

        // 3. Indicator Engine (7 MAs, RSI, Multi-MDD, ATR, Volume)
        const indicators = calculateAllIndicators(rawOHLCV);

        // 4. Market Environment & Relative Strength
        const marketRegime = determineMarketRegime(spyOHLCV, qqqOHLCV);
        const relativeStrength = calculateRelativeStrength(indicators, spyOHLCV, qqqOHLCV);

        // 5. Score Engine & Hard Gates
        const evaluation = evaluateQuantState(indicators, marketRegime, relativeStrength);

        // 6. Backtest & OOS Engine (Next Open Execution + Slippage)
        const backtestResult = runBacktestEngineV2_2(rawOHLCV);

        // 7. Confidence Engine
        const confidence = calculateConfidence(dataValidation, backtestResult, evaluation.riskScore);

        // 8. Explainable UI Rendering
        currentQuantData = indicators;
        renderExplainableUIV2_2(tickerInput, indicators, marketRegime, relativeStrength, evaluation, dataValidation, backtestResult, confidence);

        statusMsg.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> 분석 완료`;
        resultContainer.classList.remove('hidden');

    } catch (error) {
        statusMsg.innerHTML = `<span class="text-red-500 font-bold">❌ 시스템 차단: ${error.message}</span>`;
    }
}

// --- Data Layer ---
function extractOHLCV(data) {
    const timestamps = data.chart.result[0].timestamp;
    const quote = data.chart.result[0].indicators.quote[0];
    let result = { dates: [], open: [], high: [], low: [], close: [], volume: [] };
    for(let i = 0; i < quote.close.length; i++) {
        if(quote.close[i] !== null && quote.open[i] !== null) {
            const d = new Date(timestamps[i] * 1000);
            result.dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
            result.open.push(quote.open[i]); result.high.push(quote.high[i]);
            result.low.push(quote.low[i]); result.close.push(quote.close[i]);
            result.volume.push(quote.volume[i] || 0);
        }
    }
    return result;
}

function validateDataQuality(ohlcv) {
    let score = 100; let errors = []; let ohlcErrors = 0, zeroVol = 0;
    for (let i = 0; i < ohlcv.close.length; i++) {
        if (ohlcv.high[i] < ohlcv.low[i] || ohlcv.close[i] > ohlcv.high[i] || ohlcv.close[i] < ohlcv.low[i]) ohlcErrors++;
        if (ohlcv.volume[i] === 0) zeroVol++;
    }
    if (ohlcErrors > 0) { score -= 20; errors.push(`OHLC 구조 오류 ${ohlcErrors}건`); }
    if (zeroVol > 50) { score -= 10; errors.push(`유동성 부족 (거래량 0일 과다)`); }
    if (ohlcv.close.length < 250) { score -= 30; errors.push("표본 부족 (200일선 산출 불안정)"); }
    return { score: Math.max(0, score), errors: errors.length > 0 ? errors : ["정상"], rows: ohlcv.close.length };
}

// --- Indicators Engine ---
function calculateAllIndicators(ohlcv) {
    const p = ohlcv.close;
    const curP = p[p.length - 1];

    const ma5 = calcMA(p, 5); const ma10 = calcMA(p, 10); const ma15 = calcMA(p, 15);
    const ma20 = calcMA(p, 20); const ma60 = calcMA(p, 60);
    const ma120 = calcMA(p, 120); const ma200 = calcMA(p, 200);

    const atr = calcATR(ohlcv.high, ohlcv.low, p, 14);
    const volMa20 = calcMA(ohlcv.volume, 20);

    // Multi-MDD & Recovery Ratio
    let runningMax = p[0], runningMin = p[0];
    let mddArr = [];
    for (let i=0; i<p.length; i++) {
        if (p[i] > runningMax) { runningMax = p[i]; runningMin = p[i]; }
        if (p[i] < runningMin) { runningMin = p[i]; }
        mddArr.push(((p[i] - runningMax) / runningMax) * 100);
    }
    const curMDD = mddArr[mddArr.length - 1];
    const recoveryRatio = runningMax - runningMin === 0 ? 0 : ((curP - runningMin) / (runningMax - runningMin)) * 100;

    const rsi = calcRSIArray(p, 14);

    // Trend Stage (0 ~ 9)
    let stage = 0;
    if(mddArr[mddArr.length-1] > mddArr[mddArr.length-5]) stage = 1;
    if(curP > ma5[ma5.length-1]) stage = 2;
    if(curP > ma10[ma10.length-1]) stage = 3;
    if(curP > ma15[ma15.length-1]) stage = 4;
    if(curP > ma20[ma20.length-1]) stage = 5;
    if(ma20[ma20.length-1] > ma20[ma20.length-5]) stage = 6;
    if(curP > ma60[ma60.length-1]) stage = 7;
    if(ma60[ma60.length-1] > ma60[ma60.length-5]) stage = 8;
    if(curP > ma120[ma120.length-1]) stage = 9;
    if(curP > ma200[ma200.length-1]) stage = 9;

    return {
        dates: ohlcv.dates, prices: p, 
        ma5, ma10, ma15, ma20, ma60, ma120, ma200, rsiArray: rsi, mddArray: mddArr, atr, volMa20,
        current: {
            price: curP, ma5: ma5[ma5.length-1], ma10: ma10[ma10.length-1], ma15: ma15[ma15.length-1],
            ma20: ma20[ma20.length-1], ma60: ma60[ma60.length-1], ma120: ma120[ma120.length-1], ma200: ma200[ma200.length-1],
            rsi: rsi[rsi.length-1], prevRsi: rsi[rsi.length-2],
            mdd: curMDD, recovery: recoveryRatio, atr: atr[atr.length-1], vol: ohlcv.volume[ohlcv.volume.length-1], volMa20: volMa20[volMa20.length-1]
        },
        slopes: {
            ma20: ma20[ma20.length-1] - ma20[ma20.length-5],
            ma60: ma60[ma60.length-1] - ma60[ma60.length-5],
            ma200: ma200[ma200.length-1] - ma200[ma200.length-5]
        },
        stage
    };
}

function determineMarketRegime(spy, qqq) {
    if(!spy || !qqq) return { state: "데이터 부족 (N/A)", score: 7 };
    const spy200 = calcMA(spy.close, 200).pop();
    const qqq200 = calcMA(qqq.close, 200).pop();
    const sCur = spy.close[spy.close.length-1], qCur = qqq.close[qqq.close.length-1];

    if(sCur > spy200 && qCur > qqq200) return { state: "🟢 S&P500 & NASDAQ-100 모두 상승장", score: 15 };
    if(sCur < spy200 && qCur < qqq200) return { state: "🔴 S&P500 & NASDAQ-100 모두 하락장", score: 0 };
    return { state: "🟡 S&P500 / NASDAQ-100 지수 간 혼조장", score: 7 };
}

function calculateRelativeStrength(ind, spy, qqq) {
    if(!spy || !qqq || ind.prices.length < 60) return { status: "N/A", score: 7 };
    const tRet = (ind.current.price / ind.prices[ind.prices.length-60]) - 1;
    const sRet = (spy.close[spy.close.length-1] / spy.close[spy.close.length-60]) - 1;
    const qRet = (qqq.close[qqq.close.length-1] / qqq.close[qqq.close.length-60]) - 1;
    
    if(tRet > sRet && tRet > qRet) return { status: "강세 (S&P500 / NASDAQ-100 모두 초과)", score: 15 };
    if(tRet < sRet && tRet < qRet) return { status: "약세 (S&P500 / NASDAQ-100 모두 하회)", score: 0 };
    return { status: "보통 (지수 혼조 수렴)", score: 7 };
}

// --- Score & Hard Gates Engine ---
function evaluateQuantState(ind, regime, rs) {
    const c = ind.current; const s = ind.slopes;
    let trend = 0, mom = 0, ddRisk = 0;
    let exp = []; let bull = []; let bear = []; let whyNot = [];

    // Trend (Max 25)
    if(c.price > c.ma200) { trend+=10; exp.push("FACT: Price > 200MA | CALC: 이격도 양수 | INTERP: 대세 상승 요건 충족"); bull.push("주가가 장기 이평선(200일) 상단 유지"); } else bear.push("장기 추세선(200일) 하회");
    if(c.ma20 > c.ma60) { trend+=10; exp.push("FACT: 20MA > 60MA | CALC: 정배열 초기 | INTERP: 중기 수급 우위"); }
    if(s.ma60 > 0) { trend+=5; bull.push("60일선 우상향 진행 중"); }

    // Momentum (Max 15)
    if(c.rsi > 40 && c.prevRsi <= 40) { mom+=10; exp.push("FACT: RSI Cross 40 | CALC: 상승돌파 | INTERP: 단기 모멘텀 개선"); bull.push("RSI 40 상향 돌파"); }
    if(c.vol > c.volMa20*1.5) { mom+=5; bull.push("평균 대비 거래량 급증 수반"); }

    // Drawdown / Risk (Max 15)
    if(c.mdd >= -15 && c.mdd <= -3) { ddRisk=15; exp.push("FACT: MDD -3~-15% | CALC: 건전 이격 | INTERP: 건강한 눌림목"); }
    else if(c.mdd < -30) { ddRisk=0; bear.push("고점 대비 -30% 이상 폭락"); }
    else { ddRisk=8; }

    // Base Score (Tech 85 + Market 15 + RS 15 = 115 Max -> Scaled to 100)
    let rawScore = trend + mom + ddRisk + regime.score + rs.score;
    let score = Math.floor((rawScore / 115) * 100);

    // HARD GATES (Action Capping)
    let act = "", sty = "", pos = "";
    if (c.price < c.ma200 && s.ma200 < 0) {
        act = "🟡 신규매수 보류"; sty = "bg-orange-500 text-white"; pos = "0%";
        whyNot.push("장기 추세선(200일) 우하향 및 주가 하회 (구조적 약세장).");
    } else if (c.ma20 < c.ma60 && c.price < c.ma60) {
        act = "🟡 반등 확인 (관망)"; sty = "bg-yellow-500 text-slate-900"; pos = "0%";
        whyNot.push("중기 역배열 상태. 60일선 안착 전까지 예측 매수 금지.");
    } else if (c.rsi > 70) {
        act = "🔴 위험관리 / 매도 검토"; sty = "bg-red-500 text-white"; pos = "0%";
        whyNot.push("RSI 70 초과 과열권. 추격 매수 금지.");
    } else {
        if(score >= 80) { act = "🟢 적극 매수"; sty = "bg-green-600 text-white"; pos = "50~100%"; }
        else if(score >= 60) { act = "🟢 1차 분할매수"; sty = "bg-emerald-500 text-white"; pos = "20~30%"; }
        else { act = "🟡 관망"; sty = "bg-slate-500 text-white"; pos = "0%"; }
    }

    if(act.includes("매수") && whyNot.length === 0) whyNot.push("현재 시스템상 치명적인 하드 게이트 제약이 발견되지 않음.");

    return { score, act, sty, pos, exp, bull, bear, whyNot };
}

// --- Backtest Engine (Next Open Execution + Transaction Cost) ---
function runBacktestEngineV2_2(ohlcv) {
    const len = ohlcv.close.length;
    if(len < 100) return null;
    const split = Math.floor(len * 0.7); // 70% In-Sample / 30% Out-of-Sample
    const slipTax = 0.0015; // 0.15% 슬리피지/마찰비용 가정

    let stats = { inSample: { t:0, str:1, bh:1 }, outSample: { t:0, str:1, bh:1 } };
    let pos = 0, bPx = 0;

    for(let i=61; i<len-1; i++){
        let target = i >= split ? stats.outSample : stats.inSample;
        let ma60 = 0; for(let j=0; j<60; j++) ma60+=ohlcv.close[i-j]; ma60/=60;
        let rsi = calcRSIArray(ohlcv.close.slice(0,i+1),14).pop();

        let isBuy = (ohlcv.close[i] > ma60 && rsi > 30 && rsi < 50);
        let isSell = (ohlcv.close[i] < ma60 || rsi > 70);

        let dRet = (ohlcv.close[i+1]-ohlcv.close[i])/ohlcv.close[i];
        target.bh *= (1+dRet);

        if(pos===0 && isBuy) {
            pos=1; target.t++; bPx = ohlcv.open[i+1] * (1+slipTax); // Next Open 체결
            target.str *= (ohlcv.close[i+1]/bPx);
        } else if(pos===1 && isSell) {
            pos=0; target.str *= ((ohlcv.open[i+1]*(1-slipTax))/ohlcv.close[i]);
        } else if(pos===1) {
            target.str *= (1+dRet);
        }
    }
    return stats;
}

function calculateConfidence(dataVal, bt, riskScore) {
    let conf = 100 - (100 - dataVal.score)*0.5;
    if(bt && bt.outSample.str < bt.outSample.bh) conf -= 20;
    if(bt && bt.outSample.t < 3) conf -= 20; // OOS 표본 부족 페널티
    if(conf >= 80) return { val: Math.floor(conf), t: "높음" };
    if(conf >= 50) return { val: Math.floor(conf), t: "보통" };
    return { val: Math.floor(Math.max(0, conf)), t: "낮음 (통계적 신뢰 한계)" };
}

// --- UI Rendering ---
function renderExplainableUIV2_2(ticker, ind, reg, rs, ev, dv, bt, conf) {
    const c = ind.current;
    const maRows = [
        { n:"5일선", v:c.ma5, d:((c.price-c.ma5)/c.ma5*100) }, { n:"10일선", v:c.ma10, d:((c.price-c.ma10)/c.ma10*100) },
        { n:"15일선", v:c.ma15, d:((c.price-c.ma15)/c.ma15*100) }, { n:"20일선", v:c.ma20, d:((c.price-c.ma20)/c.ma20*100) },
        { n:"60일선", v:c.ma60, d:((c.price-c.ma60)/c.ma60*100) }, { n:"120일선", v:c.ma120, d:((c.price-c.ma120)/c.ma120*100) },
        { n:"200일선", v:c.ma200, d:((c.price-c.ma200)/c.ma200*100) }
    ].map(m => `
        <tr class="border-b border-slate-100">
            <td class="py-2 font-bold text-slate-700">${m.n}</td><td class="py-2 text-right mono">${m.v?m.v.toFixed(2):'-'}</td>
            <td class="py-2 text-right mono font-bold ${m.d>0?'text-green-600':'text-red-500'}">${m.d>0?'+'+m.d.toFixed(2):m.d?m.d.toFixed(2):'-'}%</td>
            <td class="py-2 text-center text-xs font-bold ${m.d>0?'bg-green-50 text-green-700':'bg-red-50 text-red-700'} rounded">${m.d>0?'상회':'하회'}</td>
        </tr>
    `).join('');

    let h = `
        <div class="space-y-6">
            <div class="flex justify-between items-end border-b border-slate-200 pb-3">
                <div><h1 class="text-3xl font-black text-slate-800">${ticker}</h1><div class="text-sm font-bold text-slate-500 mt-1">현재가: $${c.price.toFixed(2)} | 데이터품질: ${dv.score}/100</div></div>
            </div>
            
            <div class="p-6 rounded-xl text-center shadow-sm ${ev.sty} border border-black/10">
                <div class="text-xs font-bold opacity-80 uppercase tracking-widest mb-1">최종 투자 판정</div>
                <h2 class="text-4xl font-black mb-3">${ev.act}</h2>
                <div class="flex justify-center gap-4">
                    <div class="bg-black/20 px-4 py-1.5 rounded-full text-sm font-bold">점수: ${ev.score}</div>
                    <div class="bg-black/20 px-4 py-1.5 rounded-full text-sm font-bold">신뢰도: ${conf.val} (${conf.t})</div>
                    <div class="bg-black/20 px-4 py-1.5 rounded-full text-sm font-bold">권장비중: ${ev.pos}</div>
                </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div class="bg-slate-50 p-3 rounded-lg text-center"><div class="text-xs font-bold text-slate-400">시장 환경 (S&P500 / NASDAQ-100)</div><div class="text-sm font-black text-blue-800 mt-1">${reg.state}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg text-center"><div class="text-xs font-bold text-slate-400">상대강도 (지수 대비)</div><div class="text-sm font-black text-purple-800 mt-1">${rs.status}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg text-center"><div class="text-xs font-bold text-slate-400">추세 전환 Stage</div><div class="text-sm font-black text-emerald-800 mt-1">Stage ${ind.stage} / 9</div></div>
                <div class="bg-slate-50 p-3 rounded-lg text-center"><div class="text-xs font-bold text-slate-400">낙폭 회복률</div><div class="text-sm font-black text-orange-800 mt-1">${c.recovery.toFixed(1)}%</div></div>
            </div>

            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="bg-slate-800 p-3 text-white font-bold text-sm">이동평균 (7 MAs) 구조 분석</div>
                <div class="p-4 overflow-x-auto">
                    <table class="w-full text-sm whitespace-nowrap"><thead class="text-xs text-slate-400 border-b-2 border-slate-200"><tr><th class="text-left pb-2">구분</th><th class="text-right pb-2">현재값</th><th class="text-right pb-2">이격도</th><th class="text-center pb-2">상태</th></tr></thead><tbody>${maRows}</tbody></table>
                </div>
            </div>

            <div id="quant-integrated-chart-section" class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div class="flex flex-wrap gap-2 mb-2 items-center justify-center text-[11px] font-bold text-slate-600 bg-slate-50 py-2 rounded-lg">
                    <label><input type="checkbox" id="chk-quant-price" checked onchange="drawQuantChart()">주가</label>
                    <label><input type="checkbox" id="chk-quant-ma20" checked onchange="drawQuantChart()">20MA</label>
                    <label><input type="checkbox" id="chk-quant-ma60" checked onchange="drawQuantChart()">60MA</label>
                    <label><input type="checkbox" id="chk-quant-ma200" onchange="drawQuantChart()">200MA</label>
                    <label class="ml-2 border-l pl-2"><input type="checkbox" id="chk-quant-rsi" checked onchange="drawQuantChart()">RSI</label>
                    <label><input type="checkbox" id="chk-quant-mdd" onchange="drawQuantChart()">MDD</label>
                </div>
                <div class="relative w-full h-[300px]"><canvas id="quantIntegratedCanvas"></canvas></div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div class="border border-green-200 bg-green-50/30 rounded-xl p-4">
                    <h4 class="text-sm font-black text-green-700 mb-2 border-b border-green-200 pb-1">📈 긍정 근거 (BUY CASE)</h4>
                    <ul class="text-[11px] text-slate-700 space-y-1.5 font-medium">${ev.bull.length?ev.bull.map(c=>`<li>+ ${c}</li>`).join(''):'<li>없음</li>'}</ul>
                </div>
                <div class="border border-red-200 bg-red-50/30 rounded-xl p-4">
                    <h4 class="text-sm font-black text-red-700 mb-2 border-b border-red-200 pb-1">📉 부정 근거 (BEAR CASE)</h4>
                    <ul class="text-[11px] text-slate-700 space-y-1.5 font-medium">${ev.bear.length?ev.bear.map(c=>`<li>- ${c}</li>`).join(''):'<li>없음</li>'}</ul>
                </div>
                <div class="border border-slate-300 bg-slate-100 rounded-xl p-4 shadow-inner">
                    <h4 class="text-sm font-black text-slate-800 mb-2 border-b border-slate-300 pb-1">🛑 아직 매수하지 않는 이유</h4>
                    <ul class="text-[11px] text-slate-700 space-y-1.5 font-bold">${ev.whyNot.map(c=>`<li>• ${c}</li>`).join('')}</ul>
                </div>
            </div>

            <div class="bg-slate-800 text-white rounded-xl p-5">
                <h4 class="text-sm font-black text-emerald-400 mb-3 border-b border-slate-600 pb-2">백테스트 검증 (Next-Open 시가 체결 / 비용 반영)</h4>
                ${bt ? `
                <div class="grid grid-cols-2 gap-4 text-xs">
                    <div>
                        <div class="text-slate-400 font-bold mb-2 bg-slate-700 px-2 py-1 rounded">개발 구간 (In-Sample 70%)</div>
                        <div>전략: <span class="${bt.inSample.str>1?'text-emerald-400':'text-red-400'}">${((bt.inSample.str-1)*100).toFixed(1)}%</span></div>
                        <div>Buy & Hold: <span>${((bt.inSample.bh-1)*100).toFixed(1)}%</span></div>
                    </div>
                    <div>
                        <div class="text-indigo-300 font-bold mb-2 bg-indigo-900 px-2 py-1 rounded">검증 구간 (Out-of-Sample 30%)</div>
                        <div>전략: <span class="${bt.outSample.str>1?'text-emerald-400':'text-red-400'}">${((bt.outSample.str-1)*100).toFixed(1)}%</span></div>
                        <div>Buy & Hold: <span>${((bt.outSample.bh-1)*100).toFixed(1)}%</span></div>
                    </div>
                </div>` : '<div class="text-xs">데이터 부족</div>'}
            </div>

            <div class="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
                <h4 class="text-xs font-black text-indigo-900 mb-2 border-b border-indigo-200 pb-1">계산 근거 (FACT -> CALC -> INTERP)</h4>
                <ul class="text-[10px] text-indigo-800 space-y-1 font-mono">${ev.exp.map(r=>`<li>• ${r}</li>`).join('')}</ul>
            </div>
            
            <div class="text-[10px] text-slate-400 font-medium bg-slate-50 border border-slate-200 p-3 rounded">
                * 펀더멘털 및 섹터 데이터는 API 제공 범위 한계로 N/A 처리되었으며, 100점 만점으로 자동 스케일링 되었습니다. <br>
                * OOS 백테스트는 슬리피지/세금을 반영한 결과이므로 미래 수익을 보장하지 않습니다.
            </div>
        </div>
    `;
    document.getElementById('quant-result-container').innerHTML = h;
    drawQuantChart();
}

function drawQuantChart() {
    if (!currentQuantData) return;
    const ctx = document.getElementById('quantIntegratedCanvas').getContext('2d');
    if (quantChartInstance) quantChartInstance.destroy();

    let ds = [];
    if (document.getElementById('chk-quant-price').checked) ds.push({ label: '주가', data: currentQuantData.prices, borderColor: '#1e293b', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y', order: 10 });
    if (document.getElementById('chk-quant-ma20').checked) ds.push({ label: '20일선', data: currentQuantData.ma20, borderColor: '#eab308', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (document.getElementById('chk-quant-ma60').checked) ds.push({ label: '60일선', data: currentQuantData.ma60, borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (document.getElementById('chk-quant-ma200').checked) ds.push({ label: '200일선', data: currentQuantData.ma200, borderColor: '#8b5cf6', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (document.getElementById('chk-quant-rsi').checked) ds.push({ label: 'RSI(14)', data: currentQuantData.rsiArray, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' });
    if (document.getElementById('chk-quant-mdd').checked) ds.push({ label: 'MDD(%)', data: currentQuantData.mddArray, borderColor: 'rgba(239, 68, 68, 0.8)', backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.1, yAxisID: 'y1' });

    quantChartInstance = new Chart(ctx, {
        type: 'line', data: { labels: currentQuantData.dates, datasets: ds },
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
function calcMA(prices, window) { let r = []; for(let i=0;i<prices.length;i++){ if(i<window-1) r.push(null); else { let s=0; for(let j=0;j<window;j++) s+=prices[i-j]; r.push(s/window); } } return r; }
function calcRSIArray(prices, period) {
    let rsi = new Array(prices.length).fill(null); let g=0, l=0;
    for(let i=1; i<=period; i++) { let d = prices[i]-prices[i-1]; if(d>=0) g+=d; else l-=d; }
    let ag = g/period, al = l/period;
    for(let i=period+1; i<prices.length; i++) {
        let d = prices[i]-prices[i-1];
        ag = (ag*(period-1)+(d>=0?d:0))/period; al = (al*(period-1)+(d<0?-d:0))/period;
        rsi[i] = 100 - (100/(1+(al===0?100:ag/al)));
    }
    return rsi;
}
function calcATR(h, l, c, period) {
    let atr = new Array(h.length).fill(null); let tr = [h[0]-l[0]];
    for(let i=1; i<h.length; i++) tr.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
    let str = 0; for(let i=0; i<period; i++) str+=tr[i]; atr[period-1] = str/period;
    for(let i=period; i<h.length; i++) atr[i] = (atr[i-1]*(period-1)+tr[i])/period;
    return atr;
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('quant-ticker-input');
    if(input) input.addEventListener('keypress', e => { if(e.key==='Enter') runQuantAnalysis(); });
});
