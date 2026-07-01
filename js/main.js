// =========================================================
// 🌐 [1] 전역 변수 및 마스터 API 설정
// =========================================================
// 🔥 방금 구글 Apps Script에서 발급받은 '새로운 웹 앱 URL'을 아래에 넣으세요!
const GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwbPc0b9iMd025VEGp9vYIyM7ddnbzA0NyThx15bJl_BdmZSZ4cHj5DfNx4SzIni7OV/exec"; 

const timestamp = new Date().getTime();

// 기존 포트폴리오 및 배당 이력 CSV (이것들은 유지)
const PORTFOLIO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=539824393&single=true&output=csv&t=" + timestamp;
const DIVIDEND_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1285467029&single=true&output=csv&t=" + timestamp;
const ACTUAL_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1276756215&single=true&output=csv&t=" + timestamp;

let macroData = [];    // Characteristic 시트에서 넘어온 JSON 데이터
let signalData = [];   // ETF_Quant_Signals 시트에서 넘어온 JSON 데이터
let globalFxDelta = 0;
let globalVixValue = 15;

// =========================================================
// 🎛️ [2] 탭 전환 및 컨트롤러 (유지)
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
    if(tabName === 'port' && typeof loadPortfolioData === 'function') loadPortfolioData('port');
}

// =========================================================
// 🚀 [3] 시스템 최초 시동 (JSON Fetch 로직으로 업그레이드)
// =========================================================
async function initDashboard() {
    try {
        // 1. GAS API 서버에서 매크로/퀀트 데이터를 한 번에 JSON으로 받아옵니다.
        const response = await fetch(GAS_WEBHOOK_URL);
        const data = await response.json();
        
        macroData = data.macro || [];
        signalData = data.signals || [];

        // 2. 받아온 데이터를 바탕으로 퀀트 화면 렌더링
        if (typeof extractGlobalMacroVariables === 'function') extractGlobalMacroVariables();
        if (typeof populateAssetDropdownSelector === 'function') populateAssetDropdownSelector();

        let selector = document.getElementById('assetSelector');
        if (signalData.length > 0 && selector && typeof renderTargetAssetDashboard === 'function') {
            renderTargetAssetDashboard(selector.value);
        }

        if (selector) {
            selector.addEventListener('change', (e) => {
                if (typeof renderTargetAssetDashboard === 'function') renderTargetAssetDashboard(e.target.value);
            });
        }
        switchTab('quant');

    } catch (err) { 
        console.error("데이터 초기화 실패 (API를 확인하세요):", err); 
    }
}

window.onload = initDashboard;

// =========================================================
// 📡 [4] 구글 시트 원장 실시간 송신 (매수/매도) 
// =========================================================
async function submitTransactionLog() {
    if(!GAS_WEBHOOK_URL || GAS_WEBHOOK_URL.includes("여기에")) return alert("구글 스크립트 주소(URL)가 연결되지 않았습니다!");

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
