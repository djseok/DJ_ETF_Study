function extractGlobalMacroVariables() {
    if (!masterData || masterData.length === 0) return;

    masterData.forEach(row => {
        let gubun = String(row[0] || "").trim();
        if (gubun !== '지표') return; // '지표'라고 적힌 행만 정확하게 읽어냅니다.

        let name = String(row[2] || "").replace(/\s+/g, '').toUpperCase(); // 띄어쓰기 제거 및 대문자 변환으로 완벽 인식
        
        let prev = parseFloat(String(row[3]).replace(/,/g, '')) || 0;
        let live = parseFloat(String(row[4]).replace(/,/g, '')) || 0;
        let pct = prev > 0 ? ((live - prev) / prev * 100) : 0;
        let colorClass = pct >= 0 ? 'text-red-500' : 'text-blue-500';
        let sign = pct >= 0 ? '▲' : '▼';

        // 🚨 이름에 '나스닥', 'NDX', 'IXIC' 중 하나라도 들어가면 표출!
        if(name.includes('나스닥') || name.includes('NDX') || name.includes('IXIC')) {
            document.getElementById('macro-nasdaq').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toLocaleString()}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } 
        // 🚨 이름에 '환율' 이 들어가면 무조건 표출!
        else if(name.includes('환율')) {
            globalFxDelta = prev > 0 ? (live - prev) / prev : 0;
            document.getElementById('macro-fx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">₩${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } 
        // 🚨 이름에 'VIX'가 들어가면 표출!
        else if(name.includes('VIX')) {
            globalVixValue = live;
            document.getElementById('macro-vix').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        } 
        // 🚨 이름에 'TNX'가 들어가면 표출!
        else if(name.includes('TNX')) {
            document.getElementById('macro-tnx').innerHTML = `<div class="text-xl md:text-2xl font-extrabold mono">${live.toFixed(2)}%</div><div class="text-xs font-bold ${colorClass}">${sign} ${Math.abs(pct).toFixed(2)}%</div>`;
        }
    });
}
