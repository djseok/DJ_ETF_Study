import pandas as pd
import requests
import json
import time
import io

# 1. 마스터 시트 CSV 주소
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
# 2. 구글 시트 웹훅 주소
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def get_real_dividend(code):
    url = f"https://finance.naver.com/item/main.naver?code={code}"
    # 🚨 핵심 패치 1: 네이버가 봇으로 인식하지 못하게 완벽한 데스크탑 PC 크롬 브라우저로 위장!
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://finance.naver.com/',
        'Accept-Language': 'ko-KR,ko;q=0.9'
    }
    
    try:
        res = requests.get(url, headers=headers)
        res.raise_for_status()

        # 🚨 핵심 패치 2: 빨간색 인코딩 경고창 제거 및 정확히 '주당분배금' 글씨가 있는 표만 스마트하게 추출
        tables = pd.read_html(io.StringIO(res.text), match='주당분배금')
        
        if tables:
            df_div = tables[0]
            
            # 네이버 표 구조 변화 방어 로직 (헤더가 첫 줄에 섞인 경우 정리)
            if '주당분배금' not in ''.join(str(c) for c in df_div.columns):
                df_div.columns = df_div.iloc[0]
                df_div = df_div[1:]
                
            recent_div = df_div.iloc[0]
            
            # 신규 상장 등으로 빈칸(-)인 경우 방어
            if pd.isna(recent_div.iloc[0]) or str(recent_div.iloc[1]).strip() == "-":
                return None, None, None, None
            
            # 컬럼 이름 동적 추출 (지급일이 없거나 순서가 바뀌어도 알아서 찾아냅니다)
            rec_col = next((c for c in df_div.columns if '기준일' in str(c)), df_div.columns[0])
            div_col = next((c for c in df_div.columns if '분배금' in str(c)), df_div.columns[-2])
            pay_col = next((c for c in df_div.columns if '지급일' in str(c)), None)
            
            record_date = str(recent_div[rec_col]).replace(".", "-").strip()
            div_text = str(recent_div[div_col]).replace(",", "").strip()
            
            if pay_col and pd.notna(recent_div[pay_col]) and str(recent_div[pay_col]).strip() != "-":
                pay_date = str(recent_div[pay_col]).replace(".", "-").strip()
            else:
                pay_date = record_date
                
            if div_text.isdigit():
                div_amount = int(div_text)
                return record_date, pay_date, div_amount, div_amount

    except ValueError:
        print(f"[{code}] 표 찾기 실패 (신규 상장으로 아직 배당 내역이 없거나 데이터가 비어있습니다.)")
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
                    print(f"⚠️ [{etf_name}] 배당금 내역이 존재하지 않아 패스합니다.")
                
                time.sleep(2) 
    except Exception as e:
        print(f"시스템 에러: {e}")
