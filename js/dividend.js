// =====================================================
// 📈 배당 실수령 및 예상 캘린더 엔진 (V19.7 무결점 차트 패치)
// =====================================================

var myDivChart = null; 

var CHART_COLORS = [
    'rgba(54, 162, 235, 0.7)', 'rgba(255, 99, 132, 0.7)', 'rgba(255, 206, 86, 0.7)', 
    'rgba(75, 192, 192, 0.7)', 'rgba(153, 102, 255, 0.7)', 'rgba(255, 159, 64, 0.7)', 'rgba(199, 199, 199, 0.7)'
];

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
        var matrix = localParseCsvToMatrix(textData);
        var rulesObj = {};
        for(var i = 1; i < matrix.length; i++) {
            var row = matrix[i];
            if(row.length < 3) continue;
            var rawStockName = String(row[0] || "").trim();
            var rawMonths = String(row[1] || "").trim();
            var rawAmount = String(row[2] || "").replace(/[^0-9.]/g, '');
            if (!rawStockName) continue;
            var payMonthsArray = rawMonths.split(',').map(function(m) { return parseInt(m.trim()); }).filter(function(m) { return !isNaN(m); });
            var expectedAmount = parseFloat(rawAmount) || 0;
            var cleanKey = rawStockName.replace(/\s+/g, '');
            rulesObj[cleanKey] = { payMonths: payMonthsArray, expectedAmount: expectedAmount };
        }
        globalDividendRulesMatrix = rulesObj;
    } catch (e) {
        console.error("배당 룰북 로드 실패:", e);
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
    var targetUser = selector.value || (globalParsedUsers ? Object.keys(globalParsedUsers)[0] : "");
    if(!targetUser) return;

    var totalReceived = 0;
    var actualLogsHtml = "";
    var chartDatasetsByStock = {}; 
    var totalMonthlyCalendar = new Array(12).fill(0); 
    var currentMonth = new Date().getMonth() + 1;

    // 실제 수령 로그 처리
    if(typeof globalActualDividendLogs !== 'undefined') {
        globalActualDividendLogs.forEach(function(log) {
            if (log.userName.includes(targetUser) || targetUser.includes(log.userName)) {
                totalReceived += log.amount;
                actualLogsHtml += '<tr><td class="px-6 py-4 text-xs text-slate-500">' + log.date + '</td><td class="px-6 py-4 font-bold text-xs">' + log.stockName + '</td><td class="px-6 py-4 text-right font-black text-blue-600">₩' + log.amount.toLocaleString() + '</td></tr>';
                
                var monthMatch = log.date.match(/\b([1-9]|1[0-2])\b/); 
                if (monthMatch) {
                    var mIndex = parseInt(monthMatch[0]) - 1; 
                    totalMonthlyCalendar[mIndex] += log.amount;
                    if (!chartDatasetsByStock[log.stockName]) chartDatasetsByStock[log.stockName] = new Array(12).fill(0);
                    chartDatasetsByStock[log.stockName][mIndex] += log.amount;
                }
            }
        });
    }

    // 미래 예상 처리
    var userObj = globalParsedUsers[targetUser];
    if (userObj && userObj.items) {
        userObj.items.forEach(function(item) {
            if (item.qty <= 0) return;
            var cleanKey = item.stock.replace(/\s+/g, '');
            var rule = globalDividendRulesMatrix[cleanKey]; // 룰북에서 바로 찾기 (매칭 실패 시 undefined)
            
            if (rule && rule.expectedAmount > 0) {
                if (!chartDatasetsByStock[item.stock]) chartDatasetsByStock[item.stock] = new Array(12).fill(0);
                
                rule.payMonths.forEach(function(m) {
                    if (m > currentMonth) {
                        totalMonthlyCalendar[m-1] += (item.qty * rule.expectedAmount);
                        chartDatasetsByStock[item.stock][m-1] += (item.qty * rule.expectedAmount);
                    }
                });
            }
        });
    }

    // 화면 갱신 로직은 동일
    document.getElementById("actual-received-dividend").innerText = "₩" + Math.round(totalReceived).toLocaleString();
    document.getElementById("actual-dividend-table-body").innerHTML = actualLogsHtml || '<tr><td colspan="3" class="p-6 text-center text-slate-400">내역 없음</td></tr>';
    
    // 차트 렌더링 호출
    loadChartJsAndRender(chartDatasetsByStock);
}

function loadChartJsAndRender(datasetsByStock) {
    if (typeof Chart !== 'undefined') {
        renderStackedDividendChart(datasetsByStock);
    } else {
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js';
        script.onload = function() { renderStackedDividendChart(datasetsByStock); };
        document.head.appendChild(script);
    }
}

function renderStackedDividendChart(datasetsByStock) {
    var ctx = document.getElementById('dividendChart');
    if(!ctx) return;

    var finalDatasets = [];
    var colorIdx = 0;
    
    // 데이터가 있는 종목만 골라냄
    Object.keys(datasetsByStock).forEach(function(stockName) {
        finalDatasets.push({
            label: stockName,
            data: datasetsByStock[stockName],
            backgroundColor: CHART_COLORS[colorIdx++ % CHART_COLORS.length]
        });
    });

    if(myDivChart) myDivChart.destroy();
    myDivChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"], datasets: finalDatasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
    });
}
