# 자금 처리 구조

사용자 PWA → 인증된 Next.js API → PostgreSQL 원장. 별도 워커가 TRON과 통신하고, 별도 수탁 서비스가 승인된 트랜잭션만 서명합니다. 브라우저·웹 서버·DB에는 개인키나 니모닉을 저장하지 않습니다. 개발용 signer 프로세스에만 Nile 키를 설정합니다.

## 원장

- `available`, `reserved`, 거래 `amount`, `fee`는 USDT의 6자리 최소 단위 `bigint`입니다.
- 입금은 custody 계정에서 회원 available 계정으로 기록합니다.
- 내부 송금은 송신자/수신자 계정을 UUID 순서로 잠그고 한 DB 트랜잭션에서 처리합니다.
- 출금 요청은 amount + fee를 available에서 reserved로 이동합니다.
- 반려 / 확정 실패는 reserved를 available로 돌립니다.
- 확정 성공은 reserved에서 custody(amount)와 fees(fee) 계정으로 이동합니다.
- 저널은 UPDATE/DELETE를 거부하며, 각 batch 합계 0을 지연 제약 트리거로 확인합니다.
- `(user_id,idempotency_key)`가 동일한 재요청은 기존 결과를 반환합니다. 같은 키의 금액·받는 곳이 변경되면 거부합니다.
- 새로운 키는 새로운 거래입니다. UI가 최종 확인 후 재시도 시 같은 키를 유지합니다.
- DB는 한 network/token에 영구 결합됩니다. Nile과 mainnet에는 별도 DB를 사용하세요.

## 입금

사용자별 HD index를 먼저 예약하고 수탁 서비스가 `m/44'/195'/0'/0/index` TRON 주소를 결정적으로 생성합니다. address 엔드포인트는 재시도해도 동일한 주소를 반환해야 합니다.

워커는 `walletsolidity/getnowblock`, `walletsolidity/gettransactioninfobyblocknum`으로 solid 블록의 성공한 USDT Transfer 로그를 읽습니다. 주소는 대소문자를 보존해 정확히 비교합니다. 블록 내 모든 로그를 처리한 후 커서를 함께 커밋합니다. 재실행 시 동일 이벤트가 다시 조회되어도 `(network,txid,log_index)`로 중복 적립하지 않습니다.

## 출금·회수 아웃박스

1. 관리자 SUPER_ADMIN + TOTP(AAL2)가 출금을 승인합니다.
2. 워커가 정확한 USDT transfer 호출을 생성하고 unsigned payload/txid를 먼저 저장합니다.
3. 수탁 서비스는 DB 승인·owner·contract·receiver·amount·fee limit·protobuf/txid 일치를 독립 확인하고 서명합니다.
4. 워커는 서명을 먼저 저장한 뒤 동일 txid를 브로드캐스트합니다.
5. 응답 유실 시 동일 signed transaction만 재전송합니다. 다른 tx를 새로 만들지 않습니다.
6. solid receipt와 기대한 Transfer 로그를 확인해야 완료 처리합니다.

서명/전송이 불명확하거나 만료됐는데 결과를 찾을 수 없으면 잔액을 유지하고 수동 대사를 요구합니다. RPC에서 조회되지 않는다는 사실만으로 실패 환불하지 않습니다. 만료 건 재처리·해제는 체인과 서명 서비스 확인 후 운영자가 별도 절차로 진행해야 합니다. 자동 재서명·새 tx 생성은 의도적으로 구현하지 않았습니다.

입금 주소의 회수도 동일하게 unsigned/signed payload를 `sweep_jobs`에 보존합니다. 송금 amount는 조회 시점의 토큰 잔액이며, 이후 새 입금은 다음 회수로 처리합니다. 회수는 내부 원장 잔액을 바꾸지 않습니다. TRX 자동 충전·스테이킹·Energy 임대는 구현하지 않았으며, 테스트넷에서 해당 주소의 자원을 먼저 준비해야 합니다.

## 권한·배포

Supabase 인증은 서버에서 `getUser()`로 재검증하고, 사용자 편집 메타데이터를 관리자 판단에 사용하지 않습니다. authenticated/anon에는 금융 함수 EXECUTE·금융 테이블 쓰기·서명 payload 조회를 부여하지 않습니다. 회원은 자신의 profile/balance/transaction/address SELECT만 허용됩니다.

초기 `db:apply`는 스키마 소유자 연결을 사용합니다. 운영 전 웹 API·워커·수탁 서비스 DB 역할을 각각 최소 권한으로 분리하세요. Supabase service_role 키도 브라우저에 넣지 않습니다. 워커는 Vercel Cron/API 요청으로 돌리지 말고 지속 실행 가능한 private VM/컨테이너에 배치합니다. 사용자 앱과 관리자 경로는 같은 저장소에서 제공되지만 인증과 권한은 모든 API마다 검사합니다.

## 검증 범위·운영 한계

- 자동 원장 검증은 PGlite의 실제 PostgreSQL 함수/트랜잭션 엔진을 사용합니다. 다중 연결 동시성은 실제 PostgreSQL 환경에서 추가 검증해야 합니다.
- 대사 API는 최대 500 입금 주소를 순차 조회하며, 요청 중 새 거래가 일어나면 시점 차이가 생길 수 있습니다. 차이는 바로 손실로 단정하지 말고 동일 확정 높이의 운영 대사 워커로 재검증하세요.
- 관리자 목록은 최근 회원 500명·거래 200건, 사용자 내역은 최근 100건을 표시합니다. 대규모 운영 전 서버 페이지네이션을 추가하세요.
- 클라우드 Supabase·실제 체인·이메일·수탁 서비스는 자격 정보 없이 실행 검증하지 않았습니다.
- 프로덕션 key management·다중 승인·출금 한도 정책·재난 복구·모니터링은 운영 환경에 맞춰 후속 구축이 필요합니다.

공식 참조: https://developers.tron.network/docs/trc20-contract-interaction, https://developers.tron.network/docs/resource-model, https://tether.to/en/supported-protocols/, https://supabase.com/docs/guides/auth/server-side/creating-a-client
