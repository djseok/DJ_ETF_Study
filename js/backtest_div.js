// =========================================================
// 📈 10년 장기 적립식 복리 시뮬레이터 (버그 완벽 수정본)
// =========================================================
function update10YearChart(initialInvestment, monthlyAdd, monthlyNetDiv) {
    if (initialInvestment <= 0 && monthlyAdd <= 0) return;

    // 1. 강제 연산(덮어쓰기) 제거: 화면에 입력된 값을 100% 그대로 신뢰하여 가져옵니다.
    const cagrMap = {
        kospi: parseFloat(document.getElementById('cagrKospi')?.value) || 3,
        kosdaq: parseFloat(document.getElementById('cagrKosdaq')?.value) || 4,
        ndx: parseFloat(document.getElementById('cagrNdx')?.value) || 15,
        qld: parseFloat(document.getElementById('cagrQld')?.value) || 28,
        tqqq: parseFloat(document.getElementById('cagrTqqq')?.value) || 38,
        spy: parseFloat(document.getElementById('cagrSpy')?.value) || 10,
        sso: parseFloat(document.getElementById('cagrSso')?.value) || 18,
        upro: parseFloat(document.getElementById('cagrUpro')?.value) || 24,
        base: parseFloat(document.getElementById('cagrBase')?.value) || 0
    };

    const isDripOption = document.querySelector('input[name="dripOption"]:checked');
    const isDrip = isDripOption ? isDripOption.value === 'drip' : false;
    
    const dripTargetEl = document.getElementById('dripTarget');
    const dripTarget = dripTargetEl ? dripTargetEl.value : 'spy';
    const targetCagr = cagrMap[dripTarget];

    const labels = [];
    const dataPrincipalOnly = [];  
    const dataDripGains = [];      
    const dataBenchmark = [];      

    // 2. 이중 복리 버그 제거: 매월 1번씩만 정확하게 복리가 쌓이도록 루프 구조 전면 개편
    let bmMonthlyRate = Math.pow(1 + targetCagr / 100, 1 / 12) - 1;
    let baseMonthlyRate = Math.pow(1 + cagrMap.base / 100, 1 / 12) - 1;

    let currentBmValue = initialInvestment;
    let portBaseValue = initialInvestment;
    let portAddValue = 0;
    let reinvestBucket = 0; 

    // 0년차 (초기 거치 상태) 삽입
    labels.push('0년차');
    dataBenchmark.push(Math.floor(currentBmValue));
    dataPrincipalOnly.push(Math.floor(portBaseValue));
    dataDripGains.push(0);

    for (let year = 1; year <= 10; year++) {
        labels.push(`${year}년차`);
        
        // 1년(12개월) 동안의 정밀한 현금흐름 시뮬레이션
        for (let m = 1; m <= 12; m++) {
            // 벤치마크: 이전 달 자산에 월 복리 적용 + 새 적립금 투입
            currentBmValue = currentBmValue * (1 + bmMonthlyRate) + monthlyAdd;
            
            // 내 포트 거치 원금: Base 성장률 적용
            portBaseValue = portBaseValue * (1 + baseMonthlyRate);
            
            // 내 포트 월 적립금: Base 성장률 적용 + 새 적립금 투입
            portAddValue = portAddValue * (1 + baseMonthlyRate) + monthlyAdd;
            
            // 배당 재투자: 이전 달까지 모인 배당 눈덩이에 지수 월 복리 적용 + 이번 달 새 배당금 투입
            if (isDrip) {
                reinvestBucket = reinvestBucket * (1 + bmMonthlyRate) + monthlyNetDiv;
            }
        }

        const totalPrincipalGrowth = portBaseValue + portAddValue; 
        dataPrincipalOnly.push(Math.floor(totalPrincipalGrowth));
        dataDripGains.push(Math.floor(reinvestBucket)); 
        dataBenchmark.push(Math.floor(currentBmValue));
    }

    const canvasEl = document.getElementById('div10YearChart');
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (div10YearChartInstance) div10YearChartInstance.destroy();

    const bmNameMap = {
        'spy': 'S&P 500 (SPY)', 'ndx': '나스닥 100 (QQQ)', 'qld': '나스닥 2배 (QLD)',
        'tqqq': '나스닥 3배 (TQQQ)', 'sso': 'S&P 2배 (SSO)', 'upro': 'S&P 3배 (UPRO)',
        'kospi': '코스피', 'kosdaq': '코스닥'
    };
    const bmLabel = bmNameMap[dripTarget] + ' 100% 거치/적립식';

    div10YearChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'line',
                    label: `벤치마크 비교군: ${bmLabel}`,
                    data: dataBenchmark,
                    borderColor: '#f97316', 
                    borderWidth: 3,
                    borderDash: [5, 5],
                    pointBackgroundColor: '#f97316',
                    pointRadius: 4,
                    fill: false,
                    order: 0
                },
                {
                    type: 'bar',
                    label: isDrip ? `배당 재투자 수익금 (${dripTarget.toUpperCase()} 복리)` : '배당금 전액 소모 (수익 없음)',
                    data: dataDripGains,
                    backgroundColor: '#10b981', 
                    borderWidth: 0,
                    stack: 'Stack 0', 
                    order: 1
                },
                {
                    type: 'bar',
                    label: '순수 투입 원금 (초기 거치 + 월 적립 누적)',
                    data: dataPrincipalOnly,
                    backgroundColor: '#1e293b', 
                    borderWidth: 0,
                    stack: 'Stack 0', 
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { font: { weight: 'bold' } } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + fmtNum(context.parsed.y) + '원';
                        },
                        footer: function(tooltipItems) {
                            let totalPort = 0;
                            tooltipItems.forEach(item => {
                                if (item.dataset.type === 'bar') {
                                    totalPort += item.parsed.y;
                                }
                            });
                            return '내 배당 포트 총자산: ' + fmtNum(totalPort) + '원';
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { weight: 'bold' } } },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            if(value >= 100000000) return (value / 100000000).toFixed(1) + '억';
                            if(value >= 10000) return (value / 10000).toFixed(0) + '만';
                            return value;
                        },
                        font: { weight: 'bold' }
                    },
                    grid: { color: '#f1f5f9' }
                }
            }
        }
    });
}

function setupEventListeners() {
    const totalInput = document.getElementById('simTotalAsset');
    if(totalInput) totalInput.addEventListener('input', syncAllFromTotal);

    // 3. 1배수 지수를 수정할 때만 레버리지 칸이 자동 연동되도록 이벤트 분리 (수동 입력 완벽 보장)
    const ndxInput = document.getElementById('cagrNdx');
    if(ndxInput) {
        ndxInput.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value) || 0;
            document.getElementById('cagrQld').value = (val * 2) - 5;
            document.getElementById('cagrTqqq').value = (val * 3) - 12;
            runPortfolioSimulator();
        });
    }

    const spyInput = document.getElementById('cagrSpy');
    if(spyInput) {
        spyInput.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value) || 0;
            document.getElementById('cagrSso').value = (val * 2) - 3;
            document.getElementById('cagrUpro').value = (val * 3) - 8;
            runPortfolioSimulator();
        });
    }

    // 나머지 입력칸들도 수정 시 차트가 바로 반응하도록 연결
    const otherInputs = ['cagrKospi', 'cagrKosdaq', 'cagrQld', 'cagrTqqq', 'cagrSso', 'cagrUpro', 'cagrBase'];
    otherInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', runPortfolioSimulator);
    });

    const dripOptions = document.querySelectorAll('input[name="dripOption"]');
    const dripTargetSelect = document.getElementById('dripTarget');

    dripOptions.forEach(opt => {
        opt.addEventListener('change', (e) => {
            if(dripTargetSelect) dripTargetSelect.disabled = e.target.value !== 'drip';
            runPortfolioSimulator();
        });
    });

    if(dripTargetSelect) dripTargetSelect.addEventListener('change', runPortfolioSimulator);
}
