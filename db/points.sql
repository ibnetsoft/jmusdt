-- Apply after commerce.sql. USDT and POINT both use 6 decimal micro-units.
CREATE TABLE IF NOT EXISTS point_balances (
 user_id uuid PRIMARY KEY REFERENCES profiles(id), available bigint NOT NULL DEFAULT 0 CHECK(available>=0)
);
ALTER TABLE point_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON point_balances FROM anon,authenticated;
GRANT SELECT ON point_balances TO authenticated;
DROP POLICY IF EXISTS own_points ON point_balances;
CREATE POLICY own_points ON point_balances FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS asset text NOT NULL DEFAULT 'USDT' CHECK(asset IN ('USDT','POINT'));
ALTER TABLE journal ADD COLUMN IF NOT EXISTS asset text NOT NULL DEFAULT 'USDT' CHECK(asset IN ('USDT','POINT'));
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USDT' CHECK(currency IN ('USDT','POINT'));
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USDT' CHECK(currency IN ('USDT','POINT'));
UPDATE shop_products SET currency='POINT',version=version+1 WHERE currency='USDT';
ALTER TABLE shop_products ALTER COLUMN currency SET DEFAULT 'POINT';
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','purchase','swap_in','swap_out','refund','reward','reward_reversal','reward_recovery'));
CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM journal WHERE batch_id=NEW.batch_id GROUP BY asset HAVING sum(units)<>0) THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL'; END IF;
 RETURN NEW;
END $$;
CREATE TABLE IF NOT EXISTS point_swaps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 direction text NOT NULL CHECK(direction IN ('usdt_to_points','points_to_usdt')), amount bigint NOT NULL CHECK(amount>0),
 request_key uuid NOT NULL, debit_id uuid UNIQUE NOT NULL REFERENCES transactions(id), credit_id uuid UNIQUE NOT NULL REFERENCES transactions(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key)
);
ALTER TABLE point_swaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON point_swaps FROM anon,authenticated;
GRANT SELECT ON point_swaps TO authenticated;
DROP POLICY IF EXISTS own_swaps ON point_swaps;
CREATE POLICY own_swaps ON point_swaps FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE OR REPLACE FUNCTION wallet_swap(owner_id uuid,way text,quantity bigint,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old point_swaps%ROWTYPE; source text; target text; debit uuid; credit uuid; result uuid; batch uuid:=gen_random_uuid();
BEGIN
 IF quantity IS NULL OR quantity<=0 OR way IS NULL OR way NOT IN ('usdt_to_points','points_to_usdt') OR request IS NULL THEN RAISE EXCEPTION 'INVALID_SWAP'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||request::text,0));
 SELECT * INTO old FROM point_swaps WHERE user_id=owner_id AND request_key=request;
 IF FOUND THEN
  IF old.direction<>way OR old.amount<>quantity THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN old.id;
 END IF;
 IF EXISTS(SELECT 1 FROM transactions WHERE user_id=owner_id AND idempotency_key=request) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 PERFORM 1 FROM profiles WHERE id=owner_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 INSERT INTO balances(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 INSERT INTO point_balances(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM balances WHERE user_id=owner_id FOR UPDATE;
 PERFORM 1 FROM point_balances WHERE user_id=owner_id FOR UPDATE;
 IF way='usdt_to_points' THEN
  UPDATE balances SET available=available-quantity WHERE user_id=owner_id AND available>=quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  UPDATE point_balances SET available=available+quantity WHERE user_id=owner_id;
  source:='USDT';target:='POINT';
 ELSE
  UPDATE point_balances SET available=available-quantity WHERE user_id=owner_id AND available>=quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_POINTS'; END IF;
  UPDATE balances SET available=available+quantity WHERE user_id=owner_id;
  source:='POINT';target:='USDT';
 END IF;
 INSERT INTO transactions(user_id,kind,amount,status,idempotency_key,asset,destination) VALUES(owner_id,'swap_out',quantity,'completed',request,source,target) RETURNING id INTO debit;
 INSERT INTO transactions(user_id,kind,amount,status,asset,destination) VALUES(owner_id,'swap_in',quantity,'completed',target,source) RETURNING id INTO credit;
 INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
 (debit,batch,owner_id::text||':available',-quantity,source),(debit,batch,'swap:reserve',quantity,source),
 (credit,batch,'swap:reserve',-quantity,target),(credit,batch,owner_id::text||':available',quantity,target);
 INSERT INTO point_swaps(user_id,direction,amount,request_key,debit_id,credit_id) VALUES(owner_id,way,quantity,request,debit,credit) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wallet_swap(uuid,text,bigint,uuid),check_journal_balance() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION shop_purchase(buyer uuid,product uuid,qty integer,expected_version integer,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE p shop_products%ROWTYPE; old shop_orders%ROWTYPE; tx uuid; order_id uuid; batch uuid:=gen_random_uuid(); amount bigint;
BEGIN
 -- Serialize cross-member reward credits before taking buyer/product locks.
 PERFORM pg_advisory_xact_lock(9692027);
 IF qty IS NULL OR qty NOT BETWEEN 1 AND 99 OR request IS NULL THEN RAISE EXCEPTION 'INVALID_ORDER'; END IF;
 -- Share the financial request namespace with transfers and withdrawals.
 PERFORM pg_advisory_xact_lock(hashtextextended(buyer::text||request::text,0));
 SELECT * INTO old FROM shop_orders WHERE user_id=buyer AND request_key=request;
 IF FOUND THEN
  IF old.product_id<>product OR old.quantity<>qty OR old.product_version<>expected_version THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN old.id;
 END IF;
 IF EXISTS(SELECT 1 FROM transactions WHERE user_id=buyer AND idempotency_key=request) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 PERFORM 1 FROM profiles WHERE id=buyer AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 SELECT * INTO p FROM shop_products WHERE id=product FOR UPDATE;
 IF NOT FOUND OR NOT p.active THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE'; END IF;
 IF p.version<>expected_version THEN RAISE EXCEPTION 'PRICE_CHANGED'; END IF;
 IF p.stock<qty THEN RAISE EXCEPTION 'OUT_OF_STOCK'; END IF;
 amount:=p.price*qty;
 INSERT INTO point_balances(user_id) VALUES(buyer) ON CONFLICT DO NOTHING;
 UPDATE point_balances SET available=available-amount WHERE user_id=buyer AND available>=amount;
 IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_POINTS'; END IF;
 INSERT INTO transactions(user_id,kind,amount,status,destination,note,idempotency_key,asset)
 VALUES(buyer,'purchase',amount,'completed',product::text,p.name,request,'POINT') RETURNING id INTO tx;
 INSERT INTO shop_orders(user_id,product_id,quantity,product_name,product_description,product_image,unit_price,total,product_version,transaction_id,request_key,currency)
 VALUES(buyer,p.id,qty,p.name,p.description,p.image_url,p.price,amount,p.version,tx,request,'POINT') RETURNING id INTO order_id;
 UPDATE shop_products SET stock=stock-qty,version=version+1,updated_at=now() WHERE id=product;
 INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES(tx,batch,buyer::text||':available',-amount,'POINT'),(tx,batch,'shop:revenue',amount,'POINT');
 RETURN order_id;
END $$;
REVOKE ALL ON FUNCTION shop_purchase(uuid,uuid,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
