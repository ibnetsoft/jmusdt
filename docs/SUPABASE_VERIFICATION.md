# Supabase 연결·인증 검증 (2026-10-14)

## 적용

- Supabase 공개 CA 인증서를 저장소에 포함하고, Supabase DB/pooler 연결에 기본 사용합니다. 개인키가 아니며 OS 인증서 저장소는 변경하지 않습니다.
- 실제 DB 연결에서 `rejectUnauthorized=true`, 클라이언트 TLS `authorized=true`, `SELECT 1`을 확인했습니다.
- 사용자 `.env`는 보존하고 CA 파일 경로를 로컬에 설정했습니다. `.env.local`은 `APP_MODE=live`, Nile, 전송 비활성 상태입니다.
- 처음에는 비어 있던 `public`에 지갑 테이블 11개와 회원 소유자 SELECT 정책 4개를 생성했습니다. 모든 지갑 테이블에 RLS가 활성화돼 있습니다.
- 금융 함수 5개와 트리거 함수 2개는 고정 search_path, SECURITY INVOKER를 사용하며 anon/authenticated에는 EXECUTE 권한이 없습니다.
- CLI 실행의 ESM / @next/env CommonJS 호환 오류를 수정했습니다. 스키마 적용은 명시적인 DB 트랜잭션으로 실행합니다.
- 인증과 체인 설정을 분리했습니다. TRON 컨트랙트 미설정 상태에서도 가입·로그인·잔액 조회가 됩니다. 입금 주소 생성·외부 출금과 워커는 계속 검증된 네트워크/토큰 결합을 요구합니다.
- PKCE 콜백과 이메일 토큰 해시 확인 경로를 추가했습니다. 오류 시 로그인 화면에서 재인증 안내를 표시합니다.

## 실제 서비스 검증

`scripts/verify-supabase.ts --test-account`는 이메일을 발송하지 않는 Supabase의 signup 링크 생성으로 **미인증 임시 회원**을 만든 후 아래를 검증합니다. 비밀번호·토큰·쿠키는 메모리에만 두고 로그에 출력하지 않습니다.

1. 미인증 회원의 비밀번호 로그인 거부.
2. 실제 일회용 가입 인증 토큰 → 앱 `/auth/confirm` → 쿠키 생성.
3. 인증 쿠키 → `/api/wallet` → DB 프로필·잔액 생성, live 모드·0 USDT 조회.
4. 앱 `/api/auth` 비밀번호 로그인 → 쿠키 → 같은 회원 지갑 조회.
5. 일반 회원의 관리자 조회 거부(403).
6. 회원 JWT의 Data API에서 자신의 balance만 조회, 서명 payload 조회·금융 RPC 실행 거부.
7. 로그아웃, 익명 지갑 조회 거부(401), 잘못된 인증 링크 처리.
8. 생성한 QA 회원의 세션 종료와 0원 프로필·테스트 계정 정리. 다른 회원은 건드리지 않습니다.

가입 인증과 로그인은 실제 Supabase와 검증했습니다. **SMTP 전달·실제 메일함 수신은 이 검증과 별개입니다.** 일반 가입 API도 호출했으며, 예약된 QA 주소 `example.com`은 Supabase에서 `email_address_invalid`로 거부했습니다. 이후 사용자가 지정한 실제 테스트 이메일로 가입을 시도했으나, Supabase의 `over_email_send_rate_limit`에 의해 앱이 HTTP 429를 반환했습니다. 해당 계정은 생성되지 않았으며 메일 발송·수신 성공은 확인하지 못했습니다. 이 제한이 풀리거나 이메일 발송 설정을 변경한 후 실제 메일 경로를 재검증해야 합니다. 테스트 이메일 주소는 저장소에 기록하지 않습니다.

프로젝트는 이메일 확인을 계속 요구합니다. 기본 SMTP를 사용한다면 팀 이메일만 허용하므로 일반 사용자 가입 메일을 운영하려면 사용자 지정 SMTP가 필요합니다. 이메일 확인을 끄거나 공개 가입 API에 service_role 우회를 넣지 않았습니다.

Supabase MCP로 연결된 계정이 이 `.env`의 프로젝트에 접근하지 못해 공식 get_advisors는 권한 오류로 실행되지 않았습니다. 대신 실제 DB의 RLS·정책·함수 보안 속성과 역할별 권한을 SQL로 확인하고, 회원 JWT의 REST/RPC 접근을 직접 검증했습니다.

공식 안내: [DB SSL 검증](https://supabase.com/docs/guides/platform/ssl-enforcement), [기본 SMTP 제한](https://supabase.com/docs/guides/auth/auth-smtp), [이메일 확인 링크](https://supabase.com/docs/guides/auth/auth-email-templates).
