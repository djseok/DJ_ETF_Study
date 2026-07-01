// =========================================================
// 🌐 [1] 전역 변수 및 분할 시트(CSV) 주소 설정 (V12.2 최종본)
// =========================================================
const timestamp = new Date().getTime();

// 🔥 1. 매크로 지표 시트 (Characteristic) CSV 링크
const MACRO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=2016694665&single=true&output=csv&t=" + timestamp;

// 🔥 2. 퀀트 신호 시트 (ETF_Quant_Signals) CSV 링크
const SIGNAL_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1985460214&single=true&output=csv&t=" + timestamp;

// 기존 포트폴리오 및 배당금 시트 (유지)
const PORTFOLIO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=539824393&single=true&output=csv&t=" + timestamp;
const DIVIDEND_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1285467029&single=true&output=csv&t=" + timestamp;
const ACTUAL_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1276756215&single=true&output=csv&t=" + timestamp;

// 매수/매도 실시간 전송용 구글 스크립트 웹앱 URL (기존에 쓰시던 것 유지)
const GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzzS3Wb2R3bC_P9AkA8Eq1KWLYRFk8o1w5VhTApnQQyPpT29wS1HLTfo4cOyT8AWPYl/exec"; 

let macroData = [];
let signalData = [];
let globalFxDelta = 0;
let globalVixValue = 15;
let globalParsedUsers = {}; 
let globalCalculatedStrategyDividends = {}; 
let globalActualDividendLogs = [];

const DIVIDEND_SCHEME_MATRIX = {
    "KODEX 미국나스닥100데일리커버드콜OTM": { strategy: "recent3", payMonths: [1,2,3,4,5,6,7,8,9,10,11,12] },    
    "TIGER 미국배당다우존스": { strategy: "rolling12", payMonths: [1,2,3,4,5,6,7,8,9,10,11,12] }, 
    "RISE 미국나스닥100": { strategy: "latest", payMonths: [3,6,9,12] },       
    "KODEX 미국반도체": { strategy: "latest", payMonths: [1,4,7,10] },        
    "RISE 미국S&P500": { strategy: "latest", payMonths: [3,6,9,12] },         
    "KODEX 미국S&P500": { strategy: "latest", payMonths: [1,4,7,10] },        
    "TIME 글로벌AI인공지능액티브": { strategy: "allAverage", payMonths: [1,4,7,10] } 
};

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
    if(tabName === 'port' && typeof loadPortfolioData === 'function') loadPortfolioData('port');
    else if(tabName === 'div' && typeof loadPortfolioData === 'function') loadPortfolioData('div');
    else if(tabName === 'calc' && typeof loadPortfolioData === 'function') loadPortfolioData('calc');
    else if(tabName === 'conc' && typeof loadPortfolioData === 'function') loadPortfolioData('conc');
}

function parseCsvToMatrix(text) {
    return text.split('\n').map(row => {
        let match = row.match(/(".*?"|[^",\r\n]+)(?=\s*,|\s*$|\r|$)/g);
        return match ? match.map(val => val.replace(/^"|"$/g, '').trim()) : [];
    }).filter(row => row.length > 0);
}

// =========================================================
// 🚀 [2] 시스템 최초 시동 (멀티 CSV Fetch 로직)
// =========================================================
async function initDashboard() {
    try {
        // 2개의 CSV 데이터를 병렬로 동시에 불러옵니다 (속도 대폭 향상)
        const [macroRes, signalRes] = await Promise.all([
            fetch(MACRO_CSV_URL).catch(() => null),
            fetch(SIGNAL_CSV_URL).catch(() => null)
        ]);

        if (macroRes) macroData = parseCsvToMatrix(await macroRes.text());
        if (signalRes) signalData = parseCsvToMatrix(await signalRes.text());

        if (typeof extractGlobalMacroVariables === 'function') extractGlobalMacroVariables();
        if (typeof populateAssetDropdownSelector === 'function') populateAssetDropdownSelector();

        let selector = document.getElementById('assetSelector');
        if (signalData.length > 0 && selector && typeof renderTargetAssetDashboard === 'function') {
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
// 📡 [3] 구글 시트 원장 실시간 송신 (매수/매도) 
// =========================================================
async function submitTransactionLog() {
    if(!GAS_WEBHOOK_URL || GAS_WEBHOOK_URL.includes("여기에")) return alert("구글 스크립트 주소(URL)가 아직 연결되지 않았습니다!");

    const user = document.getElementById('inputLogUser').value;
    const type = document.getElementById('inputLogType').value;
    const stock = document.getElementById('inputLogStock').value;
    const price = document.getElementById('inputLogPrice').value;
    let qty = document.getElementById('inputLogQty').value;

    if(!user) return alert("사용자 이름을 입력해주세요!");
    if(!price || !qty || isNaN(price) || isNaN(qty)) return alert("단가와 수량을 정확히 입력해주세요!");

    if(type === "매도") qty = -Math.abs(qty);

    const btn = document.getElementById('btnSubmitLog');
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 전송 중...`;
    btn.disabled = true;

    try {
        const url = `${GAS_WEBHOOK_URL}?user=${encodeURIComponent(user)}&type=${encodeURIComponent(type)}&stock=${encodeURIComponent(stock)}&price=${price}&qty=${qty}`;
        await fetch(url, { method: 'GET', mode: 'no-cors' });
        
        alert(`✅ [${user}]님의 기록이 포트폴리오에 성공적으로 반영되었습니다!\n(확인을 위해 최신 데이터를 불러옵니다.)`);
        setTimeout(() => { location.reload(); }, 1500);

    } catch(e) {
        console.error(e);
        alert("❌ 전송 실패: 네트워크 상태를 확인하세요.");
        btn.innerHTML = `<i class="fas fa-paper-plane mr-1"></i> 전송`;
        btn.disabled = false;
    }
}
