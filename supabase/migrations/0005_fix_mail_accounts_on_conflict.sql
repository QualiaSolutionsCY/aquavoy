-- The app upserts with ON CONFLICT (email); that requires a unique
-- constraint/index on the plain column. The lower(email) expression index
-- doesn't satisfy it. Add the plain unique constraint (emails are entered
-- lowercase via the UI defaults; the lower() index remains as a guard).
alter table public.mail_accounts
  add constraint mail_accounts_email_key unique (email);
