// =====================================================
// 🏆 포트폴리오 로드 및 렌더링 모듈 (V15.1 에러 방어 패치)
// =====================================================

async function loadPortfolioData(currentTab) {
    try {
        const res = await fetch(PORTFOLIO_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        const users = {};

        let headerIdx = 0;
        for(let i=0; i < Math.min(10, matrix.length); i++) {
            let rowStr = matrix[i].join('').replace(/\s+/g, '');
            if(rowStr.includes("종목") && (rowStr.includes("수량") || rowStr.includes("비중") || rowStr.includes("평단"))) {
                headerIdx = i;
                break;
            }
        }

        let header = matrix[headerIdx] || [];
        let nameIdx = 0, stockIdx = 1, weightIdx = 2, avgPriceIdx = 3, qtyIdx = 4, currPriceIdx = 5;
        for(let c=0; c<header.length; c++){
            let colStr = String(header[c]).replace(/\s+/g, '');
            if(colStr.includes("투자자") || colStr.includes("이름")) nameIdx = c;
            else if(colStr.includes("종목")) stockIdx = c;
            else if(colStr.includes("비중")) weightIdx = c;
            else if(colStr.includes("평단") || colStr.includes("단가")) avgPriceIdx = c;
            else if(colStr.includes("수량") || colStr.includes("보유")) qtyIdx = c;
            else if(colStr.includes("현재")) currPriceIdx = c;
        }

        let currentUser = ""; 

        for(let i = headerIdx + 1; i < matrix.length; i++) {
            let row = matrix[i];
            if(row.length < 3) continue;

            let nameRaw = String(row[nameIdx] || "").trim();
            if(nameRaw && !nameRaw.includes("투자자") && !nameRaw.includes("이름") && !nameRaw.includes("구분") && !nameRaw.includes("No")) {
                currentUser = nameRaw;
            }
            let name = currentUser;
            if(!name) continue;

            let stock = String(row[stockIdx] || "").trim();
            if(!stock || stock.includes("종목") || stock.includes("합계")) continue;

            let wStr = String(row[weightIdx] || "").replace(/[^0-9.]/g, '');
            let targetWeight = parseFloat(wStr) || 0;

            let aStr = String(row[avgPriceIdx] || "").replace(/[^0-9.]/g, '');
            let avgPrice = parseFloat(aStr) || 0;

            let qStr = String(row[qtyIdx] || "").replace(/[^0-9.-]/g, '');
            let qty = parseFloat(qStr) || 0;

            let cStr = String(row[currPriceIdx] || "").replace(/[^0-9.]/g, '');
            let currPrice = parseFloat(cStr) || avgPrice;

            if(!users[name]) users[name] = { name: name, totalInvest: 0, totalCurrent: 0, items: [] };

            let invest = avgPrice * qty;
            let current = currPrice * qty;

            if(qty > 0) {
                users[name].totalInvest += invest;
                users[name].totalCurrent += current;
            }

            users[name].items.push({ stock, targetWeight, avgPrice, currPrice, qty, invest, current });
        }
        globalParsedUsers = users;

        let rankArray = Object.values(users).filter(u => u.totalInvest > 0).map(u => {
            u.totalReturnPct = ((u.totalCurrent - u.totalInvest) / u.totalInvest * 100) || 0;
            return u;
        }).sort((a,b) => b.totalReturnPct - a.totalReturnPct);

        if(currentTab === 'port') renderPortfolioView(rankArray);
        if(currentTab === 'calc' && typeof window.renderCalculatorView === 'function') window.renderCalculatorView();
        
        // 🔥 안전망: 함수가 없으면 무시하고 넘어갑니다!
        if(currentTab === 'conc') {
            if(typeof window.initConcentrationView === 'function') window.initConcentrationView();
        }
        
        if(currentTab === 'div') {
            if(typeof window.loadDividendHistoryData === 'function') await window.loadDividendHistoryData();
            if(typeof window.loadActualDividendData === 'function') await window.loadActualDividendData();
        }
    } catch (e) { console.error("포트폴리오 로드 실패:", e); }
}

function renderPortfolioView(rankArray) {
    let rankHtml = "", cardsHtml = "";
    const medals = ["🥇", "🥈", "🥉"];

    if(!rankArray || rankArray.length === 0) {
        const rankCont = document.getElementById('rankingContainer');
        if(rankCont) rankCont.innerHTML = "<div class='p-4 text-center text-slate-500 font-bold'>데이터를 불러오는 중이거나 데이터가 없습니다.</div>";
        return;
    }

    rankArray.forEach((user, index) => {
        let medal = medals[index] || "🏅";
        let color = user.totalReturnPct >= 0 ? "text-red-500" : "text-blue-500";
        rankHtml += `<div class="bg-white p-4 rounded-xl shadow-sm border ${index===0?'border-yellow-400 ring-2 ring-yellow-200':'border-orange-100'} flex items-center justify-between"><div class="flex items-center gap-3"><span class="text-3xl">${medal}</span><div><h3 class="font-extrabold text-slate-800">${user.name}</h3><p class="text-xs text-slate-400">실보유 자산 ₩${Math.round(user.totalCurrent).toLocaleString()}</p></div></div><div class="text-right"><div class="text-xl font-black mono ${color}">${user.totalReturnPct > 0 ? '+':''}${user.totalReturnPct.toFixed(2)}%</div></div></div>`;

        let rowsHtml = "";
        user.items.filter(item => item.qty > 0).forEach(item => {
            let returnPct = ((item.current - item.invest) / item.invest * 100) || 0;
            rowsHtml += `<tr class="border-b border-slate-50 hover:bg-slate-50 text-xs"><td class="py-3 font-bold text-slate-700">${item.stock}</td><td class="py-3 text-right mono"><div class="text-[10px] text-slate-400">평단 ₩${Math.round(item.avgPrice).toLocaleString()}</div><div class="font-bold text-slate-700">현재 ₩${Math.round(item.currPrice).toLocaleString()}</div></td><td class="py-3 text-right mono text-slate-500">${item.qty}주</td><td class="py-3 text-right mono font-bold ${returnPct>=0?'text-red-500':'text-blue-500'}">${returnPct>0?'+':''}${returnPct.toFixed(2)}%</td><td class="py-3 text-right mono font-bold text-slate-800">₩${Math.round(item.current).toLocaleString()}</td></tr>`;
        });
        cardsHtml += `<div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"><div class="p-5 bg-slate-50 border-b border-slate-200"><h4 class="font-black text-lg text-slate-800"><i class="fas fa-user-circle text-slate-400 mr-2"></i>투자자 ${user.name}의 실보유 현황</h4></div><div class="p-4 overflow-x-auto"><table class="w-full text-left whitespace-nowrap"><tbody>${rowsHtml}</tbody></table></div></div>`;
    });

    const rankCont = document.getElementById('rankingContainer');
    const cardsCont = document.getElementById('personalCardsContainer');
    if(rankCont) rankCont.innerHTML = rankHtml;
    if(cardsCont) cardsCont.innerHTML = cardsHtml;
}
