// 대시보드(js/quant_core.js)와 카톡 알림(gas/premarket_alert.gs)의 예측 공식이 같은지 확인
//   node tests/parity.test.js   (GitHub Actions 'Tests' 가 PR·push 마다 실행)
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const web = {};
vm.createContext(web);
vm.runInContext(fs.readFileSync('js/quant_core.js', 'utf8'), web);

// GAS 파일에서 공식 함수 세 개만 꺼내 실행 (나머지는 Apps Script 전용이라 제외)
const gasSrc = fs.readFileSync('gas/premarket_alert.gs', 'utf8');
const gas = {};
vm.createContext(gas);
['predictRet_', 'futKeyFor_', 'signalFor_'].forEach(name => {
  const m = gasSrc.match(new RegExp('function ' + name + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}'));
  assert(m, name + ' 함수를 premarket_alert.gs 에서 찾지 못했어요');
  vm.runInContext(m[0], gas);
});

// 1) 본문이 글자 그대로 같은지 (이름의 _ 만 다름)
const body = (src, name) => src.match(new RegExp('function ' + name + '\\(([^)]*)\\) \\{([\\s\\S]*?)\\n\\}'))[0].replace(name, 'F');
const webSrc = fs.readFileSync('js/quant_core.js', 'utf8');
[['predictRet', 'predictRet_'], ['futKeyFor', 'futKeyFor_'], ['signalFor', 'signalFor_']].forEach(([w, g]) => {
  assert.strictEqual(body(gasSrc, g), body(webSrc, w), `${w} 본문이 대시보드와 카톡 알림에서 달라요`);
});

// 2) 무작위 입력 1,000개에서 같은 값
let seed = 42;
const rnd = (a, b) => { seed = (seed * 1103515245 + 12345) % 2147483648; return a + (b - a) * seed / 2147483648; };
for (let i = 0; i < 1000; i++) {
  const args = [rnd(-0.08, 0.08), rnd(0.5, 1.5), rnd(-0.03, 0.03), rnd(0, 1), rnd(-0.02, 0.02), rnd(0, 1)];
  assert.strictEqual(gas.predictRet_(...args), web.predictRet(...args));
  const pct = rnd(-4, 4), buy = -rnd(0.5, 3), sell = rnd(0.5, 3);
  assert.strictEqual(gas.signalFor_(pct, buy, sell), web.signalFor(pct, buy, sell));
}

// 3) 선물 선택 (실제 관리 ETF 이름)
const names = { 'RISE 미국S&P500': 'ES', 'KODEX 미국S&P500데일리커버드콜OTM': 'ES', 'TIGER 미국배당다우존스': 'YM',
  'ACE 미국배당다우존스': 'YM', 'RISE 미국나스닥100': 'NQ', 'KODEX 미국반도체': 'NQ', 'KIWOOM 미국S&P500모멘텀': 'ES' };
Object.entries(names).forEach(([n, k]) => {
  assert.strictEqual(web.futKeyFor(n), k, n);
  assert.strictEqual(gas.futKeyFor_(n), k, n);
});

// 4) 기준 사례: 구성종목 +3% · β1.2 · 나스닥 선물 +1% · 미국 100% · 환율 +0.5% · 해외 100%  → 1.036 × 1.012 × 1.005 − 1 = +5.37%
const ref = web.predictRet(0.03, 1.2, 0.01, 1, 0.005, 1) * 100;
assert.strictEqual(ref.toFixed(2), '5.37');

// 5) 대시보드가 공식을 따로 적지 않고 공통 함수만 쓰는지
const quantSrc = fs.readFileSync('js/quant.js', 'utf8');
assert(!/\(1 \+ rawDelta \* beta\)/.test(quantSrc), 'js/quant.js 에 공식이 따로 적혀 있어요 → predictRet() 를 쓰세요');
assert(/predictRet\(/.test(quantSrc), 'js/quant.js 가 predictRet() 를 쓰지 않아요');

console.log('✅ 예측 공식 일치: 대시보드 = 카톡 알림 (무작위 1,000건 · 선물 선택 · 신호 · 기준 사례)');
