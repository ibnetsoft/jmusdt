# 기존 프로젝트에서 가져온 부분

검토 기준: `ibnetsoft/wallet` main의 `8f40b32039360e167f25a4fca73aa296ed54ef8e`.

원본: https://github.com/ibnetsoft/wallet

| 원본 | JMUSDT 적용 |
| --- | --- |
| `apps/admin/src/lib/admin-access.ts` | `adminConsole`, `adminRole`, `SUPER_ADMIN`의 서버 관리 app_metadata 권한 규칙을 `src/lib/admin-access.ts`에 축소·이식. 나머지는 명시적 기본 거부, 자금 작업은 AAL2 필수. |
| `apps/admin/src/lib/bsc-usdt-deposit-indexer.ts` | 확정 블록 스캔, DB 커서, advisory lock, 중복 방지 설계를 참조. ethers/BSC 호출은 가져오지 않고 TRON solid 블록·receipt 로그로 새 구현. |
| 입출금 관리 / 회원 / 감사 UI | 화면의 업무 흐름을 재사용하되 새 디자인·API·스키마로 구현. |
| 사용자 Next.js PWA·관리자 웹 구성 | 유지하되 초기 프로젝트는 하나의 앱에 사용자/관리자 경로를 분리. 공통 인증과 원장을 공유. |

원본 워커의 `Number(amount)` 기반 계산, BSC 18자리 소수점, EVM HD 주소·서명, DB 설정에 개인키를 보관하는 방식은 이식하지 않았습니다. 입금 후 마케팅 회원 활성화·보너스 트리 조건도 제외했습니다.

원본의 HMAC 커스텀 인증 토큰을 복사하지 않고 Supabase가 검증하는 세션을 사용합니다. 잔액 임의 수정 화면도 가져오지 않았습니다. 필요하면 반드시 별도 보정 거래·사유·다중 승인으로 설계해야 합니다.
