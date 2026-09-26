import requests
import json
import time
from bs4 import BeautifulSoup
import pandas as pd
from io import StringIO
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ==========================================
# 🎯 1. 마스터 세팅
# ==========================================
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?output=csv&gid=712569303"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwL3r2XjiAPLG9smZC43C6NREYFUdslS8_itfL6KcqNguVKXIsVs-838c9Npyw82LJZ/exec"

def format_date(d_str):
    d_str = str(d_str).strip().replace(".", "-")
    if len(d_str) == 8 and d_str.isdigit():
        return f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:]}"
    return d_str

# ==========================================
# 📡 2. 운용사별 6대 크롤링 엔진
# ==========================================

def engine_tiger(code):
    """ [TIGER] 최신 도메인 적용 및 봇 차단 우회 강력 패치 """
    url = "https://www.tigeretf.com/ko/distribution/overall/list.do"
    payload = {'ksCode': code, 'pageIndex': 1, 'pageSize': 15}
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': f'https://www.tigeretf.com/ko/product/search/detail/index.do?ksCode={code}',
        'Origin': 'https://www.tigeretf.com',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
    }
    result = []
    try:
        res = requests.post(url, headers=headers, data=payload, timeout=15, verify=False)
        # 정상 응답(200)일 때만 JSON 변환을 시도하여 에러 원천 차단
        if res.status_code == 200:
            try:
                for item in res.json().get('resultList', []):
                    if int(item.get('dividendAmt', 0)) > 0:
                        result.append({
                            "recordDate": format_date(item.get('recordDate')),
                            "payDate": format_date(item.get('paymentDate')),
                            "dividend": int(item.get('dividendAmt')),
                            "taxBase": int(item.get('taxStandardAmt', 0))
                        })
            except:
                print("  [TIGER 해독 실패]: 서버가 데이터 대신 보안 페이지를 반환했습니다.")
        else:
            print(f"  [TIGER 접속 차단]: 미래에셋 서버 상태 코드 {res.status_code}")
    except Exception as e: print(f"  [TIGER 에러]: {e}")
    return result

def engine_kiwoom(code):
    url = f"https://www.kiwoometf.com/service/etf/KO02010200M?gcode={code}"
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20, verify=False)
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
                            "taxBase": int(cols[4].replace('원', '').replace(',', ''))
                        })
                break
    except Exception as e: print(f"  [KIWOOM 에러]: {e}")
    return result

def engine_kodex(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20, verify=False)
        for item in res.json().get('dividList', []):
            result.append({
                "recordDate": format_date(item.get('basicD')),
                "payDate": format_date(item.get('payD')),
                "dividend": int(item.get('dividA', 0)),
                "taxBase": int(item.get('taxDividA', 0))
            })
    except Exception as e: print(f"  [KODEX 에러]: {e}")
    return result

def engine_rise(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20, verify=False)
        for item in res.json().get('history', []):
            result.append({
                "recordDate": str(item.get('base_date')).strip(),
                "payDate": str(item.get('payment_date')).strip(),
                "dividend": int(float(item.get('amount', 0))),
                "taxBase": int(float(item.get('tax_standard_amount', 0)))
            })
    except Exception as e: print(f"  [RISE 에러]: {e}")
    return result

def engine_ace(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20, verify=False)
        for item in res.json().get('dividendList', []):
            result.append({
                "recordDate": format_date(item.get('std_DT')),
                "payDate": format_date(item.get('dividend_DT')),
                "dividend": int(item.get('dividend_PRI', 0)),
                "taxBase": int(item.get('tax_PRI', 0))
            })
    except Exception as e: print(f"  [ACE 에러]: {e}")
    return result

def engine_sol(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=20, verify=False)
        for item in res.json().get('items', []):
            result.append({
                "recordDate": format_date(item.get('WORK_DT')),
                "payDate": format_date(item.get('DIVIDEND_DT')),
                "dividend": int(item.get('DIVIDEND_PRI', 0)),
                "taxBase": int(item.get('WEEK_PRI', 0))
            })
    except Exception as e: print(f"  [SOL 에러]: {e}")
    return result

# ==========================================
# 🚀 3. 메인 라우터 (재시도 로직 유지)
# ==========================================
if __name__ == "__main__":
    print("🤖 V18.3 TIGER 우회 및 타임아웃 방어막 봇 출동!\n")
    
    df_master = pd.read_csv(CSV_URL, header=None)
    
    for index, row in df_master.iterrows():
        etf_name = str(row[0]).strip()
        code = str(row[1]).strip().zfill(6)
        etf_url = str(row[2]).strip() if len(row) > 2 else ""
        
        if etf_name in ["종목명", "이름", "nan"]: continue
        
        print(f"🔍 [스캔 중] {etf_name} ({code})")
        extracted_data = []
        
        if "TIGER" in etf_name.upper():
            extracted_data = engine_tiger(code)
        elif "KIWOOM" in etf_name.upper():
            extracted_data = engine_kiwoom(code)
        elif "samsungfund" in etf_url:
            extracted_data = engine_kodex(etf_url)
        elif "kbam" in etf_url:
            extracted_data = engine_rise(etf_url)
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
                            if res_json.get("status") == "duplicate":
                                print(f"  ⏭️ 통과 (중복): {data['recordDate']}")
                            else:
                                print(f"  ✅ 전송 완료: {data['recordDate']} ({data['dividend']}원)")
                        except:
                            print(f"  ✅ 전송 완료: {data['recordDate']} ({data['dividend']}원)")
                        break 
                    except requests.exceptions.ReadTimeout:
                        if attempt < max_retries - 1:
                            print(f"  ⏳ 구글 시트 지연, 재시도 중... ({attempt+1}/{max_retries})")
                            time.sleep(2)
                        else:
                            print(f"  ❌ 웹훅 전송 실패 (최종 타임아웃): {data['recordDate']}")
                    except Exception as e:
                        print(f"  ❌ 웹훅 통신 에러: {e}")
                        break
                        
                time.sleep(0.5)
        else:
            print("  ⚠️ 배당 데이터가 없습니다.")
            
    print("\n🎉 모든 종목 크롤링 및 시트 자동 업데이트 완료!")
