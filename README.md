# JMUSDT

TRON(TRC20) USDT 중앙화 지갑. 사용자 PWA와 웹 어드민을 한 Next.js 프로젝트에서 `/`와 `/admin`으로 분리했습니다. 포인트 전환·쇼핑몰·추천 및 후원 조직도·상품별 마케팅 보상을 제공합니다. 게임·자체 토큰은 포함하지 않습니다.

추가 개발 조사: [쇼핑몰·마케팅·USDT 모으기·조직도 개발 계획](docs/COMMERCE_MARKETING_DEVELOPMENT_PLAN.md). 기존 프로젝트의 조사 커밋, 재사용 파일, 기능 차이, 결제·보상 설계와 미확정 정책을 정리했습니다. 현재 구현 범위는 아래 기능 목록과 각 사용 안내를 기준으로 확인하세요.

## 지금 실행하기

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

- 사용자 지갑: http://127.0.0.1:3000
- 관리자 콘솔: http://127.0.0.1:3000/admin
- 로그인 / 가입: http://127.0.0.1:3000/login

기본 `APP_MODE=demo`에서는 Supabase와 지갑 키가 필요 없습니다. 회원 송금, 출금 요청, 어드민 승인·반려·회원 차단은 **같은 브라우저의 localStorage 예시 데이터**에 반영됩니다. 출금 승인 후 온체인 전송을 가장하지 않습니다. 설정 화면에서 데모를 초기화할 수 있습니다. 예시 회원 송금 수신자: `min@example.com`.

**데모 QR은 실제 주소가 아닙니다. 실제 자산을 보내지 마세요.** Live 전용 입금 주소가 생성되면 실제 주소의 QR로 바뀝니다. 데모 모드의 금융 POST API는 403을 반환합니다.

## 구현된 기능

- 상품별 마케팅 플랜: 추천·후원·맘 고정 포인트, 복·보물주머니 수량, 데일리 지급액·일수 직접 입력. 구매 자동 지급·권리 생성, 데일리 Cron·재처리, 취소 회수·미수금 상계 및 어드민 운영 설정. [운영 안내](docs/MARKETING.md).

- 추천·후원 조직도: 추천 링크 가입, 본인이 추천한 미배치 회원 좌·우 배치, 하위 조직 탐색·확대·전체 화면. [사용 안내](docs/ORGANIZATION.md).

- 상품 이미지 직접 업로드, 제목·본문·이미지 상세 편집·순서 변경·모바일 미리보기. [사용 안내](docs/PRODUCT_EDITOR.md).

- 주문 관리·취소·환불: 관리자 주문 검색·상세·취소 승인/반려, 고객 취소 요청, 전액 반환·재고 복구·중복 환불 방지. [운영 안내](docs/ORDER_REFUNDS.md).

- 포인트: USDT와 별도 잔액, 1 USDT = 1 P 양방향 전환(수수료 0). [전환 안내](docs/POINTS.md).
- 쇼핑몰: 관리자 상품·상세 설명·이미지 URL·포인트 가격·재고·공개 여부 관리, 사용자 상품 상세·수량 선택·포인트 결제·구매 내역. [사용/검증 안내](docs/SHOPPING_MVP.md).

- 검정·빨강 모바일 UI: 잔액 숨기기, 입금 QR·주소 복사, 내부 송금 / 외부 출금, 금액 키패드·최대 금액, 최종 확인, 거래 필터·상세, 보안 설정.
- 웹 어드민: 원장 기반 현황, 출금 승인·반려 및 사유, 회원 검색·차단, 거래 검색·CSV, 핫월렛·체인 커서, 자금 회수 요청, 감사 로그.
- 인증: Supabase 이메일/비밀번호, 이메일 확인, TOTP 등록·검증. 관리자 자금 작업은 서버 관리 `app_metadata.adminRole=SUPER_ADMIN`과 AAL2 세션을 요구합니다.
- 원장: USDT 최소 단위 정수, 트랜잭션·행 잠금, 요청 UUID 중복 방지, 출금 잔액 예약, 실패·반려 환불, 균형 검증 저널, 소유자 조회 RLS.
- TRON 워커: solid 블록 기반 입금 감지, `(network, txid, log_index)` 중복 방지, 영속 커서, 승인 출금·회수 작업, 영속 서명 아웃박스, 확정 이벤트 기반 정산.
- PWA: manifest, 192/512/maskable 아이콘, 설치 안내, 오프라인 연결 안내. 인증·원장·API는 오프라인 캐시에 저장하지 않습니다.
- 대사 API: `/api/admin/reconciliation`에서 회원 채무 + 수수료를 관리 주소들의 확정 USDT 잔액과 비교합니다. 핫월렛 TRX/Energy/Bandwidth도 반환합니다.

## 구조

```text
src/app/                PWA, /admin, /login, 보호된 API
src/components/         모바일 지갑, 어드민, 로그인, TOTP
src/lib/                인증, 권한, 금액, DB, TRON, 원장 서비스
db/schema.sql           PostgreSQL 테이블·원장 함수·RLS
workers/tron.ts         지속 실행 입금·출금·회수 워커
services/custody.ts     격리 실행하는 Nile 개발용 서명 서비스
tests/                  실제 PostgreSQL 엔진(PGlite) 원장 테스트
docs/NILE_SETUP.md      테스트넷 준비·검증 절차
docs/ARCHITECTURE.md    자금 처리와 운영 제한
docs/REUSE.md           기존 wallet 프로젝트 재사용 근거
```

## 검사

```powershell
npm run typecheck
npm test
npm run build
# 최초 UI 테스트 실행 전
npx playwright install chromium
npm run test:ui
```

UI 테스트는 실행 중인 localhost 서버를 사용합니다. 서버가 없으면 Playwright 설정이 데모 서버를 시작합니다. PostgreSQL 원장 테스트는 Supabase 인증 스키마를 최소한으로 재현한 PGlite에서 실제 SQL 함수를 실행합니다. 이 테스트는 실제 TRON 송금·Supabase 이메일 발송 검증을 대신하지 않습니다.

## 실제 연결

웹 앱과 `worker` / `db:apply` 명령은 `.env`와 `.env.local`을 함께 읽습니다. `.env.local`의 값이 `.env`보다 우선하므로, 실제 연결 시 `.env.local`에 남은 데모 설정도 확인하세요. `SERVICE_ROLE_KEY`는 명시적으로 실행한 QA 검증 스크립트에서만 사용하며, 웹 가입·로그인에 사용하지 않습니다. 서명 서비스는 분리된 `.env.custody`만 사용합니다.

Supabase DB에는 저장소의 공개 CA 인증서가 기본 적용되어 TLS·호스트 이름 검증을 유지합니다. `APP_MODE=live`이면 인증과 실제 DB 잔액을 사용합니다. TRON 설정이 없어도 가입·로그인·잔액 조회는 가능하며, 입금 주소 생성과 외부 출금은 토큰 설정이 완료되어야 합니다.

가입 이메일의 PKCE 리다이렉트 `/auth/callback`과 토큰 해시 확인 `/auth/confirm`을 지원합니다. Supabase Auth의 허용 리다이렉트에 `http://127.0.0.1:3000/auth/callback`을 등록하세요. 이메일 템플릿은 필요 시 `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`로 설정합니다. 기본 SMTP는 프로젝트 팀 이메일로만 발송되므로 일반 회원에게 발송하려면 사용자 지정 SMTP가 필요합니다.

실제 Supabase 검증을 재현하려면 실행 중인 live 로컬 서버에서 `npx tsx scripts/verify-supabase.ts --test-account`를 실행하세요. 이 명령은 임시 QA 계정을 생성하고 이메일을 보내지 않은 상태에서 인증 링크·비밀번호 로그인·쿠키 세션·RLS·로그아웃을 확인한 뒤 테스트 계정만 정리합니다. 인증 정보는 출력하지 않습니다.

Supabase DB와 이메일·비밀번호 인증 연결을 완료했습니다. 가입 인증 링크·로그인·회원 잔액 조회·RLS 검증 결과는 `docs/SUPABASE_VERIFICATION.md`에 정리했습니다. SMTP 메일함 전달과 TRON 입출금은 별도 설정·검증이 필요하며, 실제 온체인 송금은 실행하지 않았습니다.

1. `docs/NILE_SETUP.md`대로 별도 Supabase 테스트 프로젝트를 생성하고 환경 변수를 설정합니다.
2. `npm run db:apply`로 스키마를 적용합니다. 마이그레이션 파일을 임의 생성하지 않도록 이 초기 스키마는 별도 `db/`에 두었습니다. 이후 Supabase CLI를 도입하면 `supabase migration new`로 관리하세요.
3. 격리된 서명 서비스와 지속 실행 워커를 시작합니다.
4. 테스트 입금·내부 송금·출금 승인·실패·회수를 검증합니다.

프로덕션에는 HTTPS, DB 권한 분리, 키 복구·보관 절차, HSM/MPC 수탁, 체인 장애·만료 트랜잭션 처리, 백업·복원·경보 및 자산 대사를 갖춰야 합니다. 개발용 서명 서비스는 mainnet 실행을 거부합니다. 프로젝트를 mainnet 서비스로 배포하거나 실자산 운영을 시작한 상태가 아닙니다.
