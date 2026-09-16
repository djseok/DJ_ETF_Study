import pandas as pd
import requests
import json

# 1. 동진님의 마스터 시트 CSV 주소 (로봇이 스캔할 명단)
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"

# 2. 방금 새로 발급받은 완벽한 구글 시트 문지기 웹훅 주소!
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

def send_to_google_sheet(etf_name, code):
    """구글 시트 문지기에게 데이터를 쏘는 함수"""
    payload = {
        "etfName": etf_name,
        "code": code,
        # 시트 생성 및 수식 작동 테스트용 가짜 데이터
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
    print("🤖 1단계: 동진님의 구글 시트 명단 감지 중...")
    try:
        # A열: 이름, B열: 코드 형태로 읽어오기
        df = pd.read_csv(CSV_URL, header=None)
        
        for index, row in df.iterrows():
            etf_name = str(row[0]).strip()
            code = str(row[1]).strip().zfill(6) 
            
            # 🎯 2단계: 테스트 타겟인 '0183V0'을 발견하면 즉시 사격!
            if "0183V0" in code:
                print(f"🎯 타겟 종목 발견! -> {etf_name} ({code})")
                print("🚀 3단계: 구글 시트로 배당금 데이터 발사!")
                send_to_google_sheet(etf_name, code)
                
    except Exception as e:
        print(f"⚠️ CSV 명단 읽기 실패: {e}")
