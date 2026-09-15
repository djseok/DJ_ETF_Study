// =========================================================
// 🧠 EQDS V2.2.5 MASTER FINAL
// Explainable Quantitative Decision System
// STRICT ENFORCEMENT: Deterministic Accounting, No Look-ahead, Strict Invariants
// =========================================================

let quantChartInstance = null;
let currentQuantData = null;
let lastEvaluationResult = null; // Read-Only Cache for Simulator

async function runQuantAnalysis() {
    const tickerInput = document.getElementById('quant-ticker-input');
    if (!tickerInput || !tickerInput.value.trim()) return;
    const tickerStr = tickerInput.value.trim().toUpperCase();

    const statusMsg = document.getElementById('quant-status-msg');
    const resultContainer = document.getElementById('quant-result-container');
    if(statusMsg) statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500 mr-1"></i> <b>${tickerStr}</b> 정량 데이터 수집 및 엔진 무결성 검증 중...`;
    if(resultContainer) resultContainer.classList.add('hidden');

    try {
        if (/^\d{6}$/.test(tickerStr)) {
            throw new Error("한국 종목은 티커 뒤에 거래소 식별자(.KS 코스피, .KQ 코스닥)를 명시해주세요. (예: 005930.KS)");
        }
        let queryTicker = tickerStr;
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";

        const cfg = {
            maxExposure: 0.70,        
            explorationMax: 0.15,     
            execThreshold: 0.01,      
            costRate: 0.0015,         
            midMA: 60, longMA: 200,
            exitType: "A"             
        };

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

        // 1. Data Layer
        const rawTarget = extractOHLCV(tgtData);
        const rawSpy = spyData.error ? null : extractOHLCV(spyData);
        const rawQqq = qqqData.error ? null : extractOHLCV(qqqData);

        const dataVal = validateDataQuality(rawTarget);
        if (rawSpy) validateDataQuality(rawSpy); 
        if (rawQqq) validateDataQuality(rawQqq);

        if (dataVal.score < 40) throw new Error(`데이터 품질 결함 (Score: ${dataVal.score}). 시스템 강제 중단.`);

        // 2. Indicators
        const ind = buildIndicators(rawTarget);
        const spyInd = rawSpy ? buildIndicators(rawSpy) : null;
        const qqqInd = rawQqq ? buildIndicators(rawQqq) : null;

        // 3. Unit Testing (Strict Engine Verification)
        const unitTests = runExtremeUnitTests(cfg);

        // 4. Live Evaluation
        const liveIdx = ind.prices.length - 1;
        const liveContext = { actualWeight: 0.0, mode: "live" }; 
        const liveEval = evaluateSignalAtDate(liveIdx, ind, spyInd, qqqInd, cfg, liveContext);
        
        // Runtime Schema Assertion
        assertRuntimeSchema(liveEval);

        lastEvaluationResult = { ticker: queryTicker, ind, spyInd, qqqInd, ev: liveEval, cfg };

        // 5. Backtest (Explicit Exit 병렬 검증 & OOS 독립 분리)
        const splitIdx = Math.floor(ind.prices.length * 0.7);
        const btIs = runBacktestSegment(252, splitIdx, ind, spyInd, qqqInd, {...cfg, exitType: "A"}, true);
        const btOosA = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, exitType: "A"}, false);
        const btOosB = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, exitType: "B"}, false);
        const btOosC = runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, exitType: "C"}, false);

        // 6. Sensitivity (UI/Engine 일치 보장)
        const sens = {
            exp50: runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, maxExposure: 0.5, exitType: "A"}, false),
            exp60: runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, maxExposure: 0.6, exitType: "A"}, false),
            exp80: runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, maxExposure: 0.8, exitType: "A"}, false),
            pm50: runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, midMA: 50, exitType: "A"}, false),
            pm70: runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, midMA: 70, exitType: "A"}, false),
            pl180: runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, longMA: 180, exitType: "A"}, false),
            pl220: runBacktestSegment(splitIdx, ind.prices.length - 1, ind, spyInd, qqqInd, {...cfg, longMA: 220, exitType: "A"}, false)
        };

        // 7. Confidence Engine
        const conf = calculateConfidence(dataVal, btOosA, sens);

        // 8. Render UI
        currentQuantData = ind;
        renderEQDS_UI({ 
            ticker: queryTicker, ev: liveEval, dv: dataVal, 
            btIs, btOosA, btOosB, btOosC, conf, sensitivity: sens, tests: unitTests 
        });
        
        // 9. Simulator Init
        initPurchaseSimulator();

        if(statusMsg) statusMsg.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> EQDS V2.2.5 분석 완료 (배당 미포함 가격수익률 기준)`;
        if(resultContainer) resultContainer.classList.remove('hidden');

    } catch (error) {
        if(statusMsg) statusMsg.innerHTML = `<span class="text-red-500 font-bold">❌ 시스템 차단: ${error.message}</span>`;
        console.error("EQDS Runtime Error:", error);
    }
}

function assertRuntimeSchema(ev) {
    const reqEv = ['vm', 'baseScore', 'adjScore', 'candW', 'entryCap', 'gateCap', 'actualWeight', 'finalTargetWeight', 'tradeDeltaWeight', 'isExplicitExit', 'stage', 'whyPositive', 'whyNegative', 'whyNotAggressive'];
    for (let r of reqEv) if (ev[r] === undefined) throw new Error(`Schema Error: ev.${r} is undefined`);
    const reqMa = [5, 10, 15, 20, 60, 120, 200];
    for (let m of reqMa) {
        if (ev.vm.ma[m] === undefined) throw new Error(`Schema Error: vm.ma[${m}] is undefined`);
        if (ev.vm.sl[m] === undefined) throw new Error(`Schema Error: vm.sl[${m}] is undefined`);
    }
    const reqRsi = ['cur', 'prev', 'crossUp30', 'crossDown30', 'crossUp40', 'crossDown40', 'crossUp50', 'crossDown50', 'crossUp70', 'crossDown70', 'oversoldExit', 'overboughtExit'];
    for (let r of reqRsi) if (ev.vm.rsi[r] === undefined) throw new Error(`Schema Error: vm.rsi.${r} is undefined`);
    if (!ev.vm.mdd || !ev.vm.rs || !ev.vm.market) throw new Error(`Schema Error: Nested objects missing in VM`);
}

function extractOHLCV(data) {
    if (!data) return null;
    const t = data.chart.result[0].timestamp;
    const q = data.chart.result[0].indicators.quote[0];
    let res = { dates: [], open: [], high: [], low: [], close: [], volume: [] };
    let lastT = 0;
    
    for(let i=0; i<q.close.length; i++) {
        if(q.close[i] != null && q.open[i] != null && q.high[i] != null && q.low[i] != null) {
            let curT = t[i] * 1000;
            if (curT <= lastT) continue; 
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
    if(oErr > 0) { score -= 30; errors.push(`OHLC 구조 오류 ${oErr}건`); }
    if(zVol > 50) { score -= 10; errors.push(`거래량 이상 ${zVol}일`); }
    if(ohlcv.close.length < 252) { score -= 40; errors.push(`표본 데이터 1년 미만`); }
    return { score: Math.max(0, score), comp: Math.min(100, (ohlcv.close.length/1260)*100), errors: errors.length ? errors : ["데이터 정상"] };
}

function buildIndicators(ohlcv) {
    if(!ohlcv || ohlcv.close.length < 50) return null;
    const p = ohlcv.close;
    const volForMA = ohlcv.volume.map(v => v == null ? 0 : v); 

    let logRets = [];
    for(let i=0; i<p.length; i++) logRets.push(i===0 ? 0 : Math.log(p[i]/p[i-1]));
    const vol20DRealized = calcRealizedVol(logRets, 20);

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
        realizedVol20: vol20DRealized,
        currentDD20: calcCurrentDD(p, 20),
        mdd: {
            d20: calcMultiMDD(p, ohlcv.dates, 20), d60: calcMultiMDD(p, ohlcv.dates, 60),
            d120: calcMultiMDD(p, ohlcv.dates, 120), d252: calcMultiMDD(p, ohlcv.dates, 252),
            all: calcMultiMDD(p, ohlcv.dates, p.length)
        }
    };
}

function calcMA(arr, win) { let r=[]; for(let i=0;i<arr.length;i++){ if(i<win-1) r.push(null); else { let s=0; for(let j=0;j<win;j++) s+=arr[i-j]; r.push(s/win); } } return r; }
function calcRealizedVol(logRets, win) {
    let res = [];
    for(let i=0; i<logRets.length; i++) {
        if(i < win - 1) { res.push(null); continue; }
        let sum = 0, sumSq = 0;
        for(let j=0; j<win; j++) { let r = logRets[i-j]; sum += r; sumSq += r*r; }
        let mean = sum/win; let v = (sumSq/win) - (mean*mean);
        res.push(Math.sqrt(v) * Math.sqrt(252)); 
    }
    return res;
}
function calcRSI(p, win) {
    let rsi=new Array(p.length).fill(null), g=0, l=0;
    for(let i=1;i<=win;i++) { let d=p[i]-p[i-1]; if(d>0) g+=d; else if(d<0) l-=d; }
    let ag=g/win, al=l/win;
    for(let i=win+1;i<p.length;i++) {
        let d=p[i]-p[i-1]; ag=(ag*(win-1)+(d>0?d:0))/win; al=(al*(win-1)+(d<0?-d:0))/win;
        if (al === 0 && ag === 0) rsi[i] = 50;
        else if (al === 0 && ag > 0) rsi[i] = 100;
        else if (ag === 0 && al > 0) rsi[i] = 0;
        else rsi[i] = 100 - (100 / (1 + (ag / al)));
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
function calcCurrentDD(p, win) {
    let res = [];
    for(let i=0; i<p.length; i++) {
        let start = Math.max(0, i - win + 1);
        let maxP = p[start];
        for(let j=start; j<=i; j++) { if(p[j] > maxP) maxP = p[j]; }
        res.push(maxP === 0 ? 0 : (p[i] / maxP) - 1);
    }
    return res;
}
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
        
        let recoveryRatio = "N/A", recovered = false, recovDate = "N/A", recovDuration = "N/A";
        if (gPeak !== gTrough) {
            let ratio = ((p[i] - gTrough) / (gPeak - gTrough)) * 100;
            recoveryRatio = Math.min(100, Math.max(0, ratio)); 
            if (p[i] >= gPeak) {
                recovered = true;
                for(let k=gTroughD; k<=i; k++) { if(p[k] >= gPeak) { recovDate = dates[k]; recovDuration = k - gTroughD; break; } }
            }
        } else if (maxDD === 0) {
            recoveryRatio = "N/A"; recovered = true;
        }

        res.push({
            currentDD, currentPeakDate: dates[curPeakD], ddDuration: i - curPeakD,
            maxDD: maxDD * 100, maxPeakDate: dates[gPeakD], maxTroughDate: dates[gTroughD], maxDDDuration: gTroughD - gPeakD,
            recoveryRatio, recovered, recoveryDate: recovDate, recoveryDuration: recovDuration
        });
    }
    return res;
}

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
// [VIEW MODEL BUILDER]
// ---------------------------------------------------------
function buildViewModel(i, ind, spy, qqq, cfg) {
    const P = ind.prices[i];
    const prevP = ind.prices[i-1] || P;
    const tgtTime = new Date(ind.dates[i]).getTime();
    
    const ma = {
        5: ind.ma[5][i], 10: ind.ma[10][i], 15: ind.ma[15][i], 20: ind.ma[20][i],
        60: ind.ma[cfg.midMA][i], 120: ind.ma[120][i], 200: ind.ma[cfg.longMA][i]
    };
    const slope = (val, past) => (val && past) ? (val / past - 1)*100 : null;
    const sl = {
        5: slope(ma[5], ind.ma[5][Math.max(0, i-5)]), 10: slope(ma[10], ind.ma[10][Math.max(0, i-5)]), 
        15: slope(ma[15], ind.ma[15][Math.max(0, i-5)]), 20: slope(ma[20], ind.ma[20][Math.max(0, i-5)]), 
        60: slope(ma[60], ind.ma[cfg.midMA][Math.max(0, i-5)]), 120: slope(ma[120], ind.ma[120][Math.max(0, i-5)]), 
        200: slope(ma[200], ind.ma[cfg.longMA][Math.max(0, i-5)])
    };

    let C1 = (ma[200] && P > ma[200]) ? 1 : 0;
    let C2 = (sl[200] && sl[200] > 0) ? 1 : 0;
    let C3 = (ma[120] && ma[200] && ma[120] > ma[200]) ? 1 : 0;
    let C4 = (sl[120] && sl[120] > 0) ? 1 : 0;
    let C5 = (ma[60] && P > ma[60]) ? 1 : 0;
    let C6 = (sl[60] && sl[60] > 0) ? 1 : 0;
    let C7 = (ma[20] && ma[60] && ma[20] > ma[60]) ? 1 : 0;
    let C8 = (sl[20] && sl[20] > 0) ? 1 : 0;
    let C9 = (ind.rsi[i] && ind.rsi[i] > 50) ? 1 : 0;
    
    let stage = C1+C2+C3+C4+C5+C6+C7+C8+C9;
    let stName = "";
    if (stage === 9) stName = "Stage 9 (완성 상승)";
    else if (stage >= 7) stName = `Stage ${stage} (상승 추세)`;
    else if (stage >= 5) stName = `Stage ${stage} (반등 진행)`;
    else if (stage >= 3) stName = `Stage ${stage} (약세 둔화)`;
    else if (stage >= 1) stName = `Stage ${stage} (극약세)`;
    else stName = "Stage 0 (붕괴)";

    const curR = ind.rsi[i]; const prvR = ind.rsi[i-1] || curR;
    const rsi = { 
        cur: curR, prev: prvR, d5: curR - ind.rsi[Math.max(0, i-5)],
        crossUp30: prvR < 30 && curR >= 30, crossDown30: prvR >= 30 && curR < 30,
        crossUp40: prvR < 40 && curR >= 40, crossDown40: prvR >= 40 && curR < 40,
        crossUp50: prvR < 50 && curR >= 50, crossDown50: prvR >= 50 && curR < 50,
        crossUp70: prvR < 70 && curR >= 70, crossDown70: prvR >= 70 && curR < 70,
        oversoldExit: prvR < 30 && curR >= 30 && curR > prvR,
        overboughtExit: prvR >= 70 && curR < 70 && curR < prvR
    };

    const calcRS = (days, bmInd) => {
        if(i < days || !bmInd) return "N/A";
        let idxT = getAsOfIndex(tgtTime, bmInd.dates);
        let pastTime = new Date(ind.dates[i - days]).getTime();
        let idxP = getAsOfIndex(pastTime, bmInd.dates);
        if(idxT === -1 || idxP === -1 || bmInd.prices[idxP] === 0) return "N/A";
        return ((P / ind.prices[i-days]) - 1 - ((bmInd.prices[idxT] / bmInd.prices[idxP]) - 1)) * 100;
    };

    const calcMk = (bmInd) => {
        if(!bmInd) return { ok: false, desc: "N/A", p: null, m200: null, rsi: "N/A", mdd: "N/A", sl: null };
        let idx = getAsOfIndex(tgtTime, bmInd.dates);
        if(idx < 200) return { ok: false, desc: "N/A", p: null, m200: null, rsi: "N/A", mdd: "N/A", sl: null };
        let bp = bmInd.prices[idx], m200 = bmInd.ma[200][idx];
        let prev5Idx = getAsOfIndex(new Date(ind.dates[Math.max(0, i-5)]).getTime(), bmInd.dates);
        let sl200 = prev5Idx !== -1 && bmInd.ma[200][prev5Idx] ? (m200 / bmInd.ma[200][prev5Idx] - 1) * 100 : 0;
        let isOk = bp > m200 && sl200 > 0;
        return { ok: isOk, desc: isOk ? "BULL" : "BEAR", p: bp, m200, sl: sl200, rsi: bmInd.rsi[idx], curDD20: bmInd.currentDD20[idx]*100, mddAll: bmInd.mdd.all[idx] };
    };

    const atrPct = ind.atr[i] / P;
    let atrRank = "N/A";
    if (i >= 252) {
        let pAtr = []; for(let j=i-252; j<=i; j++) pAtr.push(ind.atr[j]/ind.prices[j]);
        pAtr.sort((a,b)=>a-b);
        atrRank = pAtr.findIndex(v => v >= atrPct) / 252;
    }

    return {
        date: ind.dates[i], price: P, prevPrice: prevP,
        ma, sl, stage, stName, rsi, atrPct, atrRank, realizedVol20: ind.realizedVol20[i], 
        vol: ind.volume[i], vol20: ind.vol20[i], curDD20: ind.currentDD20[i]*100,
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
// [DECISION ENGINE] Evaluate Signal
// ---------------------------------------------------------
function evaluateSignalAtDate(i, ind, spy, qqq, cfg, context) {
    const vm = buildViewModel(i, ind, spy, qqq, cfg);
    const isLive = context.mode === "live";
    let whyPositive = [], whyNegative = [], whyNotAggressive = [];

    let trSc = { a: 0, m: 25 }, moSc = { a: 0, m: 15 }, rsSc = { a: 0, m: 15 }, riSc = { a: 0, m: 15 }, mkSc = { a: 0, m: 15 };

    if(vm.price > vm.ma[200]) { trSc.a += 3; if(isLive) whyPositive.push("장기 추세선(200MA) 상단 유지"); } else whyNegative.push("200MA 하회 (장기 역배열)");
    if(vm.ma[120] > vm.ma[200]) trSc.a += 3; if(vm.sl[120] > 0) trSc.a += 2; if(vm.sl[200] > 0) trSc.a += 2;
    if(vm.price > vm.ma[60]) trSc.a += 2; if(vm.ma[20] > vm.ma[60]) trSc.a += 3; if(vm.sl[60] > 0) trSc.a += 2; if(vm.sl[20] > 0) trSc.a += 3;
    if(vm.price > vm.ma[5]) trSc.a += 1; if(vm.ma[5] > vm.ma[10]) trSc.a += 1; if(vm.ma[10] > vm.ma[15]) trSc.a += 1; if(vm.ma[15] > vm.ma[20]) trSc.a += 1; if(vm.sl[5] > 0) trSc.a += 1;

    if(vm.rsi.d5 > 5) moSc.a += 5;
    if(vm.rsi.oversoldExit) { moSc.a += 5; if(isLive) whyPositive.push("RSI 30 과매도권 이탈 (반등 시그널)"); } else if(vm.rsi.crossUp50) moSc.a += 5;
    if(vm.vol !== null && vm.vol > vm.vol20 * 1.5 && vm.price > vm.prevPrice) { moSc.a += 5; if(isLive) whyPositive.push("거래량 급증 동반 단기 상승"); }

    let rsAvail = 0; let rsSum = 0;
    const chkRS = (val) => { if(val !== "N/A") { rsAvail += 1.875; if(val > 0) rsSum += 1.875; } };
    chkRS(vm.rs.spy.d20); chkRS(vm.rs.spy.d60); chkRS(vm.rs.spy.d120); chkRS(vm.rs.spy.d252);
    chkRS(vm.rs.ndx.d20); chkRS(vm.rs.ndx.d60); chkRS(vm.rs.ndx.d120); chkRS(vm.rs.ndx.d252);
    rsSc.m = rsAvail; rsSc.a = rsSum;

    if(vm.atrRank !== "N/A") { if(vm.atrRank < 0.25) riSc.a += 4; else if(vm.atrRank < 0.5) riSc.a += 3; else if(vm.atrRank < 0.75) riSc.a += 1; }
    if(vm.realizedVol20 !== null) { if(vm.realizedVol20 < 0.2) riSc.a += 4; else if(vm.realizedVol20 < 0.4) riSc.a += 2; }
    
    let ext20 = vm.ma[20] ? (vm.price / vm.ma[20]) - 1 : 1;
    if(ext20 >= -0.05 && ext20 <= 0.05) { riSc.a += 4; } 
    else if(ext20 > 0.05 && ext20 <= 0.10) { riSc.a += 2; if(isLive) whyNegative.push(`단기 MA20 상방 이격(+${(ext20*100).toFixed(1)}%): 추격매수 위험`); }
    else if(ext20 >= -0.10 && ext20 < -0.05) { riSc.a += 2; if(isLive) whyNegative.push(`단기 MA20 하방 이격(${(ext20*100).toFixed(1)}%): 단기 약세 위험`); }
    
    if(vm.vol !== null && vm.vol >= vm.vol20 * 0.8) riSc.a += 3; else if(vm.vol !== null && vm.vol >= vm.vol20 * 0.5) riSc.a += 1;

    let mkAvail = 0; let mkSum = 0;
    const calcMkSc = (mkObj) => { let s=0; if(mkObj.p > mkObj.m200) s+=3; if(mkObj.sl > 0) s+=2; if(mkObj.rsi > 50) s+=2.5; return s; };
    if(spy) { mkAvail += 7.5; mkSum += calcMkSc(vm.market.spy); }
    if(qqq) { mkAvail += 7.5; mkSum += calcMkSc(vm.market.ndx); }
    mkSc.m = mkAvail; mkSc.a = mkSum;

    let availScore = trSc.m + moSc.m + rsSc.m + riSc.m + mkSc.m; 
    let baseScore = trSc.a + moSc.a + rsSc.a + riSc.a + mkSc.a;

    let overlap = 0;
    if(vm.price < vm.ma[20]) overlap++;
    if(vm.rsi.cur < 35) overlap++;
    if(vm.rs.spy.d20 !== "N/A" && vm.rs.spy.d20 < -5) overlap++;
    if(vm.atrRank !== "N/A" && vm.atrRank >= 0.8) overlap++;
    
    let penalty = 0;
    if(overlap === 3) penalty = 7; else if(overlap >= 4) penalty = 12; 
    let adjScore = Math.max(0, baseScore - penalty);

    let candW = 0.0;
    let ratio = availScore > 0 ? (adjScore / availScore) : 0;
    if(ratio >= 0.94) candW = cfg.maxExposure * 1.0; 
    else if(ratio >= 0.82) candW = cfg.maxExposure * 0.7; 
    else if(ratio >= 0.70) candW = cfg.maxExposure * 0.4; 
    else if(ratio >= 0.58) candW = cfg.maxExposure * 0.2; 
    else candW = 0.0;

    let entryCap = candW;
    let act = "", sty = "";
    const actW = context.actualWeight;

    if (vm.price < vm.ma[200] && vm.sl[200] < 0) {
        let confirms = 0;
        if (vm.rsi.oversoldExit) confirms++;
        if (vm.rs.spy.d20 > 0) confirms++;
        if (vm.price > vm.ma[20]) confirms++;
        if (vm.sl[20] > 0) confirms++;

        if(confirms >= 2) {
            entryCap = Math.min(entryCap, cfg.explorationMax); 
            if(isLive) whyNotAggressive.push(`장기 추세 하락이나 반등 확인. 신규 진입 최대 ${cfg.explorationMax*100}% 허용.`);
        } else {
            entryCap = 0; 
            if(isLive) whyNotAggressive.push("주가 < 200MA 역배열 구간. 반등 신호 미달로 신규 매수 전면 금지.");
        }
    }
    if (spy && qqq && !vm.market.spy.ok && !vm.market.ndx.ok) {
        entryCap = Math.min(entryCap, candW * 0.5);
        if(isLive) whyNotAggressive.push("미국 양대 지수 하락장으로 신규 진입 비중 50% 삭감.");
    }
    if (vm.rsi.cur > 70) {
        entryCap = 0; 
        if(isLive) whyNotAggressive.push("RSI 70 과열권 진입. 신규 추격 매수 원천 차단.");
    }

    let gateCap = Math.min(candW, entryCap);
    let targetW = Math.max(actW, gateCap); 
    
    if (candW === 0) {
        if (actW > 0) { act = "🟡 관망 / 보유 유지"; sty = "bg-slate-500 text-white"; }
        else { act = "🟡 관망"; sty = "bg-slate-500 text-white"; }
    }

    let isExplicitExit = false;
    let exitReason = null;
    
    if (cfg.exitType === "A") {
        if (vm.price < vm.ma[200] && vm.sl[200] < 0 && vm.price < vm.ma[60] && vm.curDD20 <= -20) {
            targetW = 0.0; isExplicitExit = true;
            exitReason = "장기추세 붕괴 + 중기 붕괴 + 단기 급락(-20% 이하)";
        }
    } else if (cfg.exitType === "C") { 
        if (vm.price < vm.ma[200] && vm.sl[200] < 0 && vm.curDD20 <= -25) {
            targetW = 0.0; isExplicitExit = true;
            exitReason = "장기추세 붕괴 + 극한 단기 급락(-25% 이하)";
        }
    }

    if (isExplicitExit) {
        act = "🔴 명시적 위험관리 청산"; sty = "bg-red-600 text-white";
        if(isLive) whyNegative.push(`[위험관리 청산] ${exitReason} ➔ Target 0 강제 할당`);
    }

    if (act === "") {
        if (targetW >= cfg.maxExposure) { act = "🟢 적극 매수 후보"; sty = "bg-green-600 text-white"; }
        else if (targetW >= 0.2) { act = "🟢 1차 분할매수"; sty = "bg-emerald-500 text-white"; }
        else if (targetW > 0) { act = "🟡 소액 탐색"; sty = "bg-yellow-500 text-slate-900"; }
    }

    let tradeDelta = targetW - actW;
    
    if(isLive && act.includes("매수") && whyNotAggressive.length === 0) whyNotAggressive.push("매수를 제약하는 뚜렷한 Hard Gate 미발동.");

    let log = [];
    if(isLive) log.push(`CALC: Adj ${adjScore} -> Cand ${(candW*100).toFixed(0)}% -> GateCap ${(gateCap*100).toFixed(0)}% -> Target ${(targetW*100).toFixed(0)}%`);

    return { 
        availScore, baseScore, adjScore, riskPenalty: penalty, candW, entryCap, gateCap, finalTargetWeight: targetW, actualWeight: actW, tradeDeltaWeight: tradeDelta,
        act, sty, tr: trSc, mo: moSc, rs: rsSc, ri: riSc, mk: mkSc,
        whyPositive, whyNegative, whyNotAggressive, log, vm, isExplicitExit, stage: vm.stage
    };
}

// ---------------------------------------------------------
// [BACKTEST ACCOUNTING ENGINE]
// ---------------------------------------------------------
function runBacktestSegment(startIdx, endIdx, ind, spy, qqq, cfg, isIsSegment) {
    if(endIdx - startIdx < 50) return null;

    let res = { rebalanceLedger: [], positionCycles: [], eqGross: [1.0], eqNet: [1.0], bh: [1.0], cumCost: 0, turnAmt: 0, rets: [], days: endIdx - startIdx - 1 };
    let st = { cash: 1.0, shares: 0, actualWeight: 0.0, avgCost: 0, cumCost: 0, prevEq: 1.0 };
    let bhCash = 1.0, bhShares = 0;
    let activeCycle = null;

    for (let i = startIdx; i < endIdx - 1; i++) { 
        let eqAtClose = st.cash + (st.shares * ind.prices[i]);
        let actWAtClose = eqAtClose === 0 ? 0 : (st.shares * ind.prices[i]) / eqAtClose;

        let ctx = { actualWeight: actWAtClose, mode: "backtest" };
        let ev = evaluateSignalAtDate(i, ind, spy, qqq, cfg, ctx);
        let targetW = ev.finalTargetWeight;

        let openT1 = ind.open[i+1];
        let closeT1 = ind.prices[i+1];

        if (i === startIdx) { bhShares = Math.floor(bhCash / openT1); bhCash = bhCash - (bhShares * openT1); }
        res.bh.push(bhCash + (bhShares * closeT1));

        let eqAtOpen = st.cash + (st.shares * openT1);
        let actWAtOpen = eqAtOpen === 0 ? 0 : (st.shares * openT1) / eqAtOpen;
        let deltaWt = targetW - actWAtOpen;
        
        let isTrade = false;
        let executedShares = 0;
        let actualExecAmt = 0;
        let cost = 0;

        if (Math.abs(deltaWt) > cfg.execThreshold) {
            if (deltaWt > 0) { 
                let maxAllowedWt = cfg.maxExposure - actWAtOpen;
                let validDelta = Math.max(0, Math.min(deltaWt, maxAllowedWt));
                let desiredBuyAmt = eqAtOpen * validDelta;
                let maxBuyable = Math.min(desiredBuyAmt, st.cash / (1 + cfg.costRate));
                let floorShares = Math.floor(maxBuyable / openT1);

                if (floorShares > 0) {
                    actualExecAmt = floorShares * openT1;
                    cost = actualExecAmt * cfg.costRate;
                    st.cash -= (actualExecAmt + cost);
                    st.avgCost = ((st.shares * st.avgCost) + actualExecAmt) / (st.shares + floorShares);
                    st.shares += floorShares;
                    executedShares = floorShares;
                    isTrade = true;
                }
            } else { 
                let desiredSellAmt = eqAtOpen * Math.abs(deltaWt);
                let floorShares = Math.floor(desiredSellAmt / openT1);
                if (targetW === 0) floorShares = st.shares; 
                
                if (floorShares > 0 && floorShares <= st.shares) {
                    actualExecAmt = floorShares * openT1;
                    cost = actualExecAmt * cfg.costRate;
                    st.cash += (actualExecAmt - cost);
                    let rPnL = actualExecAmt - (floorShares * st.avgCost) - cost; 
                    st.shares -= floorShares;
                    executedShares = -floorShares;
                    isTrade = true;
                    if(st.shares === 0) st.avgCost = 0;
                }
            }
        }

        if (isTrade) {
            st.cumCost += cost;
            res.cumCost += cost;
            res.turnAmt += actualExecAmt;

            let newEqOpen = st.cash + (st.shares * openT1);
            let actWAfter = newEqOpen === 0 ? 0 : (st.shares * openT1) / newEqOpen;
            
            if (actWAfter > cfg.maxExposure + 0.0001) console.error("Invariant Violated: Executed Wt > Max Exposure");
            if (st.cash < 0) console.error("Invariant Violated: Cash < 0");

            let netCF = executedShares > 0 ? -(actualExecAmt + cost) : (actualExecAmt - cost);
            
            res.rebalanceLedger.push({
                date: ind.dates[i+1], side: executedShares > 0 ? "BUY" : "SELL", shares: Math.abs(executedShares), price: openT1, 
                grossAmount: actualExecAmt, cost, netCF, weightBefore: actWAtOpen, targetWeight: targetW, weightAfter: actWAfter
            });

            if (actWAtOpen === 0 && executedShares > 0) {
                activeCycle = { entryDate: ind.dates[i+1], initialCapital: eqAtOpen, totalBuyCash: 0, totalSellCash: 0, totalCosts: 0, rebCount: 0 };
            }
            if (activeCycle) {
                if (executedShares > 0) activeCycle.totalBuyCash += actualExecAmt;
                else activeCycle.totalSellCash += actualExecAmt;
                activeCycle.totalCosts += cost;
                activeCycle.rebCount++;
                
                if (st.shares === 0) {
                    activeCycle.exitDate = ind.dates[i+1];
                    activeCycle.realizedPnL = activeCycle.totalSellCash - activeCycle.totalBuyCash - activeCycle.totalCosts; 
                    activeCycle.holdingDays = (new Date(activeCycle.exitDate) - new Date(activeCycle.entryDate)) / 86400000;
                    res.positionCycles.push(activeCycle);
                    activeCycle = null;
                }
            }
            st.actualWeight = actWAfter;
        } else {
            st.actualWeight = actWAtOpen; 
        }

        let netEquity = st.cash + (st.shares * closeT1);
        let grossEquity = netEquity + st.cumCost;
        
        res.eqNet.push(netEquity);
        res.eqGross.push(grossEquity);
        res.rets.push((netEquity / st.prevEq) - 1);
        st.prevEq = netEquity;

        if (isIsSegment && i === endIdx - 2 && activeCycle) {
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

        return { 
            cagr, bhCagr, mdd: maxDD*100, bhMdd: bhMaxDD*100, sharpe, sortino, calmar, 
            trd: totalT, winRate: winRate*100, pf, exp, avgWin, avgLoss, avgHold: totalT===0?0:hold/totalT, 
            turnCum, cumCost: r.cumCost, grossEnd: r.eqGross[r.eqGross.length-1], netEnd: r.eqNet[r.eqNet.length-1],
            maxConsL
        };
    };

    return calcMetrics(res);
}

// ---------------------------------------------------------
// [CONFIDENCE ENGINE]
// ---------------------------------------------------------
function calculateConfidence(dv, btOos, sens) {
    if(!btOos) return { val: 0, t: "검증 불가" };
    let conf = 0;
    
    conf += (dv.comp / 100) * 10; 
    if(btOos.cagr > 0) conf += 20; 
    if(btOos.sharpe !== "N/A" && btOos.sharpe > 1.0) conf += 20; else if(btOos.sharpe !== "N/A" && btOos.sharpe > 0.5) conf += 10;
    
    let exps = [btOos.cagr, sens.exp50.cagr, sens.exp80.cagr].filter(Number.isFinite);
    if (exps.length > 0 && Math.max(...exps) - Math.min(...exps) < 0.05) conf += 20;

    if (btOos.cagr > 0 && btOos.bhCagr > 0) conf += 15; 

    if(btOos.trd < 5) conf = Math.min(conf, 50);
    else if(btOos.trd < 10) conf = Math.min(conf, 60);
    else if(btOos.trd < 20) conf = Math.min(conf, 75);
    else conf = Math.min(conf, 85); 

    let t = "";
    if(conf >= 75) t = "우수 (Walk-Forward 미검증 제한 85점)";
    else if(conf >= 60) t = "보통 (유의미한 통계)";
    else t = "낮음 (표본 부족 제한 적용)";

    return { val: Math.floor(conf), t };
}

// ---------------------------------------------------------
// [UNIT TEST LAYER]
// ---------------------------------------------------------
function runExtremeUnitTests(cfg) {
    let results = [];
    const tLog = (name, pass) => results.push({ name, pass });
    
    const makeMock = (price, rsiVal) => {
        let res = { dates:[], open:[], high:[], low:[], close:[], volume:[] };
        for(let j=0; j<300; j++) {
            res.dates.push(`2026-01-${String((j%30)+1).padStart(2,'0')}`);
            res.open.push(price); res.high.push(price*1.05); res.low.push(price*0.95); res.close.push(price); res.volume.push(1000);
        }
        let ind = buildIndicators(res);
        ind.rsi[299] = rsiVal; ind.rsi[298] = rsiVal;
        return ind;
    };
    
    let baseInd = makeMock(100, 50);
    let i = 299;

    let fiRsi = JSON.parse(JSON.stringify(baseInd));
    for(let k=i-15; k<=i; k++) fiRsi.prices[k] = 100;
    let testRSI = calcRSI(fiRsi.prices, 14)[i];
    tLog("RSI Edge Case (Flat=50)", testRSI === 50);

    let fiMDD5 = JSON.parse(JSON.stringify(baseInd)); fiMDD5.currentDD20[i] = -0.05;
    let fiMDD80 = JSON.parse(JSON.stringify(baseInd)); fiMDD80.currentDD20[i] = -0.80;
    fiMDD80.prices[i] = 100; fiMDD80.ma[200][i] = 90; fiMDD80.ma[200][Math.max(0, i-5)] = 80; 
    let evM5 = evaluateSignalAtDate(i, fiMDD5, null, null, cfg, { actualWeight: 0, mode: "test" });
    let evM80 = evaluateSignalAtDate(i, fiMDD80, null, null, cfg, { actualWeight: 0, mode: "test" });
    tLog("MDD Score Independence (Base/Pen/Cand Same)", 
        evM5.baseScore === evM80.baseScore && evM5.riskPenalty === evM80.riskPenalty && evM5.candW === evM80.candW);

    let fiA = JSON.parse(JSON.stringify(baseInd));
    fiA.prices[i] = 50; fiA.ma[200][i] = 100; fiA.ma[200][Math.max(0, i-5)] = 110; 
    fiA.ma[60][i] = 80; fiA.currentDD20[i] = -0.22; 
    let eA = evaluateSignalAtDate(i, fiA, null, null, cfg, { actualWeight: 0.3, mode: "test" });
    tLog("Explicit Exit A (Target 0)", eA.finalTargetWeight === 0 && eA.isExplicitExit === true);

    let fiE = JSON.parse(JSON.stringify(baseInd));
    fiE.prices[i] = 10; fiE.ma[200][i] = 100; fiE.ma[200][Math.max(0, i-5)] = 90; 
    let eE = evaluateSignalAtDate(i, fiE, null, null, cfg, { actualWeight: 0.3, mode: "test" });
    tLog("Candidate0 Invariant (Actual Hold)", eE.candW === 0 && eE.finalTargetWeight === 0.3);

    let fiF = JSON.parse(JSON.stringify(baseInd)); fiF.rsi[i] = 85; 
    let eG = evaluateSignalAtDate(i, fiF, null, null, cfg, { actualWeight: 0.3, mode: "test" });
    tLog("RSI>70 (Target <= Actual)", eG.finalTargetWeight <= 0.3);

    tLog("Stage 0~9 Exclusive Range", evM5.stage >= 0 && evM5.stage <= 9);

    return results;
}

// ---------------------------------------------------------
// [PURCHASE SIMULATOR] (Read-Only)
// ---------------------------------------------------------
function initPurchaseSimulator() {
    calcSimulator();
}

function calcSimulator() {
    if(!lastEvaluationResult) return;
    const { ind, ev, cfg } = lastEvaluationResult;
    const vm = ev.vm;
    
    let cash = parseFloat(document.getElementById('sim-cash')?.value || 10000);
    let shares = parseFloat(document.getElementById('sim-shares')?.value || 0);
    let isCcy = document.getElementById('quant-ticker-input')?.value.endsWith(".KS") ? "₩" : "$";
    
    let totalEq = cash + (shares * vm.price);
    let actW = totalEq === 0 ? 0 : (shares * vm.price) / totalEq;
    let delta = ev.finalTargetWeight - actW;
    
    let buyAmt = totalEq * Math.max(delta, 0);
    let maxBuy = Math.min(buyAmt, cash / (1 + cfg.costRate));
    let floorShares = Math.floor(maxBuy / vm.price);
    let execAmt = floorShares * vm.price;
    let execWt = totalEq === 0 ? 0 : ((shares + floorShares) * vm.price) / totalEq;

    const downPrices = [-0.05, -0.10, -0.15];
    let downScenarios = downPrices.map(pct => {
        let pTrigger = vm.price * (1 + pct);
        let confirms = 0;
        if (vm.rsi.oversoldExit) confirms++;
        if (vm.rs.spy.d20 > 0) confirms++;
        if (pTrigger > vm.ma[20]) confirms++;
        if (vm.sl[20] > 0) confirms++;
        
        let isConfirm = confirms >= 2;
        let act = isConfirm ? "🟢 매수" : (confirms === 1 ? "🟡 관찰" : "🔴 보류");
        
        let addShares = 0, addAmt = 0, cost = 0, postWt = actW * 100;
        if (isConfirm) {
            let desiredWt = Math.min(actW + 0.10, cfg.maxExposure); 
            let dlt = desiredWt - actW;
            if (dlt > 0) {
                let maxB = Math.min(totalEq * dlt, cash / (1 + cfg.costRate));
                addShares = Math.floor(maxB / pTrigger);
                if(addShares > 0) {
                    addAmt = addShares * pTrigger;
                    cost = addAmt * cfg.costRate;
                    let postEq = (cash - addAmt - cost) + (shares + addShares) * pTrigger;
                    postWt = (addShares + shares) * pTrigger / postEq * 100;
                }
            }
        }
        return `<tr class="border-b border-slate-100"><td class="py-1">${(pct*100).toFixed(0)}%</td><td>${pTrigger.toFixed(2)}</td><td>${confirms}/4</td><td>${act}</td><td class="text-right">${addShares}</td><td class="text-right">${postWt.toFixed(1)}%</td></tr>`;
    }).join('');

    let upPrices = [+0.05, +0.10];
    let upScenarios = upPrices.map(pct => {
        let pTrigger = vm.price * (1 + pct);
        let isConfirm = (pTrigger > vm.ma[20] && vm.sl[20] > 0 && vm.rsi.cur > 50 && vm.rs.spy.d20 > 0);
        let act = isConfirm ? "🟢 매수" : "🔴 보류";
        return `<tr class="border-b border-slate-100"><td class="py-1">${(pct*100).toFixed(0)}%</td><td>${pTrigger.toFixed(2)}</td><td>${isConfirm?'Y':'N'}</td><td>${act}</td></tr>`;
    }).join('');

    let tpHTML = `
        <tr><td class="py-1">+15% 수익 도달</td><td>부분 익절 (25%)</td></tr>
        <tr><td class="py-1">200MA 저항대 도달</td><td>부분 익절 (30%)</td></tr>
        <tr><td class="py-1">RSI 과열 (>70)</td><td>부분 익절 (30%)</td></tr>
        <tr><td class="py-1">추세 훼손 (MA20 이탈)</td><td>잔량 청산 검토</td></tr>
    `;

    let html = `
        <div class="bg-white p-4 rounded-xl border border-slate-200 mt-4 shadow-sm">
            <h4 class="font-black text-sm mb-3 border-b pb-2">💰 구매 시뮬레이터 (System READ-ONLY)</h4>
            <div class="grid grid-cols-2 gap-4 text-[10px] mono">
                <div class="bg-slate-50 p-2 rounded">
                    <b>포트폴리오 상태</b><br>
                    Cash: ${isCcy}${cash.toFixed(2)}<br>
                    Total Equity: ${isCcy}${totalEq.toFixed(2)}<br>
                    Actual Weight: ${(actW*100).toFixed(1)}%<br>
                    Trade Delta: ${(delta*100).toFixed(1)}%p
                </div>
                <div class="bg-indigo-50 p-2 rounded border border-indigo-100">
                    <b>실제 체결 (정수 연산)</b><br>
                    System Target: ${(ev.finalTargetWeight*100).toFixed(1)}%<br>
                    Order: ${floorShares}주 (${isCcy}${execAmt.toFixed(2)})<br>
                    Cost: ${isCcy}${(execAmt * cfg.costRate).toFixed(2)}<br>
                    <b>Executed Wt: ${(execWt*100).toFixed(1)}%</b> (Max ${cfg.maxExposure*100}%)
                </div>
            </div>
            
            <div class="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    <b>📉 하락 추가진입 시나리오 (Price + 2-of-4 Confirm)</b>
                    <table class="w-full text-center text-[10px] mt-1 border-t border-slate-200">
                        <thead><tr class="border-b text-slate-500"><th>Trigger</th><th>Price</th><th>Confirm</th><th>Action</th><th>Shares</th><th>Post-Wt</th></tr></thead>
                        <tbody>${downScenarios}</tbody>
                    </table>
                </div>
                <div>
                    <b>📈 상승 추세추종 시나리오 (Price + Trend Confirm)</b>
                    <table class="w-full text-center text-[10px] mt-1 border-t border-slate-200">
                        <thead><tr class="border-b text-slate-500"><th>Trigger</th><th>Price</th><th>Confirm</th><th>Action</th></tr></thead>
                        <tbody>${upScenarios}</tbody>
                    </table>
                </div>
            </div>
            
            <div class="mt-4">
                <b>🎯 이익실현 시나리오 (단순 수익률 매도 지양)</b>
                <table class="w-full text-center text-[10px] mt-1 border-t border-slate-200">
                    <tbody>${tpHTML}</tbody>
                </table>
            </div>
        </div>
    `;
    let simCont = document.getElementById('simulator-container');
    if(simCont) simCont.innerHTML = html;
}

// ---------------------------------------------------------
// [UI RENDER LAYER]
// ---------------------------------------------------------
function renderEQDS_UI(ctx) {
    const { ticker, ev, dv, btIs, btOosA, btOosB, btOosC, conf, sensitivity, tests } = ctx;
    const vm = ev.vm;
    const isCcy = ticker.endsWith(".KS") || ticker.endsWith(".KQ") ? "₩" : "$";
    
    const maRows = [5, 10, 15, 20, 60, 120, 200].map(n => {
        let v = vm.ma[n], s = vm.sl[n], d = v ? ((vm.price/v)-1)*100 : null;
        return `<tr class="border-b border-slate-100"><td class="py-1.5 font-bold">${n}MA</td><td class="py-1.5 text-right mono">${v?v.toFixed(2):'-'}</td><td class="py-1.5 text-right mono ${d>0?'text-green-600':'text-red-500'}">${d>0?'+'+d.toFixed(2):d?d.toFixed(2):'-'}%</td><td class="py-1.5 text-center font-bold text-[10px] ${s>0?'text-green-600':'text-red-500'}">${s>0?'↑':'↓'}</td></tr>`;
    }).join('');

    const fmtRS = (val) => val === "N/A" ? "N/A" : (val > 0 ? '+'+val.toFixed(2) : val.toFixed(2)) + '%p';
    const mddCell = (n, mObj) => `<div class="flex justify-between"><span>${n}:</span><span>Cur ${(mObj.currentDD*100).toFixed(1)}% | Max ${(mObj.maxDD).toFixed(1)}%</span></div>`;

    let actionClass = "bg-slate-500";
    if (ev.isExplicitExit) actionClass = "bg-red-600";
    else if (ev.finalTargetWeight >= 0.5) actionClass = "bg-green-600";
    else if (ev.finalTargetWeight > 0) actionClass = "bg-emerald-500";
    
    let actionText = "관망";
    if (ev.isExplicitExit) actionText = "명시적 위험관리 청산";
    else if (ev.finalTargetWeight >= 0.5) actionText = "적극 매수 후보";
    else if (ev.finalTargetWeight > 0) actionText = "분할 매수";

    let h = `
        <div class="space-y-6">
            <div class="flex justify-between items-end border-b border-slate-200 pb-3">
                <div><h1 class="text-3xl font-black text-slate-800">${ticker}</h1><div class="text-sm font-bold text-slate-500 mt-1">현재가: ${isCcy}${vm.price.toLocaleString()} | 데이터완성도: ${dv.comp.toFixed(1)}%</div></div>
            </div>
            
            <div class="p-6 rounded-xl text-center shadow-sm ${actionClass} text-white border border-black/10">
                <div class="text-xs font-bold opacity-80 mb-1">최종 판단 (Final Action)</div>
                <h2 class="text-4xl font-black mb-3">${actionText}</h2>
                <div class="flex flex-wrap justify-center gap-2">
                    <div class="bg-black/20 px-3 py-1 rounded-full text-xs font-bold">Base: ${ev.baseScore} ➔ Adj: ${ev.adjScore}</div>
                    <div class="bg-black/20 px-3 py-1 rounded-full text-xs font-bold">검증 신뢰도: ${conf.val}/100</div>
                    <div class="bg-white/90 text-slate-900 px-3 py-1 rounded-full text-xs font-black">System Target: ${(ev.finalTargetWeight*100).toFixed(0)}%</div>
                </div>
                <div class="text-[10px] mt-2 font-mono flex justify-center gap-2">
                    <span class="bg-slate-100 text-slate-800 px-2 py-1 rounded">Actual: ${(ev.actualWeight*100).toFixed(0)}%</span>
                    <span class="bg-slate-100 text-slate-800 px-2 py-1 rounded">Cand: ${(ev.candW*100).toFixed(0)}%</span>
                    <span class="bg-slate-100 text-slate-800 px-2 py-1 rounded">Gate Cap: ${(ev.gateCap*100).toFixed(0)}%</span>
                    <span class="bg-indigo-100 text-indigo-800 px-2 py-1 rounded font-bold">Delta: ${(ev.tradeDeltaWeight*100).toFixed(0)}%p</span>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-3 text-center">
                <div class="bg-blue-50 p-3 rounded-lg"><div class="text-xs font-bold text-blue-500">S&P500 (SPY proxy)</div><div class="text-sm font-black ${vm.market.spy.ok?'text-green-600':'text-red-500'} mt-1">${vm.market.spy.desc}</div></div>
                <div class="bg-blue-50 p-3 rounded-lg"><div class="text-xs font-bold text-blue-500">NASDAQ100 (QQQ proxy)</div><div class="text-sm font-black ${vm.market.ndx.ok?'text-green-600':'text-red-500'} mt-1">${vm.market.ndx.desc}</div></div>
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
                    <h4 class="font-bold text-xs text-slate-800 mb-2 border-b pb-1">Multi-MDD (Risk Context)</h4>
                    <div class="text-[10px] font-mono text-red-600 space-y-1">
                        ${mddCell("20D", vm.mdd.d20)}
                        ${mddCell("60D", vm.mdd.d60)}
                        ${mddCell("120D", vm.mdd.d120)}
                        ${mddCell("252D", vm.mdd.d252)}
                        <div class="flex justify-between font-bold"><span>ALL:</span><span>Cur ${(vm.mdd.all.currentDD*100).toFixed(1)}% | Max ${(vm.mdd.all.maxDD).toFixed(1)}%</span></div>
                    </div>
                    <div class="text-[10px] text-slate-600 mt-2 font-bold bg-slate-50 p-2 rounded">
                        * MDD는 매수 점수에 반영되지 않으며, 리스크 확인용입니다.<br>
                        Max DD 발생일: ${vm.mdd.all.maxPeakDate}<br>
                        Max DD 회복률: <span class="text-blue-600">${vm.mdd.all.recoveryRatio === "N/A" ? "N/A" : vm.mdd.all.recoveryRatio.toFixed(1)+'%'}</span>
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
                    <h4 class="text-xs font-black text-green-700 mb-2 border-b pb-1">📈 긍정 요인</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1">${ev.whyPositive.length?ev.whyPositive.map(c=>`<li>+ ${c}</li>`).join(''):'<li>특이사항 없음</li>'}</ul>
                </div>
                <div class="border border-red-200 bg-red-50/30 rounded-xl p-4">
                    <h4 class="text-xs font-black text-red-700 mb-2 border-b pb-1">📉 부정 요인</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1">${ev.whyNegative.length?ev.whyNegative.map(c=>`<li>- ${c}</li>`).join(''):'<li>특이사항 없음</li>'}</ul>
                </div>
                <div class="border border-slate-300 bg-slate-100 rounded-xl p-4 shadow-inner">
                    <h4 class="text-xs font-black text-slate-800 mb-2 border-b pb-1">🛑 아직 적극 매수하지 않는 이유</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1 font-bold">${ev.whyNotAggressive.length?ev.whyNotAggressive.map(c=>`<li>• ${c}</li>`).join(''):'<li>특이 제약 없음</li>'}</ul>
                </div>
            </div>
            
            <div id="simulator-container"></div>

            <!-- Backtest Engine -->
            <div class="bg-slate-800 text-white rounded-xl p-5 mt-4">
                <h4 class="text-xs font-black text-emerald-400 mb-3 border-b border-slate-600 pb-2">백테스트 (T+1 Open 실행 / 15bp 거래비용 반영 Net Return)</h4>
                ${btIs && btOosA ? `
                <div class="grid grid-cols-1 gap-4 text-[10px] mono">
                    <div>
                        <div class="text-indigo-300 font-bold mb-1 bg-indigo-900 px-2 py-1 rounded inline-block">[Explicit Exit 병렬 검증 - OOS 독립구간]</div>
                        <table class="w-full text-center mt-2 border-collapse">
                            <thead><tr class="border-b border-slate-600 text-slate-400">
                                <th class="py-1 text-left">지표</th><th>Exit A (기본)</th><th>Exit B (미사용)</th><th>Exit C (완화)</th>
                            </tr></thead>
                            <tbody>
                                <tr><td class="py-1 text-left text-slate-400">Net CAGR</td><td class="text-emerald-400">${(btOosA.cagr*100).toFixed(1)}%</td><td>${(btOosB.cagr*100).toFixed(1)}%</td><td>${(btOosC.cagr*100).toFixed(1)}%</td></tr>
                                <tr><td class="py-1 text-left text-slate-400">Net MDD</td><td>${btOosA.mdd.toFixed(1)}%</td><td>${btOosB.mdd.toFixed(1)}%</td><td>${btOosC.mdd.toFixed(1)}%</td></tr>
                                <tr><td class="py-1 text-left text-slate-400">Sharpe</td><td>${btOosA.sharpe !== "N/A" ? btOosA.sharpe.toFixed(2) : "N/A"}</td><td>${btOosB.sharpe !== "N/A" ? btOosB.sharpe.toFixed(2) : "N/A"}</td><td>${btOosC.sharpe !== "N/A" ? btOosC.sharpe.toFixed(2) : "N/A"}</td></tr>
                                <tr><td class="py-1 text-left text-slate-400">Sortino</td><td>${btOosA.sortino !== "N/A" ? btOosA.sortino.toFixed(2) : "N/A"}</td><td>${btOosB.sortino !== "N/A" ? btOosB.sortino.toFixed(2) : "N/A"}</td><td>${btOosC.sortino !== "N/A" ? btOosC.sortino.toFixed(2) : "N/A"}</td></tr>
                                <tr><td class="py-1 text-left text-slate-400">Trades</td><td>${btOosA.trd}회</td><td>${btOosB.trd}회</td><td>${btOosC.trd}회</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="mt-3 pt-2 border-t border-slate-600 text-[9px] text-slate-400 flex flex-col gap-1">
                    <div class="font-bold text-slate-300">[파라미터 민감도 독립 검증 (OOS Net CAGR)]</div>
                    <div class="flex justify-between"><span>Max Exposure (50/60/80%):</span><span>${(sensitivity.exp50.cagr*100).toFixed(1)}% | ${(sensitivity.exp60.cagr*100).toFixed(1)}% | <b>${(btOosA.cagr*100).toFixed(1)}%(Core 70)</b> | ${(sensitivity.exp80.cagr*100).toFixed(1)}%</span></div>
                    <div class="flex justify-between"><span>Mid MA (50/70):</span><span>${(sensitivity.pm50.cagr*100).toFixed(1)}% | <b>${(btOosA.cagr*100).toFixed(1)}%(Core 60)</b> | ${(sensitivity.pm70.cagr*100).toFixed(1)}%</span></div>
                    <div class="flex justify-between"><span>Long MA (180/220):</span><span>${(sensitivity.pl180.cagr*100).toFixed(1)}% | <b>${(btOosA.cagr*100).toFixed(1)}%(Core 200)</b> | ${(sensitivity.pl220.cagr*100).toFixed(1)}%</span></div>
                    <div class="flex justify-between"><span>Exec Threshold (0.5/2%):</span><span>${(sensitivity.thr05.cagr*100).toFixed(1)}% | <b>${(btOosA.cagr*100).toFixed(1)}%(Core 1)</b> | ${(sensitivity.thr20.cagr*100).toFixed(1)}%</span></div>
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
                    <h4 class="text-xs font-black text-slate-800 mb-2 border-b border-slate-300 pb-1">Unit Tests (Engine Invariant Check)</h4>
                    <ul class="text-[9px] text-slate-600 space-y-1 font-mono">${tests.map(r=>`<li>[${r.pass?'PASS':'FAIL'}] ${r.name}</li>`).join('')}</ul>
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
    if (chkRsi && chkRsi.checked) ds.push({ label: 'RSI(14)', data: currentQuantData.rsi.map(r=>r?r.cur:null), borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' });
    
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
