// =====================================================
// 📈 배당 이력 및 실수령 데이터 로딩 모듈 (V17.0 종목별 스택 차트 패치)
// =====================================================

let myDivChart = null; 

// 🔥 차트를 예쁘게 꾸며줄 종목별 자동 할당 컬러 팔레트
const CHART_COLORS = [
    'rgba(54, 162, 235, 0.7)',  // 파랑
    'rgba(255, 99, 132, 0.7)',  // 빨강
    'rgba(255, 206, 86, 0.7)',  // 노랑
    'rgba(75, 192, 192, 0.7)',  // 초록
    'rgba(153, 102, 255, 0.7)', // 보라
    'rgba(255, 159, 64, 0.7)',  // 주황
    'rgba(199, 199, 199, 0.7)'  // 회색
];

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

        let headerIdx = 0;
        for(let i=0; i < Math.min(10, matrix.length); i++) {
            let rowStr = matrix[i].join('').replace(/\s+/g, '');
            if(rowStr.includes("종목") && (rowStr.includes("배당") || rowStr.includes("금액"))) {
                headerIdx = i;
                break;
            }
        }

        let header = matrix[headerIdx] || [];
        let nameIdx = 1, dateIdx = 3, amountIdx = 4; 
        for(let c=0; c<header.length; c++){
            let colStr = String(header[c]).replace(/\s+/g, '');
            if(colStr.includes("종목")) nameIdx = c;
            else if(colStr.includes("일") || colStr.includes("지급")) dateIdx = c;
            else if(colStr.includes("배당") || colStr.includes("금액") || colStr.includes("분배")) amountIdx = c;
        }

        for(let i = headerIdx + 1; i < matrix.length; i++) {
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
        
        let headerIdx = 0;
        for(let i=0; i < Math.min(10, matrix.length); i++) {
            let rowStr = matrix[i].join('').replace(/\s+/g, '');
            if(rowStr.includes("종목") && (rowStr.includes("투자자") || rowStr.includes("이름") || rowStr.includes("금액") || rowStr.includes("수령"))) {
                headerIdx = i;
                break;
            }
        }

        let header = matrix[headerIdx] || [];
        let userIdx = 1, dateIdx = 2, stockIdx = 3, amountIdx = 4; 
        for(let c=0; c<header.length; c++){
            let colStr = String(header[c]).replace(/\s+/g, '');
            if(colStr.includes("투자자") || colStr.includes("이름")) userIdx = c;
            else if(colStr.includes("일") || colStr.includes("지급")) dateIdx = c;
            else if(colStr.includes("종목")) stockIdx = c;
            else if(colStr.includes("수령") || colStr.includes("금액")) amountIdx = c;
        }

        let currentUser = ""; 

        for(let i = headerIdx + 1; i < matrix.length; i++) {
            let row = matrix[i];
            let nameRaw = String(row[userIdx] || "").trim();      
            if(nameRaw && !nameRaw.includes("투자자") && !nameRaw.includes("이름") && !nameRaw.includes("No")) {
                currentUser = nameRaw;
            }
            let userName = currentUser;

            let date = String(row[dateIdx] || "").trim();          
            let stockName = String(row[stockIdx] || "").trim();     
            let amountStr = String(row[amountIdx] || "").replace(/[^0-9.]/g, '');
            let amount = parseFloat(amountStr) || 0; 
            
            if(userName && amount > 0) {
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

// 🔥 차트 렌더링 함수 완벽 개조: 단일 막대 -> 종목별 누적(Stacked) 막대 차트로 변신
function renderStackedDividendChart(datasetsByStock, currentMonth) {
    const ctx = document.getElementById('dividendChart');
    if(!ctx) return;

    let labels = [];
    for(let i = 0; i < 12; i++) {
        let m = ((currentMonth - 1 + i) % 12) + 1;
        labels.push(m + "월");
    }

    // 💡 차트 데이터셋 조립
    let finalDatasets = [];
    let colorIndex = 0;
    
    for (let stockName in datasetsByStock) {
        let monthlyArray = datasetsByStock[stockName];
        let hasData = monthlyArray.some(val => val > 0);
        
        // 데이터가 1원이라도 있는 종목만 차트에 추가
        if (hasData) {
            let chartColor = CHART_COLORS[colorIndex % CHART_COLORS.length];
            finalDatasets.push({
                label: stockName,
                data: monthlyArray,
                backgroundColor: chartColor,
                borderColor: chartColor.replace('0.7', '1'),
                borderWidth: 1,
                borderRadius: 4
            });
            colorIndex++;
        }
    }

    if(myDivChart) myDivChart.destroy();

    myDivChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: finalDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: true, // 범례 표시 (어떤 색이 어떤 종목인지 보여줌)
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 10 } }
                } 
            },
            scales: {
                x: { 
                    stacked: true, // x축 위로 막대 쌓기
                    grid: { display: false } 
                },
                y: { 
                    stacked: true, // y축 데이터 합산
                    beginAtZero: true, 
                    grid: { color: '#f1f5f9' }, 
                    ticks: { font: { family: 'monospace' } } 
                }
            }
        }
    });
}

function calculateExpectedDividends() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    
    const targetUser = selector.value || Object.keys(globalParsedUsers)[0];
    if(!targetUser) return;
    
    const userObj = globalParsedUsers[targetUser];
    if(!userObj) return;

    let totalReceived = 0;
    let actualLogsHtml = "";
    let sortedActualLogs = [...globalActualDividendLogs].sort((a,b) => new Date(b.date) - new Date(a.date));

    let cleanTarget = targetUser.replace(/\s+/g, '').replace('님', '');

    sortedActualLogs.forEach(log => {
        let cleanLogName = log.userName.replace(/\s+/g, '').replace('님', '');
        
        if (cleanLogName === cleanTarget || cleanLogName.includes(cleanTarget) || cleanTarget.includes(cleanLogName)) {
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

    let totalAnnualDividend = 0;
    let totalMonthlyCalendar = new Array(12).fill(0); 
    
    // 🔥 종목별로 배당금 데이터를 분리해서 보관할 바구니 준비
    let chartDatasetsByStock = {}; 

    let currentMonth = new Date().getMonth() + 1; 

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
        
        if (singlePaymentTotal > 0) {
            // 이 종목 전용 12개월 배열 초기화
            if (!chartDatasetsByStock[item.stock]) {
                chartDatasetsByStock[item.stock] = new Array(12).fill(0);
            }
            
            payMonths.forEach(monthNum => {
                totalMonthlyCalendar[monthNum - 1] += singlePaymentTotal; 
                totalAnnualDividend += singlePaymentTotal; 
                
                // 🔥 차트에 뿌리기 위해 롤링 캘린더 순서(현재월 기준)에 맞춰서 배열에 꽂아 넣기
                for(let i=0; i<12; i++){
                    let calMonth = ((currentMonth - 1 + i) % 12) + 1;
                    if(calMonth === monthNum) {
                        chartDatasetsByStock[item.stock][i] += Math.round(singlePaymentTotal);
                    }
                }
            });
        }
    });

    const annualPure = document.getElementById("annual-dividend-pure");
    if(annualPure) annualPure.innerText = `₩${Math.round(totalAnnualDividend).toLocaleString()}`;
    
    let calendarHtml = "";
    for (let i = 0; i < 12; i++) {
        let m = ((currentMonth - 1 + i) % 12) + 1;
        let amount = totalMonthlyCalendar[m - 1];
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

    // 🔥 업그레이드된 종목별 스택 차트 그리기 함수 호출!
    renderStackedDividendChart(chartDatasetsByStock, currentMonth);
}
