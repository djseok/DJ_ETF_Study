// ===================================================== 
// 📈 배당 실수령 및 예상 캘린더 엔진 (V21.0 최종 통합 완성본) 
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

// CSV 텍스트 파싱 엔진
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
        
        if (rowResult.length > 0 && rowResult.join('').trim() !== '') {
            result.push(rowResult);
        }
    }
    return result;
}

// 🔥 [초강력 무적 패치] "2026. 7. 2" 같은 한국식 날짜 포맷을 브라우저 에러 없이 완벽 분해하는 함수
function parseCustomDate(dateStr) {
    if (!dateStr) return { month: 1, jsDate: new Date(0) };
    var clean = dateStr.replace(/\s+/g, '').replace(/\.$/, ''); // 공백 제거 및 맨 뒤 점 제거
    var parts = clean.split('.');
    
    if (parts.length >= 3) {
        var y = parseInt(parts[0]) || 2026;
        var m = parseInt(parts[1]) || 1;
        var d = parseInt(parts[2]) || 1;
        return { month: m, jsDate: new Date(y, m - 1, d) };
    }
    
    var fallback = new Date(dateStr);
    if (isNaN(fallback.getTime())) fallback = new Date(0);
    return { month: fallback.getMonth() + 1, jsDate: fallback };
}

async function loadDynamicDividendRules() {
    try {
        if(typeof DIVIDEND_RULES_CSV_URL === 'undefined') return;
        var res = await fetch(DIVIDEND_RULES_CSV_URL);
        var textData = await res.text();
        
        var matrix = localParseCsvToMatrix(textData);
        var rulesObj = {};

        for(var i = 1; i < matrix.length; i++) {
            var row = matrix[i];
            if(!row || row.length < 3) continue; 
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
        
        for(var i = 1; i < matrix.length; i++) {
            var row = matrix[i];
            
            // 안전하게 인덱스 참조 (H열 이름 존재 여부)
            if(!row || row.length <= 7 || !row[7]) continue; 

            var userName = String(row[7]).trim();
            if(!userName || userName === "이름" || userName === "구분" || userName === "유저") continue;

            var dateStr = row[8] ? String(row[8]).trim() : "";
            var stockName = row[9] ? String(row[9]).trim() : "";
            var rawAmount = row[11] ? String(row[11]).replace(/[^0-9.-]/g, '') : "0";
            var amountVal = parseFloat(rawAmount) || 0;

            // 로컬 파서 엔진 가동
            var dateInfo = parseCustomDate(dateStr);

            globalActualDividendLogs.push({
                userName: userName,
                date: dateStr,
                parsedMonth: dateInfo.month,
                jsDate: dateInfo.jsDate,
                stockName: stockName,
                amount: amountVal
            });
        }
        console.log("✅ 배당 로그 데이터 로드 완료:", globalActualDividendLogs);
    } catch(e) {
        console.error("배당 로그 로드 실패:", e);
    }
}

async function renderActualDividendView() {
    try {
        const ruleLoader = typeof loadDynamicDividendRules === 'function' 
            ? loadDynamicDividendRules() 
            : Promise.resolve();

        await Promise.all([
            ruleLoader,
            loadDividendLogs()
        ]);
        
        initDividendUserSelector();
        calculateAndDrawDividends();
        
    } catch (error) {
        console.error("차트 렌더링 중 오류 발생:", error);
    }
}

function initDividendUserSelector() {
    var selector = document.getElementById('divUserSelector');
    if(!selector) return;

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
        // 🔥 안전하게 밀리초(getTime) 기반으로 브라우저 오차 없는 완벽 정렬 수행
        var sortedActualLogs = globalActualDividendLogs.slice().sort(function(a, b){
            return b.jsDate.getTime() - a.jsDate.getTime();
        });

        for(var j=0; j<sortedActualLogs.length; j++){
            var log = sortedActualLogs[j];

            var logUser = log.userName.toLowerCase();
            var searchUser = targetUser.toLowerCase();

            if (logUser.includes(searchUser) || searchUser.includes(logUser)) {
                totalReceived += log.amount;
                
                actualLogsHtml += '<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">';
                actualLogsHtml += '<td class="py-3 px-4 text-slate-500 font-mono text-sm">' + log.date + '</td>';
                actualLogsHtml += '<td class="py-3 px-4 text-slate-800 font-bold">' + log.stockName + '</td>';
                actualLogsHtml += '<td class="py-3 px-4 text-emerald-600 font-bold text-right font-mono">+ ₩' + Math.round(log.amount).toLocaleString() + '</td>';
                actualLogsHtml += '</tr>';

                // 정규식 대신 안전한 파싱 월 활용
                var mIndex = log.parsedMonth - 1;
                if (mIndex >= 0 && mIndex < 12) {
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

window.loadActualDividendData = renderActualDividendView;
