// [최종 수정된 dividend.js]
// 전역 데이터를 강제로 불러오는 로직을 추가했습니다.

async function loadDividendLogs() {
    try {
        var res = await fetch(DIVIDEND_CSV_URL + "&t=" + new Date().getTime());
        var text = await res.text();
        var matrix = localParseCsvToMatrix(text);
        
        globalActualDividendLogs = [];
        // CSV 데이터 파싱 (헤더 제외)
        for(var i = 1; i < matrix.length; i++) {
            var row = matrix[i];
            if(row.length < 4) continue;
            globalActualDividendLogs.push({
                date: row[0],
                stockName: row[1],
                userName: row[2],
                amount: parseFloat(row[3].replace(/[^0-9]/g, '')) || 0
            });
        }
        console.log("✅ 배당 로그 데이터 로드 완료:", globalActualDividendLogs);
    } catch(e) {
        console.error("배당 로그 로드 실패:", e);
    }
}

// 💡 수정된 렌더링 함수: 데이터를 먼저 다 불러오고 화면을 그립니다.
async function renderActualDividendView() {
    // 1. 배당 룰북과 배당 내역을 로드
    await Promise.all([
        loadDynamicDividendRules(),
        loadDividendLogs()
    ]);
    
    initDividendUserSelector();
    calculateAndDrawDividends();
}
