-- Additive commerce schema; run after schema.sql using a trusted backend role.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','purchase'));
CREATE TABLE IF NOT EXISTS shop_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '', image_url text NOT NULL DEFAULT '',
 price bigint NOT NULL CHECK(price>0), stock integer NOT NULL CHECK(stock>=0),
 active boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shop_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 product_id uuid NOT NULL REFERENCES shop_products(id), quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 product_name text NOT NULL, product_description text NOT NULL, product_image text NOT NULL,
 unit_price bigint NOT NULL CHECK(unit_price>0), total bigint NOT NULL CHECK(total>0),
 product_version integer NOT NULL, transaction_id uuid UNIQUE NOT NULL REFERENCES transactions(id),
 request_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS shop_orders_owner ON shop_orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_product ON shop_orders(product_id);
ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shop_products,shop_orders FROM anon,authenticated;
GRANT SELECT ON shop_products,shop_orders TO authenticated;
DROP POLICY IF EXISTS shop_visible ON shop_products;
CREATE POLICY shop_visible ON shop_products FOR SELECT TO authenticated USING(active);
DROP POLICY IF EXISTS shop_owned ON shop_orders;
CREATE POLICY shop_owned ON shop_orders FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE OR REPLACE FUNCTION shop_purchase(buyer uuid,product uuid,qty integer,expected_version integer,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE p shop_products%ROWTYPE; old shop_orders%ROWTYPE; tx uuid; order_id uuid; batch uuid:=gen_random_uuid(); amount bigint;
BEGIN
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
 UPDATE balances SET available=available-amount WHERE user_id=buyer AND available>=amount;
 IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
 INSERT INTO transactions(user_id,kind,amount,status,destination,note,idempotency_key)
 VALUES(buyer,'purchase',amount,'completed',product::text,p.name,request) RETURNING id INTO tx;
 INSERT INTO shop_orders(user_id,product_id,quantity,product_name,product_description,product_image,unit_price,total,product_version,transaction_id,request_key)
 VALUES(buyer,p.id,qty,p.name,p.description,p.image_url,p.price,amount,p.version,tx,request) RETURNING id INTO order_id;
 UPDATE shop_products SET stock=stock-qty,version=version+1,updated_at=now() WHERE id=product;
 INSERT INTO journal(transaction_id,batch_id,account,units) VALUES(tx,batch,buyer::text||':available',-amount),(tx,batch,'shop:revenue',amount);
 RETURN order_id;
END $$;
REVOKE ALL ON FUNCTION shop_purchase(uuid,uuid,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
