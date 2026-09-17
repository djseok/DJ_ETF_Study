import pandas as pd
import requests
import json
import time
import io

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code):
    url = f"https://finance.naver.com/item/main.naver?code={code}"
    # 완벽한 PC 브라우저 위장 신분증
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'}
    
    try:
        res = requests.get(url, headers=headers)
        tables = pd.read_html(io.StringIO(res.text))
        
        df_div = None
        for tbl in tables:
            # 🚨 핵심 패치: ETF 표의 진짜 이름인 '분배기준일' 또는 '분배금'으로 찾습니다!
            if '분배기준일' in tbl.to_string() or '분배금' in tbl.to_string():
                df_div = tbl
                break
                
        if df_div is not None and not df_div.empty:
            # 헤더(제목)가 데이터 첫 줄에 섞인 경우 정리
            if '분배기준일' not in ''.join(str(c) for c in df_div.columns):
                df_div.columns = df_div.iloc[0]
                df_div = df_div[1:]
                
            recent_div = df_div.iloc[0]
            
            # 신규 상장 등으로 데이터가 없거나 '-' 인 경우 패스
            if pd.isna(recent_div.iloc[1]) or str(recent_div.iloc[1]).strip() == "-":
                return None, None, None, None
            
            # 네이버 금융 표 구조: [0] 분배기준일, [1] 분배금
            record_date = str(recent_div.iloc[0]).replace(".", "-").strip()
            div_text = str(recent_div.iloc[1]).replace(",", "").strip()
            
            if div_text.isdigit():
                div_amount = int(div_text)
                # 과세표준과 실지급일은 임시로 1:1 세팅 (실지급일은 시트에서 수기 보정)
                return record_date, record_date, div_amount, div_amount

    except Exception as e:
        print(f"[{code}] 파싱 에러: {e}")
        
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
            
            if etf_name in ["종목명", "이름"]: 
                continue
                
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                print(f"🔍 [{etf_name}] 네이버 금융 데이터 수집 중...")
                
                rec_date, pay_date, div, tax = get_real_dividend(code)
                
                if div is not None:
                    send_to_google_sheet(etf_name, code, rec_date, pay_date, div, tax)
                else:
                    print(f"⚠️ [{etf_name}] 배당금 내역이 없거나 신규 상장되어 패스합니다.")
                
                time.sleep(2) 
    except Exception as e:
        print(f"시스템 에러: {e}")
