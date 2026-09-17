import pandas as pd
import requests
import json
import time

# 1. 마스터 시트 CSV 주소
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
# 2. 구글 시트 웹훅 주소
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code):
    url = f"https://m.stock.naver.com/api/stock/{code}/dividend"
    
    # 🚨 핵심 패치: 네이버 API 서버를 완벽하게 속이는 '진짜 크롬 브라우저' 위장 신분증
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': f'https://m.stock.naver.com/domestic/stock/{code}/dividend',
        'Connection': 'keep-alive'
    }
    
    try:
        # 타임아웃 10초 설정 및 위장 헤더 전송
        res = requests.get(url, headers=headers, timeout=10)
        
        # 🚨 방어 로직: 네이버가 JSON 대신 HTML 방어창을 던졌을 때 에러(Expecting value)가 나지 않도록 우회
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

    except json.JSONDecodeError:
        print(f"[{code}] 봇 차단됨: 네이버가 JSON 데이터 대신 방어창을 보냈습니다.")
    except Exception as e:
        print(f"[{code}] API 호출 에러: {e}")
        
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
    print("🤖 V10 API 다이렉트 크롤링 스캔 시작...")
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
                    print(f"⚠️ [{etf_name}] 배당 내역이 없거나 봇 방어막에 막혔습니다.")
                
                # 네이버의 IP 연속 호출 차단을 막기 위해 2초 딜레이
                time.sleep(2) 
    except Exception as e:
        print(f"시스템 에러: {e}")
