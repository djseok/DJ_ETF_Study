// =====================================================
// 🏆 포트폴리오 & 배당 일지 동시 로드 모듈 (V16.0 하드코어 패치)
// =====================================================

// 포트폴리오 CSV는 페이지를 열 때 한 번만 받아서 재사용합니다. (탭 이동마다 다시 받지 않음)
var portfolioLoadPromise = null;
var portfolioRankArray = [];
var portfolioSkippedDividendRows = []; // 이름(H열)이 비어서 집계에서 빠진 배당 기록

async function loadPortfolioData(currentTab, forceReload) {
    try {
        if (!portfolioLoadPromise || forceReload) {
            portfolioLoadPromise = fetchAndParsePortfolio();
        }
        await portfolioLoadPromise;

        // 탭 상태에 따라 화면 그리기
        if(currentTab === 'port') renderPortfolioView(portfolioRankArray);
    } catch (e) {
        portfolioLoadPromise = null; // 실패하면 다음 번에 다시 시도
        console.error("포트폴리오 및 배당금 로드 실패:", e);
    }
}

async function fetchAndParsePortfolio() {
        const res = await fetch(PORTFOLIO_CSV_URL);
        const matrix = parseCsvToMatrix(await res.text());
        
        const users = {}; // A~F 포트폴리오 데이터 보관함
        const divLogs = []; // H~L 실수령 배당금 보관함
        const skippedDivRows = [];

        // 첫 번째 줄(헤더)은 건너뛰고 인덱스 1부터 바로 읽기 시작합니다.
        for(let i = 1; i < matrix.length; i++) {
            let row = matrix[i];
            if(row.length < 3) continue;

            // --------------------------------------------------
            // ⚔️ [1] 포트폴리오 파싱 (A~F열: 인덱스 0~5)
            // --------------------------------------------------
            let pName = String(row[0] || "").trim();
            let pStock = String(row[1] || "").trim();
            let pWeightStr = String(row[2] || "").replace(/[^0-9.]/g, '');
            let pAvgPriceStr = String(row[3] || "").replace(/[^0-9.]/g, '');
            let pQtyStr = String(row[4] || "").replace(/[^0-9.-]/g, '');
            let pCurrPriceStr = String(row[5] || "").replace(/[^0-9.]/g, '');

            // 목표 비중 → 0~1 비율. '60.00%' 처럼 % 가 있으면 항상 ÷100 (예: '1%' = 0.01), % 없이 1 넘는 숫자는 퍼센트로 봄
            let pWeight = parseFloat(pWeightStr) || 0;
            if (String(row[2] || "").includes('%') || pWeight > 1) pWeight = pWeight / 100;
            let pAvgPrice = parseFloat(pAvgPriceStr) || 0;
            let pQty = parseFloat(pQtyStr) || 0;
            let pCurrPrice = parseFloat(pCurrPriceStr) || pAvgPrice;

            // 이름과 종목이 정상적으로 있는 줄만 포트폴리오로 취급
            if (pName && pStock && !pName.includes("이름") && !pStock.includes("종목")) {
                if(!users[pName]) users[pName] = { name: pName, totalInvest: 0, totalCurrent: 0, items: [] };

                let invest = pAvgPrice * pQty;
                let current = pCurrPrice * pQty;

                if(pQty > 0) {
                    users[pName].totalInvest += invest;
                    users[pName].totalCurrent += current;
                }
                users[pName].items.push({ 
                    stock: pStock, targetWeight: pWeight, avgPrice: pAvgPrice, 
                    currPrice: pCurrPrice, qty: pQty, invest: invest, current: current 
                });
            }

            // --------------------------------------------------
            // ⚔️ [2] 배당금 실수령 파싱 (H~L열: 인덱스 7~11)
            // --------------------------------------------------
            // CSV 특성상 뒤쪽 열이 비어있으면 배열 길이가 짧을 수 있으므로 방어 로직 추가
            if (row.length >= 9) {
                let dName = String(row[7] || "").trim();
                let dDate = String(row[8] || "").trim();
                let dStock = String(row[9] || "").trim();
                let dQtyStr = String(row[10] || "").replace(/[^0-9.-]/g, '');
                let dAmountStr = String(row[11] || "").replace(/[^0-9.-]/g, '');

                let dQty = parseFloat(dQtyStr) || 0;
                let dAmount = parseFloat(dAmountStr) || 0;

                if (dDate && !dDate.includes("수령일자")) {
                    if (!dName) {
                        // 날짜는 있는데 이름이 비어 있으면 누구 것인지 알 수 없어 제외하고 기록해 둡니다
                        skippedDivRows.push({ sheetRow: i + 1, date: dDate, stock: dStock, amount: dAmount });
                    } else if (!dName.includes("이름")) {
                        let dateInfo = (typeof parseCustomDate === 'function') ? parseCustomDate(dDate) : { month: 0, jsDate: new Date(0) };
                        divLogs.push({
                            userName: dName, date: dDate, stockName: dStock, qty: dQty, amount: dAmount,
                            parsedMonth: dateInfo.month, jsDate: dateInfo.jsDate, year: dateInfo.jsDate.getFullYear()
                        });
                    }
                }
            }
        }

        // 전역 변수에 파싱된 데이터 저장 (다른 파일에서도 접근 가능하도록)
        globalParsedUsers = users;
        globalActualDividendLogs = divLogs; 
        portfolioSkippedDividendRows = skippedDivRows;
        if (skippedDivRows.length > 0) {
            console.warn("⚠️ 이름(H열)이 비어 있어 집계에서 제외된 배당 기록:", skippedDivRows);
        }

        // 수익률 계산 및 명예의 전당(랭킹) 정렬
        portfolioRankArray = Object.values(users).filter(u => u.totalInvest > 0).map(u => {
            u.totalReturnPct = ((u.totalCurrent - u.totalInvest) / u.totalInvest * 100) || 0;
            return u;
        }).sort((a,b) => b.totalReturnPct - a.totalReturnPct);
}

function renderPortfolioView(rankArray) {
    let rankHtml = "", cardsHtml = "";
    const medals = ["🥇", "🥈", "🥉"];

    if(!rankArray || rankArray.length === 0) {
        const rankCont = document.getElementById('rankingContainer');
        if(rankCont) rankCont.innerHTML = "<div class='p-4 text-center text-slate-500 font-bold'>데이터를 불러오는 중이거나 데이터가 없습니다.</div>";
        return;
    }

    // 과세표준 기록이 아직 없으면 먼저 받아온 뒤 다시 그림 (배당 포함 수익률의 세금 계산용)
    if (typeof loadDivHistory === 'function' && divHistoryByKey === null) {
        loadDivHistory().then(function () { renderPortfolioView(rankArray); });
    }

    // 보기 선택: 전체 또는 한 멤버 (이 기기에 기억)
    let pick = 'ALL';
    try { pick = localStorage.getItem('djPortMember') || 'ALL'; } catch (e) { }
    if (pick !== 'ALL' && !rankArray.some(u => u.name === pick)) pick = 'ALL';
    const filterBox = document.getElementById('portMemberFilter');
    if (filterBox) {
        filterBox.innerHTML = ['ALL'].concat(rankArray.map(u => u.name)).map(n =>
            `<button onclick="setPortMember('${n}')" class="px-3 py-1.5 rounded-full text-xs font-bold ${n === pick ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}">${n === 'ALL' ? '전체' : n}</button>`).join('');
    }
    const won = v => (v < 0 ? '−' : '') + '₩' + Math.abs(Math.round(v)).toLocaleString();
    const pct = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    const clr = v => v >= 0 ? 'text-red-500' : 'text-blue-500';

    rankArray.forEach((user, index) => {
        let medal = medals[index] || "🏅";
        // 배당 미포함(가격만) vs 배당 포함 — 둘 다 계산
        const dv = (typeof divTotalsFor === 'function') ? divTotalsFor(user.name) : { net: 0, gross: 0, count: 0 };
        const pricePL = user.totalCurrent - user.totalInvest;
        const withDivPL = pricePL + dv.net;
        const withDivPct = user.totalInvest > 0 ? withDivPL / user.totalInvest * 100 : 0;
        user.totalReturnWithDivPct = withDivPct;
        if (pick !== 'ALL' && user.name !== pick) return;

        rankHtml += `<div class="bg-white p-4 rounded-xl shadow-sm border ${index===0?'border-yellow-400 ring-2 ring-yellow-200':'border-orange-100'}">
            <div class="flex items-center justify-between"><div class="flex items-center gap-3"><span class="text-3xl">${medal}</span><div><h3 class="font-extrabold text-slate-800">${user.name}</h3><p class="text-xs text-slate-400">평가액 ${won(user.totalCurrent)}</p></div></div>
            <div class="text-right"><div class="text-[10px] font-bold text-slate-400">배당 미포함</div><div class="text-xl font-black mono ${clr(user.totalReturnPct)}">${pct(user.totalReturnPct)}</div></div></div>
            <div class="mt-2 pt-2 border-t border-orange-50 flex justify-between text-xs"><span class="text-slate-400 font-bold">배당 포함</span><span class="font-black mono ${clr(withDivPct)}">${pct(withDivPct)}</span></div></div>`;

        let rowsHtml = "";
        user.items.filter(item => item.qty > 0).forEach(item => {
            let returnPct = ((item.current - item.invest) / item.invest * 100) || 0;
            rowsHtml += `<tr class="border-b border-slate-50 hover:bg-slate-50 text-xs"><td class="py-3 font-bold text-slate-700">${item.stock}</td><td class="py-3 text-right mono"><div class="text-[10px] text-slate-400">평단 ₩${Math.round(item.avgPrice).toLocaleString()}</div><div class="font-bold text-slate-700">현재 ₩${Math.round(item.currPrice).toLocaleString()}</div></td><td class="py-3 text-right mono text-slate-500">${item.qty}주</td><td class="py-3 text-right mono font-bold ${returnPct>=0?'text-red-500':'text-blue-500'}">${returnPct>0?'+':''}${returnPct.toFixed(2)}%</td><td class="py-3 text-right mono font-bold text-slate-800">₩${Math.round(item.current).toLocaleString()}</td></tr>`;
        });
        // 요약: 투자원금 · 평가액 · 손익(배당 미포함) · 받은 배당(세후) · 손익(배당 포함)
        const cell = (label, val, sub, cls) => `<div class="p-3 rounded-xl bg-white border border-slate-100"><div class="text-[11px] font-bold text-slate-400">${label}</div><div class="text-base font-black mono ${cls || 'text-slate-800'}">${val}</div>${sub ? `<div class="text-[11px] font-bold mono ${cls || 'text-slate-400'}">${sub}</div>` : ''}</div>`;
        const summary = `<div class="grid grid-cols-2 md:grid-cols-5 gap-2 p-4 bg-slate-50/60 border-b border-slate-100">
            ${cell('투자원금', won(user.totalInvest))}
            ${cell('평가액', won(user.totalCurrent))}
            ${cell('손익 (배당 미포함)', won(pricePL), pct(user.totalReturnPct), clr(pricePL))}
            ${cell('받은 배당 (세후)', won(dv.net), dv.count ? '세전 ' + won(dv.gross) + ' · ' + dv.count + '회' : '기록 없음', 'text-emerald-600')}
            ${cell('손익 (배당 포함)', won(withDivPL), pct(withDivPct), clr(withDivPL))}
        </div>`;
        cardsHtml += `<div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"><div class="p-5 bg-slate-50 border-b border-slate-200"><div class="flex items-center justify-between gap-2"><h4 class="font-black text-lg text-slate-800"><i class="fas fa-user-circle text-slate-400 mr-2"></i>투자자 ${user.name}의 실보유 현황</h4><button onclick="openUpload('${user.name}')" class="shrink-0 px-3 py-1.5 rounded-full bg-slate-800 text-white text-xs font-bold hover:bg-slate-700">📸 잔고 업데이트</button></div></div>${summary}<div class="p-4 overflow-x-auto"><table class="w-full text-left whitespace-nowrap"><tbody>${rowsHtml}</tbody></table></div></div>`;
    });

    const rankCont = document.getElementById('rankingContainer');
    const cardsCont = document.getElementById('personalCardsContainer');
    if(rankCont) rankCont.innerHTML = rankHtml;
    if(cardsCont) cardsCont.innerHTML = cardsHtml;
}

// 메인 화면 보기 선택 (전체 / 멤버 한 명)
function setPortMember(name) {
    try { localStorage.setItem('djPortMember', name); } catch (e) { }
    renderPortfolioView(portfolioRankArray);
}
