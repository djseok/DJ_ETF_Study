// 🌐 전역 변수 및 시트 주소 설정
const timestamp = new Date().getTime();
const QUANT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=0&single=true&output=csv&t=" + timestamp;
const PORTFOLIO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=539824393&single=true&output=csv&t=" + timestamp;
const DIVIDEND_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1285467029&single=true&output=csv&t=" + timestamp;
const ACTUAL_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1276756215&single=true&output=csv&t=" + timestamp;

let masterRawData = [];
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

const ETF_COMPOSITION_MATRIX = {
    "KODEX 미국반도체": { "NVIDIA (NVDA)": 0.25, "AMD (AMD)": 0.10, "TSMC (TSM)": 0.10 },
    "TIME 글로벌AI인공지능액티브": { "NVIDIA (NVDA)": 0.18, "Microsoft (MSFT)": 0.15, "Alphabet (GOOGL)": 0.10, "Meta (META)": 0.08 },
    "RISE 미국나스닥100": { "Microsoft (MSFT)": 0.09, "Apple (AAPL)": 0.09, "NVIDIA (NVDA)": 0.08, "Amazon (AMZN)": 0.05, "Tesla (TSLA)": 0.03 },
    "KODEX 미국나스닥100데일리커버드콜OTM": { "Microsoft (MSFT)": 0.09, "Apple (AAPL)": 0.09, "NVIDIA (NVDA)": 0.08, "Amazon (AMZN)": 0.05, "Tesla (TSLA)": 0.03 },
    "TIGER 미국배당다우존스": { "Broadcom (AVGO)": 0.05, "Home Depot (HD)": 0.04, "Texas Instruments (TXN)": 0.04 },
    "RISE 미국S&P500": { "Microsoft (MSFT)": 0.07, "Apple (AAPL)": 0.06, "NVIDIA (NVDA)": 0.06 },
    "KODEX 미국S&P500": { "Microsoft (MSFT)": 0.07, "Apple (AAPL)": 0.06, "NVIDIA (NVDA)": 0.06 }
};

// 탭 전환 기능
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
    if(['port', 'calc', 'conc', 'div'].includes(tabName)) loadPortfolioData(tabName);
}

function parseCsvToMatrix(text) {
    return text.split('\n').map(row => {
        let match = row.match(/(".*?"|[^",\r\n]+)(?=\s*,|\s*$|\r|$)/g);
        return match ? match.map(val => val.replace(/^"|"$/g, '').trim()) : [];
    }).filter(row => row.length > 0);
}

// 초기화 함수: 수정됨 (데이터 로딩 순서 보장)
async function initDashboard() {
    try {
        const response = await fetch(QUANT_CSV_URL);
        masterRawData = parseCsvToMatrix(await response.text());
        extractGlobalMacroVariables();
        populateAssetDropdownSelector();
        
        if(masterRawData.length > 0) renderTargetAssetDashboard(document.getElementById('assetSelector').value);
        
        // 데이터 동기화 강제
        await loadPortfolioData('init'); 

        document.getElementById('assetSelector').addEventListener('change', (e) => renderTargetAssetDashboard(e.target.value));
        document.getElementById('inputCash').addEventListener('input', () => {
            if(!document.getElementById('viewCalc').classList.contains('hidden')) calculateRebalancing();
        });
    } catch (err) { console.error("데이터 초기화 실패:", err); }
}

window.onload = initDashboard;
