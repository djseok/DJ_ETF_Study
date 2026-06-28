// =====================================================
// 🧪 동진 투자 공부실 타임머신 백테스팅 시뮬레이터 Engine
// =====================================================

function runBacktest() {
    const startCash = parseFloat(document.getElementById('btCash').value) || 10000000;
    const targetAsset = document.getElementById('btAsset').value;
    
    // masterRawData(1번 시트 과거 이력)에서 해당 자산의 과거 데이터 추출
    // 구조: [날짜, 종목명, 종가, 환율, VIX, 200일선...]
    let historicalRows = masterRawData.filter(row => row[1] === targetAsset);
    
    if(historicalRows.length === 0) {
        alert("백테스팅할 수 있는 과거 데이터가 부족합니다.");
        return;
    }

    // 과거 날짜 순으로 정렬 (정주행 매매 시뮬레이션)
    historicalRows.sort((a, b) => new Date(a[0]) - new Date(b.date));

    let cash = startCash;
    let shares = 0;
    let totalAsset = startCash;

    // 🏃‍♂️ 타임머신 가동: 과거의 날짜를 하루씩 지나며 기계적 매매 시뮬레이션
    historicalRows.forEach(day => {
        let price = parseFloat(day[2]) || 0;
        let signal = day[6]; // 시트에 계산된 BUY/SELL/HOLD 시그널

        if(signal === "BUY" && cash >= price) {
            // 현금의 10% 분할 매수 전략
            let buyBudget = cash * 0.1;
            let buyShares = Math.floor(buyBudget / price);
            shares += buyShares;
            cash -= (buyShares * price);
        } else if(signal === "SELL" && shares > 0) {
            // 보유 수량의 20% 분할 익절 전략
            let sellShares = Math.ceil(shares * 0.2);
            shares -= sellShares;
            cash += (sellShares * price);
        }
        totalAsset = cash + (shares * price);
    });

    // 결과 출력
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
