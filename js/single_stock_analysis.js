// ---------------------------------------------------------
// [DECISION ENGINE] Evaluate Signal (Single Source of Truth)
// ---------------------------------------------------------
function evaluateSignalAtDate(i, ind, spy, qqq, cfg, context) {
    const vm = buildViewModel(i, ind, spy, qqq, cfg);
    const isLive = context.mode === "live";
    
    // [버그 수정] 변수명 통일 및 log 배열 선언
    let whyPositive = [], whyNegative = [], whyNotAggressive = [], log = [];

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
        if (vm.price < vm.ma[200] && vm.sl[200] < 0 && vm.price < vm.ma[60] && vm.mdd.d20.currentDD <= -20) {
            targetW = 0.0; isExplicitExit = true;
            exitReason = "장기추세 붕괴 + 중기 붕괴 + 단기 급락(-20% 이하)";
        }
    } else if (cfg.exitType === "C") { 
        if (vm.price < vm.ma[200] && vm.sl[200] < 0 && vm.mdd.d20.currentDD <= -25) {
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

    // [버그 수정] log 선언 및 whyPositive/whyNegative 객체 반환 
    if(isLive) log.push(`CALC: Adj ${adjScore} -> Cand ${(candW*100).toFixed(0)}% -> GateCap ${(gateCap*100).toFixed(0)}% -> Target ${(targetW*100).toFixed(0)}%`);

    return { 
        availScore, baseScore, adjScore, riskPenalty: penalty, candW, entryCap, gateCap, finalTargetWeight: targetW, actualWeight: actW, tradeDeltaWeight: tradeDelta,
        act, sty, tr: trSc, mo: moSc, rs: rsSc, ri: riSc, mk: mkSc,
        whyPositive, whyNegative, whyNotAggressive, log, vm, isExplicitExit, stage: vm.stage
    };
}
