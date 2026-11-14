import requests
import json
import time
from bs4 import BeautifulSoup
import pandas as pd
from io import StringIO
import urllib3
import os
import sys
import re

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 실행 결과 집계 → 수집·전송이 실패하면 Actions 를 빨간색으로 (예전엔 오류를 삼켜서 늘 초록)
ERRORS = []        # 운용사 엔진 오류 (ETF 이름: 내용)
SEND_FAILS = []    # 시트 기록 실패
INSECURE = set()   # 인증서 문제로 검증 없이 받은 사이트

def http_get(url, timeout=20, **kw):
    """TLS 검증을 켜고 받되, 인증서 체인이 불완전한 운용사 사이트만 검증 없이 한 번 더 (기록해 둠)
    운용사 서버가 잠깐 응답이 없을 때(타임아웃)는 5초 쉬고 한 번만 다시 시도"""
    for attempt in range(2):
        try:
            try:
                return requests.get(url, timeout=timeout, **kw)
            except requests.exceptions.SSLError:
                host = url.split('/')[2]
                INSECURE.add(host)
                return requests.get(url, timeout=timeout, verify=False, **kw)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            if attempt == 1: raise
            time.sleep(5)

# ==========================================
# 🎯 1. 마스터 세팅
# ==========================================
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?output=csv&gid=712569303"
# 🔐 Webhook 주소와 토큰은 코드에 적지 않고 GitHub Secrets에서 받습니다
#    (저장소 Settings → Secrets and variables → Actions 에 WEBHOOK_URL, WEBHOOK_TOKEN 등록)
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "").strip()
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN", "").strip()
if not WEBHOOK_URL or not WEBHOOK_TOKEN:
    print("❌ WEBHOOK_URL / WEBHOOK_TOKEN 환경변수가 없습니다. GitHub Secrets 등록을 확인하세요.")
    sys.exit(1)


# 실행 위치
#  - cloud (기본, GitHub Actions): 해외 서버라 미래에셋(TIGER)·KB(RISE)가 접속을 막음 → 이 둘은 건너뜀
#  - local (동진님 PC, tools/pc_dividend): 한국 IP 로 TIGER·RISE·PLUS 를 운용사에서 직접 받음
#    (2026-11 확인: TIGER·RISE 는 GitHub·구글 서버 접속 차단. PLUS 는 한국에서만 확인돼서 PC 담당)
#    PC 실행 때는 먼저 상장된 커버드콜 ETF 전체를 훑어 '관리코드'에 없는 종목을 자동 등록 (동진님 결정 2026-11-09)
SCRAPER_MODE = os.environ.get("SCRAPER_MODE", "cloud").strip().lower()
PC_ISSUERS = ("TIGER", "RISE", "PLUS")
ISSUERS = ("TIGER", "RISE", "PLUS", "KODEX", "ACE", "SOL", "KIWOOM")
UA_HDR = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'}

def issuer_of(name, url=""):
    """종목명 앞글자로 운용사 판단 (예전 시트 줄은 주소로도 판단)"""
    n = str(name).strip().upper()
    for p in ISSUERS:
        if n.startswith(p + " "): return p
    u = str(url)
    for key, p in (("kbam", "RISE"), ("plusetf", "PLUS"), ("samsungfund", "KODEX"), ("aceetf", "ACE"), ("soletf", "SOL")):
        if key in u: return p
    return ""

def code_or(x):
    return str(x)[-60:]

def redact(msg):
    """오류 문구에 Webhook 주소·토큰이 섞여 공개 Actions 로그에 남지 않게 가림"""
    msg = str(msg)
    for secret in (WEBHOOK_TOKEN, WEBHOOK_URL):
        if secret: msg = msg.replace(secret, "***")
    return msg

def format_date(d_str):
    d_str = str(d_str).strip().replace(".", "-")
    if len(d_str) == 8 and d_str.isdigit():
        return f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:]}"
    return d_str

def tax_or_none(v):
    """과세표준: 운용사 응답에 값이 없으면 0 이 아니라 None(시트 빈칸). 0 은 실제 0 일 때만 (동진님 규칙 2026-10-21)"""
    if v is None: return None
    t = str(v).replace(',', '').replace('원', '').strip()
    if t in ('', '-', 'None', 'null'): return None
    try: return int(float(t))
    except ValueError: return None

# ==========================================
# 📡 2. 운용사별 6대 크롤링 엔진
# ==========================================

TIGER_BASE = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/"
TIGER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

def engine_tiger_direct(code, months=13):
    """ [TIGER · PC] 미래에셋 분배 내역을 한국 IP 에서 직접 조회 (gas/dividend_webhook.gs fetchTigerDistributions_ 와 같은 방식)
    목록 화면에서 쿠키를 받고, 월별 list.ajax 표에서 이 종목 줄만 읽음
    칸 순서: 종목명(코드) | 유형 | 지급기준일 | 실지급일 | 주당분배금 | 주당과세표준액 | 분배율 """
    result, seen = [], set()
    try:
        ses = requests.Session()
        ses.headers.update({"User-Agent": TIGER_UA})
        page = ses.get(TIGER_BASE + "list.do", timeout=20)
        if page.status_code != 200: raise ValueError(f"목록 화면 HTTP {page.status_code}")
        y, m = time.localtime().tm_year, time.localtime().tm_mon
        for i in range(months):
            yy, mm = (y, m - i) if m - i > 0 else (y - 1, m - i + 12)
            res = ses.post(TIGER_BASE + "list.ajax", timeout=20,
                           data={"pageIndex": "1", "firstIndex": "0", "listCnt": "20", "orderC": "", "orderType": "", "orderB": "",
                                 "selectYear": str(yy), "selectMonth": str(mm), "q": code},
                           headers={"X-Requested-With": "XMLHttpRequest", "Referer": TIGER_BASE + "list.do"})
            if res.status_code != 200: raise ValueError(f"{yy}-{mm:02d} 조회 HTTP {res.status_code}")
            for tr in BeautifulSoup(res.text, "html.parser").find_all("tr"):
                cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
                if len(cells) < 6 or f"({code})" not in cells[0]: continue
                rec = cells[2].strip()
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", rec) or rec in seen: continue
                div = tax_or_none(cells[4])
                if not div: continue
                seen.add(rec)
                result.append({"recordDate": rec, "payDate": format_date(cells[3]), "dividend": div, "taxBase": tax_or_none(cells[5])})
            time.sleep(0.3)
        result.sort(key=lambda x: x["recordDate"], reverse=True)  # 최신순 (아래에서 뒤집어 오래된 것부터 기록)
        if not result: raise ValueError("최근 13개월 분배 내역 0건 (화면 구조가 바뀌었을 수 있음)")
    except Exception as e: print(f"  [TIGER 에러]: {e}"); ERRORS.append(f"TIGER {code}: {e}")
    return result

def engine_rise_direct(url):
    """ [RISE · PC] kbam.co.kr 분배 API 를 한국 IP 에서 직접 조회 """
    result = []
    try:
        res = http_get(url, timeout=30, headers={'User-Agent': 'Mozilla/5.0'})
        body = res.json()
        if 'history' not in body: raise ValueError("응답에 history 없음")
        for item in body['history']:
            div = tax_or_none(item.get('amount'))
            if not div: continue
            result.append({
                "recordDate": str(item.get('base_date')).strip(),
                "payDate": str(item.get('payment_date')).strip(),
                "dividend": div,
                "taxBase": tax_or_none(item.get('tax_standard_amount'))
            })
        if not result: raise ValueError("분배 내역 0건")
    except Exception as e: print(f"  [RISE 에러]: {e}"); ERRORS.append(f"RISE {code_or(url)}: {e}")
    return result

def engine_kiwoom(code):
    url = f"https://www.kiwoometf.com/service/etf/KO02010200M?gcode={code}"
    result = []
    try:
        res = http_get(url, headers={'User-Agent': 'Mozilla/5.0'})
        soup = BeautifulSoup(res.text, 'html.parser')
        tables = soup.find_all('table')
        for table in tables:
            headers = [th.text.replace(' ', '') for th in table.find_all('th')]
            if '주당분배금' in headers:
                rows = table.find_all('tr')
                for row in rows[1:]:
                    cols = [td.text.strip() for td in row.find_all('td')]
                    if len(cols) >= 5:
                        result.append({
                            "recordDate": format_date(cols[0]),
                            "payDate": format_date(cols[1]),
                            "dividend": int(cols[2].replace(',', '')),
                            "taxBase": tax_or_none(cols[4])
                        })
                break
    except Exception as e: print(f"  [KIWOOM 에러]: {e}"); ERRORS.append(f"KIWOOM {code_or(url)}: {e}")
    return result

def engine_kodex(url):
    result = []
    try:
        res = http_get(url, headers={'User-Agent': 'Mozilla/5.0'})
        for item in res.json().get('dividList', []):
            result.append({
                "recordDate": format_date(item.get('basicD')),
                "payDate": format_date(item.get('payD')),
                "dividend": int(item.get('dividA', 0)),
                "taxBase": tax_or_none(item.get('taxDividA'))
            })
    except Exception as e: print(f"  [KODEX 에러]: {e}"); ERRORS.append(f"KODEX {code_or(url)}: {e}")
    return result

def engine_ace(url):
    """ACE 는 10건씩 페이지로 나뉨 → 빈 페이지(또는 같은 내용 반복)가 나올 때까지 넘김"""
    result, seen = [], set()
    base = re.sub(r'([?&])page=\d+&?', r'\1', url).rstrip('?&')
    sep = '&' if '?' in base else '?'
    try:
        for page in range(1, 41):
            res = http_get(f"{base}{sep}page={page}", headers={'User-Agent': 'Mozilla/5.0'})
            items = res.json().get('dividendList', []) or []
            fresh = 0
            for item in items:
                rd = format_date(item.get('std_DT'))
                if rd in seen: continue
                seen.add(rd); fresh += 1
                result.append({
                    "recordDate": rd,
                    "payDate": format_date(item.get('dividend_DT')),
                    "dividend": int(item.get('dividend_PRI', 0)),
                    "taxBase": tax_or_none(item.get('tax_PRI'))
                })
            if fresh == 0 or len(items) < 10: break
    except Exception as e: print(f"  [ACE 에러]: {e}"); ERRORS.append(f"ACE {code_or(url)}: {e}")
    return result

def engine_sol(url):
    result = []
    try:
        res = http_get(url, headers={'User-Agent': 'Mozilla/5.0'})
        for item in res.json().get('items', []):
            result.append({
                "recordDate": format_date(item.get('WORK_DT')),
                "payDate": format_date(item.get('DIVIDEND_DT')),
                "dividend": int(item.get('DIVIDEND_PRI', 0)),
                "taxBase": tax_or_none(item.get('WEEK_PRI'))
            })
    except Exception as e: print(f"  [SOL 에러]: {e}"); ERRORS.append(f"SOL {code_or(url)}: {e}")
    return result

def engine_plus(url):
    """ [PLUS · 한화] plusetf.co.kr 분배 API (n=상품ID, 10건씩 페이지, 값은 문자열) """
    result = []
    base = re.sub(r'&page=\d+', '', url)
    try:
        for page in range(0, 60):
            body = http_get(f"{base}&page={page}", timeout=30, headers=UA_HDR).json()
            for item in body.get('content', []) or []:
                div = tax_or_none(item.get('dividend'))
                if not div: continue
                result.append({
                    "recordDate": format_date(item.get('wkdate')),
                    "payDate": format_date(item.get('dkdate')),
                    "dividend": div,
                    "taxBase": tax_or_none(item.get('taxBase'))
                })
            if body.get('last', True) or page + 1 >= int(body.get('totalPages') or 0): break
        if not result: raise ValueError("분배 내역 0건")
    except Exception as e: print(f"  [PLUS 에러]: {e}"); ERRORS.append(f"PLUS {code_or(url)}: {e}")
    return result

# ==========================================
# 🧭 3. 새 커버드콜 ETF 자동 등록 (PC 실행 때만 · 한국 IP 필요)
#    네이버 ETF 전체 목록에서 이름에 '커버드콜'이 들어간 종목 → 관리코드에 없으면
#    운용사 상품 목록에서 배당 주소를 찾아 등록. 확인 방법은 2026-11-09 동진님 PC 에서 시험한 그대로
# ==========================================
NAVER_ETF_LIST = "https://finance.naver.com/api/sise/etfItemList.nhn"

def naver_covered_calls():
    res = http_get(NAVER_ETF_LIST, timeout=30, headers=UA_HDR)
    data = json.loads(res.content.decode('euc-kr', errors='replace'))
    items = data['result']['etfItemList']
    if len(items) < 300: raise ValueError(f"ETF 목록이 너무 적음 ({len(items)}개)")
    return [(str(it['itemname']).strip(), str(it['itemcode']).strip().upper())
            for it in items if '커버드콜' in str(it.get('itemname', ''))]

def ids_kodex():
    m = {}
    for page in range(1, 40):
        lst = http_get(f"https://m.samsungfund.com/api/v1/kodex/product.do?srchTerm=w&ordrSort=DESC&ordrColm=NAV&pageNo={page}", headers=UA_HDR).json()
        if not lst: break
        before = len(m)
        for it in lst:
            if it.get('stkTicker') and it.get('fId'): m[str(it['stkTicker']).upper()] = it['fId']
        if len(m) == before: break
    return {c: f"https://m.samsungfund.com/api/v1/kodex/divid-info.do?id={i}" for c, i in m.items()}

def ids_rise(names_wanted):
    """overview 에는 종목코드가 없어서, 이름이 커버드콜인 상품만 view 로 종목코드 확인"""
    out = {}
    ov = http_get("https://kbam.co.kr/api/products/etfs/overview", timeout=30, headers=UA_HDR).json()
    prods = [p for t in ov.get('tabs', []) for g in t.get('groups', []) for p in g.get('products', [])]
    for p in prods:
        if '커버드콜' not in str(p.get('name', '')) or not p.get('fund_cd'): continue
        v = http_get(f"https://kbam.co.kr/api/products/etfs/{p['fund_cd']}/view", timeout=30, headers=UA_HDR).json()
        krx = str(v.get('krx_cd') or (v.get('data') or {}).get('krx_cd') or '').upper()
        if krx: out[krx] = f"https://kbam.co.kr/api/products/etfs/{p['fund_cd']}/dividend"
    return out

def id_ace(code):
    url = ("https://papi.aceetf.co.kr/api/funds?fundAreaCode=&fundType=&isAceEtfPlus=false&page=1&pensionType="
           f"&searchValue={code}&size=10&sort=WK1_ERN_RT_DESC&themeType=")
    for it in http_get(url, headers=UA_HDR).json().get('data', []) or []:
        if str(it.get('stockCd', ''))[3:9].upper() == code and it.get('fundCd'):
            return f"https://papi.aceetf.co.kr/api/funds/{it['fundCd']}/dividend?page=1"
    return ""

def ids_sol():
    html = http_get("https://www.soletf.com/ko/fund", timeout=30, headers=UA_HDR).text
    links = [(m.group(1), m.start()) for m in re.finditer(r'/ko/fund/etf/(\d+)', html)]
    out = {}
    for i, (fid, pos) in enumerate(links):
        end = links[i + 1][1] if i + 1 < len(links) else pos + 800
        c = re.search(r'\(([0-9][0-9A-Z]{5})\)', html[pos:end])
        if c and c.group(1) not in out: out[c.group(1)] = f"https://www.soletf.com/api/etf/pds/dividend/{fid}"
    return out

def ids_plus():
    out = {}
    for ft in ("LEADER", "DIVID", "SECT_THM", "SBETA", "BOND", "ALLOC_MIX", "LEVER"):
        for opt in ("DOMESTIC", "FOREIGN", ""):
            for page in range(0, 30):
                body = {"searchSortTy": "fn1m", "searchSort": "DESC", "page": page, "fundType": ft, "productOption": opt}
                r = requests.post("https://www.plusetf.co.kr/api/v1/product/find/list", json=body, timeout=20, headers=UA_HDR)
                if r.status_code != 200: break
                j = r.json()
                for it in j.get('content', []) or []:
                    if it.get('nameCode') and it.get('id'):
                        out[str(it['nameCode']).upper()] = f"https://www.plusetf.co.kr/api/v1/product/dividend/list?n={it['id']}"
                if j.get('last', True): break
    return out

def resolve_url(issuer, code, cache):
    """운용사 배당 주소 (TIGER·KIWOOM 은 종목코드로 바로 조회돼서 주소 필요 없음)"""
    if issuer in ("TIGER", "KIWOOM"): return ""
    if issuer == "ACE": return id_ace(code)
    if issuer not in cache:
        loader = {"KODEX": ids_kodex, "RISE": lambda: ids_rise(None), "SOL": ids_sol, "PLUS": ids_plus}[issuer]
        try: cache[issuer] = loader()
        except Exception as e:
            print(f"  ⚠️ {issuer} 상품 목록 조회 실패: {redact(e)}"); cache[issuer] = {}
    return cache[issuer].get(code, "")

def register(etf_name, code, url):
    payload = {"token": WEBHOOK_TOKEN, "action": "register", "etfName": etf_name, "code": code, "url": url}
    r = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=60)
    try: return r.json().get("status")
    except ValueError: return None

def discover_new(rows):
    """rows: [(이름, 코드, 주소)] 관리코드 목록. 새로 등록한 줄과 주소를 채운 줄을 반영해 돌려줌"""
    print("🧭 상장 커버드콜 ETF 전체 확인 중 (네이버 ETF 목록)")
    try:
        market = naver_covered_calls()
    except Exception as e:
        print(f"  [목록 에러]: {redact(e)}"); ERRORS.append(f"커버드콜 목록(네이버): {redact(e)}")
        return rows
    by_code = {c: i for i, (_, c, _) in enumerate(rows)}
    cache, added, filled, skipped = {}, 0, 0, []
    for name, code in market:
        issuer = issuer_of(name)
        if issuer == "": skipped.append(f"{name}({code}) 수집 방법 없음"); continue
        if code in by_code:
            i = by_code[code]; n0, c0, u0 = rows[i]
            if u0 or issuer in ("TIGER", "KIWOOM"): continue
            url = resolve_url(issuer, code, cache)
            if url and register(n0, code, url) == "updated":
                rows[i] = (n0, c0, url); filled += 1
                print(f"  🔗 주소 채움: {n0} → {url}")
            continue
        url = resolve_url(issuer, code, cache)
        if issuer not in ("TIGER", "KIWOOM") and not url:
            skipped.append(f"{name}({code}) {issuer} 주소 못 찾음"); continue
        st = register(name, code, url)
        if st in ("registered", "exists", "updated"):
            rows.append((name, code, url)); by_code[code] = len(rows) - 1
            if st == "registered": added += 1; print(f"  🆕 관리코드 등록: {name} ({code})")
        else:
            print(f"  ⚠️ 등록 실패: {name} ({code}) 응답={st}")
    print(f"  상장 커버드콜 {len(market)}개 · 새 등록 {added}개 · 주소 채움 {filled}개")
    for x in skipped: print(f"  ℹ️ 건너뜀: {x}")
    return rows

# ==========================================
# 📮 4. 시트 전송 — 한 종목 기록을 한 번에 (웹앱이 예전 버전이면 한 줄씩)
# ==========================================
def send_batch(etf_name, code, records):
    payload = {"token": WEBHOOK_TOKEN, "etfName": etf_name, "code": code, "rows": records}
    for attempt in range(3):
        try:
            res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=120)
            j = res.json()
        except (requests.exceptions.RequestException, ValueError) as e:
            if attempt < 2: print(f"  ⏳ 구글 응답 이상, 재시도 중... ({attempt+1}/3)"); time.sleep(3); continue
            print(f"  ❌ 시트 기록 실패: {redact(e)}"); SEND_FAILS.append(f"{etf_name} 일괄 {redact(e)}"); return True
        if j.get("status") == "unauthorized":
            print("  ❌ 토큰 불일치: GAS 스크립트 속성 WEBHOOK_TOKEN 과 GitHub Secret 이 같은지 확인하세요."); sys.exit(1)
        if j.get("status") == "batch":
            for d in j.get("added", []): print(f"  ✅ 전송 완료: {d}")
            print(f"  ⏭️ 통과 (중복) {j.get('duplicate', 0)}건")
            return True
        if j.get("status") == "error":
            print(f"  ❌ 시트 기록 실패: {j.get('message')}"); SEND_FAILS.append(f"{etf_name} 일괄 {j.get('message')}"); return True
        return False  # 일괄 기록을 모르는 예전 웹앱 → 한 줄씩
    return True

# ==========================================
# 🚀 5. 메인 라우터 
# ==========================================
if __name__ == "__main__":
    print(f"🤖 V19 배당 봇 출동! (실행 위치: {'PC · TIGER·RISE·PLUS + 새 종목 등록' if SCRAPER_MODE == 'local' else 'GitHub'})\n")
    
    df_master = pd.read_csv(CSV_URL, header=None, dtype=str, keep_default_na=False)
    rows = []
    for _, row in df_master.iterrows():
        etf_name = str(row[0]).strip()
        if etf_name in ["종목명", "이름", "nan", ""]: continue
        code = str(row[1]).strip().upper().zfill(6)
        etf_url = str(row[2]).strip() if len(row) > 2 else ""
        if etf_url == "nan": etf_url = ""
        rows.append((etf_name, code, etf_url))

    if SCRAPER_MODE == "local":
        rows = discover_new(rows)
    url_cache = {}

    for etf_name, code, etf_url in rows:
        issuer = issuer_of(etf_name, etf_url)
        if SCRAPER_MODE == "local" and issuer not in PC_ISSUERS:
            continue  # PC 는 TIGER·RISE 만 (나머지는 GitHub 이 매일 처리)
        if SCRAPER_MODE != "local" and issuer in PC_ISSUERS:
            print(f"⏭️ {etf_name}: {issuer} 는 동진님 PC 수집(tools/pc_dividend)이 담당해요 (해외 서버 접속 차단·미확인).")
            continue
        print(f"🔍 [스캔 중] {etf_name} ({code})")
        extracted_data = []
        if issuer in ("RISE", "PLUS") and not etf_url:
            etf_url = resolve_url(issuer, code, url_cache)  # 관리코드 C열이 빈 줄
            if not etf_url:
                print("  ⚠️ 운용사 배당 주소를 못 찾아 건너뜁니다."); ERRORS.append(f"{etf_name}: {issuer} 배당 주소 없음"); continue
        if issuer == "TIGER":
            extracted_data = engine_tiger_direct(code)
        elif issuer == "RISE":
            extracted_data = engine_rise_direct(etf_url)
        elif issuer == "PLUS":
            extracted_data = engine_plus(etf_url)
        elif issuer == "KIWOOM":
            extracted_data = engine_kiwoom(code)
        elif "samsungfund" in etf_url:
            extracted_data = engine_kodex(etf_url)
        elif "aceetf" in etf_url:
            extracted_data = engine_ace(etf_url)
        elif "soletf" in etf_url:
            extracted_data = engine_sol(etf_url)
        else:
            print(f"  ⚠️ 엔진 매칭 실패 또는 URL 누락. 건너뜁니다.")
            continue
            
        if extracted_data:
            extracted_data.reverse()
            extracted_data.sort(key=lambda d: d["recordDate"])
            if send_batch(etf_name, code, extracted_data):
                continue
            for data in extracted_data:
                payload = {
                    "token": WEBHOOK_TOKEN,
                    "etfName": etf_name, "code": code,
                    "recordDate": data["recordDate"], "payDate": data["payDate"],
                    "dividend": data["dividend"], "taxBase": data["taxBase"]
                }
                
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=40)
                        try:
                            res_json = res.json()
                            if res_json.get("status") == "unauthorized":
                                print("  ❌ 토큰 불일치: GAS 스크립트 속성 WEBHOOK_TOKEN 과 GitHub Secret 이 같은지 확인하세요.")
                                sys.exit(1)
                            status = res_json.get("status")
                        except ValueError:
                            status, res_json = None, {}
                        # 예전엔 시트 쪽 오류(status=error)나 JSON 이 아닌 응답도 '전송 완료'로 찍혔음 → 실패로 집계
                        if status == "duplicate":
                            print(f"  ⏭️ 통과 (중복): {data['recordDate']}")
                        elif status == "success":
                            print(f"  ✅ 전송 완료: {data['recordDate']} ({data['dividend']}원)")
                        elif status is None and attempt < max_retries - 1:
                            # 구글 웹앱이 가끔 JSON 대신 오류 화면(HTTP 200/404)을 돌려줌 (10/21 4건) → 잠깐 쉬고 다시
                            print(f"  ⏳ 구글 응답 이상 (HTTP {res.status_code}), 재시도 중... ({attempt+1}/{max_retries})")
                            time.sleep(3)
                            continue
                        else:
                            why = res_json.get("message") or f"HTTP {res.status_code}, JSON 아님"
                            print(f"  ❌ 시트 기록 실패: {data['recordDate']} ({why})")
                            SEND_FAILS.append(f"{etf_name} {data['recordDate']} {why}")
                        break 
                    except requests.exceptions.ReadTimeout:
                        if attempt < max_retries - 1:
                            print(f"  ⏳ 구글 시트 지연, 재시도 중... ({attempt+1}/{max_retries})")
                            time.sleep(2)
                        else:
                            print(f"  ❌ 웹훅 전송 실패 (최종 타임아웃): {data['recordDate']}")
                            SEND_FAILS.append(f"{etf_name} {data['recordDate']} 타임아웃")
                    except Exception as e:
                        print(f"  ❌ 웹훅 통신 에러: {redact(e)}")
                        SEND_FAILS.append(f"{etf_name} {data['recordDate']} {redact(e)}")
                        break
                        
                time.sleep(0.5)
        else:
            print("  ⚠️️ 배당 데이터가 없습니다.")
            
    summary = [f"운용사 수집 오류 {len(ERRORS)}건 · 시트 기록 실패 {len(SEND_FAILS)}건"]
    summary += [f"- ⚠️ {x}" for x in ERRORS + SEND_FAILS]
    if INSECURE:
        summary.append("- ℹ️ 인증서 문제로 검증 없이 받은 사이트: " + ", ".join(sorted(INSECURE)))
    print("\n" + "\n".join(summary))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("\n".join(summary) + "\n")
    if ERRORS or SEND_FAILS:
        print("❌ 일부 수집·기록이 실패했어요 (위 목록). 다음 실행 때 빠진 기록은 다시 채워져요.")
        sys.exit(1)
    print("\n🎉 모든 종목 크롤링 및 시트 자동 업데이트 완료!")
