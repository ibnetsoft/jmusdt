-- Refuse to infer attribution if historical purchases overlap existing sweeps.
LOCK TABLE transactions, sweep_jobs IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sweep_jobs' AND column_name='jinmu_amount')
 AND EXISTS (SELECT 1 FROM transactions WHERE kind='jinmu_purchase' AND status='completed')
 AND EXISTS (SELECT 1 FROM sweep_jobs WHERE status IN ('requested','gas_funding','gas_confirmed','signing','broadcast','needs_review','completed'))
 THEN RAISE EXCEPTION 'Existing purchases and sweeps require manual attribution'; END IF;
END $$;
ALTER TABLE sweep_reviews ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'general' CHECK (purpose IN ('general','jinmu'));
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'general' CHECK (purpose IN ('general','jinmu'));
ALTER TABLE sweep_jobs ADD COLUMN IF NOT EXISTS jinmu_amount bigint NOT NULL DEFAULT 0 CHECK (jinmu_amount>=0 AND (amount IS NULL OR jinmu_amount<=amount));
CREATE OR REPLACE FUNCTION approve_sweep_review(review_key uuid,actor_id uuid,why text) RETURNS uuid[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r sweep_reviews%ROWTYPE;s sweep_settings%ROWTYPE;i jsonb;result uuid[];job uuid; pending numeric; alloc bigint;
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
 SELECT GREATEST(0, (SELECT COALESCE(sum(amount),0) FROM transactions WHERE kind='jinmu_purchase' AND status='completed' AND asset='USDT') -
   (SELECT COALESCE(sum(jinmu_amount),0) FROM sweep_jobs WHERE status IN ('requested','gas_funding','gas_confirmed','signing','broadcast','needs_review','completed'))) INTO pending;
 IF r.purpose='jinmu' AND (SELECT sum((value->>'amount')::numeric) FROM jsonb_array_elements(r.items)) > pending THEN RAISE EXCEPTION 'SWEEP_JINMU_AMOUNT_CHANGED'; END IF;
 FOR i IN SELECT value FROM jsonb_array_elements(r.items) LOOP
  IF (i->>'amount')::bigint<=0 OR (i->>'topup')::bigint<0 OR (i->>'topup')::bigint>s.max_topup OR (i->>'feeLimit')::bigint NOT BETWEEN 1 AND 1000000000 OR i->>'source'=r.company THEN RAISE EXCEPTION 'INVALID_SWEEP_ITEMS';END IF;
  PERFORM 1 FROM deposit_addresses WHERE user_id=(i->>'userId')::uuid AND address=i->>'source' AND network=r.network AND derivation_index=(i->>'index')::bigint FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SWEEP_WALLET_CHANGED';END IF;
  IF EXISTS(SELECT 1 FROM sweep_jobs WHERE user_id=(i->>'userId')::uuid AND status IN ('requested','gas_funding','gas_confirmed','signing','broadcast','needs_review')) THEN RAISE EXCEPTION 'SWEEP_ALREADY_ACTIVE';END IF;
  alloc := LEAST(pending, (i->>'amount')::numeric)::bigint;
  pending := pending - alloc;
  INSERT INTO sweep_jobs(user_id,review_id,network,contract,source,destination,derivation_index,amount,max_topup,fee_limit,reason,note,purpose,jinmu_amount)
   VALUES((i->>'userId')::uuid,r.id,r.network,r.contract,i->>'source',r.company,(i->>'index')::bigint,(i->>'amount')::bigint,(i->>'topup')::bigint,(i->>'feeLimit')::bigint,trim(why),'승인 완료: 워커 대기',r.purpose,alloc) RETURNING id INTO job;
  result:=array_append(result,job);
 END LOOP;
 UPDATE sweep_reviews SET approved_at=now() WHERE id=r.id;
 INSERT INTO audit_logs(actor,action,details) VALUES(actor_id,'sweep.batch_approved',jsonb_build_object('reviewId',r.id,'jobs',result,'network',r.network,'company',r.company,'reason',trim(why)));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION approve_sweep_review(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
