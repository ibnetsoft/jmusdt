ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS detail_blocks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(detail_blocks)='array' AND jsonb_array_length(detail_blocks)<=30);
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS product_detail_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION snapshot_order_detail() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 SELECT detail_blocks INTO NEW.product_detail_blocks FROM shop_products WHERE id=NEW.product_id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_detail_snapshot ON shop_orders;
CREATE TRIGGER order_detail_snapshot BEFORE INSERT ON shop_orders FOR EACH ROW EXECUTE FUNCTION snapshot_order_detail();
REVOKE ALL ON FUNCTION snapshot_order_detail() FROM PUBLIC,anon,authenticated;
