-- Package type is explicitly selected by the administrator; legacy products are ordinary.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS package_type text NOT NULL DEFAULT 'none' CHECK(package_type IN ('none','lucky','treasure'));
ALTER TABLE shop_products DROP CONSTRAINT IF EXISTS package_price_check;
ALTER TABLE shop_products ADD CONSTRAINT package_price_check CHECK(package_type='none' OR (package_type='lucky' AND price=350000000000) OR (package_type='treasure' AND price=3500000000000));
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS package_type text NOT NULL DEFAULT 'none' CHECK(package_type IN ('none','lucky','treasure'));
CREATE INDEX IF NOT EXISTS package_holdings ON shop_orders(package_type,created_at,user_id) WHERE package_type IN ('lucky','treasure') AND status IN ('paid','cancellation_requested');
CREATE OR REPLACE FUNCTION snapshot_order_package_type() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 SELECT package_type INTO NEW.package_type FROM shop_products WHERE id=NEW.product_id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_package_snapshot ON shop_orders;
CREATE TRIGGER order_package_snapshot BEFORE INSERT ON shop_orders FOR EACH ROW EXECUTE FUNCTION snapshot_order_package_type();
REVOKE ALL ON FUNCTION snapshot_order_package_type() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION marketing_plan_valid(v jsonb,price bigint) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE k text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['referral','sponsor','mom','daily','days','lucky','treasure'] LOOP
  IF coalesce(v->>k,'') !~ '^[0-9]{1,16}$' THEN RETURN false; END IF;
 END LOOP;
 IF (v->>'days')::bigint>365 OR (v->>'lucky')::bigint>1000000 OR (v->>'treasure')::bigint>1000000 THEN RETURN false; END IF;
 IF ((v->>'daily')::bigint=0)<>((v->>'days')::bigint=0) THEN RETURN false; END IF;
 RETURN (v->>'referral')::numeric+(v->>'sponsor')::numeric+(v->>'mom')::numeric+(v->>'daily')::numeric*(v->>'days')::numeric+((v->>'lucky')::numeric+(v->>'treasure')::numeric)*1000000<=price;
END $$;
ALTER TABLE shop_products DROP CONSTRAINT IF EXISTS product_reward_budget;
ALTER TABLE shop_products ADD CONSTRAINT product_reward_budget CHECK(marketing_plan_valid(reward_plan,price));

CREATE TABLE IF NOT EXISTS daily_pool_entries (
 order_id uuid NOT NULL REFERENCES shop_orders(id), kind text NOT NULL CHECK(kind IN ('lucky','treasure')),
 cutoff timestamptz NOT NULL, amount bigint NOT NULL CHECK(amount>0),
 cancelled_at timestamptz, settled_at timestamptz, PRIMARY KEY(order_id,kind)
);
CREATE INDEX IF NOT EXISTS daily_pool_due ON daily_pool_entries(cutoff,kind) WHERE settled_at IS NULL AND cancelled_at IS NULL;
CREATE TABLE IF NOT EXISTS daily_pool_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('lucky','treasure')),
 cutoff timestamptz NOT NULL,total bigint NOT NULL,distributed bigint NOT NULL DEFAULT 0,retained bigint NOT NULL DEFAULT 0,
 package_count bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,cutoff)
);
CREATE TABLE IF NOT EXISTS daily_pool_payments (
 run_id uuid NOT NULL REFERENCES daily_pool_runs(id),user_id uuid NOT NULL REFERENCES profiles(id),
 quantity bigint NOT NULL CHECK(quantity>0),amount bigint NOT NULL CHECK(amount>=0),transaction_id uuid UNIQUE REFERENCES transactions(id),
 PRIMARY KEY(run_id,user_id)
);
ALTER TABLE daily_pool_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_pool_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_pool_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON daily_pool_entries,daily_pool_runs,daily_pool_payments FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION daily_pool_purchase() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE k text; units bigint; batch uuid; local_day date; due timestamptz;
BEGIN
 IF NEW.currency<>'POINT' THEN RETURN NEW; END IF;
 local_day:=(NEW.created_at AT TIME ZONE 'Asia/Seoul')::date;
 due:=((local_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul');
 FOREACH k IN ARRAY ARRAY['lucky','treasure'] LOOP
  units:=coalesce((NEW.reward_snapshot->'plan'->>k)::bigint,0)*NEW.quantity*1000000;
  IF units>0 THEN
   INSERT INTO daily_pool_entries(order_id,kind,cutoff,amount) VALUES(NEW.id,k,due,units);
   batch:=gen_random_uuid();
   INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
    (NEW.transaction_id,batch,'shop:revenue',-units,'POINT'),(NEW.transaction_id,batch,'daily:pool_reserve',units,'POINT');
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_daily_pool ON shop_orders;
CREATE TRIGGER order_daily_pool AFTER INSERT ON shop_orders FOR EACH ROW EXECUTE FUNCTION daily_pool_purchase();

CREATE OR REPLACE FUNCTION daily_pool_refund() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item record; batch uuid;
BEGIN
 IF NEW.status<>'cancelled' OR OLD.status='cancelled' THEN RETURN NEW; END IF;
 FOR item IN UPDATE daily_pool_entries SET cancelled_at=now() WHERE order_id=NEW.id AND cancelled_at IS NULL AND settled_at IS NULL RETURNING amount LOOP
  batch:=gen_random_uuid();
  INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
   (NEW.refund_transaction_id,batch,'daily:pool_reserve',-item.amount,'POINT'),(NEW.refund_transaction_id,batch,'shop:revenue',item.amount,'POINT');
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS refund_daily_pool ON shop_orders;
CREATE TRIGGER refund_daily_pool AFTER UPDATE OF status ON shop_orders FOR EACH ROW EXECUTE FUNCTION daily_pool_refund();

CREATE OR REPLACE FUNCTION daily_pool_settle(pool_kind text,pool_cutoff timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE run_id uuid; pool bigint; total_qty bigint; member record; share bigint; paid bigint:=0; tx uuid; batch uuid; reference_tx uuid;
BEGIN
 IF pool_kind NOT IN ('lucky','treasure') OR pool_cutoff>now() OR (pool_cutoff AT TIME ZONE 'Asia/Seoul')::time<>time '00:00' THEN RAISE EXCEPTION 'INVALID_DAILY_CUTOFF'; END IF;
 PERFORM pg_advisory_xact_lock(9692027);
 SELECT id INTO run_id FROM daily_pool_runs WHERE kind=pool_kind AND cutoff=pool_cutoff;
 IF FOUND THEN RETURN run_id; END IF;
 SELECT coalesce(sum(amount),0)::bigint INTO pool FROM daily_pool_entries WHERE kind=pool_kind AND cutoff=pool_cutoff AND settled_at IS NULL AND cancelled_at IS NULL;
 SELECT coalesce(sum(quantity),0)::bigint INTO total_qty FROM shop_orders WHERE package_type=pool_kind AND created_at<pool_cutoff AND status IN ('paid','cancellation_requested') AND member_reward_eligible(user_id) AND EXISTS(SELECT 1 FROM member_network n WHERE n.user_id=shop_orders.user_id AND n.activated_at<pool_cutoff);
 INSERT INTO daily_pool_runs(kind,cutoff,total,package_count) VALUES(pool_kind,pool_cutoff,pool,total_qty) RETURNING id INTO run_id;
 IF pool>0 AND total_qty>0 THEN
  FOR member IN SELECT user_id,sum(quantity)::bigint AS quantity FROM shop_orders WHERE package_type=pool_kind AND created_at<pool_cutoff AND status IN ('paid','cancellation_requested') AND member_reward_eligible(user_id) AND EXISTS(SELECT 1 FROM member_network n WHERE n.user_id=shop_orders.user_id AND n.activated_at<pool_cutoff) GROUP BY user_id ORDER BY user_id LOOP
   share:=floor(pool::numeric*member.quantity/total_qty)::bigint; tx:=NULL;
   IF share>0 THEN
    INSERT INTO point_balances(user_id) VALUES(member.user_id) ON CONFLICT DO NOTHING;
    UPDATE point_balances SET available=available+share WHERE user_id=member.user_id;
    INSERT INTO transactions(user_id,kind,amount,status,asset,destination,note) VALUES(member.user_id,'reward',share,'completed','POINT',run_id::text,'일일 '||pool_kind||' 분배') RETURNING id INTO tx;
    batch:=gen_random_uuid();
    INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES(tx,batch,'daily:pool_reserve',-share,'POINT'),(tx,batch,member.user_id::text||':available',share,'POINT');
    paid:=paid+share;
   END IF;
   INSERT INTO daily_pool_payments(run_id,user_id,quantity,amount,transaction_id) VALUES(run_id,member.user_id,member.quantity,share,tx);
  END LOOP;
 END IF;
 IF pool>paid THEN
  SELECT o.transaction_id INTO reference_tx FROM daily_pool_entries e JOIN shop_orders o ON o.id=e.order_id WHERE e.kind=pool_kind AND e.cutoff=pool_cutoff AND e.settled_at IS NULL AND e.cancelled_at IS NULL ORDER BY e.order_id LIMIT 1;
  batch:=gen_random_uuid();
  INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES(reference_tx,batch,'daily:pool_reserve',-(pool-paid),'POINT'),(reference_tx,batch,'shop:revenue',pool-paid,'POINT');
 END IF;
 UPDATE daily_pool_runs SET distributed=paid,retained=pool-paid WHERE id=run_id;
 UPDATE daily_pool_entries SET settled_at=now() WHERE kind=pool_kind AND cutoff=pool_cutoff AND cancelled_at IS NULL AND settled_at IS NULL;
 INSERT INTO audit_logs(action,details) VALUES('marketing.pools_settled',jsonb_build_object('runId',run_id,'kind',pool_kind,'cutoff',pool_cutoff,'total',pool::text,'paid',paid::text,'retained',(pool-paid)::text,'packages',total_qty));
 RETURN run_id;
END $$;
REVOKE ALL ON FUNCTION daily_pool_purchase(),daily_pool_refund(),daily_pool_settle(text,timestamptz) FROM PUBLIC,anon,authenticated;

-- Preserve direct referral, sponsor, mom and daily logic, but never pay the company pools directly to a buyer.
CREATE OR REPLACE FUNCTION marketing_purchase_rewards() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE p jsonb:=NEW.reward_snapshot->'plan'; k text; recipient uuid; units bigint; r uuid; sponsor_paid boolean:=false; eligible boolean; batch uuid:=gen_random_uuid();
BEGIN
 IF NOT coalesce((NEW.reward_snapshot->>'enabled')::boolean,false) THEN RETURN NEW; END IF;
 FOREACH k IN ARRAY ARRAY['referral','sponsor','mom'] LOOP
  units:=(p->>k)::bigint*NEW.quantity;
  IF units=0 THEN CONTINUE; END IF;
  recipient:=(NEW.reward_snapshot->>k)::uuid;
  eligible:=member_reward_eligible(recipient) AND (k<>'mom' OR sponsor_paid);
  INSERT INTO marketing_rewards(order_id,user_id,type,amount,status,reason)
   VALUES(NEW.id,recipient,k,units,CASE WHEN eligible THEN 'scheduled' ELSE 'skipped' END,CASE WHEN eligible THEN '' ELSE '정회원 수령인 없음·이용 제한 또는 후원리워드 미지급' END) RETURNING id INTO r;
  IF eligible THEN
   IF marketing_pay(r) THEN
    IF k='sponsor' THEN sponsor_paid:=true; END IF;
   ELSE
    UPDATE marketing_rewards SET status='skipped',reason='수령인 지급 자격 변경' WHERE id=r;
   END IF;
  END IF;
 END LOOP;

 units:=(p->>'daily')::bigint*NEW.quantity;
 IF units>0 AND member_reward_eligible(NEW.user_id) THEN
  INSERT INTO marketing_rewards(order_id,user_id,type,installment,amount,due_date,status)
   SELECT NEW.id,NEW.user_id,'daily',i,units,(NEW.created_at AT TIME ZONE 'Asia/Seoul')::date+i,'scheduled' FROM generate_series(1,(p->>'days')::integer) i;
  INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
   (NEW.transaction_id,batch,'shop:revenue',-units*(p->>'days')::integer,'POINT'),
   (NEW.transaction_id,batch,'marketing:reserve',units*(p->>'days')::integer,'POINT');
 END IF;
 RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION marketing_pay(reward_key uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r marketing_rewards%ROWTYPE; tx uuid; batch uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO r FROM marketing_rewards WHERE id=reward_key FOR UPDATE;
 IF NOT FOUND OR r.status<>'scheduled' OR r.due_date>(now() AT TIME ZONE 'Asia/Seoul')::date THEN RETURN false; END IF;
 IF NOT member_reward_eligible(r.user_id) THEN RETURN false; END IF;
 INSERT INTO point_balances(user_id) VALUES(r.user_id) ON CONFLICT DO NOTHING;
 UPDATE point_balances SET available=available+r.amount WHERE user_id=r.user_id;
 INSERT INTO transactions(user_id,kind,amount,status,asset,destination,note) VALUES(r.user_id,'reward',r.amount,'completed','POINT',r.order_id::text,r.type) RETURNING id INTO tx;
 INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
  (tx,batch,CASE WHEN r.type='daily' THEN 'marketing:reserve' ELSE 'shop:revenue' END,-r.amount,'POINT'),
  (tx,batch,r.user_id::text||':available',r.amount,'POINT');
 UPDATE marketing_rewards SET status='paid',transaction_id=tx,paid_at=now() WHERE id=r.id;
 RETURN true;
END $$;


CREATE OR REPLACE FUNCTION marketing_run_daily(scope_order uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE entry record; item record; paid integer:=0;
BEGIN
 IF (SELECT daily_paused FROM marketing_settings WHERE id=true) THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(9692027);
 FOR entry IN SELECT o.id FROM shop_orders o WHERE o.status='paid' AND (scope_order IS NULL OR o.id=scope_order) AND EXISTS(
   SELECT 1 FROM marketing_rewards r JOIN profiles p ON p.id=r.user_id WHERE r.order_id=o.id AND r.status='scheduled' AND member_reward_eligible(r.user_id) AND r.due_date<=(now() AT TIME ZONE 'Asia/Seoul')::date
  ) ORDER BY o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED LOOP
  FOR item IN SELECT id FROM marketing_rewards WHERE order_id=entry.id AND status='scheduled' AND due_date<=(now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY due_date,id LIMIT 500 LOOP
   IF marketing_pay(item.id) THEN paid:=paid+1; END IF;
   IF paid>=500 THEN RETURN paid; END IF;
  END LOOP;
 END LOOP;
 RETURN paid;
END $$;
