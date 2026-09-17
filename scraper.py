import pandas as pd
import requests
import json
import time
import io  # 🚨 추가: 최신 pandas 경고(StringIO) 해결용

# 1. 마스터 시트 CSV 명단
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
# 2. 구글 시트 웹훅 주소
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code):
    url = f"https://finance.naver.com/item/main.naver?code={code}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        res = requests.get(url, headers=headers)
        # 🚨 핵심 패치: res.text를 io.StringIO() 상자에 예쁘게 담아서 pandas에게 전달합니다!
        tables = pd.read_html(io.StringIO(res.text), encoding='euc-kr')
        
        div_table = None
        for tbl in tables:
            if '주당분배금' in tbl.to_string() or '분배기준일' in tbl.to_string():
                div_table = tbl
                break
                
        if div_table is not None and not div_table.empty:
            recent_div = div_table.iloc[0] 
            
            record_date = str(recent_div.iloc[0]).replace(".", "-") 
            div_amount = int(recent_div.iloc[1]) 
            pay_date = record_date 
            tax_base = div_amount 
            
            return record_date, pay_date, div_amount, tax_base
    except Exception as e:
        print(f"[{code}] 크롤링 실패: {e}")
        
    return None, None, None, None

def send_to_google_sheet(etf_name, code, record_date, pay_date, div_amount, tax_base):
    payload = {
        "etfName": etf_name, "code": code,
        "recordDate": record_date, "payDate": pay_date,
        "dividend": div_amount, "taxBase": tax_base
    }
    try:
        res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'})
        print(f"✅ 발송 결과 [{etf_name}]: {res.json().get('message')} (배당금: {div_amount}원)")
    except Exception as e:
        print(f"❌ 통신 오류: {e}")

if __name__ == "__main__":
    print("🤖 실전 크롤링 모드 스캔 시작...")
    try:
        df = pd.read_csv(CSV_URL, header=None)
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip()
            
            if etf_name == "종목명" or etf_name == "이름": 
                continue
                
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                print(f"🔍 [{etf_name}] 네이버 금융 데이터 수집 중...")
                
                rec_date, pay_date, div, tax = get_real_dividend(code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당금 표를 찾지 못해 패스합니다.")
                
                time.sleep(3) 
    except Exception as e:
        print(f"시스템 에러: {e}")
