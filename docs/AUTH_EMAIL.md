# 가입 인증과 비밀번호 재설정

## 구현

- `/login`: 회원가입 → 인증 메일 안내, 인증 메일 재발송, 비밀번호 찾기.
- `/api/auth/email`: Supabase Auth에 가입 메일 재발송 또는 복구 메일 요청. 미가입 여부는 응답에 노출하지 않는다.
- `/auth/confirm`: 메일의 토큰 해시를 GET에서 소비하지 않는다. 사용자 버튼 POST 시 Supabase가 일회용 토큰을 검증한다.
- 가입 인증 완료 → `/login?verified=1`. 인증 전 비밀번호 로그인은 거절한다.
- 복구 인증 완료 → `/reset-password`. 15분 HttpOnly 쿠키와 DB의 해시·사용자·세션 바인딩이 모두 일치해야 변경한다.
- 새 비밀번호는 12~128자, 확인값 일치 필수. 성공 시 복구 권한을 소비하고 전체 세션을 로그아웃한다. 실패한 전체 로그아웃은 성공으로 표시하지 않는다.
- 관리자 MFA는 우회하지 않는다. Supabase가 추가 인증을 요구하면 기존 2단계 인증 화면을 표시한다.
- 모든 보호 API는 검증된 사용자/JWT뿐 아니라 `auth.sessions`의 실제 세션도 확인하여 로그아웃한 JWT 재사용을 거부한다.
- `db/auth-email.sql`: 복구 권한 테이블. RLS 활성화, anon/authenticated 직접 조회·변경 권한 없음. 토큰 원문·비밀번호는 DB/로그에 저장하지 않는다.

## Resend 설정 적용

기존 wallet 사용자 앱의 Resend 키와 EMAIL_FROM을 재사용한다. 키는 클라이언트나 Git에 넣지 않는다. SMTP 발송은 Supabase가 맡으므로 JMUSDT Vercel에 service-role 키를 추가할 필요가 없다.

관리 권한 확보 후 다음 스크립트로 기존 설정을 읽고 필요한 필드만 PATCH한다. 다른 OAuth/MFA 설정은 유지한다. 입력 JSON은 Git에서 제외되는 위치에 둔다. 형태는 `[{"key":"RESEND_API_KEY","value":"..."},{"key":"EMAIL_FROM","value":"..."}]`이며, 실제 값은 문서에 기록하지 않는다.

```powershell
node node_modules/tsx/dist/cli.mjs scripts/configure-auth-email.ts --mail-config=artifacts/research/wallet-mail.env.json
node node_modules/tsx/dist/cli.mjs scripts/configure-auth-email.ts --mail-config=artifacts/research/wallet-mail.env.json --apply
```

실행 환경에 Supabase **Management** API용 `SUPABASE_ACCESS_TOKEN`이 필요하다. DB 비밀번호·publishable 키·service-role 키로는 Auth SMTP 관리 설정을 수정할 수 없다. 토큰은 채팅이나 커밋에 넣지 않는다.

적용 필드:

| 항목             | 값                                                                      |
| ---------------- | ----------------------------------------------------------------------- |
| SMTP             | smtp.resend.com / 465 / 사용자 resend                                   |
| SMTP 비밀번호    | 기존 wallet의 RESEND_API_KEY                                            |
| 발신 주소        | 기존 wallet의 EMAIL_FROM 주소 부분                                      |
| 발신 이름        | JMUSDT                                                                  |
| Confirm email    | 활성화 (`mailer_autoconfirm=false`)                                     |
| Site URL         | https://www.jmusdt.com                                                  |
| 가입 템플릿 링크 | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`   |
| 복구 템플릿 링크 | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` |

대시보드에서 수동 적용 시에도 두 템플릿을 반드시 변경한다. 기본 ConfirmationURL/PKCE 템플릿은 별도 복구 권한 발급 경로를 통과하지 않으므로 이 구현의 복구 템플릿과 호환되지 않는다. Resend 링크 추적은 끄고 발신 도메인의 인증 상태를 확인한다.

## 검증

```powershell
npm test
npm run build
node node_modules/tsx/dist/cli.mjs scripts/verify-supabase.ts --test-account
```

실제 Supabase에 임시 계정을 만들고 정리한다. 테스트 계정의 가입/복구 토큰은 관리 API로 생성하므로 메일을 보내지 않는다. 확인 항목: GET 미리보기 미소비, 미인증 로그인 차단, 인증 POST, 지갑 로그인, 관리자 접근 거절, 복구 세션 바인딩, 만료, 타 출처 요청 차단, 복구 테이블 비공개, 비밀번호 변경, 이전 비밀번호 거절, 토큰·복구 권한 재사용 차단, 전체 세션 무효화.

2026-10-28: 위 실제 인증/API 흐름 검증 완료. Resend SMTP 및 템플릿의 운영 적용과 실제 메일 수신 검증은 Supabase 관리 연결 확보 후 별도로 완료해야 한다. 플러그인 도구에 표시된 기존 두 계정에는 JMUSDT 프로젝트가 없었고, 사용자 추가 369 연결은 아직 도구에 표시되지 않았다.

참고: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [이메일 템플릿](https://supabase.com/docs/guides/auth/auth-email-templates), [비밀번호 인증](https://supabase.com/docs/guides/auth/passwords).
