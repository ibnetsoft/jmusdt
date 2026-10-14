-- Run using a trusted backend role. Browser roles get SELECT of owned rows only.
CREATE TABLE IF NOT EXISTS profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id), email text UNIQUE NOT NULL,
 name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS balances (
 user_id uuid PRIMARY KEY REFERENCES profiles(id), available bigint NOT NULL DEFAULT 0 CHECK(available>=0),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0)
);
CREATE SEQUENCE IF NOT EXISTS deposit_derivation_index;
CREATE TABLE IF NOT EXISTS deposit_addresses (
 user_id uuid PRIMARY KEY REFERENCES profiles(id), derivation_index bigint UNIQUE NOT NULL DEFAULT nextval('deposit_derivation_index'),
 address text UNIQUE, network text NOT NULL CHECK(network IN ('nile','mainnet')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 kind text NOT NULL CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal')),
 amount bigint NOT NULL CHECK(amount>0), fee bigint NOT NULL DEFAULT 0 CHECK(fee>=0),
 status text NOT NULL CHECK(status IN ('pending','approved','signing','broadcast','completed','rejected','failed')),
 destination text, txid text, note text, idempotency_key uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS transactions_user_created ON transactions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_withdrawal_queue ON transactions(status,created_at) WHERE kind='withdrawal';
CREATE TABLE IF NOT EXISTS journal (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, transaction_id uuid NOT NULL REFERENCES transactions(id),
 batch_id uuid NOT NULL, account text NOT NULL, units bigint NOT NULL CHECK(units<>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_batch ON journal(batch_id);
CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT sum(units) FROM journal WHERE batch_id=NEW.batch_id)<>0 THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS balanced_journal ON journal;
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT ON journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
CREATE OR REPLACE FUNCTION immutable_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_JOURNAL'; END; $$;
DROP TRIGGER IF EXISTS no_journal_mutation ON journal;
CREATE TRIGGER no_journal_mutation BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION immutable_journal();
CREATE TABLE IF NOT EXISTS deposit_events (
 network text NOT NULL, txid text NOT NULL, log_index integer NOT NULL,
 transaction_id uuid NOT NULL REFERENCES transactions(id), block_number bigint NOT NULL,
 PRIMARY KEY(network,txid,log_index)
);
CREATE TABLE IF NOT EXISTS chain_cursor (network text PRIMARY KEY, block_number bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wallet_configuration (id boolean PRIMARY KEY DEFAULT true CHECK(id), network text NOT NULL, contract text NOT NULL);
CREATE TABLE IF NOT EXISTS signed_transactions (
 transaction_id uuid PRIMARY KEY REFERENCES transactions(id), txid text UNIQUE NOT NULL,
 payload jsonb NOT NULL, expiration bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_error text
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid REFERENCES profiles(id), action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sweep_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','signing','broadcast','completed','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), txid text, note text,
 amount bigint, payload jsonb, expiration bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS one_requested_sweep ON sweep_jobs(user_id) WHERE status IN ('requested','signing','broadcast');

-- Serialize idempotency before inspecting existing transactions. Lock accounts in
-- UUID order to prevent opposing transfers from deadlocking.
CREATE OR REPLACE FUNCTION wallet_transfer(sender uuid, recipient_email text, quantity bigint, request_key uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE recipient uuid; existing transactions%ROWTYPE; result uuid; batch uuid := gen_random_uuid();
BEGIN
 IF quantity<=0 OR request_key IS NULL THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(sender::text||request_key::text,0));
 SELECT * INTO existing FROM transactions WHERE user_id=sender AND idempotency_key=request_key;
 IF FOUND THEN
   IF existing.kind<>'transfer_out' OR existing.destination<>lower(trim(recipient_email)) OR existing.amount<>quantity THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN existing.id;
 END IF;
 SELECT id INTO recipient FROM profiles WHERE email=lower(trim(recipient_email));
 IF recipient IS NULL OR recipient=sender THEN RAISE EXCEPTION 'RECIPIENT_NOT_FOUND'; END IF;
 PERFORM id FROM profiles WHERE id IN(sender,recipient) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM profiles WHERE id IN(sender,recipient) AND status<>'active') THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 INSERT INTO balances(user_id) VALUES(sender),(recipient) ON CONFLICT DO NOTHING;
 PERFORM user_id FROM balances WHERE user_id IN(sender,recipient) ORDER BY user_id FOR UPDATE;
 UPDATE balances SET available=available-quantity WHERE user_id=sender AND available>=quantity;
 IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
 UPDATE balances SET available=available+quantity WHERE user_id=recipient;
 INSERT INTO transactions(user_id,kind,amount,status,destination,idempotency_key)
 VALUES(sender,'transfer_out',quantity,'completed',lower(trim(recipient_email)),request_key) RETURNING id INTO result;
 INSERT INTO transactions(user_id,kind,amount,status,destination) VALUES(recipient,'transfer_in',quantity,'completed',(SELECT email FROM profiles WHERE id=sender));
 INSERT INTO journal(transaction_id,batch_id,account,units) VALUES
 (result,batch,sender::text||':available',-quantity),(result,batch,recipient::text||':available',quantity);
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION wallet_request_withdrawal(owner_id uuid, to_address text, quantity bigint, fee_units bigint, request_key uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE existing transactions%ROWTYPE; result uuid; total bigint := quantity+fee_units; batch uuid := gen_random_uuid();
BEGIN
 IF quantity<=0 OR fee_units<0 OR request_key IS NULL THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||request_key::text,0));
 SELECT * INTO existing FROM transactions WHERE user_id=owner_id AND idempotency_key=request_key;
 IF FOUND THEN
   IF existing.kind<>'withdrawal' OR existing.destination<>to_address OR existing.amount<>quantity OR existing.fee<>fee_units THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN existing.id;
 END IF;
 PERFORM id FROM profiles WHERE id=owner_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 UPDATE balances SET available=available-total,reserved=reserved+total WHERE user_id=owner_id AND available>=total;
 IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
 INSERT INTO transactions(user_id,kind,amount,fee,status,destination,idempotency_key)
 VALUES(owner_id,'withdrawal',quantity,fee_units,'pending',to_address,request_key) RETURNING id INTO result;
 INSERT INTO journal(transaction_id,batch_id,account,units) VALUES
 (result,batch,owner_id::text||':available',-total),(result,batch,owner_id::text||':reserved',total);
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION wallet_decide_withdrawal(request_id uuid, operator_id uuid, decision text, reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE entry transactions%ROWTYPE; batch uuid := gen_random_uuid(); total bigint;
BEGIN
 SELECT * INTO entry FROM transactions WHERE id=request_id AND kind='withdrawal' FOR UPDATE;
 IF NOT FOUND OR entry.status<>'pending' OR decision NOT IN('approved','rejected') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 total := entry.amount+entry.fee;
 IF decision='rejected' THEN
   UPDATE balances SET reserved=reserved-total,available=available+total WHERE user_id=entry.user_id;
   INSERT INTO journal(transaction_id,batch_id,account,units) VALUES
   (request_id,batch,entry.user_id::text||':reserved',-total),(request_id,batch,entry.user_id::text||':available',total);
 ELSE
   PERFORM id FROM profiles WHERE id=entry.user_id AND status='active' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_BLOCKED'; END IF;
 END IF;
 UPDATE transactions SET status=decision,note=reason,updated_at=now() WHERE id=request_id;
 INSERT INTO audit_logs(actor,action,details) VALUES(operator_id,'withdrawal.'||decision,jsonb_build_object('transaction_id',request_id,'reason',reason));
END; $$;

CREATE OR REPLACE FUNCTION wallet_credit_deposit(owner_id uuid, quantity bigint, chain text, hash text, event_index integer, block bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE result uuid; batch uuid := gen_random_uuid();
BEGIN
 IF quantity<=0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(chain||hash||':'||event_index::text,0));
 IF EXISTS(SELECT 1 FROM deposit_events WHERE network=chain AND txid=hash AND log_index=event_index) THEN RETURN false; END IF;
 INSERT INTO balances(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 INSERT INTO transactions(user_id,kind,amount,status,txid) VALUES(owner_id,'deposit',quantity,'completed',hash) RETURNING id INTO result;
 INSERT INTO deposit_events VALUES(chain,hash,event_index,result,block);
 UPDATE balances SET available=available+quantity WHERE user_id=owner_id;
 INSERT INTO journal(transaction_id,batch_id,account,units) VALUES
 (result,batch,'custody',-quantity),(result,batch,owner_id::text||':available',quantity);
 RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION wallet_settle_withdrawal(request_id uuid, succeeded boolean, hash text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE entry transactions%ROWTYPE; batch uuid := gen_random_uuid(); total bigint;
BEGIN
 SELECT * INTO entry FROM transactions WHERE id=request_id AND kind='withdrawal' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF entry.status IN ('completed','failed') THEN
   IF entry.txid<>hash OR (entry.status='completed')<>succeeded THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   RETURN;
 END IF;
 IF entry.status NOT IN('signing','broadcast') OR NOT EXISTS(SELECT 1 FROM signed_transactions WHERE transaction_id=request_id AND txid=hash) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 total := entry.amount+entry.fee;
 UPDATE balances SET reserved=reserved-total,available=available+CASE WHEN succeeded THEN 0 ELSE total END WHERE user_id=entry.user_id;
 INSERT INTO journal(transaction_id,batch_id,account,units) VALUES(request_id,batch,entry.user_id::text||':reserved',-total);
 IF succeeded THEN
   INSERT INTO journal(transaction_id,batch_id,account,units) VALUES(request_id,batch,'custody',entry.amount);
   IF entry.fee>0 THEN INSERT INTO journal(transaction_id,batch_id,account,units) VALUES(request_id,batch,'fees',entry.fee); END IF;
 ELSE
   INSERT INTO journal(transaction_id,batch_id,account,units) VALUES(request_id,batch,entry.user_id::text||':available',total);
 END IF;
 UPDATE transactions SET status=CASE WHEN succeeded THEN 'completed' ELSE 'failed' END,txid=hash,updated_at=now() WHERE id=request_id;
 INSERT INTO audit_logs(action,details) VALUES('withdrawal.settled',jsonb_build_object('transaction_id',request_id,'success',succeeded,'txid',hash));
END; $$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE signed_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sweep_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_profile ON profiles;
CREATE POLICY own_profile ON profiles FOR SELECT TO authenticated USING(id=(SELECT auth.uid()));
DROP POLICY IF EXISTS own_balance ON balances;
CREATE POLICY own_balance ON balances FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS own_transactions ON transactions;
CREATE POLICY own_transactions ON transactions FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS own_address ON deposit_addresses;
CREATE POLICY own_address ON deposit_addresses FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
REVOKE ALL ON profiles,balances,transactions,deposit_addresses,journal,deposit_events,chain_cursor,wallet_configuration,signed_transactions,audit_logs,sweep_jobs FROM anon,authenticated;
GRANT SELECT ON profiles,balances,transactions,deposit_addresses TO authenticated;
REVOKE ALL ON FUNCTION wallet_transfer(uuid,text,bigint,uuid),wallet_request_withdrawal(uuid,text,bigint,bigint,uuid),wallet_decide_withdrawal(uuid,uuid,text,text),wallet_credit_deposit(uuid,bigint,text,text,integer,bigint),wallet_settle_withdrawal(uuid,boolean,text),check_journal_balance(),immutable_journal() FROM PUBLIC,anon,authenticated;
-- SQL owner (DATABASE_URL) executes backend functions. No browser EXECUTE grant.
