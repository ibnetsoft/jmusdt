-- Optional comparison price in micro-P. Purchases always charge shop_products.price.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS retail_price bigint
 CONSTRAINT product_retail_price_check CHECK (retail_price >= price);
COMMENT ON COLUMN shop_products.retail_price IS 'Optional consumer comparison price in micro-P; price is the actual member checkout price.';
