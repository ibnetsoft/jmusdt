-- Product-specific POINT rewards. Existing products default to all zero.
CREATE OR REPLACE FUNCTION marketing_plan_valid(v jsonb, price bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE k text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['referral','sponsor','mom','daily','days','lucky','treasure'] LOOP
  IF coalesce(v->>k,'') !~ '^[0-9]{1,16}$' THEN RETURN false; END IF;
 END LOOP;
 IF (v->>'days')::bigint>369 OR (v->>'lucky')::bigint>1000000 OR (v->>'treasure')::bigint>1000000 THEN RETURN false; END IF;
 IF ((v->>'daily')::bigint=0)<>( (v->>'days')::bigint=0) THEN RETURN false; END IF;
 RETURN (v->>'referral')::numeric+(v->>'sponsor')::numeric+(v->>'mom')::numeric+(v->>'daily')::numeric*(v->>'days')::numeric<=price;
END $$;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS reward_plan jsonb NOT NULL DEFAULT '{"referral":"0","sponsor":"0","mom":"0","daily":"0","days":0,"lucky":0,"treasure":0}';
-- Keep the newer package-aware constraint when repeatable base migrations are rerun.
DO $$ BEGIN
 IF to_regprocedure('marketing_plan_valid(jsonb,bigint,text)') IS NULL THEN
  ALTER TABLE shop_products DROP CONSTRAINT IF EXISTS product_reward_budget;
  ALTER TABLE shop_products ADD CONSTRAINT product_reward_budget CHECK(marketing_plan_valid(reward_plan,price));
 END IF;
END $$;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS reward_snapshot jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS marketing_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT true,
 daily_paused boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO marketing_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS marketing_rewards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES shop_orders(id),
 user_id uuid REFERENCES profiles(id), type text NOT NULL CHECK(type IN ('referral','sponsor','mom','lucky','treasure','daily')),
 installment integer NOT NULL DEFAULT 0, amount bigint NOT NULL CHECK(amount>0),
 due_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
 status text NOT NULL CHECK(status IN ('scheduled','paid','skipped','reversed','void')),
 reason text NOT NULL DEFAULT '', transaction_id uuid REFERENCES transactions(id), reversal_id uuid REFERENCES transactions(id),
 created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz,
 UNIQUE(order_id,type,installment)
);
CREATE INDEX IF NOT EXISTS marketing_due ON marketing_rewards(due_date,id) WHERE status='scheduled';
CREATE INDEX IF NOT EXISTS marketing_user ON marketing_rewards(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS marketing_debts (
 reward_id uuid PRIMARY KEY REFERENCES marketing_rewards(id), user_id uuid NOT NULL REFERENCES profiles(id),
 outstanding bigint NOT NULL CHECK(outstanding>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_debtor ON marketing_debts(user_id) WHERE outstanding>0;
ALTER TABLE marketing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_debts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketing_settings,marketing_rewards,marketing_debts FROM anon,authenticated;
GRANT SELECT ON marketing_rewards,marketing_debts TO authenticated;
DROP POLICY IF EXISTS own_rewards ON marketing_rewards;
CREATE POLICY own_rewards ON marketing_rewards FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS own_reward_debts ON marketing_debts;
CREATE POLICY own_reward_debts ON marketing_debts FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

-- New kinds must also be accepted by the earlier repeatable schema files.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','purchase','swap_in','swap_out','refund','reward','reward_reversal','reward_recovery'));

-- Recover spent cancelled rewards from future POINT credits, without negative balances.
CREATE OR REPLACE FUNCTION marketing_offset_credit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE incoming bigint; left_over bigint; take bigint; d record; tx uuid; batch uuid:=gen_random_uuid();
BEGIN
 incoming:=NEW.available-CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.available END;
 IF incoming<=0 THEN RETURN NEW; END IF;
 left_over:=incoming;
 FOR d IN SELECT * FROM marketing_debts WHERE user_id=NEW.user_id AND outstanding>0 ORDER BY created_at,reward_id FOR UPDATE LOOP
  take:=least(left_over,d.outstanding);
  UPDATE marketing_debts SET outstanding=outstanding-take WHERE reward_id=d.reward_id;
  left_over:=left_over-take;
  EXIT WHEN left_over=0;
 END LOOP;
 take:=incoming-left_over;
 IF take>0 THEN
  NEW.available:=NEW.available-take;
  INSERT INTO transactions(user_id,kind,amount,status,asset,note) VALUES(NEW.user_id,'reward_recovery',take,'completed','POINT','취소 보상 미수금 자동 상계') RETURNING id INTO tx;
  INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
   (tx,batch,NEW.user_id::text||':available',-take,'POINT'),(tx,batch,'marketing:receivable',take,'POINT');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketing_credit_offset ON point_balances;
CREATE TRIGGER marketing_credit_offset BEFORE INSERT OR UPDATE OF available ON point_balances FOR EACH ROW EXECUTE FUNCTION marketing_offset_credit();

CREATE OR REPLACE FUNCTION marketing_pay(reward_key uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r marketing_rewards%ROWTYPE; tx uuid; batch uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO r FROM marketing_rewards WHERE id=reward_key FOR UPDATE;
 IF NOT FOUND OR r.status<>'scheduled' OR r.due_date>(now() AT TIME ZONE 'Asia/Seoul')::date THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=r.user_id AND status='active') THEN RETURN false; END IF;
 INSERT INTO point_balances(user_id) VALUES(r.user_id) ON CONFLICT DO NOTHING;
 UPDATE point_balances SET available=available+r.amount WHERE user_id=r.user_id;
 INSERT INTO transactions(user_id,kind,amount,status,asset,destination,note) VALUES(r.user_id,'reward',r.amount,'completed','POINT',r.order_id::text,r.type) RETURNING id INTO tx;
 INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
  (tx,batch,CASE WHEN r.type='daily' THEN 'marketing:reserve' ELSE 'shop:revenue' END,-r.amount,'POINT'),
  (tx,batch,r.user_id::text||':available',r.amount,'POINT');
 UPDATE marketing_rewards SET status='paid',transaction_id=tx,paid_at=now() WHERE id=r.id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION marketing_order_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE p jsonb; ref uuid; sponsor uuid; mom uuid; cfg marketing_settings%ROWTYPE;
BEGIN
 SELECT * INTO cfg FROM marketing_settings WHERE id=true;
 SELECT reward_plan INTO p FROM shop_products WHERE id=NEW.product_id;
 SELECT referrer_id,sponsor_id INTO ref,sponsor FROM member_network WHERE user_id=NEW.user_id;
 SELECT referrer_id INTO mom FROM member_network WHERE user_id=sponsor;
 -- Prevent self-rewards and require an actual sponsor payment for mom matching.
 IF ref=NEW.user_id THEN ref:=NULL; END IF;
 IF sponsor=NEW.user_id THEN sponsor:=NULL; END IF;
 IF mom=NEW.user_id OR mom=sponsor THEN mom:=NULL; END IF;
 NEW.reward_snapshot:=jsonb_build_object('plan',p,'referral',ref,'sponsor',sponsor,'mom',mom,'enabled',cfg.enabled AND NEW.currency='POINT','settingsVersion',cfg.version);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_reward_snapshot ON shop_orders;
CREATE TRIGGER order_reward_snapshot BEFORE INSERT ON shop_orders FOR EACH ROW EXECUTE FUNCTION marketing_order_snapshot();

CREATE OR REPLACE FUNCTION marketing_purchase_rewards() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE p jsonb:=NEW.reward_snapshot->'plan'; k text; recipient uuid; units bigint; r uuid; sponsor_paid boolean:=false; eligible boolean; batch uuid:=gen_random_uuid();
BEGIN
 IF NOT coalesce((NEW.reward_snapshot->>'enabled')::boolean,false) THEN RETURN NEW; END IF;
 FOREACH k IN ARRAY ARRAY['referral','sponsor','mom'] LOOP
  units:=(p->>k)::bigint*NEW.quantity;
  IF units=0 THEN CONTINUE; END IF;
  recipient:=(NEW.reward_snapshot->>k)::uuid;
  eligible:=recipient IS NOT NULL AND EXISTS(SELECT 1 FROM profiles WHERE id=recipient AND status='active') AND (k<>'mom' OR sponsor_paid);
  INSERT INTO marketing_rewards(order_id,user_id,type,amount,status,reason)
   VALUES(NEW.id,recipient,k,units,CASE WHEN eligible THEN 'scheduled' ELSE 'skipped' END,CASE WHEN eligible THEN '' ELSE '수령인 없음·차단 또는 후원리워드 미지급' END) RETURNING id INTO r;
  IF eligible THEN
   IF marketing_pay(r) THEN
    IF k='sponsor' THEN sponsor_paid:=true; END IF;
   ELSE
    UPDATE marketing_rewards SET status='skipped',reason='수령인 지급 자격 변경' WHERE id=r;
   END IF;
  END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['lucky','treasure'] LOOP
  units:=(p->>k)::bigint*NEW.quantity;
  IF units>0 THEN INSERT INTO marketing_rewards(order_id,user_id,type,amount,status,paid_at) VALUES(NEW.id,NEW.user_id,k,units,'paid',now()); END IF;
 END LOOP;
 units:=(p->>'daily')::bigint*NEW.quantity;
 IF units>0 THEN
  INSERT INTO marketing_rewards(order_id,user_id,type,installment,amount,due_date,status)
   SELECT NEW.id,NEW.user_id,'daily',i,units,(now() AT TIME ZONE 'Asia/Seoul')::date+i,'scheduled' FROM generate_series(1,(p->>'days')::integer) i;
  INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
   (NEW.transaction_id,batch,'shop:revenue',-units*(p->>'days')::integer,'POINT'),
   (NEW.transaction_id,batch,'marketing:reserve',units*(p->>'days')::integer,'POINT');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_marketing_rewards ON shop_orders;
CREATE TRIGGER order_marketing_rewards AFTER INSERT ON shop_orders FOR EACH ROW EXECUTE FUNCTION marketing_purchase_rewards();

CREATE OR REPLACE FUNCTION marketing_refund_rewards() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r record; tx uuid; take bigint; batch uuid; available_units bigint;
BEGIN
 IF NEW.status<>'cancelled' OR OLD.status='cancelled' THEN RETURN NEW; END IF;
 FOR r IN SELECT * FROM marketing_rewards WHERE order_id=NEW.id ORDER BY user_id,id FOR UPDATE LOOP
  batch:=gen_random_uuid();
  IF r.status='scheduled' AND r.type='daily' THEN
   INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
    (NEW.refund_transaction_id,batch,'marketing:reserve',-r.amount,'POINT'),(NEW.refund_transaction_id,batch,'shop:revenue',r.amount,'POINT');
   UPDATE marketing_rewards SET status='void',reason='주문 취소: 미지급 권리 종료' WHERE id=r.id;
  ELSIF r.status='paid' AND r.type IN ('lucky','treasure') THEN
   UPDATE marketing_rewards SET status='reversed',reason='주문 취소: 주머니 수량 회수' WHERE id=r.id;
  ELSIF r.status='paid' THEN
   SELECT available INTO available_units FROM point_balances WHERE user_id=r.user_id FOR UPDATE;
   take:=least(coalesce(available_units,0),r.amount);
   UPDATE point_balances SET available=available-take WHERE user_id=r.user_id;
   INSERT INTO transactions(user_id,kind,amount,status,asset,destination,note) VALUES(r.user_id,'reward_reversal',r.amount,'completed','POINT',NEW.id::text,'주문 취소 보상 회수') RETURNING id INTO tx;
   IF take>0 THEN INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES(tx,batch,r.user_id::text||':available',-take,'POINT'); END IF;
   IF take<r.amount THEN
    INSERT INTO marketing_debts(reward_id,user_id,outstanding) VALUES(r.id,r.user_id,r.amount-take);
    INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES(tx,batch,'marketing:receivable',-(r.amount-take),'POINT');
   END IF;
   INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES(tx,batch,'shop:revenue',r.amount,'POINT');
   UPDATE marketing_rewards SET status='reversed',reversal_id=tx,reason='주문 취소: 잔액 회수 및 부족분 미수금 기록' WHERE id=r.id;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS refund_marketing_rewards ON shop_orders;
CREATE TRIGGER refund_marketing_rewards AFTER UPDATE OF status ON shop_orders FOR EACH ROW EXECUTE FUNCTION marketing_refund_rewards();

-- Bounded work, order lock first (same as refund), and unique rewards prevent replay.
DROP FUNCTION IF EXISTS marketing_run_daily();
CREATE OR REPLACE FUNCTION marketing_run_daily(scope_order uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE entry record; item record; paid integer:=0;
BEGIN
 IF (SELECT daily_paused FROM marketing_settings WHERE id=true) THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(9692027);
 FOR entry IN SELECT o.id FROM shop_orders o WHERE o.status='paid' AND (scope_order IS NULL OR o.id=scope_order) AND EXISTS(
   SELECT 1 FROM marketing_rewards r JOIN profiles p ON p.id=r.user_id WHERE r.order_id=o.id AND r.status='scheduled' AND p.status='active' AND r.due_date<=(now() AT TIME ZONE 'Asia/Seoul')::date
  ) ORDER BY o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED LOOP
  FOR item IN SELECT id FROM marketing_rewards WHERE order_id=entry.id AND status='scheduled' AND due_date<=(now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY due_date,id LIMIT 500 LOOP
   IF marketing_pay(item.id) THEN paid:=paid+1; END IF;
   IF paid>=500 THEN RETURN paid; END IF;
  END LOOP;
 END LOOP;
 RETURN paid;
END $$;
REVOKE ALL ON FUNCTION marketing_offset_credit(),marketing_pay(uuid),marketing_order_snapshot(),marketing_purchase_rewards(),marketing_refund_rewards(),marketing_run_daily(uuid) FROM PUBLIC,anon,authenticated;
