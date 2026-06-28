// =====================================================
// 📈 배당 이력 및 실수령 데이터 로딩 모듈 (무적 방어판)
// =====================================================

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

// =====================================================
// 🛡️ 무적 방어막이 적용된 배당 계산 및 렌더링
// =====================================================
function calculateExpectedDividends() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const targetUser = selector.value;
    const userObj = globalParsedUsers[targetUser];

    if(!userObj) {
        console.warn("데이터 대기 중...");
        return;
    }

    // 1. 실수령액(통장 입금) 처리
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

    // 화면 요소가 존재하는지 확인 후 값 주입 (에러 원천 차단)
    const nameLabel = document.getElementById("actual-received-name-label");
    if(nameLabel) nameLabel.innerText = `[${targetUser}]님의 데이터 연동 완료`;
    
    const titleName = document.getElementById("actual-table-title-name");
    if(titleName) titleName.innerText = `[${targetUser}]`;

    const divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = `₩${Math.round(totalReceived).toLocaleString()}`;
    
    const tableBody = document.getElementById("actual-dividend-table-body");
    if(tableBody) tableBody.innerHTML = actualLogsHtml || `<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">입금 내역이 없습니다.</td></tr>`;

    // 2. 하반기 예상 캘린더 처리
    let totalAnnualDividend = 0;
    let breakdownHtml = "";
    let monthlyCalendar = new Array(12).fill(0); 

    userObj.items.forEach(item => {
        if(item.qty <= 0) return;
        let baseDividend1Time = 0;
        let payMonths = [1,2,3,4,5,6,7,8,9,10,11,12]; 
        let strategyText = "기본연산";

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
                let strat = DIVIDEND_SCHEME_MATRIX[key].strategy;
                if(strat === "recent3") strategyText = "최근 3개월 평균";
                else if(strat === "rolling12") strategyText = "12개월 평균";
                else if(strat === "latest") strategyText = "최신 분배금 고정";
                else strategyText = "전체 평균";
                break;
            }
        }

        let singlePaymentTotal = item.qty * baseDividend1Time;
        payMonths.forEach(monthNum => {
            monthlyCalendar[monthNum - 1] += singlePaymentTotal; 
            totalAnnualDividend += singlePaymentTotal; 
        });

        let cycleText = payMonths.length === 12 ? "매월" : (payMonths.length === 4 ? "분기" : "비정기");

        if (baseDividend1Time > 0) {
            breakdownHtml += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-6 py-4 font-bold text-slate-800">
                        <div>${item.stock}</div>
                        <div class="text-[10px] text-purple-600 font-bold bg-purple-50 inline-block px-1.5 py-0.5 rounded mt-1 border border-purple-100">
                            <i class="fas fa-filter mr-1"></i>${strategyText}
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-slate-700 font-extrabold text-sm">${item.qty.toLocaleString()} 주</td>
                    <td class="px-6 py-4 text-right font-mono text-slate-600">
                        <div class="font-black text-slate-800">₩${Math.round(baseDividend1Time).toLocaleString()}</div>
                        <div class="text-[10px] text-slate-400 font-semibold mt-0.5">${cycleText} (연 ${payMonths.length}회)</div>
                    </td>
                    <td class="px-6 py-4 text-right font-black text-emerald-600 mono text-base bg-emerald-50/20">
                        ₩${Math.round(singlePaymentTotal * payMonths.length).toLocaleString()}
                    </td>
                </tr>
            `;
        }
    });

    const annualPure = document.getElementById("annual-dividend-pure");
    if(annualPure) annualPure.innerText = `₩${Math.round(totalAnnualDividend).toLocaleString()}`;
    
    const breakdownBody = document.getElementById("dividend-breakdown-body");
    if(breakdownBody) breakdownBody.innerHTML = breakdownHtml || `<tr><td colspan="4" class="p-6 text-center text-slate-400 font-bold">매칭된 배당 정보가 없습니다.</td></tr>`;

    // 3. 캘린더 HTML 생성 및 삽입
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
}
