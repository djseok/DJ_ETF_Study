import requests
from bs4 import BeautifulSoup
import json
import time
import datetime

# 🎯 동진님의 구글 시트 Webhook URL (절대 수정 금지!)
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

# 🎯 추적할 ETF 리스트 (종목코드: 시트이름) 
# 동진님이 관리하시는 종목들을 여기에 계속 추가하시면 됩니다!
ETF_LIST = {
    "466920": "RISE 미국AI밸류체인데일리고정커버드콜",
    "449060": "TIGER 미국배당+3%프리미엄다우존스"
}

print(f"🤖 배당금 크롤링 로봇 작동 시작 ({datetime.datetime.now()})")

for code, name in ETF_LIST.items():
    url = f"https://finance.naver.com/item/main.naver?code={code}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        # 1. 네이버 금융 ETF 페이지 스캔
        res = requests.get(url, headers=headers)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        # 2. '분배금 지급기준일'이 있는 표(Table) 찾기
        tables = soup.find_all('table')
        div_table = None
        for tbl in tables:
            if '분배금 지급기준일' in tbl.text:
                div_table = tbl
                break
                
        if div_table:
            tbody = div_table.find('tbody')
            if tbody:
                # 3. 표의 맨 윗줄(가장 최신 배당금) 데이터 추출
                first_row = tbody.find('tr')
                cols = first_row.find_all('td')
                
                if len(cols) >= 2:
                    # 날짜 형식 변환 (예: 2024.10.31 -> 2024-10-31)
                    record_date = cols[0].text.strip().replace('.', '-')
                    dividend_str = cols[1].text.strip().replace(',', '')
                    
                    if dividend_str.isdigit():
                        dividend = int(dividend_str)
                        
                        # 4. 구글 시트(GAS)로 발사할 데이터 조립
                        payload = {
                            "etfName": name,
                            "code": code,
                            "recordDate": record_date,
                            "payDate": record_date, # 네이버는 실지급일이 안 나오므로 기준일로 임시 세팅
                            "dividend": dividend,
                            "taxBase": dividend     # 과세표준도 배당금과 동일하게 1차 세팅
                        }
                        
                        # 5. POST 방식으로 구글 시트에 쏘기!
                        response = requests.post(WEBHOOK_URL, json=payload)
                        print(f"✅ [{name}] 전송 결과: {response.text}")
    except Exception as e:
        print(f"❌ [{name}] 크롤링 에러: {e}")
        
    # 네이버 서버 차단 방지를 위해 1종목당 2초씩 휴식
    time.sleep(2)

print("🏁 모든 종목 스캔 완료!")
