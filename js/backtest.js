// =====================================================
// 🧪 동진 투자 공부실 타임머신 백테스팅 시뮬레이터 Engine
// =====================================================

function runBacktest() {
    const startCash = parseFloat(document.getElementById('btCash').value) || 10000000;
    const targetAsset = document.getElementById('btAsset').value;
    
    // masterRawData(1번 시트 과거 이력)에서 해당 자산의 과거 데이터 추출
    let historicalRows = masterRawData.filter(row => row[1] === targetAsset);
    
    if(historicalRows.length === 0) {
        alert("백테스팅할 수 있는 과거 데이터가 부족합니다.");
        return;
    }

    // 💡 오류 수정 완료: b.date 가 아니라 배열 인덱스 b[0] 로 날짜를 정확히 불러옵니다!
    historicalRows.sort((a, b) => new Date(a[0]) - new Date(b[0]));

    let cash = startCash;
    let shares = 0;
    let totalAsset = startCash;

    historicalRows.forEach(day => {
        let price = parseFloat(day[2]) || 0;
        let signal = day[6]; 

        if(signal === "BUY" && cash >= price) {
            let buyBudget = cash * 0.1;
            let buyShares = Math.floor(buyBudget / price);
            shares += buyShares;
            cash -= (buyShares * price);
        } else if(signal === "SELL" && shares > 0) {
            let sellShares = Math.ceil(shares * 0.2);
            shares -= sellShares;
            cash += (sellShares * price);
        }
        totalAsset = cash + (shares * price);
    });

    let profitPct = ((totalAsset - startCash) / startCash * 100);
    document.getElementById('btResult').innerHTML = `
        <div class="p-4 bg-slate-900 text-white rounded-xl font-mono text-sm space-y-2">
            <div class="text-xs text-slate-400">시뮬레이션 완료 정산서</div>
            <div>💰 최종 자산: ₩${Math.round(totalAsset).toLocaleString()}</div>
            <div>📈 누적 수익률: <span class="${profitPct>=0?'text-red-400':'text-blue-400'}">${profitPct.toFixed(2)}%</span></div>
            <div class="text-[11px] text-slate-500">* 본 시뮬레이션은 대시보드 알고리즘 규칙에 따른 기계적 분할 매매 결과입니다.</div>
        </div>
    `;
}
