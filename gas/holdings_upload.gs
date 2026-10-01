/**
 * 📸 잔고 캡처 → 보유종목 자동 입력 — **새 Apps Script 프로젝트**(독립형)에 넣으세요 (관리시트 프로젝트와 분리)
 *
 * 멤버가 대시보드 '잔고 캡처 입력' 페이지(upload.html)에서 증권사 앱 잔고 화면을 올리면
 *   ① Gemini 가 종목명 · 보유수량 · 평균단가를 읽고
 *   ② 관리시트 MasterData 의 정식 이름으로 맞춘 뒤 지금 보유 내역과 비교한 '바뀔 내용'을 보여주고
 *   ③ 멤버가 확인을 누르면 개인일기장 '{이름}포토폴리오' 탭 B·D·E 열(종목·평단·수량)을 고칩니다.
 *   · 이미지는 저장하지 않습니다 (인식 후 버림). 반영 기록만 관리시트 '잔고_업로드_기록' 탭에 남깁니다.
 *   · '마스터 포토폴리오' 탭은 건드리지 않습니다 (QUERY 가 멤버 탭을 자동으로 모음).
 *
 * ▶ 설치 (처음 한 번, README 의 '잔고 캡처 입력' 참고)
 *   1) script.google.com → 새 프로젝트 → 이 파일 내용 붙여넣기
 *   2) 프로젝트 설정 → 스크립트 속성
 *        GEMINI_API_KEY : Google AI Studio 에서 새로 발급한 키 (채팅에 붙여넣지 말 것)
 *        MEMBER_PINS    : {"D":"1234","S":"5678","J":"2468"}  ← 멤버별 4자리 이상 비밀번호
 *        (선택) GEMINI_MODEL : 기본 gemini-flash-latest
 *   3) testSetup 실행 → 권한 허용, 시트 연결·키 확인
 *   4) 배포 → 새 배포 → 유형 '웹 앱' · 실행: 나 · 액세스: 모든 사용자 → 웹 앱 URL 복사해서 Claude 에게 전달
 */

var HU_DIARY_ID = '1nVnpen14YDDWRxODwt36HVlG7GId-zKzFIyQYn9p7vY';   // 동진ETF공부_개인일기장
var HU_MANAGE_ID = '1r91WUqYvIfQ1jrehEKiBPUbO7a0iH7iIl3tgNsZoKRc';  // 관리시트
var HU_LOG_TAB = '잔고_업로드_기록';

function doGet() { return huJson_({ ok: true, service: 'holdings-upload' }); }

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var member = String(req.member || '').trim();
    huCheckPin_(member, String(req.pin || ''));
    if (req.action === 'parse') return huJson_(huParse_(member, req.images || []));
    if (req.action === 'apply') return huJson_(huApply_(member, req.token, req.pick || null, !!req.removeMissing));
    if (req.action === 'current') return huJson_({ ok: true, holdings: huCurrent_(member).rows });
    throw new Error('알 수 없는 요청');
  } catch (err) {
    return huJson_({ ok: false, error: String(err.message || err) });
  }
}

function huJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// 비밀번호 확인 (5번 틀리면 10분 잠금)
function huCheckPin_(member, pin) {
  var pins = JSON.parse(PropertiesService.getScriptProperties().getProperty('MEMBER_PINS') || '{}');
  if (!member || !pins[member]) throw new Error('등록되지 않은 멤버예요');
  var cache = CacheService.getScriptCache(), key = 'HU_FAIL_' + member;
  var fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('비밀번호를 여러 번 틀려 10분 동안 잠겼어요');
  if (String(pins[member]) !== pin) { cache.put(key, String(fails + 1), 600); throw new Error('비밀번호가 맞지 않아요'); }
  cache.remove(key);
}

// ---------------------------------------------------------
// ① 인식 + 비교
// ---------------------------------------------------------
function huParse_(member, images) {
  if (!images.length) throw new Error('이미지를 올려 주세요');
  if (images.length > 4) throw new Error('한 번에 4장까지 올릴 수 있어요');
  var known = huKnownEtfs_();
  var read = huGemini_(images, Object.keys(known).map(function (k) { return known[k].name; }));
  var cur = huCurrent_(member);

  // 같은 종목이 여러 장에 나오면 마지막 값
  var parsed = {};
  read.forEach(function (x) {
    var qty = huNum_(x.quantity), avg = huNum_(x.avg_price);
    if (!x.name || !(qty >= 0)) return;
    var m = huMatch_(x.name, known);
    parsed[m ? m.key : 'X_' + x.name] = { raw: x.name, name: m ? m.name : x.name, code: m ? m.code : '', matched: !!m, qty: qty, avg: avg };
  });

  var rows = [], seen = {};
  Object.keys(parsed).forEach(function (k) {
    var p = parsed[k], c = p.matched ? cur.byKey[k] : null;
    seen[k] = true;
    var status = !p.matched ? 'unknown' : (!c ? 'new' : ((c.qty !== p.qty || Math.round(c.avg) !== Math.round(p.avg)) ? 'change' : 'same'));
    rows.push({ key: k, raw: p.raw, name: p.name, code: p.code, status: status,
      oldQty: c ? c.qty : null, newQty: p.qty, oldAvg: c ? Math.round(c.avg) : null, newAvg: Math.round(p.avg) });
  });
  var missing = cur.rows.filter(function (c) { return c.qty > 0 && !seen[c.key]; })
    .map(function (c) { return { key: c.key, name: c.name, qty: c.qty }; });

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('HU_' + token, JSON.stringify({ member: member, rows: rows, missing: missing }), 900);
  return { ok: true, token: token, rows: rows, missing: missing };
}

// Gemini 로 잔고 화면 읽기 → [{name, quantity, avg_price}]
function huGemini_(images, knownNames) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY 가 설정되지 않았어요');
  var model = props.getProperty('GEMINI_MODEL') || 'gemini-flash-latest';
  var parts = [{ text:
    '한국 증권사 앱의 주식/ETF 잔고 화면 캡처입니다. 화면에 보이는 보유 종목마다 종목명, 보유수량(주), 평균단가(매입단가, 원)를 읽어 주세요.\n' +
    '- 평가금액·손익·수익률·현재가는 무시\n- 숫자는 쉼표 없이 숫자로\n- 평균단가가 안 보이면 0\n- 잘려서 일부만 보이는 줄은 빼기\n' +
    '- 종목명은 화면 그대로 쓰되, 아래 목록에 같은 종목이 있으면 목록의 이름으로:\n' + knownNames.join(', ') }];
  images.forEach(function (b64) {
    var m = String(b64).match(/^data:(image\/[a-z]+);base64,(.*)$/);
    parts.push({ inline_data: { mime_type: m ? m[1] : 'image/jpeg', data: m ? m[2] : b64 } });
  });
  var body = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      temperature: 0, responseMimeType: 'application/json',
      responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        name: { type: 'STRING' }, quantity: { type: 'NUMBER' }, avg_price: { type: 'NUMBER' } }, required: ['name', 'quantity'] } }
    }
  };
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body)
  });
  if (res.getResponseCode() !== 200) throw new Error('이미지 인식 실패 (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var j = JSON.parse(res.getContentText());
  var text = (((j.candidates || [])[0] || {}).content || {}).parts;
  text = text && text[0] && text[0].text;
  if (!text) throw new Error('이미지에서 종목을 찾지 못했어요');
  var arr = JSON.parse(text);
  return Array.isArray(arr) ? arr : [];
}

// ---------------------------------------------------------
// ② 반영
// ---------------------------------------------------------
function huApply_(member, token, pick, removeMissing) {
  var cache = CacheService.getScriptCache();
  var saved = JSON.parse(cache.get('HU_' + token) || 'null');
  if (!saved || saved.member !== member) throw new Error('확인 시간이 지났어요. 다시 올려 주세요 (15분)');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 반영이 진행 중이에요. 잠시 뒤 다시 시도해 주세요');
  try {
    var cur = huCurrent_(member), sh = cur.sheet, log = [];
    var chosen = saved.rows.filter(function (r) { return (r.status === 'change' || r.status === 'new') && (!pick || pick.indexOf(r.key) >= 0); });
    chosen.forEach(function (r) {
      var c = cur.byKey[r.key];
      if (c) {
        sh.getRange(c.row, 4, 1, 2).setValues([[r.newAvg || c.avg, r.newQty]]);
        log.push(r.name + ' ' + c.qty + '→' + r.newQty + '주');
      } else {
        var row = cur.lastRow + 1; cur.lastRow = row;
        var code = String(r.code || '').replace(/^KRX:/i, '');
        sh.getRange(row, 1, 1, 6).setValues([[member, r.name, 0, r.newAvg, r.newQty, code ? '=IFERROR(GOOGLEFINANCE("KRX:' + code + '","price"))' : '']]);
        log.push('+ ' + r.name + ' ' + r.newQty + '주');
      }
    });
    if (removeMissing) {
      saved.missing.forEach(function (m) {
        var c = cur.byKey[m.key];
        if (c && (!pick || pick.indexOf(m.key) >= 0)) { sh.getRange(c.row, 5).setValue(0); log.push(m.name + ' ' + c.qty + '→0주'); }
      });
    }
    cache.remove('HU_' + token);
    huLog_(member, log);
    return { ok: true, changed: log.length, log: log };
  } finally { lock.releaseLock(); }
}

function huLog_(member, log) {
  var ss = SpreadsheetApp.openById(HU_MANAGE_ID);
  var sh = ss.getSheetByName(HU_LOG_TAB);
  if (!sh) { sh = ss.insertSheet(HU_LOG_TAB); sh.getRange(1, 1, 1, 4).setValues([['시각', '멤버', '건수', '바뀐 내용']]); sh.setFrozenRows(1); }
  sh.appendRow([Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), member, log.length, log.join(' · ') || '변경 없음']);
}

// ---------------------------------------------------------
// 도우미
// ---------------------------------------------------------
// 멤버 탭 A~F (A 이름 · B 종목 · C 목표비중 · D 평단 · E 수량 · F 현재가)
function huCurrent_(member) {
  var sh = SpreadsheetApp.openById(HU_DIARY_ID).getSheetByName(member + '포토폴리오');
  if (!sh) throw new Error(member + '포토폴리오 탭이 없어요');
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 6).getValues();
  var rows = [], byKey = {}, lastRow = 1;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim()) lastRow = i + 1;
    if (String(v[i][0]).trim() !== member || !String(v[i][1]).trim()) continue;
    var r = { row: i + 1, name: String(v[i][1]).trim(), key: huNorm_(v[i][1]), avg: huNum_(v[i][3]), qty: huNum_(v[i][4]) };
    rows.push(r); byKey[r.key] = r;
  }
  return { sheet: sh, rows: rows, byKey: byKey, lastRow: lastRow };
}

// 정식 이름 목록 → { 정규화이름: {name, code} }
//   이름은 'ETF 배당주기' 표기를 우선 (배당 예측·세금 계산이 이 이름으로 연결), 코드는 MasterData '본체ETF'
function huKnownEtfs_() {
  var ss = SpreadsheetApp.openById(HU_MANAGE_ID), out = {};
  var ds = ss.getSheetByName('ETF 배당주기');
  if (ds && ds.getLastRow() > 1) ds.getRange(2, 1, ds.getLastRow() - 1, 1).getValues().forEach(function (r) {
    if (r[0]) out[huNorm_(r[0])] = { name: String(r[0]).trim(), code: '' };
  });
  var md = ss.getSheetByName('MasterData');
  md.getRange(3, 1, md.getLastRow() - 2, 3).getValues().forEach(function (r) {
    if (String(r[0]).trim() !== '본체ETF' || !r[2]) return;
    var k = huNorm_(r[2]);
    if (out[k]) out[k].code = String(r[1]).trim();
    else out[k] = { name: String(r[2]).trim(), code: String(r[1]).trim() };
  });
  return out;
}

// 화면 이름 → 정식 이름 (같으면 그대로, 아니면 글자 2개 묶음 유사도 0.6 이상 중 가장 높은 것)
function huMatch_(raw, known) {
  var k = huNorm_(raw);
  if (known[k]) return { key: k, name: known[k].name, code: known[k].code };
  var best = null, bestS = 0;
  Object.keys(known).forEach(function (kk) {
    var s = huDice_(k, kk);
    if (s > bestS) { bestS = s; best = kk; }
  });
  return bestS >= 0.6 ? { key: best, name: known[best].name, code: known[best].code } : null;
}
function huDice_(a, b) {
  var bg = function (s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var g = s.substr(i, 2); o[g] = (o[g] || 0) + 1; } return o; };
  var A = bg(a), B = bg(b), inter = 0, na = 0, nb = 0;
  Object.keys(A).forEach(function (g) { na += A[g]; if (B[g]) inter += Math.min(A[g], B[g]); });
  Object.keys(B).forEach(function (g) { nb += B[g]; });
  return na + nb ? 2 * inter / (na + nb) : 0;
}
function huNorm_(s) { return String(s || '').replace(/\s+/g, '').toUpperCase().replace(/커브드/g, '커버드').replace(/[()（）]/g, ''); }
function huNum_(v) { var n = Number(String(v === null || v === undefined ? '' : v).replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; }

// 설치 확인용: 시트 연결·키·비밀번호 설정 점검 (이미지 인식은 안 함)
function testSetup() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('GEMINI_API_KEY ' + (p.getProperty('GEMINI_API_KEY') ? '✅ 있음' : '❌ 없음'));
  var pins = JSON.parse(p.getProperty('MEMBER_PINS') || '{}');
  Logger.log('MEMBER_PINS 멤버: ' + (Object.keys(pins).join(', ') || '❌ 없음'));
  Object.keys(pins).forEach(function (m) {
    try { var c = huCurrent_(m); Logger.log('✅ ' + m + '포토폴리오: ' + c.rows.length + '종목'); }
    catch (e) { Logger.log('❌ ' + m + ': ' + e.message); }
  });
  Logger.log('관리시트 정식 이름 ' + Object.keys(huKnownEtfs_()).length + '개');
  Logger.log('모델: ' + (p.getProperty('GEMINI_MODEL') || 'gemini-flash-latest'));
}
