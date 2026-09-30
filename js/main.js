// =========================================================
// 🌐 [1] 전역 변수 및 분할 시트(CSV) 주소 설정 (V19.1 검색필터 장착)
// =========================================================
// 시트 주소는 js/common.js 의 APP_CONFIG 에서 관리합니다
var MACRO_CSV_URL = sheetUrl('MACRO');
var SIGNAL_CSV_URL = sheetUrl('SIGNAL');
var MASTER_CSV_URL = sheetUrl('MASTER');
var PORTFOLIO_CSV_URL = sheetUrl('PORTFOLIO');
var DIVIDEND_RULES_CSV_URL = sheetUrl('DIVIDEND_RULES');

var macroData = [];
var signalData = [];
var masterData = []; 
var globalFxDelta = 0;
var globalVixValue = 15;
var globalParsedUsers = {}; 
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
        'btnTabBacktestDiv', 'btnTabOneDollar', 'btnTabPortBt'
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
    if(tabName === 'calc' && typeof renderCalculatorView === 'function') {
        // 포트폴리오 데이터가 아직 로딩 중이면 끝난 뒤에 계산기를 그립니다
        Promise.resolve(typeof loadPortfolioData === 'function' ? loadPortfolioData('calc') : null).then(renderCalculatorView);
    }
    if(tabName === 'div' && typeof window.renderActualDividendView === 'function') window.renderActualDividendView();
    if(tabName === 'oneDollar' && typeof loadDollarData === 'function') loadDollarData();
    if(tabName === 'backtestDiv' && typeof fetchBacktestMasterData === 'function') fetchBacktestMasterData();
    if(tabName === 'portBt' && typeof initPortfolioBacktestView === 'function') initPortfolioBacktestView();
}

// parseCsvToMatrix 는 js/common.js 로 이동

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
