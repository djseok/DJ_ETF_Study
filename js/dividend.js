// ===================================================== 
// 📈 배당 실수령 및 예상 캘린더 엔진 (V19.5 완전 독립형 패치) 
// ===================================================== 

var myDivChart = null;

var CHART_COLORS = [
    'rgba(54, 162, 235, 0.7)',
    'rgba(255, 99, 132, 0.7)',
    'rgba(255, 206, 86, 0.7)',
    'rgba(75, 192, 192, 0.7)',
    'rgba(153, 102, 255, 0.7)',
    'rgba(255, 159, 64, 0.7)',
    'rgba(199, 199, 199, 0.7)'
];

// 🔥 [에러 원천 차단] main.js 의존성을 없애기 위해 내부에 파싱 함수를 직접 심었습니다!
function localParseCsvToMatrix(text) {
    if (!text) return [];
    var lines = text.split('\n');
    var result = [];

    for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        var rowResult = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                rowResult.push(current.trim().replace(/^"|"$/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        rowResult.push(current.trim().replace(/^"|"$/g, ''));
        if (rowResult.length > 0 && rowResult[0] !== '') {
            result.push(rowResult);
        }
    }
    return result;
}

async function loadDynamicDividendRules() {
    try {
        if(typeof DIVIDEND_RULES_CSV_URL === 'undefined') return;
        var res = await fetch(DIVIDEND_RULES_CSV_URL);
        var textData = await res.text();
        
        // 내장된 로컬 파싱 함수를 호출하도록 교정했습니다.
        var matrix = localParseCsvToMatrix(textData);
        var rulesObj = {};

        for(var i = 1; i < matrix.length; i++) {
            var row = matrix[i];
            if(row.length < 3) continue; 
            var rawStockName = String(row[0] || "").trim();
            var rawMonths = String(row[1] || "").trim();
            var rawAmount = String(row[2] || "").replace(/[^0-9.]/g, '');

            if (!rawStockName) continue; 
            
            var payMonthsArray = rawMonths.split(',').map(function(m) {
                return parseInt(m.trim());
            }).filter(function(m) {
                return !isNaN(m);
            });

            var expectedAmount = parseFloat(rawAmount) || 0;
            var cleanKey = rawStockName.replace(/\s+/g, '');
            rulesObj[cleanKey] = { payMonths: payMonthsArray, expectedAmount: expectedAmount };
        }
        
        globalDividendRulesMatrix = rulesObj;
        console.log("📊 동적 배당 사전 장착 완료:", globalDividendRulesMatrix);
    } catch (e) {
        console.error("동적 배당 룰북 로드 실패:", e);
    }
}

// 🔥 [최종 패치] 엄격한 방어막을 해제한 유연한 배당 로그 로드 함수
async function loadDividendLogs() {
    try {
        if(typeof DIVIDEND_CSV_URL === 'undefined') {
            console.warn("⚠️ DIVIDEND_CSV_URL이 설정되지 않아 배당 내역을 불러올 수 없습니다.");
            globalActualDividendLogs = [];
            return;
        }

        var res = await fetch(DIVIDEND_CSV_URL + "&t=" + new Date().getTime());
        var text = await res.text();
        var matrix = localParseCsvToMatrix(text);
        
        globalActualDividendLogs = [];
        
        // CSV 데이터 파싱 (헤더 제외)
        for(var i = 1; i < matrix.length; i++) {
            var row = matrix[i];
            
            // 🚨 [핵심 원인 해결] 기존의 row.length < 12 라는 엄격한 조건을 삭제했습니다!
            // 구글 시트가 빈칸을 생략해서 내보내더라도, 최소 H열(인덱스 7)만 존재하면 무조건 통과시킵니다.
            if(row.length <= 7 || !row[7]) continue; 

            var userName = String(row[7]).trim();
            // 이름 칸이 비어있거나, 표의 제목("이름" 등)인 경우 데이터가 아니므로 건너뜁니다.
            if(!userName || userName === "이름" || userName === "구분") continue;

            globalActualDividendLogs.push({
                userName: userName,                                       // H열: 이름 (D, S, J)
                date: row.length > 8 ? String(row[8]).trim() : "",        // I열: 수령일자 (2026. 7. 2)
                stockName: row.length > 9 ? String(row[9]).trim() : "",   // J열: 종목 (RISE 미국나스닥100)
                // L열(인덱스 11)이 있으면 실수령액 파싱, 없거나 짧으면 0원 처리
                amount: row.length > 11 ? (parseFloat(String(row[11]).replace(/[^0-9.]/g, '')) || 0) : 0 
            });
        }
        console.log("✅ 배당 로그 데이터 로드 완료:", globalActualDividendLogs);
    } catch(e) {
        console.error("배당 로그 로드 실패:", e);
    }
}
// 🔥 [핵심 수정 2] 렌더링 함수 (에러 방어형)
async function renderActualDividendView() {
    try {
        // 1. 배당 룰북과 배당 내역을 로드
        // loadDynamicDividendRules 함수가 없더라도 에러를 뿜지 않고 넘어가게 만듭니다.
        const ruleLoader = typeof loadDynamicDividendRules === 'function' 
            ? loadDynamicDividendRules() 
            : Promise.resolve();

        await Promise.all([
            ruleLoader,
            loadDividendLogs()
        ]);
        
        // 2. 화면 렌더링
        initDividendUserSelector();
        calculateAndDrawDividends();
        
    } catch (error) {
        console.error("차트 렌더링 중 오류 발생:", error);
    }
}

function initDividendUserSelector() {
    var selector = document.getElementById('divUserSelector');
    if(!selector) return;

    // globalParsedUsers 존재 여부 확인 (에러 방어)
    var names = (typeof globalParsedUsers !== 'undefined' && globalParsedUsers) ? Object.keys(globalParsedUsers) : [];

    if(selector.options.length !== names.length && names.length > 0) {
        var htmlStr = '';
        for(var i = 0; i < names.length; i++){
            htmlStr += '<option value="' + names[i] + '">' + names[i] + '</option>';
        }
        selector.innerHTML = htmlStr;
        selector.removeEventListener('change', calculateAndDrawDividends);
        selector.addEventListener('change', calculateAndDrawDividends);
    }
}

function calculateAndDrawDividends() {
    var selector = document.getElementById('divUserSelector');
    if(!selector) return;
    
    var names = (typeof globalParsedUsers !== 'undefined' && globalParsedUsers) ? Object.keys(globalParsedUsers) : [];
    var targetUser = selector.value || (names.length > 0 ? names[0] : "");
    if(!targetUser) return; 
    
    var totalReceived = 0;
    var actualLogsHtml = "";
    var chartDatasetsByStock = {};
    var totalMonthlyCalendar = new Array(12).fill(0);
    var currentMonth = new Date().getMonth() + 1;

    if(typeof globalActualDividendLogs !== 'undefined' && globalActualDividendLogs.length > 0) {
        var sortedActualLogs = globalActualDividendLogs.slice().sort(function(a,b){
            return new Date(b.date) - new Date(a.date);
        });

        for(var j=0; j<sortedActualLogs.length; j++){
            var log = sortedActualLogs[j];

            if (log.userName.includes(targetUser) || targetUser.includes(log.userName)) {
                totalReceived += log.amount;
                
                actualLogsHtml += '<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">';
                actualLogsHtml += '<td class="py-3 px-4 text-slate-500 font-mono text-sm">' + log.date + '</td>';
                actualLogsHtml += '<td class="py-3 px-4 text-slate-800 font-bold">' + log.stockName + '</td>';
                actualLogsHtml += '<td class="py-3 px-4 text-emerald-600 font-bold text-right font-mono">+ ₩' + log.amount.toLocaleString() + '</td>';
                actualLogsHtml += '</tr>';

                var monthMatch = log.date.match(/\b([1-9]|1[0-2])\b/);
                if (monthMatch) {
                    var mIndex = parseInt(monthMatch[0]) - 1;
                    totalMonthlyCalendar[mIndex] += log.amount;
                    
                    if (!chartDatasetsByStock[log.stockName]) {
                        chartDatasetsByStock[log.stockName] = new Array(12).fill(0);
                    }
                    chartDatasetsByStock[log.stockName][mIndex] += log.amount;
                }
            }
        }
    }

    var userObj = (typeof globalParsedUsers !== 'undefined' && globalParsedUsers) ? globalParsedUsers[targetUser] : null;
    var totalAnnualExpected = 0;

    if (userObj && userObj.items) {
        for(var k=0; k<userObj.items.length; k++){
            var item = userObj.items[k];
            if (item.qty <= 0) continue; 
            
            var cleanedItemStock = item.stock.replace(/\s+/g, '');
            var activeRule = null;

            if (typeof globalDividendRulesMatrix !== 'undefined') {
                for (var ruleKey in globalDividendRulesMatrix) {
                    if (cleanedItemStock.includes(ruleKey) || ruleKey.includes(cleanedItemStock)) {
                        activeRule = globalDividendRulesMatrix[ruleKey];
                        break;
                    }
                }
            }

            if (activeRule && activeRule.payMonths && activeRule.payMonths.length > 0) {
                var expectedSinglePayment = activeRule.expectedAmount * item.qty;
                
                for (var m = 0; m < activeRule.payMonths.length; m++) {
                    var ruleMonth = activeRule.payMonths[m];
                    var isFutureMonth = ruleMonth > currentMonth;
                    var calIndex = ruleMonth - 1;

                    if (isFutureMonth) {
                        totalMonthlyCalendar[calIndex] += expectedSinglePayment;
                        totalAnnualExpected += expectedSinglePayment;

                        if (!chartDatasetsByStock[item.stock]) {
                            chartDatasetsByStock[item.stock] = new Array(12).fill(0);
                        }
                        chartDatasetsByStock[item.stock][calIndex] += expectedSinglePayment;
                    }
                }
            }
        }
    }

    var nameLabel = document.getElementById("actual-received-name-label");
    if(nameLabel) nameLabel.innerText = "[" + targetUser + "]님의 배당금 현황";
    
    var divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = "₩" + Math.round(totalReceived).toLocaleString();

    var annualPure = document.getElementById("annual-dividend-pure");
    if(annualPure) {
        var totalYearly = totalReceived + totalAnnualExpected;
        annualPure.innerText = "₩" + Math.round(totalYearly).toLocaleString();
    }

    var tableBody = document.getElementById("actual-dividend-table-body");
    if(tableBody) {
        if(actualLogsHtml === "") {
            tableBody.innerHTML = '<tr><td colspan="3" class="py-6 text-center text-slate-400">배당금 수령 내역이 없습니다.</td></tr>';
        } else {
            tableBody.innerHTML = actualLogsHtml;
        }
    }

    var calendarHtml = "";
    var averageMonthly = (totalReceived + totalAnnualExpected) / 12; 
    
    for (var x = 0; x < 12; x++) {
        var amount = totalMonthlyCalendar[x];
        var monthStr = (x + 1) + "월";
        var isHighMonth = amount > averageMonthly * 1.5;
        var isFuture = (x + 1) > currentMonth;
        
        var bgClass = "bg-slate-50 border-slate-100 opacity-60";
        var textClass = "text-slate-400";
        var extraIcon = "";

        if (amount > 0) {
            if (isFuture) {
                bgClass = "bg-orange-50 border-orange-200 border-dashed";
                textClass = "text-orange-600 opacity-80";
                extraIcon = '<span class="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-bold">예상</span>';
            } else {
                bgClass = isHighMonth ? "bg-emerald-50 border-emerald-300 shadow-sm" : "bg-white border-slate-200";
                textClass = "text-emerald-700";
                if(isHighMonth) extraIcon = '<span class="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-bold">🔥</span>';
            }
        }
        
        calendarHtml += '<div class="flex flex-col p-3 rounded-xl border ' + bgClass + ' transition-all">';
        calendarHtml += '<div class="text-xs font-bold text-slate-500 mb-1 flex items-center">' + monthStr + ' ' + extraIcon + '</div>';
        calendarHtml += '<div class="' + textClass + ' font-black font-mono text-sm tracking-tight">' + (amount > 0 ? '₩' + Math.round(amount).toLocaleString() : '-') + '</div>';
        calendarHtml += '</div>';
    }
    
    var calendarDiv = document.getElementById("dividend-calendar");
    if(calendarDiv) calendarDiv.innerHTML = calendarHtml;

    renderStackedDividendChart(chartDatasetsByStock);
}

function renderStackedDividendChart(datasetsByStock) {
    var ctx = document.getElementById('dividendChart');
    if(!ctx) return;

    var labels = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
    var finalDatasets = [];
    var colorIndex = 0;
    
    for (var stockName in datasetsByStock) {
        var monthlyArray = datasetsByStock[stockName];
        var hasData = false;
        
        for(var i=0; i<monthlyArray.length; i++){
            if(monthlyArray[i] > 0) hasData = true;
        }
        
        if (hasData) {
            var chartColor = CHART_COLORS[colorIndex % CHART_COLORS.length];
            finalDatasets.push({
                label: stockName,
                data: monthlyArray,
                backgroundColor: chartColor,
                borderColor: chartColor.replace('0.7', '1'),
                borderWidth: 1,
                borderRadius: 4
            });
            colorIndex++;
        }
    }

    if(myDivChart) {
        myDivChart.destroy();
    }

    myDivChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: finalDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15, font: { family: "'Pretendard', sans-serif", weight: 'bold' } } },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: { label: function(context) { return context.dataset.label + ': ₩' + Math.round(context.raw).toLocaleString(); } }
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false } },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { callback: function(value) { return '₩' + value.toLocaleString(); } }
                }
            }
        }
    });
}

// 🔥 main.js 탭 전환 시 화면을 그릴 수 있도록 외부에 함수 연결
window.loadActualDividendData = renderActualDividendView;

// 테스트를 위한 의미없는 주석 추가 (동진님 요청사항)
// 테스트 코드 끝. 🚀
