import pandas as pd
import requests
import json
import time # 구글 시트 과부하 방지용 타이머

# 1. 동진님의 로봇 전용 명단 CSV (반드시 A열: 종목명, B열: 6자리 종목코드)
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"

# 2. 완벽한 구글 시트 문지기 웹훅 주소
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def send_to_google_sheet(etf_name, code):
    """구글 시트 문지기에게 데이터를 쏘는 함수"""
    payload = {
        "etfName": etf_name,
        "code": code,
        "recordDate": "2026-09-16", 
        "payDate": "2026-09-18",
        "dividend": 999,  
        "taxBase": 10
    }
    
    headers = {'Content-Type': 'application/json'}
    try:
        response = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers=headers)
        result = response.json()
        print(f"✅ 발송 결과 [{etf_name}]: {result.get('message')}")
    except Exception as e:
        print(f"❌ 통신 오류: {e}")

if __name__ == "__main__":
    print("🤖 1단계: 동진님의 구글 시트 명단 100% 전체 스캔 시작...")
    try:
        df = pd.read_csv(CSV_URL, header=None)
        
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip()
            
            # 첫 줄이 '종목명' 같은 헤더(제목)면 건너뛰기
            if etf_name == "종목명" or etf_name == "이름":
                continue
                
            # 빈칸이 아닐 경우에만 사격 개시! (자물쇠 해제!)
            if len(code) > 0 and code != "nan":
                code = code.zfill(6) 
                print(f"🚀 타겟 록온! -> {etf_name} ({code}) 발사!")
                
                send_to_google_sheet(etf_name, code)
                
                # 🌟 매우 중요: 구글 시트 문지기가 체하지 않게 1.5초 휴식
                time.sleep(3.5)
                
    except Exception as e:
        print(f"⚠️ CSV 명단 읽기 실패: {e}")
