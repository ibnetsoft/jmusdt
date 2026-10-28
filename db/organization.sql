CREATE TABLE IF NOT EXISTS member_network (
 user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
 referral_code text UNIQUE NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
 referrer_id uuid REFERENCES profiles(id), sponsor_id uuid REFERENCES profiles(id),
 position text CHECK(position IN ('L','R')), activated_at timestamptz,
 CHECK(referrer_id IS DISTINCT FROM user_id), CHECK(sponsor_id IS DISTINCT FROM user_id),
 CHECK((sponsor_id IS NULL AND position IS NULL) OR (sponsor_id IS NOT NULL AND position IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS network_referrer ON member_network(referrer_id);
CREATE UNIQUE INDEX IF NOT EXISTS network_slot ON member_network(sponsor_id,position) WHERE sponsor_id IS NOT NULL;
INSERT INTO member_network(user_id,activated_at)
SELECT p.id,CASE WHEN u.email_confirmed_at IS NOT NULL THEN p.created_at END FROM profiles p JOIN auth.users u ON u.id=p.id
ON CONFLICT(user_id) DO NOTHING;
ALTER TABLE member_network ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON member_network FROM anon,authenticated;
GRANT SELECT ON member_network TO authenticated;
DROP POLICY IF EXISTS own_network ON member_network;
CREATE POLICY own_network ON member_network FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

-- Referral is captured once at auth-user creation. Later metadata edits cannot re-parent a member.
CREATE OR REPLACE FUNCTION organization_signup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE code text:=upper(trim(coalesce(NEW.raw_user_meta_data->>'referral_code',''))); parent uuid;
BEGIN
 IF NEW.email IS NULL THEN RETURN NEW; END IF;
 IF code<>'' THEN
  SELECT n.user_id INTO parent FROM public.member_network n JOIN public.profiles p ON p.id=n.user_id WHERE n.referral_code=code AND n.activated_at IS NOT NULL AND p.status='active';
  IF parent IS NULL THEN RAISE EXCEPTION 'INVALID_REFERRAL'; END IF;
 END IF;
 INSERT INTO public.profiles(id,email,name) VALUES(NEW.id,lower(NEW.email),left(coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'),''),split_part(NEW.email,'@',1)),60));
 INSERT INTO public.member_network(user_id,referrer_id) VALUES(NEW.id,parent);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS organization_new_user ON auth.users;
CREATE TRIGGER organization_new_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION organization_signup();
REVOKE ALL ON FUNCTION organization_signup() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION network_contains(viewer uuid,child uuid,mode text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH RECURSIVE ancestors AS (
 SELECT user_id,CASE WHEN mode='referral' THEN referrer_id ELSE sponsor_id END AS parent FROM member_network WHERE user_id=child
 UNION
 SELECT n.user_id,CASE WHEN mode='referral' THEN n.referrer_id ELSE n.sponsor_id END FROM member_network n JOIN ancestors a ON n.user_id=a.parent
 ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE user_id=viewer)
$$;
CREATE OR REPLACE FUNCTION network_place(viewer uuid,member uuid,parent uuid,slot text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE child member_network%ROWTYPE;
BEGIN
 IF slot IS NULL OR slot NOT IN ('L','R') THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
 PERFORM pg_advisory_xact_lock(9692026);
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=viewer AND status='active') THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 SELECT n.* INTO child FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.user_id=member AND p.status='active' AND n.activated_at IS NOT NULL FOR UPDATE OF n;
 IF NOT FOUND OR child.referrer_id IS DISTINCT FROM viewer THEN RAISE EXCEPTION 'NOT_MY_REFERRAL'; END IF;
 IF member=parent OR network_contains(member,parent,'sponsor') THEN RAISE EXCEPTION 'NETWORK_CYCLE'; END IF;
 IF NOT network_contains(viewer,parent,'sponsor') THEN RAISE EXCEPTION 'OUTSIDE_NETWORK'; END IF;
 IF NOT EXISTS(SELECT 1 FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.user_id=parent AND p.status='active' AND n.activated_at IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_SPONSOR'; END IF;
 IF child.sponsor_id IS NOT NULL THEN
  IF child.sponsor_id=parent AND child.position=slot THEN RETURN; END IF;
  RAISE EXCEPTION 'ALREADY_PLACED';
 END IF;
 IF EXISTS(SELECT 1 FROM member_network WHERE sponsor_id=parent AND position=slot) THEN RAISE EXCEPTION 'SLOT_OCCUPIED'; END IF;
 UPDATE member_network SET sponsor_id=parent,position=slot WHERE user_id=member;
 INSERT INTO audit_logs(actor,action,details) VALUES(viewer,'organization.placed',jsonb_build_object('memberId',member,'sponsorId',parent,'position',slot));
END $$;
REVOKE ALL ON FUNCTION network_contains(uuid,uuid,text),network_place(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
