// ---------------------------------------------------------
// 2. 1달러 생산성 스캐너 렌더링
// ---------------------------------------------------------
function renderDollarTable() {
    const tbody = document.getElementById('dollar-table-body');
    if(!tbody || dollarApp.masterData.length <= 1) return;
    
    const isLimitFilter = document.getElementById('filter-limit') ? document.getElementById('filter-limit').checked : false;
    const isDecimalFilter = document.getElementById('filter-decimal') ? document.getElementById('filter-decimal').checked : false;

    let tableData = [];
    for (let i = 1; i < dollarApp.masterData.length; i++) {
        const row = dollarApp.masterData[i];
        if (!row || row.length < 5) continue;

        const ticker = (row[1] || '').trim();
        const name = (row[2] || '').trim();
        const price = getLivePrice(ticker); 
        const limit = row[11] || 'X';
        const decimal = row[12] || 'O';
        
        if (!ticker || price <= 0) continue;

        // 동진님 시트의 G열(인덱스 6)과 H열(인덱스 7) 다이렉트 연동
        const efficiency_usd = cleanNumber(row[6]); 
        const efficiency_krw = cleanNumber(row[7]); 

        tableData.push({ 
            displayName: `${ticker} <span class="text-xs text-slate-400 ml-1">(${name})</span>`, 
            price: price, 
            efficiency: efficiency_usd, 
            efficiency_krw: efficiency_krw,
            limit: limit, 
            decimal: decimal 
        });
    }

    if (isLimitFilter) tableData = tableData.filter(d => d.limit === 'X');
    if (isDecimalFilter) tableData = tableData.filter(d => d.decimal === 'O');

    tableData.sort((a, b) => {
        let valA = a[dollarApp.sortKey];
        let valB = b[dollarApp.sortKey];
        return dollarApp.sortAsc ? valA - valB : valB - valA;
    });

    tbody.innerHTML = '';
    tableData.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors border-b border-slate-50";
        let rankBadge = idx === 0 ? '<i class="fas fa-crown text-yellow-500 mr-1"></i>' : (idx === 1 ? '<i class="fas fa-medal text-slate-400 mr-1"></i>' : (idx === 2 ? '<i class="fas fa-medal text-orange-400 mr-1"></i>' : ''));

        // 🔥 반올림(toFixed)을 제거하여 시트의 소수점 원본 값을 100% 그대로 표출합니다!
        tr.innerHTML = `
            <td class="px-4 py-3 font-bold text-slate-800">${rankBadge}${item.displayName}</td>
            <td class="px-4 py-3 text-right font-mono text-slate-600">$${item.price.toFixed(2)}</td>
            <td class="px-4 py-3 text-right font-mono font-bold text-slate-700 bg-slate-50/50">$${item.efficiency} <span class="text-[10px] text-slate-400 font-normal">(G열)</span></td>
            <td class="px-4 py-3 text-right font-mono font-black text-blue-600 bg-blue-50/30">${item.efficiency_krw}원 <span class="text-[10px] text-slate-400 font-normal">(H열)</span></td>
            <td class="px-4 py-3 text-center text-xs font-bold ${item.limit === 'X' ? 'text-green-600' : 'text-red-500'}">${item.limit}</td>
            <td class="px-4 py-3 text-center text-xs font-bold ${item.decimal === 'O' ? 'text-blue-600' : 'text-slate-400'}">${item.decimal}</td>
        `;
        tbody.appendChild(tr);
    });
}
