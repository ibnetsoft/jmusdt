# JMUSDT

TRON(TRC20) USDT 중앙화 지갑. 사용자 PWA와 웹 어드민을 한 Next.js 프로젝트에서 `/`와 `/admin`으로 분리했습니다. 게임·자체 토큰·스왑·추천 조직·보너스 기능은 포함하지 않습니다.

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

웹 앱과 `worker` / `db:apply` 명령은 `.env`와 `.env.local`을 함께 읽습니다. `.env.local`의 값이 `.env`보다 우선하므로, 실제 연결 시 `.env.local`에 남은 데모 설정도 확인하세요. `SERVICE_ROLE_KEY`는 현재 구현에서 사용하지 않습니다. 서명 서비스는 분리된 `.env.custody`만 사용합니다.

현재는 사용자의 요청에 따라 **데모 + Nile 설정 준비** 단계입니다. 서버 인증·DB·워커·서명 서비스 코드가 포함되어 있지만, Supabase 프로젝트·테스트 토큰·키가 없으므로 실제 온체인 송금은 실행하지 않았습니다.

1. `docs/NILE_SETUP.md`대로 별도 Supabase 테스트 프로젝트를 생성하고 환경 변수를 설정합니다.
2. `npm run db:apply`로 스키마를 적용합니다. 마이그레이션 파일을 임의 생성하지 않도록 이 초기 스키마는 별도 `db/`에 두었습니다. 이후 Supabase CLI를 도입하면 `supabase migration new`로 관리하세요.
3. 격리된 서명 서비스와 지속 실행 워커를 시작합니다.
4. 테스트 입금·내부 송금·출금 승인·실패·회수를 검증합니다.

프로덕션에는 HTTPS, DB 권한 분리, 키 복구·보관 절차, HSM/MPC 수탁, 체인 장애·만료 트랜잭션 처리, 백업·복원·경보 및 자산 대사를 갖춰야 합니다. 개발용 서명 서비스는 mainnet 실행을 거부합니다. 프로젝트를 mainnet 서비스로 배포하거나 실자산 운영을 시작한 상태가 아닙니다.
