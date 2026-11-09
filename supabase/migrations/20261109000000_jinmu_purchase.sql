-- Internal purchase ledger entry; on-chain collection remains a separate operation.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','purchase','swap_in','swap_out','refund','reward','reward_reversal','reward_recovery','jinmu_purchase'));

CREATE OR REPLACE FUNCTION wallet_jinmu_purchase(owner_id uuid, expected_address text, chain text, quantity bigint, request_key uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE existing transactions%ROWTYPE; result uuid; batch uuid := gen_random_uuid(); company_address text;
BEGIN
 IF quantity<=0 OR request_key IS NULL THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||request_key::text,0));
 SELECT * INTO existing FROM transactions WHERE user_id=owner_id AND idempotency_key=request_key;
 IF FOUND THEN
   IF existing.kind<>'jinmu_purchase' OR existing.destination<>expected_address OR existing.amount<>quantity THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN existing.id;
 END IF;
 SELECT address INTO company_address FROM company_wallets WHERE id=true AND network=chain FOR SHARE;
 IF company_address IS NULL OR company_address<>expected_address THEN RAISE EXCEPTION 'COMPANY_ADDRESS_CHANGED'; END IF;
 PERFORM id FROM profiles WHERE id=owner_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 UPDATE balances SET available=available-quantity WHERE user_id=owner_id AND available>=quantity;
 IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
 INSERT INTO transactions(user_id,kind,asset,amount,fee,status,destination,idempotency_key)
 VALUES(owner_id,'jinmu_purchase','USDT',quantity,0,'completed',company_address,request_key) RETURNING id INTO result;
 INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
 (result,batch,owner_id::text||':available',-quantity,'USDT'),(result,batch,'company:jinmu_sales',quantity,'USDT');
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION wallet_jinmu_purchase(uuid,text,text,bigint,uuid) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION wallet_jinmu_purchase(uuid,text,text,bigint,uuid) SET search_path=public;
