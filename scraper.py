import pandas as pd
import requests
import json
import time
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def setup_driver():
    """투명 크롬 브라우저(Headless Chrome)를 깃허브 로봇 뇌 속에 띄웁니다."""
    chrome_options = Options()
    chrome_options.add_argument("--headless") # 화면 없이 백그라운드 실행
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
    
    # 자동으로 깃허브 서버 환경에 맞는 크롬 드라이버를 설치 후 실행
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.implicitly_wait(5)
    return driver

def get_dividend_with_selenium(driver, code):
    """가상 브라우저가 직접 네이버 API 주소로 접속해 방어막을 뚫습니다."""
    url = f"https://m.stock.naver.com/api/stock/{code}/dividend"
    
    try:
        driver.get(url)
        time.sleep(2) # 브라우저가 데이터를 렌더링할 때까지 2초 대기
        
        # 화면에 뜬 JSON 데이터(텍스트)를 그대로 긁어옴
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
        print(f"[{code}] 브라우저 파싱 실패: 네이버 캡차(CAPTCHA) 등 2차 방어막 발생")
    except Exception as e:
        print(f"[{code}] 셀레니움 에러: {e}")
        
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
    print("🤖 V13 셀레니움 가상 브라우저 침투 시작...")
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
                print(f"🔍 [{etf_name}] 가상 브라우저 진입 중...")
                
                rec_date, pay_date, div, tax = get_dividend_with_selenium(driver, code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당 내역 없음 또는 렌더링 실패.")
                
                time.sleep(2) 
    except Exception as e:
        print(f"시스템 크리티컬 에러: {e}")
    finally:
        # 종료 시 메모리 누수 방지를 위해 브라우저 닫기
        if driver:
            driver.quit()
