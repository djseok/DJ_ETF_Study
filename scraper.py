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
#  - local (동진님 PC, tools/pc_dividend): 한국 IP 로 TIGER·RISE 만 운용사에서 직접 받음
#    (2026-11 확인: 두 운용사 모두 GitHub·구글 서버 접속 차단)
SCRAPER_MODE = os.environ.get("SCRAPER_MODE", "cloud").strip().lower()
PC_ISSUERS = ("TIGER", "RISE")

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
    result = []
    try:
        res = http_get(url, headers={'User-Agent': 'Mozilla/5.0'})
        for item in res.json().get('dividendList', []):
            result.append({
                "recordDate": format_date(item.get('std_DT')),
                "payDate": format_date(item.get('dividend_DT')),
                "dividend": int(item.get('dividend_PRI', 0)),
                "taxBase": tax_or_none(item.get('tax_PRI'))
            })
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

# ==========================================
# 🚀 3. 메인 라우터 
# ==========================================
if __name__ == "__main__":
    print(f"🤖 V18.5 배당 봇 출동! (실행 위치: {'PC · TIGER·RISE' if SCRAPER_MODE == 'local' else 'GitHub'})\n")
    
    df_master = pd.read_csv(CSV_URL, header=None)
    
    for index, row in df_master.iterrows():
        etf_name = str(row[0]).strip()
        code = str(row[1]).strip().zfill(6)
        etf_url = str(row[2]).strip() if len(row) > 2 else ""
        
        if etf_name in ["종목명", "이름", "nan"]: continue
        
        issuer = "TIGER" if "TIGER" in etf_name.upper() else ("RISE" if "kbam" in etf_url else "")
        if SCRAPER_MODE == "local" and issuer not in PC_ISSUERS:
            continue  # PC 는 TIGER·RISE 만 (나머지는 GitHub 이 매일 처리)
        if SCRAPER_MODE != "local" and issuer in PC_ISSUERS:
            print(f"⏭️ {etf_name}: {issuer} 는 해외 서버 접속이 막혀 동진님 PC 수집(tools/pc_dividend)이 담당해요.")
            continue
        print(f"🔍 [스캔 중] {etf_name} ({code})")
        extracted_data = []
        if SCRAPER_MODE == "local":
            extracted_data = engine_tiger_direct(code) if issuer == "TIGER" else engine_rise_direct(etf_url)
        elif "KIWOOM" in etf_name.upper():
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
