// =========================================================
// 🛡️ 배당 & 건보료 통합 시뮬레이터 (js/backtest_div.js)
// =========================================================

const BACKTEST_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=795942259&single=true&output=csv";
let simEtfDatabase = {};
let isDivDataLoaded = false;

const fmtNum = (num) => new Intl.NumberFormat('ko-KR').format(Math.floor(num));
const getNum = (str) => parseFloat(String(str).replace(/,/g, '')) || 0;

// CSV 데이터를 1회만 불러오기
async function fetchBacktestMasterData() {
    if (isDivDataLoaded) return; // 이미 불러왔다면 스킵

    try {
        const response = await fetch(BACKTEST_DIV_CSV_URL + "&t=" + new Date().getTime());
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        
        const selector = document.getElementById('simEtfSelector');
        selector.innerHTML = ''; 

        // 파싱 (1행 헤더 건너뛰기)
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
                const option = document.createElement('option');
                option.value = name;
                option.textContent = `${name} (현재가: ${fmtNum(simEtfDatabase[name].price)}원)`;
                selector.appendChild(option);
            }
        }
        
        isDivDataLoaded = true;
        document.getElementById('simResultPanel').style.display = 'grid';
        runDivSimulator();

    } catch (error) {
        console.error("배당 시뮬레이터 데이터 로딩 실패:", error);
        document.getElementById('simEtfSelector').innerHTML = '<option>데이터 연결 실패</option>';
    }
}

// 실시간 연산 핵심 함수
function runDivSimulator() {
    const selectedName = document.getElementById('simEtfSelector').value;
    const investAmount = getNum(document.getElementById('simInvestmentAmount').value);
    
    if (!selectedName || !simEtfDatabase[selectedName] || investAmount <= 0) return;

    const etf = simEtfDatabase[selectedName];
    const shares = Math.floor(investAmount / etf.price);
    if (shares <= 0) return;

    // --- 일반 계좌 ---
    const genTaxBaseMonthly = shares * etf.taxBase;
    const genTaxBaseAnnual = genTaxBaseMonthly * 12;
    const calcNet = (div) => (shares * div) - (genTaxBaseMonthly * 0.154);

    document.getElementById('simGenShares').textContent = fmtNum(shares) + "주";
    document.getElementById('simGenNetAvg').textContent = fmtNum(calcNet(etf.avgDiv)) + "원";
    document.getElementById('simGenNetRange').textContent = `${fmtNum(calcNet(etf.minDiv))}원 ~ ${fmtNum(calcNet(etf.maxDiv))}원`;
    document.getElementById('simGenTaxBase').textContent = fmtNum(genTaxBaseAnnual) + "원";

    const warningBox = document.getElementById('simMedicareWarning');
    if (genTaxBaseAnnual > 10000000) {
        warningBox.className = "text-center py-2 rounded font-bold text-sm bg-red-100 text-red-700 mt-2";
        warningBox.innerHTML = "⚠️ 피부양자 탈락 경고 (과표 1천만 원 초과)";
    } else {
        warningBox.className = "text-center py-2 rounded font-bold text-sm bg-emerald-100 text-emerald-700 mt-2";
        warningBox.innerHTML = "✅ 건보료 피부양자 안전";
    }

    // --- ISA 계좌 ---
    const isaAnnualGross = shares * etf.avgDiv * 12;
    const isaTax = isaAnnualGross > 2000000 ? (isaAnnualGross - 2000000) * 0.099 : 0;
    
    document.getElementById('simIsaShares').textContent = fmtNum(shares) + "주";
    document.getElementById('simIsaNetAvg').textContent = fmtNum((isaAnnualGross - isaTax) / 12) + "원";
    document.getElementById('simIsaAnnualGross').textContent = fmtNum(isaAnnualGross) + "원";
    document.getElementById('simIsaTax').textContent = fmtNum(isaTax) + "원";
}

// 이벤트 리스너 등록
document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('simEtfSelector');
    if(selector) selector.addEventListener('change', runDivSimulator);
    
    const amountInput = document.getElementById('simInvestmentAmount');
    if(amountInput) {
        amountInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
            if(value) e.target.value = new Intl.NumberFormat('ko-KR').format(value);
            runDivSimulator();
        });
    }
});
