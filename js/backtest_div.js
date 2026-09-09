// =========================================================
// 📜 배당투자설계도 & 10년 복리 시뮬레이터 (js/backtest_div.js)
// =========================================================

const BACKTEST_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=795942259&single=true&output=csv";
let simEtfDatabase = {};
let isDivDataLoaded = false;
const SLOT_COUNT = 5;
let div10YearChartInstance = null;

const fmtNum = (num) => {
    const parsed = parseFloat(num);
    if (isNaN(parsed) || !isFinite(parsed)) return "0";
    return new Intl.NumberFormat('ko-KR').format(Math.floor(parsed));
};

const getNum = (str) => {
    if (!str) return 0;
    const cleaned = parseFloat(String(str).replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return isNaN(cleaned) || !isFinite(cleaned) ? 0 : cleaned;
};

async function fetchBacktestMasterData() {
    if (isDivDataLoaded) return;

    try {
        const response = await fetch(BACKTEST_DIV_CSV_URL + "&t=" + new Date().getTime());
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        
        simEtfDatabase = {}; // 초기화

        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].split(',');
            if (columns.length >= 6) {
                const name = columns[0].trim();
                const price = getNum(columns[1]);
                const minDiv = getNum(columns[2]);
                const avgDiv = getNum(columns[3]);
                const maxDiv = getNum(columns[4]);
                const taxBase = getNum(columns[5]);

                // 가격이 정상적일 때만 등록 (NaN / 무한대 방어)
                if (name && price > 0) {
                    simEtfDatabase[name] = { price, minDiv, avgDiv, maxDiv, taxBase };
                }
            }
        }
        
        generateSlots();
        isDivDataLoaded = true;
        setupEventListeners();
        runPortfolioSimulator();

    } catch (error) {
        console.error("배당 시뮬레이터 데이터 로딩 실패:", error);
    }
}

function generateSlots() {
    const container = document.getElementById('simSlotsContainer');
    if (!container) return;
    let html = '';
    
    let optionsHtml = `<option value="">선택 안 함 (비워둠)</option>`;
    for (const [name, data] of Object.entries(simEtfDatabase)) {
        optionsHtml += `<option value="${name}">${name} (₩${fmtNum(data.price)})</option>`;
    }

    for (let i = 1; i <= SLOT_COUNT; i++) {
        html += `
            <div class="grid grid-cols-12 gap-3 items-center bg-slate-50 p-2 rounded-lg border border-slate-200 shadow-sm transition hover:bg-slate-100">
                <div class="col-span-5">
                    <select id="simSlotEtf${i}" class="w-full bg-white border border-slate-300 text-slate-800 text-sm font-bold rounded-lg p-2.5 focus:ring-indigo-500 outline-none shadow-sm cursor-pointer" onchange="runPortfolioSimulator()">
                        ${optionsHtml}
                    </select>
                </div>
                <div class="col-span-3 relative">
                    <input type="number" id="simSlotRatio${i}" placeholder="0" class="w-full bg-white border border-slate-300 text-slate-800 text-sm font-black rounded-lg p-2.5 text-center focus:ring-indigo-500 outline-none shadow-sm" oninput="syncFromRatio(${i})">
                    <span class="absolute right-3 top-2.5 text-slate-400 text-sm font-bold">%</span>
                </div>
                <div class="col-span-4 relative">
                    <input type="text" id="simSlotAmount${i}" placeholder="0" class="w-full bg-white border border-slate-300 text-slate-800 text-sm font-black rounded-lg p-2.5 text-right focus:ring-indigo-500 outline-none shadow-sm font-mono" oninput="syncFromAmount(${i})">
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

function syncFromRatio(index) {
    const totalAsset = getNum(document.getElementById('simTotalAsset').value);
    const ratioInput = document.getElementById(`simSlotRatio${index}`);
    const amountInput = document.getElementById(`simSlotAmount${index}`);
    
    let ratio = parseFloat(ratioInput.value) || 0;
    if (ratio > 100) { ratio = 100; ratioInput.value = 100; }
    
    let amount = totalAsset * (ratio / 100);
    amountInput.value = fmtNum(amount);
    runPortfolioSimulator();
}

function syncFromAmount(index) {
    const totalAsset = getNum(document.getElementById('simTotalAsset').value);
    const ratioInput = document.getElementById(`simSlotRatio${index}`);
    const amountInput = document.getElementById(`simSlotAmount${index}`);
    
    let amount = getNum(amountInput.value);
    amountInput.value = amount > 0 ? fmtNum(amount) : '';
    
    if (totalAsset > 0) {
        let ratio = (amount / totalAsset) * 100;
        ratioInput.value = parseFloat(ratio.toFixed(2));
    } else {
        ratioInput.value = 0;
    }
    runPortfolioSimulator();
}

function syncAllFromTotal() {
    const totalInput = document.getElementById('simTotalAsset');
    let totalAsset = getNum(totalInput.value);
    totalInput.value = totalAsset > 0 ? fmtNum(totalAsset) : '';

    for (let i = 1; i <= SLOT_COUNT; i++) {
        const ratio = parseFloat(document.getElementById(`simSlotRatio${i}`).value) || 0;
        document.getElementById(`simSlotAmount${i}`).value = fmtNum(totalAsset * (ratio / 100));
    }
    runPortfolioSimulator();
}

function runPortfolioSimulator() {
    let totalInvestedAmount = 0;
    let totalRatio = 0;
    let sumMonthlyGrossDiv = 0;
    let sumMonthlyTaxBase = 0;
    let breakdownHtml = '';
    
    const tableHeader = document.querySelector('#simBreakdownTableBody');
    if (!tableHeader) return;

    tableHeader.previousElementSibling.innerHTML = `
        <tr>
            <th class="px-5 py-3">종목명</th>
            <th class="px-5 py-3 text-right">매수 수량</th>
            <th class="px-5 py-3 text-right text-red-500 bg-red-50/30">월 발생 과세표준</th>
            <th class="px-5 py-3 text-right text-slate-500 bg-slate-50 border-l border-slate-200">월 최소 배당</th>
            <th class="px-5 py-3 text-right text-blue-600 bg-blue-50/30 font-extrabold">월 평균 배당</th>
            <th class="px-5 py-3 text-right text-emerald-600 bg-emerald-50/30">월 최대 배당</th>
        </tr>
    `;

    for (let i = 1; i <= SLOT_COUNT; i++) {
        const etfSelect = document.getElementById(`simSlotEtf${i}`);
        if (!etfSelect) continue;
        const etfName = etfSelect.value;
        const amount = getNum(document.getElementById(`simSlotAmount${i}`).value);
        const ratio = parseFloat(document.getElementById(`simSlotRatio${i}`).value) || 0;

        totalInvestedAmount += amount;
        totalRatio += ratio;

        if (etfName && amount > 0 && simEtfDatabase[etfName]) {
            const etf = simEtfDatabase[etfName];
            const price = etf.price > 0 ? etf.price : 1;
            const shares = Math.floor(amount / price);
            
            const monthlyGrossDiv = shares * etf.avgDiv;
            const monthlyTaxBase = shares * etf.taxBase;
            const minGrossDiv = shares * etf.minDiv;
            const maxGrossDiv = shares * etf.maxDiv;

            sumMonthlyGrossDiv += monthlyGrossDiv;
            sumMonthlyTaxBase += monthlyTaxBase;

            breakdownHtml += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-5 py-3 font-bold text-slate-800">${etfName}</td>
                    <td class="px-5 py-3 text-right font-mono">${fmtNum(shares)}주</td>
                    <td class="px-5 py-3 text-right font-mono text-red-500 bg-red-50/20">${fmtNum(monthlyTaxBase)}원</td>
                    <td class="px-5 py-3 text-right font-mono text-slate-500 border-l border-slate-100">${fmtNum(minGrossDiv)}원</td>
                    <td class="px-5 py-3 text-right font-mono text-blue-600 bg-blue-50/20 font-black">${fmtNum(monthlyGrossDiv)}원</td>
                    <td class="px-5 py-3 text-right font-mono text-emerald-600 bg-emerald-50/20">${fmtNum(maxGrossDiv)}원</td>
                </tr>
            `;
        }
    }

    const statusEl = document.getElementById('simAllocatedStatus');
    if (statusEl) {
        statusEl.textContent = `${totalRatio.toFixed(1)}% / ${fmtNum(totalInvestedAmount)}원`;
        statusEl.className = totalRatio > 100 ? "text-red-600 font-black mono text-base" : "text-indigo-600 font-black mono text-base";
    }

    if (breakdownHtml === '') {
        tableHeader.innerHTML = `<tr><td colspan="6" class="p-5 text-center text-slate-400 font-bold">자산을 배분하면 명세서가 나타납니다.</td></tr>`;
    } else {
        tableHeader.innerHTML = breakdownHtml;
    }
    
    tableHeader.nextElementSibling.innerHTML = `
        <tr>
            <td class="px-5 py-3 text-center">합계</td>
            <td class="px-5 py-3 text-right">-</td>
            <td id="simTotalTaxBase" class="px-5 py-3 text-right text-red-600 mono bg-red-50/50">${fmtNum(sumMonthlyTaxBase)}원</td>
            <td class="px-5 py-3 text-right">-</td>
            <td id="simTotalGrossDiv" class="px-5 py-3 text-right text-blue-600 mono font-black bg-blue-50/30">${fmtNum(sumMonthlyGrossDiv)}원</td>
            <td class="px-5 py-3 text-right">-</td>
        </tr>
    `;

    // 일반계좌 비교
    const genAnnualTaxBase = sumMonthlyTaxBase * 12;
    const genMonthlyTax = sumMonthlyTaxBase * 0.154;
    const genMonthlyNetDiv = sumMonthlyGrossDiv - genMonthlyTax;
    const genAnnualTax = genMonthlyTax * 12;

    document.getElementById('simGenNetAvg').textContent = fmtNum(genMonthlyNetDiv) + "원";
    document.getElementById('simGenAnnualTaxBase').textContent = fmtNum(genAnnualTaxBase) + "원";
    document.getElementById('simGenAnnualTax').textContent = "-" + fmtNum(genAnnualTax) + "원";

    const warningBox = document.getElementById('simMedicareWarning');
    if (warningBox) {
        if (genAnnualTaxBase > 10000000) {
            warningBox.className = "text-center py-2.5 rounded-lg font-black text-sm bg-red-100 text-red-700 border border-red-200 mt-2 shadow-sm";
            warningBox.innerHTML = "⚠️ 건보료 피부양자 탈락 (과표 1천만 원 초과)";
        } else {
            warningBox.className = "text-center py-2.5 rounded-lg font-black text-sm bg-emerald-100 text-emerald-700 border border-emerald-200 mt-2 shadow-sm";
            warningBox.innerHTML = "✅ 피부양자 자격 안전 (1천만 원 이하)";
        }
    }

    // ISA 계좌 비교
    const isaAnnualGross = sumMonthlyGrossDiv * 12;
    const isaAnnualTaxable = sumMonthlyTaxBase * 12;
    const isaTax = isaAnnualTaxable > 2000000 ? (isaAnnualTaxable - 2000000) * 0.099 : 0;
    const isaMonthlyNet = (isaAnnualGross - isaTax) / 12;

    document.getElementById('simIsaNetAvg').textContent = fmtNum(isaMonthlyNet) + "원";
    document.getElementById('simIsaAnnualGross').textContent = fmtNum(isaAnnualGross) + "원";
    document.getElementById('simIsaTax').textContent = "-" + fmtNum(isaTax) + "원";

    update10YearChart(totalInvestedAmount, genMonthlyNetDiv);
}

function update10YearChart(initialInvestment, monthlyNetDiv) {
    if (initialInvestment <= 0) return;

    const kospi = parseFloat(document.getElementById('cagrKospi')?.value) || 3;
    const kosdaq = parseFloat(document.getElementById('cagrKosdaq')?.value) || 4;
    const ndx = parseFloat(document.getElementById('cagrNdx')?.value) || 15;
    const spy = parseFloat(document.getElementById('cagrSpy')?.value) || 10;
    const cagrBase = parseFloat(document.getElementById('cagrBase')?.value) || 0;
    
    const qld = (ndx * 2) - 5;
    const tqqq = (ndx * 3) - 12;
    const sso = (spy * 2) - 3;
    const upro = (spy * 3) - 8;

    const isDrip = document.querySelector('input[name="dripOption"]:checked')?.value === 'drip';
    const dripTarget = document.getElementById('dripTarget')?.value;

    let targetCagr = ndx;
    if (dripTarget === 'ndx') targetCagr = ndx;
    else if (dripTarget === 'qld') targetCagr = qld;
    else if (dripTarget === 'tqqq') targetCagr = tqqq;
    else if (dripTarget === 'spy') targetCagr = spy;
    else if (dripTarget === 'sso') targetCagr = sso;
    else if (dripTarget === 'upro') targetCagr = upro;
    else if (dripTarget === 'kospi') targetCagr = kospi;
    else if (dripTarget === 'kosdaq') targetCagr = kosdaq;

    const labels = [];
    const dataNdx = [];
    const dataQld = [];
    const dataTqqq = [];
    const dataSpy = [];
    const dataPortfolio = [];

    for (let year = 0; year <= 10; year++) {
        labels.push(`${year}년차`);
        
        dataNdx.push(Math.floor(initialInvestment * Math.pow(1 + ndx / 100, year)));
        dataQld.push(Math.floor(initialInvestment * Math.pow(1 + qld / 100, year)));
        dataTqqq.push(Math.floor(initialInvestment * Math.pow(1 + tqqq / 100, year)));
        dataSpy.push(Math.floor(initialInvestment * Math.pow(1 + spy / 100, year)));

        let portValue = 0;
        if (!isDrip) {
            portValue = initialInvestment * Math.pow(1 + cagrBase / 100, year);
        } else {
            let principal = initialInvestment * Math.pow(1 + cagrBase / 100, year);
            let reinvestBucket = 0;
            let monthlyTargetRate = Math.pow(1 + targetCagr / 100, 1 / 12) - 1;
            let totalMonths = year * 12;
            
            for (let m = 1; m <= totalMonths; m++) {
                reinvestBucket = reinvestBucket * (1 + monthlyTargetRate) + monthlyNetDiv;
            }
            portValue = principal + reinvestBucket;
        }
        dataPortfolio.push(Math.floor(portValue));
    }

    const canvasEl = document.getElementById('div10YearChart');
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (div10YearChartInstance) div10YearChartInstance.destroy();

    div10YearChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `내 배당 포트 (${isDrip ? '배당 100% 재투자' : '배당 전액 소모'})`,
                    data: dataPortfolio,
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    borderWidth: 4,
                    pointRadius: 4,
                    tension: 0.3,
                    fill: true,
                    order: 1
                },
                {
                    label: 'TQQQ (나스닥 3배)',
                    data: dataTqqq,
                    borderColor: '#f97316',
                    borderWidth: 2,
                    borderDash: [3, 3],
                    pointRadius: 0,
                    tension: 0.3,
                    order: 2
                },
                {
                    label: 'QLD (나스닥 2배)',
                    data: dataQld,
                    borderColor: '#eab308',
                    borderWidth: 2,
                    borderDash: [3, 3],
                    pointRadius: 0,
                    tension: 0.3,
                    order: 3
                },
                {
                    label: 'QQQ (나스닥 100)',
                    data: dataNdx,
                    borderColor: '#0ea5e9',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    order: 4
                },
                {
                    label: 'SPY (S&P 500)',
                    data: dataSpy,
                    borderColor: '#64748b',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    order: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { font: { weight: 'bold' } } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + fmtNum(context.parsed.y) + '원';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            if(value >= 100000000) return (value / 100000000).toFixed(1) + '억';
                            if(value >= 10000) return (value / 10000).toFixed(0) + '만';
                            return value;
                        },
                        font: { weight: 'bold' }
                    },
                    grid: { color: '#f1f5f9' }
                },
                x: { grid: { display: false }, ticks: { font: { weight: 'bold' } } }
            }
        }
    });
}

function setupEventListeners() {
    const totalInput = document.getElementById('simTotalAsset');
    if(totalInput) totalInput.addEventListener('input', syncAllFromTotal);

    const cagrInputs = ['cagrKospi', 'cagrKosdaq', 'cagrNdx', 'cagrQld', 'cagrTqqq', 'cagrSpy', 'cagrSso', 'cagrUpro', 'cagrBase'];
    cagrInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', runPortfolioSimulator);
    });

    const dripOptions = document.querySelectorAll('input[name="dripOption"]');
    const dripTargetSelect = document.getElementById('dripTarget');

    dripOptions.forEach(opt => {
        opt.addEventListener('change', (e) => {
            if(dripTargetSelect) dripTargetSelect.disabled = e.target.value !== 'drip';
            runPortfolioSimulator();
        });
    });

    if(dripTargetSelect) dripTargetSelect.addEventListener('change', runPortfolioSimulator);
}
