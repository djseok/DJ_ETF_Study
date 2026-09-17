import pandas as pd
import requests
import json
import time
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def setup_driver():
    """자동화 꼬리표를 제거한 스텔스(Stealth) 가상 브라우저"""
    print("🤖 [우회 모듈] 안티-봇 회피 스텔스 브라우저 로딩 중...")
    options = uc.ChromeOptions()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--window-size=1920,1080')
    
    # 일반 webdriver 대신 undetected_chromedriver 사용
    driver = uc.Chrome(options=options)
    driver.implicitly_wait(5)
    return driver

def get_dividend_with_selenium(driver, code):
    url = f"https://m.stock.naver.com/api/stock/{code}/dividend"
    try:
        driver.get(url)
        time.sleep(3) # 캡차 우회를 위해 사람처럼 여유롭게 대기
        
        body_text = driver.find_element(By.TAG_NAME, "body").text
        data = json.loads(body_text)
        
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
        print(f"[{code}] 캡차 방어막 감지: 스텔스 모드로도 IP가 차단되었습니다.")
    except Exception as e:
        print(f"[{code}] 크롤링 에러: {e}")
        
    return None, None, None, None

def send_to_google_sheet(etf_name, code, record_date, pay_date, div_amount, tax_base):
    payload = {
        "etfName": etf_name, "code": code,
        "recordDate": record_date, "payDate": pay_date,
        "dividend": div_amount, "taxBase": tax_base
    }
    try:
        res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=15)
        print(f"✅ 발송 완료 [{etf_name}]: {res.json().get('message')} (배당금: {div_amount}원)")
    except Exception as e:
        print(f"❌ 구글 시트 기록 에러: {e}")

if __name__ == "__main__":
    print("🤖 V14 [학습용] 스텔스 브라우저 침투 시작...")
    driver = None
    try:
        driver = setup_driver()
        df = pd.read_csv(CSV_URL, header=None)
        
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip()
            
            if etf_name in ["종목명", "이름"]: continue
                
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                print(f"🔍 [{etf_name}] 스텔스 모드 진입 중...")
                
                rec_date, pay_date, div, tax = get_dividend_with_selenium(driver, code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당 내역 없음 또는 IP 2차 차단.")
                
                time.sleep(3) 
    except Exception as e:
        print(f"시스템 크리티컬 에러: {e}")
    finally:
        if driver:
            driver.quit()
