// =========================================================
// 🛡️ 포트폴리오 통합 배당 & 건보료 시뮬레이터 (js/backtest_div.js)
// =========================================================

const BACKTEST_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=795942259&single=true&output=csv";
let simEtfDatabase = {};
let isDivDataLoaded = false;
const SLOT_COUNT = 5;

const fmtNum = (num) => new Intl.NumberFormat('ko-KR').format(Math.floor(num));
const getNum = (str) => parseFloat(String(str).replace(/,/g, '')) || 0;

// 1. 초기 데이터 로드 및 5개 슬롯 동적 생성
async function fetchBacktestMasterData() {
    if (isDivDataLoaded) return;

    try {
        const response = await fetch(BACKTEST_DIV_CSV_URL + "&t=" + new Date().getTime());
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        
        // 데이터 파싱
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

// 2. 5개 슬롯 HTML 동적 생성
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

// 3. 비율 ↔ 금액 동기화 엔진
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
    
    // 금액 포맷팅 (콤마 추가)
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

// 총 자산 변경 시 모든 슬롯의 금액을 현재 비율에 맞춰 재조정
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

// 4. 통합 시뮬레이터 메인 엔진
function runPortfolioSimulator() {
    let totalInvestedAmount = 0;
    let totalRatio = 0;
    
    let sumMonthlyGrossDiv = 0;
    let sumMonthlyTaxBase = 0;

    let breakdownHtml = '';

    // 각 슬롯별 데이터 취합 및 명세서 생성
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

            sumMonthlyGrossDiv += monthlyGrossDiv;
            sumMonthlyTaxBase += monthlyTaxBase;

            breakdownHtml += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-5 py-3 font-bold text-slate-800">${etfName}</td>
                    <td class="px-5 py-3 text-right font-mono">${fmtNum(shares)}주</td>
                    <td class="px-5 py-3 text-right font-mono text-blue-600">${fmtNum(monthlyGrossDiv)}원</td>
                    <td class="px-5 py-3 text-right font-mono text-red-500 bg-red-50/20">${fmtNum(monthlyTaxBase)}원</td>
                </tr>
            `;
        }
    }

    // 할당 상태 업데이트
    const statusEl = document.getElementById('simAllocatedStatus');
    statusEl.textContent = `${totalRatio.toFixed(1)}% / ${fmtNum(totalInvestedAmount)}원`;
    statusEl.className = totalRatio > 100 ? "text-red-600 font-black mono text-base" : "text-indigo-600 font-black mono text-base";

    // 명세서 표 업데이트
    const tbody = document.getElementById('simBreakdownTableBody');
    if (breakdownHtml === '') {
        tbody.innerHTML = `<tr><td colspan="4" class="p-5 text-center text-slate-400 font-bold">자산을 배분하면 명세서가 나타납니다.</td></tr>`;
    } else {
        tbody.innerHTML = breakdownHtml;
    }

    document.getElementById('simTotalGrossDiv').textContent = fmtNum(sumMonthlyGrossDiv) + "원";
    document.getElementById('simTotalTaxBase').textContent = fmtNum(sumMonthlyTaxBase) + "원";

    // --- 5. 일반계좌 비교 카드 연산 ---
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

    // --- 6. ISA 계좌 비교 카드 연산 ---
    const isaAnnualGross = sumMonthlyGrossDiv * 12;
    const isaTax = isaAnnualGross > 2000000 ? (isaAnnualGross - 2000000) * 0.099 : 0;
    const isaMonthlyNet = (isaAnnualGross - isaTax) / 12;

    document.getElementById('simIsaNetAvg').textContent = fmtNum(isaMonthlyNet) + "원";
    document.getElementById('simIsaAnnualGross').textContent = fmtNum(isaAnnualGross) + "원";
    document.getElementById('simIsaTax').textContent = "-" + fmtNum(isaTax) + "원";
}

// 이벤트 리스너 세팅
function setupEventListeners() {
    const totalInput = document.getElementById('simTotalAsset');
    if(totalInput) {
        totalInput.addEventListener('input', syncAllFromTotal);
    }
}
