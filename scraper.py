import requests
import json
import time
from bs4 import BeautifulSoup
import pandas as pd
from io import StringIO
import urllib3

# 깃허브 보안망 강제 돌파 (SSL 경고 무시)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ==========================================
# 🎯 1. 마스터 세팅
# ==========================================
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbygi1raNqs478YEVPX745hZ5mn5-GaguzIa77VLaz5Mw8Y4DQg6sR9Clo5UaNjt-UOh/exec"

def format_date(d_str):
    d_str = str(d_str).strip().replace(".", "-")
    if len(d_str) == 8 and d_str.isdigit():
        return f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:]}"
    return d_str

# ==========================================
# 📡 2. 운용사별 6대 크롤링 엔진 (5초 타임아웃 방어막 유지)
# ==========================================

def engine_tiger(code):
    url = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/list.do"
    payload = {'ksCode': code, 'pageIndex': 1, 'pageSize': 15}
    result = []
    try:
        res = requests.post(url, headers={'User-Agent': 'Mozilla/5.0'}, data=payload, timeout=5, verify=False)
        for item in res.json().get('resultList', []):
            if int(item.get('dividendAmt', 0)) > 0:
                result.append({
                    "recordDate": format_date(item.get('recordDate')),
                    "payDate": format_date(item.get('paymentDate')),
                    "dividend": int(item.get('dividendAmt')),
                    "taxBase": int(item.get('taxStandardAmt', 0))
                })
    except Exception as e: print(f"  [TIGER 에러]: {e}")
    return result

def engine_kiwoom(code):
    url = f"https://www.kiwoometf.com/service/etf/KO02010200M?gcode={code}"
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5, verify=False)
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
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5, verify=False)
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
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5, verify=False)
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
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5, verify=False)
        for item in res.json().get('dividendList', []):
            result.append({
                "recordDate": format_date(item.get('std_DT')),
                "payDate": format_date(item.get('dividend_DT')),
                "dividend": int(item.get('dividend_PRI', 0)),
                "taxBase": int(item.get('tax_PRI', 0))
            })
    except Exception as e: print(f"  [ACE 에러]: {e}")
    return result

# 💡 [NEW] SOL(신한) 전용 API 추출 엔진 추가
def engine_sol(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5, verify=False)
        for item in res.json().get('items', []):
            result.append({
                "recordDate": format_date(item.get('WORK_DT')),
                "payDate": format_date(item.get('DIVIDEND_DT')),
                "dividend": int(item.get('DIVIDEND_PRI', 0)),
                "taxBase": int(item.get('WEEK_PRI', 0)) # 주당과표로 WEEK_PRI 활용
            })
    except Exception as e: print(f"  [SOL 에러]: {e}")
    return result

# ==========================================
# 🚀 3. 메인 라우터
# ==========================================
if __name__ == "__main__":
    print("🤖 V17 식스팩(6-Engine) 장착 마스터 봇 출동!\n")
    
    df_master = pd.read_csv(CSV_URL, header=None)
    
    for index, row in df_master.iterrows():
        etf_name = str(row[0]).strip()
        code = str(row[1]).strip().zfill(6)
        etf_url = str(row[2]).strip() if len(row) > 2 else ""
        
        if etf_name in ["종목명", "이름", "nan"]: continue
        
        print(f"\n🔍 [스캔 중] {etf_name} ({code})")
        extracted_data = []
        
        # 💡 지능형 라우팅 (SOL 추가)
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
        elif "soletf" in etf_url: # SOL 인식 라우터
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
                try:
                    res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=5)
                    try:
                        res_json = res.json()
                        if res_json.get("status") == "duplicate":
                            print(f"  ⏭️ 통과 (중복): {data['recordDate']}")
                        else:
                            print(f"  ✅ 전송 완료: {data['recordDate']} ({data['dividend']}원)")
                    except:
                        print(f"  ✅ 전송 완료: {data['recordDate']} ({data['dividend']}원)")
                except Exception as e:
                    print(f"  ❌ 웹훅 전송 실패: {e}")
                time.sleep(0.5)
        else:
            print("  ⚠️ 배당 데이터가 없습니다.")
            
    print("\n🎉 모든 종목 크롤링 및 시트 자동 업데이트 완료!")
