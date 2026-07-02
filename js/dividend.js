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

async function renderActualDividendView() {
    if (!globalDividendRulesMatrix || Object.keys(globalDividendRulesMatrix).length === 0) {
        await loadDynamicDividendRules();
    }
    initDividendUserSelector();
    calculateAndDrawDividends();
}

function initDividendUserSelector() {
    var selector = document.getElementById('divUserSelector');
    if(!selector) return;
    
    var names = globalParsedUsers ? Object.keys(globalParsedUsers) : [];
    
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
    
    var names = globalParsedUsers ? Object.keys(globalParsedUsers) : [];
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
                
                actualLogsHtml += '<tr class="hover:bg-blue-50 transition-colors border-b border-blue-50">';
                actualLogsHtml += '<td class="px-6 py-4 font-mono text-slate-500 text-xs">' + log.date + '</td>';
                actualLogsHtml += '<td class="px-6 py-4 font-bold text-slate-800 text-xs">' + log.stockName + '</td>';
                actualLogsHtml += '<td class="px-6 py-4 text-right font-black text-blue-600 mono text-base">₩' + log.amount.toLocaleString() + '</td>';
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

    var userObj = globalParsedUsers ? globalParsedUsers[targetUser] : null;
    var totalAnnualExpected = 0; 

    if (userObj && userObj.items) {
        for(var k=0; k<userObj.items.length; k++){
            var item = userObj.items[k];
            if (item.qty <= 0) continue; 

            var cleanedItemStock = item.stock.replace(/\s+/g, '');
            var activeRule = null;

            for (var ruleKey in globalDividendRulesMatrix) {
                if (cleanedItemStock.includes(ruleKey) || ruleKey.includes(cleanedItemStock)) {
                    activeRule = globalDividendRulesMatrix[ruleKey];
                    break;
                }
            }

            if (activeRule && activeRule.expectedAmount > 0 && activeRule.payMonths.length > 0) {
                var expectedSinglePayment = item.qty * activeRule.expectedAmount; 

                if (!chartDatasetsByStock[item.stock]) {
                    chartDatasetsByStock[item.stock] = new Array(12).fill(0);
                }

                for(var p=0; p<activeRule.payMonths.length; p++){
                    var monthNum = activeRule.payMonths[p];
                    var calIndex = monthNum - 1;
                    var isFutureMonth = monthNum > currentMonth;

                    if (isFutureMonth) {
                        totalMonthlyCalendar[calIndex] += expectedSinglePayment;
                        totalAnnualExpected += expectedSinglePayment;
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
            tableBody.innerHTML = '<tr><td colspan="3" class="p-6 text-center text-slate-400 font-bold">배당금 수령 내역이 없습니다.</td></tr>';
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
                extraIcon = '<i class="fas fa-clock text-orange-300 ml-1 text-[10px]"></i>';
            } else {
                bgClass = isHighMonth ? "bg-emerald-50 border-emerald-300 shadow-sm" : "bg-white border-slate-200";
                textClass = "text-emerald-700";
                if(isHighMonth) extraIcon = '<i class="fas fa-star text-yellow-400 ml-1 text-[10px]"></i>';
            }
        }
        
        calendarHtml += '<div class="' + bgClass + ' border rounded-xl p-3 text-center flex flex-col justify-center h-full transition-all">';
        calendarHtml += '<div class="text-xs font-bold text-slate-500 mb-1 flex items-center justify-center">' + monthStr + ' ' + extraIcon + '</div>';
        calendarHtml += '<div class="text-sm md:text-base font-black ' + textClass + ' mono">' + (amount > 0 ? '₩' + Math.round(amount).toLocaleString() : '-') + '</div>';
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

    if(myDivChart) myDivChart.destroy();

    if (typeof Chart !== 'undefined') {
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
                    legend: { 
                        display: true, 
                        position: 'bottom',
                        labels: { boxWidth: 12, font: { size: 10 } }
                    } 
                },
                scales: {
                    x: { stacked: true, grid: { display: false } },
                    y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'monospace' } } }
                }
            }
        });
    }
}
