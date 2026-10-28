-- Full-order refunds. Original purchases/journal entries remain immutable.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','purchase','swap_in','swap_out','refund','reward','reward_reversal','reward_recovery'));
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'paid' CHECK(status IN ('paid','cancellation_requested','cancelled'));
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cancellation_reason text NOT NULL DEFAULT '';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refund_reason text NOT NULL DEFAULT '';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refund_transaction_id uuid UNIQUE REFERENCES transactions(id);
CREATE INDEX IF NOT EXISTS shop_orders_status_created ON shop_orders(status,created_at DESC);
CREATE OR REPLACE FUNCTION shop_refund(order_key uuid,actor_id uuid,reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE entry shop_orders%ROWTYPE; owner_id uuid; tx uuid; batch uuid:=gen_random_uuid();
BEGIN
 PERFORM pg_advisory_xact_lock(9692027);
 IF actor_id IS NULL OR reason IS NULL OR length(trim(reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REFUND'; END IF;
 SELECT user_id INTO owner_id FROM shop_orders WHERE id=order_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 -- Same owner/product/balance lock order as checkout, including blocked owners.
 PERFORM 1 FROM profiles WHERE id=owner_id FOR UPDATE;
 SELECT * INTO entry FROM shop_orders WHERE id=order_key FOR UPDATE;
 IF entry.status='cancelled' THEN RETURN entry.refund_transaction_id; END IF;
 PERFORM 1 FROM shop_products WHERE id=entry.product_id FOR UPDATE;
 IF entry.currency='POINT' THEN
  INSERT INTO point_balances(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
  UPDATE point_balances SET available=available+entry.total WHERE user_id=owner_id;
 ELSE
  UPDATE balances SET available=available+entry.total WHERE user_id=owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 END IF;
 INSERT INTO transactions(user_id,kind,amount,status,asset,destination,note)
 VALUES(owner_id,'refund',entry.total,'completed',entry.currency,entry.id::text,trim(reason)) RETURNING id INTO tx;
 INSERT INTO journal(transaction_id,batch_id,account,units,asset) VALUES
 (tx,batch,'shop:revenue',-entry.total,entry.currency),(tx,batch,owner_id::text||':available',entry.total,entry.currency);
 UPDATE shop_products SET stock=stock+entry.quantity,version=version+1,updated_at=now() WHERE id=entry.product_id;
 UPDATE shop_orders SET status='cancelled',refund_reason=trim(reason),cancelled_at=now(),cancelled_by=actor_id,refund_transaction_id=tx WHERE id=order_key;
 INSERT INTO audit_logs(actor,action,details) VALUES(actor_id,'order.refunded',jsonb_build_object('orderId',entry.id,'transactionId',tx,'amount',entry.total::text,'currency',entry.currency,'quantity',entry.quantity,'reason',trim(reason)));
 RETURN tx;
END $$;
REVOKE ALL ON FUNCTION shop_refund(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
