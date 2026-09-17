import pandas as pd
import requests
import json
import time

# 1. 마스터 시트 CSV 주소
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
# 2. 구글 시트 웹훅 주소
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code):
    # 🚨 핵심 패치: 껍데기(웹페이지)가 아니라 알맹이(API)만 쏙 빼오는 비밀 주소!
    url = f"https://m.stock.naver.com/api/stock/{code}/dividend"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        res = requests.get(url, headers=headers)
        data = res.json() # 데이터를 JSON(딕셔너리) 형태로 즉시 해독
        
        # 네이버 API가 정상적으로 배당 내역(dividendList)을 보내주었다면
        if data.get('isSuccess') and data.get('dividendList'):
            recent_div = data['dividendList'][0] # 가장 첫 번째(최근) 배당 내역 추출
            
            # API 키 값을 통해 정확한 숫자와 날짜 추출
            record_date = recent_div.get('dividendRecordDate', '').replace(".", "-").strip()
            pay_date = recent_div.get('dividendPayDate', '').replace(".", "-").strip()
            
            # 실지급일이 공란이거나 '-' 처리되어 있으면 기준일로 대체
            if not pay_date or pay_date == "-":
                pay_date = record_date
                
            div_amount = int(recent_div.get('dividendAmount', 0))
            
            # 주당 과세표준액은 네이버에서 미제공하므로 배당금과 1:1 세팅
            if div_amount > 0:
                return record_date, pay_date, div_amount, div_amount

    except Exception as e:
        print(f"[{code}] API 파싱 에러: {e}")
        
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
    print("🤖 API 다이렉트 크롤링 모드 스캔 시작...")
    try:
        df = pd.read_csv(CSV_URL, header=None)
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip()
            
            if etf_name in ["종목명", "이름"]: 
                continue
                
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                print(f"🔍 [{etf_name}] 네이버 API 데이터 훅킹 중...")
                
                rec_date, pay_date, div, tax = get_real_dividend(code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당금 내역이 존재하지 않아 패스합니다.")
                
                time.sleep(1.5) # API는 가벼워서 1.5초 휴식으로 단축!
    except Exception as e:
        print(f"시스템 에러: {e}")
