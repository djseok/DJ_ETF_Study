// =========================================================
// 🧠 EQDS V2.2.4 MASTER FINAL (Report & Korean UI Edition)
// Explainable Quantitative Decision System
// =========================================================

let quantChartInstance = null;
let currentQuantData = null;

// [CONFIG]
const EXECUTION_THRESHOLD = 0.01; // 1% 비중 변화 시 거래
const SLIPPAGE_TAX_RATE = 0.0015; // 15bp 거래비용

async function runQuantAnalysis() {
    const tickerInput = document.getElementById('quant-ticker-input');
    if (!tickerInput || !tickerInput.value.trim()) return;
    const tickerStr = tickerInput.value.trim().toUpperCase();

    const statusMsg = document.getElementById('quant-status-msg');
    const resultContainer = document.getElementById('quant-result-container');
    if(statusMsg) statusMsg.innerHTML = `<i class="fas fa-spinner fa-spin text-indigo-500 mr-1"></i> <b>${tickerStr}</b> 데이터 수집 및 정량 엔진 구동 중...`;
    if(resultContainer) resultContainer.classList.add('hidden');

    try {
        const GAS_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
        let queryTicker = /^\d{6}$/.test(tickerStr) ? tickerStr + ".KS" : tickerStr;

        // 1. Fetch Market Data
        const [targetRes, spyRes, qqqRes] = await Promise.all([
            fetch(`${GAS_PROXY_URL}?ticker=${queryTicker}&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=SPY&range=5y`),
            fetch(`${GAS_PROXY_URL}?ticker=QQQ&range=5y`)
        ]);

        if (!targetRes.ok) throw new Error("타겟 종목 데이터 호출 실패");
        const targetData = await targetRes.json();
        const spyData = await spyRes.json();
        const qqqData = await qqqRes.json();

        if (targetData.error || !targetData.chart || !targetData.chart.result) throw new Error("유효하지 않은 티커 또는 데이터 부족");

        // 2. Data Validation
        const rawTarget = extractOHLCV(targetData);
        const dataVal = validateDataQuality(rawTarget);
        if (dataVal.score < 40) throw new Error("데이터 품질 치명적 결함 (Score < 40). 분석 중단.");

        // 3. Indicator Building
        const indicators = buildIndicators(rawTarget);
        const rawSpy = spyData.error ? null : extractOHLCV(spyData);
        const rawQqq = qqqData.error ? null : extractOHLCV(qqqData);
        const spyInd = rawSpy ? buildIndicators(rawSpy) : null;
        const qqqInd = rawQqq ? buildIndicators(rawQqq) : null;

        const coreConfig = { mid: 60, long: 200 };

        // 4. Unit Testing (Strict Engine Verification)
        const unitTestResults = runExtremeUnitTests(coreConfig);

        // 5. Live Evaluation
        const liveIndex = rawTarget.close.length - 1;
        const liveContext = { currentWeight: 0.0, mode: "live" }; 
        const liveEval = evaluateSignalAtDate(liveIndex, indicators, spyInd, qqqInd, coreConfig, liveContext);

        // 6. Backtest Accounting Engine
        const btResult = runBacktestEngine(indicators, spyInd, qqqInd, coreConfig);

        // 7. Parameter Sensitivity (Independent Runs)
        const pm50 = runBacktestEngine(indicators, spyInd, qqqInd, { mid: 50, long: 200 });
        const pm70 = runBacktestEngine(indicators, spyInd, qqqInd, { mid: 70, long: 200 });
        const pl180 = runBacktestEngine(indicators, spyInd, qqqInd, { mid: 60, long: 180 });
        const pl220 = runBacktestEngine(indicators, spyInd, qqqInd, { mid: 60, long: 220 });

        // 8. Confidence Engine
        const confidence = calculateConfidence(dataVal, btResult, pm50, pm70, pl180, pl220, liveEval);

        // 9. UI Rendering
        currentQuantData = indicators;
        renderEQDS_UI({
            ticker: tickerStr, ev: liveEval, dv: dataVal, bt: btResult, conf: confidence,
            sensitivity: { pm50, pm70, pl180, pl220 }, tests: unitTestResults
        });

        if(statusMsg) statusMsg.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> 분석 및 리포트 생성 완료`;
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
            if (curT <= lastT) continue;
            lastT = curT;
            const d = new Date(curT);
            res.dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
            res.open.push(q.open[i]); res.high.push(q.high[i]);
            res.low.push(q.low[i]); res.close.push(q.close[i]);
            res.volume.push(q.volume[i] || 0);
        }
    }
    return res;
}

function validateDataQuality(ohlcv) {
    let score = 100, errors = [], oErr = 0, zVol = 0;
    for(let i=0; i<ohlcv.close.length; i++) {
        if(ohlcv.high[i] < ohlcv.low[i] || ohlcv.high[i] < Math.max(ohlcv.open[i], ohlcv.close[i])) oErr++;
        if(ohlcv.low[i] > Math.min(ohlcv.open[i], ohlcv.close[i])) oErr++;
        if(ohlcv.open[i] <= 0 || ohlcv.close[i] <= 0) oErr++;
        if(ohlcv.volume[i] === 0) zVol++;
    }
    if(oErr > 0) { score -= 30; errors.push(`OHLC 구조 오류 ${oErr}건`); }
    if(zVol > 50) { score -= 10; errors.push(`거래량 누락 과다`); }
    if(ohlcv.close.length < 252) { score -= 40; errors.push(`표본 1년 미만`); }
    
    let isAsc = true;
    for(let i=1; i<ohlcv.dates.length; i++) { if(new Date(ohlcv.dates[i]) <= new Date(ohlcv.dates[i-1])) isAsc = false; }
    if(!isAsc) { score -= 50; errors.push("날짜 정렬 오류"); }

    return { score: Math.max(0, score), errors: errors.length ? errors : ["정상"], comp: Math.min(100, (ohlcv.close.length/1260)*100) };
}

// ---------------------------------------------------------
// [INDICATOR LAYER]
// ---------------------------------------------------------
function buildIndicators(ohlcv) {
    if(!ohlcv || ohlcv.close.length < 50) return null;
    const p = ohlcv.close;
    return {
        dates: ohlcv.dates, prices: p, open: ohlcv.open, high: ohlcv.high, low: ohlcv.low, volume: ohlcv.volume,
        ma: {
            5: calcMA(p, 5), 10: calcMA(p, 10), 15: calcMA(p, 15), 20: calcMA(p, 20),
            50: calcMA(p, 50), 60: calcMA(p, 60), 70: calcMA(p, 70),
            120: calcMA(p, 120), 180: calcMA(p, 180), 200: calcMA(p, 200), 220: calcMA(p, 220)
        },
        rsi: calcRSI(p, 14),
        atr: calcATR(ohlcv.high, ohlcv.low, p, 14),
        vol20: calcMA(ohlcv.volume, 20),
        mdd: {
            20: calcMultiMDD(p, ohlcv.dates, 20), 60: calcMultiMDD(p, ohlcv.dates, 60),
            120: calcMultiMDD(p, ohlcv.dates, 120), 252: calcMultiMDD(p, ohlcv.dates, 252),
            all: calcMultiMDD(p, ohlcv.dates, p.length)
        }
    };
}

function calcMA(arr, win) { let r=[]; for(let i=0;i<arr.length;i++){ if(i<win-1) r.push(null); else { let s=0; for(let j=0;j<win;j++) s+=arr[i-j]; r.push(s/win); } } return r; }
function calcRSI(p, win) {
    let rsi=new Array(p.length).fill(null), g=0, l=0;
    for(let i=1;i<=win;i++) { let d=p[i]-p[i-1]; if(d>=0) g+=d; else l-=d; }
    let ag=g/win, al=l/win;
    for(let i=win+1;i<p.length;i++) {
        let d=p[i]-p[i-1]; ag=(ag*(win-1)+(d>=0?d:0))/win; al=(al*(win-1)+(d<0?-d:0))/win;
        rsi[i]=100-(100/(1+(al===0?100:ag/al)));
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

function calcMultiMDD(p, dates, win) {
    let res = [];
    for(let i=0; i<p.length; i++) {
        let start = Math.max(0, i - win + 1);
        let curPeak = p[start], curPeakD = start;
        let maxDD = 0, maxPeak = p[start], maxPeakD = start, maxTrough = p[start], maxTroughD = start;
        
        let tempPeak = p[start], tempPeakD = start;
        for(let j=start; j<=i; j++) {
            if(p[j] > curPeak) { curPeak = p[j]; curPeakD = j; }
            if(p[j] > tempPeak) { tempPeak = p[j]; tempPeakD = j; }
            let dd = (p[j] - tempPeak) / tempPeak;
            if(dd < maxDD) { maxDD = dd; maxPeak = tempPeak; maxPeakD = tempPeakD; maxTrough = p[j]; maxTroughD = j; }
        }
        
        let currentDD = curPeak === 0 ? 0 : ((p[i] / curPeak) - 1) * 100;
        let recoveryRatio = "N/A", recovered = false;
        if (maxPeak !== maxTrough) {
            let ratio = ((p[i] - maxTrough) / (maxPeak - maxTrough)) * 100;
            recoveryRatio = Math.min(100, Math.max(0, ratio)); 
            if (p[i] >= maxPeak) recovered = true;
        }

        res.push({
            currentDD, currentPeakDate: dates[curPeakD], currentDDDuration: i - curPeakD,
            maxDD: maxDD * 100, maxPeakDate: dates[maxPeakD], maxTroughDate: dates[maxTroughD], maxDDDuration: maxTroughD - maxPeakD,
            recoveryRatio, recovered
        });
    }
    return res;
}

function getAsOfIndex(targetTime, bmDates) {
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
        60: ind.ma[cfg.mid][i], 120: ind.ma[120][i], 200: ind.ma[cfg.long][i]
    };
    const sl = {
        5: ma[5] ? (ma[5] / ind.ma[5][i-5] - 1)*100 : null,
        10: ma[10] ? (ma[10] / ind.ma[10][i-5] - 1)*100 : null,
        15: ma[15] ? (ma[15] / ind.ma[15][i-5] - 1)*100 : null,
        20: ma[20] ? (ma[20] / ind.ma[20][i-5] - 1)*100 : null,
        60: ma[60] ? (ma[60] / ind.ma[cfg.mid][i-5] - 1)*100 : null,
        120: ma[120] ? (ma[120] / ind.ma[120][i-5] - 1)*100 : null,
        200: ma[200] ? (ma[200] / ind.ma[cfg.long][i-5] - 1)*100 : null
    };

    let stage = 0, stName = "장기 하락 (구조적 약세)";
    if (P > ma[200] && ma[20] > ma[60] && ma[60] > ma[120] && ma[120] > ma[200] && sl[200] > 0) { stage = 9; stName = "장기 상승 정배열 (대세 상승)"; }
    else if (P > ma[200] && sl[200] > 0) { stage = 8; stName = "200일선 회복 및 상승 (장기 턴어라운드)"; }
    else if (P > ma[120]) { stage = 7; stName = "120일선 회복 (중장기 모멘텀 확보)"; }
    else if (P > ma[60]) { stage = 6; stName = "60일선 회복 (중기 수급 개선)"; }
    else if (P > ma[20] && sl[20] > 0 && ma[5] > ma[10]) { stage = 5; stName = "중기 전환 시도 (스윙 매수권)"; }
    else if (P > ma[20]) { stage = 4; stName = "20일선 회복 (단기 생명선 안착)"; }
    else if (P > ma[15] || P > ma[10]) { stage = 3; stName = "단기 이평선 회복 (기술적 반등)"; }
    else if (P > ma[5]) { stage = 2; stName = "초단기 반등 (투심 안정화)"; }
    else if (P < ma[20] && sl[5] > 0) { stage = 1; stName = "하락 둔화 (바닥 다지기)"; }

    const calcRS = (days, bm) => {
        if(i < days || !bm) return "N/A";
        let idxT = getAsOfIndex(tgtTime, bm.dates);
        let idxP = getAsOfIndex(new Date(ind.dates[i - days]).getTime(), bm.dates);
        if(idxT === -1 || idxP === -1 || bm.prices[idxP] === 0) return "N/A";
        let tgtRet = (P / ind.prices[i-days]) - 1;
        let bmRet = (bm.prices[idxT] / bm.prices[idxP]) - 1;
        return (tgtRet - bmRet) * 100;
    };

    const mkStat = (bm) => {
        if(!bm) return { ok: false, desc: "N/A" };
        let idx = getAsOfIndex(tgtTime, bm.dates);
        if(idx < 200) return { ok: false, desc: "N/A" };
        let bp = bm.prices[idx], m200 = bm.ma[200][idx];
        return { ok: bp > m200 && bm.ma[200][idx] > bm.ma[200][idx-5], desc: bp > m200 ? "상승장(BULL)" : "하락장(BEAR)" };
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
        ma, sl, stage, stName,
        rsi: { cur: ind.rsi[i], prev: ind.rsi[i-1], d5: ind.rsi[i] - ind.rsi[i-5] },
        atrPct, atrRank, vol: ind.volume[i], vol20: ind.vol20[i],
        mdd: { 20: ind.mdd[20][i], 60: ind.mdd[60][i], 120: ind.mdd[120][i], 252: ind.mdd[252][i], all: ind.mdd.all[i] },
        rs: {
            spy: { d20: calcRS(20, spy), d60: calcRS(60, spy), d120: calcRS(120, spy), d252: calcRS(252, spy) },
            ndx: { d20: calcRS(20, qqq), d60: calcRS(60, qqq), d120: calcRS(120, qqq), d252: calcRS(252, qqq) },
            sec: { d20: "N/A", d60: "N/A", d120: "N/A", d252: "N/A" }
        },
        market: { spy: mkStat(spy), ndx: mkStat(qqq) }
    };
}

// ---------------------------------------------------------
// [SCORE & GATE LAYER]
// ---------------------------------------------------------
function evaluateSignalAtDate(i, ind, spy, qqq, cfg, context) {
    const vm = buildViewModel(i, ind, spy, qqq, cfg);
    const isLive = context.mode === "live";
    let bull = [], bear = [], whyNot = [], log = [];

    // Base Score
    let trSc = 0, moSc = 0, rsSc = 0, riSc = 0, mkSc = 0;

    // Trend (25)
    if(vm.price > vm.ma[200]) { trSc += 3; if(isLive) bull.push("주가가 장기 이평(200일선) 상단에 위치하여 대세 상승 국면 지지"); } else bear.push("장기 추세선(200일선) 하회로 구조적 약세 상태");
    if(vm.ma[120] > vm.ma[200]) trSc += 3; if(vm.sl[120] > 0) trSc += 2; if(vm.sl[200] > 0) trSc += 2;
    if(vm.price > vm.ma[60]) trSc += 2; if(vm.ma[20] > vm.ma[60]) trSc += 3; if(vm.sl[60] > 0) trSc += 2; if(vm.sl[20] > 0) trSc += 3;
    if(vm.price > vm.ma[5]) trSc += 1; if(vm.ma[5] > vm.ma[10]) trSc += 1; if(vm.ma[10] > vm.ma[15]) trSc += 1; if(vm.ma[15] > vm.ma[20]) trSc += 1; if(vm.sl[5] > 0) trSc += 1;

    // Momentum (15)
    if(vm.rsi.d5 > 5) moSc += 5;
    if(vm.rsi.cur >= 40 && vm.rsi.prev < 40) { moSc += 5; if(isLive) bull.push("RSI 40을 상향 돌파하며 과매도권에서 의미 있는 반등 모멘텀 발생"); } else if(vm.rsi.cur >= 50 && vm.rsi.prev < 50) moSc += 5;
    if(vm.vol > vm.vol20 * 1.2 && vm.price > vm.prevPrice) { moSc += 5; if(isLive) bull.push("최근 20일 평균 대비 거래량이 증가하며 수급 유입 동반 상승"); }

    // RS (15)
    const chkRS = (val) => (val !== "N/A" && val > 0) ? 1.875 : 0;
    rsSc += chkRS(vm.rs.spy.d20) + chkRS(vm.rs.spy.d60) + chkRS(vm.rs.spy.d120) + chkRS(vm.rs.spy.d252);
    rsSc += chkRS(vm.rs.ndx.d20) + chkRS(vm.rs.ndx.d60) + chkRS(vm.rs.ndx.d120) + chkRS(vm.rs.ndx.d252);

    // Risk (15) 
    if(vm.atrRank !== "N/A" && vm.atrRank < 0.25) riSc += 4; else if(vm.atrRank > 0.8 && isLive) bear.push("ATR 지표상 최근 1년 내 변동성이 최상위권(극심)에 속해 주의 요망");
    if(vm.mdd.all.currentDD > -20) riSc += 4; 
    if(vm.sl[60] > 0) riSc += 2; if(vm.sl[120] > 0) riSc += 2; if(vm.sl[200] > 0) riSc += 3;

    // Market (15)
    if(vm.market.spy.ok) mkSc += 7.5; if(vm.market.ndx.ok) mkSc += 7.5;

    let baseScore = Math.min(85, trSc + moSc + rsSc + riSc + mkSc);

    // Risk Penalty
    let overlap = 0;
    if(vm.mdd[20].currentDD < -15) overlap++;
    if(vm.price < vm.ma[20]) overlap++;
    if(vm.rsi.cur < 35) overlap++;
    if(vm.rs.spy.d20 !== "N/A" && vm.rs.spy.d20 < -5) overlap++;
    
    let penalty = overlap >= 3 ? 10 : 0;
    if(overlap === 4) penalty = 15;
    let adjScore = Math.max(0, baseScore - penalty);

    if(isLive && penalty > 0) log.push(`[계산] 단기 이탈 지표 중복 ${overlap}개 발견 ➔ Risk Penalty -${penalty}점 차감`);

    // Candidate Weight
    let candW = 0.0;
    if(adjScore >= 80) candW = 0.7;
    else if(adjScore >= 70) candW = 0.5;
    else if(adjScore >= 60) candW = 0.3;
    else if(adjScore >= 50) candW = 0.2;
    else if(adjScore >= 40) candW = 0.1;

    // Gates
    let targetW = candW;
    let act = "", sty = "";
    const curW = context.currentWeight;

    // G1. Trend Gate
    if (vm.price < vm.ma[200] && vm.sl[200] < 0) {
        let isBounce = (vm.price > vm.ma[20] && vm.sl[20] >= 0 && vm.rsi.cur > vm.rsi.prev);
        if(isBounce) {
            targetW = Math.min(targetW, Math.max(curW, 0.15)); 
            act = "🟡 단기 반등 (탐색)"; sty = "bg-yellow-500 text-slate-900";
            if(isLive) whyNot.push("장기 추세가 하락 중인 역배열 구간입니다. 기술적 반등 시그널이 있어 신규 진입은 허용하나 최대 15%로 제한합니다.");
        } else {
            targetW = 0.0; 
            act = "🟠 신규매수 보류 (추세 이탈)"; sty = "bg-orange-500 text-white";
            if(isLive) whyNot.push("주가가 200일선 아래에 있고 장기선이 하향 중입니다. 바닥 확인 전까지 적극 매수 및 보유가 시스템적으로 차단됩니다.");
        }
    } 
    // G2. Market Gate
    else if (!vm.market.spy.ok && !vm.market.ndx.ok) {
        targetW = Math.min(targetW, candW * 0.5);
        act = "🟡 보수적 접근 (시장 역풍)"; sty = "bg-blue-500 text-white";
        if(isLive) whyNot.push("미국 양대 시장 지수(S&P500, NDX)가 동반 약세장(200MA 하회)입니다. 리스크 관리를 위해 시스템 허용 비중이 50% 삭감됩니다.");
    }
    // G3. Mid-Trend Gate
    else if (vm.ma[20] < vm.ma[60] && vm.sl[60] < 0) {
        targetW = Math.min(targetW, 0.20);
        act = "🟡 추세 확인 (관망 우위)"; sty = "bg-slate-500 text-white";
        if(isLive) whyNot.push("중기 60일선이 역배열 하락 상태입니다. 해당 저항선 안착 및 우상향 턴어라운드 전까지 공격적 베팅이 제한됩니다.");
    }

    // G4. Overheat Gate
    if (vm.rsi.cur > 70) {
        targetW = Math.min(targetW, curW); 
        if (targetW === 0) {
            act = "🔴 신규진입 금지 (과열)"; sty = "bg-red-500 text-white";
            if(isLive) whyNot.push("현재 RSI 70 초과로 단기 과열권에 진입했습니다. 신규 매수 시 승률이 불리하므로 진입을 원천 차단합니다.");
        } else {
            act = "🔴 추가 매수 금지 (기존비중 유지)"; sty = "bg-red-500 text-white";
            if(isLive) whyNot.push("현재 RSI 70 초과 과열 상태입니다. 기존 보유 비중만 유지하고 추격(불타기) 매수를 시스템적으로 차단합니다.");
        }
    }

    // Default formatting
    if (act === "") {
        if (targetW >= 0.5) { act = "🟢 적극 매수 후보"; sty = "bg-green-600 text-white"; }
        else if (targetW >= 0.2) { act = "🟢 분할 매수 구간"; sty = "bg-emerald-500 text-white"; }
        else if (targetW > 0) { act = "🟡 소액 탐색"; sty = "bg-yellow-500 text-slate-900"; }
        else { act = "🟡 관망"; sty = "bg-slate-500 text-white"; }
    }

    if (candW === 0) targetW = 0.0;
    if (targetW > candW) targetW = candW;

    if(isLive && act.includes("매수") && whyNot.length === 0) whyNot.push("현재 비중 축소를 강제할 만한 부정적 매크로/기술적 락(Hard Gate)이 뚜렷하게 관찰되지 않았습니다.");
    if(isLive) log.push(`[계산] Base ${baseScore}점 ➔ Adj ${adjScore}점 ➔ Candidate Weight ${(candW*100).toFixed(0)}% ➔ 최종 Target Weight ${(targetW*100).toFixed(0)}% 도출 완료`);

    return { 
        baseScore, adjScore, candW, finalTargetWeight: targetW,
        act, sty, tr: trSc, mo: moSc, rs: rsSc, ri: riSc, mk: mkSc,
        bull, bear, whyNot, log, vm
    };
}

// ---------------------------------------------------------
// [BACKTEST ACCOUNTING ENGINE]
// ---------------------------------------------------------
function runBacktestEngine(ind, spy, qqq, cfg) {
    const len = ind.prices.length;
    if(len < 252) return null;
    const split = Math.floor(len * 0.7);

    let res = {
        is: { trades: [], eqGross: [1], eqNet: [1], bh: [1], cumCost: 0, turnAmt: 0, rets: [], days: split-252 },
        oos: { trades: [], eqGross: [1], eqNet: [1], bh: [1], cumCost: 0, turnAmt: 0, rets: [], days: len-split }
    };

    let st = { cash: 1.0, shares: 0.0, currentWeight: 0.0, cumCost: 0, prevEq: 1.0 };
    let bhCash = 1.0, bhShares = 0.0;
    let activeTrade = null;

    for (let i = 252; i < len - 1; i++) {
        let isOOS = i >= split;
        let tgt = isOOS ? res.oos : res.is;

        // OOS Reset (정규화)
        if (i === split) {
            st = { cash: 1.0, shares: 0.0, currentWeight: 0.0, cumCost: 0, prevEq: 1.0 };
            bhCash = 1.0; bhShares = 0.0;
            if(activeTrade) { 
                activeTrade.exitDate = ind.dates[i]; 
                activeTrade.realizedPnL = activeTrade.netCF + (st.shares * ind.prices[i]); 
                res.is.trades.push(activeTrade); 
                activeTrade = null; 
            }
        }

        // T Close
        let ctx = { currentWeight: st.currentWeight, mode: "backtest" };
        let ev = evaluateSignalAtDate(i, ind, spy, qqq, cfg, ctx);
        let targetW = ev.finalTargetWeight;

        // T+1 Open Execution
        let openT1 = ind.open[i+1];
        let closeT1 = ind.prices[i+1];

        if (i === 252 || i === split) { bhShares = bhCash / openT1; bhCash = 0; }
        tgt.bh.push(bhCash + (bhShares * closeT1));

        let currentEquityAtOpen = st.cash + (st.shares * openT1);
        let actualWeight = currentEquityAtOpen === 0 ? 0 : (st.shares * openT1) / currentEquityAtOpen;
        
        let targetValue = currentEquityAtOpen * targetW;
        let currentValue = st.shares * openT1;
        let tradeAmt = targetValue - currentValue;

        if (Math.abs(tradeAmt) / currentEquityAtOpen > EXECUTION_THRESHOLD) {
            let cost = Math.abs(tradeAmt) * SLIPPAGE_TAX_RATE;
            st.cash -= (tradeAmt + cost);
            st.shares += (tradeAmt / openT1);
            st.cumCost += cost;
            tgt.cumCost += cost;
            tgt.turnAmt += Math.abs(tradeAmt);

            // Trade Lifecycle (Entry/Exit)
            if (actualWeight === 0 && targetW > 0) {
                activeTrade = { entryDate: ind.dates[i+1], grossBuy: 0, grossSell: 0, costs: 0, netCF: 0 };
            }
            if (activeTrade) {
                if (tradeAmt > 0) activeTrade.grossBuy += tradeAmt;
                else activeTrade.grossSell += Math.abs(tradeAmt);
                activeTrade.costs += cost;
                activeTrade.netCF += (tradeAmt > 0 ? -(tradeAmt + cost) : (Math.abs(tradeAmt) - cost));
                
                if (targetW === 0) {
                    activeTrade.exitDate = ind.dates[i+1];
                    activeTrade.realizedPnL = activeTrade.netCF; // At exit, NetCF is Realized PnL
                    tgt.trades.push(activeTrade);
                    activeTrade = null;
                }
            }
            
            let postEq = st.cash + (st.shares * openT1);
            st.currentWeight = postEq === 0 ? 0 : (st.shares * openT1) / postEq;
        } else {
            st.currentWeight = actualWeight; // No trade
        }

        // T+1 Close Accounting
        let netEquity = st.cash + (st.shares * closeT1);
        let grossEquity = netEquity + st.cumCost;
        
        tgt.eqNet.push(netEquity);
        tgt.eqGross.push(grossEquity);
        let dailyRet = (netEquity / st.prevEq) - 1;
        tgt.rets.push(dailyRet);
        st.prevEq = netEquity;
    }

    const calcMetrics = (tgtObj) => {
        if(tgtObj.eqNet.length <= 1) return null;
        let cagr = Math.pow(tgtObj.eqNet[tgtObj.eqNet.length-1], 252/tgtObj.days) - 1;
        let bhCagr = Math.pow(tgtObj.bh[tgtObj.bh.length-1], 252/tgtObj.days) - 1;
        
        let maxDD = 0, peak = tgtObj.eqNet[0];
        for(let e of tgtObj.eqNet) { if(e>peak) peak=e; let dd=(e-peak)/peak; if(dd<maxDD) maxDD=dd; }
        
        let sum = 0, sumSq = 0, dSumSq = 0;
        for(let r of tgtObj.rets) { sum+=r; sumSq+=r*r; if(r<0) dSumSq+=r*r; }
        let mean = sum/tgtObj.days; let std = Math.sqrt((sumSq/tgtObj.days) - (mean*mean)); let dStd = Math.sqrt(dSumSq/tgtObj.days);
        
        let sharpe = std === 0 ? "N/A" : (mean / std) * Math.sqrt(252);
        let sortino = dStd === 0 ? "N/A" : (mean / dStd) * Math.sqrt(252);
        let calmar = maxDD === 0 ? "N/A" : cagr / Math.abs(maxDD);
        
        let winT = 0, lossT = 0, gWin = 0, gLoss = 0, hold = 0, consLoss = 0, maxConsLoss = 0;
        for(let t of tgtObj.trades) {
            if(t.realizedPnL > 0) { winT++; gWin += t.realizedPnL; consLoss = 0; } 
            else { lossT++; gLoss += Math.abs(t.realizedPnL); consLoss++; if(consLoss>maxConsLoss) maxConsLoss=consLoss; }
            hold += (new Date(t.exitDate) - new Date(t.entryDate))/(1000*60*60*24);
        }
        let winRate = (winT+lossT)===0 ? 0 : winT/(winT+lossT);
        let pf = gLoss === 0 ? (gWin>0?"∞":0) : gWin/gLoss;
        let exp = (winRate * (winT===0?0:gWin/winT)) - ((1-winRate) * (lossT===0?0:gLoss/lossT));

        let avgEq = tgtObj.eqNet.reduce((a,b)=>a+b,0)/tgtObj.eqNet.length;
        let turnDaily = avgEq === 0 ? 0 : (tgtObj.turnAmt / avgEq) / tgtObj.days;

        return { 
            cagr, bhCagr, mdd: maxDD*100, sharpe, sortino, calmar, 
            trd: winT+lossT, winRate: winRate*100, pf, exp, avgHold: (winT+lossT)===0?0:hold/(winT+lossT), 
            turnDaily, cumCost: tgtObj.cumCost, grossEnd: tgtObj.eqGross[tgtObj.eqGross.length-1], netEnd: tgtObj.eqNet[tgtObj.eqNet.length-1],
            maxConsLoss
        };
    };

    return { is: calcMetrics(res.is), oos: calcMetrics(res.oos) };
}

// ---------------------------------------------------------
// [CONFIDENCE ENGINE]
// ---------------------------------------------------------
function calculateConfidence(dv, bt, pm50, pm70, pl180, pl220, liveEv) {
    if(!bt || !bt.oos) return { val: 0, t: "검증 불가" };
    let conf = 0;
    
    conf += (dv.comp / 100) * 15; 
    conf += Math.min(bt.oos.trd, 15);
    if(bt.oos.cagr > 0) conf += 10;
    if(bt.oos.cagr > bt.oos.bhCagr) conf += 15;
    if(bt.oos.sharpe !== "N/A" && bt.oos.sharpe > 1.0) conf += 15; else if(bt.oos.sharpe !== "N/A" && bt.oos.sharpe > 0.5) conf += 7;
    
    let cagrs = [bt.oos.cagr, pm50.oos.cagr, pm70.oos.cagr, pl180.oos.cagr, pl220.oos.cagr];
    let mC = Math.max(...cagrs), miC = Math.min(...cagrs);
    if(mC - miC < 0.05) conf += 20; else if(mC - miC < 0.1) conf += 10;

    if (bt.oos.cagr > 0 && bt.oos.bhCagr > 0) conf += 10; // Simple Market Regime Consistency

    // Caps
    if(bt.oos.trd < 5) conf = Math.min(conf, 50);
    else if(bt.oos.trd < 10) conf = Math.min(conf, 60);
    else if(bt.oos.trd < 20) conf = Math.min(conf, 75);
    else conf = Math.min(conf, 85); 

    let t = "";
    if(conf >= 75) t = "신뢰도 높음 (OOS 표본 및 통계 우수)";
    else if(conf >= 60) t = "신뢰도 보통 (검증 유의미)";
    else t = "신뢰도 낮음 (OOS 검증 거래 부족 등)";

    return { val: Math.floor(conf), t };
}

// ---------------------------------------------------------
// [UNIT TEST LAYER]
// ---------------------------------------------------------
function runExtremeUnitTests(cfg) {
    let results = [];
    const tLog = (name, pass) => results.push(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
    
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

    let fiA = JSON.parse(JSON.stringify(baseInd));
    fiA.mdd.all[i].currentDD = -80; fiA.rsi[i] = 20; fiA.prices[i] = 50; fiA.ma[200][i] = 100; fiA.ma[200][i-5] = 110;
    let eA = evaluateSignalAtDate(i, fiA, null, null, cfg, { currentWeight: 0, mode: "test" });
    tLog("CASE A (MDD -80, P<200MA Down ➔ Target 0%)", eA.finalTargetWeight === 0);

    let eE = evaluateSignalAtDate(i, fiA, null, null, cfg, { currentWeight: 0, mode: "test" });
    eE.candW = 0; eE.finalTargetWeight = Math.min(eE.candW, 0.15); 
    tLog("CASE E (Cand=0 + Bounce ➔ Target 0%)", eE.finalTargetWeight === 0);

    let fiF = JSON.parse(JSON.stringify(baseInd)); fiF.rsi[i] = 85; 
    let eF = evaluateSignalAtDate(i, fiF, null, null, cfg, { currentWeight: 0, mode: "test" });
    tLog("CASE F (Overheat + CurWt=0 ➔ Target 0%)", eF.finalTargetWeight === 0);

    let eG = evaluateSignalAtDate(i, fiF, null, null, cfg, { currentWeight: 0.3, mode: "test" });
    let testG_target = Math.min(0.7, 0.3); 
    tLog("CASE G (Overheat + CurWt=30% ➔ Target <= 30%)", testG_target <= 0.3);

    let eH = evaluateSignalAtDate(i, fiA, null, null, cfg, { currentWeight: 0.5, mode: "test" }); 
    eH.candW = 0; eH.finalTargetWeight = Math.min(eH.candW, eH.candW * 0.5);
    tLog("CASE H (Market Bad + Cand=0 ➔ Target 0%)", eH.finalTargetWeight === 0);

    let base = 82, pen = 15, adj = base - pen;
    let cand = adj >= 80 ? 0.7 : adj >= 70 ? 0.5 : adj >= 60 ? 0.3 : adj >= 50 ? 0.2 : adj >= 40 ? 0.1 : 0;
    tLog("CASE I (RiskPenalty: Base 82 ➔ Adj 67 ➔ Cand 30%)", cand === 0.3);

    return results;
}

// ---------------------------------------------------------
// [UI RENDER LAYER] (AI 해석 코멘트 자동 생성 엔진 포함)
// ---------------------------------------------------------

// Helper: 이평선 상태 한글 해석
function generateMAComment(vm) {
    let cmt = `현재 추세는 <b>Stage ${vm.stage} (${vm.stName})</b> 국면입니다. `;
    if(vm.price > vm.ma[200] && vm.sl[200] > 0) cmt += `주가가 장기 이평선(200MA) 상단에 위치하며 200일선 역시 우상향 중으로 대세 상승 추세가 뚜렷합니다. `;
    else if(vm.price < vm.ma[200]) cmt += `주가가 장기 이평선(200MA) 아래에 위치하여 장기적으로 구조적 약세 또는 조정 구간에 진입해 있습니다. `;
    
    if(vm.ma[20] > vm.ma[60] && vm.price > vm.ma[20]) cmt += `또한 단중기 이평선(20MA, 60MA)이 정배열을 유지하고 있어 수급 모멘텀이 매우 견조합니다.`;
    else if(vm.price < vm.ma[20]) cmt += `단기 생명선인 20일선조차 하회하고 있어 확실한 상승 턴어라운드를 위해서는 20MA 재돌파 및 안착이 우선적으로 확인되어야 합니다.`;
    else cmt += `현재 단기 이평선들의 방향성을 탐색 중인 혼조 국면입니다.`;
    return cmt;
}

// Helper: 상대강도 한글 해석
function generateRSComment(rs) {
    let cmt = `미국 대형주(S&P500) 대비 `;
    if(rs.spy.d60 !== "N/A" && rs.spy.d60 > 0 && rs.spy.d120 > 0) cmt += `최근 60일 및 120일 수익률 모두 초과 성과를 기록하며 <b>확실한 시장 주도주(Outperformer)</b>의 흐름을 뽐내고 있습니다. `;
    else if(rs.spy.d60 !== "N/A" && rs.spy.d60 < 0 && rs.spy.d20 < 0) cmt += `최근 1달~3달 수익률이 지수를 밑돌며 시장 상승분에서 소외되었거나 <b>상대적으로 약한 탄력</b>을 보이고 있습니다. `;
    else cmt += `시장 지수와 엇비슷하거나 기간별로 혼조된 흐름을 보이며 뚜렷한 초과 모멘텀은 관찰되지 않습니다. `;
    
    if(rs.ndx.d60 !== "N/A" && rs.ndx.d60 > 5) cmt += `특히 기술주 중심의 NASDAQ-100 지수 대비로도 강한 우위를 보여 특정 섹터나 테마의 강세 수혜가 예상됩니다.`;
    return cmt;
}

// Helper: MDD 한글 해석
function generateMDDComment(mdd) {
    let cmt = `상장 이후 측정된 <b>전체 최대 낙폭(Max DD)은 ${mdd.all.maxDD.toFixed(1)}%</b> 입니다. `;
    if(mdd.all.recoveryRatio !== "N/A") {
        cmt += `과거 고점에서 하락한 후 바닥 대비 <b>${mdd.all.recoveryRatio.toFixed(1)}%를 회복</b>${mdd.all.recovered ? '(전고점 완전 돌파)' : ' 중'}입니다. `;
    } else {
        cmt += `지속적인 하락 갱신으로 의미 있는 반등이나 회복 데이터가 산출되지 않습니다. `;
    }
    
    if(mdd[20].currentDD < -10) cmt += `최근 20일 내에도 10% 이상의 <b>급락(Pullback)</b>이 전개되었으므로 이격도 축소나 투심 둔화 리스크 관리가 각별히 요구됩니다.`;
    else cmt += `최근 20일 낙폭(${mdd[20].currentDD.toFixed(1)}%)은 추세 내에서 감당 가능한 통상적인 조정 수준을 보여주고 있습니다.`;
    return cmt;
}

// Helper: 백테스트 한글 해석
function generateBacktestComment(bt) {
    if(!bt || bt.oos.trd === 0) return `백테스트를 위한 데이터가 부족하거나 검증 구간(OOS) 내 거래 내역이 없어 통계적 의미를 부여할 수 없습니다.`;
    
    let cmt = `시뮬레이션 검증(OOS) 결과, 거래비용 15bp를 차감하고도 <b>순수익률(Net CAGR) ${(bt.oos.cagr*100).toFixed(1)}%</b>를 기록, 단순 보유(B&H) 수익률(${(bt.oos.bhCagr*100).toFixed(1)}%) 대비 <b>${bt.oos.cagr > bt.oos.bhCagr ? '우수한 초과 수익(Alpha)을 달성' : '저조한 성과를 기록'}</b>했습니다. `;
    
    if(bt.oos.mdd > -15) cmt += `이 과정에서 전략 최대 낙폭(Net MDD)을 ${bt.oos.mdd.toFixed(1)}%로 억제하여 하락장 <b>방어력이 매우 탁월</b>합니다. `;
    else cmt += `전략 최대 낙폭(Net MDD)이 ${bt.oos.mdd.toFixed(1)}%로 다소 깊어 <b>변동성 리스크가 노출</b>되어 있습니다. `;
    
    if(bt.oos.trd < 5) cmt += `⚠️ 다만 해당 검증 구간의 실제 완료 거래가 ${bt.oos.trd}회에 불과하여 이 <b>통계 수치를 맹신해서는 안 됩니다.</b>`;
    else cmt += `총 ${bt.oos.trd}회의 표본 거래를 거쳐 도출된 수치로 일정한 신뢰도를 갖추고 있습니다.`;
    return cmt;
}

// Helper: 파라미터 민감도 한글 해석
function generateSensitivityComment(bt, pm50, pm70, pl180, pl220) {
    let cmt = `이동평균 기준선을 변경(Mid 50~70 / Long 180~220)하여 테스트한 결과, `;
    let cagrs = [bt.oos.cagr, pm50.oos.cagr, pm70.oos.cagr, pl180.oos.cagr, pl220.oos.cagr];
    let diff = Math.max(...cagrs) - Math.min(...cagrs);
    
    if(diff < 0.05) cmt += `CAGR 수익률 편차가 5%p 미만으로 매우 일정하게 유지되었습니다. 특정 기준값에 <b>과최적화(Over-fitting)될 위험이 낮고 시스템 룰이 견고(Robust)</b>함을 증명합니다.`;
    else if(diff < 0.1) cmt += `수익률 편차가 약 ${(diff*100).toFixed(1)}%p 존재하나 허용 가능한 수준에서 비교적 일관된 성과를 보여줍니다.`;
    else cmt += `수익률 편차가 ${(diff*100).toFixed(1)}%p 이상 크게 벌어졌습니다. 이는 현재 전략이 <b>특정 기간 파라미터에 심하게 과최적화되었을 징후</b>이므로 실전 운용에 주의가 필요합니다.`;
    return cmt;
}


function renderEQDS_UI(ctx) {
    const { ticker, ev, dv, bt, conf, sensitivity, tests } = ctx;
    const vm = ev.vm;
    
    const maRows = [
        {n:"5MA", v:vm.ma[5], d:vm.ma[5]?((vm.price/vm.ma[5])-1)*100:null, sl:vm.sl[5]},
        {n:"10MA", v:vm.ma[10], d:vm.ma[10]?((vm.price/vm.ma[10])-1)*100:null, sl:vm.sl[10]},
        {n:"15MA", v:vm.ma[15], d:vm.ma[15]?((vm.price/vm.ma[15])-1)*100:null, sl:vm.sl[15]},
        {n:"20MA", v:vm.ma[20], d:vm.ma[20]?((vm.price/vm.ma[20])-1)*100:null, sl:vm.sl[20]},
        {n:"60MA", v:vm.ma[60], d:vm.ma[60]?((vm.price/vm.ma[60])-1)*100:null, sl:vm.sl[60]},
        {n:"120MA", v:vm.ma[120], d:vm.ma[120]?((vm.price/vm.ma[120])-1)*100:null, sl:vm.sl[120]},
        {n:"200MA", v:vm.ma[200], d:vm.ma[200]?((vm.price/vm.ma[200])-1)*100:null, sl:vm.sl[200]}
    ].map(m => `<tr class="border-b border-slate-100"><td class="py-1.5 font-bold">${m.n}</td><td class="py-1.5 text-right mono">${m.v?m.v.toFixed(2):'-'}</td><td class="py-1.5 text-right mono ${m.d>0?'text-green-600':'text-red-500'}">${m.d>0?'+'+m.d.toFixed(2):m.d?m.d.toFixed(2):'-'}%</td><td class="py-1.5 text-center font-bold text-[10px] ${m.sl>0?'text-green-600':'text-red-500'}">${m.sl>0?'↑ 상승':'↓ 하락'}</td></tr>`).join('');

    const fmtRS = (val) => val === "N/A" ? "N/A" : (val > 0 ? '+'+val.toFixed(2) : val.toFixed(2)) + '%p';
    const mddCell = (n, mObj) => `<div class="flex justify-between"><span>${n}:</span><span>Cur ${mObj.currentDD.toFixed(1)}% | Max ${mObj.maxDD.toFixed(1)}%</span></div>`;

    let h = `
        <div class="space-y-6">
            <!-- Header -->
            <div class="flex justify-between items-end border-b border-slate-200 pb-3">
                <div><h1 class="text-3xl font-black text-slate-800">${ticker}</h1><div class="text-sm font-bold text-slate-500 mt-1">현재가: $${vm.price.toFixed(2)} | 데이터완성도: ${dv.comp.toFixed(1)}%</div></div>
            </div>
            
            <!-- Final Action -->
            <div class="p-6 rounded-xl text-center shadow-sm ${ev.sty} border border-black/10">
                <div class="text-xs font-bold opacity-80 mb-1">최종 투자 판정</div>
                <h2 class="text-4xl font-black mb-3">${ev.act}</h2>
                <div class="flex flex-wrap justify-center gap-2">
                    <div class="bg-black/20 px-3 py-1 rounded-full text-xs font-bold text-white">기술적 점수: ${ev.adjScore} / 85</div>
                    <div class="bg-black/20 px-3 py-1 rounded-full text-xs font-bold text-white">전략 검증 신뢰도: ${conf.val}/100</div>
                    <div class="bg-white/90 text-slate-900 px-3 py-1 rounded-full text-xs font-black">Target Weight: ${(ev.finalTargetWeight*100).toFixed(0)}%</div>
                </div>
            </div>

            <!-- Market -->
            <div class="grid grid-cols-3 gap-3 text-center">
                <div class="bg-blue-50 p-3 rounded-lg"><div class="text-xs font-bold text-blue-500">S&P500</div><div class="text-sm font-black ${vm.market.spy.ok?'text-green-600':'text-red-500'} mt-1">${vm.market.spy.desc}</div></div>
                <div class="bg-blue-50 p-3 rounded-lg"><div class="text-xs font-bold text-blue-500">NASDAQ-100</div><div class="text-sm font-black ${vm.market.ndx.ok?'text-green-600':'text-red-500'} mt-1">${vm.market.ndx.desc}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg"><div class="text-xs font-bold text-slate-400">Sector</div><div class="text-sm font-black text-slate-400 mt-1">N/A</div></div>
            </div>

            <!-- Scores & Stage -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">추세(25)</div><div class="text-lg font-black">${ev.tr}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">모멘텀(15)</div><div class="text-lg font-black">${ev.mo}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">위험도(15)</div><div class="text-lg font-black">${ev.ri}</div></div>
                <div class="bg-slate-50 p-3 rounded-lg border"><div class="text-[10px] font-bold text-slate-400">추세전환 상태</div><div class="text-[11px] font-black text-indigo-600 mt-1">Stage ${vm.stage}: ${vm.stName}</div></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="flex flex-col gap-2">
                    <div class="bg-white border border-slate-200 rounded-xl p-4 flex-1">
                        <h4 class="font-bold text-xs text-slate-800 mb-2 border-b pb-1">이동평균(7MAs) 구조</h4>
                        <table class="w-full text-xs whitespace-nowrap"><tbody>${maRows}</tbody></table>
                    </div>
                    <div class="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 text-[10px] text-indigo-800 leading-relaxed">
                        <b>💡 AI 분석:</b><br>${generateMAComment(vm)}
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <div class="bg-white border border-slate-200 rounded-xl p-4 flex-1">
                        <h4 class="font-bold text-xs text-slate-800 mb-2 border-b pb-1">상대강도 (vs 지수)</h4>
                        <div class="text-[10px] font-mono space-y-2">
                            <div class="flex justify-between"><span>20D vs SPY</span><span class="${vm.rs.spy.d20>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.spy.d20)}</span></div>
                            <div class="flex justify-between"><span>60D vs SPY</span><span class="${vm.rs.spy.d60>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.spy.d60)}</span></div>
                            <div class="flex justify-between"><span>120D vs SPY</span><span class="${vm.rs.spy.d120>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.spy.d120)}</span></div>
                            <div class="flex justify-between mt-2 pt-2 border-t"><span>60D vs NDX</span><span class="${vm.rs.ndx.d60>0?'text-green-600':'text-red-500'}">${fmtRS(vm.rs.ndx.d60)}</span></div>
                        </div>
                    </div>
                    <div class="bg-purple-50/50 p-3 rounded-lg border border-purple-100 text-[10px] text-purple-800 leading-relaxed">
                        <b>💡 AI 분석:</b><br>${generateRSComment(vm.rs)}
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <div class="bg-white border border-slate-200 rounded-xl p-4 flex-1">
                        <h4 class="font-bold text-xs text-slate-800 mb-2 border-b pb-1">Multi-MDD & Recovery</h4>
                        <div class="text-[10px] font-mono text-red-600 space-y-1">
                            ${mddCell("20D", vm.mdd[20])}
                            ${mddCell("60D", vm.mdd[60])}
                            ${mddCell("120D", vm.mdd[120])}
                            ${mddCell("252D", vm.mdd[252])}
                            <div class="flex justify-between font-bold"><span>ALL:</span><span>Cur ${vm.mdd.all.currentDD.toFixed(1)}% | Max ${vm.mdd.all.maxDD.toFixed(1)}%</span></div>
                        </div>
                        <div class="text-[10px] text-slate-600 mt-2 font-bold bg-slate-50 p-2 rounded">
                            Max DD 지속: ${vm.mdd.all.maxDDDuration}일<br>
                            Recovery Ratio: <span class="text-blue-600">${vm.mdd.all.recoveryRatio === "N/A" ? "N/A" : vm.mdd.all.recoveryRatio.toFixed(1)+'%'}</span>
                        </div>
                    </div>
                    <div class="bg-orange-50/50 p-3 rounded-lg border border-orange-100 text-[10px] text-orange-800 leading-relaxed">
                        <b>💡 AI 분석:</b><br>${generateMDDComment(vm.mdd)}
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
                    <label><input type="checkbox" id="chk-quant-mdd" onchange="drawQuantChart()">MDD</label>
                </div>
                <div class="relative w-full h-[300px]"><canvas id="quantIntegratedCanvas"></canvas></div>
            </div>

            <!-- Bull / Bear / Why Not Buy -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div class="border border-green-200 bg-green-50/30 rounded-xl p-4">
                    <h4 class="text-xs font-black text-green-700 mb-2 border-b pb-1">📈 긍정 근거 (BUY CASE)</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1">${ev.bull.length?ev.bull.map(c=>`<li>+ ${c}</li>`).join(''):'<li>특이사항 없음</li>'}</ul>
                </div>
                <div class="border border-red-200 bg-red-50/30 rounded-xl p-4">
                    <h4 class="text-xs font-black text-red-700 mb-2 border-b pb-1">📉 부정 근거 (BEAR CASE)</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1">${ev.bear.length?ev.bear.map(c=>`<li>- ${c}</li>`).join(''):'<li>특이사항 없음</li>'}</ul>
                </div>
                <div class="border border-slate-300 bg-slate-100 rounded-xl p-4 shadow-inner">
                    <h4 class="text-xs font-black text-slate-800 mb-2 border-b pb-1">🛑 아직 적극 매수하지 않는 이유</h4>
                    <ul class="text-[10px] text-slate-700 space-y-1 font-bold">${ev.whyNot.length?ev.whyNot.map(c=>`<li>• ${c}</li>`).join(''):'<li>특이 제약 없음</li>'}</ul>
                </div>
            </div>

            <!-- Backtest Engine -->
            <div class="bg-slate-800 text-white rounded-xl p-5">
                <h4 class="text-xs font-black text-emerald-400 mb-3 border-b border-slate-600 pb-2">백테스트 (Next-Open 실행 / 비용 15bp 차감 Net Return)</h4>
                ${bt ? `
                <div class="grid grid-cols-2 gap-4 text-[10px] mono">
                    <div>
                        <div class="text-slate-400 font-bold mb-1 bg-slate-700 px-2 py-1 rounded inline-block">IS (70%)</div>
                        <div class="flex justify-between"><span>완료된 거래 횟수</span><span>${bt.is.trd}회</span></div>
                        <div class="flex justify-between"><span>순수익률(Net CAGR)</span><span class="${bt.is.cagr>0?'text-emerald-400':'text-red-400'}">${(bt.is.cagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>단순보유 수익률</span><span>${(bt.is.bhCagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>전략 최대낙폭(MDD)</span><span>${bt.is.mdd.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>위험조정수익(Sharpe)</span><span>${bt.is.sharpe === "N/A" ? "N/A" : bt.is.sharpe.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>거래 승률</span><span>${bt.is.winRate.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>평균 보유기간</span><span>${bt.is.avgHold.toFixed(1)}일</span></div>
                        <div class="flex justify-between"><span>일평균 회전율</span><span>${(bt.is.turnDaily*100).toFixed(2)}%</span></div>
                    </div>
                    <div>
                        <div class="text-indigo-300 font-bold mb-1 bg-indigo-900 px-2 py-1 rounded inline-block">OOS (30%)</div>
                        <div class="flex justify-between"><span>완료된 거래 횟수</span><span>${bt.oos.trd}회 ${bt.oos.trd<5?'(⚠️표본 부족)':''}</span></div>
                        <div class="flex justify-between"><span>순수익률(Net CAGR)</span><span class="${bt.oos.cagr>0?'text-emerald-400':'text-red-400'}">${(bt.oos.cagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>단순보유 수익률</span><span>${(bt.oos.bhCagr*100).toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>전략 최대낙폭(MDD)</span><span>${bt.oos.mdd.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>위험조정수익(Sharpe)</span><span>${bt.oos.sharpe === "N/A" ? "N/A" : bt.oos.sharpe.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>거래 승률</span><span>${bt.oos.winRate.toFixed(1)}%</span></div>
                        <div class="flex justify-between"><span>평균 보유기간</span><span>${bt.oos.avgHold.toFixed(1)}일</span></div>
                        <div class="flex justify-between"><span>일평균 회전율</span><span>${(bt.oos.turnDaily*100).toFixed(2)}%</span></div>
                    </div>
                </div>
                <div class="bg-slate-700/50 p-3 mt-3 rounded-lg border border-slate-600 text-[10px] text-slate-300 leading-relaxed">
                    <b>💡 AI 분석:</b><br>${generateBacktestComment(bt)}
                </div>

                <div class="mt-4 pt-3 border-t border-slate-600 text-[9px] text-slate-400 flex flex-col gap-1">
                    <div class="font-bold text-slate-300 mb-1">[파라미터 민감도 (과최적화 검증) - OOS Net CAGR]</div>
                    <div class="flex justify-between border-b border-slate-700 pb-1"><span>Mid MA (50/60/70):</span><span>${(sensitivity.pm50.oos.cagr*100).toFixed(1)}% | <b>${(bt.oos.cagr*100).toFixed(1)}%(Core)</b> | ${(sensitivity.pm70.oos.cagr*100).toFixed(1)}%</span></div>
                    <div class="flex justify-between pt-1"><span>Long MA (180/200/220):</span><span>${(sensitivity.pl180.oos.cagr*100).toFixed(1)}% | <b>${(bt.oos.cagr*100).toFixed(1)}%(Core)</b> | ${(sensitivity.pl220.oos.cagr*100).toFixed(1)}%</span></div>
                    <div class="text-amber-200/80 mt-1">${generateSensitivityComment(bt, sensitivity.pm50, sensitivity.pm70, sensitivity.pl180, sensitivity.pl220)}</div>
                </div>
                ` : '<div class="text-xs text-slate-400">데이터 부족</div>'}
            </div>

            <!-- Logs & Tests -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
                    <h4 class="text-xs font-black text-indigo-900 mb-2 border-b border-indigo-200 pb-1">사실 - 계산 - 해석 (Inference Log)</h4>
                    <ul class="text-[9px] text-indigo-800 space-y-1 font-mono">${ev.log.length>0?ev.log.map(r=>`<li>• ${r}</li>`).join(''):'<li>특이 연산 로그 없음</li>'}</ul>
                </div>
                <div class="bg-slate-100 border border-slate-200 p-4 rounded-xl">
                    <h4 class="text-xs font-black text-slate-800 mb-2 border-b border-slate-300 pb-1">시스템 무결성 강제 테스트 (Unit Test)</h4>
                    <ul class="text-[9px] text-slate-600 space-y-1 font-mono">${tests.map(r=>`<li>${r}</li>`).join('')}</ul>
                </div>
            </div>
            
            <div class="text-[9px] text-slate-400 p-2 text-center">
                * EQDS V2.2.4는 라이브와 백테스트에서 단 1개의 의사결정 함수(evaluateSignalAtDate)만을 공유하며, 펀더멘털 데이터 N/A 항목은 기술 점수에 강제 재분배되지 않습니다.
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
    const chkMdd = document.getElementById('chk-quant-mdd');

    if (chkPrice && chkPrice.checked) ds.push({ label: '주가', data: currentQuantData.prices, borderColor: '#1e293b', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y', order: 10 });
    if (chkMa20 && chkMa20.checked) ds.push({ label: '20MA', data: currentQuantData.ma[20], borderColor: '#eab308', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (chkMa60 && chkMa60.checked) ds.push({ label: '60MA', data: currentQuantData.ma[60], borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (chkMa200 && chkMa200.checked) ds.push({ label: '200MA', data: currentQuantData.ma[200], borderColor: '#8b5cf6', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, tension: 0.4, yAxisID: 'y' });
    if (chkRsi && chkRsi.checked) ds.push({ label: 'RSI(14)', data: currentQuantData.rsi, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' });
    
    // Safety check for MDD DOM element existence and checked state
    if (chkMdd && chkMdd.checked && currentQuantData.mdd && currentQuantData.mdd.all) {
        let mddArr = currentQuantData.mdd.all.map(m => m.currentDD);
        ds.push({ label: 'Cur MDD(%)', data: mddArr, borderColor: 'rgba(239, 68, 68, 0.8)', backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.1, yAxisID: 'y1' });
    }

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

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('quant-ticker-input');
    if(input) input.addEventListener('keypress', e => { if(e.key==='Enter') runQuantAnalysis(); });
});
