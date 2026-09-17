import pandas as pd
import requests
import json
import time

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
# 동진님의 구글 앱스 스크립트 웹훅 주소
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code):
    # 🚨 핵심 패치: 네이버로 직접 가지 않고, 동진님의 구글 문지기(GAS)에게 데이터 심부름을 시킵니다!
    url = f"{WEBHOOK_URL}?action=fetch&code={code}"
    
    try:
        res = requests.get(url, timeout=15)
        data = res.json() 
        
        if data.get('isSuccess') and data.get('dividendList'):
            recent_div = data['dividendList'][0] 
            
            record_date = recent_div.get('dividendRecordDate', '').replace(".", "-").strip()
            pay_date = recent_div.get('dividendPayDate', '').replace(".", "-").strip()
            
            if not pay_date or pay_date == "-":
                pay_date = record_date
                
            div_amount = int(recent_div.get('dividendAmount', 0))
            
            if div_amount > 0:
                return record_date, pay_date, div_amount, div_amount

    except Exception as e:
        print(f"[{code}] 구글 프록시 우회 에러: {e}")
        
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
        print(f"❌ 데이터 전송 오류: {e}")

if __name__ == "__main__":
    print("🤖 V11 구글 프록시 우회 크롤링 스캔 시작...")
    try:
        df = pd.read_csv(CSV_URL, header=None)
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip()
            
            if etf_name in ["종목명", "이름"]: continue
                
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                print(f"🔍 [{etf_name}] 구글 프록시를 통한 네이버 데이터 훅킹 중...")
                
                rec_date, pay_date, div, tax = get_real_dividend(code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당 내역이 없거나 아직 공시되지 않았습니다.")
                
                time.sleep(1.5) 
    except Exception as e:
        print(f"시스템 에러: {e}")
