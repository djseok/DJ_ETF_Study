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
                <div class="col-span-5"><select id="simSlotEtf${i}" class="w-full bg-white border border-slate-300 text-slate-800 text-sm font-bold rounded-lg p-2.5 focus:ring-indigo-500 outline-none shadow-sm cursor-pointer" onchange="runPortfolioSimulator()">${optionsHtml}</select></div>
                <div class="col-span-3 relative"><input type="number" id="simSlotRatio${i}" placeholder="0" class="w-full bg-white border border-slate-300 text-slate-800 text-sm font-black rounded-lg p-2.5 text-center focus:ring-indigo-500 outline-none shadow-sm" oninput="syncFromRatio(${i})"><span class="absolute right-3 top-2.5 text-slate-400 text-sm font-bold">%</span></div>
                <div class="col-span-4 relative"><input type="text" id="simSlotAmount${i}" placeholder="0" class="w-full bg-white border border-slate-300 text-slate-800 text-sm font-black rounded-lg p-2.5 text-right focus:ring-indigo-500 outline-none shadow-sm font-mono" oninput="syncFromAmount(${i})"></div>
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
    amountInput.value = fmtNum(totalAsset * (ratio / 100));
    runPortfolioSimulator();
}

function syncFromAmount(index) {
    const totalAsset = getNum(document.getElementById('simTotalAsset')?.value);
    const ratioInput = document.getElementById(`simSlotRatio${index}`);
    const amountInput = document.getElementById(`simSlotAmount${index}`);
    let amount = getNum(amountInput.value);
    amountInput.value = amount > 0 ? fmtNum(amount) : '';
    if (totalAsset > 0) {
        ratioInput.value = parseFloat(((amount / totalAsset) * 100).toFixed(2));
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

            sumMonthlyGrossDiv += monthlyGrossDiv;
            sumMonthlyTaxBase += monthlyTaxBase;

            breakdownHtml += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-5 py-3 font-bold text-slate-800">${etfName}</td>
                    <td class="px-5 py-3 text-right font-mono">${fmtNum(shares)}주</td>
                    <td class="px-5 py-3 text-right font-mono text-red-500 bg-red-50/20">${fmtNum(monthlyTaxBase)}원</td>
                    <td class="px-5 py-3 text-right font-mono text-slate-500 border-l border-slate-100">${fmtNum(shares * etf.minDiv)}원</td>
                    <td class="px-5 py-3 text-right font-mono text-blue-600 bg-blue-50/20 font-black">${fmtNum(monthlyGrossDiv)}원</td>
                    <td class="px-5 py-3 text-right font-mono text-emerald-600 bg-emerald-50/20">${fmtNum(shares * etf.maxDiv)}원</td>
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
            <td class="px-5 py-3 text-center">합계</td><td class="px-5 py-3 text-right">-</td>
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

    let yieldSimAmount = 10000000;
    let yieldSumGross = 0;
    let yieldSumTaxBase = 0;
    for (let i = 1; i <= SLOT_COUNT; i++) {
        const etfName = document.getElementById(`simSlotEtf${i}`)?.value;
        const ratio = parseFloat(document.getElementById(`simSlotRatio${i}`)?.value) || 0;
        if (etfName && ratio > 0 && simEtfDatabase[etfName]) {
            const etf = simEtfDatabase[etfName];
            const price = etf.price > 0 ? etf.price : 1;
            const shares = Math.floor((yieldSimAmount * (ratio / 100)) / price);
            yieldSumGross += shares * etf.avgDiv;
            yieldSumTaxBase += shares * etf.taxBase;
        }
    }
    const monthlyNetYield = (yieldSumGross - (yieldSumTaxBase * 0.154)) / yieldSimAmount; 
    const monthlyAdd = getNum(document.getElementById('simMonthlyAdd')?.value) || 0;
    
    update10YearChart(totalInvestedAmount, monthlyAdd, monthlyNetYield, genMonthlyNetDiv);
}

function update10YearChart(initialInvestment, monthlyAdd, monthlyNetYield, startingMonthlyDiv) {
    if (initialInvestment <= 0 && monthlyAdd <= 0) {
        document.getElementById('expertAdvicePanel').classList.add('hidden');
        return;
    }

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
    
    const t1 = document.getElementById('dripTarget1')?.value || 'spy';
    let r1 = parseFloat(document.getElementById('dripRatio1')?.value) || 0;
    const t2 = document.getElementById('dripTarget2')?.value || '';
    let r2 = parseFloat(document.getElementById('dripRatio2')?.value) || 0;

    let totalRatio = r1 + r2;
    if(totalRatio === 0) { r1 = 100; totalRatio = 100; }

    const cagr1 = cagrMap[t1] || 0;
    const cagr2 = t2 !== '' ? (cagrMap[t2] || 0) : 0;
    const targetCagr = (cagr1 * (r1 / totalRatio)) + (cagr2 * (r2 / totalRatio));

    const bmNameMap = {
        'spy': 'S&P 500(SPY)', 'ndx': '나스닥 100(QQQ)', 'qld': '나스닥 2배(QLD)',
        'tqqq': '나스닥 3배(TQQQ)', 'sso': 'S&P 2배(SSO)', 'upro': 'S&P 3배(UPRO)',
        'kospi': '코스피', 'kosdaq': '코스닥'
    };
    
    let bmLabel = '';
    let bmShortLabel = '';
    if (t2 !== '' && r2 > 0) {
        bmLabel = `${bmNameMap[t1]} ${Math.round(r1/totalRatio*100)}% + ${bmNameMap[t2]} ${Math.round(r2/totalRatio*100)}% 분산`;
        bmShortLabel = `혼합(${targetCagr.toFixed(1)}%)`;
    } else {
        bmLabel = `${bmNameMap[t1]} 100%`;
        bmShortLabel = `${bmNameMap[t1]}`;
    }

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
            currentBmValue = currentBmValue * (1 + bmMonthlyRate) + monthlyAdd;
            portBaseValue = portBaseValue * (1 + baseMonthlyRate);
            portAddValue = portAddValue * (1 + baseMonthlyRate) + monthlyAdd;
            
            let currentPrincipal = portBaseValue + portAddValue;
            let currentMonthDiv = currentPrincipal * monthlyNetYield;
            
            if (isDrip) {
                reinvestBucket = reinvestBucket * (1 + bmMonthlyRate) + currentMonthDiv;
            }
        }
        dataPrincipalOnly.push(Math.floor(portBaseValue + portAddValue));
        dataDripGains.push(Math.floor(reinvestBucket)); 
        dataBenchmark.push(Math.floor(currentBmValue));
    }

    const canvasEl = document.getElementById('div10YearChart');
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (div10YearChartInstance) div10YearChartInstance.destroy();

    div10YearChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'line',
                    label: `벤치마크 (${bmLabel} 단순 거치/적립)`,
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
                    label: isDrip ? `배당 분산 재투자 수익금 [${bmShortLabel} 복리 적용]` : '배당금 전액 소모 (수익 없음)',
                    data: dataDripGains,
                    backgroundColor: '#10b981', 
                    borderWidth: 0,
                    stack: 'Stack 0', 
                    order: 1
                },
                {
                    type: 'bar',
                    label: '배당 포트 평가액 (원금 누적 + 본체 시세차익)',
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
                        label: function(context) { return context.dataset.label + ': ' + fmtNum(context.parsed.y) + '원'; },
                        footer: function(tooltipItems) {
                            let totalPort = 0;
                            tooltipItems.forEach(item => { if (item.dataset.type === 'bar') totalPort += item.parsed.y; });
                            return '내 배당 포트 총자산: ' + fmtNum(totalPort) + '원';
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { weight: 'bold' } } },
                y: {
                    stacked: true, beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            if(value >= 100000000) return (value / 100000000).toFixed(1) + '억';
                            if(value >= 10000) return (value / 10000).toFixed(0) + '만';
                            return value;
                        }, font: { weight: 'bold' }
                    },
                    grid: { color: '#f1f5f9' }
                }
            }
        }
    });

    renderDynamicExpertAdvice(initialInvestment, monthlyAdd, startingMonthlyDiv, isDrip, bmLabel, targetCagr.toFixed(1), dataPrincipalOnly[10], dataDripGains[10], dataBenchmark[10]);
}

function renderDynamicExpertAdvice(initial, monthly, startDiv, isDrip, targetName, cagr, finalPrincipal, finalGains, finalBm) {
    const panel = document.getElementById('expertAdvicePanel');
    if (!panel) return;

    const totalAsset = finalPrincipal + finalGains;
    const diffToBm = totalAsset - finalBm;
    const totalInvested = initial + (monthly * 120);
    const growthMultiplier = (totalAsset / totalInvested).toFixed(1);
    
    // ✨ 핵심 수학 오류 수정: 10년 뒤 포트폴리오 원금 덩어리(finalPrincipal) 안에서, 내가 순수하게 넣은 돈(totalInvested)을 뺀 나머지가 순수 시세차익입니다.
    const baseCapitalGains = finalPrincipal - totalInvested;
    const baseCapitalGainsStr = baseCapitalGains >= 0 ? '+ ' + fmtNum(baseCapitalGains) : fmtNum(baseCapitalGains);
    
    const greetings = [
        "포트폴리오의 뼈대가 아주 탄탄합니다.", 
        "훌륭한 자산 배분 감각을 보여주셨습니다.", 
        "하락장 방어력과 수익률을 동시에 겨냥한 스마트한 세팅입니다.",
        "장기 투자의 정석을 걷는 교과서적인 포트폴리오입니다."
    ];
    const ranGreeting = greetings[Math.floor(Math.random() * greetings.length)];

    let adviceHtml = `
        <h3 class="text-xl font-black mb-4 flex items-center text-emerald-400">
            <i class="fas fa-lightbulb text-yellow-400 mr-2"></i> 퀀트 애널리스트의 포트폴리오 브리핑
        </h3>
        <p class="text-sm leading-relaxed mb-4 text-slate-300">
            ${ranGreeting} 현재 설계하신 전략은 <strong>초기 거치금 ${fmtNum(initial)}원</strong>과 <strong>매월 ${fmtNum(monthly)}원</strong>의 추가 납입으로 시작되며, 첫 달 예상되는 <span class="text-white font-bold bg-slate-700 px-2 py-0.5 rounded">순수 배당금은 약 ${fmtNum(startDiv)}원</span>입니다.
        </p>
    `;

    if (isDrip) {
        const goodEvals = [
            `동일한 금액을 단순히 지수에 몰빵했을 때(${fmtNum(finalBm)}원)보다 무려 <strong>${fmtNum(diffToBm)}원을 더 벌어들이는 마스터피스</strong>입니다. 변동성의 공포는 낮추고 수익률은 극대화했습니다.`,
            `단순 거치식 투자를 완벽하게 압도합니다! 현금흐름으로 시장의 변동성을 잡아먹는 <strong>'배당 복리의 무서움'</strong>을 숫자로 증명하셨습니다.`,
            `지수 몰빵 대비 <strong>${fmtNum(diffToBm)}원</strong>을 더 챙겨갑니다. 하락장이 와도 매월 나오는 배당금으로 레버리지를 저점 매수할 수 있는 가장 든든한 멘탈 방어 전략입니다.`
        ];
        const badEvals = [
            `수익률 자체는 지수 몰빵 대비 <strong>${fmtNum(Math.abs(diffToBm))}원</strong> 부족합니다. 하지만 하락장(-50%)을 맞았을 때, 마르지 않는 배당금이 쏟아지는 이 전략이 여러분의 멘탈과 수면의 질을 완벽하게 지켜줄 것입니다.`,
            `최종 금액은 지수 몰빵(${fmtNum(finalBm)}원)이 더 높습니다. 그러나 10년 동안 끊임없이 현금이 들어오는 '파이프라인의 가치'를 고려한다면 리스크 대비 효율은 이 전략이 훨씬 뛰어납니다.`,
            `단순 지수 추종에 비해서는 <strong>${fmtNum(Math.abs(diffToBm))}원</strong>이 적습니다. 하지만 이 전략의 진정한 가치는 10년 내내 폭락장을 두려워하지 않고 오히려 배당금으로 줍줍할 수 있는 '심리적 우위'에 있습니다.`
        ];

        let ranEval = diffToBm >= 0 ? goodEvals[Math.floor(Math.random() * goodEvals.length)] : badEvals[Math.floor(Math.random() * badEvals.length)];

        // ✨ 시세차익 항목을 추가하여 덧셈이 완벽하게 떨어지는 명세서 렌더링
        adviceHtml += `
            <p class="text-sm leading-relaxed mb-4 text-slate-300">
                10년간 생활비로 쓰지 않고 모은 배당금을 <strong>[${targetName}]</strong>에 분산 재투자(혼합 복리 연 ${cagr}%)하는 <span class="text-emerald-400 font-bold">강력한 스노우볼 시나리오</span>를 선택하셨습니다.
            </p>
            <ul class="space-y-2 text-sm text-slate-200 bg-slate-900 p-4 rounded-xl border border-slate-600 mb-4">
                <li class="flex justify-between items-center border-b border-slate-700 pb-2"><span>📈 10년 뒤 내 포트폴리오 총 자산:</span> <strong class="text-lg text-emerald-400">${fmtNum(totalAsset)} 원</strong></li>
                <li class="flex justify-between items-center pt-2"><span class="pl-4 text-slate-400">↳ 내 돈 순수 투입 원금 (초기+적립 누적):</span> <strong class="text-slate-300">${fmtNum(totalInvested)} 원</strong></li>
                <li class="flex justify-between items-center pt-1"><span class="pl-4 text-slate-400">↳ 배당 포트 본체의 10년치 시세차익:</span> <strong class="${baseCapitalGains >= 0 ? 'text-blue-400' : 'text-red-400'}">${baseCapitalGainsStr} 원</strong></li>
                <li class="flex justify-between items-center pt-1"><span class="pl-4 text-slate-400">↳ 배당 재투자(DRIP)로 불려낸 눈덩이 수익:</span> <strong class="text-emerald-500">+ ${fmtNum(finalGains)} 원</strong></li>
            </ul>
            <p class="text-sm ${diffToBm >= 0 ? 'text-emerald-300' : 'text-yellow-300'} font-bold">
                <i class="fas ${diffToBm >= 0 ? 'fa-check-circle' : 'fa-shield-alt'} mr-1"></i> ${ranEval} 투입한 원금 대비 자산이 <strong>${growthMultiplier}배</strong>로 퀀텀 점프하는 이 짜릿한 결과를 기억하세요!
            </p>
        `;
    } else {
        adviceHtml += `
            <p class="text-sm leading-relaxed mb-4 text-slate-300">
                현재 <strong>배당금을 생활비로 전액 소모하는 시나리오</strong>를 선택하셨습니다. 당장의 현금흐름으로 삶의 질은 극대화되지만, 복리 엔진이 꺼져있어 10년이 지나도 자산의 폭발적인 성장은 기대하기 어렵습니다.
            </p>
            <div class="bg-slate-900 p-4 rounded-xl border border-slate-600 mb-4 text-sm flex flex-col gap-2">
                <div class="flex justify-between items-center border-b border-slate-700 pb-2">
                    <span class="text-slate-200 font-bold">📉 10년 뒤 배당 포트폴리오 평가액:</span> 
                    <strong class="text-lg text-slate-100">${fmtNum(finalPrincipal)} 원</strong>
                </div>
                <div class="flex justify-between items-center text-slate-400 pl-4 pt-1">
                    <span>↳ 내 돈 순수 투입 원금 (초기+적립 누적):</span> <span>${fmtNum(totalInvested)} 원</span>
                </div>
                <div class="flex justify-between items-center text-slate-400 pl-4">
                    <span>↳ 배당 포트 본체의 10년치 시세차익:</span> <span class="${baseCapitalGains >= 0 ? 'text-blue-400' : 'text-red-400'}">${baseCapitalGainsStr} 원</span>
                </div>
            </div>
            <p class="text-sm text-yellow-300 font-bold"><i class="fas fa-info-circle mr-1"></i> 자산을 더 크고 빠르게 불리고 싶으시다면, 위 옵션에서 '배당금 분산 재투자'를 켜서 마법이 일어나는 과정을 직접 눈으로 확인해 보세요!</p>
        `;
    }

    panel.innerHTML = adviceHtml;
    panel.classList.remove('hidden');
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

    const otherInputs = ['cagrKospi', 'cagrKosdaq', 'cagrQld', 'cagrTqqq', 'cagrSso', 'cagrUpro', 'cagrBase', 'dripRatio1', 'dripRatio2'];
    otherInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', runPortfolioSimulator);
    });

    const dripOptions = document.querySelectorAll('input[name="dripOption"]');
    const dripInputs = document.querySelectorAll('.drip-input');

    dripOptions.forEach(opt => {
        opt.addEventListener('change', (e) => {
            const isDrip = (e.target.value === 'drip');
            dripInputs.forEach(input => { input.disabled = !isDrip; });
            runPortfolioSimulator();
        });
    });

    const selects = ['dripTarget1', 'dripTarget2'];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('change', runPortfolioSimulator);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { if (!isDivDataLoaded) fetchBacktestMasterData(); }, 500);
});
