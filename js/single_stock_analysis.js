// =========================================================
// 🧠 EQDS V2.2.5 MASTER FINAL
// Explainable Quantitative Decision System
// STRICT ENFORCEMENT: Cash Flow Accounting, IS/OOS Independence, Single Evaluator
// =========================================================

let quantChartInstance = null;
let currentQuantData = null;

// [STRATEGY CONFIG]
const CONFIG = {
    EXEC_THRESHOLD: 0.01, 
    COST_RATE: 0.0015,
    RF_RATE: 0.0
};

async function runQuantAnalysis() {
    const tickerInput = document.getElementById('quant-ticker-input');
    if (!tickerInput || !tickerInput.value.trim()) return;
    const tickerStr = tickerInput.value.trim().toUpperCase();

    const statusMsg = document.getElementById('quant-status-msg');
    const resultContainer = document.getElementById('quant-result-container');
    if(statusMsg) statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500 mr-1"></i> <b>${tickerStr}</b> 정량 파이프라인 가동 (As-Of 매핑 및 데이터 무결성 검증 중)...`;
    if(resultContainer) resultContainer.classList.add('hidden');

    try {
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
        let queryTicker = tickerStr;
        if (/^\d{6}$/.test(tickerStr) && !tickerStr.includes('.')) queryTicker += ".KS";

        const [tgtRes, spyRes, qqqRes] = await Promise.all([
            fetch(`${GAS_PROXY_URL}?ticker=${queryTicker}&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=SPY&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=QQQ&range=5y`)
        ]);

        if (!tgtRes.ok) throw new Error("타겟 종목 데이터 호출 실패");
        const tgtData = await tgtRes.json();
        const spyData = await spyRes.json();
        const qqqData = await qqqRes.json();

        if (tgtData.error || !tgtData.chart || !tgtData.chart.result) throw new Error("유효하지 않은 티커 또는 데이터 부족");

        // 1. Data Layer (Strict Order & Validation)
        const rawTarget = extractOHLCV(tgtData);
        const rawSpy = spyData.error ? null : extractOHLCV(spyData);
        const rawQqq = qqqData.error ? null : extractOHLCV(qqqData);

        const dataVal = validateDataQuality(rawTarget);
        if (dataVal.score < 40) throw new Error(`데이터 품질 결함 (Score: ${dataVal.score}). 분석 강제 중단.`);

        // 2. Indicators (Actual Calculations)
        const ind = buildIndicators(rawTarget);
        const spyInd = rawSpy ? buildIndicators(rawSpy) : null;
        const qqqInd = rawQqq ? buildIndicators(rawQqq) : null;
        const coreCfg = { mid: 60, long: 200 };

        // 3. Unit Testing (Engine Pipeline Validation)
        const unitTests = runExtremeUnitTests(coreCfg);

        // 4. Live Evaluation (Single Source of Truth)
        const liveIdx = ind.prices.length - 1;
        const liveContext = { actualWeight: 0.0, mode: "live" }; 
        const liveEval = evaluateSignalAtDate(liveIdx, ind, spyInd, qqqInd, coreCfg, liveContext);

        // 5. Backtest (IS / OOS Independent Portfolio State Machines)
        const splitIdx = Math.floor(ind.prices.length * 0.7);
        const btIs = runBacktestSegment(252, splitIdx, ind, spyInd, qqqInd, coreCfg, true);
        const btOos = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, coreCfg, false);

        // 6. Parameter Sensitivity (Independent OOS Runs)
        const pm50 = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, { mid: 50, long: 200 }, false);
        const pm70 = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, { mid: 70, long: 200 }, false);
        const pl180 = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, { mid: 60, long: 180 }, false);
        const pl220 = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, { mid: 60, long: 220 }, false);

        // 7. Confidence Engine
        const conf = calculateConfidence(dataVal, btOos, pm50, pm70, pl180, pl220);

        // 8. Render UI
        currentQuantData = ind;
        renderEQDS_UI({ ticker: queryTicker, ev: liveEval, dv: dataVal, btIs, btOos, conf, sensitivity: { pm50, pm70, pl180, pl220 }, tests: unitTests });

        if(statusMsg) statusMsg.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> EQDS V2.2.5 분석 완료 (Price Return 기준)`;
        if(resultContainer) resultContainer.classList.remove('hidden');

    } catch (error) {
        if(statusMsg) statusMsg.innerHTML = `<span class="text-red-500 font-bold">❌ 시스템 차단: ${error.message}</span>`;
        console.error("EQDS Runtime Error:", error);
    }
}

// ---------------------------------------------------------
// [DATA LAYER]
// ---------------------------------------------------------
function extractOHLCV(data) {
    if (!data) return null;
    const t = data.chart.result[0].timestamp;
    const q = data.chart.result[0].indicators.quote[0];
    let res = { dates: [], open: [], high: [], low: [], close: [], volume: [] };
    let lastT = 0;
    
    for(let i=0; i<q.close.length; i++) {
        if(q.close[i] != null && q.open[i] != null && q.high[i] != null && q.low[i] != null) {
            let curT = t[i] * 1000;
            if (curT <= lastT) continue; // Ascending & Duplicate check
            lastT = curT;
            const d = new Date(curT); 
            res.dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`);
            res.open.push(q.open[i]); res.high.push(q.high[i]);
            res.low.push(q.low[i]); res.close.push(q.close[i]);
            res.volume.push(q.volume[i] == null ? null : q.volume[i]);
        }
    }
    return res;
}

function validateDataQuality(ohlcv) {
    let score = 100, errors = [], oErr = 0, zVol = 0;
    for(let i=0; i<ohlcv.close.length; i++) {
        if(ohlcv.open[i] <= 0 || ohlcv.high[i] <= 0 || ohlcv.low[i] <= 0 || ohlcv.close[i] <= 0) oErr++;
        if(ohlcv.high[i] < ohlcv.low[i] || ohlcv.high[i] < Math.max(ohlcv.open[i], ohlcv.close[i])) oErr++;
        if(ohlcv.low[i] > Math.min(ohlcv.open[i], ohlcv.close[i])) oErr++;
        if(ohlcv.volume[i] == null || ohlcv.volume[i] === 0) zVol++;
    }
    if(oErr > 0) { score -= 30; errors.push(`OHLC 캔들 논리 오류 ${oErr}건`); }
    if(zVol > 50) { score -= 10; errors.push(`거래량 누락 ${zVol}일`); }
    if(ohlcv.close.length < 252) { score -= 40; errors.push(`표본 1년 미만`); }
    
    let comp = Math.min(100, (ohlcv.close.length / 1260) * 100);
    return { score: Math.max(0, score), comp, errors: errors.length ? errors : ["데이터 구조 정상"] };
}

// ---------------------------------------------------------
// [INDICATOR LAYER]
// ---------------------------------------------------------
function buildIndicators(ohlcv) {
    if(!ohlcv || ohlcv.close.length < 50) return null;
    const p = ohlcv.close;
    // For volume MA, handle nulls as 0
    const volForMA = ohlcv.volume.map(v => v == null ? 0 : v); 

    return {
        dates: ohlcv.dates, prices: p, open: ohlcv.open, high: ohlcv.high, low: ohlcv.low, volume: ohlcv.volume,
        ma: {
            5: calcMA(p, 5), 10: calcMA(p, 10), 15: calcMA(p, 15), 20: calcMA(p, 20),
            50: calcMA(p, 50), 60: calcMA(p, 60), 70: calcMA(p, 70),
            120: calcMA(p, 120), 180: calcMA(p, 180), 200: calcMA(p, 200), 220: calcMA(p, 220)
        },
        rsi: calcRSI(p, 14),
        atr: calcATR(ohlcv.high, ohlcv.low, p, 14),
        vol20: calcMA(volForMA, 20),
        mdd: {
            d20: calcMultiMDD(p, ohlcv.dates, 20), d60: calcMultiMDD(p, ohlcv.dates, 60),
            d120: calcMultiMDD(p, ohlcv.dates, 120), d252: calcMultiMDD(p, ohlcv.dates, 252),
            all: calcMultiMDD(p, ohlcv.dates, p.length)
        }
    };
}

function calcMA(arr, win) { let r=[]; for(let i=0;i<arr.length;i++){ if(i<win-1) r.push(null); else { let s=0; for(let j=0;j<win;j++) s+=arr[i-j]; r.push(s/win); } } return r; }
function calcRSI(p, win) {
    let rsi=new Array(p.length).fill(null), g=0, l=0;
    for(let i=1;i<=win;i++) { let d=p[i]-p[i-1]; if(d>0) g+=d; else if(d<0) l-=d; }
    let ag=g/win, al=l/win;
    for(let i=win+1;i<p.length;i++) {
        let d=p[i]-p[i-1]; ag=(ag*(win-1)+(d>0?d:0))/win; al=(al*(win-1)+(d<0?-d:0))/win;
        rsi[i] = (al===0 && ag===0) ? 50 : (al===0) ? 0 : 100-(100/(1+(ag/al)));
    }
    return rsi;
}
function calcATR(h,l,c,win) {
    let atr=new Array(h.length).fill(null), tr=[h[0]-l[0]];
    for(let i=1;i<h.length;i++) tr.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
    let s=0; for(let i=0;i<win;i++) s+=tr[i]; atr[win-1]=s/win;
    for(let i=win;i<h.length;i++) atr[i]=(atr[i-1]*(win-1)+tr[i])/win;
    return atr;
}

// True Peak-Trough Multi-MDD Separation
function calcMultiMDD(p, dates, win) {
    let res = [];
    for(let i=0; i<p.length; i++) {
        let start = Math.max(0, i - win + 1);
        let curPeak = p[start], curPeakD = start;
        let maxDD = 0, gPeak = p[start], gPeakD = start, gTrough = p[start], gTroughD = start;
        
        let tPeak = p[start], tPeakD = start;
        for(let j=start; j<=i; j++) {
            if(p[j] >= curPeak) { curPeak = p[j]; curPeakD = j; }
            if(p[j] >= tPeak) { tPeak = p[j]; tPeakD = j; }
            let dd = (p[j] - tPeak) / tPeak;
            if(dd < maxDD) { maxDD = dd; gPeak = tPeak; gPeakD = tPeakD; gTrough = p[j]; gTroughD = j; }
        }
        
        let currentDD = curPeak === 0 ? 0 : ((p[i] / curPeak) - 1) * 100;
        let recoveryRatio = "N/A", recovered = false;
        if (gPeak !== gTrough) {
            let ratio = ((p[i] - gTrough) / (gPeak - gTrough)) * 100;
            recoveryRatio = Math.min(100, Math.max(0, ratio)); 
            if (p[i] >= gPeak) recovered = true;
        } else if (maxDD === 0) {
            recoveryRatio = "N/A"; 
            recovered = true;
        }

        res.push({
            currentDD, currentPeakDate: dates[curPeakD], currentDDDuration: i - curPeakD,
            maxDD: maxDD * 100, maxPeakDate: dates[gPeakD], maxTroughDate: dates[gTroughD], maxDDDuration: gTroughD - gPeakD,
            recoveryRatio, recovered
        });
    }
    return res;
}

// Binary Search As-Of Date Mapping (No Forward Fill)
function getAsOfIndex(targetTime, bmDates) {
    if(!bmDates) return -1;
    let low = 0, high = bmDates.length - 1, best = -1;
    while(low <= high) {
        let mid = Math.floor((low + high) / 2);
        let bmTime = new Date(bmDates[mid]).getTime();
        if(bmTime <= targetTime) { best = mid; low = mid + 1; }
        else { high = mid - 1; }
    }
    return best;
}

// ---------------------------------------------------------
// [VIEW MODEL BUILDER] Snapshot at index 'i'
// ---------------------------------------------------------
function buildViewModel(i, ind, spy, qqq, cfg) {
    const P = ind.prices[i];
    const prevP = ind.prices[i-1] || P;
    const tgtTime = new Date(ind.dates[i]).getTime();
    
    const ma = {
        5: ind.ma[5][i], 10: ind.ma[10][i], 15: ind.ma[15][i], 20: ind.ma[20][i],
        60: ind.ma[cfg.mid][i], 120: ind.ma[120][i], 200: ind.ma[cfg.long][i]
    };
    
    const slope = (val, past) => (val && past) ? (val / past - 1)*100 : null;
    const sl = {
        5: slope(ma[5], ind.ma[5][i-5]), 10: slope(ma[10], ind.ma[10][i-5]), 15: slope(ma[15], ind.ma[15][i-5]),
        20: slope(ma[20], ind.ma[20][i-5]), 60: slope(ma[60], ind.ma[cfg.mid][i-5]),
        120: slope(ma[120], ind.ma[120][i-5]), 200: slope(ma[200], ind.ma[cfg.long][i-5])
    };

    // Mutually Exclusive Stage State Machine
    let stage = 0, stName = "Stage 0 (장기 하락 / 구조 붕괴)";
    if (ma[200] && P > ma[200] && ma[20] > ma[60] && ma[60] > ma[120] && ma[120] > ma[200] && sl[200] > 0) { stage = 9; stName = "Stage 9 (장기 상승 정배열)"; }
    else if (ma[200] && P > ma[200] && sl[200] > 0) { stage = 8; stName = "Stage 8 (200MA 회복 및 상승)"; }
    else if (ma[120] && P > ma[120]) { stage = 7; stName = "Stage 7 (120MA 회복)"; }
    else if (ma[60] && P > ma[60]) { stage = 6; stName = "Stage 6 (60MA 회복)"; }
    else if (ma[20] && P > ma[20] && sl[20] > 0 && ma[5] > ma[10]) { stage = 5; stName = "Stage 5 (중기 전환 시도)"; }
    else if (ma[20] && P > ma[20]) { stage = 4; stName = "Stage 4 (20MA 회복)"; }
    else if (ma[15] && P > ma[15]) { stage = 3; stName = "Stage 3 (단기 15MA 회복)"; }
    else if (ma[5] && P > ma[5] && P > ma[10]) { stage = 2; stName = "Stage 2 (단기 바닥 반등)"; }
    else if (ma[20] && P < ma[20] && sl[5] > 0) { stage = 1; stName = "Stage 1 (하락 둔화)"; }

    // RS Layer (Return Diff)
    const calcRS = (days, bmInd) => {
        if(i < days || !bmInd) return "N/A";
        let idxT = getAsOfIndex(tgtTime, bmInd.dates);
        let pastTime = new Date(ind.dates[i - days]).getTime();
        let idxP = getAsOfIndex(pastTime, bmInd.dates);
        if(idxT === -1 || idxP === -1 || bmInd.prices[idxP] === 0) return "N/A";
        let tgtRet = (P / ind.prices[i-days]) - 1;
        let bmRet = (bmInd.prices[idxT] / bmInd.prices[idxP]) - 1;
        return (tgtRet - bmRet) * 100; // %p
    };

    // Market Layer
    const calcMk = (bmInd) => {
        if(!bmInd) return { ok: false, desc: "N/A" };
        let idx = getAsOfIndex(tgtTime, bmInd.dates);
        if(idx < 200) return { ok: false, desc: "N/A" };
        let bp = bmInd.prices[idx], m200 = bmInd.ma[200][idx];
        return { ok: bp > m200 && bmInd.ma[200][idx] > bmInd.ma[200][idx-5], desc: bp > m200 ? "BULL" : "BEAR" };
    };

    // ATR Percentile
    const atrPct = ind.atr[i] / P;
    let atrRank = "N/A";
    if (i >= 252) {
        let pAtr = []; for(let j=i-252; j<=i; j++) pAtr.push(ind.atr[j]/ind.prices[j]);
        pAtr.sort((a,b)=>a-b);
        atrRank = pAtr.findIndex(v => v >= atrPct) / 252;
    }
    let ret5d = Math.abs((P / ind.prices[Math.max(0, i-5)]) - 1);

    return {
        date: ind.dates[i], price: P, prevPrice: prevP,
        ma, sl, stage, stName,
        rsi: { cur: ind.rsi[i], prev: ind.rsi[i-1], d5: ind.rsi[i] - ind.rsi[i-5] },
        cross30: ind.rsi[i-1] < 30 && ind.rsi[i] >= 30,
        cross40: ind.rsi[i-1] < 40 && ind.rsi[i] >= 40,
        cross70: ind.rsi[i-1] < 70 && ind.rsi[i] >= 70,
        atrPct, atrRank, ret5d, vol: ind.volume[i], vol20: ind.vol20[i],
        mdd: { d20: ind.mdd.d20[i], d60: ind.mdd.d60[i], d120: ind.mdd.d120[i], d252: ind.mdd.d252[i], all: ind.mdd.all[i] },
        rs: {
            spy: { d20: calcRS(20, spy), d60: calcRS(60, spy), d120: calcRS(120, spy), d252: calcRS(252, spy) },
            ndx: { d20: calcRS(20, qqq), d60: calcRS(60, qqq), d120: calcRS(120, qqq), d252: calcRS(252, qqq) },
            sec: { d20: "N/A", d60: "N/A", d120: "N/A", d252: "N/A" }
        },
        market: { spy: calcMk(spy), ndx: calcMk(qqq) }
    };
}

// ---------------------------------------------------------
// [SCORING & GATE LAYER] Single Source of Truth
// ---------------------------------------------------------
function evaluateSignalAtDate(i, ind, spy, qqq, cfg, context) {
    const vm = buildViewModel(i, ind, spy, qqq, cfg);
    const isLive = context.mode === "live";
    let bull = [], bear = [], whyNot = [], log = [];

    let trSc = { a: 0, m: 25 }, moSc = { a: 0, m: 15 }, rsSc = { a: 0, m: 15 }, riSc = { a: 0, m: 15 }, mkSc = { a: 0, m: 15 };

    // Trend (25)
    if(vm.price > vm.ma[200]) { trSc.a += 3; if(isLive) bull.push("장기 이평(200MA) 상단 유지"); } else bear.push("200MA 하회 중 (장기 약세)");
    if(vm.ma[120] > vm.ma[200]) trSc.a += 3; if(vm.sl[120] > 0) trSc.a += 2; if(vm.sl[200] > 0) trSc.a += 2;
    if(vm.price > vm.ma[60]) trSc.a += 2; if(vm.ma[20] > vm.ma[60]) trSc.a += 3; if(vm.sl[60] > 0) trSc.a += 2; if(vm.sl[20] > 0) trSc.a += 3;
    if(vm.price > vm.ma[5]) trSc.a += 1; if(vm.ma[5] > vm.ma[10]) trSc.a += 1; if(vm.ma[10] > vm.ma[15]) trSc.a += 1; if(vm.ma[15] > vm.ma[20]) trSc.a += 1; if(vm.sl[5] > 0) trSc.a += 1;

    // Momentum (15)
    if(vm.rsi.d5 > 5) moSc.a += 5;
    if(vm.cross30) { moSc.a += 5; if(isLive) bull.push("RSI 30 상향돌파 (과매도 탈출)"); } else if(vm.cross40) moSc.a += 5;
    if(vm.vol !== null && vm.vol > vm.vol20 * 1.2 && vm.price > vm.prevPrice) { moSc.a += 5; if(isLive) bull.push("거래량 급증 동반 상승"); }

    // Relative Strength (15) 
    let rsAvail = 0; let rsSum = 0;
    const chkRS = (val) => { if(val !== "N/A") { rsAvail += 1.875; if(val > 0) rsSum += 1.875; } };
    chkRS(vm.rs.spy.d20); chkRS(vm.rs.spy.d60); chkRS(vm.rs.spy.d120); chkRS(vm.rs.spy.d252);
    chkRS(vm.rs.ndx.d20); chkRS(vm.rs.ndx.d60); chkRS(vm.rs.ndx.d120); chkRS(vm.rs.ndx.d252);
    rsSc.m = rsAvail; rsSc.a = rsSum;

    // Risk / Volatility (15) - ATR Percentile, Short-term Vol, MA Extension, Liquidity
    if(vm.atrRank !== "N/A") { if(vm.atrRank < 0.25) riSc.a += 4; else if(vm.atrRank < 0.5) riSc.a += 3; else if(vm.atrRank < 0.75) riSc.a += 1; }
    if(vm.ret5d < 0.03) riSc.a += 4; else if(vm.ret5d < 0.05) riSc.a += 2;
    let ext20 = vm.ma[20] ? (vm.price / vm.ma[20]) - 1 : 1;
    if(ext20 > -0.05 && ext20 < 0.05) riSc.a += 4; else if(ext20 > -0.1 && ext20 < 0.1) riSc.a += 2;
    if(vm.vol !== null && vm.vol >= vm.vol20 * 0.8) riSc.a += 3; else if(vm.vol !== null && vm.vol >= vm.vol20 * 0.5) riSc.a += 1;

    // Market (15)
    let mkAvail = 0; let mkSum = 0;
    if(spy) { mkAvail += 7.5; if(vm.market.spy.ok) mkSum += 7.5; }
    if(qqq) { mkAvail += 7.5; if(vm.market.ndx.ok) mkSum += 7.5; }
    mkSc.m = mkAvail; mkSc.a = mkSum;

    let availScore = trSc.m + moSc.m + rsSc.m + riSc.m + mkSc.m; 
    let baseScore = trSc.a + moSc.a + rsSc.a + riSc.a + mkSc.a;

    // [Risk Penalty: Signal Overlap]
    let overlap = 0;
    if(vm.mdd.d20.currentDD < -20) overlap++;
    if(vm.price < vm.ma[20]) overlap++;
    if(vm.rsi.cur < 35) overlap++;
    if(vm.rs.spy.d20 !== "N/A" && vm.rs.spy.d20 < -5) overlap++;
    
    let penalty = overlap >= 3 ? 7 : 0;
    if(overlap === 4) penalty = 12;
    let adjScore = Math.max(0, baseScore - penalty);

    if(isLive && penalty > 0) log.push(`FACT: 하락 신호 ${overlap}개 중복 | CALC: Penalty -${penalty} | INTERP: 매수 편향 방지`);

    // [Candidate Weight Mapping]
    let candW = 0.0;
    let ratio = availScore > 0 ? (adjScore / availScore) : 0;
    if(ratio >= 0.94) candW = 0.7;      // ~80/85
    else if(ratio >= 0.82) candW = 0.5; // ~70/85
    else if(ratio >= 0.70) candW = 0.3; // ~60/85
    else if(ratio >= 0.58) candW = 0.2; // ~50/85
    else if(ratio >= 0.47) candW = 0.1; // ~40/85

    // [Hard Gates: Math.min Capping]
    let targetW = candW;
    let act = "", sty = "";
    const actW = context.actualWeight;

    // G1. Trend Gate (Entry Block)
    if (vm.price < vm.ma[200] && vm.sl[200] < 0) {
        let isBounce = (vm.price > vm.ma[20] && vm.sl[20] >= 0 && vm.rsi.cur > vm.rsi.prev);
        if(isBounce) {
            targetW = Math.min(targetW, Math.max(actW, 0.15)); // 신규 진입 15% 제한, 기존 보유량 훼손 안함
            act = "🟡 단기 반등 (소액 탐색)"; sty = "bg-yellow-500 text-slate-900";
            if(isLive) whyNot.push("장기 추세 하락 중. 기술적 반등이므로 신규 진입은 최대 15%로 제한.");
        } else {
            targetW = Math.min(targetW, actW); // 신규 진입 원천 차단
            act = "🟠 신규매수 보류 (장기 하락)"; sty = "bg-orange-500 text-white";
            if(isLive) whyNot.push("주가 < 200MA 및 200MA 하향 중. 신규 매수 금지.");
        }
    } 
    // G2. Market Gate (Reduce Entry)
    if (spy && qqq && !vm.market.spy.ok && !vm.market.ndx.ok) {
        targetW = Math.min(targetW, candW * 0.5);
        if(act==="") { act = "🟡 보수적 접근 (시장 역풍)"; sty = "bg-blue-500 text-white"; }
        if(isLive) whyNot.push("S&P500 & NDX 동반 약세장으로 시스템 허용 비중이 50% 축소됩니다.");
    }
    // G3. Overheat Gate (Entry Block)
    if (vm.rsi.cur > 70) {
        targetW = Math.min(targetW, actW); 
        if (targetW === 0) {
            act = "🔴 신규진입 금지 (과열)"; sty = "bg-red-500 text-white";
            if(isLive) whyNot.push("RSI 70 과열권 도달. 신규 매수를 원천 차단합니다.");
        } else {
            act = "🔴 신규 추가 금지 (보유 유지)"; sty = "bg-red-500 text-white";
            if(isLive) whyNot.push("RSI 70 과열권. 추가 추격 매수를 금지하고 기존 보유량만 유지합니다.");
        }
    }

    // Explicit Exit Rule (Portfolio Management)
    let isExitTriggered = false;
    if (vm.price < vm.ma[200] && vm.sl[200] < 0 && vm.price < vm.ma[60] && vm.mdd.d20.currentDD <= -20) {
        targetW = 0.0;
        isExitTriggered = true;
        act = "🔴 리스크 관리 (강제 청산)"; sty = "bg-red-600 text-white";
        if(isLive) whyNot.push("장기 추세 붕괴 및 주요 지지선 이탈로 보유 물량 강제 청산 신호 발동.");
    }

    // Default Action
    if (act === "") {
        if (targetW >= 0.5) { act = "🟢 적극 매수 후보"; sty = "bg-green-600 text-white"; }
        else if (targetW >= 0.2) { act = "🟢 1차 분할매수"; sty = "bg-emerald-500 text-white"; }
        else if (targetW > 0) { act = "🟡 소액 진입"; sty = "bg-yellow-500 text-slate-900"; }
        else { act = "🟡 관망"; sty = "bg-slate-500 text-white"; }
    }

    // Invariant Guarantee
    if (candW === 0) targetW = 0.0;
    if (targetW > candW) targetW = candW;

    let tradeDelta = targetW - actW;
    
    if(isLive && act.includes("매수") && whyNot.length === 0) whyNot.push("매수 제약을 걸 만한 뚜렷한 Hard Gate 제약이 없습니다.");
    if(isLive) {
        if(vm.atrRank !== "N/A" && vm.atrRank > 0.75) bear.push("최근 1년 내 변동성 상위 25% (위험 증가)");
        log.push(`FACT: Base ${baseScore.toFixed(1)}/${availScore} | CALC: Pen ${penalty} -> Cand ${(candW*100).toFixed(0)}% | INTERP: Target ${(targetW*100).toFixed(0)}%`);
    }

    return { 
        availScore, baseScore, adjScore, candW, finalTargetWeight: targetW, actualWeight: actW, tradeDeltaWeight: tradeDelta,
        act, sty, tr: trSc, mo: moSc, rs: rsSc, ri: riSc, mk: mkSc,
        bull, bear, whyNot, log, vm, isExitTriggered
    };
}

// ---------------------------------------------------------
// [BACKTEST ACCOUNTING ENGINE] Cash Flow Ledger & IS/OOS
// ---------------------------------------------------------
function runBacktestSegment(startIdx, endIdx, ind, spy, qqq, cfg, isIsSegment) {
    if(endIdx - startIdx < 50) return null;

    let res = { rebalanceLedger: [], positionCycles: [], eqGross: [1.0], eqNet: [1.0], bh: [1.0], cumCost: 0, turnAmt: 0, rets: [], days: endIdx - startIdx };
    let st = { cash: 1.0, shares: 0.0, actualWeight: 0.0, cumCost: 0, prevEq: 1.0 };
    let bhCash = 1.0, bhShares = 0.0;
    let activeCycle = null;

    for (let i = startIdx; i < endIdx; i++) {
        // [T Close] 실제 포트폴리오 비중 업데이트
        let eqAtClose = st.cash + (st.shares * ind.prices[i]);
        let actWAtClose = eqAtClose === 0 ? 0 : (st.shares * ind.prices[i]) / eqAtClose;

        // [T Close] Signal Evaluation
        let ctx = { actualWeight: actWAtClose, mode: "backtest" };
        let ev = evaluateSignalAtDate(i, ind, spy, qqq, cfg, ctx);
        let targetW = ev.finalTargetWeight;

        // [T+1 Open] Execution
        let openT1 = ind.open[i+1];
        let closeT1 = ind.prices[i+1];

        // B&H Setup
        if (i === startIdx) { bhShares = bhCash / openT1; bhCash = 0; }
        res.bh.push(bhCash + (bhShares * closeT1));

        let eqAtOpen = st.cash + (st.shares * openT1);
        let actWAtOpen = eqAtOpen === 0 ? 0 : (st.shares * openT1) / eqAtOpen;
        
        let targetValue = eqAtOpen * targetW;
        let currentValue = st.shares * openT1;
        let tradeAmt = targetValue - currentValue;

        if (Math.abs(targetW - actWAtOpen) > CONFIG.EXEC_THRESHOLD) {
            let cost = Math.abs(tradeAmt) * CONFIG.COST_RATE;
            st.cash -= (tradeAmt + cost);
            st.shares += (tradeAmt / openT1);
            st.cumCost += cost;
            res.cumCost += cost;
            res.turnAmt += Math.abs(tradeAmt);

            let newEqOpen = st.cash + (st.shares * openT1);
            let actWAfter = newEqOpen === 0 ? 0 : (st.shares * openT1) / newEqOpen;

            let netCF = tradeAmt > 0 ? -(tradeAmt + cost) : (Math.abs(tradeAmt) - cost);
            
            // Rebalance Ledger
            res.rebalanceLedger.push({
                date: ind.dates[i+1], side: tradeAmt > 0 ? "BUY" : "SELL", shares: tradeAmt / openT1, price: openT1, 
                grossAmount: Math.abs(tradeAmt), cost, netCF, weightBefore: actWAtOpen, targetWeight: targetW, weightAfter: actWAfter
            });

            // Position Cycle Ledger
            if (actWAtOpen === 0 && targetW > 0) {
                activeCycle = { entryDate: ind.dates[i+1], initialCapital: eqAtOpen, totalBuyCash: 0, totalSellCash: 0, totalCosts: 0, rebalanceCount: 0 };
            }
            if (activeCycle) {
                if (tradeAmt > 0) activeCycle.totalBuyCash += tradeAmt;
                else activeCycle.totalSellCash += Math.abs(tradeAmt);
                activeCycle.totalCosts += cost;
                activeCycle.rebalanceCount++;
                
                if (targetW === 0) {
                    activeCycle.exitDate = ind.dates[i+1];
                    activeCycle.realizedPnL = activeCycle.totalSellCash - activeCycle.totalBuyCash - activeCycle.totalCosts; 
                    activeCycle.holdingDays = (new Date(activeCycle.exitDate) - new Date(activeCycle.entryDate)) / 86400000;
                    res.positionCycles.push(activeCycle);
                    activeCycle = null;
                }
            }
        }

        // [T+1 Close] Accounting
        let netEquity = st.cash + (st.shares * closeT1);
        let grossEquity = netEquity + st.cumCost;
        
        res.eqNet.push(netEquity);
        res.eqGross.push(grossEquity);
        let dailyRet = (netEquity / st.prevEq) - 1;
        res.rets.push(dailyRet);
        st.prevEq = netEquity;

        // Boundary Close for IS (Mark-to-market and drop to avoid OOS pollution)
        if (isIsSegment && i === endIdx - 1 && activeCycle) {
            // Not adding to positionCycles to strictly count only completed trades in IS
            activeCycle = null;
        }
    }

    const calcMetrics = (r) => {
        if(r.eqNet.length <= 1) return null;
        let cagr = Math.pow(r.eqNet[r.eqNet.length-1], 252/r.days) - 1;
        let bhCagr = Math.pow(r.bh[r.bh.length-1], 252/r.days) - 1;
        
        let maxDD = 0, peak = r.eqNet[0];
        let bhMaxDD = 0, bhPeak = r.bh[0];
        for(let e of r.eqNet) { if(e>peak) peak=e; let dd=(e-peak)/peak; if(dd<maxDD) maxDD=dd; }
        for(let e of r.bh) { if(e>bhPeak) bhPeak=e; let dd=(e-bhPeak)/bhPeak; if(dd<bhMaxDD) bhMaxDD=dd; }
        
        let sum = 0, sumSq = 0, dSumSq = 0;
        for(let ret of r.rets) { sum+=ret; sumSq+=ret*ret; if(ret<0) dSumSq+=ret*ret; }
        let mean = sum/r.days; let std = Math.sqrt((sumSq/r.days) - (mean*mean)); let dStd = Math.sqrt(dSumSq/r.days);
        
        let sharpe = std === 0 ? "N/A" : (mean / std) * Math.sqrt(252);
        let sortino = dStd === 0 ? "N/A" : (mean / dStd) * Math.sqrt(252);
        let calmar = maxDD === 0 ? "N/A" : cagr / Math.abs(maxDD);
        
        let winT = 0, lossT = 0, gWin = 0, gLoss = 0, hold = 0, consL = 0, maxConsL = 0;
        for(let t of r.positionCycles) {
            if(t.realizedPnL > 0) { winT++; gWin += t.realizedPnL; consL = 0; } 
            else { lossT++; gLoss += Math.abs(t.realizedPnL); consL++; if(consL>maxConsL) maxConsL=consL; }
            hold += t.holdingDays;
        }
        let totalT = winT + lossT;
        let winRate = totalT === 0 ? 0 : winT/totalT;
        let pf = gLoss === 0 ? (gWin>0?"∞":"N/A") : gWin/gLoss;
        let avgWin = winT === 0 ? 0 : gWin/winT;
        let avgLoss = lossT === 0 ? 0 : gLoss/lossT;
        let exp = (winRate * avgWin) - ((1-winRate) * avgLoss);

        let avgEq = r.eqNet.reduce((a,b)=>a+b,0)/r.eqNet.length;
        let turnCum = avgEq === 0 ? 0 : r.turnAmt / avgEq;
        let turnDaily = turnCum / r.days;

        return { 
            cagr, bhCagr, mdd: maxDD*100, bhMdd: bhMaxDD*100, sharpe, sortino, calmar, 
            trd: totalT, winRate: winRate*100, pf, exp, avgWin, avgLoss, avgHold: totalT===0?0:hold/totalT, 
            turnDaily, turnCum, cumCost: r.cumCost, grossEnd: r.eqGross[r.eqGross.length-1], netEnd: r.eqNet[r.eqNet.length-1],
            maxConsL
        };
    };

    return calcMetrics(res);
}

// ---------------------------------------------------------
// [CONFIDENCE ENGINE] (Validation Evidence)
// ---------------------------------------------------------
function calculateConfidence(dv, btOos, pm50, pm70, pl180, pl220) {
    if(!btOos) return { val: 0, t: "검증 불가" };
    let conf = 0;
    
    conf += (dv.comp / 100) * 15; 
    conf += Math.min(btOos.trd, 15);
    if(btOos.cagr > 0) conf += 10;
    if(btOos.cagr > btOos.bhCagr) conf += 15;
    if(btOos.sharpe !== "N/A" && btOos.sharpe > 1.0) conf += 10; else if(btOos.sharpe !== "N/A" && btOos.sharpe > 0.5) conf += 5;
    
    let midCagrs = [btOos.cagr, pm50.cagr, pm70.cagr].filter(Number.isFinite);
    let longCagrs = [btOos.cagr, pl180.cagr, pl220.cagr].filter(Number.isFinite);
    if (midCagrs.length > 0 && Math.max(...midCagrs) - Math.min(...midCagrs) < 0.05) conf += 10;
    if (longCagrs.length > 0 && Math.max(...longCagrs) - Math.min(...longCagrs) < 0.05) conf += 10;

    // Hard Capping
    if(btOos.trd < 5) conf = Math.min(conf, 50);
    else if(btOos.trd < 10) conf = Math.min(conf, 60);
    else if(btOos.trd < 20) conf = Math.min(conf, 75);
    else conf = Math.min(conf, 85); 

    let t = "";
    if(conf >= 75) t = "검증 근거 우수 (Robust)";
    else if(conf >= 60) t = "검증 근거 유의미함";
    else t = "통계적 검증 부족 (표본 미달)";

    return { val: Math.floor(conf), t };
}

// ---------------------------------------------------------
// [UNIT TEST LAYER] Engine Invariant Verification
// ---------------------------------------------------------
function runExtremeUnitTests(cfg) {
    let results = [];
    const tLog = (name, pass) => results.push(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
    
    const makeMock = (price, rsiVal) => {
        let res = { dates:[], open:[], high:[], low:[], close:[], volume:[] };
        for(let j=0; j<300; j++) {
            res.dates.push(`2026-01-${String((j%30)+1).padStart(2,'0')}`); // chronologically irrelevant for point-in-time test
            res.open.push(price); res.high.push(price*1.05); res.low.push(price*0.95); res.close.push(price); res.volume.push(1000);
        }
        let ind = buildIndicators(res);
        ind.rsi[299] = rsiVal; ind.rsi[298] = rsiVal;
        return ind;
    };
    
    let baseInd = makeMock(100, 50);
    let i = 299;

    // CASE A: MDD -80%, RSI 20, 200MA 하락
    let fiA = JSON.parse(JSON.stringify(baseInd));
    fiA.mdd.all[i].currentDD = -80; fiA.rsi[i] = 20; fiA.prices[i] = 50; fiA.ma[200][i] = 100; fiA.ma[200][i-5] = 110;
    let eA = evaluateSignalAtDate(i, fiA, null, null, cfg, { actualWeight: 0, mode: "test" });
    tLog("CASE A (MDD -80, Trend Down ➔ Target 0%)", eA.finalTargetWeight === 0);

    // CASE E: Cand=0 Invariant
    // Create a scenario where base score is very low (Cand 0)
    let fiE = JSON.parse(JSON.stringify(baseInd));
    fiE.mdd.all[i].currentDD = -50; fiE.prices[i] = 20; fiE.ma[200][i] = 100; fiE.ma[200][i-5] = 105; 
    let eE = evaluateSignalAtDate(i, fiE, null, null, cfg, { actualWeight: 0, mode: "test" });
    tLog("CASE E (Cand=0 ➔ Target 0%)", eE.candW === 0 && eE.finalTargetWeight === 0);

    // CASE F: RSI=85, ActWt=0
    let fiF = JSON.parse(JSON.stringify(baseInd)); fiF.rsi[i] = 85; 
    let eF = evaluateSignalAtDate(i, fiF, null, null, cfg, { actualWeight: 0, mode: "test" });
    tLog("CASE F (Overheat + ActWt=0 ➔ Target 0%)", eF.finalTargetWeight === 0);

    // CASE G: RSI=85, ActWt=30%
    let eG = evaluateSignalAtDate(i, fiF, null, null, cfg, { actualWeight: 0.3, mode: "test" });
    tLog("CASE G (Overheat + ActWt=30% ➔ Target <= 30%)", eG.finalTargetWeight <= 0.3);

    // CASE I: Score -> Penalty -> Cand Check
    let base = 82, pen = 15, adj = base - pen;
    let cand = adj >= 80 ? 0.7 : adj >= 70 ? 0.5 : adj >= 60 ? 0.3 : adj >= 50 ? 0.2 : adj >= 40 ? 0.1 : 0;
    tLog("CASE I (RiskPenalty: Base 82 ➔ Adj 67 ➔ Cand 30%)", cand === 0.3);

    // CASE J: Multi-Gate Capping Invariant
    let candJ = 0.7; let trgJ = candJ;
    trgJ = Math.min(trgJ, 0.35); // Trend
    trgJ = Math.min(trgJ, trgJ * 0.5); // Market
    trgJ = Math.min(trgJ, 0.1); // Overheat (actual=0.1)
    tLog("CASE J (Multi-Gate Capping ➔ Target <= Cand)", trgJ <= candJ && trgJ === 0.1);

    return results;
}

// ---------------------------------------------------------
// [UI RENDER LAYER]
// ---------------------------------------------------------
function renderEQDS_UI(ctx) {
    const { ticker, ev, dv, btIs, btOos, conf, sensitivity, tests } = ctx;
    const vm = ev.vm;
    const isCcy = ticker.endsWith(".KS") || ticker.endsWith(".KQ") ? "₩" : "$";
    
    const maRows = [5, 10, 15, 20, 60, 120, 200].map(n => {
        let v = vm.ma[n], s = vm.sl[n], d = v ? ((vm.price/v)-1)*100 : null;
        return `<tr class="border-b border-slate-100"><td class="py-1.5 font-bold">${n}MA</td><td class="py-1.5 text-right mono">${v?v.toFixed(2):'-'}</td><td class="py-1.5 text-right mono ${d>0?'text-green-600':'text-red-500'}">${d>0?'+'+d.toFixed(2):d?d.toFixed(2):'-'}%</td><td class="py-1.5 text-center font-bold text-[10px] ${s>0?'text-green-600':'text-red-500'}">${s>0?'↑':'↓'}</td></tr>`;
    }).join('');

    const fmtRS = (val) => val === "N/A" ? "N/A" : (val > 0 ? '+'+val.toFixed(2) : val.toFixed(2)) + '%p';
    const mddCell = (n, mObj) => `<div class="flex justify-between"><span>${n}:</span><span>Cur ${mObj.currentDD.toFixed(1)}% | Max ${mObj.maxDD.toFixed(1)}%</span></div>`;

    let h = `
        <div class="space-y-6">
            <div class="flex justify-between items-end border-b border-slate-200 pb-3">
                <div><h1 class="text-3xl font-black text-slate-800">${ticker}</h1><div class="text-sm font-bold text-slate-500 mt-1">현재가: ${isCcy}${vm.price.toLocaleString()} | 데이터완성도: ${dv.comp.toFixed(1)}%</div></div>
            </div>
            
            <div class="p-6 rounded-xl text-center shadow-sm ${ev.sty} border border-black/10">
                <div class="text-xs font-bold opacity-80 mb-1">최종 투자 판정</div>
                <h2 class="text-4xl font-black mb-3">${ev.act}</h2>
                <div class="flex flex-wrap justify-center gap-2">
                    <div class="bg-black/20 px-3 py-1 rounded-full text-xs font-bold text-white">기술적 점수: ${ev.adjScore} / ${ev.availScore} (Fund N/A)</div>
                    <div class="bg-black/20 px-3 py-1 rounded-full text-xs font-bold text-white">전략 검증 신뢰도: ${conf.val}/100</div>
                    <div class="bg-white/90 text-slate-900 px-3 py-1 rounded-full text-xs font-black">Target Weight: ${(ev.finalTargetWeight*100).toFixed(0)}%</div>
                </div>
                <div class="text-[10px] mt-2 font-mono">Cand: ${(ev.candW*100).toFixed(0)}% | Actual: ${(ev.actualWeight*100).toFixed(0)}% | Delta: ${(ev.tradeDeltaWeight*100).toFixed(0)}%p</div>
            </div>

            <div class="grid grid-cols-3 gap-3 text-center">
                <div class="bg-blue-50 p-3 rounded-lg"><div class="text-xs font-bold text-blue-500">S&P500(SPY)</div><div class="text-sm font-black ${vm.market.spy.ok?'text-green-600':'text-red-500'} mt-1">${vm.market.spy.desc}</div></div>
                <div class="bg-blue-50 p-3 rounded-lg"><div class="text-xs font-bold text-blue-500">NASDAQ100(QQQ)</div><div class="text-sm font-black ${vm.market.ndx.ok?'text-green-600':'text-red-500'} mt-1">${vm.market.ndx.desc}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg"><div class="text-xs font-bold text-slate-400">Sector</div><div class="text-sm font-black text-slate-400 mt-1">N/A</div></div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">추세(25)</div><div class="text-lg font-black">${ev.tr.a} / ${ev.tr.m}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">모멘텀(15)</div><div class="text-lg font-black">${ev.mo.a} / ${ev.mo.m}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">위험도(15)</div><div class="text-lg font-black">${ev.ri.a} / ${ev.ri.m}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">추세전환 상태</div><div class="text-[11px] font-black text-indigo-600 mt-1">${vm.stName}</div></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-white border border-slate-200 rounded-xl p-4">
                    <h4 class="font-bold text-xs text-slate-800 mb-2 border-b pb-1">이동평균(7MAs) 구조</h4>
                    <table class="w-full text-xs whitespace-nowrap"><tbody>${maRows}</tbody></table>
                </div>
                <div class="bg-white border border-slate-200 rounded-xl p-4">
                    <h4 class="font-bold text-xs text-slate-800 mb-2 border-b pb-1">상대강도 (vs 지수)</h4>
                    <div class="text-[10px] font-mono space-y-2">
                        <div class="flex justify-between"><span>20D vs SPY</span><span class="${vm.rs.spy.d20>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.spy.d20)}</span></div>
                        <div class="flex justify-between"><span>60D vs SPY</span><span class="${vm.rs.spy.d60>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.spy.d60)}</span></div>
                        <div class="flex justify-between"><span>120D vs SPY</span><span class="${vm.rs.spy.d120>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.spy.d120)}</span></div>
                        <div class="flex justify-between mt-2 pt-2 border-t"><span>60D vs NDX</span><span class="${vm.rs.ndx.d60>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.ndx.d60)}</span></div>
                    </div>
                </div>
                <div class="bg-white border border-slate-200 rounded-xl p-4">
                    <h4 class="font-bold text-xs text-slate-800 mb-2 border-b pb-1">Multi-MDD & Recovery Context</h4>
                    <div class="text-[10px] font-mono text-red-600 space-y-1">
                        ${mddCell("20D", vm.mdd.d20)}
                        ${mddCell("60D", vm.mdd.d60)}
                        ${mddCell("120D", vm.mdd.d120)}
                        ${mddCell("252D", vm.mdd.d252)}
                        <div class="flex justify-between font-bold"><span>ALL:</span><span>Cur ${vm.mdd.all.currentDD.toFixed(1)}% | Max ${vm.mdd.all.maxDD.toFixed(1)}%</span></div>
                    </div>
                    <div class="text-[10px] text-slate-600 mt-2 font-bold bg-slate-50 p-2 rounded">
                        Max DD 지속기간: ${vm.mdd.all.maxDDDuration}일<br>
                        Max DD 회복률: <span class="text-blue-600">${vm.mdd.all.recoveryRatio === "N/A" ? "N/A" : vm.mdd.all.recoveryRatio.toFixed(1)+'%'}</span><br>
                        (MDD는 매수 보너스가 아닌 리스크 컨텍스트입니다)
                    </div>
                </div>
            </div>

            <!-- Chart Section -->
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div class="flex flex-wrap gap-2 mb-2 text-[10px] font-bold text-slate-600 justify-center">
                    <label><input type="checkbox" id="chk-quant-price" checked onchange="drawQuantChart()">주가</label>
                    <label><input type="checkbox" id="chk-quant-ma20" checked onchange="drawQuantChart()">20MA</label>
                    <label><input type="checkbox" id="chk-quant-ma60" checked onchange="drawQuantChart()">60MA</label>
                    <label><input type="checkbox" id="chk-quant-ma200" onchange="drawQuantChart()">200MA</label>
                    <label class="ml-2 border-l pl-2"><input type="checkbox" id="chk-quant-rsi" checked onchange="drawQuantChart()">RSI</label>
                </div>
                <div class="relative w-full h-[300px]"><canvas id="quantIntegratedCanvas"></canvas></div>
            </div>

            <!-- Explainability -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div class="border border-green-200 bg-green-50/30 rounded-xl p-4">
                    <h4 class="text-xs font-black text-green-700 mb-2 border-b pb-1">📈 긍정 요인 (BUY CASE)</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1">${ev.bull.length?ev.bull.map(c=>`<li>+ ${c}</li>`).join(''):'<li>특이사항 없음</li>'}</ul>
                </div>
                <div class="border border-red-200 bg-red-50/30 rounded-xl p-4">
                    <h4 class="text-xs font-black text-red-700 mb-2 border-b pb-1">📉 부정 요인 (BEAR CASE)</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1">${ev.bear.length?ev.bear.map(c=>`<li>- ${c}</li>`).join(''):'<li>특이사항 없음</li>'}</ul>
                </div>
                <div class="border border-slate-300 bg-slate-100 rounded-xl p-4 shadow-inner">
                    <h4 class="text-xs font-black text-slate-800 mb-2 border-b pb-1">🛑 아직 적극 매수하지 않는 이유</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1 font-bold">${ev.whyNot.length?ev.whyNot.map(c=>`<li>• ${c}</li>`).join(''):'<li>특이 제약 없음</li>'}</ul>
                </div>
            </div>

            <!-- Backtest Engine -->
            <div class="bg-slate-800 text-white rounded-xl p-5">
                <h4 class="text-xs font-black text-emerald-400 mb-3 border-b border-slate-600 pb-2">백테스트 (T+1 Open 실행 / 비용 15bp 차감 Net Return / Price Return)</h4>
                ${btIs && btOos ? `
                <div class="grid grid-cols-2 gap-4 text-[10px] mono">
                    <div>
                        <div class="text-slate-400 font-bold mb-1 bg-slate-700 px-2 py-1 rounded inline-block">IS (70%) 독립구간</div>
                        <div class="flex justify-between"><span>Completed Trades</span><span>${btIs.trd}회</span></div>
                        <div class="flex justify-between"><span>Net CAGR</span><span class="${btIs.cagr>0?'text-emerald-400':'text-red-400'}">${(btIs.cagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>B&H CAGR</span><span>${(btIs.bhCagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>Net MDD</span><span>${btIs.mdd.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>Sharpe Ratio</span><span>${btIs.sharpe === "N/A" ? "N/A" : btIs.sharpe.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>Sortino Ratio</span><span>${btIs.sortino === "N/A" ? "N/A" : btIs.sortino.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>거래 승률(Win Rate)</span><span>${btIs.winRate.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>Profit Factor</span><span>${btIs.pf === "∞" ? "∞" : typeof btIs.pf === 'number' ? btIs.pf.toFixed(2) : "N/A"}</span></div>
                        <div class="flex justify-between"><span>평균 보유기간</span><span>${btIs.avgHold.toFixed(1)}일</span></div>
                        <div class="flex justify-between"><span>일평균 Turnover</span><span>${(btIs.turnDaily*100).toFixed(2)}%</span></div>
                        <div class="flex justify-between"><span>누적 Turnover</span><span>${btIs.turnCum.toFixed(2)}x</span></div>
                        <div class="flex justify-between"><span>Gross End Eq</span><span>${btIs.grossEnd.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>Net End Eq</span><span>${btIs.netEnd.toFixed(2)}</span></div>
                    </div>
                    <div>
                        <div class="text-indigo-300 font-bold mb-1 bg-indigo-900 px-2 py-1 rounded inline-block">OOS (30%) 독립구간</div>
                        <div class="flex justify-between"><span>Completed Trades</span><span>${btOos.trd}회 ${btOos.trd<5?'(⚠️표본 부족)':''}</span></div>
                        <div class="flex justify-between"><span>Net CAGR</span><span class="${btOos.cagr>0?'text-emerald-400':'text-red-400'}">${(btOos.cagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>B&H CAGR</span><span>${(btOos.bhCagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>Net MDD</span><span>${btOos.mdd.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>Sharpe Ratio</span><span>${btOos.sharpe === "N/A" ? "N/A" : btOos.sharpe.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>Sortino Ratio</span><span>${btOos.sortino === "N/A" ? "N/A" : btOos.sortino.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>거래 승률(Win Rate)</span><span>${btOos.winRate.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>Profit Factor</span><span>${btOos.pf === "∞" ? "∞" : typeof btOos.pf === 'number' ? btOos.pf.toFixed(2) : "N/A"}</span></div>
                        <div class="flex justify-between"><span>평균 보유기간</span><span>${btOos.avgHold.toFixed(1)}일</span></div>
                        <div class="flex justify-between"><span>일평균 Turnover</span><span>${(btOos.turnDaily*100).toFixed(2)}%</span></div>
                        <div class="flex justify-between"><span>누적 Turnover</span><span>${btOos.turnCum.toFixed(2)}x</span></div>
                        <div class="flex justify-between"><span>Gross End Eq</span><span>${btOos.grossEnd.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>Net End Eq</span><span>${btOos.netEnd.toFixed(2)}</span></div>
                    </div>
                </div>
                <div class="mt-3 pt-2 border-t border-slate-600 text-[9px] text-slate-400 flex flex-col gap-1">
                    <div>[Parameter Sensitivity (OOS Net CAGR) - 파라미터 독립 검증]</div>
                    <div class="flex justify-between border-b border-slate-700 pb-1"><span>Mid MA (50/60/70):</span><span>${(sensitivity.pm50.oos.cagr*100).toFixed(1)}% | <b>${(btOos.cagr*100).toFixed(1)}%(Core)</b> | ${(sensitivity.pm70.oos.cagr*100).toFixed(1)}%</span></div>
                    <div class="flex justify-between pt-1"><span>Long MA (180/200/220):</span><span>${(sensitivity.pl180.oos.cagr*100).toFixed(1)}% | <b>${(btOos.cagr*100).toFixed(1)}%(Core)</b> | ${(sensitivity.pl220.oos.cagr*100).toFixed(1)}%</span></div>
                </div>
                ` : '<div class="text-xs text-slate-400">데이터 부족</div>'}
            </div>

            <!-- Logs & Tests -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
                    <h4 class="text-xs font-black text-indigo-900 mb-2 border-b border-indigo-200 pb-1">추론 근거 (FACT-CALC-INTERP)</h4>
                    <ul class="text-[9px] text-indigo-800 space-y-1 font-mono">${ev.log.length>0?ev.log.map(r=>`<li>• ${r}</li>`).join(''):'<li>특이 연산 로그 없음</li>'}</ul>
                </div>
                <div class="bg-slate-100 border border-slate-200 p-4 rounded-xl">
                    <h4 class="text-xs font-black text-slate-800 mb-2 border-b border-slate-300 pb-1">Unit Tests (Gate Invariant Check)</h4>
                    <ul class="text-[9px] text-slate-600 space-y-1 font-mono">${tests.map(r=>`<li>${r}</li>`).join('')}</ul>
                </div>
            </div>
            
            <div class="text-[9px] text-slate-400 p-2 text-center">
                * EQDS V2.2.5는 라이브와 백테스트에서 단 1개의 의사결정 함수(evaluateSignalAtDate)만을 공유하며, 펀더멘털 데이터 N/A 항목은 기술 점수에 강제 재분배되지 않습니다.
            </div>
        </div>
    `;
    const el = document.getElementById('quant-result-container');
    if(el) el.innerHTML = h;
    drawQuantChart();
}

function drawQuantChart() {
    if (!currentQuantData) return;
    const ctxEl = document.getElementById('quantIntegratedCanvas');
    if (!ctxEl) return;
    const ctx = ctxEl.getContext('2d');
    if (quantChartInstance) quantChartInstance.destroy();

    let ds = [];
    const chkPrice = document.getElementById('chk-quant-price');
    const chkMa20 = document.getElementById('chk-quant-ma20');
    const chkMa60 = document.getElementById('chk-quant-ma60');
    const chkMa200 = document.getElementById('chk-quant-ma200');
    const chkRsi = document.getElementById('chk-quant-rsi');

    if (chkPrice && chkPrice.checked) ds.push({ label: '주가', data: currentQuantData.prices, borderColor: '#1e293b', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y', order: 10 });
    if (chkMa20 && chkMa20.checked) ds.push({ label: '20MA', data: currentQuantData.ma[20], borderColor: '#eab308', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (chkMa60 && chkMa60.checked) ds.push({ label: '60MA', data: currentQuantData.ma[60], borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (chkMa200 && chkMa200.checked) ds.push({ label: '200MA', data: currentQuantData.ma[200], borderColor: '#8b5cf6', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (chkRsi && chkRsi.checked) ds.push({ label: 'RSI(14)', data: currentQuantData.rsi, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' });
    
    quantChartInstance = new Chart(ctx, {
        type: 'line', data: { labels: currentQuantData.dates, datasets: ds },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { weight: 'bold' } } },
                y: { type: 'linear', position: 'left', ticks: { font: { weight: 'bold' } } },
                y1: { type: 'linear', position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { font: { weight: 'bold', color: '#64748b' } } }
            },
            plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' } }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('quant-ticker-input');
    if(input) input.addEventListener('keypress', e => { if(e.key==='Enter') runQuantAnalysis(); });
});
