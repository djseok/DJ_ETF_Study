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
    // 1. 모든 뷰어 섹션을 찾아서 숨김 처리
    const allViews = document.querySelectorAll('.view-section');
    allViews.forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('block');
    });

    // 2. 모든 버튼에서 '활성화(tab-active)' 디자인 제거
    const allButtons = [
        'btnTabPort', 'btnTabQuant', 'btnTabCalc', 'btnTabDiv', 
        'btnTabSingle', 'btnTabMdd', 'btnTabRsi', 'btnTabMa', 
        'btnTabBacktestDiv', 'btnTabOneDollar'
    ];
    allButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.remove('tab-active');
    });

    // 3. 선택된 탭 화면 보이기 및 버튼 하이라이트
    var capTabName = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    var activeView = document.getElementById('view' + capTabName);
    var activeBtn = document.getElementById('btnTab' + capTabName);
    
    if (activeView) {
        activeView.classList.remove('hidden');
        activeView.classList.add('block');
    }
    
    if (activeBtn) {
        activeBtn.classList.add('tab-active');
    }

    // 4. 탭 이동 시 각 화면의 초기화(로딩) 함수 실행
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

        // 초기 화면을 '내 대시보드 메인(클럽 현황)'으로 고정
        switchTab('port');
    } catch (err) { 
        console.error("데이터 초기화 실패:", err); 
    }
}

window.onload = initDashboard;
