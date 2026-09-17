import pandas as pd
import requests
import json
import time

# 1. 마스터 시트 CSV & 웹훅 주소
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

# ==========================================
# 📡 [엔진 1] TIGER 전용 공식 API (과세표준액 100% 수집)
# ==========================================
def get_tiger_dividend(code):
    url = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/list.do"
    headers = {'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'}
    payload = {'ksCode': code, 'pageIndex': 1, 'pageSize': 1}
    
    try:
        res = requests.post(url, headers=headers, data=payload, timeout=10)
        data = res.json()
        dividend_list = data.get('resultList', [])
        
        if dividend_list:
            item = dividend_list[0]
            record_date = item.get('recordDate', '').replace(".", "-").strip()
            div_amount = int(item.get('dividendAmt', 0))
            tax_base = int(item.get('taxStandardAmt', 0)) # 💡 운용사 제공 진짜 과세표준액!
            
            if div_amount > 0:
                return record_date, record_date, div_amount, tax_base
    except Exception as e:
        print(f"[{code}] TIGER API 에러: {e}")
    return None, None, None, None

# ==========================================
# 📡 [엔진 2] 범용 우회 API (KODEX, RISE, ACE 등)
# ==========================================
def get_general_dividend(code):
    # 동진님의 구글 프록시(GAS) 웹훅 주소를 이용한 우회 접속
    url = f"{WEBHOOK_URL}?action=fetch&code={code}"
    try:
        res = requests.get(url, timeout=15)
        data = res.json() 
        
        if data.get('isSuccess') and data.get('dividendList'):
            recent_div = data['dividendList'][0] 
            record_date = recent_div.get('dividendRecordDate', '').replace(".", "-").strip()
            div_amount = int(recent_div.get('dividendAmount', 0))
            
            if div_amount > 0:
                # 네이버는 과세표준액이 없으므로 임시로 배당금과 동일하게 세팅
                return record_date, record_date, div_amount, div_amount
    except Exception as e:
        print(f"[{code}] 범용 API 에러: {e}")
    return None, None, None, None

# ==========================================
# 🧠 [라우터] 종목명에 따라 알아서 길을 찾아가는 공유기
# ==========================================
def route_and_fetch(etf_name, code):
    if "TIGER" in etf_name.upper():
        print(f"🔍 [{etf_name}] TIGER 공식 본진 서버로 침투 중...")
        return get_tiger_dividend(code)
    else:
        print(f"🔍 [{etf_name}] 구글 프록시 우회 터널로 침투 중...")
        return get_general_dividend(code)

def send_to_google_sheet(etf_name, code, record_date, pay_date, div_amount, tax_base):
    payload = {
        "etfName": etf_name, "code": code,
        "recordDate": record_date, "payDate": pay_date,
        "dividend": div_amount, "taxBase": tax_base
    }
    try:
        res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=15)
        print(f"✅ 발송 완료 [{etf_name}]: {res.json().get('message')} (배당금: {div_amount}원 | 과표: {tax_base}원)")
    except Exception as e:
        print(f"❌ 구글 시트 기록 에러: {e}")

if __name__ == "__main__":
    print("🤖 V15 다중 라우터(Multi-Router) 크롤링 시작...")
    try:
        df = pd.read_csv(CSV_URL, header=None)
        
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip()
            
            if etf_name in ["종목명", "이름"]: continue
                
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                
                rec_date, pay_date, div, tax = route_and_fetch(etf_name, code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당 내역 없음.")
                
                time.sleep(1.5) # API 직접 호출이라 휴식 시간을 짧게 가져갑니다.
    except Exception as e:
        print(f"시스템 크리티컬 에러: {e}")
