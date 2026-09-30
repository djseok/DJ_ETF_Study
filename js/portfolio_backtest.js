// =========================================================
// 🕰️ 포트폴리오 백테스트 (V1.0)
// "이 조합으로 과거에 투자했다면?" — 실제 과거 가격으로 거치식/적립식 결과 계산
//
// 계산 규칙 (화면 하단에도 안내)
// - 가격: 야후 수정주가(adjclose)가 있으면 사용 → 분배금 재투자 효과 포함
//         없으면 분배금 기록(events)으로 재투자 반영, 그것도 없으면 가격만
// - 거치식: 첫 거래일에 목표 비중대로 한 번에 매수
// - 적립식: 매월 첫 거래일에 적립금을 목표 비중대로 매수 (소수점 매수 가정)
// - 리밸런싱(선택): 매년 1월 첫 거래일에 목표 비중으로 되돌림
// - 수수료·세금·환전 비용은 반영하지 않음
// =========================================================

const PBT_PRICE_PROXY_URL = "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec";
const PBT_FX_TICKER = "KRW=X"; // 원달러 환율 (미국 종목을 원화로 환산)

// MasterData 시트 이름과 멤버 시트 이름이 다른 경우 보정 (정규화된 이름 → 종목코드)
const PBT_CODE_ALIASES = {
    "TIME글로벌AI인공지능액티브": "456600.KS"
};

let pbtNameToTicker = {};   // 정규화된 종목명 → 야후 티커
let pbtTickerToName = {};   // 야후 티커 → 표시 이름
let pbtPriceCache = {};     // 티커|기간 → 가격 시계열
let pbtValueChart = null, pbtDdChart = null;
let pbtInitialized = false;

function pbtNormalize(name) {
    return String(name || '').replace(/\s+/g, '').toUpperCase().replace(/커브드/g, '커버드');
}

// 사용자가 입력한 코드를 야후 티커로: 390390 → 390390.KS, nvda → NVDA
function pbtToYahooTicker(code) {
    let c = String(code || '').trim().toUpperCase().replace(/^KRX:/, '');
    if (!c) return '';
    if (/^\d[0-9A-Z]{5}$/.test(c)) return c + '.KS';
    return c;
}

function pbtIsKrw(ticker) {
    return /\.(KS|KQ)$/.test(ticker) || ticker === PBT_FX_TICKER;
}

// ---------------------------------------------------------
// 화면 준비
// ---------------------------------------------------------
function initPortfolioBacktestView() {
    pbtBuildNameIndex();

    const memberSel = document.getElementById('pbt-member');
    const names = (typeof globalParsedUsers !== 'undefined' && globalParsedUsers) ? Object.keys(globalParsedUsers) : [];
    if (memberSel && memberSel.options.length !== names.length) {
        memberSel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    if (!pbtInitialized) {
        pbtInitialized = true;
        // 첫 방문: 첫 번째 멤버 포트폴리오를 미리 채워둠 (없으면 빈 줄 2개)
        if (names.length > 0) pbtLoadMember();
        else { pbtAddRow(); pbtAddRow(); }
        pbtToggleInputs();
    }
}

// MasterData 시트(main.js의 masterData)에서 이름 ↔ 코드 사전 만들기
function pbtBuildNameIndex() {
    pbtNameToTicker = {};
    pbtTickerToName = {};
    const options = [];
    (typeof masterData !== 'undefined' ? masterData : []).forEach(row => {
        const kind = String(row[0] || '').trim();
        const code = String(row[1] || '').trim();
        const name = String(row[2] || '').trim();
        if (!code || !name || kind === '지표' || kind === '구분') return;
        if (code.startsWith('CURRENCY:')) return;
        const ticker = pbtToYahooTicker(code);
        if (!ticker) return;
        pbtNameToTicker[pbtNormalize(name)] = ticker;
        if (!pbtTickerToName[ticker]) pbtTickerToName[ticker] = name;
        options.push(`<option value="${name.replace(/"/g, '&quot;')}">${code.replace(/^KRX:/, '')}</option>`);
    });
    Object.keys(PBT_CODE_ALIASES).forEach(k => { if (!pbtNameToTicker[k]) pbtNameToTicker[k] = PBT_CODE_ALIASES[k]; });
    const dl = document.getElementById('pbt-name-list');
    if (dl) dl.innerHTML = options.join('');
}

function pbtLookupTicker(name) {
    return pbtNameToTicker[pbtNormalize(name)] || '';
}

function pbtToggleInputs() {
    const mode = document.getElementById('pbt-mode').value;
    document.getElementById('pbt-initial-wrap').style.opacity = (mode === 'dca') ? '0.35' : '1';
    document.getElementById('pbt-monthly-wrap').style.opacity = (mode === 'lump') ? '0.35' : '1';
}

function pbtAddRow(name, code, weight) {
    const tbody = document.getElementById('pbt-rows');
    const tr = document.createElement('tr');
    tr.className = 'pbt-row';
    tr.innerHTML = `
        <td class="py-1 pr-2"><input list="pbt-name-list" class="pbt-name w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-sm" placeholder="예: KODEX 미국반도체"></td>
        <td class="py-1 pr-2"><input class="pbt-code w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white mono text-sm" placeholder="390390 / NVDA"></td>
        <td class="py-1 pr-2"><input type="number" min="0" step="1" class="pbt-weight w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white mono text-sm text-right"></td>
        <td class="py-1 text-center"><button class="text-slate-400 hover:text-red-500" title="삭제"><i class="fas fa-times"></i></button></td>`;
    const nameEl = tr.querySelector('.pbt-name'), codeEl = tr.querySelector('.pbt-code'), wEl = tr.querySelector('.pbt-weight');
    nameEl.value = name || '';
    codeEl.value = code || '';
    wEl.value = (weight !== undefined && weight !== null) ? weight : '';

    // 이름을 고르면 코드 자동 채움
    nameEl.addEventListener('change', () => {
        const t = pbtLookupTicker(nameEl.value);
        if (t) { codeEl.value = t.replace(/\.KS$/, ''); pbtMarkCode(codeEl, true); }
    });
    codeEl.addEventListener('input', () => pbtMarkCode(codeEl, !!codeEl.value.trim()));
    wEl.addEventListener('input', pbtUpdateWeightSum);
    tr.querySelector('button').addEventListener('click', () => { tr.remove(); pbtUpdateWeightSum(); });

    tbody.appendChild(tr);
    pbtMarkCode(codeEl, !!codeEl.value.trim() || !nameEl.value);
    pbtUpdateWeightSum();
}

function pbtMarkCode(codeEl, ok) {
    codeEl.classList.toggle('border-red-400', !ok);
    codeEl.classList.toggle('bg-red-50', !ok);
    codeEl.placeholder = ok ? '390390 / NVDA' : '코드 입력 필요';
}

function pbtUpdateWeightSum() {
    let sum = 0;
    document.querySelectorAll('#pbt-rows .pbt-weight').forEach(el => sum += parseFloat(el.value) || 0);
    const el = document.getElementById('pbt-weight-sum');
    el.innerText = `${Math.round(sum * 10) / 10}%`;
    el.className = 'mono font-black ' + (Math.abs(sum - 100) < 0.5 ? 'text-emerald-600' : 'text-orange-500');
}

// 멤버의 현재 보유 종목을 평가금액 비중으로 채우기
async function pbtLoadMember() {
    if (typeof loadPortfolioData === 'function') await loadPortfolioData('portBt');
    const name = document.getElementById('pbt-member').value;
    const user = globalParsedUsers ? globalParsedUsers[name] : null;
    if (!user) return;

    const held = user.items.filter(it => it.qty > 0 && it.current > 0);
    const total = held.reduce((s, it) => s + it.current, 0);
    document.getElementById('pbt-rows').innerHTML = '';
    held.sort((a, b) => b.current - a.current).forEach(it => {
        const t = pbtLookupTicker(it.stock);
        pbtAddRow(it.stock, t ? t.replace(/\.KS$/, '') : '', Math.round(it.current / total * 1000) / 10);
    });
    if (held.length === 0) pbtAddRow();
}

// ---------------------------------------------------------
// 가격 데이터
// ---------------------------------------------------------
async function pbtFetchSeries(ticker, years) {
    const range = years <= 1 ? '2y' : (years <= 5 ? '5y' : '10y');
    const key = `${ticker}|${range}`;
    if (pbtPriceCache[key]) return pbtPriceCache[key];

    const res = await fetch(`${PBT_PRICE_PROXY_URL}?ticker=${encodeURIComponent(ticker)}&range=${range}&interval=1d&events=div`);
    if (!res.ok) throw new Error(`${ticker}: 가격 서버 응답 실패`);
    const data = await res.json();
    if (data.error || !data.chart || !data.chart.result || !data.chart.result[0]) {
        throw new Error(`${ticker}: 가격 데이터를 찾을 수 없어요`);
    }
    const series = pbtParseChart(data.chart.result[0]);
    if (series.dates.length < 2) throw new Error(`${ticker}: 가격 데이터가 너무 적어요`);
    pbtPriceCache[key] = series;
    return series;
}

// 야후 차트 응답 → { dates:[YYYY-MM-DD], prices:[총수익 기준 가격], divMode }
function pbtParseChart(r) {
    const ts = r.timestamp || [];
    const close = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
    const adj = (r.indicators && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose) || null;
    const divEvents = (r.events && r.events.dividends) ? Object.values(r.events.dividends) : [];

    const toDate = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
    const divByDate = {};
    divEvents.forEach(d => { if (d && d.date && d.amount) divByDate[toDate(d.date)] = (divByDate[toDate(d.date)] || 0) + d.amount; });

    // 수정주가가 종가와 실제로 다를 때만 "배당 반영"으로 간주
    let adjUsable = false;
    if (adj) {
        for (let i = 0; i < close.length; i++) {
            if (close[i] && adj[i] && Math.abs(adj[i] / close[i] - 1) > 0.001) { adjUsable = true; break; }
        }
    }
    const divMode = adjUsable ? 'adj' : (divEvents.length ? 'events' : 'price');

    const dates = [], prices = [];
    let tr = null, prevClose = null;
    for (let i = 0; i < ts.length; i++) {
        const c = close[i];
        if (c == null || !(c > 0)) continue;
        const d = toDate(ts[i]);
        if (dates.length && dates[dates.length - 1] === d) continue;
        let p;
        if (divMode === 'adj') {
            p = adj[i];
            if (p == null) continue;
        } else if (divMode === 'events') {
            // 분배락일에 분배금을 재투자했다고 보고 총수익 지수를 이어감
            tr = (tr === null) ? c : tr * (c + (divByDate[d] || 0)) / prevClose;
            p = tr;
        } else {
            p = c;
        }
        prevClose = c;
        dates.push(d);
        prices.push(p);
    }
    return { dates, prices, divMode };
}

// ---------------------------------------------------------
// 시뮬레이션
// ---------------------------------------------------------
// 여러 시계열을 공통 날짜로 맞춤 (앞 값으로 채움). startDate 이전은 제외.
function pbtAlign(seriesList, startDate) {
    const dateSet = new Set();
    seriesList.forEach(s => s.dates.forEach(d => { if (d >= startDate) dateSet.add(d); }));
    const dates = Array.from(dateSet).sort();
    const aligned = seriesList.map(s => {
        const out = new Array(dates.length);
        let j = 0, last = null;
        for (let i = 0; i < dates.length; i++) {
            while (j < s.dates.length && s.dates[j] <= dates[i]) { last = s.prices[j]; j++; }
            out[i] = last;
        }
        return out;
    });
    return { dates, aligned };
}

// 한 포트폴리오를 날짜별로 굴려서 평가금액·원금·시간가중수익 지수를 계산
function pbtSimulate(dates, priceCols, weights, opts) {
    const n = priceCols.length;
    const units = new Array(n).fill(0);
    const value = [], invested = [], twr = [], flows = [];
    let totalInvested = 0, prevValueAfter = 0, index = 1;

    const buy = (i, amount) => {
        for (let k = 0; k < n; k++) units[k] += amount * weights[k] / priceCols[k][i];
    };

    for (let i = 0; i < dates.length; i++) {
        const valBefore = units.reduce((s, u, k) => s + u * priceCols[k][i], 0);
        if (i > 0 && prevValueAfter > 0) index *= valBefore / prevValueAfter;

        const month = dates[i].slice(0, 7);
        const isNewMonth = i === 0 || month !== dates[i - 1].slice(0, 7);
        const isNewYear = i > 0 && dates[i].slice(0, 4) !== dates[i - 1].slice(0, 4);

        // 매년 1월 첫 거래일 리밸런싱
        if (opts.rebalance === 'yearly' && isNewYear && valBefore > 0) {
            for (let k = 0; k < n; k++) units[k] = valBefore * weights[k] / priceCols[k][i];
        }

        let flow = 0;
        if (i === 0 && (opts.mode === 'lump' || opts.mode === 'both')) flow += opts.initial;
        if (isNewMonth && (opts.mode === 'dca' || (opts.mode === 'both' && i > 0))) flow += opts.monthly;
        if (flow > 0) { buy(i, flow); totalInvested += flow; flows.push({ date: dates[i], amount: -flow }); }

        const valAfter = units.reduce((s, u, k) => s + u * priceCols[k][i], 0);
        value.push(valAfter);
        invested.push(totalInvested);
        twr.push(index);
        prevValueAfter = valAfter;
    }
    const finalValue = value[value.length - 1];
    flows.push({ date: dates[dates.length - 1], amount: finalValue });

    // 고점 대비 하락폭은 적립금 효과를 뺀 시간가중 지수로 계산
    let peak = -Infinity, mdd = 0;
    const dd = twr.map(v => { peak = Math.max(peak, v); const d = (v / peak - 1) * 100; mdd = Math.min(mdd, d); return d; });

    const years = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (365.25 * 864e5);
    const unitValues = units.map((u, k) => u * priceCols[k][dates.length - 1]);

    return {
        value, invested, dd, mdd, finalValue, totalInvested, unitValues,
        profit: finalValue - totalInvested,
        totalReturn: totalInvested > 0 ? (finalValue / totalInvested - 1) * 100 : 0,
        annualized: pbtXirr(flows) * 100,           // 돈의 흐름을 반영한 연평균 수익률
        twrAnnualized: (Math.pow(twr[twr.length - 1], 1 / Math.max(years, 1 / 365)) - 1) * 100,
        years
    };
}

// 날짜별 입출금으로 연 수익률(XIRR) 계산 — 이분법
function pbtXirr(flows) {
    const t0 = new Date(flows[0].date).getTime();
    const npv = (r) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (new Date(f.date).getTime() - t0) / (365.25 * 864e5)), 0);
    let lo = -0.99, hi = 10;
    if (npv(lo) * npv(hi) > 0) return 0;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
}

// ---------------------------------------------------------
// 실행
// ---------------------------------------------------------
async function pbtRun() {
    const status = document.getElementById('pbt-status');
    const btn = document.getElementById('pbt-run');
    const setStatus = (html, cls) => { status.innerHTML = html; status.className = 'text-xs font-bold ' + (cls || 'text-slate-500'); };

    // 입력 모으기
    const assets = [];
    let problems = [];
    document.querySelectorAll('#pbt-rows .pbt-row').forEach(tr => {
        const name = tr.querySelector('.pbt-name').value.trim();
        const ticker = pbtToYahooTicker(tr.querySelector('.pbt-code').value);
        const w = parseFloat(tr.querySelector('.pbt-weight').value) || 0;
        if (!name && !ticker) return;
        if (w <= 0) return;
        if (!ticker) { problems.push(`${name || '(이름 없음)'}의 종목코드`); return; }
        assets.push({ name: name || pbtTickerToName[ticker] || ticker, ticker, weight: w });
    });
    if (problems.length) return setStatus(`⚠️ 입력이 필요해요: ${problems.join(', ')}`, 'text-red-500');
    if (!assets.length) return setStatus('⚠️ 종목과 비중을 입력해 주세요.', 'text-red-500');

    const wSum = assets.reduce((s, a) => s + a.weight, 0);
    assets.forEach(a => a.w = a.weight / wSum); // 합계가 100이 아니어도 비율로 맞춤

    const years = parseInt(document.getElementById('pbt-period').value);
    const opts = {
        mode: document.getElementById('pbt-mode').value,
        rebalance: document.getElementById('pbt-rebal').value,
        initial: parseFloat(document.getElementById('pbt-initial').value) || 0,
        monthly: parseFloat(document.getElementById('pbt-monthly').value) || 0
    };
    if ((opts.mode !== 'dca' && opts.initial <= 0) || (opts.mode !== 'lump' && opts.monthly <= 0)) {
        return setStatus('⚠️ 투자 금액을 입력해 주세요.', 'text-red-500');
    }
    const benchTicker = document.getElementById('pbt-bench').value;
    const benchName = document.getElementById('pbt-bench').selectedOptions[0].text;

    btn.disabled = true;
    document.getElementById('pbt-result').classList.add('hidden'); // 이전 결과 숨김
    setStatus(`<i class="fas fa-spinner fa-spin mr-1"></i> ${assets.length}개 종목의 과거 가격을 받는 중... (종목당 몇 초 걸려요)`);

    try {
        const needFx = assets.some(a => !pbtIsKrw(a.ticker)) || (benchTicker && !pbtIsKrw(benchTicker));
        const tickers = assets.map(a => a.ticker).concat(benchTicker ? [benchTicker] : []).concat(needFx ? [PBT_FX_TICKER] : []);

        const results = await Promise.allSettled(tickers.map(t => pbtFetchSeries(t, years)));
        const failed = results.map((r, i) => r.status === 'rejected' ? tickers[i] : null).filter(Boolean);
        if (failed.length) {
            throw new Error(`가격을 받지 못한 종목: ${failed.map(t => pbtTickerToName[t] || t).join(', ')} — 종목코드를 확인해 주세요.`);
        }
        const seriesByTicker = {};
        tickers.forEach((t, i) => seriesByTicker[t] = results[i].value);

        // 미국 종목은 원화로 환산
        const fx = needFx ? seriesByTicker[PBT_FX_TICKER] : null;
        const toKrw = (t) => {
            const s = seriesByTicker[t];
            if (pbtIsKrw(t)) return s;
            const { dates, aligned } = pbtAlign([s, fx], s.dates[0]);
            return { dates, prices: aligned[0].map((p, i) => aligned[1][i] ? p * aligned[1][i] : null), divMode: s.divMode };
        };

        // 시작일: 요청 기간 시작 vs 가장 늦게 상장한 종목의 첫 거래일 중 늦은 날
        const wantStart = new Date();
        wantStart.setFullYear(wantStart.getFullYear() - years);
        const wantStartStr = wantStart.toISOString().slice(0, 10);
        const portSeries = assets.map(a => toKrw(a.ticker));
        const benchSeries = benchTicker ? toKrw(benchTicker) : null;
        const allSeries = portSeries.concat(benchSeries ? [benchSeries] : []);
        let startDate = wantStartStr, lateAsset = null;
        allSeries.forEach((s, i) => {
            const first = s.dates.find((d, j) => s.prices[j] != null);
            if (first > startDate) { startDate = first; lateAsset = i < assets.length ? assets[i].name : benchName; }
        });

        const { dates, aligned } = pbtAlign(allSeries, startDate);
        if (dates.length < 20) throw new Error('겹치는 기간이 너무 짧아요. 최근 상장한 종목을 빼거나 기간을 줄여 보세요.');

        const portCols = aligned.slice(0, assets.length);
        const port = pbtSimulate(dates, portCols, assets.map(a => a.w), opts);
        const bench = benchSeries ? pbtSimulate(dates, [aligned[assets.length]], [1], opts) : null;

        const assetStats = assets.map((a, k) => ({
            ...a,
            selfReturn: (portCols[k][dates.length - 1] / portCols[k][0] - 1) * 100,
            finalValue: port.unitValues[k],
            divMode: seriesByTicker[a.ticker].divMode
        }));

        pbtRender({ dates, port, bench, benchName, assets: assetStats, opts, startDate, wantStartStr, lateAsset, years });
        setStatus(`✅ ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length.toLocaleString()}거래일) 계산 완료`, 'text-emerald-600');
    } catch (e) {
        console.error(e);
        setStatus(`❌ ${e.message}`, 'text-red-500');
    } finally {
        btn.disabled = false;
    }
}

// ---------------------------------------------------------
// 결과 그리기
// ---------------------------------------------------------
function pbtRender(r) {
    const won = (v) => `₩${Math.round(v).toLocaleString()}`;
    const pct = (v, digits) => `${v >= 0 ? '+' : ''}${v.toFixed(digits === undefined ? 1 : digits)}%`;
    const color = (v) => v >= 0 ? 'text-red-500' : 'text-blue-500';
    const vsBench = (a, b, fmt) => r.bench ? `<div class="text-[11px] font-bold text-slate-400 mt-1">${r.benchName}: ${fmt(b)}</div>` : '';

    const card = (label, main, cls, sub) => `
        <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <div class="text-[11px] font-bold text-slate-400 mb-1">${label}</div>
            <div class="text-xl font-black mono ${cls || 'text-slate-800'}">${main}</div>${sub || ''}
        </div>`;

    const p = r.port, b = r.bench;
    document.getElementById('pbt-cards').innerHTML =
        card('최종 평가금액', won(p.finalValue), '', `<div class="text-[11px] font-bold text-slate-400 mt-1">투자원금 ${won(p.totalInvested)}</div>`) +
        card('총 수익률', pct(p.totalReturn), color(p.totalReturn), vsBench(p, b && b.totalReturn, pct)) +
        card(r.opts.mode === 'lump' ? '연평균 수익률 (CAGR)' : '연평균 수익률 (적립 반영)', pct(p.annualized), color(p.annualized), vsBench(p, b && b.annualized, pct)) +
        card('최대 낙폭 (MDD)', `${p.mdd.toFixed(1)}%`, 'text-blue-600', vsBench(p, b && b.mdd, v => `${v.toFixed(1)}%`));

    // 차트는 주 단위로 줄여서 그림 (5년 = 약 260개 점)
    const step = Math.max(1, Math.floor(r.dates.length / 300));
    const idx = r.dates.map((_, i) => i).filter(i => i % step === 0 || i === r.dates.length - 1);
    const pick = (arr) => idx.map(i => arr[i]);
    const labels = pick(r.dates);

    const lineDs = (label, data, color, extra) => Object.assign({
        label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: 0.1
    }, extra || {});

    const valueDatasets = [lineDs('내 포트폴리오', pick(p.value), 'rgb(2, 132, 199)')];
    if (b) valueDatasets.push(lineDs(r.benchName, pick(b.value), 'rgb(148, 163, 184)'));
    valueDatasets.push(lineDs('투자원금', pick(p.invested), 'rgb(234, 88, 12)', { borderDash: [5, 4], borderWidth: 1.5, stepped: true }));

    if (pbtValueChart) pbtValueChart.destroy();
    pbtValueChart = new Chart(document.getElementById('pbt-value-chart'), {
        type: 'line',
        data: { labels, datasets: valueDatasets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { weight: 'bold' } } },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${won(c.raw)}` } }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } },
                y: { ticks: { callback: (v) => v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : `${Math.round(v / 1e4).toLocaleString()}만` } }
            }
        }
    });

    const ddDatasets = [lineDs('내 포트폴리오', pick(p.dd), 'rgb(37, 99, 235)', { fill: true, backgroundColor: 'rgba(37, 99, 235, 0.15)' })];
    if (b) ddDatasets.push(lineDs(r.benchName, pick(b.dd), 'rgb(148, 163, 184)', { borderWidth: 1.5 }));
    if (pbtDdChart) pbtDdChart.destroy();
    pbtDdChart = new Chart(document.getElementById('pbt-dd-chart'), {
        type: 'line',
        data: { labels, datasets: ddDatasets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { weight: 'bold' } } },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%` } }
            },
            scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { max: 0, ticks: { callback: (v) => `${v}%` } } }
        }
    });

    const divLabel = { adj: '✅ 포함', events: '✅ 포함', price: '— 기록 없음' };
    document.getElementById('pbt-asset-table').innerHTML = r.assets.map(a => `
        <tr>
            <td class="py-2 font-bold text-slate-800">${a.name} <span class="text-[11px] text-slate-400 mono">${a.ticker.replace(/\.KS$/, '')}</span></td>
            <td class="py-2 text-right mono text-slate-500">${(a.w * 100).toFixed(1)}%</td>
            <td class="py-2 text-right mono font-bold ${color(a.selfReturn)}">${pct(a.selfReturn)}</td>
            <td class="py-2 text-right mono font-bold text-slate-800">${won(a.finalValue)}</td>
            <td class="py-2 text-right text-xs font-bold ${a.divMode === 'price' ? 'text-orange-500' : 'text-emerald-600'}">${divLabel[a.divMode]}</td>
        </tr>`).join('');

    const notes = [];
    if (r.lateAsset && r.startDate > r.wantStartStr) {
        notes.push(`📌 <b>${r.lateAsset}</b>의 상장일(데이터 시작일)이 늦어서 요청한 ${r.years}년 대신 <b>${r.startDate}</b>부터 계산했어요.`);
    }
    if (r.assets.some(a => a.divMode === 'price')) {
        notes.push('ℹ️ 배당 반영이 "기록 없음"인 종목은 가격 데이터에 분배금 정보가 없어 가격 변화만 계산했어요. 원래 분배금이 없는 종목이면 문제없지만, 월배당·커버드콜 ETF라면 실제보다 수익률이 낮게 나올 수 있어요.');
    }
    notes.push('계산 기준: 적립식은 매월 첫 거래일 매수, 소수점 매수 가정 · 수수료·세금·환전 비용 미반영 · 미국 종목은 원달러 환율로 원화 환산 · 최대 낙폭은 적립금 효과를 뺀 수익률 기준 · 과거 결과가 미래 수익을 보장하지 않아요.');
    document.getElementById('pbt-notes').innerHTML = notes.map(n => `<p class="mb-1">${n}</p>`).join('');
    document.getElementById('pbt-chart-note').innerText = `${r.dates[0]} ~ ${r.dates[r.dates.length - 1]} · 리밸런싱 ${r.opts.rebalance === 'yearly' ? '매년 1월' : '안 함'}`;

    document.getElementById('pbt-result').classList.remove('hidden');
}
