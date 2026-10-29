-- Configured P per USDT; version protects a member's reviewed quote.
CREATE TABLE IF NOT EXISTS exchange_rate_settings (id boolean PRIMARY KEY DEFAULT true CHECK(id), rate integer NOT NULL CHECK(rate BETWEEN 1 AND 1000000), version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO exchange_rate_settings(id,rate) VALUES(true,1300) ON CONFLICT DO NOTHING;
ALTER TABLE exchange_rate_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON exchange_rate_settings FROM PUBLIC,anon,authenticated;
ALTER TABLE point_swaps ADD COLUMN IF NOT EXISTS rate integer;
ALTER TABLE point_swaps ADD COLUMN IF NOT EXISTS target_amount bigint;
CREATE OR REPLACE FUNCTION wallet_swap(owner_id uuid,way text,quantity bigint,request uuid,expected_version integer) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old point_swaps%ROWTYPE; cfg exchange_rate_settings%ROWTYPE; source text; target text; debit uuid; credit uuid; result uuid; batch uuid:=gen_random_uuid(); output_units bigint; raw_output numeric;
BEGIN
 IF quantity IS NULL OR quantity<=0 OR way IS NULL OR way NOT IN ('usdt_to_points','points_to_usdt') OR request IS NULL OR expected_version IS NULL THEN RAISE EXCEPTION 'INVALID_SWAP'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||request::text,0));
 SELECT * INTO old FROM point_swaps WHERE user_id=owner_id AND request_key=request;
 IF FOUND THEN
  IF old.direction<>way OR old.amount<>quantity THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN old.id;
 END IF;
 IF EXISTS(SELECT 1 FROM transactions WHERE user_id=owner_id AND idempotency_key=request) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 SELECT * INTO cfg FROM exchange_rate_settings WHERE id=true FOR SHARE;
 IF NOT FOUND OR cfg.version<>expected_version THEN RAISE EXCEPTION 'RATE_CHANGED'; END IF;
 raw_output:=CASE WHEN way='usdt_to_points' THEN quantity::numeric*cfg.rate ELSE trunc(quantity::numeric/cfg.rate) END;
 IF raw_output<1 OR raw_output>9223372036854775807 THEN RAISE EXCEPTION 'INVALID_SWAP'; END IF;
 output_units:=raw_output::bigint;
 PERFORM 1 FROM profiles WHERE id=owner_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 INSERT INTO balances(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 INSERT INTO point_balances(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM balances WHERE user_id=owner_id FOR UPDATE;
 PERFORM 1 FROM point_balances WHERE user_id=owner_id FOR UPDATE;
 IF way='usdt_to_points' THEN
  UPDATE balances SET available=available-quantity WHERE user_id=owner_id AND available>=quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  UPDATE point_balances SET available=available+output_units WHERE user_id=owner_id;
  source:='USDT'; target:='POINT';
 ELSE
  UPDATE point_balances SET available=available-quantity WHERE user_id=owner_id AND available>=quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_POINTS'; END IF;
  UPDATE balances SET available=available+output_units WHERE user_id=owner_id;
  source:='POINT'; target:='USDT';
 END IF;
 INSERT INTO transactions(user_id,kind,amount,status,idempotency_key,asset,destination) VALUES(owner_id,'swap_out',quantity,'completed',request,source,target) RETURNING id INTO debit;
 INSERT INTO transactions(user_id,kind,amount,status,asset,destination) VALUES(owner_id,'swap_in',output_units,'completed',target,source) RETURNING id INTO credit;
 INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
 (debit,batch,owner_id::text||':available',-quantity,source),(debit,batch,'swap:reserve',quantity,source),
 (credit,batch,'swap:reserve',-output_units,target),(credit,batch,owner_id::text||':available',output_units,target);
 INSERT INTO point_swaps(user_id,direction,amount,request_key,debit_id,credit_id,rate,target_amount) VALUES(owner_id,way,quantity,request,debit,credit,cfg.rate,output_units) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wallet_swap(uuid,text,bigint,uuid,integer) FROM PUBLIC,anon,authenticated;
