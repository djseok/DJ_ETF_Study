// =====================================================
// 📈 배당 이력 및 실수령 데이터 로딩 모듈 (V11.0 차트 탑재)
// =====================================================

let myDivChart = null; // 📊 차트 중복 생성 방지를 위한 전역 변수

async function loadDividendHistoryData() {
    try {
        const res = await fetch(DIVIDEND_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        let stockGroupedLogs = {}; 

        // 💡 스마트 탐색: 종목과 배당금이 몇 번째 열에 있는지 스스로 찾습니다.
        let header = matrix[0] || [];
        let nameIdx = 0, dateIdx = 1, amountIdx = 2;
        for(let c=0; c<header.length; c++){
            let colStr = header[c].replace(/\s+/g, '');
            if(colStr.includes("종목")) nameIdx = c;
            if(colStr.includes("일") || colStr.includes("지급")) dateIdx = c;
            if(colStr.includes("분배") || colStr.includes("배당") || colStr.includes("금액")) amountIdx = c;
        }

        for(let i = 1; i < matrix.length; i++) {
            if(!matrix[i][nameIdx]) continue;
            let stockName = matrix[i][nameIdx].trim();
            let date = matrix[i][dateIdx] ? matrix[i][dateIdx].trim() : "";
            let amountStr = matrix[i][amountIdx] ? String(matrix[i][amountIdx]).replace(/,/g, '') : "0";
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
            for (let key in DIVIDEND_SCHEME_MATRIX) {
                if (exactStockName.replace(/\s+/g, '').includes(key.replace(/\s+/g, '')) || key.replace(/\s+/g, '').includes(exactStockName.replace(/\s+/g, ''))) {
                    schema = DIVIDEND_SCHEME_MATRIX[key];
                    break;
                }
            }
            
            let strategy = schema ? schema.strategy : "allAverage"; 
            let baseValue = 0;

            if (strategy === "recent3" && history.length > 0) {
                let sub = history.slice(0, 3);
                baseValue = sub.reduce((acc, cur) => acc + cur.amount, 0) / sub.length;
            } else if (strategy === "rolling12" && history.length > 0) {
                let sub = history.slice(0, 12);
                baseValue = sub.reduce((acc, cur) => acc + cur.amount, 0) / sub.length;
            } else if (strategy === "latest" && history.length > 0) {
                baseValue = history[0].amount;
            } else if (history.length > 0) {
                baseValue = history.reduce((acc, cur) => acc + cur.amount, 0) / history.length;
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
        for(let i=1; i<matrix.length; i++) {
            if(matrix[i].length < 5) continue;
            let userName = matrix[i][0].trim();      
            let date = matrix[i][1].trim();          
            let stockName = matrix[i][2].trim();     
            let qty = parseFloat(String(matrix[i][3]).replace(/,/g, '')) || 0; 
            let amount = parseFloat(String(matrix[i][4]).replace(/,/g, '')) || 0; 
            logs.push({ userName, date, stockName, qty, amount });
        }
        globalActualDividendLogs = logs;
        calculateExpectedDividends();
    } catch(e) { console.error("실수령 시트 로드 에러:", e); }
}

function initDividendUserSelector() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const names = Object.keys(globalParsedUsers);
    if(selector.options.length === 0 && names.length > 0) {
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
        console.warn("데이터 대기 중...");
        return;
    }

    let totalReceived = 0;
    let actualLogsHtml = "";
    let sortedActualLogs = [...globalActualDividendLogs].sort((a,b) => new Date(b.date) - new Date(a.date));

    sortedActualLogs.forEach(log => {
        if (log.userName === targetUser) {
            totalReceived += log.amount;
            actualLogsHtml += `
                <tr class="hover:bg-blue-50 transition-colors">
                    <td class="px-6 py-4 font-mono text-slate-500">${log.date}</td>
                    <td class="px-6 py-4 font-bold text-slate-800">
                        ${log.stockName}
                        <span class="ml-2 text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200">당시 ${log.qty.toLocaleString()}주</span>
                    </td>
                    <td class="px-6 py-4 text-right font-black text-blue-600 mono text-base">₩${log.amount.toLocaleString()}</td>
                </tr>
            `;
        }
    });

    const nameLabel = document.getElementById("actual-received-name-label");
    if(nameLabel) nameLabel.innerText = `[${targetUser}]님의 데이터 연동 완료`;
    
    const titleName = document.getElementById("actual-table-title-name");
    if(titleName) titleName.innerText = `[${targetUser}]`;

    const divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = `₩${Math.round(totalReceived).toLocaleString()}`;
    
    const tableBody = document.getElementById("actual-dividend-table-body");
    if(tableBody) tableBody.innerHTML = actualLogsHtml || `<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">입금 내역이 없습니다.</td></tr>`;

    let totalAnnualDividend = 0;
    let monthlyCalendar = new Array(12).fill(0); 

    userObj.items.forEach(item => {
        if(item.qty <= 0) return;
        let baseDividend1Time = 0;
        let payMonths = [1,2,3,4,5,6,7,8,9,10,11,12]; 

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

    // 🚀 계산이 모두 끝나면 예쁜 차트를 짠! 하고 그려줍니다.
    renderDividendChart(monthlyCalendar, currentMonth);
}
