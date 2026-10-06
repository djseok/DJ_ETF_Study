// =========================================================
// 🧾 배당 과세표준 엔진 — 관리시트 'ETF들 배당이력' (A 종목 · B 지급일 · C 1주당 분배금 · D 기준일 · E 1주당 과세표준)
//   - 받은 배당 1건의 '과세 대상 금액' = 받은 금액 × (그 회차 과세표준 ÷ 분배금)
//   - 과세표준이 없는 회차는 같은 ETF 의 다른 회차 평균 비율, 그것도 없으면 전액 과세로 봄(보수적) → estimated 표시
//   - 세금(원천징수) = 과세 대상 × 15.4%
// =========================================================
var DIV_TAX_RATE = 0.154;
var divHistoryByKey = null;     // 정규화 이름 → [{pay: ms, amt, tax}]
var divHistoryPromise = null;

function taxNorm(s) { return String(s || '').replace(/\s+/g, '').toUpperCase().replace(/커브드/g, '커버드'); }

function loadDivHistory() {
    if (!divHistoryPromise) {
        divHistoryPromise = fetch(sheetUrl('DIV_HISTORY')).then(function (r) { return sheetCsvText(r, '배당이력'); }).then(function (t) {
            var m = parseCsvToMatrix(t), map = {};
            m.forEach(function (r) {
                if (!r || !r[0] || !r[1]) return;
                var d = new Date(String(r[1]).trim().replace(/\./g, '-').replace(/\s/g, ''));
                var amt = parseFloat(String(r[2] || '').replace(/[^0-9.]/g, ''));
                if (isNaN(d.getTime()) || !(amt > 0)) return;
                var taxS = String(r[4] === undefined ? '' : r[4]).replace(/[^0-9.]/g, '');
                var k = taxNorm(r[0]);
                (map[k] = map[k] || []).push({ pay: d.getTime(), amt: amt, tax: taxS === '' ? null : parseFloat(taxS) });
            });
            divHistoryByKey = map;
            return map;
        }).catch(function (e) { showLoadError(e); divHistoryByKey = {}; return {}; });
    }
    return divHistoryPromise;
}

// ETF 의 과세표준 비율 (회차 날짜가 가까우면 그 회차, 아니면 평균) → { ratio, estimated }
function divTaxRatio(stock, when) {
    var list = (divHistoryByKey || {})[taxNorm(stock)] || [];
    var t = when ? when.getTime() : 0, best = null;
    list.forEach(function (h) {
        var gap = Math.abs(h.pay - t);
        if (h.tax !== null && gap <= 6 * 864e5 && (!best || gap < Math.abs(best.pay - t))) best = h;
    });
    if (best) return { ratio: Math.min(1, best.tax / best.amt), estimated: false };
    var known = list.filter(function (h) { return h.tax !== null; });
    if (known.length) {
        var a = known.reduce(function (s, h) { return s + h.amt; }, 0), x = known.reduce(function (s, h) { return s + h.tax; }, 0);
        return { ratio: a > 0 ? Math.min(1, x / a) : 1, estimated: true };
    }
    return { ratio: 1, estimated: true };
}

// 받은 배당 기록 1건 → { gross, taxable, tax, net, estimated }
function divTaxOfLog(log) {
    var r = divTaxRatio(log.stockName, log.jsDate);
    var taxable = log.amount * r.ratio, tax = taxable * DIV_TAX_RATE;
    return { gross: log.amount, taxable: taxable, tax: tax, net: log.amount - tax, estimated: r.estimated };
}

// 멤버 이름으로 누적(또는 연도별) 배당 합계
function divTotalsFor(memberName, year) {
    var key = String(memberName || '').trim().toUpperCase(), out = { gross: 0, taxable: 0, tax: 0, net: 0, estimatedGross: 0, count: 0 };
    (globalActualDividendLogs || []).forEach(function (log) {
        if (String(log.userName || '').trim().toUpperCase() !== key) return;
        if (year && log.jsDate.getFullYear() !== year) return;
        var t = divTaxOfLog(log);
        out.gross += t.gross; out.taxable += t.taxable; out.tax += t.tax; out.net += t.net; out.count++;
        if (t.estimated) out.estimatedGross += t.gross;
    });
    return out;
}
