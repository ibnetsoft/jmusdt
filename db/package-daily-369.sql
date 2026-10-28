-- A narrow, explicit exception for the two package daily plans approved by the owner.
-- The entire 369-day liability is reserved at purchase. The price shortfall remains a
-- negative company revenue commitment (19,000 P / 190,000 P per package), never hidden issuance.
CREATE OR REPLACE FUNCTION marketing_plan_valid(v jsonb,price bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE k text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['referral','sponsor','mom','daily','days','lucky','treasure'] LOOP
  IF coalesce(v->>k,'') !~ '^[0-9]{1,16}$' THEN RETURN false; END IF;
 END LOOP;
 IF (v->>'days')::bigint>369 OR (v->>'lucky')::bigint>1000000 OR (v->>'treasure')::bigint>1000000 THEN RETURN false; END IF;
 IF ((v->>'daily')::bigint=0)<>((v->>'days')::bigint=0) THEN RETURN false; END IF;
 RETURN (v->>'referral')::numeric+(v->>'sponsor')::numeric+(v->>'mom')::numeric+(v->>'daily')::numeric*(v->>'days')::numeric+((v->>'lucky')::numeric+(v->>'treasure')::numeric)*1000000<=price;
END $$;
CREATE OR REPLACE FUNCTION marketing_plan_valid(v jsonb,price bigint,package_kind text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
BEGIN
 IF marketing_plan_valid(v,price) THEN RETURN true; END IF;
 RETURN coalesce(
  (package_kind='lucky' AND price=350000000000 AND v='{"referral":"0","sponsor":"0","mom":"0","daily":"1000000000","days":369,"lucky":0,"treasure":0}'::jsonb)
  OR (package_kind='treasure' AND price=3500000000000 AND v='{"referral":"0","sponsor":"0","mom":"0","daily":"10000000000","days":369,"lucky":0,"treasure":0}'::jsonb),false);
END $$;
ALTER TABLE shop_products DROP CONSTRAINT IF EXISTS product_reward_budget;
ALTER TABLE shop_products ADD CONSTRAINT product_reward_budget CHECK(marketing_plan_valid(reward_plan,price,package_type));
REVOKE ALL ON FUNCTION marketing_plan_valid(jsonb,bigint,text) FROM PUBLIC,anon,authenticated;
