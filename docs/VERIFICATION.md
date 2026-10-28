# 개발 검증 결과

## 2026-10-28 정회원·자동 후원·일배당 변경 검증

- `npm test`: 전체 30개 통과. 기본 금융 회귀 검사에 정회원 누적 구매 승급, 등록순 자동 롤업, 실시간 포인트 보상과 회사 일배당 통합 검사를 추가했다.
- 현재 전체 마이그레이션을 PGlite에서 적용해 정회원 등록순 3·6·9·12·15 롤업, 상위 추천인 부재 대기, 이메일 인증 자격, 일반회원 수당 차단, 재승급·마이그레이션 재실행의 순번 보존을 검증했다.
- 일배당은 다음 한국시간 자정 마감, 보유 패키지 수량 가중치, 다음 날 계속 참여, 소수점 6자리 내림, 잔여·무참여금 회사 귀속, 중복 지급 방지, 분배 전후 환불 및 원장 균형을 검증했다.
- `npm run test:ui`: 8개 통과. 기존 데모 송금·반려·로그인 화면 검사와 모바일 마이페이지 추천코드·링크 복사·가입 입력 연결, PC 자동 후원 조직도와 중앙 정렬을 확인했다. 신규 회원 화면은 API 모의 응답으로 검사했다.
- `npm run typecheck`, `npm run build`: 통과. `/mypage`와 관리자 등급·브랜딩 라우트 포함.
- 화면 캡처: `artifacts/mypage-mobile.png`, `artifacts/organization-automatic-desktop.png`. 코드·회원명은 테스트용 예시다.
- 실제 이메일 발송, 운영 DB 마이그레이션·운영 배포는 이번 변경 검증에 포함하지 않았다. Vercel Cron 등록은 한국시간 매일 자정이며 실제 플랫폼 실행에는 지연이 있을 수 있다.

---


2026-10-14의 **초기 데모 검증** 기록입니다. 이후 실제 Supabase DB·인증 검증은 [SUPABASE_VERIFICATION.md](SUPABASE_VERIFICATION.md)를 참고하세요.

| 검사 | 결과 |
| --- | --- |
| `npm test` | 12개 통과: 금액 정밀도, 관리자 기본 거부, TRON 체크섬, Transfer receipt 필터, 입금 중복 방지, 내부 송금 원자성·중복 요청·잔액 부족, 출금 예약·반려·실패·성공 정산, 저널 균형·불변성, 브라우저 DB 권한, protobuf/txid 검증, 실제 오프라인 서명·서명자 복구 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과: 사용자·관리자·인증·원장·대사 API와 manifest 라우트 생성 |
| `npm audit` | 0 vulnerabilities. TronWeb의 Axios는 `overrides.axios=1.20.0`으로 수정 버전 고정 |
| 브라우저 데모 송금 | 20 USDT 송금 후 Alex 12,840.50 → 12,820.50, Min 4,260.00 → 4,280.00 확인 |
| 브라우저 어드민 반려 | 기존 출금의 amount 249 + fee 1 = 예약 250 USDT 반환. Alex 13,070.50, reserved 0, 어드민 대기 0 확인 |
| 데모 QR | 실제 입금 불가 표기와 계정 연결 안내 확인 |
| 반응형 | 모바일·데스크톱 breakpoint에서 DOM과 화면 폭 확인. 가로 document overflow 없음 |
| API 데모 쓰기 거부 | `/api/wallet/send` POST → 403 |
| 다른 출처의 관리자 요청 거부 | `/api/admin/action` POST with external Origin → 403 |
| PWA | manifest 200 / standalone, 512 icon 200, 오프라인 페이지·공개 shell만 캐시하는 service worker 확인 |

검증 후 브라우저 예시 데이터를 초기화했습니다. `tests/ui.spec.ts`는 위 브라우저 시나리오의 재현용 Playwright 테스트로 제공했습니다. 이번 실행에서는 연결된 브라우저 도구로 흐름을 확인했으며, 별도 Playwright runner는 실행하지 않았습니다.

Supabase 프로젝트와 Nile 자금·키가 제공되지 않아 실제 이메일 인증, 클라우드 RLS, 온체인 입금·출금·회수는 실행하지 않았습니다. 단일 PostgreSQL 엔진 원장 검증을 수행했으며, 여러 DB 연결을 사용하는 동시 출금 부하 검증은 연결 후 필요합니다. Docker daemon이 현재 실행 중이지 않아 별도의 PostgreSQL 컨테이너는 띄우지 않았습니다.
