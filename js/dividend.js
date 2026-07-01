// =====================================================
// 📈 배당 이력 및 실수령 데이터 로딩 모듈 (V12.0 시트 구조 완벽 매칭판)
// =====================================================

let myDivChart = null; 

// 배당 ETF별 배당락/지급월 설정 (기존 하드코딩된 부분 대체용 기본 스키마)
const DIVIDEND_SCHEME_MATRIX = {
    "TIGER미국배당다우존스": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "ACE미국배당다우존스": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "KODEX미국나스닥100데일리커버드콜OTM": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "KODEX미국S&P500데일리커버드콜OTM": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "RISE미국나스닥100": { payMonths: [1,4,7,10], strategy: "latest" },
    "RISE미국S&P500": { payMonths: [1,4,7,10], strategy: "latest" },
    "KODEX미국반도체": { payMonths: [1,4,7,10], strategy: "latest" }
};

async function loadDividendHistoryData() {
    try {
        const res = await fetch(DIVIDEND_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        let stockGroupedLogs = {}; 

        // 1번 사진 구조: 0=구분, 1=종목명, 2=티커, 3=지급일, 4=주당배당금
        for(let i = 1; i < matrix.length; i++) {
            let row = matrix[i];
            if(row.length < 5) continue;
            
            let stockName = String(row[1]).trim();
            let date = String(row[3]).trim();
            let amountStr = String(row[4]).replace(/,/g, '');
            let amount = parseFloat(amountStr) || 0;

            if(!stockName || amount <= 0) continue;
            
            // 이름 통일화 작업
            if(stockName.includes("미국반도체")) stockName = "KODEX 미국반도체";

            if(!stockGroupedLogs[stockName]) stockGroupedLogs[stockName] = [];
            stockGroupedLogs[stockName].push({ date, amount });
        }

        let finalStrategyMap = {};
        for (let exactStockName in stockGroupedLogs) {
            let history = stockGroupedLogs[exactStockName];
            history.sort((a, b) => new Date(b.date) - new Date(a.date));

            let schema = null;
            let cleanStockName = exactStockName.replace(/\s+/g, '');
            for (let key in DIVIDEND_SCHEME_MATRIX) {
                if (cleanStockName.includes(key) || key.includes(cleanStockName)) {
                    schema = DIVIDEND_SCHEME_MATRIX[key];
                    break;
                }
            }
            
            let strategy = schema ? schema.strategy : "latest"; 
            let baseValue = 0;

            if (strategy === "recent3" && history.length >= 3) {
                let sub = history.slice(0, 3);
                baseValue = sub.reduce((acc, cur) => acc + cur.amount, 0) / sub.length;
            } else if (history.length > 0) {
                baseValue = history[0].amount; // 최신 배당금 우선 적용
            }
            finalStrategyMap[exactStockName] = baseValue;
        }
        globalCalculatedStrategyDividends = finalStrategyMap;
        initDividendUserSelector();
    } catch (e) { console.error("배당 역사 로드 에러:", e); }
}

async function loadActualDividendData() {
    try {
        const res = await fetch(ACTUAL_DIV_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        let logs = [];
        
        // 2번 사진 구조: 0=No, 1=투자자, 2=지급일, 3=종목명, 4=실수령액
        for(let i=1; i<matrix.length; i++) {
            let row = matrix[i];
            if(row.length < 5) continue;
            
            let userName = String(row[1]).trim();      
            let date = String(row[2]).trim();          
            let stockName = String(row[3]).trim();     
            // 실수령액 탭에는 '수량' 열이 없으므로 수량은 0으로 처리, 수령액은 4번 인덱스에서 추출
            let amount = parseFloat(String(row[4]).replace(/,/g, '')) || 0; 
            
            if(userName && amount > 0) {
                logs.push({ userName, date, stockName, qty: 0, amount });
            }
        }
        globalActualDividendLogs = logs;
        calculateExpectedDividends();
    } catch(e) { console.error("실수령 시트 로드 에러:", e); }
}

function initDividendUserSelector() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const names = Object.keys(globalParsedUsers);
    
    if(selector.options.length !== names.length && names.length > 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.addEventListener('change', calculateExpectedDividends);
    }
}

// 📊 배당금 차트 렌더링 함수
function renderDividendChart(monthlyData, currentMonth) {
    const ctx = document.getElementById('dividendChart');
    if(!ctx) return;

    let labels = [];
    let chartData = [];
    for(let m = currentMonth; m <= 12; m++) {
        labels.push(m + "월");
        chartData.push(Math.round(monthlyData[m - 1]));
    }

    if(myDivChart) myDivChart.destroy();

    myDivChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '예상 배당금 (₩)',
                data: chartData,
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                borderColor: 'rgba(16, 185, 129, 1)',
                borderWidth: 2,
                borderRadius: 8,
                barPercentage: 0.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'monospace' } } },
                x: { grid: { display: false } }
            }
        }
    });
}

function calculateExpectedDividends() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const targetUser = selector.value;
    const userObj = globalParsedUsers[targetUser];

    if(!userObj) {
        console.warn("투자자 데이터 로드 대기 중...");
        return;
    }

    // 1. 실제 수령 내역 (하단 다이어리) 그리기
    let totalReceived = 0;
    let actualLogsHtml = "";
    let sortedActualLogs = [...globalActualDividendLogs].sort((a,b) => new Date(b.date) - new Date(a.date));

    sortedActualLogs.forEach(log => {
        if (log.userName === targetUser) {
            totalReceived += log.amount;
            actualLogsHtml += `
                <tr class="hover:bg-blue-50 transition-colors border-b border-blue-50">
                    <td class="px-6 py-4 font-mono text-slate-500 text-xs">${log.date}</td>
                    <td class="px-6 py-4 font-bold text-slate-800 text-xs">${log.stockName}</td>
                    <td class="px-6 py-4 text-right font-black text-blue-600 mono text-base">₩${log.amount.toLocaleString()}</td>
                </tr>
            `;
        }
    });

    const nameLabel = document.getElementById("actual-received-name-label");
    if(nameLabel) nameLabel.innerText = `[${targetUser}]님의 통장 입금액 연동 완료`;
    
    const titleName = document.getElementById("actual-table-title-name");
    if(titleName) titleName.innerText = `[${targetUser}]`;

    const divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = `₩${Math.round(totalReceived).toLocaleString()}`;
    
    const tableBody = document.getElementById("actual-dividend-table-body");
    if(tableBody) tableBody.innerHTML = actualLogsHtml || `<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">입금 내역이 없습니다.</td></tr>`;

    // 2. 향후 예상 배당금 캘린더 & 차트 연산
    let totalAnnualDividend = 0;
    let monthlyCalendar = new Array(12).fill(0); 

    userObj.items.forEach(item => {
        if(item.qty <= 0) return;
        let baseDividend1Time = 0;
        let payMonths = []; // 배당락월이 없으면 캘린더에 안 더함

        let cleanedItemStock = item.stock.replace(/\s+/g, '');
        
        // 시트 1번에서 추출한 1주당 예상 배당금 매칭
        for(let stockKey in globalCalculatedStrategyDividends) {
            let cleanedKey = stockKey.replace(/\s+/g, '');
            if(cleanedItemStock.includes(cleanedKey) || cleanedKey.includes(cleanedItemStock)) {
                baseDividend1Time = globalCalculatedStrategyDividends[stockKey];
                break;
            }
        }

        // 해당 종목이 몇 월에 배당을 주는지 스키마 매칭
        for(let key in DIVIDEND_SCHEME_MATRIX) {
            let cleanedKey = key.replace(/\s+/g, '');
            if(cleanedItemStock.includes(cleanedKey) || cleanedKey.includes(cleanedItemStock)) {
                payMonths = DIVIDEND_SCHEME_MATRIX[key].payMonths;
                break;
            }
        }

        let singlePaymentTotal = item.qty * baseDividend1Time;
        
        // 매월(payMonths) 캘린더에 예상 금액 더하기
        payMonths.forEach(monthNum => {
            monthlyCalendar[monthNum - 1] += singlePaymentTotal; 
            totalAnnualDividend += singlePaymentTotal; 
        });
    });

    const annualPure = document.getElementById("annual-dividend-pure");
    if(annualPure) annualPure.innerText = `₩${Math.round(totalAnnualDividend).toLocaleString()}`;
    
    let currentMonth = new Date().getMonth() + 1; 
    let calendarHtml = "";
    
    // 남은 하반기 캘린더 그리기
    for (let m = currentMonth; m <= 12; m++) {
        let amount = monthlyCalendar[m - 1];
        let monthStr = `${m}월`;
        let isHighMonth = totalAnnualDividend > 0 && amount > (totalAnnualDividend / 12) * 1.5; 
        let bgClass = amount > 0 ? (isHighMonth ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200") : "bg-slate-50 border-slate-100 opacity-60";
        let textClass = amount > 0 ? "text-emerald-700" : "text-slate-400";
        
        calendarHtml += `
            <div class="${bgClass} border rounded-xl p-3 text-center shadow-sm flex flex-col justify-center h-full transition-all">
                <div class="text-xs font-bold text-slate-500 mb-1 flex items-center justify-center">
                    ${monthStr} ${isHighMonth ? '<i class="fas fa-star text-yellow-400 ml-1 text-[10px]"></i>' : ''}
                </div>
                <div class="text-sm md:text-base font-black ${textClass} mono">
                    ${amount > 0 ? '₩' + Math.round(amount).toLocaleString() : '-'}
                </div>
            </div>
        `;
    }
    
    const calendarDiv = document.getElementById("dividend-calendar");
    if(calendarDiv) calendarDiv.innerHTML = calendarHtml;

    // 최종적으로 차트 렌더링
    renderDividendChart(monthlyCalendar, currentMonth);
}
