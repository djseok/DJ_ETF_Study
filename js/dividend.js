async function loadDividendLogs() {
    try {
        var res = await fetch(DIVIDEND_CSV_URL + "&t=" + new Date().getTime());
        var text = await res.text();
        var matrix = localParseCsvToMatrix(text);
        
        globalActualDividendLogs = [];
        
        // CSV 데이터 파싱 (헤더 제외)
        for(var i = 1; i < matrix.length; i++) {
            var row = matrix[i];
            
            // H열(인덱스 7)부터 L열(인덱스 11)까지 데이터가 존재해야 하므로 방어 코드 수정
            // H열(이름)이 비어있으면 배당 데이터가 없는 줄이므로 건너뜁니다.
            if(row.length < 12 || !row[7]) continue; 

            globalActualDividendLogs.push({
                userName: String(row[7]).trim(),                           // H열: 이름 (D, S, J)
                date: String(row[8]).trim(),                               // I열: 수령일자
                stockName: String(row[9]).trim(),                          // J열: 종목
                amount: parseFloat(String(row[11]).replace(/[^0-9.]/g, '')) || 0 // L열: 실수령액 (K열은 10)
            });
        }
        console.log("✅ 배당 로그 데이터 로드 완료:", globalActualDividendLogs);
    } catch(e) {
        console.error("배당 로그 로드 실패:", e);
    }
}

async function renderActualDividendView() {
    try {
        // 1. 배당 룰북과 배당 내역을 로드
        // 🔥 [2중 방어 적용] loadDynamicDividendRules 함수가 없더라도 에러를 뿜지 않고 넘어가게 만듭니다.
        const ruleLoader = typeof loadDynamicDividendRules === 'function' 
            ? loadDynamicDividendRules() 
            : Promise.resolve();

        await Promise.all([
            ruleLoader,
            loadDividendLogs()
        ]);
        
        // 2. 화면 렌더링
        initDividendUserSelector();
        calculateAndDrawDividends();
        
    } catch (error) {
        console.error("차트 렌더링 중 오류 발생:", error);
    }
}

// 🔥 [핵심 추가] main.js의 탭 클릭 로직이 이 함수를 정상적으로 부를 수 있도록 연결해 줍니다!
window.loadActualDividendData = renderActualDividendView;
