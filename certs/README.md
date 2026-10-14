# Supabase DB CA

`supabase-prod-ca-2021.crt`는 개인키가 아닌 공개 CA 인증서입니다. Supabase pooler와 DB의 TLS 인증서·호스트 이름을 검증하기 위해 사용합니다. OS 신뢰 저장소는 변경하지 않습니다.

- 발급자: Supabase Root 2021 CA
- 다운로드: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- SHA-256: `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`
- 만료: 2031-04-26 UTC
- 공식 안내: https://supabase.com/docs/guides/platform/ssl-enforcement

Supabase 도메인에는 이 인증서가 기본 적용됩니다. 다른 DB 또는 인증서 교체 시 `DATABASE_SSL_CA_FILE`로 별도 인증서를 지정하세요. `rejectUnauthorized: true`를 유지합니다.
