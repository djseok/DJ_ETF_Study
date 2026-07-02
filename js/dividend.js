// =====================================================
// 📈 배당 실수령 시각화 전용 모듈 (V18.0 완벽한 No-Code 룰북 연동 패치)
// =====================================================

let myDivChart = null; 

// 🔥 차트를 예쁘게 꾸며줄 종목별 자동 할당 컬러 팔레트
const CHART_COLORS = [
    'rgba(54, 162, 235, 0.7)',  // 파랑 (배당다우존스)
    'rgba(255, 99, 132, 0.7)',  // 빨강 (나스닥 커버드콜)
    'rgba(255, 206, 86, 0.7)',  // 노랑 (S&P500 커버드콜)
    'rgba(75, 192, 192, 0.7)',  // 초록
    'rgba(153, 102, 255, 0.7)', // 보라
    'rgba(255, 159, 64, 0.7)'   // 주황
];

// 💡 1. [신규 로직] 구글 시트에서 배당 주기 및 예상 금액을 읽어오는 함수
async function loadDynamicDividendRules() {
    try {
        if(typeof DIVIDEND_RULES_CSV_URL === 'undefined') return;
        const res = await fetch(DIVIDEND_RULES_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        
        let rulesObj = {};
        
        // 첫 번째 줄(헤더)은 건너뛰고 파싱 시작
        for(let i = 1; i < matrix.length; i++) {
            let row = matrix[i];
            if(row.length < 3) continue;

            let rawStockName = String(row[0] || "").trim(); // A열: 종목명
            let rawMonths = String(row[1] || "").trim();    // B열: 지급월 (예: "1,4,7,10")
            let rawAmount = String(row[2] || "").replace(/[^0-9.]/g, ''); // C열: 예상배당금

            if (!rawStockName) continue;

            // 문자열 "1,4,7,10"을 실제 숫자 배열 [1, 4, 7, 10]으로 변환
            let payMonthsArray = rawMonths.split(',').map(m => parseInt(m.trim())).filter(m => !isNaN(m));
            let expectedAmount = parseFloat(rawAmount) || 0;

            // 공백을 모두 제거한 깔끔한 이름을 KEY로 사용
            let cleanKey = rawStockName.replace(/\s+/g, '');
            rulesObj[cleanKey] = { payMonths: payMonthsArray, expectedAmount: expectedAmount };
        }
        
        globalDividendRulesMatrix = rulesObj;
        console.log("✅ 동적 배당 룰북 로드 성공!", globalDividendRulesMatrix);

    } catch (e) {
        console.error("동적 배당 룰북 로드 실패:", e);
    }
}

// 💡 2. 배당 탭 진입 시 실행되는 메인 컨트롤러
async function renderActualDividendView() {
    // 룰북 데이터가 비어있다면 최초 1회 로드합니다!
    if (Object.keys(globalDividendRulesMatrix).length === 0) {
        await loadDynamicDividendRules();
    }
    
    initDividendUserSelector();
    calculateAndDrawDividends();
}

function initDividendUserSelector() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const names = Object.keys(globalParsedUsers);
    
    if(selector.options.length !== names.length && names.length > 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.removeEventListener('change', calculateAndDrawDividends);
        selector.addEventListener('change', calculateAndDrawDividends);
    }
}

// 🔥 개인별 실수령액 계산 및 캘린더/스택 차트 통합 처리 함수
function calculateAndDrawDividends() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    
    const targetUser = selector.value || Object.keys(globalParsedUsers)[0];
    if(!targetUser) return;

    let totalReceived = 0;
    let actualLogsHtml = "";
    
    // 차트를 위한 그릇 준비
    let chartDatasetsByStock = {}; 
    let totalMonthlyCalendar = new Array(12).fill(0); 

    // 현재 기준 달 구하기 (예: 6월이면 6)
    let currentMonth = new Date().getMonth() + 1;

    // ----------------------------------------------------
    // [A] 실수령액 테이블 (과거 데이터 파싱)
    // ----------------------------------------------------
    if(typeof globalActualDividendLogs !== 'undefined') {
        let sortedActualLogs = [...globalActualDividendLogs].sort((a,b) => new Date(b.date) - new Date(a.date));

        sortedActualLogs.forEach(log => {
            if (log.userName.includes(targetUser) || targetUser.includes(log.userName)) {
                totalReceived += log.amount;
                
                actualLogsHtml += `<tr class="hover:bg-blue-50 transition-colors border-b border-blue-50">
                        <td class="px-6 py-4 font-mono text-slate-500 text-xs">${log.date}</td>
                        <td class="px-6 py-4 font-bold text-slate-800 text-xs">${log.stockName}</td>
                        <td class="px-6 py-4 text-right font-black text-blue-600 mono text-base">₩${log.amount.toLocaleString()}</td>
                    </tr>`;

                // 과거 수령액을 월별 달력과 종목별 차트에 더해주기
                let monthMatch = log.date.match(/\b([1-9]|1[0-2])\b/); 
                if (monthMatch) {
                    let mIndex = parseInt(monthMatch[0]) - 1; 
                    totalMonthlyCalendar[mIndex] += log.amount;
                    
                    if (!chartDatasetsByStock[log.stockName]) {
                        chartDatasetsByStock[log.stockName] = new Array(12).fill(0);
                    }
                    chartDatasetsByStock[log.stockName][mIndex] += log.amount;
                }
            }
        });
    }

    // ----------------------------------------------------
    // [B] ✨ 미래 예상 배당금 계산 (포트폴리오 수량 x 시트의 룰북 데이터)
    // ----------------------------------------------------
    const userObj = globalParsedUsers[targetUser];
    let totalAnnualExpected = 0; // 올해 예상되는 총 추가 배당금

    if (userObj && userObj.items) {
        userObj.items.forEach(item => {
            if (item.qty <= 0) return; // 보유 수량이 없으면 패스

            let cleanedItemStock = item.stock.replace(/\s+/g, '');
            let activeRule = null;

            // 포트폴리오의 종목명과 시트에서 읽어온 룰북의 Key를 비교하여 매칭!
            for (let ruleKey in globalDividendRulesMatrix) {
                if (cleanedItemStock.includes(ruleKey) || ruleKey.includes(cleanedItemStock)) {
                    activeRule = globalDividendRulesMatrix[ruleKey];
                    break;
                }
            }

            // 매칭된 룰이 있고, 예상 금액이 0보다 크다면!
            if (activeRule && activeRule.expectedAmount > 0 && activeRule.payMonths.length > 0) {
                let expectedSinglePayment = item.qty * activeRule.expectedAmount; // 1회 지급 시 예상액

                if (!chartDatasetsByStock[item.stock]) {
                    chartDatasetsByStock[item.stock] = new Array(12).fill(0);
                }

                // 룰북에 명시된 지급월(payMonths)마다 순회하며 금액 더하기
                activeRule.payMonths.forEach(monthNum => {
                    // 💡 [핵심] 이미 과거(이번 달 포함)에 실수령액이 찍힌 달은 미래 예측에서 제외!
                    let calIndex = monthNum - 1;
                    let isFutureMonth = false;

                    // 현재 월 기준으로 미래인지 판별 로직
                    if (monthNum > currentMonth) {
                        isFutureMonth = true;
                    }

                    if (isFutureMonth) {
                        totalMonthlyCalendar[calIndex] += expectedSinglePayment;
                        totalAnnualExpected += expectedSinglePayment;
                        chartDatasetsByStock[item.stock][calIndex] += expectedSinglePayment;
                    }
                });
            }
        });
    }

    // ----------------------------------------------------
    // [C] 화면 UI 업데이트
    // ----------------------------------------------------
    const nameLabel = document.getElementById("actual-received-name-label");
    if(nameLabel) nameLabel.innerText = `[${targetUser}]님의 실수령 배당금 현황`;
    
    const divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = `₩${Math.round(totalReceived).toLocaleString()}`;
    
    // 연간 누적 달성(실수령 + 미래 예상) 텍스트 업데이트
    const annualPure = document.getElementById("annual-dividend-pure");
    if(annualPure) {
        let totalYearly = totalReceived + totalAnnualExpected;
        annualPure.innerText = `₩${Math.round(totalYearly).toLocaleString()}`; 
    }

    const tableBody = document.getElementById("actual-dividend-table-body");
    if(tableBody) tableBody.innerHTML = actualLogsHtml || `<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">배당금 수령 내역이 없습니다.</td></tr>`;

    // 12개월 바둑판 달력 그리기
    let calendarHtml = "";
    for (let i = 0; i < 12; i++) {
        let amount = totalMonthlyCalendar[i];
        let monthStr = `${i + 1}월`;
        
        // 시각적 강조 효과 (평균 이상 받은 달)
        let isHighMonth = amount > ((totalReceived + totalAnnualExpected) / 12) * 1.5; 
        
        // 과거/현재 달인지, 미래의 예측 달인지 구분하여 색상 변경
        let isFuture = (i + 1) > currentMonth;
        let bgClass = "bg-slate-50 border-slate-100 opacity-60";
        let textClass = "text-slate-400";
        let extraIcon = "";

        if (amount > 0) {
            if (isFuture) {
                // 미래 예상치: 약간 흐린 주황/노란색 계열
                bgClass = "bg-orange-50 border-orange-200 border-dashed";
                textClass = "text-orange-600 opacity-80";
                extraIcon = `<i class="fas fa-clock text-orange-300 ml-1 text-[10px]"></i>`;
            } else {
                // 이미 받은 실수령액: 진한 녹색
                bgClass = isHighMonth ? "bg-emerald-50 border-emerald-300 shadow-sm" : "bg-white border-slate-200";
                textClass = "text-emerald-700";
                if(isHighMonth) extraIcon = `<i class="fas fa-star text-yellow-400 ml-1 text-[10px]"></i>`;
            }
        }
        
        calendarHtml += `
            <div class="${bgClass} border rounded-xl p-3 text-center flex flex-col justify-center h-full transition-all">
                <div class="text-xs font-bold text-slate-500 mb-1 flex items-center justify-center">
                    ${monthStr} ${extraIcon}
                </div>
                <div class="text-sm md:text-base font-black ${textClass} mono">
                    ${amount > 0 ? '₩' + Math.round(amount).toLocaleString() : '-'}
                </div>
            </div>
