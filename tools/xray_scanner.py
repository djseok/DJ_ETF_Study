import requests
import json
import pandas as pd

def xray_tiger_api(code, name):
    """미래에셋(TIGER) 공식 API를 찔러 날것의 데이터를 해부합니다."""
    print(f"\n{'='*50}\n🔍 [X-Ray 탐지] {name} ({code}) - TIGER 서버\n{'='*50}")
    url = "https://investments.miraeasset.com/tigeretf/ko/distribution/overall/list.do"
    headers = {'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest'}
    payload = {'ksCode': code, 'pageIndex': 1, 'pageSize': 2}
    
    try:
        res = requests.post(url, headers=headers, data=payload, timeout=10)
        data = res.json()
        
        # 날것의 JSON 데이터를 예쁘게 정렬하여 로그에 출력 (구조 파악용)
        raw_json_str = json.dumps(data.get('resultList', []), indent=2, ensure_ascii=False)
        print(f"📦 [서버 응답 원본 (JSON)]:\n{raw_json_str}\n")
        
        # 우리가 짚은 이름표가 맞는지 테스트 출력
        if data.get('resultList'):
            item = data['resultList'][0]
            print(f"🎯 [타겟 추출 테스트]:")
            print(f" - 배당기준일: {item.get('recordDate')} (키값: recordDate)")
            print(f" - 실지급배당금: {item.get('dividendAmt')}원 (키값: dividendAmt)")
            print(f" - 과세표준액: {item.get('taxStandardAmt')}원 (키값: taxStandardAmt)")
        else:
            print("⚠️ 데이터가 비어있습니다. 코드를 확인하세요.")
            
    except Exception as e:
        print(f"❌ 통신 에러: {e}")

def xray_html_table(url, name):
    """RISE, ACE 등 웹페이지 표(Table)로 공시하는 운용사의 뼈대를 해부합니다."""
    print(f"\n{'='*50}\n🔍 [X-Ray 탐지] {name} - HTML 렌더링 서버\n{'='*50}")
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        res = requests.get(url, headers=headers, timeout=10)
        # pandas를 이용해 웹페이지 안의 모든 표(Table)를 긁어옵니다.
        tables = pd.read_html(res.text)
        
        if tables:
            print(f"📦 [발견된 표 개수]: {len(tables)}개")
            # 보통 첫 번째나 두 번째 표가 배당금 표입니다. (미리보기 출력)
            print(f"📊 [첫 번째 표 데이터 미리보기]:\n{tables[0].head(3)}\n")
        else:
            print("⚠️ 웹페이지에서 표(Table) 태그를 찾지 못했습니다. 숨겨진 API(JSON) 통신이 필요합니다.")
            
    except Exception as e:
        print(f"❌ 크롤링 에러: {e}")

if __name__ == "__main__":
    print("🤖 V15 안전 모드(Dry-Run) X-Ray 스캐너 가동 시작...")
    
    # 1. TIGER API 테스트 (JSON 키값 검증)
    xray_tiger_api("463810", "TIGER 미국배당+7%프리미엄다우존스")
    
    # 2. RISE 웹 렌더링 테스트 (이미지에서 확인하신 RISE 밸류업 등)
    # F12로 찾으셨던 RISE 해당 종목의 상세 페이지 URL을 찌릅니다.
    xray_html_table("https://riseetf.co.kr/prod/finderDetail/44J2", "RISE 코리아밸류업(테스트)")
    
    # 3. KODEX 웹 렌더링 테스트
    xray_html_table("https://www.samsungfund.com/etf/product/view.do?id=2ETF60", "KODEX 미국배당다우존스(테스트)")
    
    print("\n✅ X-Ray 스캔 완료! 구글 시트로는 아무 데이터도 전송하지 않았습니다.")
