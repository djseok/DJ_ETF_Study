// gas/beta_autotune.gs 의 계산 함수 확인 (Google 접속 없이)
//   node tests/beta_autotune.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const src = fs.readFileSync('gas/beta_autotune.gs', 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.match(/^var BT_[\s\S]*?;$/mg).join('\n'), ctx);
['btParseLog_', 'btRecentDays_', 'btFitBeta_', 'btNextBeta_'].forEach(name => {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}'));
  assert(m, name + ' 없음');
  vm.runInContext(m[0], ctx);
});
const predictRet = (raw, b, f, us, fx, fs_) => (1 + b * raw) * (1 + b * f * us) * (1 + fx * fs_) - 1;

// 1) 참 β 0.7 로 만든 시가를 넣으면 0.7 근처로 역산 (기록 β 는 1.2)
let seed = 7;
const rnd = (a, b) => { seed = (seed * 1103515245 + 12345) % 2147483648; return a + (b - a) * seed / 2147483648; };
const sheet = [];
for (let d = 1; d <= 25; d++) {
  const date = '2026-10-' + String(d).padStart(2, '0');
  const raw = rnd(-0.03, 0.03), f = rnd(-0.005, 0.005), fx = rnd(-0.005, 0.005), us = 1, fs_ = 1;
  const pred = predictRet(raw, 1.2, f, us, fx, fs_);
  const open = predictRet(raw, 0.7, f, us, fx, fs_);
  sheet.push([date, 'A', '000001', '성장', '10000', (pred * 100).toFixed(2), '', 'HOLD', '', '100', 'NQ', (f * 100).toFixed(2),
    (fx * 100).toFixed(2), '100', '1.2', '-3 / 4', '10000', (open * 100).toFixed(2), '', '', '']);
}
sheet.push(['2026-10-26', 'A', '000001', '성장', '10000', '0.5', '', 'HOLD', '', '100', 'NQ', '0', '0', '100', '1.2', '-3 / 4', '', '', '', '', '']); // 실제값 전
const rows = ctx.btParseLog_(sheet);
assert.strictEqual(rows.length, 25);
const days = ctx.btRecentDays_(rows, 20);
assert.strictEqual(days.length, 20);
assert.strictEqual(days[0], '2026-10-06');
const fit = ctx.btFitBeta_(rows.filter(r => days.includes(r.date)));
assert(Math.abs(fit - 0.7) < 0.03, '역산 β ' + fit);

// 2) 한 주 최대 ±0.1, 범위 0.5~1.5, 줄 부족이면 그대로
assert.strictEqual(ctx.btNextBeta_(1.2, 0.7, 20).beta, 1.1);
assert.strictEqual(ctx.btNextBeta_(0.8, 0.85, 20).beta, 0.85);
assert.strictEqual(ctx.btNextBeta_(0.55, 0.1, 20).beta, 0.5);
assert.strictEqual(ctx.btNextBeta_(1.45, 3, 20).beta, 1.5);
assert.strictEqual(ctx.btNextBeta_(1.2, 0.7, 9).beta, 1.2);
assert.strictEqual(ctx.btNextBeta_(1.0, NaN, 20).beta, 1.0);

console.log('✅ beta_autotune: 역산 β ' + fit.toFixed(3) + ' · 보정 규칙 통과');
