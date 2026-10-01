// =========================================================
// 🎯 예측 적중률 — 관리시트 '개장전_예측' 기록으로 07:30 예측이 얼마나 맞았는지
//   - 오차 = 예상 등락 − 실제 시가 등락 (%p)  · 방향 적중 = 부호가 같음 (둘 다 ±0.05% 이내면 적중)
//   - 추천 베타 = 현재 베타 × Σ(실제×예상) ÷ Σ(예상²)  (0.5~1.5, 기록 5일 이상일 때만)
//   - 예상이 0 인 국내 ETF 는 방향·베타 계산에서 제외
// =========================================================
var ACC_STATE = { rows: null, chart: null, scatter: null, metric: 'open' };

async function loadAccuracyView() {
    var box = document.getElementById('accStatus');
    if (ACC_STATE.rows) return renderAccuracy();
    box.textContent = '기록을 불러오는 중…';
    try {
        var res = await fetch(sheetUrl('PREDICT_LOG'));
        var text = await res.text();
        if (!res.ok || /^\s*</.test(text)) throw new Error('시트 게시 안 됨');
        var m = parseCsvToMatrix(text);
        ACC_STATE.rows = accParse(m);
        renderAccuracy();
    } catch (e) {
        box.innerHTML = '⚠️ 기록을 읽지 못했어요. 관리시트 → 파일 → 공유 → 웹에 게시에서 <b>개장전_예측</b> 탭이 게시돼 있는지 확인해 주세요.';
    }
}

function accNum(v) {
    if (v === undefined || v === null) return NaN;
    var s = String(v).replace(/[,%\s]/g, '');
    return s === '' ? NaN : Number(s);
}

function accParse(m) {
    var out = [];
    for (var i = 1; i < m.length; i++) {
        var r = m[i];
        if (!r || !r[0] || !/^\d{4}-\d{2}-\d{2}$/.test(String(r[0]).trim())) continue;
        out.push({
            date: String(r[0]).trim(), name: r[1], code: r[2], group: r[3],
            pred: accNum(r[5]), beta: accNum(r[14]),
            usShare: accNum(r[9]), foreignShare: accNum(r[13]),
            openPct: accNum(r[17]), closePct: accNum(r[20])
        });
    }
    return out;
}

function accSetMetric(k) {
    ACC_STATE.metric = k;
    ['open', 'close'].forEach(function (x) {
        var b = document.getElementById('accBtn_' + x);
        if (b) b.className = 'whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition-colors ' + (x === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200');
    });
    renderAccuracy();
}

// 한 묶음의 통계
function accStats(list, key) {
    var done = list.filter(function (r) { return isFinite(r[key]) && isFinite(r.pred); });
    var moving = done.filter(function (r) { return r.pred !== 0; });
    var n = done.length, err = 0, abs = 0, hit = 0, sxy = 0, sxx = 0;
    done.forEach(function (r) { var e = r.pred - r[key]; err += e; abs += Math.abs(e); });
    moving.forEach(function (r) {
        var a = r[key], p = r.pred;
        if ((Math.abs(a) < 0.05 && Math.abs(p) < 0.05) || (a > 0 && p > 0) || (a < 0 && p < 0)) hit++;
        sxy += a * p; sxx += p * p;
    });
    return {
        n: n, moving: moving.length, days: new Set(done.map(function (r) { return r.date; })).size,
        bias: n ? err / n : NaN, mae: n ? abs / n : NaN,
        hit: moving.length ? hit / moving.length * 100 : NaN,
        ratio: sxx > 0 ? sxy / sxx : NaN
    };
}

function renderAccuracy() {
    var rows = ACC_STATE.rows || [];
    var key = ACC_STATE.metric === 'close' ? 'closePct' : 'openPct';
    var label = ACC_STATE.metric === 'close' ? '종가' : '시가';
    var status = document.getElementById('accStatus');
    var allDays = Array.from(new Set(rows.map(function (r) { return r.date; }))).sort();
    var total = accStats(rows, key);

    status.innerHTML = rows.length
        ? '예측 기록 <b>' + allDays.length + '일</b> · 실제값이 채워진 날 <b>' + total.days + '일</b> (평일 16:10 자동 기록)'
        : '아직 기록이 없어요. 평일 07:30 알림이 돌면 쌓이기 시작해요.';

    var fmt = function (v, d, suf) { return isFinite(v) ? v.toFixed(d) + (suf || '') : '–'; };
    document.getElementById('accKpiMae').textContent = fmt(total.mae, 2, '%p');
    document.getElementById('accKpiHit').textContent = fmt(total.hit, 0, '%');
    document.getElementById('accKpiBias').textContent = isFinite(total.bias) ? (total.bias > 0 ? '+' : '') + total.bias.toFixed(2) + '%p' : '–';
    document.getElementById('accKpiBiasNote').textContent = !isFinite(total.bias) ? '' : (Math.abs(total.bias) < 0.1 ? '치우침 거의 없음' : (total.bias > 0 ? '예측이 실제보다 높게 나오는 편' : '예측이 실제보다 낮게 나오는 편'));
    document.getElementById('accKpiLabel').textContent = label;

    // ETF 별 표
    var byName = {};
    rows.forEach(function (r) { (byName[r.name] = byName[r.name] || []).push(r); });
    var names = Object.keys(byName);
    var list = names.map(function (nm) {
        var s = accStats(byName[nm], key), last = byName[nm][byName[nm].length - 1];
        var beta = last.beta, rec = NaN;
        if (s.moving >= 5 && isFinite(s.ratio) && isFinite(beta)) rec = Math.min(1.5, Math.max(0.5, beta * s.ratio));
        return { name: nm, s: s, beta: beta, rec: rec, domestic: s.moving === 0 && s.n > 0 };
    }).sort(function (a, b) {
        if (a.domestic !== b.domestic) return a.domestic ? 1 : -1;
        return (isFinite(b.s.mae) ? b.s.mae : -1) - (isFinite(a.s.mae) ? a.s.mae : -1);
    });

    var tb = document.getElementById('accTableBody');
    tb.innerHTML = list.map(function (x) {
        var s = x.s, recTxt = '–', recCls = 'text-slate-400';
        if (isFinite(x.rec)) {
            var d = x.rec - x.beta;
            recTxt = x.rec.toFixed(2) + (Math.abs(d) >= 0.05 ? ' <span class="text-xs">(' + (d > 0 ? '▲' : '▼') + Math.abs(d).toFixed(2) + ')</span>' : '');
            recCls = Math.abs(d) >= 0.1 ? 'text-amber-600 font-black' : 'text-slate-700';
        } else if (!x.domestic && s.moving < 5) {
            recTxt = '<span class="text-xs">' + s.moving + '/5일</span>';
        }
        var biasCls = !isFinite(s.bias) ? '' : (s.bias > 0 ? 'text-red-500' : 'text-blue-500');
        return '<tr class="hover:bg-slate-50">' +
            '<td class="px-4 py-3 font-bold text-slate-700">' + x.name + (x.domestic ? ' <span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">국내</span>' : '') + '</td>' +
            '<td class="px-4 py-3 text-right mono">' + s.n + '</td>' +
            '<td class="px-4 py-3 text-right mono">' + fmt(s.mae, 2) + '</td>' +
            '<td class="px-4 py-3 text-right mono ' + biasCls + '">' + (isFinite(s.bias) ? (s.bias > 0 ? '+' : '') + s.bias.toFixed(2) : '–') + '</td>' +
            '<td class="px-4 py-3 text-right mono">' + (x.domestic ? '–' : fmt(s.hit, 0, '%')) + '</td>' +
            '<td class="px-4 py-3 text-right mono">' + (isFinite(x.beta) ? x.beta.toFixed(2) : '–') + '</td>' +
            '<td class="px-4 py-3 text-right mono ' + recCls + '">' + recTxt + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400">기록 대기 중</td></tr>';

    accDrawCharts(rows, key, label, allDays);
}

function accDrawCharts(rows, key, label, days) {
    if (typeof Chart === 'undefined') return;
    // 날짜별 평균 (해외 ETF 만)
    var avgP = [], avgA = [], mae = [];
    days.forEach(function (d) {
        var l = rows.filter(function (r) { return r.date === d && r.pred !== 0 && isFinite(r.pred); });
        var la = l.filter(function (r) { return isFinite(r[key]); });
        avgP.push(l.length ? +(l.reduce(function (s, r) { return s + r.pred; }, 0) / l.length).toFixed(2) : null);
        avgA.push(la.length ? +(la.reduce(function (s, r) { return s + r[key]; }, 0) / la.length).toFixed(2) : null);
        mae.push(la.length ? +(la.reduce(function (s, r) { return s + Math.abs(r.pred - r[key]); }, 0) / la.length).toFixed(2) : null);
    });
    if (ACC_STATE.chart) ACC_STATE.chart.destroy();
    ACC_STATE.chart = new Chart(document.getElementById('accLineChart'), {
        type: 'line',
        data: {
            labels: days.map(function (d) { return d.slice(5).replace('-', '/'); }),
            datasets: [
                { label: '예상 등락 평균', data: avgP, borderColor: '#94a3b8', borderDash: [5, 4], tension: 0.2, spanGaps: true, pointRadius: 3 },
                { label: '실제 ' + label + ' 등락 평균', data: avgA, borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.2, spanGaps: true, pointRadius: 3 },
                { label: '평균 오차(절대값)', data: mae, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.15)', fill: true, tension: 0.2, spanGaps: true, pointRadius: 2 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: { y: { ticks: { callback: function (v) { return v + '%'; } } } } }
    });

    var pts = rows.filter(function (r) { return r.pred !== 0 && isFinite(r.pred) && isFinite(r[key]); })
        .map(function (r) { return { x: r.pred, y: r[key], n: r.name, d: r.date }; });
    var lim = Math.max(1, Math.ceil(Math.max.apply(null, pts.map(function (p) { return Math.max(Math.abs(p.x), Math.abs(p.y)); }).concat([1])) * 1.1));
    if (ACC_STATE.scatter) ACC_STATE.scatter.destroy();
    ACC_STATE.scatter = new Chart(document.getElementById('accScatterChart'), {
        type: 'scatter',
        data: { datasets: [
            { label: 'ETF·날짜', data: pts, backgroundColor: 'rgba(37,99,235,.55)', pointRadius: 4 },
            { label: '완벽히 맞은 선', type: 'line', data: [{ x: -lim, y: -lim }, { x: lim, y: lim }], borderColor: '#cbd5e1', borderDash: [4, 4], pointRadius: 0 }
        ] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var p = c.raw; return p.n ? p.d + ' ' + p.n + ' · 예상 ' + p.x + '% / 실제 ' + p.y + '%' : ''; } } } },
            scales: { x: { min: -lim, max: lim, title: { display: true, text: '예상 등락 (%)' } }, y: { min: -lim, max: lim, title: { display: true, text: '실제 ' + label + ' 등락 (%)' } } } }
    });
}
