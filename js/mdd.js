// ==========================================
// 📉 실시간 API 연동 MDD (최대 낙폭) 계산기 (V2 안정화 버전)
// ==========================================

async function runMDDCalculation() {
    // 1. 입력된 티커 가져오기 (공백 제거 및 대문자 변환)
    const ticker = document.getElementById('mdd-price-input').value.trim().toUpperCase();
    const resultDisplay = document.getElementById('mdd-result-display');

    if (!ticker) {
        resultDisplay.innerHTML = "⚠️ 종목 티커를 입력해주세요. (예: NVDA, SPY)";
        resultDisplay.style.color = "#64748b";
        return;
    }

    // 로딩 중 표시
    resultDisplay.innerHTML = `<i class="fas fa-circle-notch fa-spin text-red-400"></i> <b>${ticker}</b> 과거 1년 데이터를 불러오는 중입니다... 🐕⏳`;
    resultDisplay.style.color = "#64748b";

    try {
        // 2. 야후 파이낸스 API 주소 생성 (최근 1년, 1일 간격 데이터)
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
        
        // ✨ 해결 포인트: 더 강력하고 안정적인 corsproxy.io 로 우회 터널 교체
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        // API 데이터 호출
        const response = await fetch(proxyUrl);
        
        // 서버가 터졌을 때 방어
        if (!response.ok) {
            throw new Error(`서버 응답 오류: ${response.status}`);
        }
        
        // corsproxy는 데이터를 한 번 더 감싸지 않고 원본 그대로 줍니다.
        const data = await response.json();

        if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
            throw new Error("종목 없음");
        }

        // 3. 종가(Close price) 데이터 배열만 쏙 뽑아내기
        const rawPrices = data.chart.result[0].indicators.quote[0].close;
        
        // 간혹 장이 쉬는 날 섞여 있는 빈값(null) 제거
        const prices = rawPrices.filter(price => price !== null);

        if (prices.length < 2) {
             throw new Error("데이터 부족");
        }

        // 4. 기존 MDD 산출 알고리즘 적용
        let peak = prices[0];
        let maxDrawdown = 0;

        for (let i = 1; i < prices.length; i++) {
            if (prices[i] > peak) {
                peak = prices[i]; // 전고점 갱신
            }
            // 하락률 계산
            const currentDrawdown = ((prices[i] - peak) / peak) * 100;
            
            if (currentDrawdown < maxDrawdown) {
                maxDrawdown = currentDrawdown; // 최대 낙폭 갱신
            }
        }

        // 5. 결과 화면 출력
        if (maxDrawdown === 0) {
             resultDisplay.innerHTML = `👏 <b>${ticker}</b> MDD: 0.00% <br><span class="text-sm font-normal text-slate-500">최근 1년간 가격 하락 없이 우상향했습니다!</span>`;
             resultDisplay.style.color = "#10b981"; // 에메랄드 그린
        } else {
             resultDisplay.innerHTML = `
                🚨 <b>${ticker}</b> 최대 낙폭(MDD): ${maxDrawdown.toFixed(2)}% <br>
                <span class="text-sm font-normal text-slate-500">최근 1년 최고점 대비 가장 깊게 파인 하락률입니다.</span>
             `;
             resultDisplay.style.color = "#ef4444"; // 붉은 경고
        }

    } catch (error) {
        console.error(error);
        resultDisplay.innerHTML = `❌ <b>${ticker}</b> 데이터를 불러오지 못했습니다.<br><span class="text-sm font-normal text-slate-500">티커명을 확인하거나, 일시적인 서버 오류일 수 있습니다. (※ 한국 주식은 005930.KS 형식)</span>`;
        resultDisplay.style.color = "#ef4444";
    }
}

// 엔터키를 누르면 바로 계산되도록 이벤트 추가
document.addEventListener('DOMContentLoaded', () => {
    const mddInput = document.getElementById('mdd-price-input');
    if(mddInput) {
        mddInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                runMDDCalculation();
            }
        });
    }
});
