// =========================================================
// 🌐 [1] 전역 변수 및 분할 시트(CSV) 주소 설정 (V16.0 마스터 통합 패치)
// =========================================================
const timestamp = new Date().getTime();

// 1. 매크로 지표 시트 (Characteristic) CSV 링크
const MACRO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=2016694665&single=true&output=csv&t=" + timestamp;

// 2. 퀀트 신호 시트 (ETF_Quant_Signals) CSV 링크
const SIGNAL_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1985460214&single=true&output=csv&t=" + timestamp;

// 3. 개별 종목 마스터 시트 (MasterData) CSV 링크
const MASTER_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=223914478&single=true&output=csv&t=" + timestamp;

// 4. 🔥 [통합] 개인 포트폴리오 및 실수령 배당금 합본 CSV 링크
const PORTFOLIO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=449713965&single=true&output=csv&t=" + timestamp;

// 5. 누적 배당 이력(예상배당금) GID
const DIVIDEND_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1285467029&single=true&output=csv&t=" + timestamp;

let macroData = [];
let signalData = [];
let masterData = []; 
let globalFxDelta = 0;
let globalVixValue = 15;
let globalParsedUsers = {}; 
let globalCalculatedStrategyDividends = {}; 
let globalActualDividendLogs = []; // 실수령 배당금 데이터 담을 그릇

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
    if(tabName === 'calc' && typeof renderCalculatorView === 'function') renderCalculatorView();
    if(tabName === 'div') {
        if(typeof loadDividendHistoryData === 'function') loadDividendHistoryData();
        // 포트폴리오 엔진에서 배당금을 이미 파싱했으므로 화면만 그려줍니다.
        if(typeof window.renderActualDividendView === 'function') window.renderActualDividendView();
    }
}

function parseCsvToMatrix(text) {
    if (!text) return [];
    return text.split('\n').map(line => {
        let result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            let char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim().replace(/^"|"$/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim().replace(/^"|"$/g, ''));
        return result;
    }).filter(row => row.length > 0 && row[0] !== '');
}

async function initDashboard() {
    try {
        const [macroRes, signalRes, masterRes] = await Promise.all([
            fetch(MACRO_CSV_URL).catch(() => null),
            fetch(SIGNAL_CSV_URL).catch(() => null),
            fetch(MASTER_CSV_URL).catch(() => null)
        ]);

        if (macroRes) macroData = parseCsvToMatrix(await macroRes.text());
        if (signalRes) signalData = parseCsvToMatrix(await signalRes.text());
        if (masterRes) masterData = parseCsvToMatrix(await masterRes.text()); 

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
        
        // 포트폴리오 및 배당금 데이터 동시 사전 로드
        if (typeof loadPortfolioData === 'function') {
            await loadPortfolioData('init'); 
        }

        switchTab('quant');
    } catch (err) { 
        console.error("데이터 초기화 실패:", err); 
    }
}

window.onload = initDashboard;
