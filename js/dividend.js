// =====================================================
// 📈 배당 실수령 및 예상 캘린더 엔진 (V24.0)
// - 수령 기록은 port.js가 포트폴리오 CSV를 읽을 때 함께 파싱합니다 (중복 다운로드 없음)
// - 멤버 이름은 정확히 일치할 때만 합산합니다 (J / JBF / TestJ 섞임 방지)
// - 캘린더/차트는 올해 기준: 지난달까지 = 실수령, 이번 달 = 실수령 + 아직 안 받은 종목 예상, 이후 = 예상
// =====================================================

var myDivChart = null;
var DIV_ALL = '__ALL__';
var DIV_TAX = 0.154;          // 배당소득세 15.4% (단순 적용)
var divAfterTax = false;      // 세후 보기

function setDividendTaxMode(afterTax) {
    divAfterTax = !!afterTax;
    ['pre', 'post'].forEach(function (k) {
        var b = document.getElementById('divTaxBtn_' + k);
        if (b) b.className = 'px-3 py-1.5 rounded-full text-xs font-bold ' + ((k === 'post') === divAfterTax ? 'bg-emerald-700 text-white' : 'bg-white text-emerald-700 border border-emerald-200');
    });
    calculateAndDrawDividends();
}
var dividendRulesLoadPromise = null;

var CHART_COLORS = [
    'rgba(54, 162, 235, 0.7)',
    'rgba(255, 99, 132, 0.7)',
    'rgba(255, 206, 86, 0.7)',
    'rgba(75, 192, 192, 0.7)',
    'rgba(153, 102, 255, 0.7)',
    'rgba(255, 159, 64, 0.7)',
    'rgba(199, 199, 199, 0.7)'
];

// 종목명 비교용: 공백 제거 + 대문자 (예: "Rise 미국 나스닥 100" == "RISE 미국나스닥100")
function normalizeStockName(name) {
    return String(name || '').replace(/\s+/g, '').toUpperCase();
}

// "2026. 7. 2" 한국식 날짜 포맷 표준 객체 변환기
function parseCustomDate(dateStr) {
    if (!dateStr) return { month: 1, jsDate: new Date(0) };
    var clean = dateStr.replace(/\s+/g, '').replace(/\.$/, '');
    var parts = clean.split(/[.\-\/]/);

    if (parts.length >= 3) {
        var y = parseInt(parts[0]) || new Date().getFullYear();
        var m = parseInt(parts[1]) || 1;
        var d = parseInt(parts[2]) || 1;
        return { month: m, jsDate: new Date(y, m - 1, d) };
    }

    var fallback = new Date(dateStr);
    if (isNaN(fallback.getTime())) fallback = new Date(0);
    return { month: fallback.getMonth() + 1, jsDate: fallback };
}

// ETF 배당 규칙(지급월, 1주당 예상배당금) 로드 — 한 번만 받아서 재사용
function loadDynamicDividendRules() {
    if (!dividendRulesLoadPromise) {
        dividendRulesLoadPromise = (async function () {
            var res = await fetch(DIVIDEND_RULES_CSV_URL);
            var matrix = parseCsvToMatrix(await sheetCsvText(res, '배당 규칙'));
            var rulesObj = {};

            for (var i = 1; i < matrix.length; i++) {
                var row = matrix[i];
                if (!row || row.length < 3) continue;
                var rawStockName = String(row[0] || "").trim();
                if (!rawStockName) continue;

                var payMonthsArray = String(row[1] || "").split(',')
                    .map(function (m) { return parseInt(m.trim()); })
                    .filter(function (m) { return !isNaN(m) && m >= 1 && m <= 12; });

                rulesObj[normalizeStockName(rawStockName)] = {
                    name: rawStockName,
                    payMonths: payMonthsArray,
                    expectedAmount: parseFloat(String(row[2] || "").replace(/[^0-9.]/g, '')) || 0,
                    lastPayDay: (function (m) { return m ? parseInt(m[1], 10) : 0; })(String(row[4] || "").match(/^\d{4}-\d{2}-(\d{2})/))
                };
            }
            globalDividendRulesMatrix = rulesObj;
        })().catch(function (e) {
            dividendRulesLoadPromise = null; // 실패하면 다음 번에 다시 시도
            showLoadError(e);
        });
    }
    return dividendRulesLoadPromise;
}

// 보유 종목에 맞는 배당 규칙 찾기: 공백·대소문자만 무시하고 이름이 정확히 같을 때만 연결
// (비슷한 이름 연결은 'RISE 미국S&P500' ↔ 'RISE 미국S&P500 데일리 고정 커버드콜' 같은 오연결을 만들어서 쓰지 않음)
function findDividendRule(stockName) {
    return globalDividendRulesMatrix[normalizeStockName(stockName)] || null;
}

async function renderActualDividendView() {
    try {
        await Promise.all([
            loadDynamicDividendRules(),
            (typeof loadDivHistory === 'function') ? loadDivHistory() : Promise.resolve(),
            (typeof loadPortfolioData === 'function') ? loadPortfolioData('div') : Promise.resolve()
        ]);
        initDividendUserSelector();
        calculateAndDrawDividends();
    } catch (error) {
        console.error("차트 렌더링 중 오류 발생:", error);
    }
}

function initDividendUserSelector() {
    var selector = document.getElementById('divUserSelector');
    if (!selector) return;

    var names = globalParsedUsers ? Object.keys(globalParsedUsers) : [];

    if (selector.options.length !== names.length + 1 && names.length > 0) {
        selector.innerHTML = names.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('')
            + '<option value="' + DIV_ALL + '">👥 클럽 전체</option>';
        selector.removeEventListener('change', calculateAndDrawDividends);
        selector.addEventListener('change', calculateAndDrawDividends);
    }
}

function calculateAndDrawDividends() {
    var selector = document.getElementById('divUserSelector');
    if (!selector) return;

    var names = globalParsedUsers ? Object.keys(globalParsedUsers) : [];
    var targetUser = selector.value || (names.length > 0 ? names[0] : "");
    if (!targetUser) return;

    var now = new Date();
    var currentYear = now.getFullYear();
    var currentMonth = now.getMonth() + 1;
    var isAll = targetUser === DIV_ALL;
    var targetKey = targetUser.trim().toUpperCase();
    var memberKeys = names.map(function (n) { return n.trim().toUpperCase(); });
    // 세후: 과세표준 기록이 있으면 그 비율로, 없으면 전액 과세(15.4%)로 계산
    function netK(stock, when) {
        if (!divAfterTax) return 1;
        if (typeof divTaxRatio !== 'function') return 1 - DIV_TAX;
        return 1 - DIV_TAX * divTaxRatio(stock, when).ratio;
    }

    // 이 멤버의 수령 기록만 (이름 정확히 일치) · 클럽 전체면 멤버 모두
    var myLogs = (globalActualDividendLogs || []).filter(function (log) {
        var k = String(log.userName || '').trim().toUpperCase();
        return isAll ? memberKeys.indexOf(k) >= 0 : k === targetKey;
    }).map(function (log) {
        return Object.assign({}, log, { amount: log.amount * netK(log.stockName, log.jsDate) });
    }).sort(function (a, b) { return b.jsDate.getTime() - a.jsDate.getTime(); });

    // 보유 종목 (클럽 전체면 종목별 수량 합산)
    var holdings = [];
    (isAll ? names : [targetUser]).forEach(function (n) {
        var u = globalParsedUsers ? globalParsedUsers[n] : null;
        (u && u.items ? u.items : []).forEach(function (it) {
            if (!(it.qty > 0)) return;
            var ex = holdings.filter(function (h) { return normalizeStockName(h.stock) === normalizeStockName(it.stock); })[0];
            if (ex) ex.qty += it.qty; else holdings.push({ stock: it.stock, qty: it.qty });
        });
    });
    var targetLabel = isAll ? '클럽 전체' : targetUser;

    // 기록에 적힌 종목명을 보유 종목명으로 맞춰서 차트 범례가 흩어지지 않게 함
    var holdingNameByKey = {};
    holdings.forEach(function (it) { holdingNameByKey[normalizeStockName(it.stock)] = it.stock; });
    function displayName(stock) { return holdingNameByKey[normalizeStockName(stock)] || stock; }

    var totalReceivedAllTime = 0;          // 누적 실수령 (전체 기간)
    var actualByMonth = new Array(12).fill(0);    // 올해 실수령
    var expectedByMonth = new Array(12).fill(0);  // 올해 남은 예상
    var actualByStock = {}, expectedByStock = {};
    var receivedThisMonthKeys = {};        // 이번 달에 이미 받은 종목
    var actualLogsHtml = "";

    myLogs.forEach(function (log) {
        totalReceivedAllTime += log.amount;
        var qtyText = log.qty ? ' <span class="text-xs text-slate-400 font-normal">(' + log.qty.toLocaleString() + '주)</span>' : '';
        actualLogsHtml += '<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">'
            + '<td class="py-3 px-4 text-slate-500 font-mono text-sm">' + log.date + '</td>'
            + '<td class="py-3 px-4 text-slate-800 font-bold">' + (isAll ? '<span class="text-xs text-slate-400 mr-1">' + log.userName + '</span>' : '') + log.stockName + qtyText + '</td>'
            + '<td class="py-3 px-4 text-emerald-600 font-bold text-right font-mono">+ ₩' + Math.round(log.amount).toLocaleString() + '</td>'
            + '</tr>';

        var y = log.jsDate.getFullYear(), m = log.parsedMonth;
        if (y !== currentYear || m < 1 || m > 12) return; // 캘린더·차트는 올해 기록만
        var name = displayName(log.stockName);
        actualByMonth[m - 1] += log.amount;
        if (!actualByStock[name]) actualByStock[name] = new Array(12).fill(0);
        actualByStock[name][m - 1] += log.amount;
        if (m === currentMonth) receivedThisMonthKeys[normalizeStockName(name)] = true;
    });

    // 예상 배당: 이번 달(아직 안 받은 종목) + 남은 달
    var missingRules = [];
    holdings.forEach(function (item) {
        var rule = findDividendRule(item.stock);
        if (!rule) { missingRules.push(item.stock); return; }
        if (!rule.payMonths.length || rule.expectedAmount <= 0) return;
        var perPayment = rule.expectedAmount * item.qty * netK(item.stock, null);

        rule.payMonths.forEach(function (month) {
            if (month < currentMonth) return;
            if (month === currentMonth && receivedThisMonthKeys[normalizeStockName(item.stock)]) return;
            expectedByMonth[month - 1] += perPayment;
            if (!expectedByStock[item.stock]) expectedByStock[item.stock] = new Array(12).fill(0);
            expectedByStock[item.stock][month - 1] += perPayment;
        });
    });

    var yearActual = actualByMonth.reduce(function (a, b) { return a + b; }, 0);
    var yearExpected = expectedByMonth.reduce(function (a, b) { return a + b; }, 0);

    setText("actual-received-name-label", "[" + targetLabel + "] 배당금 현황" + (divAfterTax ? " · 세후" : " · 세전"));
    setText("actual-received-dividend", "₩" + Math.round(totalReceivedAllTime).toLocaleString());
    setText("actual-table-title-name", targetLabel + " · " + myLogs.length + "건");
    setText("annual-dividend-pure", "₩" + Math.round(yearActual + yearExpected).toLocaleString());

    var tableBody = document.getElementById("actual-dividend-table-body");
    if (tableBody) {
        var skipped = (typeof portfolioSkippedDividendRows !== 'undefined') ? portfolioSkippedDividendRows : [];
        var warnHtml = skipped.length > 0
            ? '<tr><td colspan="3" class="py-3 px-4 text-xs font-bold text-orange-600 bg-orange-50">⚠️ 시트에 이름(H열)이 비어 있는 배당 기록 ' + skipped.length + '건은 누구 것인지 몰라 제외했어요 (시트 ' + skipped.map(function (s) { return s.sheetRow + '행'; }).join(', ') + ')</td></tr>'
            : '';
        tableBody.innerHTML = warnHtml + (actualLogsHtml || '<tr><td colspan="3" class="py-6 text-center text-slate-400">배당금 수령 내역이 없습니다.</td></tr>');
    }

    // 월별 캘린더 (올해)
    var calendarHtml = "";
    var averageMonthly = (yearActual + yearExpected) / 12;
    for (var x = 0; x < 12; x++) {
        var actual = actualByMonth[x], expected = expectedByMonth[x], total = actual + expected;
        var isHighMonth = total > averageMonthly * 1.5;

        var bgClass = "bg-slate-50 border-slate-100 opacity-60", textClass = "text-slate-400", badge = "", sub = "";
        if (actual > 0) {
            bgClass = isHighMonth ? "bg-emerald-50 border-emerald-300 shadow-sm" : "bg-white border-slate-200";
            textClass = "text-emerald-700";
            if (isHighMonth) badge = '<span class="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-bold">🔥</span>';
            if (expected > 0) sub = '<div class="text-[10px] font-bold text-orange-500 font-mono mt-0.5">+ 예상 ₩' + Math.round(expected).toLocaleString() + '</div>';
        } else if (expected > 0) {
            bgClass = "bg-orange-50 border-orange-200 border-dashed";
            textClass = "text-orange-600 opacity-80";
            badge = '<span class="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-bold">예상</span>';
        }
        var shown = actual > 0 ? actual : expected;
        if (x + 1 === currentMonth) bgClass += " ring-2 ring-emerald-400";

        calendarHtml += '<div class="flex flex-col p-3 rounded-xl border ' + bgClass + ' transition-all">'
            + '<div class="text-xs font-bold text-slate-500 mb-1 flex items-center">' + (x + 1) + '월 ' + badge + '</div>'
            + '<div class="' + textClass + ' font-black font-mono text-sm tracking-tight">' + (shown > 0 ? '₩' + Math.round(shown).toLocaleString() : '-') + '</div>'
            + sub + '</div>';
    }
    var calendarDiv = document.getElementById("dividend-calendar");
    if (calendarDiv) calendarDiv.innerHTML = calendarHtml;

    // 배당주기 시트에 규칙이 없는 보유 종목 안내 (예상 배당에서 빠짐)
    var note = document.getElementById("dividend-missing-rules");
    if (!note && calendarDiv) {
        note = document.createElement('div');
        note.id = "dividend-missing-rules";
        calendarDiv.parentNode.insertBefore(note, calendarDiv.nextSibling);
    }
    if (note) {
        note.className = missingRules.length ? "mb-6 -mt-3 text-xs font-bold text-orange-600" : "hidden";
        note.innerText = missingRules.length
            ? "ℹ️ 'ETF 배당주기' 시트에 없어서 예상 배당에서 빠진 종목: " + missingRules.join(', ')
            : "";
    }

    renderUsdDividends(isAll ? names : [targetUser], targetLabel, yearActual + yearExpected);
    renderStackedDividendChart(actualByStock, expectedByStock);
    renderUpcomingDividends(holdings, receivedThisMonthKeys, netK);
}

// 💵 달러 자산(1달러 프로젝트) 배당: 원화 배당과 섞지 않고 따로 표시
//   받은 배당 = 1달러 시트 J~L '누적배당금'($, 적힌 그대로)
//   예상 = 관리종목 '최근 4회 평균 분배금'($) × 보유수량, 1달러 탭과 같이 주 1회 지급으로 계산 · 세후는 미국 원천징수 15% 공제
var USD_DIV_TAX = 0.15;
function renderUsdDividends(memberNames, targetLabel, krwYearTotal) {
    var box = document.getElementById('dividend-usd');
    if (!box) return;
    var fx = 0, received = {}, weekly = {}, labels = {};
    memberNames.forEach(function (n) {
        var u = globalParsedUsers ? globalParsedUsers[n] : null;
        if (!u || !u.fx) return;
        fx = u.fx;
        Object.keys(u.usdReceived || {}).forEach(function (t) { received[t] = (received[t] || 0) + u.usdReceived[t]; });
        (u.usdItems || []).forEach(function (it) {
            labels[it.ticker] = it.label || it.ticker;
            if (it.divPerPay > 0) weekly[it.ticker] = (weekly[it.ticker] || 0) + it.divPerPay * it.qty;
        });
    });
    var tickers = Object.keys(weekly).concat(Object.keys(received).filter(function (t) { return !(t in weekly); }));
    if (!fx || !tickers.length) { box.className = 'hidden'; box.innerHTML = ''; return; }

    var k = divAfterTax ? 1 - USD_DIV_TAX : 1;
    var usd = function (v) { return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var won = function (v) { return '₩' + Math.round(v * fx).toLocaleString(); };
    var now = new Date();
    var weeksLeft = Math.floor((new Date(now.getFullYear(), 11, 31) - now) / (7 * 864e5));
    var recTotal = 0, weekTotal = 0;
    tickers.forEach(function (t) { recTotal += received[t] || 0; weekTotal += (weekly[t] || 0) * k; });
    var restYear = weekTotal * weeksLeft;

    var rows = tickers.sort(function (a, b) { return (weekly[b] || 0) - (weekly[a] || 0); }).map(function (t) {
        return '<tr class="border-b border-slate-100 last:border-0"><td class="py-2 font-bold text-slate-700">' + escapeHtml(labels[t] || t) + ' <span class="text-[10px] text-slate-400">' + escapeHtml(t) + '</span></td>'
            + '<td class="py-2 text-right mono text-slate-600">' + (weekly[t] ? usd(weekly[t] * k) : '-') + '</td>'
            + '<td class="py-2 text-right mono font-bold text-emerald-600">' + (received[t] ? usd(received[t]) : '-') + '</td></tr>';
    }).join('');

    box.className = 'bg-white p-6 rounded-2xl shadow-sm border border-emerald-200';
    box.innerHTML = '<h4 class="font-black text-lg text-slate-800 mb-1">💵 달러 자산 배당 <span class="text-xs font-bold text-slate-400 ml-1">' + escapeHtml(targetLabel) + ' · 1달러 프로젝트 · ' + (divAfterTax ? '세후(미국 15% 원천징수)' : '세전') + ' · 환율 ₩' + Math.round(fx).toLocaleString() + '</span></h4>'
        + '<p class="text-xs text-slate-400 mb-4">위의 원화 배당 합계에는 들어가지 않아요. 예상은 최근 4회 평균 분배금 × 보유수량, 주 1회 지급 기준(1달러 탭과 같은 방식)이라 실제와 다를 수 있어요.</p>'
        + '<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">'
        + '<div class="bg-emerald-50 p-3 rounded-xl border border-emerald-100"><div class="text-[11px] font-bold text-emerald-700">받은 달러 배당 (누적)</div><div class="font-black mono text-emerald-800">' + usd(recTotal) + '</div><div class="text-[11px] text-slate-500 mono">' + won(recTotal) + '</div></div>'
        + '<div class="bg-slate-50 p-3 rounded-xl border border-slate-100"><div class="text-[11px] font-bold text-slate-600">주간 예상</div><div class="font-black mono text-slate-800">' + usd(weekTotal) + '</div><div class="text-[11px] text-slate-500 mono">' + won(weekTotal) + '</div></div>'
        + '<div class="bg-slate-50 p-3 rounded-xl border border-slate-100"><div class="text-[11px] font-bold text-slate-600">올해 남은 예상 (' + weeksLeft + '주)</div><div class="font-black mono text-slate-800">' + usd(restYear) + '</div><div class="text-[11px] text-slate-500 mono">' + won(restYear) + '</div></div>'
        + '</div>'
        + '<table class="w-full text-left text-sm whitespace-nowrap"><thead><tr class="text-[11px] text-slate-400"><th class="pb-1">종목</th><th class="pb-1 text-right">주간 예상</th><th class="pb-1 text-right">받은 배당</th></tr></thead><tbody>' + rows + '</tbody></table>'
        + '<div class="mt-4 pt-3 border-t border-slate-100 flex justify-between text-sm font-black text-emerald-800"><span>올해 원화 배당 + 달러 남은 예상 (₩ 환산)</span><span class="mono">₩' + Math.round(krwYearTotal + restYear * fx).toLocaleString() + '</span></div>';
}

// 다가오는 배당 (오늘부터 60일): 지급 예정일 = 지급월 + 최근 지급일의 '일(day)' (주말이면 다음 월요일)
function renderUpcomingDividends(holdings, receivedThisMonthKeys, netK) {
    var box = document.getElementById('dividend-upcoming');
    if (!box) return;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var until = new Date(today.getTime() + 60 * 864e5);
    var list = [];
    holdings.forEach(function (item) {
        var rule = findDividendRule(item.stock);
        if (!rule || !rule.payMonths.length || rule.expectedAmount <= 0) return;
        var day = rule.lastPayDay || 0;
        for (var add = 0; add < 3; add++) {
            var y = today.getFullYear(), m = today.getMonth() + add; // 0-based
            y += Math.floor(m / 12); m = m % 12;
            if (rule.payMonths.indexOf(m + 1) < 0) continue;
            if (add === 0 && receivedThisMonthKeys[normalizeStockName(item.stock)]) continue;
            var d = new Date(y, m, day || 1);
            while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
            if (d < today && add === 0 && day) continue; // 이번 달 지급일이 이미 지남 (기록이 아직 없을 수 있음)
            if (d > until) continue;
            list.push({ date: d, approx: !day, stock: item.stock, qty: item.qty, per: rule.expectedAmount, amt: rule.expectedAmount * item.qty * netK(item.stock, null) });
        }
    });
    list.sort(function (a, b) { return a.date - b.date; });
    var total = list.reduce(function (s, x) { return s + x.amt; }, 0);
    var dn = ['일', '월', '화', '수', '목', '금', '토'];
    box.innerHTML = list.length ? list.map(function (x) {
        var dd = Math.round((x.date - today) / 864e5);
        var when = (x.date.getMonth() + 1) + '/' + (x.approx ? '?' : x.date.getDate()) + (x.approx ? '' : '(' + dn[x.date.getDay()] + ')');
        return '<div class="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">'
            + '<div class="flex items-center gap-3 min-w-0"><div class="w-16 shrink-0 text-center"><div class="font-black text-slate-800 mono text-sm">' + when + '</div><div class="text-[10px] text-slate-400">' + (dd === 0 ? '오늘' : 'D-' + dd) + '</div></div>'
            + '<div class="min-w-0"><div class="font-bold text-slate-700 truncate">' + x.stock + '</div><div class="text-xs text-slate-400 mono">' + x.qty.toLocaleString() + '주 × ₩' + Math.round(x.per).toLocaleString() + '</div></div></div>'
            + '<div class="font-black text-emerald-600 mono whitespace-nowrap">₩' + Math.round(x.amt).toLocaleString() + '</div></div>';
    }).join('') + '<div class="flex justify-between pt-3 text-sm font-black text-emerald-800"><span>60일 합계</span><span class="mono">₩' + Math.round(total).toLocaleString() + '</span></div>'
        : '<div class="py-6 text-center text-slate-400 text-sm">60일 안에 예정된 배당이 없어요.</div>';
}

function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.innerText = text;
}

function renderStackedDividendChart(actualByStock, expectedByStock) {
    var ctx = document.getElementById('dividendChart');
    if (!ctx) return;

    var labels = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
    var hasData = function (arr) { return arr.some(function (v) { return v > 0; }); };

    // 종목마다 같은 색: 실수령은 진하게, 예상은 연하게(점선 테두리)
    var colorOf = {}, colorIndex = 0;
    Object.keys(actualByStock).concat(Object.keys(expectedByStock)).forEach(function (name) {
        if (!(name in colorOf)) colorOf[name] = CHART_COLORS[colorIndex++ % CHART_COLORS.length];
    });

    var datasets = [];
    Object.keys(actualByStock).forEach(function (name) {
        if (!hasData(actualByStock[name])) return;
        datasets.push({
            label: name, data: actualByStock[name], stack: 'div',
            backgroundColor: colorOf[name], borderColor: colorOf[name].replace('0.7', '1'),
            borderWidth: 1, borderRadius: 4
        });
    });
    Object.keys(expectedByStock).forEach(function (name) {
        if (!hasData(expectedByStock[name])) return;
        datasets.push({
            label: name + ' (예상)', data: expectedByStock[name], stack: 'div', isExpected: true,
            backgroundColor: colorOf[name].replace('0.7', '0.25'), borderColor: colorOf[name].replace('0.7', '1'),
            borderWidth: 1, borderDash: [4, 3], borderRadius: 4
        });
    });

    if (myDivChart) myDivChart.destroy();

    myDivChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12, padding: 15, font: { family: "'Pretendard', sans-serif", weight: 'bold' },
                        // 범례에는 종목명만 한 번씩 (예상 항목은 같은 색이라 생략)
                        filter: function (item, data) { return !data.datasets[item.datasetIndex].isExpected; }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    filter: function (item) { return item.raw > 0; },
                    callbacks: { label: function (context) { return context.dataset.label + ': ₩' + Math.round(context.raw).toLocaleString(); } }
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false } },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { callback: function (value) { return '₩' + value.toLocaleString(); } }
                }
            }
        }
    });
}
