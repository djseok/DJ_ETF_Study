// gas/deploy.json 과 tools/gas_deploy.js 확인 (Google 접속 없이)
//  · gas/*.gs 가 전부 정확히 한 프로젝트에 들어 있는지
//  · 프로젝트별로 합쳤을 때 같은 이름 선언이 두 번 없는지
//  · 편집기에만 있는 파일·appsscript.json 은 그대로 두고, 이름이 없는 파일은 올리지 않는지
const fs = require('fs'), path = require('path'), assert = require('assert');
const { planProject, lineDiff, topLevelNames, legacyUsage } = require('../tools/gas_deploy.js');

const config = JSON.parse(fs.readFileSync('gas/deploy.json', 'utf8'));
const repo = {};
fs.readdirSync('gas').filter(f => f.endsWith('.gs')).forEach(f => { repo[f] = fs.readFileSync(path.join('gas', f), 'utf8'); });

const owner = {};
Object.entries(config.projects).forEach(([key, p]) => {
  assert(/^[A-Z0-9_]+$/.test(p.secret), `${key}: secret 이름 형식`);
  Object.keys(p.files).forEach(f => {
    assert(repo[f] != null, `${key}: gas/${f} 없음`);
    assert(!owner[f], `gas/${f} 가 ${owner[f]} · ${key} 두 곳에 있음`);
    owner[f] = key;
  });
  // 편집기가 저장소와 같은 이름으로 되어 있다고 가정하고 합쳐 보기
  const remote = [{ name: 'appsscript', type: 'JSON', source: '{"timeZone":"Asia/Seoul"}' }].concat(
    Object.entries(p.files).map(([f, o]) => ({ name: (o && o.remote) || f.replace(/\.gs$/, ''), type: 'SERVER_JS', source: repo[f] })));
  const plan = planProject(p, remote, repo);
  assert.deepStrictEqual(plan.problems, [], `${key}: ${plan.problems.join(' / ')}`);
  assert.strictEqual(plan.changed, false);
});
Object.keys(repo).forEach(f => assert(owner[f], `gas/${f} 가 deploy.json 어느 프로젝트에도 없음`));

// 바꿔 끼우기 · 보존 · 순서
const cfg = { files: { 'a.gs': {}, 'b.gs': { remote: 'Code' } } };
const remote = [
  { name: 'appsscript', type: 'JSON', source: '{"webapp":{}}' },
  { name: 'Code', type: 'SERVER_JS', source: 'function b() { return 1; }' },
  { name: 'only_editor', type: 'SERVER_JS', source: 'function z() {}' },
  { name: 'a', type: 'SERVER_JS', source: 'function a() {}\n' },
];
let plan = planProject(cfg, remote, { 'a.gs': 'function a() {}', 'b.gs': 'function b() { return 2; }' });
assert.deepStrictEqual(plan.problems, []);
assert.deepStrictEqual(plan.files.map(f => f.name), ['appsscript', 'Code', 'only_editor', 'a']);
assert.strictEqual(plan.files[0].source, '{"webapp":{}}');
assert.strictEqual(plan.files[1].source, 'function b() { return 2; }');
assert.strictEqual(plan.files[2].source, 'function z() {}');
assert.deepStrictEqual(plan.rows.map(r => r.status), ['same', 'diff']);
assert.deepStrictEqual(plan.extra.map(f => f.name), ['only_editor']);

// 편집기에 이름이 없으면 멈춤, new: true 면 추가
plan = planProject({ files: { 'c.gs': {} } }, remote, { 'c.gs': 'function c() {}' });
assert.strictEqual(plan.problems.length, 1);
plan = planProject({ files: { 'c.gs': { new: true } } }, remote, { 'c.gs': 'function c() {}' });
assert.deepStrictEqual(plan.problems, []);
assert.strictEqual(plan.files[plan.files.length - 1].name, 'c');

// 같은 함수가 편집기 다른 파일에도 있으면 멈춤
plan = planProject({ files: { 'a.gs': {} } }, remote, { 'a.gs': 'function a() {}\nfunction z() {}' });
assert(plan.problems.some(p => p.includes("'z'")));
// 편집기에만 있는 파일끼리 겹치는 건 경고만 (지금 상태 그대로)
plan = planProject({ files: { 'a.gs': {} } }, remote.concat([{ name: 'old', type: 'SERVER_JS', source: 'function z() {}' }]), { 'a.gs': 'function a() {}' });
assert.deepStrictEqual(plan.problems, []);
assert(plan.warnings.some(w => w.includes("'z'")));
// 문법 오류면 멈춤
plan = planProject({ files: { 'a.gs': {} } }, remote, { 'a.gs': 'function a( {' });
assert(plan.problems.some(p => p.startsWith('문법 오류')));

assert.deepStrictEqual(lineDiff('a\nb\nc', 'a\nc\nd'), { add: 1, del: 1 });
assert.deepStrictEqual(topLevelNames('function f() {\n  const x = 1;\n}\nconst Y = 2;\nasync function g() {}'), ['f', 'Y', 'g']);

// retire: 저장소로 옮긴 옛 파일은 지우고 새 파일로 대신 (같은 함수가 있어도 옛 파일이 빠지니 문제 아님), 저장소가 맡은 파일은 못 지움
plan = planProject({ files: { 'n.gs': { new: true }, 'a.gs': {} }, retire: ['old1', 'gone'] },
  remote.concat([{ name: 'old1', type: 'SERVER_JS', source: 'function getX() {}' }]), { 'n.gs': 'function getX() { return 1; }', 'a.gs': 'function a() {}' });
assert.deepStrictEqual(plan.problems, []);
assert.deepStrictEqual(plan.retire, ['old1']);
assert(!plan.files.some(f => f.name === 'old1'));
assert(!plan.extra.some(f => f.name === 'old1'));
assert.strictEqual(plan.changed, true);
plan = planProject({ files: { 'a.gs': {} }, retire: ['a'] }, remote, { 'a.gs': 'function a() {}' });
assert(plan.problems.some(p => p.includes("'a'")));

// 편집기에만 있는 파일 점검: 다른 파일에서 부르는지(주석·메서드 호출 제외), 특수 함수·사용자 함수·트리거 등록
const lg = legacyUsage([{ name: 'old', type: 'SERVER_JS', source: 'function onOpen() {}\n/** @customfunction */\nfunction ETFX(a) { return a; }\nfunction helper() {}\nfunction inst() { ScriptApp.newTrigger("helper"); }' }],
  [{ name: 'old', type: 'SERVER_JS', source: 'function helper() {}' }, { name: 'new', type: 'SERVER_JS', source: 'function z() { helper(); }\n// ETFX(1)\nvar q = obj.ETFX(2);' }])[0];
assert.deepStrictEqual(lg.special, ['onOpen']);
assert.strictEqual(lg.custom, 1);
assert.deepStrictEqual(lg.triggers, ['helper']);
assert.deepStrictEqual(lg.usedBy, { helper: ['new'] });

console.log('✅ Apps Script 배포 설정', Object.keys(config.projects).length + '개 프로젝트 ·', Object.keys(owner).length + '개 파일');
