// =========================================================
// 🌐 [1] 전역 변수 및 분할 시트(CSV) 주소 설정 (V19.1 검색필터 장착)
// =========================================================
var timestamp = new Date().getTime();

var MACRO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=2016694665&single=true&output=csv&t=" + timestamp;
var SIGNAL_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1985460214&single=true&output=csv&t=" + timestamp;
var MASTER_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=223914478&single=true&output=csv&t=" + timestamp;
var PORTFOLIO_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=449713965&single=true&output=csv&t=" + timestamp;
var DIVIDEND_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1285467029&single=true&output=csv&t=" + timestamp;
var DIVIDEND_RULES_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=686768122&single=true&output=csv&t=" + timestamp;

var macroData = [];
var signalData = [];
var masterData = []; 
var globalFxDelta = 0;
var globalVixValue = 15;
var globalParsedUsers = {}; 
var globalCalculatedStrategyDividends = {}; 
var globalActualDividendLogs = []; 
var globalDividendRulesMatrix = {}; 

function switchTab(tabName) {
    // 배열에 새로 추가한 탭 'BacktestDiv' 포함
    var tabs = ['Quant', 'Port', 'Calc', 'Div', 'Mdd', 'Rsi', 'OneDollar', 'BacktestDiv'];
    
    for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var view = document.getElementById('view' + t);
        var btn = document.getElementById('btnTab' + t);
        if(view) {
            view.classList.add('hidden');
            view.classList.remove('block');
        }
        if(btn) {
            btn.className = "flex-1 py-3 bg-white text-slate-600 rounded-xl font-bold shadow-sm border border-slate-200 transition-all hover:bg-slate-50 whitespace-nowrap";
        }
    }
    
    var capTabName = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    var activeView = document.getElementById('view' + capTabName);
    var activeBtn = document.getElementById('btnTab' + capTabName);
    
    if(activeView) {
        activeView.classList.remove('hidden');
        activeView.classList.add('block');
    }
    
    if(activeBtn) {
        if(tabName === 'div') activeBtn.className = "flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold shadow-md transition-all whitespace-nowrap";
        else if(tabName === 'mdd') activeBtn.className = "flex-1 py-3 bg-red-600 text-white rounded-xl font-bold shadow-md transition-all whitespace-nowrap";
        else if(tabName === 'rsi') activeBtn.className = "flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold shadow-md transition-all whitespace-nowrap";
        else if(tabName === 'oneDollar') activeBtn.className = "flex-1 py-3 bg-slate-800 text-white rounded-xl font-bold shadow-sm border border-slate-200 transition-all hover:bg-yellow-50 whitespace-nowrap text-yellow-500";
        else if(tabName === 'backtestDiv') activeBtn.className = "flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-sm border border-slate-200 transition-all whitespace-nowrap";
        else activeBtn.className = "flex-1 py-3 bg-slate-800 text-white rounded-xl font-bold shadow-md transition-all whitespace-nowrap";
    }

    if(tabName === 'port' && typeof loadPortfolioData === 'function') loadPortfolioData('port');
    if(tabName === 'calc' && typeof renderCalculatorView === 'function') renderCalculatorView();
    if(tabName === 'div' && typeof window.renderActualDividendView === 'function') window.renderActualDividendView();
    if(tabName === 'oneDollar' && typeof loadDollarData === 'function') loadDollarData();
    if(tabName === 'backtestDiv' && typeof fetchBacktestMasterData === 'function') fetchBacktestMasterData();
}

function parseCsvToMatrix(text) {
    if (!text) return [];
    text = text.replace(/^\uFEFF/, '');
    var lines = text.split('\n');
    var result = [];
    
    for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (!line || line.trim() === '') continue;
        
        var rowResult = [];
        var current = '';
        var inQuotes = false;
        
        for (var i = 0; i < line.length; i++) {
            var char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                rowResult.push((current || '').trim().replace(/^"|"$/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        rowResult.push((current || '').trim().replace(/^"|"$/g, ''));
        
        var isAllEmpty = rowResult.every(val => val === '');
        if (!isAllEmpty) {
            result.push(rowResult);
        }
    }
    return result;
}

async function initDashboard() {
    try {
        const [macroRes, signalRes, masterRes] = await Promise.all([
            fetch(MACRO_CSV_URL).catch(function(){ return null; }),
            fetch(SIGNAL_CSV_URL).catch(function(){ return null; }),
            fetch(MASTER_CSV_URL).catch(function(){ return null; })
        ]);

        if (macroRes) macroData = parseCsvToMatrix(await macroRes.text());
        if (signalRes) signalData = parseCsvToMatrix(await signalRes.text());
        if (masterRes) masterData = parseCsvToMatrix(await masterRes.text()); 

        if (typeof extractGlobalMacroVariables === 'function') extractGlobalMacroVariables();
        if (typeof initFilters === 'function') initFilters(); 
        if (typeof populateAssetDropdownSelector === 'function') populateAssetDropdownSelector();

        var selector = document.getElementById('assetSelector');
        if (signalData.length > 0 && selector && typeof renderTargetAssetDashboard === 'function') {
            renderTargetAssetDashboard(selector.value);
        }

        if (selector) {
            selector.addEventListener('change', function(e) {
                if (typeof renderTargetAssetDashboard === 'function') renderTargetAssetDashboard(e.target.value);
            });
        }
        
        if (typeof loadPortfolioData === 'function') {
            await loadPortfolioData('init'); 
        }

        switchTab('quant');
    } catch (err) { 
        console.error("데이터 초기화 실패:", err); 
    }
}

window.onload = initDashboard;
