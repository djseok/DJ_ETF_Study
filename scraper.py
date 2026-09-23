import requests
import json
import time
from bs4 import BeautifulSoup
import pandas as pd
from io import StringIO

# ==========================================
# 🎯 1. 마스터 세팅 (CSV 및 웹훅 주소)
# ==========================================
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwL3r2XjiAPLG9smZC43C6NREYFUdslS8_itfL6KcqNguVKXIsVs-838c9Npyw82LJZ/exec"

def format_date(d_str):
    """ '20260915' 같은 숫자를 '2026-09-15'로 예쁘게 바꿔주는 변환기 """
    d_str = str(d_str).strip().replace(".", "-")
    if len(d_str) == 8 and d_str.isdigit():
        return f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:]}"
    return d_str

# ==========================================
# 📡 2. 운용사별 5대 크롤링 엔진 (라이브러리 충돌 완전 제거)
# ==========================================

def engine_tiger(code):
    url = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/list.do"
    payload = {'ksCode': code, 'pageIndex': 1, 'pageSize': 15}
    result = []
    try:
        res = requests.post(url, headers={'User-Agent': 'Mozilla/5.0'}, data=payload, timeout=10)
        for item in res.json().get('resultList', []):
            if int(item.get('dividendAmt', 0)) > 0:
                result.append({
                    "recordDate": format_date(item.get('recordDate')),
                    "payDate": format_date(item.get('paymentDate')),
                    "dividend": int(item.get('dividendAmt')),
                    "taxBase": int(item.get('taxStandardAmt', 0))
                })
    except Exception as e: print(f" TIGER 에러: {e}")
    return result

def engine_kiwoom(code):
    """ [KIWOOM] 뷰티풀숩(BS4)을 활용한 안전한 HTML 추출 """
    url = f"https://www.kiwoometf.com/service/etf/KO02010200M?gcode={code}"
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        soup = BeautifulSoup(res.text, 'html.parser')
        tables = soup.find_all('table')
        
        for table in tables:
            headers = [th.text.replace(' ', '') for th in table.find_all('th')]
            if '주당분배금' in headers:
                rows = table.find_all('tr')
                for row in rows[1:]: # 헤더 제외
                    cols = [td.text.strip() for td in row.find_all('td')]
                    if len(cols) >= 5:
                        result.append({
                            "recordDate": format_date(cols[0]),
                            "payDate": format_date(cols[1]),
                            "dividend": int(cols[2].replace(',', '')),
                            "taxBase": int(cols[4].replace('원', '').replace(',', ''))
                        })
                break
    except Exception as e: print(f" KIWOOM 에러: {e}")
    return result

def engine_kodex(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        for item in res.json().get('dividList', []):
            result.append({
                "recordDate": format_date(item.get('basicD')),
                "payDate": format_date(item.get('payD')),
                "dividend": int(item.get('dividA', 0)),
                "taxBase": int(item.get('taxDividA', 0))
            })
    except Exception as e: print(f" KODEX 에러: {e}")
    return result

def engine_rise(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        for item in res.json().get('history', []):
            result.append({
                "recordDate": str(item.get('base_date')).strip(),
                "payDate": str(item.get('payment_date')).strip(),
                "dividend": int(float(item.get('amount', 0))),
                "taxBase": int(float(item.get('tax_standard_amount', 0)))
            })
    except Exception as e: print(f" RISE 에러: {e}")
    return result

def engine_ace(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        for item in res.json().get('dividendList', []):
            result.append({
                "recordDate": format_date(item.get('std_DT')),
                "payDate": format_date(item.get('dividend_DT')),
                "dividend": int(item.get('dividend_PRI', 0)),
                "taxBase": int(item.get('tax_PRI', 0))
            })
    except Exception as e: print(f" ACE 에러: {e}")
    return result

# ==========================================
# 🚀 3. 메인 라우터 (시트 순회 및 전송)
# ==========================================
if __name__ == "__main__":
    print("🤖 V16 최종 마스터 라우터 봇 출동!\n")
    
    # 구글 마스터 시트(CSV) 읽기
    df_master = pd.read_csv(CSV_URL, header=None)
    
    for index, row in df_master.iterrows():
        etf_name = str(row[0]).strip()
        code = str(row[1]).strip().zfill(6)
        etf_url = str(row[2]).strip() if len(row) > 2 else ""
        
        if etf_name in ["종목명", "이름", "nan"]: continue
        
        print(f"🔍 [스캔 중] {etf_name} ({code})")
        extracted_data = []
        
        # 💡 지능형 라우팅
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
        else:
            print(f"  ⚠️ 엔진 매칭 실패 또는 URL 누락. 건너뜁니다.")
            continue
            
        # 데이터가 존재하면 구글 시트로 발송
        if extracted_data:
            extracted_data.reverse() # 과거 순부터 시트 위에 차곡차곡 쌓기 위함
            
            for data in extracted_data:
                payload = {
                    "etfName": etf_name, "code": code,
                    "recordDate": data["recordDate"], "payDate": data["payDate"],
                    "dividend": data["dividend"], "taxBase": data["taxBase"]
                }
                try:
                    res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=10)
                    
                    try:
                        res_json = res.json()
                        if res_json.get("status") == "duplicate":
                            print(f"  ⏭️ 통과 (중복): {data['recordDate']} 데이터는 이미 시트에 있습니다.")
                        else:
                            print(f"  ✅ 전송 완료: {data['recordDate']} ({data['dividend']}원)")
                    except:
                        print(f"  ✅ 전송 완료: {data['recordDate']} ({data['dividend']}원)")
                        
                except Exception as e:
                    print(f"  ❌ 전송 실패: {e}")
                time.sleep(1) # 구글 GAS 서버 보호를 위한 1초 대기
        else:
            print("  ⚠️ 배당 데이터가 없습니다.")
            
    print("\n🎉 모든 종목 크롤링 및 시트 자동 업데이트가 완료되었습니다!")
