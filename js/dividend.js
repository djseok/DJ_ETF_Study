// =====================================================
// 📈 배당 실수령 및 예상 캘린더 엔진 (V19.8 에러 완전 차단 패치)
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

    // 🔥 2중 방어: log.userName이 없으면 건너뛰도록 처리
    if(typeof globalActualDividendLogs !== 'undefined' && Array.isArray(globalActualDividendLogs)) {
        globalActualDividendLogs.forEach(function(log) {
            // 안전하게 데이터 확인
            if (!log || !log.userName) return; 

            if (log.userName.includes(targetUser) || targetUser.includes(log.userName)) {
                totalReceived += (log.amount || 0);
                actualLogsHtml += '<tr><td class="px-6 py-4 text-xs text-slate-500">' + (log.date || "") + '</td><td class="px-6 py-4 font-bold text-xs">' + (log.stockName || "") + '</td><td class="px-6 py-4 text-right font-black text-blue-600">₩' + (log.amount || 0).toLocaleString() + '</td></tr>';
                
                var monthMatch = (log.date || "").match(/\b([1-9]|1[0-2])\b/); 
                if (monthMatch) {
                    var mIndex = parseInt(monthMatch[0]) - 1; 
                    totalMonthlyCalendar[mIndex] += (log.amount || 0);
                    if (!chartDatasetsByStock[log.stockName]) chartDatasetsByStock[log.stockName] = new Array(12).fill(0);
                    chartDatasetsByStock[log.stockName][mIndex] += (log.amount || 0);
                }
            }
        });
    }

    // 예측 로직 (기존과 동일)
    var userObj = globalParsedUsers ? globalParsedUsers[targetUser] : null;
    if (userObj && userObj.items) {
        userObj.items.forEach(function(item) {
            if (!item || item.qty <= 0) return;
            var cleanKey = item.stock.replace(/\s+/g, '');
            var rule = globalDividendRulesMatrix[cleanKey]; 
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

    // UI 갱신 (생략된 경우 대비)
    var nameLabel = document.getElementById("actual-received-name-label");
    if(nameLabel) nameLabel.innerText = "[" + targetUser + "]님의 배당금 현황";
    
    var divAmount = document.getElementById("actual-received-dividend");
    if(divAmount) divAmount.innerText = "₩" + Math.round(totalReceived).toLocaleString();
    
    // 최종 차트 그리기
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
    Object.keys(datasetsByStock).forEach(function(stockName) {
        finalDatasets.push({
            label: stockName,
            data: datasetsByStock[stockName],
            backgroundColor: CHART_COLORS[colorIdx++ % CHART_COLORS.length]
        });
    });
    if(myDivChart) myDivChart.destroy();
    if (typeof Chart !== 'undefined') {
        myDivChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"], datasets: finalDatasets },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
    }
}
