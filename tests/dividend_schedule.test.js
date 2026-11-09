// gas/dividend_schedule_sync.gs 의 운용사 접속 실패 처리 확인 (Google 접속 없이)
//   node tests/dividend_schedule.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const src = fs.readFileSync('gas/dividend_schedule_sync.gs', 'utf8');
const ctx = { calls: [] };
vm.createContext(ctx);
vm.runInContext(src, ctx);
// 운용사 조회를 가짜로 바꿈: RISE 는 접속 실패, KODEX 는 정상
vm.runInContext(`
  riseHistory_ = function (name) { calls.push('RISE ' + name); throw new Error('Address unavailable: kbam.co.kr'); };
  kodexHistory_ = function (name) { calls.push('KODEX ' + name); return [{ rec: '2026-10-30', pay: '2026-11-03', amt: 117, tax: 117 }]; };
  kiwoomHistory_ = function (name) { calls.push('KIWOOM ' + name); throw new Error('MasterData에서 종목코드를 못 찾음'); };
`, ctx);
const noDb = { getSheetByName: () => null, getSheets: () => [] };
const run = (name, c) => { try { return ctx.getHistory_(name, c); } catch (e) { return { error: String(e) }; } };

// 1) RISE 첫 종목만 실제로 조회하고, 다음 RISE 종목은 기다리지 않고 바로 건너뜀. KODEX 는 계속 조회
let c = { cache: {}, down: {}, deadline: Date.now() + 60000, master: noDb };
assert(run('RISE 미국S&P500', c).error.includes('Address unavailable'));
assert(run('RISE 미국나스닥100', c).error.includes('건너뜀'));
assert.strictEqual(run('KODEX 미국S&P500', c).rows[0].amt, 117);
assert.deepStrictEqual(ctx.calls, ['RISE RISE 미국S&P500', 'KODEX KODEX 미국S&P500']);

// 2) 이름을 못 찾은 경우는 접속 실패로 보지 않음 → 같은 운용사 다른 종목은 계속 조회
ctx.calls.length = 0;
run('KIWOOM A', c); run('KIWOOM B', c);
assert.deepStrictEqual(ctx.calls, ['KIWOOM KIWOOM A', 'KIWOOM KIWOOM B']);
assert(!c.down.KIWOOM);

// 3) 시간 한도가 지나면 운용사 조회는 하지 않음, 마스터시트 DB_ 탭은 계속 읽음
ctx.calls.length = 0;
c = { cache: {}, down: {}, deadline: Date.now() - 1, master: noDb };
assert(run('KODEX 미국반도체', c).error.includes('시간 한도'));
assert.deepStrictEqual(ctx.calls, []);
const db = { getLastRow: () => 2, getRange: () => ({ getDisplayValues: () => [['2026-10-30', '2026-11-03', '', '146', '0']] }) };
c.master = { getSheetByName: n => (n === 'DB_KODEX 미국나스닥100데일리커버드콜OTM' ? db : null), getSheets: () => [] };
assert.strictEqual(run('KODEX 미국나스닥100데일리커버드콜OTM', c).source, '마스터시트');

// 4) 진단용 debugTaxFields 처럼 down/deadline 없는 ctx 도 그대로 동작
ctx.calls.length = 0;
assert.strictEqual(run('KODEX 미국S&P500', { cache: {}, master: noDb }).rows.length, 1);

console.log('✅ dividend_schedule 테스트 통과');
