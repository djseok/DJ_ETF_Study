// =========================================================
// 🌐 [1] 전역 변수 및 4대 시트 주소 설정
// =========================================================
const timestamp = new Date().getTime();

// 1. 예측 엔진 (gid=0)
const QUANT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=0&single=true&output=csv&t=" + timestamp;

// 2. 포트폴리오 (gid=539824393)
const PORTFOLIO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=539824393&single=true&output=csv&t=" + timestamp;

// 3. 배당 이력 (gid=1285467029)
const DIVIDEND_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1285467029&single=true&output=csv&t=" + timestamp;

// 4. 실수령 내역 (gid=1276756215)
const ACTUAL_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1276756215&single=true&output=csv&t=" + timestamp;

let masterRawData = [];
let globalFxDelta = 0;
let globalVixValue = 15;
let globalParsedUsers = {}; 
let globalCalculatedStrategyDividends = {}; 
let globalActualDividendLogs = [];

// =========================================================
// 🧠 [2] 퀀트 분석용 핵심 매트릭스
// =========================================================
const DIVIDEND_SCHEME_MATRIX = {
    "KODEX 미국나스닥100데일리커버드콜OTM": { strategy: "recent3", payMonths: [1,2,3,4,5,6,7,8,9,10,11,12] },    
    "TIGER 미국배당다우존스": { strategy: "rolling12", payMonths: [1,2,3,4,5,6,7,8,9,10,11,12] }, 
    "RISE 미국나스닥100": { strategy: "latest", payMonths: [3,6,9,12] },       
    "KODEX 미국반도체": { strategy: "latest", payMonths: [1,4,7,10] },        
    "RISE 미국S&P500": { strategy: "latest", payMonths: [3,6,9,12] },         
    "KODEX 미국S&P500": { strategy: "latest", payMonths: [1,4,7,10] },        
    "TIME 글로벌AI인공지능액티브": { strategy: "allAverage", payMonths: [1,4,7,10] } 
};

// =========================================================
// 🎛️ [3] 탭 전환 및 컨트롤러
// =========================================================
function switchTab(tabName) {
    const tabs = ['Quant', 'Port', 'Calc', 'Div', 'Conc'];
    tabs.forEach(t => {
        const view = document.getElementById('view' + t);
        const btn = document.getElementById('btnTab' + t);
        if(view) view.classList.add('hidden');
        if(btn) btn.className = "flex-1 py-3 bg-white text-slate-600 rounded-xl font-bold shadow-sm border border-slate-200 transition-all hover:bg-slate-50 whitespace-nowrap";
    });
    const activeView = document.getElementById('view' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    const activeBtn = document.getElementById('btnTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if(activeView) activeView.classList.remove('hidden');
    if(activeBtn) {
        if(tabName === 'div') activeBtn.className = "flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold shadow-md transition-all whitespace-nowrap";
        else if(tabName === 'conc') activeBtn.className = "flex-1 py-3 bg-purple-700 text-white rounded-xl font-bold shadow-md transition-all whitespace-nowrap";
        else activeBtn.className = "flex-1 py-3 bg-slate-800 text-white rounded-xl font-bold shadow-md transition-all whitespace-nowrap";
    }
    // 각 탭별 로딩 로직 실행
    if(tabName === 'port') loadPortfolioData('port');
    else if(tabName === 'div') loadPortfolioData('div');
    else if(tabName === 'calc') loadPortfolioData('calc');
    else if(tabName === 'conc') loadPortfolioData('conc');
}

function parseCsvToMatrix(text) {
    return text.split('\n').map(row => {
        let match = row.match(/(".*?"|[^",\r\n]+)(?=\s*,|\s*$|\r|$)/g);
        return match ? match.map(val => val.replace(/^"|"$/g, '').trim()) : [];
    }).filter(row => row.length > 0);
}

// =========================================================
// 🚀 [4] 시스템 최초 시동 (에러 무시 장갑차 모드 + 1번 탭 고정)
// =========================================================
async function initDashboard() {
    try {
        const response = await fetch(QUANT_CSV_URL);
        masterRawData = parseCsvToMatrix(await response.text());

        if (typeof extractGlobalMacroVariables === 'function') extractGlobalMacroVariables();
        if (typeof populateAssetDropdownSelector === 'function') populateAssetDropdownSelector();

        let selector = document.getElementById('assetSelector');
        if (masterRawData.length > 0 && selector && typeof renderTargetAssetDashboard === 'function') {
            renderTargetAssetDashboard(selector.value);
        }

        if (typeof loadPortfolioData === 'function') {
            await loadPortfolioData('init'); 
        }

        if (selector) {
            selector.addEventListener('change', (e) => {
                if (typeof renderTargetAssetDashboard === 'function') renderTargetAssetDashboard(e.target.value);
            });
        }

        switchTab('quant');

    } catch (err) { 
        console.error("데이터 초기화 실패:", err); 
    }
}

window.onload = initDashboard;

// =========================================================
// 📡 [5] 구글 시트 원장 실시간 송신 (매수/매도)
// =========================================================

// 동진님이 발급받은 실제 URL이 들어갔습니다!
const GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzzS3Wb2R3bC_P9AkA8Eq1KWLYRFk8o1w5VhTApnQQyPpT29wS1HLTfo4cOyT8AWPYl/exec"; 

async function submitTransactionLog() {
    if(!GAS_WEBHOOK_URL || GAS_WEBHOOK_URL.includes("여기에")) return alert("구글 스크립트 주소(URL)가 아직 연결되지 않았습니다!");

    const user = document.getElementById('inputLogUser').value;
    const type = document.getElementById('inputLogType').value;
    const stock = document.getElementById('inputLogStock').value;
    const price = document.getElementById('inputLogPrice').value;
    let qty = document.getElementById('inputLogQty').value;

    if(!price || !qty) return alert("단가와 수량을 정확히 입력해주세요!");

    // 핵심: 매도(Sell)일 경우 수량을 마이너스(-)로 변환하여 전송
    if(type === "매도") qty = -Math.abs(qty);

    const btn = document.getElementById('btnSubmitLog');
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 전송 중...`;
    btn.disabled = true;

    try {
        // 구글 서버로 데이터 전송 (no-cors 모드로 브라우저 차단 에러 방지)
        await fetch(`${GAS_WEBHOOK_URL}?user=${user}&type=${type}&stock=${stock}&price=${price}&qty=${qty}`, {
            method: 'GET',
            mode: 'no-cors'
        });
        
        alert(`✅ [${user}]님의 [${stock}] ${type} 기록이 원장에 저장되었습니다!\n(반영을 위해 웹사이트를 1분 뒤 새로고침 해주세요)`);
        
        // 전송 완료 후 입력칸 깔끔하게 비우기
        document.getElementById('inputLogPrice').value = "";
        document.getElementById('inputLogQty').value = "";
    } catch(e) {
        alert("❌ 전송 실패: 네트워크 상태를 확인하세요.");
    } finally {
        btn.innerHTML = `<i class="fas fa-paper-plane mr-1"></i> 전송`;
        btn.disabled = false;
    }
}

