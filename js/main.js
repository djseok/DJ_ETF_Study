// =========================================================
// 🌐 [1] 전역 변수 및 분할 시트(CSV) 주소 설정 (V13.0 배당 탭 트리거 패치)
// =========================================================
const timestamp = new Date().getTime();

// 1. 매크로 지표 시트 (Characteristic) CSV 링크
const MACRO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=2016694665&single=true&output=csv&t=" + timestamp;
// 2. 퀀트 신호 시트 (ETF_Quant_Signals) CSV 링크
const SIGNAL_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1985460214&single=true&output=csv&t=" + timestamp;
// 3. 개별 종목 마스터 시트 (MasterData) CSV 링크
const MASTER_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=223914478&single=true&output=csv&t=" + timestamp;
// 4. 개인 포트폴리오 및 배당금 시트
const PORTFOLIO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=539824393&single=true&output=csv&t=" + timestamp;
// 🚨 (수정됨) 1276756215 가 ETF 배당 과거 이력 시트입니다!
const DIVIDEND_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1276756215&single=true&output=csv&t=" + timestamp;
// 🚨 (수정됨) 1285467029 가 팀원들의 통장 실수령액 관리 시트입니다!
const ACTUAL_DIV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1285467029&single=true&output=csv&t=" + timestamp;
const GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzzS3Wb2R3bC_P9AkA8Eq1KWLYRFk8o1w5VhTApnQQyPpT29wS1HLTfo4cOyT8AWPYl/exec"; 

let macroData = [];
let signalData = [];
let masterData = []; 
let globalFxDelta = 0;
let globalVixValue = 15;
let globalParsedUsers = {}; 
let globalCalculatedStrategyDividends = {}; 
let globalActualDividendLogs = [];

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
    // 탭을 전환할 때 데이터 유실 방지 및 자동 타겟 렌더링
    if(tabName === 'port' && typeof loadPortfolioData === 'function') loadPortfolioData('port');
    if(tabName === 'calc' && typeof renderCalculatorView === 'function') renderCalculatorView();
    
    // 🔥 [추가된 부분] 배당 탭 클릭 시 배당 데이터를 자동으로 불러오도록 트리거 설정!
    if(tabName === 'div') {
        if(typeof loadDividendHistoryData === 'function') loadDividendHistoryData();
        if(typeof loadActualDividendData === 'function') loadActualDividendData();
    }
}

// 연속된 쉼표(빈 칸)를 건너뛰지 않고 방어하는 표준 CSV 매트릭스 변환 함수
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
        
        // 대시보드 구동 시 배경에서 포트폴리오 데이터를 미리 파싱해 둡니다.
        if (typeof loadPortfolioData === 'function') {
            await loadPortfolioData('init'); 
        }

        switchTab('quant');
    } catch (err) { 
        console.error("데이터 초기화 실패:", err); 
    }
}

window.onload = initDashboard;
