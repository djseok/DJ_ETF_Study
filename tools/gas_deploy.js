#!/usr/bin/env node
// 📤 gas/*.gs → Apps Script 프로젝트 자동 반영 (Apps Script API 직접 호출, clasp 로그인 토큰 사용)
//
//   node tools/gas_deploy.js check    : 편집기 코드와 저장소 코드 비교만 (아무것도 바꾸지 않음)
//   node tools/gas_deploy.js deploy   : enabled 인 프로젝트 중 달라진 곳만 올림 (+ 웹 앱은 새 버전으로)
//   node tools/gas_deploy.js legacy   : 편집기에만 있는 파일이 어디서 쓰이는지 점검 (함수 이름만 로그) + 내용은 내 Google Drive 에 백업 파일로
//   node tools/gas_deploy.js remove   : REMOVE_FILES(쉼표)에 적은 '편집기에만 있는 파일'을 지움. 지우기 전 프로젝트 버전(스냅숏)을 먼저 만들어 편집기 '프로젝트 기록'에서 되살릴 수 있음
//
// 안전장치
//   · 편집기에만 있는 파일, appsscript.json(권한·시간대·웹앱 설정)은 그대로 둔 채 저장소 파일만 바꿔 끼움
//   · 파일 순서도 편집기 순서 그대로
//   · 저장소 파일이 편집기에 없으면(이름이 다르면) 올리지 않고 멈춤 → 같은 함수가 두 벌 생기는 것 방지
//   · 합친 결과에 같은 이름의 함수·변수가 두 번 있거나 문법 오류가 있으면 멈춤
//   · 저장소가 public 이라 로그에는 파일 이름·줄 수만 남기고 코드 내용은 남기지 않음
//
// 필요한 GitHub Secrets: CLASPRC_JSON (clasp login 후 ~/.clasprc.json 전체), gas/deploy.json 의 secret 이름들(스크립트 ID)

const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GAS_DIR = path.join(ROOT, 'gas');
const API = 'https://script.googleapis.com/v1';

// ── 순수 함수 (tests/gas_deploy.test.js 에서 검사) ──────────────────────────────

function normalize(src) {
  return String(src || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
}

// 줄 단위 비교: a → b 로 바꿀 때 추가·삭제 줄 수
function lineDiff(a, b) {
  const x = normalize(a).split('\n'), y = normalize(b).split('\n');
  let prev = new Uint32Array(y.length + 1), cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[y.length];
  return { add: y.length - lcs, del: x.length - lcs };
}

// 비어 있지 않은 줄 기준 비슷한 정도 (0~1)
function similarity(a, b) {
  const s = t => new Set(normalize(t).split('\n').map(l => l.trim()).filter(Boolean));
  const A = s(a), B = s(b);
  if (!A.size || !B.size) return 0;
  let same = 0;
  A.forEach(l => { if (B.has(l)) same++; });
  return same / Math.max(A.size, B.size);
}

// 맨 앞 칸에서 시작하는 최상위 선언 이름들
function topLevelNames(src) {
  const names = [];
  const re = /^(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(normalize(src)))) names.push(m[1]);
  return names;
}

// 편집기에만 있는 파일(extra)의 함수가 어디서 쓰이는지: 다른 파일에서 이름으로 부르는지, 트리거 등록 문자열에 있는지, 특수 함수인지
const SPECIAL_FNS = ['onOpen', 'onEdit', 'onChange', 'onInstall', 'onSelectionChange', 'onFormSubmit', 'doGet', 'doPost'];
function stripComments(src) {
  return normalize(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}
function legacyUsage(extra, allFiles) {
  return extra.filter(f => f.type === 'SERVER_JS').map(f => {
    const fns = topLevelNames(f.source);
    const others = allFiles.filter(o => o.name !== f.name && o.type === 'SERVER_JS').map(o => ({ name: o.name, src: stripComments(o.source) }));
    const usedBy = {};
    fns.forEach(n => {
      const re = new RegExp('(^|[^\\w$.])' + n.replace(/\$/g, '\\$') + '\\s*\\(|[\'"]' + n.replace(/\$/g, '\\$') + '[\'"]');
      const hits = others.filter(o => re.test(o.src)).map(o => o.name);
      if (hits.length) usedBy[n] = hits;
    });
    return {
      name: f.name,
      lines: normalize(f.source).split('\n').length,
      fns,
      special: fns.filter(n => SPECIAL_FNS.includes(n)),
      custom: (f.source.match(/@customfunction/g) || []).length,
      triggers: (f.source.match(/newTrigger\(\s*['"]([\w$]+)['"]/g) || []).map(t => t.replace(/.*['"]([\w$]+)['"]/, '$1')),
      usedBy,
    };
  });
}

// remoteFiles: [{name,type,source}] (편집기), repo: { 'x.gs': source }, cfg: deploy.json 의 프로젝트 하나
function planProject(cfg, remoteFiles, repo) {
  const files = remoteFiles.map(f => ({ name: f.name, type: f.type, source: f.source }));
  const rows = [], problems = [];
  const mapped = new Set();
  Object.keys(cfg.files).forEach(file => {
    const opt = cfg.files[file] || {};
    const remoteName = opt.remote || file.replace(/\.gs$/, '');
    const src = repo[file];
    if (src == null) { problems.push(`저장소에 gas/${file} 이 없음`); return; }
    const hit = files.find(f => f.name === remoteName && f.type === 'SERVER_JS');
    if (!hit) {
      if (opt.new) { mapped.add(remoteName); files.push({ name: remoteName, type: 'SERVER_JS', source: src }); rows.push({ file, remote: remoteName, status: 'new' }); }
      else problems.push(`편집기에 '${remoteName}' 파일이 없음 (gas/${file}) — 편집기 파일 이름이 다르면 deploy.json 에 remote 로 적기, 새 파일이면 new: true`);
      return;
    }
    mapped.add(hit.name);
    if (normalize(hit.source) === normalize(src)) rows.push({ file, remote: remoteName, status: 'same' });
    else { rows.push({ file, remote: remoteName, status: 'diff', diff: lineDiff(hit.source, src), oldSource: hit.source }); hit.source = src; }
  });
  const extra = remoteFiles.filter(f => f.type !== 'JSON' && !mapped.has(f.name)).map(f => ({ name: f.name, type: f.type, source: f.source }));

  // 저장소가 맡은 파일이 끼는 중복·문법 오류만 막음. 편집기에만 있는 파일끼리의 중복은 지금도 그대로라 경고만
  const warnings = [];
  const seen = {};
  files.filter(f => f.type === 'SERVER_JS').forEach(f => {
    topLevelNames(f.source).forEach(n => (seen[n] = seen[n] || []).push(f.name));
    if (!mapped.has(f.name)) return;
    try { new vm.Script(f.source, { filename: f.name }); } catch (e) { problems.push(`문법 오류: ${f.name} — ${e.message}`); }
  });
  Object.keys(seen).forEach(n => {
    if (seen[n].length < 2) return;
    const msg = `같은 이름 '${n}' 이 여러 번 선언됨: ${seen[n].join(', ')}`;
    if (seen[n].some(name => mapped.has(name))) problems.push(msg); else warnings.push(msg + ' (편집기에만 있는 파일끼리, 지금과 같음)');
  });

  const changed = rows.some(r => r.status !== 'same');
  return { files, rows, extra, problems, warnings, changed };
}

// ── Google API ─────────────────────────────────────────────────────────────

async function accessToken(clasprc) {
  let c;
  try { c = JSON.parse(clasprc); } catch (e) { throw new Error('CLASPRC_JSON 이 JSON 형식이 아님 (~/.clasprc.json 내용을 그대로 넣어야 해요)'); }
  const t = (c.tokens && (c.tokens.default || Object.values(c.tokens)[0])) || {};
  const body = new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' });
  if (!t.client_id || !t.refresh_token) throw new Error('CLASPRC_JSON 에 tokens.default (client_id · refresh_token) 이 없음 — clasp 3 로 다시 clasp login');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!r.ok) throw new Error(`토큰 갱신 실패 (${j.error || r.status}) — PC 에서 clasp login 다시 하고 CLASPRC_JSON 교체`);
  return j.access_token;
}

async function call(token, method, url, body) {
  const r = await fetch(API + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error.message; } catch (e) { }
    if (/has not been used|is disabled|User has not enabled the Apps Script API/i.test(msg)) msg += ' → script.google.com/home/usersettings 에서 Apps Script API 를 켜 주세요';
    throw new Error(`${method} ${url.replace(/projects\/[^/]+/, 'projects/…')} → ${r.status} ${msg}`);
  }
  return text ? JSON.parse(text) : {};
}

// ── 저장소 기록과 비교 (편집기 코드가 저장소 예전 버전과 같은지) ─────────────────

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return ''; }
}

function findInHistory(file, source) {
  const want = normalize(source);
  const log = git(['log', '--full-history', '--format=%h %cs', '--', 'gas/' + file]).trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [h, d] = line.split(' ');
    if (normalize(git(['show', `${h}:gas/${file}`])) === want) return { commit: h, date: d, newest: line === log[0] };
  }
  return null;
}

// ── 편집기에만 있는 파일 점검·정리 ─────────────────────────────────────────────

async function legacyReport(token, scriptId, cfg, remoteFiles, plan) {
  const extra = plan.extra.filter(f => f.type === 'SERVER_JS');
  if (!extra.length) { say('- 편집기에만 있는 스크립트 없음'); return; }
  const usage = legacyUsage(extra, remoteFiles);
  // 최근 실행 기록 (트리거·메뉴·직접 실행). 토큰에 권한이 없으면 건너뜀
  let runs = null;
  try {
    const d = await call(token, 'GET', `/processes:listScriptProcesses?scriptId=${scriptId}&pageSize=200`);
    runs = {};
    (d.processes || []).forEach(p => { const k = p.functionName; (runs[k] = runs[k] || []).push(`${p.processType || '?'} ${String(p.startTime || '').slice(0, 10)}`); });
  } catch (e) { say(`- ℹ️ 실행 기록은 못 읽음 (${e.message.slice(0, 80)})`); }
  usage.forEach(u => {
    say(`- 📌 ${u.name} (${u.lines}줄) 함수 ${u.fns.length}개: ${u.fns.join(', ') || '없음'}`);
    if (u.special.length) say(`  - ⚠️ 시트가 자동으로 부르는 함수: ${u.special.join(', ')}`);
    if (u.custom) say(`  - ⚠️ 시트 수식에서 쓰는 사용자 함수 표시(@customfunction) ${u.custom}개`);
    if (u.triggers.length) say(`  - 트리거 등록 코드: ${u.triggers.join(', ')}`);
    Object.keys(u.usedBy).forEach(n => say(`  - ${n} ← ${u.usedBy[n].join(', ')} 에서 부름`));
    if (runs) {
      const hit = u.fns.filter(n => runs[n]);
      say(hit.length ? `  - 최근 실행: ${hit.map(n => `${n} ${runs[n].length}회 (마지막 ${runs[n][0]})`).join(' · ')}` : '  - 최근 실행 기록 없음');
    }
  });
  // 내용은 공개 로그 대신 내 Google Drive 에만 백업 (drive.file 권한: 이 도구가 만든 파일만 접근)
  try {
    const name = `${cfg.label}_편집기전용파일_백업_${new Date().toISOString().slice(0, 10)}.txt`;
    const text = extra.map(f => `===== ${f.name} =====\n${f.source}`).join('\n\n');
    const boundary = 'gasbackup' + Date.now();
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'text/plain' })}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    if (!r.ok) throw new Error(String(r.status));
    say(`- 💾 내용 백업: 내 Google Drive '${name}'`);
  } catch (e) { say(`- ℹ️ Drive 백업 못 함 (${e.message}) — 지울 때 만드는 프로젝트 버전이 백업 역할`); }
}

async function removeLegacy(token, scriptId, remoteFiles, plan, names, sha) {
  const extraNames = plan.extra.filter(f => f.type === 'SERVER_JS').map(f => f.name);
  const targets = names.filter(n => extraNames.includes(n));
  names.filter(n => !extraNames.includes(n) && remoteFiles.some(f => f.name === n)).forEach(n => say(`- ⛔ ${n} 은 저장소가 맡은 파일이라 지우지 않음`));
  if (!targets.length) { say('- 이 프로젝트에는 지울 파일 없음'); return 0; }
  if (plan.problems.length) { say('🛑 점검 문제가 있어 지우지 않음'); return 1; }
  const keep = remoteFiles.filter(f => !targets.includes(f.name));
  const problems = [];
  keep.filter(f => f.type === 'SERVER_JS').forEach(f => { try { new vm.Script(f.source, { filename: f.name }); } catch (e) { problems.push(`${f.name}: ${e.message}`); } });
  if (problems.length) { say(`🛑 남는 파일에 문법 오류: ${problems.join(' / ')}`); return 1; }
  const v = await call(token, 'POST', `/projects/${scriptId}/versions`, { description: `옛 파일 정리 전 백업 (${targets.join(', ')}) GitHub ${sha}` });
  say(`- 💾 지우기 전 버전 ${v.versionNumber} 만듦 → 편집기 '프로젝트 기록'에서 되살릴 수 있음`);
  await call(token, 'PUT', `/projects/${scriptId}/content`, { files: keep.map(f => ({ name: f.name, type: f.type, source: f.source })) });
  say(`- 🗑️ 지움: ${targets.join(', ')}`);
  return 0;
}

// ── 실행 ───────────────────────────────────────────────────────────────────

const out = [];
const say = s => { console.log(s); out.push(s); };

async function main() {
  const mode = process.argv[2];
  if (!['check', 'deploy', 'legacy', 'remove'].includes(mode)) { console.error('사용법: node tools/gas_deploy.js check|deploy|legacy|remove'); process.exit(2); }
  const removeNames = String(process.env.REMOVE_FILES || '').split(',').map(x => x.trim()).filter(Boolean);
  if (mode === 'remove' && !removeNames.length) { console.error('REMOVE_FILES 에 지울 편집기 파일 이름을 쉼표로 적어 주세요'); process.exit(2); }
  const config = JSON.parse(fs.readFileSync(path.join(GAS_DIR, 'deploy.json'), 'utf8'));
  const repo = {};
  fs.readdirSync(GAS_DIR).filter(f => f.endsWith('.gs')).forEach(f => { repo[f] = fs.readFileSync(path.join(GAS_DIR, f), 'utf8'); });

  if (!process.env.CLASPRC_JSON) {
    say('⏭️ CLASPRC_JSON 시크릿이 아직 없어서 건너뜀 (설정 방법: gas/README.md 의 Apps Script 자동 배포)');
    return 0;
  }
  const token = await accessToken(process.env.CLASPRC_JSON);
  const sha = (process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']).trim()).slice(0, 7);
  let failed = 0;

  for (const key of Object.keys(config.projects)) {
    const cfg = config.projects[key];
    say(`\n## ${cfg.label} (${key})`);
    const scriptId = process.env[cfg.secret];
    if (!scriptId) { say(`⏭️ ${cfg.secret} 시크릿이 없어서 건너뜀`); continue; }
    try {
      const content = await call(token, 'GET', `/projects/${scriptId}/content`);
      const plan = planProject(cfg, content.files || [], repo);

      plan.rows.forEach(r => {
        if (r.status === 'same') say(`- ✅ ${r.remote} = gas/${r.file}`);
        else if (r.status === 'new') say(`- 🆕 ${r.remote} ← gas/${r.file} (편집기에 새 파일로 추가)`);
        else {
          const h = findInHistory(r.file, r.oldSource);
          const where = h ? (h.newest ? '저장소 최신과 같음(공백만 다름)' : `저장소 예전 버전(${h.date} ${h.commit})과 같음 → 덮어써도 안전`) : '⚠️ 저장소 어느 버전과도 다름 — 편집기에서 직접 고친 부분이 있을 수 있음';
          say(`- ✏️ ${r.remote} ≠ gas/${r.file} (저장소 기준 +${r.diff.add} −${r.diff.del}줄) · 편집기 코드: ${where}`);
        }
      });
      plan.extra.forEach(f => {
        let best = null;
        Object.keys(repo).forEach(file => { const s = similarity(f.source, repo[file]); if (!best || s > best.s) best = { file, s }; });
        const hint = best && best.s >= 0.3 ? ` · gas/${best.file} 와 ${Math.round(best.s * 100)}% 비슷` : '';
        say(`- 📌 ${f.name} (${f.type === 'HTML' ? 'HTML' : '스크립트'}, ${normalize(f.source).split('\n').length}줄) 편집기에만 있음 → 그대로 둠${hint}`);
      });
      plan.warnings.forEach(w => say(`- ⚠️ ${w}`));
      plan.problems.forEach(p => say(`- ❌ ${p}`));

      if (mode === 'legacy') { await legacyReport(token, scriptId, cfg, content.files || [], plan); continue; }
      if (mode === 'remove') { failed += await removeLegacy(token, scriptId, content.files || [], plan, removeNames, sha); continue; }
      if (mode === 'check') continue;
      if (!cfg.enabled) { say('⏸️ enabled: false — 점검만 함'); continue; }
      if (plan.problems.length) { failed++; say('🛑 위 문제 때문에 올리지 않음'); continue; }
      if (!plan.changed) { say('➖ 바뀐 것 없음'); continue; }

      await call(token, 'PUT', `/projects/${scriptId}/content`, { files: plan.files });
      say(`📤 편집기에 반영 완료 (${plan.rows.filter(r => r.status !== 'same').length}개 파일)`);

      if (cfg.webapp) {
        const v = await call(token, 'POST', `/projects/${scriptId}/versions`, { description: `GitHub ${sha}` });
        let deps = [], pageToken = '';
        do {
          const d = await call(token, 'GET', `/projects/${scriptId}/deployments` + (pageToken ? `?pageToken=${pageToken}` : ''));
          deps = deps.concat(d.deployments || []);
          pageToken = d.nextPageToken || '';
        } while (pageToken);
        const web = deps.filter(d => d.deploymentConfig && d.deploymentConfig.versionNumber && (d.entryPoints || []).some(e => e.entryPointType === 'WEB_APP'));
        if (!web.length) { failed++; say(`⚠️ 버전 ${v.versionNumber} 은 만들었지만 웹 앱 배포를 못 찾음 — 배포 관리에서 직접 새 버전으로`); continue; }
        for (const d of web) {
          await call(token, 'PUT', `/projects/${scriptId}/deployments/${d.deploymentId}`, {
            deploymentConfig: { scriptId, versionNumber: v.versionNumber, manifestFileName: d.deploymentConfig.manifestFileName || 'appsscript', description: d.deploymentConfig.description || `GitHub ${sha}` },
          });
          say(`🌐 웹 앱 배포(…${d.deploymentId.slice(-6)}) 버전 ${d.deploymentConfig.versionNumber} → ${v.versionNumber} (주소 그대로)`);
        }
      }
    } catch (e) {
      failed++;
      say(`❌ ${e.message}`);
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  main().then(code => {
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
    process.exit(code);
  }, e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { normalize, lineDiff, similarity, topLevelNames, planProject, legacyUsage, main };
