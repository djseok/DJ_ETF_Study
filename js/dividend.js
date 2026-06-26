async function loadDividendHistoryData() {
    try {
        const res = await fetch(DIVIDEND_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        let stockGroupedLogs = {}; 

        for(let i = 1; i < matrix.length; i++) {
            if(matrix[i].length < 3) continue;
            let stockName = matrix[i][0].trim();
            let date = matrix[i][1].trim();
            let amount = parseFloat(String(matrix[i][2]).replace(/,/g, '')) || 0;

            if(!stockName || stockName === "종목" || isNaN(amount)) continue;
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
    const names = Object.keys(globalParsedUsers);
    if(selector.options.length === 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.addEventListener('change', calculateExpectedDividends);
    }
}

function calculateExpectedDividends() {
    const targetUser = document.getElementById('divUserSelector').value;
    const userObj = globalParsedUsers[targetUser];
    if(!userObj) return;

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
    document.getElementById("actual-received-name-label").innerText = `[${targetUser}]님의 4번 시트 데이터 연동 완료`;
    document.getElementById("actual-table-title-name").innerText = `[${targetUser}]`;
    document.getElementById("actual-received-dividend").innerText = `₩${Math.round(totalReceived).toLocaleString()}`;
    document.getElementById("actual-dividend-table-body").innerHTML = actualLogsHtml || `<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">아직 기입된 통장 입금 내역이 없습니다.</td></tr>`;

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

    document.getElementById("annual-dividend-pure").innerText = `₩${Math.round(totalAnnualDividend).toLocaleString()}`;
    document.getElementById("dividend-breakdown-body").innerHTML = breakdownHtml || `<tr><td colspan="4" class="p-6 text-center text-slate-400 font-bold">배당 이력과 매칭된 보유 주식이 없습니다.</td></tr>`;

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
    document.getElementById("dividend-calendar").innerHTML = calendarHtml;
}
