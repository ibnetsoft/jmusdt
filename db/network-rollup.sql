-- A referral relation is immutable. Sponsorship is assigned once, in qualification order.
DROP INDEX IF EXISTS network_slot;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='member_network'::regclass AND contype='c'
 AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='member_network'::regclass AND attname='position')]::smallint[] LOOP
  EXECUTE format('ALTER TABLE member_network DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS network_sponsor ON member_network(sponsor_id);
ALTER TABLE member_network ADD COLUMN IF NOT EXISTS registration_index bigint;
ALTER TABLE member_network ADD COLUMN IF NOT EXISTS referral_ordinal bigint;
ALTER TABLE member_network ADD COLUMN IF NOT EXISTS rollup_generation integer NOT NULL DEFAULT 0;
ALTER TABLE member_network ADD COLUMN IF NOT EXISTS sponsor_target_id uuid REFERENCES profiles(id);
ALTER TABLE member_network ADD COLUMN IF NOT EXISTS placement_reason text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS network_sponsor_waiting ON member_network(sponsor_target_id) WHERE sponsor_id IS NULL AND activated_at IS NOT NULL;
CREATE SEQUENCE IF NOT EXISTS network_registration_sequence;
CREATE UNIQUE INDEX IF NOT EXISTS network_registration_unique ON member_network(registration_index);
CREATE UNIQUE INDEX IF NOT EXISTS network_referral_ordinal ON member_network(referrer_id,referral_ordinal);
CREATE TABLE IF NOT EXISTS network_registration_counters(referrer_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,last_ordinal bigint NOT NULL);
ALTER TABLE network_registration_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON network_registration_counters FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE network_registration_sequence FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION network_activate(member uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE n member_network%ROWTYPE; ordinal bigint; generation integer:=0; target uuid; i integer;
BEGIN
 IF EXISTS(SELECT 1 FROM member_network WHERE user_id=member AND registration_index IS NOT NULL AND activated_at IS NOT NULL) AND member_reward_eligible(member) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(9692027);
 INSERT INTO member_network(user_id) VALUES(member) ON CONFLICT DO NOTHING;
 SELECT * INTO n FROM member_network WHERE user_id=member FOR UPDATE;
 IF NOT member_reward_eligible(member) THEN
  UPDATE member_network SET activated_at=NULL WHERE user_id=member AND activated_at IS NOT NULL;
  RETURN;
 END IF;
 IF n.registration_index IS NULL THEN
  IF n.referrer_id IS NOT NULL THEN
   INSERT INTO network_registration_counters(referrer_id,last_ordinal) VALUES(n.referrer_id,1)
   ON CONFLICT(referrer_id) DO UPDATE SET last_ordinal=network_registration_counters.last_ordinal+1
   RETURNING last_ordinal INTO ordinal;
   IF ordinal%3=0 THEN generation:=(ordinal/3)::integer; END IF;
   target:=n.referrer_id;
   IF generation>0 THEN
    FOR i IN 1..generation LOOP
     SELECT referrer_id INTO target FROM member_network WHERE user_id=target;
     EXIT WHEN target IS NULL;
    END LOOP;
   END IF;
  END IF;
  UPDATE member_network SET registration_index=nextval('network_registration_sequence'),referral_ordinal=ordinal,
   rollup_generation=generation,sponsor_target_id=target,position=NULL,sponsor_id=NULL WHERE user_id=member;
  INSERT INTO audit_logs(actor,action,details) VALUES(member,'organization.qualified',
   jsonb_build_object('ordinal',ordinal,'rollupGeneration',generation,'sponsorTargetId',target));
 END IF;
 UPDATE member_network SET activated_at=coalesce(activated_at,clock_timestamp()),
  sponsor_id=CASE WHEN member_reward_eligible(sponsor_target_id) THEN sponsor_target_id ELSE NULL END,
  placement_reason=CASE WHEN referrer_id IS NULL THEN '추천인 없음'
   WHEN sponsor_target_id IS NULL THEN '롤업 대상 상위 추천인 없음'
   WHEN NOT member_reward_eligible(sponsor_target_id) THEN '대상 추천인의 정회원 등록 대기' ELSE '' END WHERE user_id=member;
 -- Release waiting members when their predetermined sponsor becomes qualified.
 UPDATE member_network SET sponsor_id=member,placement_reason='' WHERE sponsor_target_id=member AND sponsor_id IS NULL AND activated_at IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION network_membership_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.network_activate(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS profile_network_membership ON profiles;
CREATE TRIGGER profile_network_membership AFTER UPDATE OF grade_code,status ON profiles FOR EACH ROW EXECUTE FUNCTION network_membership_changed();
DROP TRIGGER IF EXISTS confirmed_network_membership ON auth.users;
CREATE TRIGGER confirmed_network_membership AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION network_membership_changed();

CREATE OR REPLACE FUNCTION organization_signup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE code text:=upper(trim(coalesce(NEW.raw_user_meta_data->>'referral_code',''))); parent uuid;
BEGIN
 IF NEW.email IS NULL THEN RETURN NEW; END IF;
 IF code<>'' THEN
  SELECT n.user_id INTO parent FROM public.member_network n JOIN public.profiles p ON p.id=n.user_id WHERE n.referral_code=code AND p.status='active';
  IF parent IS NULL THEN RAISE EXCEPTION 'INVALID_REFERRAL'; END IF;
 END IF;
 INSERT INTO public.profiles(id,email,name) VALUES(NEW.id,lower(NEW.email),left(coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'),''),split_part(NEW.email,'@',1)),60));
 INSERT INTO public.member_network(user_id,referrer_id) VALUES(NEW.id,parent);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION network_place(viewer uuid,member uuid,parent uuid,slot text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'AUTOMATIC_PLACEMENT_ONLY'; END $$;
REVOKE ALL ON FUNCTION network_activate(uuid),network_membership_changed(),organization_signup(),network_place(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;

-- Existing records lack a historical qualification sequence. Bootstrap once in profile creation order.
-- Recorded ordinals and sponsor targets are never reassigned on rerun or requalification.
DO $$ DECLARE item record; BEGIN
 PERFORM pg_advisory_xact_lock(9692027);
 UPDATE member_network SET activated_at=NULL,sponsor_id=NULL,position=NULL WHERE registration_index IS NULL;
 FOR item IN SELECT p.id FROM profiles p WHERE member_reward_eligible(p.id) ORDER BY p.created_at,p.id LOOP
  PERFORM network_activate(item.id);
 END LOOP;
END $$;
