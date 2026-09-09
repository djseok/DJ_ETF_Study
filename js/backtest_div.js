// =========================================================
// 🛡️ 포트폴리오 통합 배당 & 10년 복리 시뮬레이터 (js/backtest_div.js)
// =========================================================

const BACKTEST_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=795942259&single=true&output=csv";
let simEtfDatabase = {};
let isDivDataLoaded = false;
const SLOT_COUNT = 5;
let div10YearChartInstance = null; // 10년 차트 인스턴스 전역 변수

const fmtNum = (num) => new Intl.NumberFormat('ko-KR').format(Math.floor(num));
const getNum = (str) => parseFloat(String(str).replace(/,/g, '')) || 0;

async function fetchBacktestMasterData() {
    if (isDivDataLoaded) return;

    try {
        const response = await fetch(BACKTEST_DIV_CSV_URL + "&t=" + new Date().getTime());
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        
        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].split(',');
            if (columns.length >= 6) {
                const name = columns[0].trim();
                simEtfDatabase[name] = {
                    price: getNum(columns[1]),
                    minDiv: getNum(columns[2]),
                    avgDiv: getNum(columns[3]),
                    maxDiv: getNum(columns[4]),
                    taxBase: getNum(columns[5])
                };
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
    
    let rawVal = amountInput.value.replace(/,/g, '').replace(/[^0-9]/g, '');
    let amount = parseFloat(rawVal) || 0;
    amountInput.value = rawVal ? fmtNum(amount) : '';
    
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
    let rawVal = totalInput.value.replace(/,/g, '').replace(/[^0-9]/g, '');
    let totalAsset = parseFloat(rawVal) || 0;
    totalInput.value = rawVal ? fmtNum(totalAsset) : '';

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
    
    document.querySelector('#simBreakdownTableBody').previousElementSibling.innerHTML = `
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
        const etfName = document.getElementById(`simSlotEtf${i}`).value;
        const amount = getNum(document.getElementById(`simSlotAmount${i}`).value);
        const ratio = parseFloat(document.getElementById(`simSlotRatio${i}`).value) || 0;

        totalInvestedAmount += amount;
        totalRatio += ratio;

        if (etfName && amount > 0) {
            const etf = simEtfDatabase[etfName];
            const shares = Math.floor(amount / etf.price);
            
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
    statusEl.textContent = `${totalRatio.toFixed(1)}% / ${fmtNum(totalInvestedAmount)}원`;
    statusEl.className = totalRatio > 100 ? "text-red-600 font-black mono text-base" : "text-indigo-600 font-black mono text-base";

    const tbody = document.getElementById('simBreakdownTableBody');
    if (breakdownHtml === '') {
        tbody.innerHTML = `<tr><td colspan="6" class="p-5 text-center text-slate-400 font-bold">자산을 배분하면 명세서가 나타납니다.</td></tr>`;
    } else {
        tbody.innerHTML = breakdownHtml;
    }
    
    document.querySelector('#simBreakdownTableBody').nextElementSibling.innerHTML = `
        <tr>
            <td class="px-5 py-3 text-center">합계</td>
            <td class="px-5 py-3 text-right">-</td>
            <td id="simTotalTaxBase" class="px-5 py-3 text-right text-red-600 mono bg-red-50/50">${fmtNum(sumMonthlyTaxBase)}원</td>
            <td class="px-5 py-3 text-right">-</td>
            <td id="simTotalGrossDiv" class="px-5 py-3 text-right text-blue-600 mono font-black bg-blue-50/30">${fmtNum(sumMonthlyGrossDiv)}원</td>
            <td class="px-5 py-3 text-right">-</td>
        </tr>
    `;

    // 5. 일반계좌 비교
    const genAnnualTaxBase = sumMonthlyTaxBase * 12;
    const genMonthlyTax = sumMonthlyTaxBase * 0.154;
    const genMonthlyNetDiv = sumMonthlyGrossDiv - genMonthlyTax;
    const genAnnualTax = genMonthlyTax * 12;

    document.getElementById('simGenNetAvg').textContent = fmtNum(genMonthlyNetDiv) + "원";
    document.getElementById('simGenAnnualTaxBase').textContent = fmtNum(genAnnualTaxBase) + "원";
    document.getElementById('simGenAnnualTax').textContent = "-" + fmtNum(genAnnualTax) + "원";

    const warningBox = document.getElementById('simMedicareWarning');
    if (genAnnualTaxBase > 10000000) {
        warningBox.className = "text-center py-2.5 rounded-lg font-black text-sm bg-red-100 text-red-700 border border-red-200 mt-2 shadow-sm";
        warningBox.innerHTML = "⚠️ 건보료 피부양자 탈락 (과표 1천만 원 초과)";
    } else {
        warningBox.className = "text-center py-2.5 rounded-lg font-black text-sm bg-emerald-100 text-emerald-700 border border-emerald-200 mt-2 shadow-sm";
        warningBox.innerHTML = "✅ 피부양자 자격 안전 (1천만 원 이하)";
    }

    // 6. ISA 계좌 비교 (실제 세법 100% 고증)
    const isaAnnualGross = sumMonthlyGrossDiv * 12;
    const isaAnnualTaxable = sumMonthlyTaxBase * 12;
    const isaTax = isaAnnualTaxable > 2000000 ? (isaAnnualTaxable - 2000000) * 0.099 : 0;
    const isaMonthlyNet = (isaAnnualGross - isaTax) / 12;

    document.getElementById('simIsaNetAvg').textContent = fmtNum(isaMonthlyNet) + "원";
    document.getElementById('simIsaAnnualGross').textContent = fmtNum(isaAnnualGross) + "원";
    document.getElementById('simIsaTax').textContent = "-" + fmtNum(isaTax) + "원";

    // 7. 10년 복리 시뮬레이터 차트 업데이트 호출
    // 일반 계좌 기준 월 세후 실수령액을 배당 파이프라인의 핵심 현금흐름으로 사용
    update10YearChart(totalInvestedAmount, genMonthlyNetDiv);
}

// =========================================================
// 📈 10년 장기 투자 시나리오: 배당 vs 지수 복리 차트 엔진
// =========================================================
function update10YearChart(initialInvestment, monthlyNetDiv) {
    if (initialInvestment <= 0) return;

    // 1. 사용자 세팅값 파싱
    const cagrNdx = parseFloat(document.getElementById('cagrNdx').value) || 15;
    const cagrSpy = parseFloat(document.getElementById('cagrSpy').value) || 10;
    const cagrKospi = parseFloat(document.getElementById('cagrKospi').value) || 3;
    const cagrBase = parseFloat(document.getElementById('cagrBase').value) || 0;
    
    const isDrip = document.querySelector('input[name="dripOption"]:checked').value === 'drip';
    const dripTarget = document.getElementById('dripTarget').value;

    // 2. 타겟 CAGR 매핑 (레버리지는 변동성 끌림 현상을 감안해 보수적으로 산정)
    let targetCagr = 0;
    if (dripTarget === 'ndx') targetCagr = cagrNdx;
    else if (dripTarget === 'spy') targetCagr = cagrSpy;
    else if (dripTarget === 'kospi') targetCagr = cagrKospi;
    else if (dripTarget === 'qld') targetCagr = (cagrNdx * 2) - 5; // 레버리지 보수적 감가
    else if (dripTarget === 'tqqq') targetCagr = (cagrNdx * 3) - 12; // 레버리지 보수적 감가

    // 3. 10년치 데이터 배열 준비
    const labels = [];
    const dataNdx = [];
    const dataSpy = [];
    const dataKospi = [];
    const dataPortfolio = [];

    // 4. 연도별 복리 계산 엔진
    for (let year = 0; year <= 10; year++) {
        labels.push(`${year}년차`);
        
        // 벤치마크 지수 거치 시 (연단위 복리)
        dataNdx.push(Math.floor(initialInvestment * Math.pow(1 + cagrNdx / 100, year)));
        dataSpy.push(Math.floor(initialInvestment * Math.pow(1 + cagrSpy / 100, year)));
        dataKospi.push(Math.floor(initialInvestment * Math.pow(1 + cagrKospi / 100, year)));

        // 내 포트폴리오 연산
        let portValue = 0;
        if (!isDrip) {
            // 시나리오 1: 생활비 전액 소모 (원금만 cagrBase 로 천천히 증가)
            portValue = initialInvestment * Math.pow(1 + cagrBase / 100, year);
        } else {
            // 시나리오 2: 배당금 100% 기계적 재투자 (DRIP)
            // - 본진은 cagrBase 로 성장
            let principal = initialInvestment * Math.pow(1 + cagrBase / 100, year);
            // - 재투자 통장은 매월 배당금을 넣고 targetCagr 의 월 복리로 성장
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

    // 5. Chart.js 렌더링
    const ctx = document.getElementById('div10YearChart').getContext('2d');
    
    if (div10YearChartInstance) {
        div10YearChartInstance.destroy();
    }

    div10YearChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `내 포트폴리오 (${isDrip ? '배당 100% 재투자' : '배당 전액 소모'})`,
                    data: dataPortfolio,
                    borderColor: '#4f46e5', // Indigo-600
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    borderWidth: 4,
                    pointRadius: 4,
                    tension: 0.3,
                    fill: true,
                    order: 1
                },
                {
                    label: '나스닥 100 몰빵',
                    data: dataNdx,
                    borderColor: '#0ea5e9', // Sky-500
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0.3,
                    order: 2
                },
                {
                    label: 'S&P 500 몰빵',
                    data: dataSpy,
                    borderColor: '#64748b', // Slate-500
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    tension: 0.3,
                    order: 3
                },
                {
                    label: '코스피 몰빵',
                    data: dataKospi,
                    borderColor: '#cbd5e1', // Slate-300
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.3,
                    order: 4
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

    // 10년 차트 관련 변수들 리스너 등록
    const cagrInputs = ['cagrNdx', 'cagrSpy', 'cagrKospi', 'cagrBase'];
    cagrInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', runPortfolioSimulator);
    });

    const dripOptions = document.querySelectorAll('input[name="dripOption"]');
    const dripTargetSelect = document.getElementById('dripTarget');

    dripOptions.forEach(opt => {
        opt.addEventListener('change', (e) => {
            dripTargetSelect.disabled = e.target.value !== 'drip';
            runPortfolioSimulator();
        });
    });

    if(dripTargetSelect) dripTargetSelect.addEventListener('change', runPortfolioSimulator);
}
