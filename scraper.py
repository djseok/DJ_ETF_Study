import requests
import pandas as pd
import json
import time
from io import StringIO

# ==========================================
# 🎯 1. 마스터 시트 및 웹훅 주소 세팅
# ==========================================
# (동진님의 실제 마스터 시트 CSV 주소를 넣어주세요)
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=712569303&single=true&output=csv"
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbykj7ueHVVagEItBiS49H6ByqRVWeeNHaDqWR5qsGKNgzFs_qqQx2QEY1rPnT5dVIW9/exec"

# ==========================================
# 📡 2. [엔진 A] TIGER 전용 API 크롤러
# ==========================================
def get_tiger_data(code):
    url = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/list.do"
    headers = {'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'}
    payload = {'ksCode': code, 'pageIndex': 1, 'pageSize': 15} # 최근 15개 배당 내역
    
    result = []
    try:
        res = requests.post(url, headers=headers, data=payload, timeout=10)
        dividend_list = res.json().get('resultList', [])
        
        for item in dividend_list:
            div = item.get('dividendAmt', 0)
            tax = item.get('taxStandardAmt', 0)
            if div > 0:
                result.append({
                    "recordDate": str(item.get('recordDate')).replace(".", "-"),
                    "payDate": str(item.get('paymentDate', item.get('recordDate'))).replace(".", "-"),
                    "dividend": int(div),
                    "taxBase": int(tax)
                })
    except Exception as e:
        print(f"[{code}] TIGER 추출 에러: {e}")
    
    return result # 과거순으로 넣기 위해 역순 반환 준비

# ==========================================
# 📡 3. [엔진 B] RISE / KODEX 범용 HTML 크롤러
# ==========================================
def get_html_data(url):
    result = []
    try:
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        tables = pd.read_html(StringIO(res.text))
        
        target_df = None
        for df in tables:
            df.columns = df.columns.str.replace(' ', '') # 공백 정제 방어막
            if '분배금액(원)' in df.columns:
                target_df = df
                break
                
        if target_df is not None:
            for index, row in target_df.iterrows():
                div = row['분배금액(원)']
                tax = row.get('주당과세표준액(원)', div) # KODEX는 과표가 없을 수 있으므로 기본값 세팅
                
                if pd.notna(div) and pd.notna(tax):
                    result.append({
                        "recordDate": str(row['지급기준일']).strip(),
                        "payDate": str(row.get('실지급일', row['지급기준일'])).strip(),
                        "dividend": int(div),
                        "taxBase": int(tax)
                    })
    except Exception as e:
        print(f"[HTML 추출 에러] {url}: {e}")
        
    return result

# ==========================================
# 🚀 4. 메인 루프 (마스터 시트 순회 및 발송)
# ==========================================
if __name__ == "__main__":
    print("🤖 V15 실전 다중 라우터 봇 출동!")
    
    # 마스터 시트 읽기 (A열: 이름, B열: 코드, C열: 상세URL)
    df_master = pd.read_csv(CSV_URL, header=None)
    
    for index, row in df_master.iterrows():
        etf_name = str(row[0]).strip()
        code = str(row[1]).strip().zfill(6)
        # C열에 URL이 적혀있다고 가정 (없으면 무시)
        etf_url = str(row[2]).strip() if len(row) > 2 else "" 
        
        if etf_name in ["종목명", "이름", "nan"]: continue
        
        print(f"\n🔍 [타겟 온] {etf_name} ({code}) 스캔 중...")
        
        # [공유기 라우팅] TIGER냐 아니냐에 따라 길을 찾아갑니다.
        extracted_data = []
        if "TIGER" in etf_name.upper():
            extracted_data = get_tiger_data(code)
        elif etf_url.startswith("http"):
            extracted_data = get_html_data(etf_url)
        else:
            print(f"⚠️ [{etf_name}] TIGER가 아니며 URL도 없습니다. 스킵합니다.")
            continue
            
        if extracted_data:
            # 💡 오래된 과거 데이터부터 시트 위에 쌓기 위해 순서를 뒤집습니다.
            extracted_data.reverse() 
            
            for data in extracted_data:
                payload = {
                    "etfName": etf_name, "code": code,
                    "recordDate": data["recordDate"], "payDate": data["payDate"],
                    "dividend": data["dividend"], "taxBase": data["taxBase"]
                }
                
                try:
                    res = requests.post(WEBHOOK_URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=10)
                    print(f" ✅ 발송 성공: {data['recordDate']} ({data['dividend']}원)")
                except Exception as e:
                    print(f" ❌ 발송 실패: {e}")
                
                time.sleep(1) # 구글 서버 숨고르기
        else:
            print(f" ⚠️ [{etf_name}] 추출된 배당 데이터가 없습니다.")
            
    print("\n🎉 모든 마스터 시트 종목 크롤링 및 구글 시트 기입 완료!")
