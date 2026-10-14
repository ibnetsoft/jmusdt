# Nile 테스트넷 연결

이 문서는 새 테스트 환경을 위한 준비 절차입니다. 현재 프로젝트는 실제 계정·자금을 생성하지 않은 데모 모드입니다. 비밀키를 채팅·Git에 붙여 넣지 마세요.

## 1. Supabase 테스트 프로젝트

1. 별도의 테스트 프로젝트를 만들고 이메일 Auth와 이메일 확인을 활성화합니다.
2. Auth URL configuration에서 사이트 URL을 개발 시 `http://127.0.0.1:3000`, 배포 시 실제 HTTPS origin으로 설정합니다.
3. `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`에 해당 프로젝트 값을 설정합니다. PostgreSQL 연결에는 실제 TLS CA 검증을 사용합니다. 로컬 DB에서만 `DATABASE_SSL=false`를 사용하세요.
4. `npm run db:apply`를 실행합니다. 이미 다른 지갑 테이블이 있는 DB에 적용하지 말고 새 프로젝트를 사용하세요.
5. `APP_MODE=live`로 변경하고 서버를 재시작합니다.

Supabase dashboard에서 관리자 사용자 **app_metadata**를 `{ "adminConsole": true, "adminRole": "SUPER_ADMIN" }`로 설정하세요. user_metadata에 넣지 않습니다. 회원가입 후 이메일 확인을 완료하고 로그인하세요. 관리자 지갑 운영 화면에서 인증 앱을 등록하고 TOTP 검증을 완료해야 승인·차단·회수 작업이 허용됩니다.

## 2. Nile 토큰과 시작 높이

DB 연결에서 `SELF_SIGNED_CERT_IN_CHAIN`이 발생하면 Supabase Dashboard의 Database Settings에서 해당 DB의 CA 인증서를 다운로드하고 `.env`에 `DATABASE_SSL_CA_FILE=C:/secure/supabase-ca.crt`처럼 파일 경로를 설정하세요. 이 옵션은 인증서 검증을 유지합니다. 원격 DB의 인증서 검증을 끄거나 `DATABASE_SSL=false`로 우회하지 마세요. 안내: https://supabase.com/docs/guides/platform/ssl-enforcement

`.env.local`:

```dotenv
TRON_NETWORK=nile
TRON_USDT_CONTRACT=<Nile의 6-decimal 테스트 TRC20 토큰 주소>
TRON_START_BLOCK=<입금 주소 발급 전의 solid 블록 높이>
TRON_HOT_WALLET_ADDRESS=<Nile 핫월렛 주소>
TRONGRID_API_KEY=<필요 시 Nile 조회에 사용할 API key>
TRON_BROADCAST_ENABLED=false
```

Nile에서 mainnet USDT 주소를 그대로 사용하지 마세요. 테스트 토큰은 실제 Tether가 발행한 USDT로 간주하지 않으며 UI는 Nile 테스트넷임을 표시합니다. 테스트용 6자리 TRC20 토큰을 배포하거나 신뢰할 수 있는 테스트 컨트랙트를 직접 확인해 사용하세요. 워커는 decimals가 6이 아니면 중단합니다.

시작 높이는 공식 API `POST https://nile.trongrid.io/walletsolidity/getnowblock`의 `block_header.raw_data.number`에서 확인할 수 있습니다. 첫 스캔 후부터는 DB `chain_cursor`가 기준이며 환경 변수를 변경해도 커서를 자동 되돌리지 않습니다. 입금 주소 발급 전에 스캔 시작 높이를 정하세요.

## 3. 분리된 개발용 서명 서비스

서명 서비스는 프로젝트 코드가 포함되어 있으며 **Nile에서만 실행**됩니다. 운영 mainnet에는 HSM/MPC 등 수탁 시스템으로 교체하세요.

```powershell
Copy-Item .env.custody.example .env.custody
# .env.custody에는 Nile 전용 test mnemonic/hot key와 DB 연결을 로컬에서 설정
npm run custody
```

- `CUSTODY_TOKEN`: 무작위 32자 이상 비밀. 웹/워커의 token과 일치해야 합니다.
- `CUSTODY_MNEMONIC`: 사용자 입금 주소 파생을 위한 **테스트용** 니모닉.
- `CUSTODY_HOT_PRIVATE_KEY`: 테스트 핫월렛 키. `TRON_HOT_WALLET_ADDRESS`와 일치해야 합니다.
- `TRON_USDT_CONTRACT`, `DATABASE_URL`, 네트워크·fee limit도 웹/워커 설정과 일치해야 합니다.

웹/워커 `.env.local`에는 `CUSTODY_URL=http://127.0.0.1:8787`과 `CUSTODY_TOKEN`만 설정합니다. 니모닉과 개인키를 웹 서버 환경에 복사하지 마세요. 개발용 service는 127.0.0.1에만 bind합니다. 원격 수탁 엔드포인트에는 HTTPS·private network를 사용하세요.

## 4. 입금 먼저 검증

```powershell
npm run worker
```

사용자 화면의 입금 주소 생성 → 다른 Nile 지갑에서 테스트 토큰 입금 → solid 확정 후 잔액 반영을 확인합니다. 같은 블록 재처리에도 적립이 한 번인지 확인합니다. 메인넷 키나 실제 USDT를 사용하지 마세요.

## 5. 출금·자금 회수

핫월렛에 테스트 토큰과 충분한 Nile TRX/자원을 준비하세요. 사용자 입금 주소에서 회수하려면 해당 주소의 TRX/자원도 필요합니다. TRX 자동 충전·Energy 임대는 제공하지 않습니다.

`TRON_BROADCAST_ENABLED=true`로 설정하고 워커를 재시작합니다. 회원 출금 요청 → AAL2 관리자 승인 → 워커 서명·전송 → solid 확정 → reserved 감소를 확인하세요. 출금 반려는 예약 금액을 반환해야 합니다. 확정된 체인 실패도 반환되지만, 단순 타임아웃·만료·조회 불가는 자동 환불하지 않습니다.

회수 요청 → 워커 처리 → 테스트 핫월렛으로 토큰 이동 → 회원 원장 잔액이 변하지 않는지도 확인하세요. 이후 지갑 운영의 대사 조회로 실제 자산과 원장 채무를 비교합니다.

## 확인 항목

- 서로 다른 두 회원의 내부 송금은 수수료 0, 블록체인 tx 없이 양쪽 잔액이 변합니다.
- 동일 요청 키를 재전송해도 한 번만 차감합니다.
- 잔액 부족·차단 회원·미등록 수신자는 거부합니다.
- 일반 회원은 관리자 데이터·다른 회원 원장·서명 payload에 접근하지 못합니다.
- SUB_ADMIN은 조회 가능하지만 자금 처리를 못합니다. SUPER_ADMIN도 TOTP 미검증 상태에서는 처리하지 못합니다.
- 출금 반려·확정 실패의 반환이 중복되지 않습니다.
- 워커를 서명 전/후·전송 전/후 종료했다가 재시작해도 같은 txid만 사용합니다.
- 실제 관리 주소 잔액이 회원 잔액+예약+수수료와 일치하는지 확인합니다. 확정 시점 차이를 고려하세요.
