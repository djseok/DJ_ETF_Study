import pandas as pd
import requests
from bs4 import BeautifulSoup
import json
import time

# 1. 동진님의 마스터 시트 CSV 명단
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code):
    """네이버 금융을 스크래핑하여 실제 최근 배당금과 기준일을 추출합니다."""
    url = f"https://finance.naver.com/item/main.naver?code={code}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        res = requests.get(url, headers=headers)
        # Pandas의 read_html을 사용해 네이버 화면의 모든 표를 긁어옵니다.
        tables = pd.read_html(res.text, encoding='euc-kr')
        
        div_table = None
        for tbl in tables:
            # 표 내용 중 '주당분배금'이나 '분배기준일' 단어가 있으면 배당금 표로 인식!
            if '주당분배금' in tbl.to_string() or '분배기준일' in tbl.to_string():
                div_table = tbl
                break
                
        if div_table is not None and not div_table.empty:
            # 가장 윗줄(최근 공시) 데이터 추출
            recent_div = div_table.iloc[0] 
            
            # 표의 구조에 따라 컬럼명이 다를 수 있으므로 인덱스(순서)로 접근
            record_date = str(recent_div.iloc[0]).replace(".", "-") # 예: 2026.09.15 -> 2026-09-15
            div_amount = int(recent_div.iloc[1]) # 주당 분배금
            
            # 실지급일은 보통 기준일 +2영업일이므로 임시로 동일하게 세팅 (수기 조정 필요)
            pay_date = record_date 
            
            # 🚨 중요: 네이버 금융은 '과세표준액'을 제공하지 않습니다! 
            # 일단 분배금과 동일하게 세팅하여 전송합니다.
            tax_base = div_amount 
            
            return record_date, pay_date, div_amount, tax_base
    except Exception as e:
        print(f"[{code}] 크롤링 실패: {e}")
        
    return None, None, None, None

def send_to_google_sheet(etf_name, code, record_date, pay_date, div_amount, tax_base):
    """구글 시트 문지기에게 긁어온 진짜 데이터를 쏘는 함수"""
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
    df = pd.read_csv(CSV_URL, header=None)
    for index, row in df.iterrows():
        etf_name = str(row[0]).strip()
        code = str(row[1]).strip()
        if etf_name == "종목명" or etf_name == "이름": continue
            
        if len(code) > 0 and code != "nan":
            code = code.zfill(6) 
            print(f"🔍 [{etf_name}] 네이버 금융 데이터 수집 중...")
            
            # 진짜 데이터를 긁어옵니다!
            rec_date, pay_date, div, tax = get_real_dividend(code)
            
            if div is not None:
                send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
            else:
                print(f"⚠️ [{etf_name}] 배당금 표를 찾지 못해 패스합니다.")
            
            time.sleep(3) # 구글 서버 과부하 방지 3초 휴식
