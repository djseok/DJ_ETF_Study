// ==========================================
// 📉 실시간 API 연동 MDD 언더워터 차트 엔진
// ==========================================

let mddChartInstance = null; // 차트 중복 생성을 막기 위한 전역 변수

async function runMDDCalculation() {
    const ticker = document.getElementById('mdd-price-input').value.trim().toUpperCase();
    const resultDisplay = document.getElementById('mdd-result-display');

    if (!ticker) {
        resultDisplay.innerHTML = "⚠️ 종목 티커를 입력해주세요. (예: NVDA, SPY)";
        resultDisplay.style.color = "#64748b";
        return;
    }

    resultDisplay.innerHTML = `<i class="fas fa-circle-notch fa-spin text-blue-400"></i> <b>${ticker}</b> 과거 5년치 데이터를 시각화하는 중입니다... 🐕⏳`;
    resultDisplay.style.color = "#64748b";

    try {
        // 1. 야후 파이낸스 데이터 호출 (최근 5년, 1주일 간격 데이터가 차트 그리기에 가장 빠르고 깔끔함)
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5y&interval=1wk`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`서버 응답 오류: ${response.status}`);
        
        const data = await response.json();
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
            throw new Error("종목 없음");
        }

        const timestamps = data.chart.result[0].timestamp;
        const rawPrices = data.chart.result[0].indicators.quote[0].close;

        // 2. 날짜 및 가격 데이터 정제 (null 값 제거)
        let dates = [];
        let prices = [];
        for(let i=0; i<rawPrices.length; i++) {
            if(rawPrices[i] !== null) {
                // 타임스탬프를 YYYY-MM-DD 형식으로 변환
                const dateObj = new Date(timestamps[i] * 1000);
                dates.push(`${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`);
                prices.push(rawPrices[i]);
            }
        }

        if (prices.length < 2) throw new Error("데이터 부족");

        // 3. 언더워터(Drawdown) 시계열 계산 로직
        let peak = prices[0];
        let maxDrawdown = 0;
        let drawdowns = [];

        for (let i = 0; i < prices.length; i++) {
            if (prices[i] > peak) {
                peak = prices[i]; // 전고점 갱신
            }
            // 그 날짜의 하락률 계산 (음수로 저장)
            const currentDrawdown = ((prices[i] - peak) / peak) * 100;
            drawdowns.push(currentDrawdown);
            
            // 역대 최고 하락률 찾기 (절댓값이 가장 큰 음수)
            if (currentDrawdown < maxDrawdown) {
                maxDrawdown = currentDrawdown;
            }
        }

        // 4. 상단 텍스트 결과 출력
        if (maxDrawdown === 0) {
             resultDisplay.innerHTML = `👏 <b>${ticker}</b> 최근 5년간 MDD: 0.00% <br><span class="text-sm font-normal text-slate-500">가격 하락 없이 우상향했습니다.</span>`;
             resultDisplay.style.color = "#10b981";
        } else {
             resultDisplay.innerHTML = `
                🚨 <b>${ticker}</b> 최근 5년 최대 낙폭(MDD): ${maxDrawdown.toFixed(2)}% <br>
                <span class="text-sm font-normal text-slate-500">아래 차트의 붉은 면적이 깊을수록 고점 대비 많이 물려있던 뼈아픈 시기입니다.</span>
             `;
             resultDisplay.style.color = "#ef4444";
        }

        // 5. Chart.js 로 언더워터 차트 그리기
        drawUnderwaterChart(dates, drawdowns, ticker);

    } catch (error) {
        console.error(error);
        resultDisplay.innerHTML = `❌ <b>${ticker}</b> 데이터를 불러오지 못했습니다.<br><span class="text-sm font-normal text-slate-500">티커를 확인하거나 잠시 후 다시 시도해주세요.</span>`;
        resultDisplay.style.color = "#ef4444";
    }
}

// 🎨 차트 렌더링 함수
function drawUnderwaterChart(dates, drawdowns, ticker) {
    const ctx = document.getElementById('mddChartCanvas').getContext('2d');

    // 기존에 그려진 차트가 있다면 지워야 에러가 안 남
    if (mddChartInstance) {
        mddChartInstance.destroy();
    }

    mddChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: `${ticker} Drawdown (%)`,
                data: drawdowns,
                borderColor: 'rgba(239, 68, 68, 1)',   // 테두리 붉은색
                backgroundColor: 'rgba(239, 68, 68, 0.2)', // 속을 채울 투명한 붉은색
                borderWidth: 1.5,
                fill: true,       // 0% 선 아래로 색칠하기
                pointRadius: 0,   // 점 숨기기 (깔끔하게 선만 보이게)
                tension: 0.1      // 살짝 부드러운 곡선
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8 } // 날짜 너무 많으면 텍스트 겹치므로 제한
                },
                y: {
                    beginAtZero: true,
                    max: 0, // y축 맨 위를 0%로 고정 (물수면)
                    ticks: {
                        callback: function(value) {
                            return value + '%'; // y축 라벨에 % 붙이기
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `하락률: ${context.parsed.y.toFixed(2)}%`;
                        }
                    }
                },
                legend: { display: false } // 상단 범례 숨기기
            }
        }
    });
}

// 엔터키 연동
document.addEventListener('DOMContentLoaded', () => {
    const mddInput = document.getElementById('mdd-price-input');
    if(mddInput) {
        mddInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') runMDDCalculation();
        });
    }
});
