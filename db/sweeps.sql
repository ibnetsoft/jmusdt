CREATE TABLE IF NOT EXISTS sweep_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 max_topup bigint NOT NULL DEFAULT 25000000 CHECK(max_topup BETWEEN 0 AND 100000000),
 company_reserve bigint NOT NULL DEFAULT 50000000 CHECK(company_reserve>=1000000),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sweep_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS unique_deposit_chain_address ON deposit_addresses(network,address) WHERE address IS NOT NULL;
CREATE TABLE IF NOT EXISTS sweep_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid NOT NULL REFERENCES profiles(id),
 network text NOT NULL CHECK(network IN ('nile','mainnet')), contract text NOT NULL, company text NOT NULL,
 settings_version integer NOT NULL, items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS review_id uuid REFERENCES sweep_reviews(id);
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS network text;
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS contract text;
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS derivation_index bigint;
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS max_topup bigint;
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS fee_limit bigint;
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE sweep_jobs DROP CONSTRAINT IF EXISTS sweep_jobs_status_check;
ALTER TABLE sweep_jobs ADD CONSTRAINT sweep_jobs_status_check CHECK(status IN ('requested','gas_funding','gas_confirmed','signing','broadcast','completed','failed','needs_review','cancelled'));
-- Old requests never authorize fresh transactions under the new approval contract.
UPDATE sweep_jobs SET status='needs_review',note='기존 요청: TX 확인 및 새 검토 필요' WHERE review_id IS NULL AND status IN ('requested','signing','broadcast');
DROP INDEX IF EXISTS one_requested_sweep;
CREATE UNIQUE INDEX one_requested_sweep ON sweep_jobs(user_id) WHERE status IN ('requested','gas_funding','gas_confirmed','signing','broadcast','needs_review');
CREATE UNIQUE INDEX IF NOT EXISTS one_review_wallet ON sweep_jobs(review_id,user_id);
CREATE TABLE IF NOT EXISTS sweep_outbox (
 job_id uuid NOT NULL REFERENCES sweep_jobs(id),phase text NOT NULL CHECK(phase IN ('gas','token')),
 txid text UNIQUE NOT NULL CHECK(txid~'^[0-9a-fA-F]{64}$'), payload jsonb NOT NULL, expiration bigint NOT NULL,
 amount bigint NOT NULL CHECK(amount>0), status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','signed','broadcast','confirmed','failed','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,phase)
);
CREATE TABLE IF NOT EXISTS sweep_worker_health(network text PRIMARY KEY,last_seen timestamptz NOT NULL DEFAULT now(),last_error text NOT NULL DEFAULT '');
ALTER TABLE sweep_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sweep_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE sweep_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE sweep_worker_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sweep_settings,sweep_reviews,sweep_outbox,sweep_worker_health FROM anon,authenticated;
CREATE INDEX IF NOT EXISTS sweep_reviews_actor ON sweep_reviews(actor,created_at DESC);
CREATE INDEX IF NOT EXISTS sweep_queue ON sweep_jobs(network,created_at) WHERE status IN ('requested','gas_funding','gas_confirmed','signing','broadcast','needs_review');
CREATE OR REPLACE FUNCTION approve_sweep_review(review_key uuid,actor_id uuid,why text) RETURNS uuid[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r sweep_reviews%ROWTYPE;s sweep_settings%ROWTYPE;i jsonb;result uuid[];job uuid;
BEGIN
 IF length(trim(why)) NOT BETWEEN 3 AND 500 OR why IS NULL THEN RAISE EXCEPTION 'INVALID_SWEEP_REASON'; END IF;
 PERFORM pg_advisory_xact_lock(9692028);
 SELECT * INTO r FROM sweep_reviews WHERE id=review_key AND actor=actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SWEEP_REVIEW_NOT_FOUND'; END IF;
 IF r.approved_at IS NOT NULL THEN SELECT array_agg(id ORDER BY user_id) INTO result FROM sweep_jobs WHERE review_id=r.id;RETURN result;END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'SWEEP_REVIEW_EXPIRED';END IF;
 SELECT * INTO s FROM sweep_settings WHERE id=true FOR SHARE;
 IF NOT s.enabled OR s.version<>r.settings_version THEN RAISE EXCEPTION 'SWEEP_SETTINGS_CHANGED';END IF;
 IF jsonb_array_length(r.items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_SWEEP_ITEMS';END IF;
 FOR i IN SELECT value FROM jsonb_array_elements(r.items) LOOP
  IF (i->>'amount')::bigint<=0 OR (i->>'topup')::bigint<0 OR (i->>'topup')::bigint>s.max_topup OR (i->>'feeLimit')::bigint NOT BETWEEN 1 AND 1000000000 OR i->>'source'=r.company THEN RAISE EXCEPTION 'INVALID_SWEEP_ITEMS';END IF;
  PERFORM 1 FROM deposit_addresses WHERE user_id=(i->>'userId')::uuid AND address=i->>'source' AND network=r.network AND derivation_index=(i->>'index')::bigint FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SWEEP_WALLET_CHANGED';END IF;
  IF EXISTS(SELECT 1 FROM sweep_jobs WHERE user_id=(i->>'userId')::uuid AND status IN ('requested','gas_funding','gas_confirmed','signing','broadcast','needs_review')) THEN RAISE EXCEPTION 'SWEEP_ALREADY_ACTIVE';END IF;
  INSERT INTO sweep_jobs(user_id,review_id,network,contract,source,destination,derivation_index,amount,max_topup,fee_limit,reason,note)
   VALUES((i->>'userId')::uuid,r.id,r.network,r.contract,i->>'source',r.company,(i->>'index')::bigint,(i->>'amount')::bigint,(i->>'topup')::bigint,(i->>'feeLimit')::bigint,trim(why),'승인 완료: 워커 대기') RETURNING id INTO job;
  result:=array_append(result,job);
 END LOOP;
 UPDATE sweep_reviews SET approved_at=now() WHERE id=r.id;
 INSERT INTO audit_logs(actor,action,details) VALUES(actor_id,'sweep.batch_approved',jsonb_build_object('reviewId',r.id,'jobs',result,'network',r.network,'company',r.company,'reason',trim(why)));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION approve_sweep_review(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
