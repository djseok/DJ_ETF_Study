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
    if(!selector) return;
    const names = Object.keys(globalParsedUsers);
    if(selector.options.length === 0 && names.length > 0) {
        selector.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
        selector.addEventListener('change', calculateExpectedDividends);
    }
}

function calculateExpectedDividends() {
    const selector = document.getElementById('divUserSelector');
    if(!selector) return;
    const targetUser = selector.value;
    const userObj = globalParsedUsers[targetUser];

    // 🛡️ [핵심 방어 로직] 데이터 로딩 전이면 즉시 탈출하여 에러 방지
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
    
    const divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = `₩${Math.round(totalReceived).toLocaleString()}`;
    
    const tableBody = document.getElementById("actual-dividend-table-body");
    if(tableBody) tableBody.innerHTML = actualLogsHtml || `<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">입금 내역이 없습니다.</td></tr>`;

    // ... 아래 기존 로직 동일 ...
    // (이하 코드 생략 - 위와 같이 if(element) 체크를 추가하면 더 안전합니다)
}
