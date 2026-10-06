// =====================================================
// 🔍 실제 종목 비중 (ETF 속 종목 합산)
//   멤버가 가진 ETF를 보유종목(ETF_Quant_Signals, 매일 06시 운용사·WiseReport 기준)으로 펼쳐
//   같은 종목끼리 더함 → "NVDA 를 여러 ETF로 합쳐서 실제 얼마 들고 있나"
//   - ETF 금액 × 그 ETF 안의 비중(비중 합계로 나눠 100%로 맞춤 — 커버드콜처럼 합계가 100%를 조금 넘는 경우)
//   - 보유종목 정보가 없는 것(직접 산 종목·달러 자산 등)은 그 자체를 한 종목으로 봄
//   - ETF 안의 ETF(예: VOO)는 한 번만 펼침 (그 안까지 다시 펼치지 않음)
// =====================================================

var lookThroughMap = null; // 정규화한 ETF 이름 → [{ name, ticker, w }]
var lookThroughDates = {}; // 정규화한 ETF 이름 → 보유종목 기준일 (ETF_Quant_Signals ■ 줄 H열)
var lookThroughTickers = {}; // 정규화한 종목명 → 티커 (직접 산 '삼성전자'를 ETF 속 'KRX:005930'과 합치려고)

function buildLookThroughMap() {
    const map = {};
    const rows = (typeof signalData !== 'undefined' && signalData) ? signalData : [];
    let cur = null;
    rows.forEach(r => {
        const a = String(r[0] || '').trim();
        if (a.startsWith('■')) {
            cur = normalizeLtName(a.replace('■', '')); map[cur] = [];
            const d = String(r[7] || '').match(/\d{4}-\d{2}-\d{2}/); lookThroughDates[cur] = d ? d[0] : '';
            return;
        }
        if (!cur || a !== '구성종목') return;
        const raw = String(r[3] || '').replace(/,/g, '').trim();
        let w = parseFloat(raw) || 0;
        if (!raw.includes('%') && w > 0 && w <= 1) w = w * 100;
        if (w > 0) map[cur].push({ name: String(r[1] || '').trim(), ticker: String(r[2] || '').trim(), w: w });
    });
    Object.keys(map).forEach(k => { if (!map[k].length) delete map[k]; });
    // 종목명 → 티커: MasterData(B 티커 · C 이름) 다음 ETF 보유종목 (나중 것이 우선)
    const names = {};
    ((typeof masterData !== 'undefined' && masterData) ? masterData : []).forEach(r => {
        const t = String(r[1] || '').trim(), n = normalizeLtName(r[2]);
        if (t && n) names[n] = t;
    });
    Object.values(map).forEach(list => list.forEach(c => { if (c.ticker) names[normalizeLtName(c.name)] = c.ticker; }));
    lookThroughTickers = names;
    return map;
}

// 공백·대소문자 무시, 시트의 '커브드' 오타는 '커버드'로 (예: KODEX 미국나스닥100 데일리커브드콜OTM)
function normalizeLtName(name) { return String(name || '').replace(/\s+/g, '').toUpperCase().replace(/커브드/g, '커버드'); }

// 같은 종목을 한 줄로: 국내 코드는 'KRX:005930' · '005930' · '5930' 모두 같은 것으로
function lookThroughKey(ticker, name) {
    let t = String(ticker || '').trim().toUpperCase().replace(/^KRX:/, '');
    if (/^\d{1,6}$/.test(t)) t = ('000000' + t).slice(-6);
    if (t) return 'T:' + t;
    if (/현금|예금|CASH|원화|USD|KRW|DEPOSIT/i.test(name)) return 'CASH';
    return 'N:' + normalizeLtName(name);
}

// 멤버 한 명 → [{ key, name, ticker, amount, via:[ETF 이름…] }] 금액 큰 순 + 합계·펼친 비중
function computeLookThrough(user) {
    if (!lookThroughMap || !Object.keys(lookThroughMap).length) lookThroughMap = buildLookThroughMap();
    const agg = {};
    let total = 0, covered = 0;
    const missing = []; // ETF 같은데 보유종목을 못 찾은 것 (이름이 MasterData 와 다름 · 본체ETF 아님)
    const add = (key, name, ticker, amount, via) => {
        const g = agg[key] = agg[key] || { key: key, name: name, ticker: ticker, amount: 0, via: [] };
        g.amount += amount;
        if (via && g.via.indexOf(via) < 0) g.via.push(via);
    };
    (user.items || []).filter(it => it.qty > 0 && it.current > 0).forEach(it => {
        total += it.current;
        const comps = lookThroughMap[normalizeLtName(it.stock)];
        if (!comps) {
            const t = lookThroughTickers[normalizeLtName(it.stock)] || '';
            if (/^(KODEX|TIGER|RISE|ACE|SOL|TIME|HANARO|KIWOOM|PLUS|KOACT|1Q|BNK|WON|UNICORN|파워|마이티|히어로즈)\b/i.test(it.stock) && missing.indexOf(it.stock) < 0) missing.push(it.stock);
            add(lookThroughKey(t, it.stock), it.stock, t, it.current, '직접 보유');
            return;
        }
        covered += it.current;
        const sum = comps.reduce((s, c) => s + c.w, 0);
        comps.forEach(c => {
            const key = lookThroughKey(c.ticker, c.name);
            add(key, key === 'CASH' ? '현금·기타' : c.name, key === 'CASH' ? '' : c.ticker, it.current * c.w / sum, it.stock);
        });
    });
    (user.usdItems || []).forEach(it => {
        const krw = it.curUsd * it.qty * (user.fx || 0);
        if (!(krw > 0)) return;
        total += krw;
        if (it.cash) add('CASH', '현금·기타', '', krw, '달러 예수금');
        else add(lookThroughKey(it.ticker, it.label), it.label || it.ticker, it.ticker, krw, '달러 자산');
    });
    const list = Object.values(agg).sort((a, b) => b.amount - a.amount);
    return { list: list, total: total, coveredPct: total > 0 ? covered / total * 100 : 0, missing: missing };
}

function lookThroughHtml(user) {
    const lt = computeLookThrough(user);
    if (!lt.total || !lt.list.length) return '';
    const won = v => '₩' + Math.round(v).toLocaleString();
    const top = lt.list.slice(0, 15);
    const maxPct = top[0].amount / lt.total * 100;
    const rows = top.map((g, i) => {
        const p = g.amount / lt.total * 100;
        const multi = g.via.length > 1;
        return `<tr class="border-b border-slate-50 text-xs">
            <td class="py-2 pr-2 text-slate-400 mono">${i + 1}</td>
            <td class="py-2 pr-2"><div class="font-bold text-slate-700">${escapeHtml(g.name)} ${g.ticker ? `<span class="text-[10px] text-slate-400">${escapeHtml(g.ticker)}</span>` : ''}</div>
                <div class="text-[10px] ${multi ? 'text-orange-600 font-bold' : 'text-slate-400'}">${multi ? g.via.length + '곳에서 합산 · ' : ''}${escapeHtml(g.via.slice(0, 3).join(', '))}${g.via.length > 3 ? ' 외 ' + (g.via.length - 3) + '개' : ''}</div></td>
            <td class="py-2 w-1/4"><div class="h-2 rounded-full bg-slate-100"><div class="h-2 rounded-full bg-orange-400" style="width:${Math.max(2, p / maxPct * 100).toFixed(1)}%"></div></div></td>
            <td class="py-2 pl-2 text-right mono font-bold text-slate-800">${p.toFixed(1)}%</td>
            <td class="py-2 pl-2 text-right mono text-slate-500">${won(g.amount)}</td></tr>`;
    }).join('');
    const top10 = lt.list.slice(0, 10).reduce((s, g) => s + g.amount, 0) / lt.total * 100;
    return `<details class="border-t border-slate-100"><summary class="px-4 py-3 cursor-pointer text-sm font-black text-slate-700 hover:bg-slate-50">🔍 실제 종목 비중 <span class="text-xs font-bold text-slate-400">ETF 속 종목을 합쳐서 보기 · 종목 ${lt.list.length}개 · 상위 10개 ${top10.toFixed(0)}%</span></summary>
        <div class="px-4 pb-4 overflow-x-auto"><table class="w-full text-left whitespace-nowrap"><tbody>${rows}</tbody></table>
        <p class="mt-2 text-[11px] text-slate-400">평가액 ${won(lt.total)} 중 ${lt.coveredPct.toFixed(0)}%를 ETF 보유종목으로 펼쳤어요(나머지는 그 종목 그대로). 보유종목은 운용사·WiseReport 공시 기준이라 1~2 영업일 늦을 수 있어요. ETF 안의 ETF(예: VOO)는 다시 펼치지 않아요.${lt.missing.length ? '<br>보유종목을 못 찾아 그대로 둔 ETF: ' + escapeHtml(lt.missing.join(', ')) + ' (MasterData 본체ETF 이름과 다르거나 등록 안 됨)' : ''}</p></div></details>`;
}

// =====================================================
// 🧩 ETF 연결 점검표 — 'ETF 하나 등록하면 다 연결됐나'를 한눈에
//   줄 = MasterData 본체ETF + 멤버가 가진 ETF + ETF 배당주기 (이름은 공백·대소문자·'커브드' 오타 무시)
//   이름이 조금 달라 두 줄로 나오면 → 시트 사이 이름이 서로 다르다는 뜻
// =====================================================
const LT_ETF_BRAND = /^(KODEX|TIGER|RISE|ACE|SOL|TIME|HANARO|KIWOOM|PLUS|KOACT|1Q|BNK|WON|UNICORN|파워|마이티|히어로즈)\b/i;

function renderEtfLinkCheck(users) {
    const box = document.getElementById('etfLinkCheck');
    if (!box) return;
    const draw = () => { box.innerHTML = etfLinkCheckHtml(users || []); };
    draw();
    if (typeof loadDynamicDividendRules === 'function') loadDynamicDividendRules().then(draw);
}

function etfLinkCheckHtml(users) {
    if (!lookThroughMap || !Object.keys(lookThroughMap).length) lookThroughMap = buildLookThroughMap();
    const rows = {}; // key → { name, code, price, comps, date, div, holders:[] }
    const row = (name) => {
        const k = normalizeLtName(name);
        return rows[k] = rows[k] || { name: String(name).trim(), code: '', price: 0, inMaster: false, holders: [] };
    };
    const num = v => parseFloat(String(v || '').replace(/[^0-9.-]/g, '')) || 0;
    ((typeof masterData !== 'undefined' && masterData) ? masterData : []).forEach(r => {
        if (String(r[0] || '').trim() !== '본체ETF' || !String(r[2] || '').trim()) return;
        const x = row(r[2]); x.inMaster = true; x.code = String(r[1] || '').trim(); x.price = num(r[4]) || num(r[3]);
    });
    users.forEach(u => (u.items || []).filter(it => it.qty > 0 && LT_ETF_BRAND.test(it.stock)).forEach(it => {
        const x = row(it.stock);
        if (x.holders.indexOf(u.name) < 0) x.holders.push(u.name);
    }));
    const rules = (typeof globalDividendRulesMatrix !== 'undefined' && globalDividendRulesMatrix) ? globalDividendRulesMatrix : null;
    const ruleOf = {};
    if (rules) Object.values(rules).forEach(rl => { ruleOf[normalizeLtName(rl.name)] = rl; if (LT_ETF_BRAND.test(rl.name)) row(rl.name); });

    const ok = '<span class="text-emerald-600 font-black">✓</span>', no = '<span class="text-red-500 font-black">✗</span>';
    let issues = 0;
    const list = Object.keys(rows).map(k => Object.assign({ k: k }, rows[k])).sort((a, b) => (b.holders.length - a.holders.length) || a.name.localeCompare(b.name));
    const body = list.map(x => {
        const comps = lookThroughMap[x.k], rl = ruleOf[x.k];
        const held = x.holders.length > 0;
        const bad = held && (!x.inMaster || !comps) || (rules && held && !rl);
        if (bad) issues++;
        return `<tr class="border-b border-slate-50 text-xs ${bad ? 'bg-orange-50' : ''}">
            <td class="py-2 pr-2 font-bold text-slate-700">${escapeHtml(x.name)}<div class="text-[10px] text-slate-400">${escapeHtml(x.code.replace(/^KRX:/, '')) || (x.inMaster ? '' : 'MasterData 미등록')}</div></td>
            <td class="py-2 px-1 text-center">${x.inMaster ? (x.price > 0 ? ok : no) : '–'}</td>
            <td class="py-2 px-1 text-center">${comps ? ok + `<div class="text-[10px] text-slate-400 mono">${comps.length}개 · ${escapeHtml((lookThroughDates[x.k] || '').slice(5))}</div>` : no}</td>
            <td class="py-2 px-1 text-center">${rules ? (rl ? ok + `<div class="text-[10px] text-slate-400">${rl.payMonths.length === 12 ? '매월' : escapeHtml(rl.payMonths.join('·')) + '월'}</div>` : no) : '…'}</td>
            <td class="py-2 pl-1 text-center text-[11px] font-bold ${held ? 'text-slate-700' : 'text-slate-300'}">${held ? escapeHtml(x.holders.join(', ')) : '–'}</td></tr>`;
    }).join('');
    return `<details class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"${issues ? ' open' : ''}>
        <summary class="p-4 cursor-pointer font-black text-slate-800">🧩 ETF 연결 점검 <span class="text-xs font-bold ${issues ? 'text-orange-600' : 'text-emerald-600'}">${issues ? '확인 필요 ' + issues + '개' : '보유 ETF 모두 연결됨'}</span></summary>
        <div class="px-4 pb-4 overflow-x-auto"><table class="w-full text-left whitespace-nowrap">
        <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100"><th class="py-2 pr-2">ETF</th><th class="px-1 text-center">가격</th><th class="px-1 text-center">보유종목</th><th class="px-1 text-center">배당주기</th><th class="pl-1 text-center">보유 멤버</th></tr></thead>
        <tbody>${body}</tbody></table>
        <p class="mt-2 text-[11px] text-slate-400">가격·보유종목은 MasterData '본체ETF' 줄로 매일 06시에, 배당주기는 'ETF 배당주기' 탭으로 매일 07시에 연결돼요. 멤버가 가진 ETF 중 빠진 게 있으면 주황색이에요. 같은 ETF가 두 줄로 나오면 시트마다 이름이 달라서 연결이 안 된 거예요. 새 ETF는 MasterData 맨 아래에 A열 '본체ETF', B열 티커만 적으면 돼요.</p></div></details>`;
}
