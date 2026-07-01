// =====================================================
// 📈 배당 이력 및 실수령 데이터 로딩 모듈 (V14.0 롤링 12개월 연속 캘린더 패치)
// =====================================================

let myDivChart = null; 

// 배당 ETF별 배당락/지급월 설정
const DIVIDEND_SCHEME_MATRIX = {
    "TIGER미국배당다우존스": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "ACE미국배당다우존스": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "KODEX미국나스닥100데일리커버드콜OTM": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "KODEX미국S&P500데일리커버드콜OTM": { payMonths: [1,2,3,4,5,6,7,8,9,10,11,12], strategy: "recent3" },
    "RISE미국나스닥100": { payMonths: [1,4,7,10], strategy: "latest" },
    "RISE미국S&P500": { payMonths: [1,4,7,10], strategy: "latest" },
    "KODEX미국반도체": { payMonths: [1,4,7,10], strategy: "latest" },
    "TIME글로벌AI인공지능액티브": { payMonths: [1,4,7,10], strategy: "latest" }
};

async function loadDividendHistoryData() {
    try {
        const res = await fetch(DIVIDEND_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        let stockGroupedLogs = {}; 

        let header = matrix[0] || [];
        let nameIdx = 1, dateIdx = 3, amountIdx = 4; 
        for(let c=0; c<header.length; c++){
            let colStr = String(header[c]).replace(/\s+/g, '');
            if(colStr.includes("종목")) nameIdx = c;
            else if(colStr.includes("일") || colStr.includes("지급")) dateIdx = c;
            else if(colStr.includes("배당") || colStr.includes("금액") || colStr.includes("분배")) amountIdx = c;
        }

        for(let i = 1; i < matrix.length; i++) {
            let row = matrix[i];
            let stockName = String(row[nameIdx] || "").trim();
            let date = String(row[dateIdx] || "").trim();
            let amountStr = String(row[amountIdx] || "").replace(/[^0-9.]/g, '');
            let amount = parseFloat(amountStr) || 0;

            if(!stockName || stockName.includes("종목") || amount <= 0) continue;
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
                baseValue = history[0].amount; 
            }
            finalStrategyMap[exactStockName] = baseValue;
        }
        globalCalculatedStrategyDividends = finalStrategyMap;
        initDividendUserSelector();
    } catch (e) { console.error("배당 이력 로드 에러:", e); }
}

async function loadActualDividendData() {
    try {
        const res = await fetch(ACTUAL_DIV_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        let logs = [];
        
        let header = matrix[0] || [];
        let userIdx = 1, dateIdx = 2, stockIdx = 3, amountIdx = 4; 
        for(let c=0; c<header.length; c++){
            let colStr = String(header[c]).replace(/\s+/g, '');
            if(colStr.includes("투자자") || colStr.includes("이름")) userIdx = c;
            else if(colStr.includes("일") || colStr.includes("지급")) dateIdx = c;
            else if(colStr.includes("종목")) stockIdx = c;
            else if(colStr.includes("수령") || colStr.includes("금액")) amountIdx = c;
        }

        for(let i=1; i<matrix.length; i++) {
            let row = matrix[i];
            let userName = String(row[userIdx] || "").trim();      
            let date = String(row[dateIdx] || "").trim();          
            let stockName = String(row[stockIdx] || "").trim();     
            let amountStr = String(row[amountIdx] || "").replace(/[^0-9.]/g, '');
            let amount = parseFloat(amountStr) || 0; 
            
            if(userName && !userName.includes("투자자") && amount > 0) {
                logs.push({ userName, date, stockName, qty: 0, amount });
            }
        }
        globalActualDividendLogs = logs;
        calculateExpectedDividends();
    } catch(e) { console.error("실수령액 로드 에러:", e); }
}

function initDividendUserSelector() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const names = Object.keys(globalParsedUsers);
    
    if(selector.options.length !== names.length && names.length > 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.removeEventListener('change', calculateExpectedDividends);
        selector.addEventListener('change', calculateExpectedDividends);
    }
}

// 📊 배당금 차트 렌더링 함수 (연속 롤링 12개월 반영)
function renderDividendChart(monthlyData, currentMonth) {
    const ctx = document.getElementById('dividendChart');
    if(!ctx) return;

    let labels = [];
    let chartData = [];
    
    // 🔥 루프 수정: 단순 12월 컷오프가 아니라 현재월부터 연속 12번 회전
    for(let i = 0; i < 12; i++) {
        let m = ((currentMonth - 1 + i) % 12) + 1;
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
    
    // 🔥 방어 코드: 선택 상자가 비어있다면 글로벌 객체의 첫 번째 유저명을 강제로 타겟팅
    const targetUser = selector.value || Object.keys(globalParsedUsers)[0];
    if(!targetUser) return;
    
    const userObj = globalParsedUsers[targetUser];
    if(!userObj) return;

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
        let payMonths = []; 

        let cleanedItemStock = item.stock.replace(/\s+/g, '');
        
        for(let stockKey in globalCalculatedStrategyDividends) {
            let cleanedKey = stockKey.replace(/\s+/g, '');
            if(cleanedItemStock.includes(cleanedKey) || cleanedKey.includes(cleanedItemStock)) {
                baseDividend1Time = globalCalculatedStrategyDividends[stockKey];
                break;
            }
        }

        for(let key in DIVIDEND_SCHEME_MATRIX) {
            let cleanedKey = key.replace(/\s+/g, '');
            if(cleanedItemStock.includes(cleanedKey) || cleanedKey.includes(cleanedItemStock)) {
                payMonths = DIVIDEND_SCHEME_MATRIX[key].payMonths;
                break;
            }
        }

        let singlePaymentTotal = item.qty * baseDividend1Time;
        payMonths.forEach(monthNum => {
            monthlyCalendar[monthNum - 1] += singlePaymentTotal; 
            totalAnnualDividend += singlePaymentTotal; 
        });
    });

    const annualPure = document.getElementById("annual-dividend-pure");
    if(annualPure) annualPure.innerText = `₩${Math.round(totalAnnualDividend).toLocaleString()}`;
    
    let currentMonth = new Date().getMonth() + 1; 
    let calendarHtml = "";
    
    // 🔥 달력 렌더링 루프 수정: 현재 월부터 연속 12개월 표출 알고리즘 적용
    for (let i = 0; i < 12; i++) {
        let m = ((currentMonth - 1 + i) % 12) + 1;
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

    renderDividendChart(monthlyCalendar, currentMonth);
}
