import pandas as pd
import requests
import json
import time

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code, max_retries=3):
    url = f"{WEBHOOK_URL}?action=fetch&code={code}"
    
    # 🚨 방어막 1: 응답이 없으면 최대 3번까지 재시도
    for attempt in range(max_retries):
        try:
            # 🚨 방어막 2: 타임아웃을 15초에서 30초로 넉넉하게 연장
            res = requests.get(url, timeout=30)
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
            
            # API가 성공적으로 통신했지만 빈 데이터일 경우 반복 안 함
            return None, None, None, None 

        except requests.exceptions.ReadTimeout:
            print(f"[{code}] 구글 서버 지연 (재시도 {attempt+1}/{max_retries})...")
            time.sleep(3) # 지연 시 3초 숨 고르기 후 재요청
        except Exception as e:
            print(f"[{code}] 구글 프록시 통신 에러: {e}")
            break
            
    return None, None, None, None

def send_to_google_sheet(etf_name, code, record_date, pay_date, div_amount, tax_base):
    payload = {
        "etfName": etf_name, "code": code,
        "recordDate": record_date, "payDate": pay_date,
        "dividend": div_amount, "taxBase": tax_base
    }
    
    # 데이터 기록도 3번 재시도 방어막 적용
    for attempt in range(3):
        try:
            res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=30)
            print(f"✅ 발송 결과 [{etf_name}]: {res.json().get('message')} (배당금: {div_amount}원)")
            break
        except requests.exceptions.ReadTimeout:
            print(f"❌ [{etf_name}] 시트 기록 지연 (재시도 {attempt+1}/3)...")
            time.sleep(3)
        except Exception as e:
            print(f"❌ 데이터 전송 오류: {e}")
            break

if __name__ == "__main__":
    print("🤖 V12 구글 프록시 (지연 방어막 탑재) 스캔 시작...")
    try:
        df = pd.read_csv(CSV_URL, header=None)
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip()
            
            if etf_name in ["종목명", "이름"]: continue
                
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                print(f"🔍 [{etf_name}] 구글 프록시 데이터 훅킹 중...")
                
                rec_date, pay_date, div, tax = get_real_dividend(code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당 내역이 없거나 아직 공시되지 않았습니다.")
                
                # 🚨 방어막 3: 구글 서버 과부하 방지를 위해 종목 간 휴식 시간을 3초로 상향
                time.sleep(3) 
    except Exception as e:
        print(f"시스템 에러: {e}")
