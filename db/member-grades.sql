-- Membership grades are separate from authorization and never grant admin rights.
CREATE TABLE IF NOT EXISTS member_grades (
 code text PRIMARY KEY CHECK(length(code) BETWEEN 1 AND 80),
 name text UNIQUE NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO member_grades(code,name) VALUES('general','일반회원'),('vip','정회원') ON CONFLICT(code) DO NOTHING;
UPDATE member_grades SET name='정회원' WHERE code='vip' AND name='VIP회원';
ALTER TABLE member_grades ADD COLUMN IF NOT EXISTS reward_eligible boolean NOT NULL DEFAULT false;
UPDATE member_grades SET reward_eligible=(code='vip') WHERE code IN ('general','vip');
ALTER TABLE member_grades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON member_grades FROM PUBLIC,anon,authenticated;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS grade_code text NOT NULL DEFAULT 'general' REFERENCES member_grades(code);
CREATE INDEX IF NOT EXISTS profiles_grade_code_idx ON profiles(grade_code);
CREATE INDEX IF NOT EXISTS shop_orders_member_vip_total ON shop_orders(user_id) WHERE currency='POINT' AND status IN ('paid','cancellation_requested');
WITH eligible AS (
 SELECT user_id FROM shop_orders WHERE currency='POINT' AND status IN ('paid','cancellation_requested') GROUP BY user_id HAVING sum(total)>=50000000000
), upgraded AS (
 UPDATE profiles p SET grade_code='vip' FROM eligible e WHERE p.id=e.user_id AND p.grade_code='general' RETURNING p.id
)
INSERT INTO audit_logs(actor,action,details) SELECT id,'member.grade_auto_vip',jsonb_build_object('source','existing_purchases') FROM upgraded;

-- Once earned, 정회원 is retained after a refund; custom grades are never overwritten.
CREATE OR REPLACE FUNCTION member_grade_purchase() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE total_points numeric;
BEGIN
 IF NEW.currency <> 'POINT' THEN RETURN NEW; END IF;
 NEW.created_at:=clock_timestamp();
 SELECT coalesce(sum(total),0)+NEW.total INTO total_points FROM shop_orders WHERE user_id=NEW.user_id AND currency='POINT' AND status IN ('paid','cancellation_requested');
 IF total_points >= 50000000000 THEN
  UPDATE profiles SET grade_code='vip' WHERE id=NEW.user_id AND grade_code='general';
  IF FOUND THEN INSERT INTO audit_logs(actor,action,details) VALUES(NEW.user_id,'member.grade_auto_vip',jsonb_build_object('orderId',NEW.id,'totalPointsUnits',total_points::text)); END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_member_grade ON shop_orders;
DROP TRIGGER IF EXISTS order_00_member_grade ON shop_orders;
-- Qualify and place before the reward recipient snapshot of this purchase.
CREATE TRIGGER order_00_member_grade BEFORE INSERT ON shop_orders FOR EACH ROW EXECUTE FUNCTION member_grade_purchase();
REVOKE ALL ON FUNCTION member_grade_purchase() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION member_reward_eligible(member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p JOIN member_grades g ON g.code=p.grade_code
 JOIN auth.users u ON u.id=p.id WHERE p.id=member AND p.status='active' AND g.reward_eligible AND u.email_confirmed_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION member_reward_eligible(uuid) FROM PUBLIC,anon,authenticated;

