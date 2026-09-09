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

function formatMonthlyAdd() {
    const el = document.getElementById('simMonthlyAdd');
    if (!el) return;
    let val = getNum(el.value);
    el.value = val > 0 ? fmtNum(val) : '0';
    runPortfolioSimulator();
}

function parseCSV(str) {
    const arr = [];
    let quote = false;
    let row = 0, col = 0;
    for (let c = 0; c < str.length; c++) {
        let cc = str[c], nc = str[c+1];
        arr[row] = arr[row] || [];
        arr[row][col] = arr[row][col] || '';

        if (cc == '"' && quote && nc == '"') { arr[row][col] += cc; ++c; continue; }
        if (cc == '"') { quote = !quote; continue; }
        if (cc == ',' && !quote) { ++col; continue; }
        if (cc == '\r' && nc == '\n' && !quote) { ++row; col = 0; ++c; continue; }
        if (cc == '\n' && !quote) { ++row; col = 0; continue; }
        if (cc == '\r' && !quote) { ++row; col = 0; continue; }

        arr[row][col] += cc;
    }
    return arr;
}

async function fetchBacktestMasterData() {
    if (isDivDataLoaded) return;

    try {
        const targetUrl = BACKTEST_DIV_CSV_URL + "&t=" + new Date().getTime();
        const response = await fetch(targetUrl);
        const csvText = await response.text();
        
        const lines = parseCSV(csvText);
        simEtfDatabase = {}; 

        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i];
            if (columns && columns.length >= 2) {
                const name = (columns[0] || '').trim();
                const price = getNum(columns[1]);
                const minDiv = getNum(columns[2]);
                const avgDiv = getNum(columns[3]);
                const maxDiv = getNum(columns[4]);
                const taxBase = getNum(columns[5]);

                if (name !== "") {
                    simEtfDatabase[name] = { 
                        price: price > 0 ? price : 1,
                        minDiv: minDiv || 0,
                        avgDiv: avgDiv || 0,
                        maxDiv: maxDiv || 0,
                        taxBase: taxBase || 0
                    };
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
    const totalAsset = getNum(document.getElementById('simTotalAsset')?.value);
    const ratioInput = document.getElementById(`simSlotRatio${index}`);
    const amountInput = document.getElementById(`simSlotAmount${index}`);
    
    let ratio = parseFloat(ratioInput.value) || 0;
    if (ratio > 100) { ratio = 100; ratioInput.value = 100; }
    
    let amount = totalAsset * (ratio / 100);
    amountInput.value = fmtNum(amount);
    runPortfolioSimulator();
}

function syncFromAmount(index) {
    const totalAsset = getNum(document.getElementById('simTotalAsset')?.value);
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
    if (!totalInput) return;
    let totalAsset = getNum(totalInput.value);
    totalInput.value = totalAsset > 0 ? fmtNum(totalAsset) : '';

    for (let i = 1; i <= SLOT_COUNT; i++) {
        const ratioInput = document.getElementById(`simSlotRatio${i}`);
        const amountInput = document.getElementById(`simSlotAmount${i}`);
        if(ratioInput && amountInput) {
            const ratio = parseFloat(ratioInput.value) || 0;
            amountInput.value = fmtNum(totalAsset * (ratio / 100));
        }
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
            <th class="px-5 py-3 text-right">초기 매수 수량</th>
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
        const amountInput = document.getElementById(`simSlotAmount${i}`);
        const ratioInput = document.getElementById(`simSlotRatio${i}`);
        
        const amount = amountInput ? getNum(amountInput.value) : 0;
        const ratio = ratioInput ? parseFloat(ratioInput.value) || 0 : 0;

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

    const genAnnualTaxBase = sumMonthlyTaxBase * 12;
    const genMonthlyTax = sumMonthlyTaxBase * 0.154;
    const genMonthlyNetDiv = sumMonthlyGrossDiv - genMonthlyTax;
    const genAnnualTax = genMonthlyTax * 12;

    const elGenNetAvg = document.getElementById('simGenNetAvg');
    const elGenAnnualTaxBase = document.getElementById('simGenAnnualTaxBase');
    const elGenAnnualTax = document.getElementById('simGenAnnualTax');
    
    if(elGenNetAvg) elGenNetAvg.textContent = fmtNum(genMonthlyNetDiv) + "원";
    if(elGenAnnualTaxBase) elGenAnnualTaxBase.textContent = fmtNum(genAnnualTaxBase) + "원";
    if(elGenAnnualTax) elGenAnnualTax.textContent = "-" + fmtNum(genAnnualTax) + "원";

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

    const isaAnnualGross = sumMonthlyGrossDiv * 12;
    const isaAnnualTaxable = sumMonthlyTaxBase * 12;
    const isaTax = isaAnnualTaxable > 2000000 ? (isaAnnualTaxable - 2000000) * 0.099 : 0;
    const isaMonthlyNet = (isaAnnualGross - isaTax) / 12;

    const elIsaNetAvg = document.getElementById('simIsaNetAvg');
    const elIsaAnnualGross = document.getElementById('simIsaAnnualGross');
    const elIsaTax = document.getElementById('simIsaTax');
    
    if(elIsaNetAvg) elIsaNetAvg.textContent = fmtNum(isaMonthlyNet) + "원";
    if(elIsaAnnualGross) elIsaAnnualGross.textContent = fmtNum(isaAnnualGross) + "원";
    if(elIsaTax) elIsaTax.textContent = "-" + fmtNum(isaTax) + "원";

    // ✨ [동적 배당률 버그 수정] 거치금(0)과 무관하게 포트폴리오의 '가상 실효 배당수익률(%)'을 산출합니다.
    let yieldSimAmount = 10000000;
    let yieldSumGross = 0;
    let yieldSumTaxBase = 0;
    for (let i = 1; i <= SLOT_COUNT; i++) {
        const etfName = document.getElementById(`simSlotEtf${i}`)?.value;
        const ratio = parseFloat(document.getElementById(`simSlotRatio${i}`)?.value) || 0;
        if (etfName && ratio > 0 && simEtfDatabase[etfName]) {
            const etf = simEtfDatabase[etfName];
            const price = etf.price > 0 ? etf.price : 1;
            const simAlloc = yieldSimAmount * (ratio / 100);
            const shares = Math.floor(simAlloc / price);
            yieldSumGross += shares * etf.avgDiv;
            yieldSumTaxBase += shares * etf.taxBase;
        }
    }
    const yieldGenTax = yieldSumTaxBase * 0.154;
    const yieldNetDiv = yieldSumGross - yieldGenTax;
    const monthlyNetYield = yieldNetDiv / yieldSimAmount; // 이 포트폴리오 세팅의 "실제 월 배당률" 완성!

    const monthlyAddEl = document.getElementById('simMonthlyAdd');
    const monthlyAdd = monthlyAddEl ? getNum(monthlyAddEl.value) : 0;
    
    // 산출된 % 수치를 10년 엔진으로 넘겨줍니다.
    update10YearChart(totalInvestedAmount, monthlyAdd, monthlyNetYield);
}

function update10YearChart(initialInvestment, monthlyAdd, monthlyNetYield) {
    if (initialInvestment <= 0 && monthlyAdd <= 0) return;

    const cagrMap = {
        kospi: parseFloat(document.getElementById('cagrKospi')?.value) || 3,
        kosdaq: parseFloat(document.getElementById('cagrKosdaq')?.value) || 4,
        ndx: parseFloat(document.getElementById('cagrNdx')?.value) || 15,
        qld: parseFloat(document.getElementById('cagrQld')?.value) || 28,
        tqqq: parseFloat(document.getElementById('cagrTqqq')?.value) || 38,
        spy: parseFloat(document.getElementById('cagrSpy')?.value) || 10,
        sso: parseFloat(document.getElementById('cagrSso')?.value) || 18,
        upro: parseFloat(document.getElementById('cagrUpro')?.value) || 24,
        base: parseFloat(document.getElementById('cagrBase')?.value) || 0
    };

    const isDripOption = document.querySelector('input[name="dripOption"]:checked');
    const isDrip = isDripOption ? isDripOption.value === 'drip' : false;
    
    const dripTargetEl = document.getElementById('dripTarget');
    const dripTarget = dripTargetEl ? dripTargetEl.value : 'spy';
    const targetCagr = cagrMap[dripTarget];

    const labels = [];
    const dataPrincipalOnly = [];  
    const dataDripGains = [];      
    const dataBenchmark = [];      

    let bmMonthlyRate = Math.pow(1 + targetCagr / 100, 1 / 12) - 1;
    let baseMonthlyRate = Math.pow(1 + cagrMap.base / 100, 1 / 12) - 1;

    let currentBmValue = initialInvestment;
    let portBaseValue = initialInvestment;
    let portAddValue = 0;
    let reinvestBucket = 0; 

    labels.push('0년차');
    dataBenchmark.push(Math.floor(currentBmValue));
    dataPrincipalOnly.push(Math.floor(portBaseValue));
    dataDripGains.push(0);

    for (let year = 1; year <= 10; year++) {
        labels.push(`${year}년차`);
        
        for (let m = 1; m <= 12; m++) {
            // 1. 벤치마크 (거치+월적립에 대해 지수 복리 적용)
            currentBmValue = currentBmValue * (1 + bmMonthlyRate) + monthlyAdd;
            
            // 2. 배당 포트 원금 성장 (거치+월적립에 대해 Base 원금 성장률 적용)
            portBaseValue = portBaseValue * (1 + baseMonthlyRate);
            portAddValue = portAddValue * (1 + baseMonthlyRate) + monthlyAdd;
            
            let currentPrincipal = portBaseValue + portAddValue;
            
            // ✨ [핵심 수정] 원금이 불어난 만큼, 이번 달 배당금도 동적으로 폭발하게 만듭니다!
            let currentMonthDiv = currentPrincipal * monthlyNetYield;
            
            // 3. 재투자 통장 굴리기 (배당금을 타겟 지수로 계속 매수)
            if (isDrip) {
                reinvestBucket = reinvestBucket * (1 + bmMonthlyRate) + currentMonthDiv;
            }
        }

        const totalPrincipalGrowth = portBaseValue + portAddValue; 
        dataPrincipalOnly.push(Math.floor(totalPrincipalGrowth));
        dataDripGains.push(Math.floor(reinvestBucket)); 
        dataBenchmark.push(Math.floor(currentBmValue));
    }

    const canvasEl = document.getElementById('div10YearChart');
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (div10YearChartInstance) div10YearChartInstance.destroy();

    const bmNameMap = {
        'spy': 'S&P 500 (SPY)', 'ndx': '나스닥 100 (QQQ)', 'qld': '나스닥 2배 (QLD)',
        'tqqq': '나스닥 3배 (TQQQ)', 'sso': 'S&P 2배 (SSO)', 'upro': 'S&P 3배 (UPRO)',
        'kospi': '코스피', 'kosdaq': '코스닥'
    };
    const bmLabel = bmNameMap[dripTarget] + ' 100% 거치/적립식';

    div10YearChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'line',
                    label: `벤치마크 비교군: ${bmLabel}`,
                    data: dataBenchmark,
                    borderColor: '#f97316', 
                    borderWidth: 3,
                    borderDash: [5, 5],
                    pointBackgroundColor: '#f97316',
                    pointRadius: 4,
                    fill: false,
                    order: 0
                },
                {
                    type: 'bar',
                    label: isDrip ? `배당 재투자 수익금 (${dripTarget.toUpperCase()} 복리)` : '배당금 전액 소모 (수익 없음)',
                    data: dataDripGains,
                    backgroundColor: '#10b981', 
                    borderWidth: 0,
                    stack: 'Stack 0', 
                    order: 1
                },
                {
                    type: 'bar',
                    label: '순수 투입 원금 (초기 거치 + 월 적립 누적)',
                    data: dataPrincipalOnly,
                    backgroundColor: '#1e293b', 
                    borderWidth: 0,
                    stack: 'Stack 0', 
                    order: 2
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
                        },
                        footer: function(tooltipItems) {
                            let totalPort = 0;
                            tooltipItems.forEach(item => {
                                if (item.dataset.type === 'bar') {
                                    totalPort += item.parsed.y;
                                }
                            });
                            return '내 배당 포트 총자산: ' + fmtNum(totalPort) + '원';
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { weight: 'bold' } } },
                y: {
                    stacked: true,
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
                }
            }
        }
    });
}

function setupEventListeners() {
    const totalInput = document.getElementById('simTotalAsset');
    if(totalInput) totalInput.addEventListener('input', syncAllFromTotal);

    const ndxInput = document.getElementById('cagrNdx');
    if(ndxInput) {
        ndxInput.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value) || 0;
            document.getElementById('cagrQld').value = (val * 2) - 5;
            document.getElementById('cagrTqqq').value = (val * 3) - 12;
            runPortfolioSimulator();
        });
    }

    const spyInput = document.getElementById('cagrSpy');
    if(spyInput) {
        spyInput.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value) || 0;
            document.getElementById('cagrSso').value = (val * 2) - 3;
            document.getElementById('cagrUpro').value = (val * 3) - 8;
            runPortfolioSimulator();
        });
    }

    const otherInputs = ['cagrKospi', 'cagrKosdaq', 'cagrQld', 'cagrTqqq', 'cagrSso', 'cagrUpro', 'cagrBase'];
    otherInputs.forEach(id => {
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

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (!isDivDataLoaded) fetchBacktestMasterData();
    }, 500);
});
