# Apps Script 모음

구글 시트에 붙여서 쓰는 스크립트입니다. 대시보드(GitHub Pages)와는 따로 동작해요.

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
