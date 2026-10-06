/**
 * 📸 잔고 캡처 → 보유종목 자동 입력 — **새 Apps Script 프로젝트**(독립형)에 넣으세요 (관리시트 프로젝트와 분리)
 *
 * 멤버가 대시보드 '잔고 캡처 입력' 페이지(upload.html)에서 증권사 앱 잔고 화면을 올리면
 *   ① Gemini 가 종목명 · 보유수량 · 평균단가를 읽고
 *   ② 관리시트 MasterData 의 정식 이름으로 맞춘 뒤 지금 보유 내역과 비교한 '바뀔 내용'을 보여주고
 *   ③ 멤버가 확인을 누르면 개인일기장 '{이름}포토폴리오' 탭 B·D·E 열(종목·평단·수량)을 고칩니다.
 *   · 계좌를 '토스 미국주식(달러)'로 고르면 '1달러 마스터 포토폴리오' 탭 E·H 열(수량·평단 $)만 고치고,
 *     {이름}포토폴리오 · D_실적기록 · D_기록은 건드리지 않습니다.
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
var HU_DOLLAR_TAB = '1달러 마스터 포토폴리오';  // 토스 미국주식(달러): A 이름 · B 티커 · C 종목명 · D 유형 · E 수량 · F 일일모으기 · G 현재가 · H 평단$
// 전략 실적 기록: 이 멤버가 캡처를 반영하면 개인일기장 해당 탭에 그달 계좌 상태를 한 줄 남김 (D 전략)
var HU_STRATEGY_TABS = { D: { log: 'D_실적기록', assume: 'D_가정', plan: 'D_매수계획', order: 'D_기록' } };

function doGet() { return huJson_({ ok: true, service: 'holdings-upload' }); }

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var member = String(req.member || '').trim();
    huCheckPin_(member, String(req.pin || ''));
    var toss = req.account === 'toss'; // 토스 미국주식(달러) → 1달러 탭. 반영(apply)은 비교 때 저장한 계좌를 따름
    if (req.action === 'parse') return huJson_(toss ? huDollarCompare_(member, huGemini_(req.images || [], huDollarNames_(member), true)) : huParse_(member, req.images || []));
    // 휴대폰에서 끊기지 않게: 사진 1장씩 읽고(read) → 마지막에 모아서 비교(compare)
    if (req.action === 'read') return huJson_({ ok: true, items: toss ? huGemini_([req.image], huDollarNames_(member), true) : huRead_(req.image) });
    if (req.action === 'compare') return huJson_(toss ? huDollarCompare_(member, req.items || []) : huCompare_(member, req.items || []));
    if (req.action === 'apply') return huJson_(huApply_(member, req.token, req.pick || null, !!req.removeMissing, req.edits || {}));
    if (req.action === 'current') return huJson_({ ok: true, holdings: huCurrent_(member).rows });
    throw new Error('알 수 없는 요청');
  } catch (err) {
    return huJson_({ ok: false, error: String(err.message || err) });
  }
}

function huJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// 비밀번호 확인 (5번 틀리면 10분 잠금 · 6시간에 15번 틀리면 6시간 잠금)
//   멤버가 없을 때와 비밀번호가 틀렸을 때 같은 메시지 → 등록된 멤버 이름을 알아낼 수 없게
//   틀린 횟수는 잠금 안에서 읽고 더함 → 동시에 여러 번 보내도 횟수가 빠지지 않게
function huCheckPin_(member, pin) {
  var pins = JSON.parse(PropertiesService.getScriptProperties().getProperty('MEMBER_PINS') || '{}');
  var bad = '멤버 또는 비밀번호가 맞지 않아요';
  if (!member || !/^[A-Za-z0-9가-힣]{1,20}$/.test(member)) throw new Error(bad);
  var cache = CacheService.getScriptCache(), key = 'HU_FAIL_' + member, keyLong = 'HU_FAIL6H_' + member;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('요청이 많아요. 잠시 뒤 다시 시도해 주세요'); // 다른 멤버의 '반영'이 끝날 때까지 기다림
  try {
    var fails = Number(cache.get(key) || 0), failsLong = Number(cache.get(keyLong) || 0);
    if (failsLong >= 15) throw new Error('비밀번호를 너무 많이 틀려 6시간 동안 잠겼어요');
    if (fails >= 5) throw new Error('비밀번호를 여러 번 틀려 10분 동안 잠겼어요');
    if (!pins[member] || String(pins[member]) !== pin) {
      cache.put(key, String(fails + 1), 600);
      cache.put(keyLong, String(failsLong + 1), 21600);
      throw new Error(bad);
    }
    cache.remove(key);
  } finally { lock.releaseLock(); }
}

// 시트에 쓰는 글자가 = + - @ 로 시작하면 수식으로 실행되지 않게 앞에 ' 를 붙임
function huSafe_(s) {
  s = String(s === null || s === undefined ? '' : s);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// ---------------------------------------------------------
// ① 인식 + 비교
// ---------------------------------------------------------
function huParse_(member, images) {
  if (!images || !images.length) throw new Error('이미지를 올려 주세요');
  if (images.length > 4) throw new Error('한 번에 4장까지 올릴 수 있어요');
  var known = huKnownEtfs_();
  return huCompare_(member, huGemini_(images, Object.keys(known).map(function (k) { return known[k].name; })), known);
}

function huRead_(image) {
  if (!image) throw new Error('이미지를 올려 주세요');
  var known = huKnownEtfs_();
  return huGemini_([image], Object.keys(known).map(function (k) { return known[k].name; }));
}

function huCompare_(member, read, known) {
  known = known || huKnownEtfs_();
  read = (read || []).slice(0, 200);
  var cur = huCurrent_(member);

  // 같은 종목이 여러 장에 나오면 마지막 값
  var parsed = {};
  read.forEach(function (x) {
    var qty = huNum_(x.quantity), avg = huNum_(x.avg_price), how = '';
    if (!x.name || !(qty >= 0)) return;
    // 평균단가가 안 보이면: 매입금액 ÷ 수량 → (평가금액 − 평가손익) ÷ 수량 순서로 계산
    if (!(avg > 0) && qty > 0) {
      var buy = huNum_(x.buy_amount), ev = huNum_(x.eval_amount), pl = huNum_(x.profit);
      if (buy > 0) { avg = buy / qty; how = '매입금액 ÷ 수량'; }
      else if (ev > 0 && pl !== 0) { avg = (ev - pl) / qty; how = '(평가금액 − 손익) ÷ 수량'; }
    }
    var m = huMatch_(x.name, known, cur.byKey);
    if (m) { parsed[m.key] = { raw: huSafe_(x.name), name: m.name, code: m.code, matched: true, qty: qty, avg: avg, how: how }; return; }
    // ETF 목록에 없으면 개별 종목: 티커(한국 6자리 코드 · 미국 티커)로 관리
    var t = huTicker_(x.ticker) || huTickerByName_(x.name);
    var usd = String(x.currency || '').toUpperCase() === 'USD';
    if (usd && avg > 0) { avg = avg * huUsdKrw_(); how = (how ? how + ' · ' : '') + '달러 × 오늘 환율'; } // 포트폴리오는 원화 기준
    parsed[t ? 'T_' + t : 'X_' + x.name] = { raw: huSafe_(x.name), name: huSafe_(String(x.name).trim()), code: t, matched: false, stock: true, qty: qty, avg: avg, how: how, usd: usd };
  });

  var rows = [], seen = {};
  Object.keys(parsed).forEach(function (k) {
    var p = parsed[k];
    var c = p.matched ? cur.byKey[k] : (p.stock ? (cur.byTicker[p.code] || cur.byKey[huNorm_(p.name)] || null) : null);
    if (c && p.stock) p.name = c.name; // 이미 있는 줄이면 시트의 이름 그대로
    seen[k] = true;
    // 계산으로 구한 평단은 반올림 오차(±0.1%)가 생기므로, 그 안이면 지금 평단을 그대로 둠
    if (c && p.how && c.avg > 0 && Math.abs(p.avg - c.avg) / c.avg < 0.001) { p.avg = c.avg; p.how = ''; }
    var status = (!p.matched && !p.stock) ? 'unknown' : (!c ? (p.stock && !p.code ? 'needTicker' : 'new') : ((Math.abs(c.qty - p.qty) > 1e-6 || Math.round(c.avg) !== Math.round(p.avg)) ? 'change' : 'same'));
    if (c) seen[c.key] = true;
    rows.push({ key: k, raw: p.raw, name: p.name, code: p.code, status: status, stock: !!p.stock, usd: !!p.usd, curKey: c ? c.key : null,
      oldQty: c ? c.qty : null, newQty: p.qty, oldAvg: c ? Math.round(c.avg) : null, newAvg: Math.round(p.avg), avgHow: p.how });
  });
  var missing = cur.rows.filter(function (c) { return c.qty > 0 && !seen[c.key]; })
    .map(function (c) { return { key: c.key, name: c.name, qty: c.qty }; });

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('HU_' + token, JSON.stringify({ member: member, rows: rows, missing: missing }), 900);
  return { ok: true, token: token, rows: rows, missing: missing };
}

// Gemini 로 잔고 화면 읽기 → [{name, quantity, avg_price}]
function huGemini_(images, knownNames, dollar) {
  if (!images || !images.length || !images[0]) throw new Error('이미지를 올려 주세요');
  if (images.length > 4) throw new Error('한 번에 4장까지 올릴 수 있어요');
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY 가 설정되지 않았어요');
  // 모델 이름이 바뀌어도 동작하도록: 속성 값 → 최신 별칭 → 알려진 이름 순서로 시도 (404 면 다음)
  var models = [props.getProperty('GEMINI_MODEL'), 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-2.5-flash'].filter(Boolean);
  var parts = [{ text: dollar ?
    '토스증권 앱의 미국 주식/ETF 잔고 화면 캡처입니다. 화면에 보이는 보유 종목마다 아래 값을 읽어 주세요.\n' +
    '- name 종목명, ticker 미국 티커(예 MSTY, MRNY. 화면에 없으면 아래 목록에서 같은 종목의 티커, 확실하지 않으면 빈칸)\n' +
    '- quantity 보유수량(주, 소수점 그대로), avg_price 1주 평균단가(구매가)\n' +
    '- buy_amount 매입금액(투자원금), eval_amount 평가금액, profit 평가손익(손실이면 음수)\n' +
    '- 금액이 달러($)로 보이면 달러 값과 currency=USD, 원화(원)로만 보이면 원화 값과 currency=KRW. 두 가지가 다 보이면 달러\n' +
    '- 화면에 없는 값은 0. 수익률(%)·현재가는 넣지 않기\n- 숫자는 쉼표 없이 숫자로\n- 잘려서 일부만 보이는 줄은 빼기\n' +
    '- 지금 관리 중인 종목 (티커 · 이름):\n' + knownNames.join(', ') :
    '한국 증권사 앱의 주식/ETF 잔고 화면 캡처입니다. 화면에 보이는 보유 종목마다 아래 값을 읽어 주세요 (원 단위).\n' +
    '- name 종목명, quantity 보유수량(주), avg_price 평균단가(매입단가·매입가)\n' +
    '- buy_amount 매입금액(투자원금·매수금액), eval_amount 평가금액, profit 평가손익(손실이면 음수)\n' +
    '- 화면에 없는 값은 0. 수익률(%)·현재가는 넣지 않기\n- 숫자는 쉼표 없이 숫자로\n- 잘려서 일부만 보이는 줄은 빼기\n' +
    '- ticker: 한국 종목은 6자리 종목코드(예 005930, 0210A0), 미국 종목은 티커(예 PL, PYPL, MSTY). 확실하지 않으면 빈칸\n' +
    '- 금액은 원화(원)로 보이면 원화 값을 그대로 쓰기 (달러만 보이면 달러 값과 currency=USD)\n' +
    '- 수량은 소수점(소수점 주식)도 그대로\n' +
    '- 종목명이 …로 잘려 보이면, 아래 목록에서 앞부분이 같은 종목의 전체 이름으로 채우기\n' +
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
        name: { type: 'STRING' }, quantity: { type: 'NUMBER' }, avg_price: { type: 'NUMBER' },
        buy_amount: { type: 'NUMBER' }, eval_amount: { type: 'NUMBER' }, profit: { type: 'NUMBER' },
        ticker: { type: 'STRING' }, currency: { type: 'STRING' } }, required: ['name', 'quantity'] } }
    }
  };
  // 404(모델 없음)·503(사용량 몰림)·429(잠깐 한도)·500 이면 잠시 쉬었다 다시, 그래도 안 되면 다음 모델로
  var res = null, busy = false;
  outer:
  for (var mi = 0; mi < models.length; mi++) {
    for (var tryN = 0; tryN < 2; tryN++) {
      res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[mi] + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body)
      });
      var code = res.getResponseCode();
      if (code === 200) break outer;
      if (code === 404) break;                       // 이 모델 이름이 없음 → 다음 모델
      if (code === 503 || code === 429 || code === 500) { busy = true; Utilities.sleep(1500 * (tryN + 1)); continue; }
      break outer;                                   // 키 오류 등은 바로 알림
    }
  }
  if (res.getResponseCode() !== 200 && busy) throw new Error('지금 Google AI 사용량이 몰려 있어요. 1~2분 뒤 다시 [읽어오기]를 눌러 주세요.');
  if (res.getResponseCode() !== 200) throw new Error('이미지 인식 실패 (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var j = JSON.parse(res.getContentText());
  var text = (((j.candidates || [])[0] || {}).content || {}).parts;
  text = text && text[0] && text[0].text;
  if (!text) throw new Error('이미지에서 종목을 찾지 못했어요');
  var arr = JSON.parse(text);
  return Array.isArray(arr) ? arr : [];
}

// ---------------------------------------------------------
// 토스 미국주식(달러) → '1달러 마스터 포토폴리오' (수량 · 평단은 달러 그대로, 원화 탭 · D 실적기록은 안 건드림)
// ---------------------------------------------------------
function huDollarCurrent_(member) {
  var sh = SpreadsheetApp.openById(HU_DIARY_ID).getSheetByName(HU_DOLLAR_TAB);
  if (!sh) throw new Error(HU_DOLLAR_TAB + ' 탭이 없어요');
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 8).getValues();
  var rows = [], byKey = {}, lastRow = 1;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim()) lastRow = i + 1; // J~L(누적배당금) 줄은 세지 않음 → A열 기준
    var t = huTicker_(v[i][1]);
    if (String(v[i][0]).trim() !== member || !t) continue;
    var r = { row: i + 1, key: 'T_' + t, ticker: t, name: String(v[i][2]).trim() || t, qty: huNum_(v[i][4]), avg: huNum_(v[i][7]) };
    rows.push(r); byKey[r.key] = r;
  }
  return { sheet: sh, rows: rows, byKey: byKey, lastRow: lastRow };
}

function huDollarNames_(member) {
  return huDollarCurrent_(member).rows.map(function (r) { return r.ticker + ' · ' + r.name; });
}

function huRound2_(v) { return Math.round(v * 100) / 100; }

function huDollarCompare_(member, read) {
  var cur = huDollarCurrent_(member);
  read = (read || []).slice(0, 200);
  var parsed = {};
  read.forEach(function (x) {
    var qty = huNum_(x.quantity), avg = huNum_(x.avg_price), how = '';
    if (!x.name || !(qty >= 0)) return;
    if (!(avg > 0) && qty > 0) {
      var buy = huNum_(x.buy_amount), ev = huNum_(x.eval_amount), pl = huNum_(x.profit);
      if (buy > 0) { avg = buy / qty; how = '매입금액 ÷ 수량'; }
      else if (ev > 0 && pl !== 0) { avg = (ev - pl) / qty; how = '(평가금액 − 손익) ÷ 수량'; }
    }
    // 원화로만 보이는 화면이면 오늘 환율로 나눠 달러로
    if (String(x.currency || '').toUpperCase() === 'KRW' && avg > 0) {
      var fx = huUsdKrw_(); avg = avg / fx; how = (how ? how + ' · ' : '') + '원화 ÷ 환율 ' + Math.round(fx);
    }
    // 티커: 화면 값 → 지금 목록의 이름과 같거나 비슷한 종목
    var t = huTicker_(x.ticker);
    if (!t) {
      var k = huNorm_(x.name), best = null, bestS = 0;
      cur.rows.forEach(function (r) {
        var s = (huNorm_(r.name) === k || r.ticker === k) ? 1 : huDice_(k, huNorm_(r.name));
        if (s > bestS) { bestS = s; best = r; }
      });
      if (best && bestS >= 0.6) t = best.ticker;
    }
    parsed[t ? 'T_' + t : 'X_' + x.name] = { raw: huSafe_(x.name), name: huSafe_(String(x.name).trim()), code: t, qty: qty, avg: huRound2_(avg), how: how };
  });

  var rows = [], seen = {};
  Object.keys(parsed).forEach(function (k) {
    var p = parsed[k], c = cur.byKey[k] || null;
    if (c) { p.name = c.name; seen[c.key] = true; }
    if (c && p.how && c.avg > 0 && Math.abs(p.avg - c.avg) / c.avg < 0.005) { p.avg = c.avg; p.how = ''; } // 계산 평단 반올림 오차
    var status = !c ? (p.code ? 'new' : 'needTicker') : ((Math.abs(c.qty - p.qty) > 1e-6 || Math.abs(c.avg - p.avg) >= 0.005) ? 'change' : 'same');
    rows.push({ key: k, raw: p.raw, name: p.name, code: p.code, status: status, stock: true, usd: true, curKey: c ? c.key : null,
      oldQty: c ? c.qty : null, newQty: p.qty, oldAvg: c ? c.avg : null, newAvg: p.avg, avgHow: p.how });
  });
  var missing = cur.rows.filter(function (c) { return c.qty > 0 && !seen[c.key]; })
    .map(function (c) { return { key: c.key, name: c.ticker + ' ' + c.name, qty: c.qty }; });
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('HU_' + token, JSON.stringify({ member: member, account: 'toss', rows: rows, missing: missing }), 900);
  return { ok: true, account: 'toss', token: token, rows: rows, missing: missing };
}

// huApply_ 안(잠금 · 확인 번호 처리 뒤)에서 부름
function huDollarApply_(member, saved, pick, removeMissing, edits) {
  var cur = huDollarCurrent_(member), sh = cur.sheet, log = [];
  saved.rows.forEach(function (r) {
    var e = edits[r.key];
    if (!e) return;
    if (e.qty !== null && e.qty !== '' && isFinite(e.qty) && e.qty >= 0) r.newQty = Math.round(e.qty * 1e6) / 1e6;
    if (e.ticker && !r.curKey) { var tk = huTicker_(e.ticker); if (tk && !/^\d/.test(tk)) { r.code = tk; if (r.status === 'needTicker') r.status = 'new'; } }
    if (isFinite(e.avg) && e.avg > 0) r.newAvg = huRound2_(e.avg);
    if (r.status === 'same' && (r.newQty !== r.oldQty || r.newAvg !== r.oldAvg)) r.status = 'change';
  });
  var chosen = saved.rows.filter(function (r) { return (r.status === 'change' || r.status === 'new') && (!pick || pick.indexOf(r.key) >= 0); });
  chosen.forEach(function (r) {
    var c = cur.byKey[r.curKey || ('T_' + r.code)];
    if (c) {
      sh.getRange(c.row, 5).setValue(r.newQty);
      if (r.newAvg > 0) sh.getRange(c.row, 8).setValue(r.newAvg);
      log.push(c.ticker + ' ' + c.qty + '→' + r.newQty + '주' + (r.newAvg > 0 && r.newAvg !== c.avg ? ' · 평단 $' + r.newAvg : ''));
    } else {
      var row = cur.lastRow + 1; cur.lastRow = row;
      sh.getRange(row, 1, 1, 8).setValues([[member, r.code, huSafe_(r.name), '', r.newQty, 0, '=IFERROR(GOOGLEFINANCE($B' + row + ',"price"), 0)', r.newAvg || '']]);
      cur.byKey['T_' + r.code] = { row: row, ticker: r.code, qty: r.newQty, avg: r.newAvg };
      log.push('+ ' + r.code + ' ' + r.newQty + '주');
    }
  });
  if (removeMissing) {
    saved.missing.forEach(function (m) {
      var c = cur.byKey[m.key];
      if (c && (!pick || pick.indexOf(m.key) >= 0)) { sh.getRange(c.row, 5).setValue(0); log.push(c.ticker + ' ' + c.qty + '→0주'); }
    });
  }
  huLog_(member, log.map(function (s) { return '[토스] ' + s; }));
  return { ok: true, account: 'toss', changed: log.length, log: log, strategy: '' };
}

// ---------------------------------------------------------
// ② 반영
// ---------------------------------------------------------
function huApply_(member, token, pick, removeMissing, edits) {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 반영이 진행 중이에요. 잠시 뒤 다시 시도해 주세요');
  try {
    // 잠금 안에서 확인 → '반영'을 두 번 눌러도 두 번째는 이미 쓴 확인 번호라 막힘
    var saved = JSON.parse(cache.get('HU_' + token) || 'null');
    if (!saved || saved.member !== member) throw new Error('확인 시간이 지났거나 이미 반영했어요. 다시 올려 주세요 (15분)');
    cache.remove('HU_' + token);
    if (saved.account === 'toss') return huDollarApply_(member, saved, pick, removeMissing, edits);
    var planBefore = null;
    try { planBefore = huReadPlan_(member); } catch (err) { planBefore = null; } // 반영 전 이번 달 계획 (반영 후엔 수식이 다시 계산되므로 먼저 읽음)
    var cur = huCurrent_(member), sh = cur.sheet, log = [];
    // 확인 화면에서 고친 수량·평단 반영 (숫자일 때만)
    saved.rows.forEach(function (r) {
      var e = edits[r.key];
      if (!e) return;
      if (e.qty !== null && e.qty !== '' && isFinite(e.qty) && e.qty >= 0) r.newQty = Math.round(e.qty * 1e6) / 1e6; // 소수점 주식 허용
      if (e.ticker && r.stock && !r.curKey) { var tk = huTicker_(e.ticker); if (tk) { r.code = tk; if (r.status === 'needTicker') r.status = 'new'; } }
      if (isFinite(e.avg) && e.avg > 0) r.newAvg = Math.round(e.avg);
      if (r.status === 'same' && (r.newQty !== r.oldQty || r.newAvg !== r.oldAvg)) r.status = 'change';
    });
    var chosen = saved.rows.filter(function (r) { return (r.status === 'change' || r.status === 'new') && (!pick || pick.indexOf(r.key) >= 0); });
    chosen.forEach(function (r) {
      var c = cur.byKey[r.curKey || r.key];
      if (c) {
        sh.getRange(c.row, 4, 1, 2).setValues([[r.newAvg || c.avg, r.newQty]]);
        log.push(r.name + ' ' + c.qty + '→' + r.newQty + '주');
      } else {
        var row = cur.lastRow + 1; cur.lastRow = row;
        var code = String(r.code || '').replace(/^KRX:/i, '');
        sh.getRange(row, 1, 1, 6).setValues([[member, huSafe_(r.name), 0, r.newAvg, r.newQty, huPriceFormula_(code)]]);
        log.push('+ ' + r.name + (r.stock ? ' (' + code + ')' : '') + ' ' + r.newQty + '주');
      }
    });
    if (removeMissing) {
      saved.missing.forEach(function (m) {
        var c = cur.byKey[m.key];
        if (c && (!pick || pick.indexOf(m.key) >= 0)) { sh.getRange(c.row, 5).setValue(0); log.push(m.name + ' ' + c.qty + '→0주'); }
      });
    }
    huLog_(member, log);
    var strategy = '';
    try { strategy = huStrategyLog_(member, chosen); } catch (err) { strategy = '⚠️ 실적기록 실패: ' + err.message; }
    try { var ord = huOrderLog_(member, chosen, planBefore); if (ord) strategy += (strategy ? '<br>📝 ' : '') + ord; } catch (err) { strategy += ' · ⚠️ 매수 기록 실패: ' + err.message; }
    return { ok: true, changed: log.length, log: log, strategy: strategy };
  } finally { lock.releaseLock(); }
}

function huLog_(member, log) {
  var ss = SpreadsheetApp.openById(HU_MANAGE_ID);
  var sh = ss.getSheetByName(HU_LOG_TAB);
  if (!sh) { sh = ss.insertSheet(HU_LOG_TAB); sh.getRange(1, 1, 1, 4).setValues([['시각', '멤버', '건수', '바뀐 내용']]); sh.setFrozenRows(1); }
  sh.appendRow([Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), member, log.length, huSafe_(log.join(' · ') || '변경 없음')]);
}

// ---------------------------------------------------------
// ③ 전략 실적 기록 (D_실적기록) — 반영이 끝난 뒤 멤버 탭에서 다시 읽어서 계산
//   A 기록일 · B 회차 · C 레버리지 · D 나스닥CC · E HOLD 평가액 · F 예수금 · G·H 이번 달 매수액
//   I·J 이번 달 분배금(CC·HOLD) · K 신규 입금(추정) · T 메모.  L~S 는 시트 수식이 계산
//   같은 달에 여러 번 올리면 그달 줄을 덮어쓰고, 매수액은 더해감
// ---------------------------------------------------------
function huBucket_(name) {
  var n = huNorm_(name);
  if (n.indexOf('레버리지') >= 0) return 'LEV';
  if ((n.indexOf('나스닥100') >= 0 || n.indexOf('테크100') >= 0) && n.indexOf('커버드콜') >= 0) return 'CC';
  return 'HOLD';
}

// 순수 계산 (테스트 가능): port = 멤버 탭 A~L 값, deltas = [{name, dq}], prev = 그달 기존 줄(A~K) 또는 null
function huStrategyRow_(member, port, deltas, now, start, prev) {
  var val = { LEV: 0, CC: 0, HOLD: 0 }, price = {}, div = { CC: 0, HOLD: 0 };
  var ym = now.getFullYear() * 12 + now.getMonth();
  for (var i = 1; i < port.length; i++) {
    var r = port[i];
    if (String(r[0]).trim() === member && String(r[1]).trim()) {
      var p = huNum_(r[5]);
      val[huBucket_(r[1])] += huNum_(r[4]) * p;
      price[huNorm_(r[1])] = p;
    }
    // H~L: 이름 · 수령일자 · 종목 · 당시수량 · 실수령액
    var d = r[8];
    if (String(r[7]).trim() === member && d instanceof Date && d.getFullYear() * 12 + d.getMonth() === ym) {
      div[huBucket_(r[9]) === 'CC' ? 'CC' : 'HOLD'] += huNum_(r[11]);
    }
  }
  var buy = { LEV: 0, CC: 0 };
  (deltas || []).forEach(function (x) {
    var b = huBucket_(x.name);
    if (x.dq > 0 && buy[b] !== undefined) buy[b] += x.dq * (price[huNorm_(x.name)] || 0);
  });
  var m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
  var g = Math.round(buy.LEV + (prev ? huNum_(prev[6]) : 0));
  var h = Math.round(buy.CC + (prev ? huNum_(prev[7]) : 0));
  var cash = prev ? huNum_(prev[5]) : 0;
  var deposit = Math.max(0, g + h - div.CC - div.HOLD);
  return [now, m, Math.round(val.LEV), Math.round(val.CC), Math.round(val.HOLD), cash, g, h,
    Math.round(div.CC), Math.round(div.HOLD), Math.round(deposit)];
}

function huStrategyLog_(member, chosen) {
  var cfg = HU_STRATEGY_TABS[member];
  if (!cfg) return '';
  var ss = SpreadsheetApp.openById(HU_DIARY_ID);
  var sh = ss.getSheetByName(cfg.log), asm = ss.getSheetByName(cfg.assume);
  if (!sh || !asm) return '';
  SpreadsheetApp.flush(); // 방금 고친 수량이 현재가 수식에 반영되도록
  var port = ss.getSheetByName(member + '포토폴리오');
  var pv = port.getRange(1, 1, Math.max(port.getLastRow(), 1), 12).getValues();
  var start = asm.getRange('B19').getValue();
  if (!(start instanceof Date)) start = new Date(2026, 6, 1);
  var now = new Date();
  var deltas = (chosen || []).map(function (r) { return { name: r.name, dq: huNum_(r.newQty) - huNum_(r.oldQty) }; });

  // 마지막 기록 줄: A열 기준 (L~S 는 수식이 미리 채워져 있어 getLastRow 를 쓰면 안 됨)
  var n = Math.max(sh.getLastRow() - 1, 1);
  var a = sh.getRange(2, 1, n, 11).getValues(), last = 0;
  for (var i = 0; i < a.length; i++) if (a[i][0] !== '' && a[i][0] !== null) last = i;
  var m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
  var same = huNum_(a[last][1]) === m;
  var row = huStrategyRow_(member, pv, deltas, now, start, same ? a[last] : null);
  var target = same ? last + 2 : last + 3;
  if (sh.getMaxColumns() < 20) sh.insertColumnsAfter(sh.getMaxColumns(), 20 - sh.getMaxColumns());
  if (!sh.getRange(1, 20).getValue()) sh.getRange(1, 20).setValue('메모');
  sh.getRange(target, 1, 1, 11).setValues([row]);
  sh.getRange(target, 20).setValue('잔고 캡처 자동 기록 · 신규 입금은 매수액 − 분배금으로 추정');
  // 수식(L~S)이 없는 줄이면 위 줄에서 복사
  if (!sh.getRange(target, 12).getFormula() && target > 3) sh.getRange(target - 1, 12, 1, 8).copyTo(sh.getRange(target, 12, 1, 8));
  return cfg.log + ' ' + m + 'M ' + (same ? '갱신' : '추가') + ': 평가 ' + Math.round((row[2] + row[3] + row[4]) / 1e4).toLocaleString() + '만 (레버리지 ' +
    Math.round(row[2] / 1e4) + '만 · CC ' + Math.round(row[3] / 1e4) + '만 · 기타 ' + Math.round(row[4] / 1e4) + '만)';
}

// ---------------------------------------------------------
// ④ 매수 기록 (D_기록) — 이번 반영에서 늘어난 레버리지·나스닥CC 수량을 계획과 나란히 기록
//   A 기록일시 · B 단계 · C 계좌 총자산 · D 투입 현금 · E·F 레버리지 매수(주·금액) · G·H 나스닥CC 매수(주·금액)
//   I 남는 현금(투입 현금 − 실제 매수) · J 매수 후 레버리지 비중 · K 메모(계획 대비)
//   레버리지·나스닥CC 수량이 늘지 않았으면(조회만) 기록하지 않음
// ---------------------------------------------------------
function huReadPlan_(member) {
  var cfg = HU_STRATEGY_TABS[member];
  if (!cfg || !cfg.plan) return null;
  var sh = SpreadsheetApp.openById(HU_DIARY_ID).getSheetByName(cfg.plan);
  if (!sh) return null;
  var v = sh.getRange('A1:G25').getValues();
  return { phase: v[20][1], total: v[3][1], cash: huNum_(v[6][1]), levPlan: huNum_(v[9][2]), nccPlan: huNum_(v[10][2]) };
}

// 순수 계산 (테스트 가능): port = 멤버 탭 A~F 값(반영 후), deltas = [{name, dq}], plan = 반영 전 계획
function huOrderRow_(member, port, deltas, plan, now) {
  var price = {}, val = { LEV: 0, CC: 0 };
  for (var i = 1; i < port.length; i++) {
    var r = port[i];
    if (String(r[0]).trim() !== member || !String(r[1]).trim()) continue;
    var p = huNum_(r[5]); price[huNorm_(r[1])] = p;
    var b = huBucket_(r[1]);
    if (val[b] !== undefined) val[b] += huNum_(r[4]) * p;
  }
  var sh = { LEV: 0, CC: 0 }, amt = { LEV: 0, CC: 0 };
  (deltas || []).forEach(function (x) {
    var b = huBucket_(x.name);
    if (x.dq > 0 && sh[b] !== undefined) { sh[b] += x.dq; amt[b] += x.dq * (price[huNorm_(x.name)] || 0); }
  });
  if (!(sh.LEV > 0 || sh.CC > 0)) return null;
  var cash = plan ? plan.cash : 0, spent = amt.LEV + amt.CC;
  var memo = '잔고 캡처 자동' + (plan ? ' · 계획 대비 레버리지 ' + sh.LEV + '/' + plan.levPlan + '주, 나스닥CC ' + sh.CC + '/' + plan.nccPlan + '주' : '');
  return [now, plan ? plan.phase : '', plan ? Math.round(huNum_(plan.total)) : '', Math.round(cash), sh.LEV, Math.round(amt.LEV),
    sh.CC, Math.round(amt.CC), cash ? Math.round(cash - spent) : '', val.LEV + val.CC > 0 ? val.LEV / (val.LEV + val.CC) : 0, memo];
}

function huOrderLog_(member, chosen, plan) {
  var cfg = HU_STRATEGY_TABS[member];
  if (!cfg || !cfg.order) return '';
  var ss = SpreadsheetApp.openById(HU_DIARY_ID);
  var sh = ss.getSheetByName(cfg.order);
  if (!sh) return '';
  var pv = ss.getSheetByName(member + '포토폴리오');
  pv = pv.getRange(1, 1, Math.max(pv.getLastRow(), 1), 6).getValues();
  var deltas = (chosen || []).map(function (r) { return { name: r.name, dq: huNum_(r.newQty) - huNum_(r.oldQty) }; });
  var row = huOrderRow_(member, pv, deltas, plan, new Date());
  if (!row) return '';
  sh.appendRow(row);
  return cfg.order + ' 기록: 레버리지 ' + row[4] + '주 · 나스닥CC ' + row[6] + '주 (' + row[10].replace('잔고 캡처 자동 · ', '') + ')';
}

// ---------------------------------------------------------
// 도우미
// ---------------------------------------------------------
// 멤버 탭 A~F (A 이름 · B 종목 · C 목표비중 · D 평단 · E 수량 · F 현재가)
function huCurrent_(member) {
  var sh = SpreadsheetApp.openById(HU_DIARY_ID).getSheetByName(member + '포토폴리오');
  if (!sh) throw new Error(member + '포토폴리오 탭이 없어요');
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 6).getValues();
  var f = sh.getRange(1, 6, Math.max(sh.getLastRow(), 1), 1).getFormulas();
  var rows = [], byKey = {}, byTicker = {}, lastRow = 1;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim()) lastRow = i + 1;
    if (String(v[i][0]).trim() !== member || !String(v[i][1]).trim()) continue;
    var r = { row: i + 1, name: String(v[i][1]).trim(), key: huNorm_(v[i][1]), avg: huNum_(v[i][3]), qty: huNum_(v[i][4]) };
    var fm = String(f[i][0] || '').match(/GOOGLEFINANCE\("(?:KRX:|KOSDAQ:|NASDAQ:|NYSE:|NYSEARCA:)?([0-9A-Z.]+)"/i);
    if (fm) { r.ticker = fm[1].toUpperCase(); byTicker[r.ticker] = r; }
    rows.push(r); byKey[r.key] = r;
  }
  return { sheet: sh, rows: rows, byKey: byKey, byTicker: byTicker, lastRow: lastRow };
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
function huMatch_(raw, known, holdKeys) {
  var cut = /(…|\.\.\.)\s*$/.test(String(raw || ''));
  var k = huNorm_(String(raw || '').replace(/(…|\.\.\.)\s*$/, ''));
  var hit = function (kk) { return { key: kk, name: known[kk].name, code: known[kk].code }; };
  // 화면에서 이름이 잘린 경우 (예: 'KODEX 미국나스닥100…'): 앞부분이 같은 ETF 중
  //   지금 갖고 있는 종목 → 하나뿐인 종목 순서로 고름 (여러 개면 확정하지 않음)
  if (cut && k.length >= 6) {
    var pre = Object.keys(known).filter(function (kk) { return kk.indexOf(k) === 0; });
    var held = pre.filter(function (kk) { return holdKeys && holdKeys[kk]; });
    if (held.length === 1) return hit(held[0]);
    if (pre.length === 1) return hit(pre[0]);
    if (pre.length > 1) return null;
  }
  if (known[k]) return hit(k);
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
// 티커 정리: 한국 6자리 코드(영문 섞인 새 코드 포함) 또는 미국 티커(영문 1~5자, . 허용)
function huTicker_(t) {
  t = String(t || '').trim().toUpperCase().replace(/^(KRX|KOSDAQ|NASDAQ|NYSE|NYSEARCA|AMEX):/, '').replace(/\.(KS|KQ)$/, '');
  if (/^\d{6}$/.test(t) || /^\d[0-9A-Z]{5}$/.test(t)) return t;
  if (/^[A-Z][A-Z.]{0,5}$/.test(t)) return t;
  return '';
}
// 이름으로 관리시트 MasterData(전체 줄)에서 티커 찾기
function huTickerByName_(name) {
  var cache = CacheService.getScriptCache(), k = 'HU_MD_NAMES', map = JSON.parse(cache.get(k) || 'null');
  if (!map) {
    map = {};
    var md = SpreadsheetApp.openById(HU_MANAGE_ID).getSheetByName('MasterData');
    md.getRange(3, 2, md.getLastRow() - 2, 2).getDisplayValues().forEach(function (r) { if (r[0] && r[1]) map[huNorm_(r[1])] = r[0]; });
    try { cache.put(k, JSON.stringify(map), 3600); } catch (e) { }
  }
  return huTicker_(map[huNorm_(name)] || '');
}
// 원/달러 (야후, 1시간 저장)
function huUsdKrw_() {
  var c = CacheService.getScriptCache(), v = Number(c.get('HU_FX'));
  if (v > 0) return v;
  try {
    var j = JSON.parse(UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=1d&interval=1h', { muteHttpExceptions: true }).getContentText());
    v = j.chart.result[0].meta.regularMarketPrice;
  } catch (e) { v = 0; }
  if (!(v > 0)) v = 1400;
  c.put('HU_FX', String(v), 3600);
  return v;
}
// 현재가 수식: 한국 = 원, 미국 = 달러 × 원/달러 (포트폴리오는 모두 원화)
function huPriceFormula_(code) {
  if (!code) return '';
  if (/^\d[0-9A-Z]{5}$/.test(code)) return '=IFERROR(GOOGLEFINANCE("KRX:' + code + '","price"), IFERROR(GOOGLEFINANCE("' + code + '","price"), 0))';
  return '=IFERROR(GOOGLEFINANCE("' + code + '","price")*GOOGLEFINANCE("CURRENCY:USDKRW"), 0)';
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
  Logger.log('모델: ' + (p.getProperty('GEMINI_MODEL') || 'gemini-flash-latest (없으면 자동으로 다른 이름 시도)'));
}
