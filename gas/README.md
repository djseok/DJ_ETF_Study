# Apps Script 모음

구글 시트에 붙여서 쓰는 스크립트입니다. 대시보드(GitHub Pages)와는 따로 동작해요.

## 📤 Apps Script 자동 배포 — `deploy.json` + `.github/workflows/gas_deploy.yml`

PR 이 main 에 병합되면 GitHub Actions 가 바뀐 `.gs` 를 Apps Script 편집기에 직접 넣어요 (복사·붙여넣기 대신).
웹 앱(마스터시트 배당 봇 · 자동가져오기)은 기존 배포를 새 버전으로 바꿔서 주소는 그대로예요.

- 어느 파일이 어느 프로젝트인지는 `deploy.json`. 편집기 파일 이름이 다르면 `remote` 로 적어요 (예: `dividend_webhook.gs` → `Code`)
- 편집기에만 있는 파일, `appsscript.json`(권한·시간대·웹 앱 설정)은 건드리지 않아요
- 편집기에 그 이름의 파일이 없거나, 합쳤을 때 같은 함수가 두 번 생기거나, 문법 오류면 올리지 않고 멈춰요
- 트리거·스크립트 속성은 그대로 유지돼요. **새 트리거가 필요한 함수(`install…Trigger`)는 처음 한 번 편집기에서 직접 실행**
- `enabled: false` 인 프로젝트는 점검만 해요. 점검 결과가 맞으면 `true` 로 바꿉니다
- 편집기에만 있던 옛 파일을 저장소로 옮겼으면 `retire` 에 그 이름을 적어요 → 다음 배포 때 편집기에서 지우고, 지우기 전 버전을 만들어 둬서 편집기 **프로젝트 기록**에서 되살릴 수 있어요 (관리시트의 Code·ETF_PDF·ETF_NOW·auto·mdd → `etf_holdings_legacy.gs`·`price_proxy.gs`, ETF_PDF 는 쓰는 곳이 없어 옮기지 않음)
- **Actions → Apps Script 배포 → Run workflow → legacy**: 편집기에만 있는 파일의 함수가 어디서 쓰이는지 점검(로그엔 함수 이름만), 내용은 내 Google Drive 에 백업 파일로
- 배포가 실패하면 카톡으로 한 번 알려요 (`deploy_watch.gs`, 장중 신호 트리거가 30분마다 확인 · 07~23시)

### 처음 한 번 (PC)

1. https://script.google.com/home/usersettings → **Google Apps Script API** 사용 → 켜기
2. Node.js LTS 설치 (nodejs.org) → 터미널(명령 프롬프트)에서 `npm install -g @google/clasp` → `clasp login` → 브라우저에서 허용
3. 홈 폴더의 `.clasprc.json` (Windows `C:\Users\이름\.clasprc.json`, Mac `~/.clasprc.json`) 을 메모장으로 열어 **전체 복사**
   → 저장소 **Settings → Secrets and variables → Actions → New repository secret** 이름 `CLASPRC_JSON` 에 붙여넣기
   (Apps Script 를 고칠 수 있는 열쇠예요. 채팅·코드에 붙여넣지 않기)
4. 각 Apps Script 편집기 **⚙️ 프로젝트 설정 → 스크립트 ID** 를 Secret 으로 등록

   | Secret | 프로젝트 |
   |---|---|
   | `GAS_ID_MANAGE` | 관리시트 |
   | `GAS_ID_DIARY` | 동진ETF공부_개인일기장 (배당 입력 폼) |
   | `GAS_ID_MASTER` | 동진_웹송출용_마스터시트 (배당 봇) |
   | `GAS_ID_UPLOAD` | 자동가져오기 (잔고 캡처) |

5. **Actions → Apps Script 배포 → Run workflow → check** → 결과 화면(Summary)에서 파일마다
   - ✅ 같음 / ✏️ 다름 + "저장소 예전 버전과 같음" → 덮어써도 안전
   - ✏️ 다름 + "⚠️ 저장소 어느 버전과도 다름" → 편집기에서 직접 고친 부분이 있을 수 있어 먼저 저장소에 옮겨야 함
   - 📌 편집기에만 있음 → 그대로 둠 / ❌ → 이름이 다르거나 함수가 겹침
6. 문제가 없으면 `deploy.json` 의 `enabled` 를 `true` 로 → 병합되면 그때부터 자동

`clasp login` 토큰은 비밀번호를 바꾸거나 Google 계정 → 보안 → 서드 파티 액세스에서 clasp 를 지우면 끊겨요. 그러면 2~3번만 다시.

## 💰 배당금 간편 입력 폼 — `dividend_form.gs`

멤버가 휴대폰에서 폼으로 배당 입금을 적으면, 그 멤버의 `○포토폴리오` 탭 H~L열에 자동으로 한 줄이 추가됩니다.
`마스터 포토폴리오` 탭이 멤버 탭을 모아 보여주기 때문에 대시보드 [배당] 탭에 그대로 반영돼요.

### 설치 (처음 한 번, 약 3분)

1. **동진ETF공부_개인일기장** 스프레드시트를 엽니다.
2. 메뉴 **확장 프로그램 → Apps Script**를 누릅니다.
3. 왼쪽 파일 목록의 **+ → 스크립트**로 새 파일을 만들고 이름을 `dividend_form`으로 정합니다.
4. `dividend_form.gs` 내용을 전부 붙여넣고 **저장**(💾)합니다.
5. 위쪽 함수 선택 칸에서 **`createDividendForm`**을 고르고 **실행**을 누릅니다.
6. 권한 요청 창이 뜨면 본인 계정 → **고급 → (안전하지 않은 페이지로) 이동 → 허용**을 누릅니다.
   (본인이 만든 스크립트라 구글이 검증 안 된 앱이라고 경고하는 것이에요)
7. 아래 **실행 로그**에 나오는 **멤버 공유용 링크**를 단톡방에 공유합니다.

### 폼 항목

| 항목 | 설명 |
|---|---|
| 이름 | 시트의 `○포토폴리오` 탭 이름에서 자동으로 만든 목록 |
| 수령일자 | 통장에 입금된 날짜 |
| 종목 | 멤버들이 보유한 종목 목록 (+ 기타) |
| 당시수량 | 비워두면 그 멤버 탭의 현재 보유수량으로 기록 |
| 실수령액 | 평소 적던 방식 그대로 |

### 알아둘 점

- 종목을 새로 샀거나 멤버 탭이 늘면 `refreshFormChoices`를 실행하세요. 매일 새벽 4시에도 자동 갱신돼요.
- 잘못 입력한 기록은 해당 멤버 탭(예: `D포토폴리오`)에서 직접 지우거나 고치면 됩니다.
- **`마스터 포토폴리오` 탭에는 직접 입력하지 마세요.** A1 수식이 멤버 탭을 모아 보여주는 탭이라, 값을 넣으면 전체가 `#REF!`가 됩니다.

## 🔐 배당 봇 Webhook 보안 — `webhook_security.gs`

배당 봇이 데이터를 보내는 Apps Script 주소가 예전에 public 저장소에 올라가 있었어요.
주소만 알면 누구나 시트에 가짜 기록을 넣을 수 있어서, **토큰을 함께 보낸 요청만 받도록** 바꿉니다.

**순서가 중요해요.** GAS에서 검사를 먼저 켜면, 토큰을 안 보내는 옛 봇이 막혀서 그날 배당 기록이 빠져요.

1. **토큰 만들기**: 배당 봇이 기록하는 시트(동진_웹송출용_마스터시트)의 Apps Script를 열고,
   `webhook_security.gs` 파일을 새로 만들어 붙여넣은 뒤 **`setupWebhookToken`만 실행** → 로그의 토큰 복사
2. **GitHub Secrets 등록**: 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - `WEBHOOK_URL` : 지금 쓰는 웹앱 주소 (`https://script.google.com/macros/s/AKfycbyQ65.../exec`)
   - `WEBHOOK_TOKEN` : 1번에서 복사한 토큰
3. **보안 PR 병합** 후 **Actions → Auto Dividend Scraper → Run workflow**로 한 번 실행해서 `✅ 전송 완료`/`⏭️ 통과 (중복)`이 나오는지 확인
   (이 단계까지는 GAS가 토큰을 검사하지 않으니 옛 방식과 똑같이 동작해요)
4. **검사 켜기**: 기존 `doPost` 첫 줄(과 `doGet`의 tiger 처리)에 토큰 확인 한 줄을 추가 → **배포 → 배포 관리 → ✏️ 수정 → 버전: 새 버전 → 배포**
   (새 배포를 만들지 말고 기존 배포를 새 버전으로 바꿔야 주소가 그대로 유지돼요)
5. **Run workflow**로 다시 실행해서 정상인지 확인. `토큰 불일치`가 나오면 1번 토큰과 GitHub Secret 값이 같은지 확인하세요.

## 📥 배당 봇 Webhook 원본 — `dividend_webhook.gs`

동진_웹송출용_마스터시트 Apps Script 의 `Code.gs` 사본이에요 (토큰 검사 포함).

- **TIGER**: 2026-09 미래에셋 사이트 개편으로 `investments.miraeasset.com/tigeretf/ko/distribution/overall/list.ajax`
  에 종목코드(`q`) + 연도·월을 보내야 하고, 결과가 표(HTML)로 와요. 최근 12개월을 한 번에 조회해서 예전 JSON 형식으로 바꿔 봇에 넘겨요.
- TIGER 가 또 안 되면 편집기에서 `testTigerFetch` 를 실행해 보세요. 종목별 건수와 최근 기록이 로그에 나와요.

## 🧩 관리코드 C열 자동 채우기 — `etf_url_autofill.gs`

`관리코드` 탭에 **A열 이름, B열 종목코드만** 적으면 KODEX · RISE · ACE · SOL 의 C열(운용사 배당 API 주소)을 자동으로 채워요.
TIGER · KIWOOM 은 원래 C열이 필요 없어요. 이미 채워진 C열은 덮어쓰지 않아요.

| 운용사 | 목록 출처 | 코드 → 번호 |
|---|---|---|
| KODEX | `m.samsungfund.com/api/v1/kodex/product.do?pageNo=N` | `stkTicker` → `fId` |
| RISE | `kbam.co.kr/api/products/etfs?page=N&page_size=100` | `krx_cd` → `fund_cd` |
| ACE | `papi.aceetf.co.kr/api/funds?size=500` | `stockCd`(ISIN) 가운데 6자리 → `fundCd` |
| SOL | `soletf.com/ko/fund` 목록 페이지 | `종목명 (코드)` 링크 → `/fund/etf/번호` |

- `verifyEtfUrlResolver`: 이미 채워진 줄로 정확도 검증 (시트에 쓰지 않음). 2026-09-30 기준 12/12 일치
- `previewAutoFillEtfUrls`: 채울 내용 미리보기 (시트에 쓰지 않음)
- `autoFillEtfUrls`: 빈 C열 채우기. `installAutoFillTrigger` 로 매일 밤 10시대 자동 실행 (배당 봇은 자정)
- 못 찾은 줄은 C열에 `⚠️ 번호를 못 찾음` 표시 → 다음 날 밤 다시 시도

## 📅 ETF 배당주기 자동 갱신 — `dividend_schedule_sync.gs` (관리시트)

`ETF 배당주기` 종목마다 최근 12개월 지급 기록을 모아 `ETF들 배당이력`(종목명 · 지급일 · 분배금 · 기준일)을 교체하고,
B열 지급월과 D·E열(출처, 최근 지급일)을 갱신해요. C열 수식(평균)은 그대로라 자동으로 "최근 1년 평균"이 돼요.

- 커버드콜: 마스터시트 `DB_` 탭 / 그 밖: 운용사 공식 API(KODEX·RISE·ACE·SOL·TIGER·KIWOOM) / TIME·HANARO 등: 기존 값 유지(수기)
- 기록이 짧아도 지급 간격으로 주기 추정(매월·분기·반기). 1년에 1건뿐인데 기존 값이 여러 번이면 덮어쓰지 않고 `⚠️ 확인 필요`
- 주기가 기록만으로 안 보이는 종목은 D열을 `✅ 지급월 고정`으로 시작하게 적고 B열을 직접 입력 → B열은 그대로, 배당이력만 갱신 (TIGER 증권·K방산&우주: 기준일 1·4·7·10월 말 → 지급월 2,5,8,11)
- `previewDividendSchedule`(미리보기) → `syncDividendSchedule`(갱신) → `installDividendScheduleTrigger`(매일 아침 7시대)

## 💸 실수령 배당 자동 기록 — `dividend_autolog.gs` (배당 입력 폼 프로젝트)

1. 매일 밤 11시대 `snapshotHoldings`: 멤버 탭 보유수량을 `보유수량_기록` 탭에 저장 (바뀐 것만)
2. 매일 아침 8시대 `recordDividendsAuto`: 지급일이 된 분배금을 **기준일 2영업일 전 보유수량 × 1주당 분배금**으로 계산해
   멤버 탭 H~L열에 기록, M열 `자동` (세전 금액, 지금까지 적어온 방식과 같음)

- 같은 종목 기록이 지급일 ±5일 안에 있으면 건너뜀. 폼으로 수기 입력하면 자동 기록을 교체 (M열 `수기(자동 교체)`)
- `AL_SEED_FROM`(2026-09-25) 이전 기준일은 자동 기록하지 않음 → 그 전 기록은 수기 그대로
- 분배금이 자동 수집되지 않는 종목(`ETF 배당주기`에 없거나 TIME·HANARO)은 폼으로 입력
- 검증: D님 8·9월(KODEX 나스닥100커버드콜 83,000 / 76,760원), 7월 RISE 미국S&P500(198원) 실제 기록과 원 단위 일치

## 📦 ETF 보유종목(PDF) 자동 수집 → 예측 엔진 — `etf_holdings_sync.gs` (관리시트)

`MasterData`의 `본체ETF` 줄마다 WiseReport에서 전체 보유종목을 받아 `PDF_자동` 탭에 저장하고, `ETF_Quant_Signals`를 최신 보유종목으로 다시 만들어요.

- 국내주식 ETF는 공시 비중 그대로, 해외주식 ETF(비중 미제공)는 **주식수 × 현재가(원화 환산)**로 비중 계산
- 종목명 → 티커: `매핑테이블` → `MasterData` → 없으면 야후(영문)/네이버(한글) 검색 후 `매핑테이블`에 `자동(야후)`·`자동(네이버)`로 추가
- 새로 편입된 종목은 `MasterData`에 가격 수식과 함께 자동 추가
- `ETF_Quant_Signals`의 **기준·베타는 유지**, 다시 쓰기 전 `ETF_Quant_Signals_백업`에 한 벌 보관
- 현금은 비중만(변동 0), 옵션·선물은 제외
- `previewHoldings`(미리보기) → `syncHoldings`(갱신) → `installHoldingsTrigger`(매일 아침 6시대)
- **새 ETF 추가**: `MasterData` 맨 아래에 A `본체ETF` · B `KRX:코드` · C 이름 · H 대분류(성장/배당) · I 중분류(해외/국내)만 적으면 다음 날 아침 6시에
  D~G 가격 수식 → (H가 `배당`이면) `ETF 배당주기` 등록 → (이름에 `커버드콜` + H `배당`이면) 마스터시트 `관리코드` 등록까지 자동. 이후 7시 배당주기 갱신 · 밤 10시 관리코드 C열 · 자정 배당 봇이 이어받음
- 티커를 못 찾은 종목은 로그에 나옴 → `매핑테이블` A열 종목명, B열 티커 추가 후 다시 실행

대시보드 예측(`js/quant.js`): 가격 없는 종목은 빼고 나머지 비중으로 환산, 환율·나스닥 선물은 **해외 비중만큼만** 반영

## 🌅 개장 전 예상가 카톡 알림 — `premarket_alert.gs` (관리시트, etf_holdings_sync 와 같은 프로젝트)

평일 07:30 `본체ETF` 전부의 예상 등락·예상가·신호를 계산해 `개장전_예측` 탭에 쌓고,
GitHub Actions(`premarket_image.yml` → `tools/render_premarket.py`)가 그린 **이미지 A(막대)·B(표)**를 카카오톡 사진 메시지로 보내요.
이미지가 5분 안에 안 올라오면 글자 메시지로 대신 보내요.

- 공식 (대시보드 `js/quant.js` 와 동일): 예상 = (1 + β × 구성종목 변동) × (1 + β × 선물 마감후 변동 × 미국 비중) × (1 + 환율 변동 × 해외 비중) − 1
- 선물: 이름에 S&P → ES=F, 다우 → YM=F, 나머지 NQ=F. 기준은 미국 정규장 마감(뉴욕 16:00). VIX 는 곱하지 않고 20 이상이면 '변동성 경계' 배지
- `Characteristic` 의 나스닥·S&P·다우 선물 행 전일지수(D)에 매일 05:40 '마감 시점 가격'을 기록 → 대시보드도 같은 기준
- 16:10 실제 시가·종가·오차(예상 − 실제 시가 등락)를 `개장전_예측` 에 기록, 월요일 알림에 지난주 평균 오차·방향 적중률
- 미국 휴장 다음 날은 종목 등락 0 처리 (SPY 마지막 일봉으로 판단)

### 설정 (처음 한 번)
1. **카카오** (developers.kakao.com): 앱 추가 → 플랫폼 Web 도메인 `https://djseok.github.io` → 카카오 로그인 ON, Redirect URI `https://djseok.github.io/DJ_ETF_Study/` → 동의항목 **카카오톡 메시지 전송** 선택 동의
2. **GitHub 토큰**: github.com → Settings → Developer settings → Fine-grained tokens → Generate new token → Repository access: `DJ_ETF_Study` 만 → Permissions: **Contents: Read and write** → 만료 1년
3. **Apps Script → 프로젝트 설정 → 스크립트 속성**: `KAKAO_REST_KEY`, `KAKAO_REDIRECT_URI`, (쓰면) `KAKAO_CLIENT_SECRET`, `GH_DISPATCH_TOKEN`
4. `kakaoAuthUrl` → 동의 후 주소의 `code=` 값을 `KAKAO_AUTH_CODE` 에 (10분 안에) → `kakaoExchangeCode` → `kakaoTest`
5. `previewPremarket`(계산만) → `sendPremarketAlert`(실제 발송) → `installPremarketTrigger`

키·토큰은 스크립트 속성에만 두고 코드·채팅에 붙여넣지 않기. 카카오 리프레시 토큰은 매일 쓰면 자동 연장돼요.

## ⚡ 장중 신호 알림 — `intraday_signal.gs` (관리시트, premarket_alert 와 같은 프로젝트)

평일 09:05~15:25, 10분마다 '본체ETF'의 실제 등락(현재가 ÷ 전일 종가)이 `ETF_Quant_Signals` 기준(매수 % 이하 / 매도 % 이상)을 처음 넘으면 카톡으로 알리고 `장중_신호` 탭에 기록합니다.
- 같은 날 같은 ETF·같은 방향은 1번. 기준에서 1%p 더 벌어지면 '추가 하락/상승'으로 1번 더
- 가격: 야후 → 네이버 실시간 → MasterData D·E
- 설치: `previewIntraday`(로그만) → `installIntradayTrigger` · 끄기: `removeIntradayTrigger`

## 📅 주간 리포트 — `weekly_report.gs` (관리시트, 같은 프로젝트)

매주 금요일 17:10 카톡 이미지 1장: 관리 ETF 주간 등락 · 코스피/나스닥/원달러 · 멤버 평가액·수익률(지난주 대비)·이번 주 배당 · 다음 주 예정 배당 · 07:30 예측 오차 · 장중 신호.
- 멤버 데이터는 개인일기장 `마스터 포토폴리오` 를 **읽기만** 합니다
- 이미지: GitHub Actions `premarket_image.yml` (weekly-image) → `tools/render_weekly.py` → `alerts/{날짜}_W.png`
- 설치: `previewWeekly`(로그만) → `sendWeeklyReport`(테스트 발송) → `installWeeklyTrigger`

## 🧮 예측 공식 공통 함수

`premarket_alert.gs` 의 `predictRet_ · futKeyFor_ · signalFor_` 는 대시보드 `js/quant_core.js` 와 본문이 같아야 합니다.
GitHub Actions `Tests` 가 PR 마다 `tests/parity.test.js` 로 확인하니, 공식을 바꿀 땐 두 파일을 같이 고치세요.

## 🧾 과세표준 · 세금 점검 (2026-10 추가)

- `dividend_schedule_sync.gs` 가 'ETF들 배당이력' **E열 = 1주당 과세표준**을 함께 채웁니다 (마스터시트 DB_ 탭·TIGER 공식은 확실, 다른 운용사는 응답에 과세표준 칸이 있을 때). `debugTaxFields` 로 운용사별 응답 칸을 확인할 수 있어요.
- 대시보드: 배당&총알 세후 · 랭킹 '배당 포함' 수익률 · 🧾 세금 점검 탭이 이 값을 씁니다 (없으면 전액 과세로 보수적 계산).
- 세금 점검 탭의 연봉 등 입력값은 브라우저(localStorage)에만 저장되고 어디에도 전송되지 않습니다.

## 🇰🇷 국내 ETF 개장 전 예측 (EWY)

- 07:30 알림·대시보드 모두 국내 구성종목은 **EWY(미국 상장 한국 ETF) 지난밤 미국장 시가→종가 변동**으로 추정합니다.
- `futuresRefDaily_` (06:20) 와 07:30 실행이 Characteristic 에 `EWY` 행(D 시가 · E 종가 · C 갱신 날짜)을 씁니다. 대시보드는 오늘 날짜일 때만, 국내장 개장 전에만 사용.
- 트리거 시각이 05:40 → 06:20 으로 바뀌었으니 `installPremarketTrigger` 를 한 번 다시 실행하세요 (겨울철 미국장 마감 06:00 대응).

## ✅ 자동화 실행 기록

각 자동 실행이 끝나면 `wrMarkRun_` 이 스크립트 속성 `RUNLOG` 에 날짜를 남기고, 금요일 주간 리포트 맨 아래에 '07:30 알림 5/5 · …' 한 줄로 보여줍니다 (따로 알림은 보내지 않음).

## 📸 잔고 캡처 입력 — `holdings_upload.gs` (**새 독립 Apps Script 프로젝트**) + `upload.html`

멤버가 증권사 앱 잔고 화면을 캡처해 올리면 Gemini 가 종목·수량·평단을 읽고, 바뀔 내용을 확인한 뒤 개인일기장 `{이름}포토폴리오` 탭 D·E열(평단·수량)을 고치거나 새 줄을 추가합니다. 이미지는 저장하지 않고, 반영 기록만 관리시트 `잔고_업로드_기록` 탭에 남습니다.

1. script.google.com → 새 프로젝트 → `holdings_upload.gs` 붙여넣기
2. 스크립트 속성: `GEMINI_API_KEY`(새로 발급) · `MEMBER_PINS` = `{"D":"…","S":"…","J":"…"}` · (선택) `GEMINI_MODEL`
3. `testSetup` 실행 → 권한 허용, 로그 확인
4. 배포 → 새 배포 → 웹 앱 · 실행: 나 · 액세스: 모든 사용자 → URL 을 `js/common.js` 의 `APP_CONFIG.UPLOAD_URL` 에 입력
5. 멤버에게 `https://djseok.github.io/DJ_ETF_Study/upload.html` 과 각자 비밀번호 전달

**토스 미국주식(달러)**: 1단계에서 계좌를 '토스 미국주식'으로 고르면 개인일기장 `토스_보유` 탭(토스 전체 보유: A 이름 · B 티커 · C 종목명 · D 수량 · E 평단$ · F 현재가$ · G 기록일)을 고칩니다. 새 종목은 새 줄로 추가돼요. `1달러 마스터 포토폴리오`(1달러 프로젝트로 고른 종목만)는 그 멤버 · 티커 줄이 이미 있을 때만 E(수량)·H(평단$)를 같이 맞추고 새 줄은 만들지 않아요. 티커 `USD` 줄은 달러 예수금(직접 입력)이라 캡처 반영 대상이 아니에요. `{이름}포토폴리오` · `D_실적기록` · `D_기록` 은 건드리지 않아요. 원화로만 보이는 화면이면 평단을 오늘 환율로 나눠 달러로 바꿉니다. 업로드 서버가 예전 버전이면 페이지가 토스 반영을 막아요 (Apps Script 다시 배포 필요).

대시보드 실보유 현황의 달러 자산은 `토스_보유`에 그 멤버 줄이 있으면 그걸(토스 전체, 1달러 종목은 '1달러' 표시), 없으면 `1달러 마스터 포토폴리오`를 보여줘요. 받은 달러 배당은 계속 1달러 탭 J~L 에서 읽어요. 날짜별 받은 배당 원본은 `토스_배당내역` 탭.

## 🎯 D 전략 매수 계산기 — `d_strategy_calculator.gs` (개인일기장, 배당 입력 폼 프로젝트)

ISA D 전략(TIGER 미국나스닥100레버리지 418660 60 / RISE 미국테크100데일리고정커버드콜 491620 40)의 이번 달 매수 종목·수량.
**계산은 시트 수식이 실시간으로** 하고, 스크립트는 메뉴와 기록만 담당해요.

- `D_설정`: 종목코드·비중·기준금액·이번 달 입금액 (노란 칸만 매달 입력)
- `D_보유`: D포토폴리오 수량·평단 + GOOGLEFINANCE 현재가 (수식)
- `D_매수계획`: 이번 달 살 종목·수량 (수식, 기본예탁금 1천만 원 전에는 491620만)
- `D_기록`: 잔고 캡처 반영 시 자동 기록 (아래), 또는 메뉴 ② 로 직접 기록

설치: Apps Script 에 붙여넣기 → 함수 목록에서 `dInstallMenu` 실행 (권한 허용) → 시트 새로고침 → **📈 D 전략** 메뉴.
모든 이름이 `d`·`D_`로 시작해 같은 프로젝트 파일과 겹치지 않고 `onOpen()`도 쓰지 않아요.

### 잔고 캡처 → `D_실적기록` 자동 기록 (`holdings_upload.gs`)

D가 잔고 캡처를 반영하면 개인일기장 `D_실적기록`에 그달 계좌 상태를 한 줄 남깁니다 (`HU_STRATEGY_TABS`).

- 레버리지·나스닥CC(이름에 나스닥100/테크100 + 커버드콜)·그 외(HOLD) 평가액 = D포토폴리오 수량 × 현재가
- 이번 달 매수액 = 이번 반영에서 늘어난 수량 × 현재가 (같은 달에 여러 번 올리면 그달 줄을 덮어쓰고 매수액은 더함)
- 이번 달 분배금 = D포토폴리오 H~L 중 이번 달 수령분 (CC / 그 외로 나눔)
- 신규 입금 = 매수액 − 분배금 으로 **추정** (T열 메모에 표시) → 실제와 다르면 K열을 고치면 됨
- 레버리지·나스닥CC 수량이 늘었으면 `D_기록`에도 한 줄: 실제 매수 주수·금액, 남는 현금, 매수 후 레버리지 비중, 메모에 **계획 대비**(반영 전 `D_매수계획` 수량)
- 코드를 바꾼 뒤에는 **배포 → 배포 관리 → ✏️ → 버전: 새 버전 → 배포** 해야 웹 앱에 반영됨 (주소는 그대로)
