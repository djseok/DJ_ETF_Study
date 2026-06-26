async function loadPortfolioData(currentTab) {
    try {
        const res = await fetch(PORTFOLIO_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        const users = {};
        for(let i=1; i<matrix.length; i++) {
            if(matrix[i].length < 6) continue;
            let name = matrix[i][0].trim();
            let stock = matrix[i][1].trim();
            let targetWeight = parseFloat(String(matrix[i][2]).replace(/,/g, '')) || 0;
            let avgPrice = parseFloat(String(matrix[i][3]).replace(/,/g, '')) || 0;
            let qty = parseFloat(String(matrix[i][4]).replace(/,/g, '')) || 0;
            let currPrice = parseFloat(String(matrix[i][5]).replace(/,/g, '')) || avgPrice;

            if(!name || name === "이름") continue;
            if(!users[name]) users[name] = { name: name, totalInvest: 0, totalCurrent: 0, items: [] };

            let invest = avgPrice * qty;
            let current = currPrice * qty;
            if(qty > 0) { users[name].totalInvest += invest; users[name].totalCurrent += current; }
            if(targetWeight > 0) { users[name].items.push({ stock, targetWeight, avgPrice, currPrice, qty, invest, current }); }
        }
        globalParsedUsers = users;

        let rankArray = Object.values(users).filter(u => u.totalInvest > 0).map(u => {
            u.totalReturnPct = ((u.totalCurrent - u.totalInvest) / u.totalInvest * 100) || 0;
            return u;
        }).sort((a,b) => b.totalReturnPct - a.totalReturnPct);

        if(currentTab === 'port') renderPortfolioView(rankArray);
        if(currentTab === 'calc') renderCalculatorView();
        if(currentTab === 'conc') initConcentrationView();
        if(currentTab === 'div') {
            await loadDividendHistoryData();
            await loadActualDividendData();
        }
    } catch (e) { console.error("포트폴리오 로드 실패:", e); }
}

function renderPortfolioView(rankArray) {
    let rankHtml = "", cardsHtml = "";
    const medals = ["🥇", "🥈", "🥉"];
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
    document.getElementById('rankingContainer').innerHTML = rankHtml;
    document.getElementById('personalCardsContainer').innerHTML = cardsHtml;
}
