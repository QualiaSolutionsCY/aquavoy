-- Mail stack discriminator: records which stack OWNS each mail_accounts row
-- (REQ-16, ADR-004). Until now mail_accounts stored no stack, so ownership was
-- architectural-only — there was no runtime-discoverable answer to "who owns
-- this mailbox?". This additive column makes that authoritative and queryable:
-- 'imap' (IMAP/SMTP — the authoritative stack for company mailboxes, per
-- ADR-004 / D-02) or 'outlook' (user-personal Graph drafting/send only, never
-- a company mailbox). Existing rows are all company mailboxes, so the column
-- defaults to 'imap'. The agent send_email path asserts mail_stack = 'imap'
-- and refuses any other value rather than silently falling back (REQ-16).
-- Additive only — no deletion, no convergence (D-05). Like every other table
-- (see 0011_agent_traces.sql, 0003_mail_accounts.sql) mail_accounts is locked
-- to the service role: RLS on, no policies. Applied via CI/Supabase flow —
-- never hand-applied to a remote (constitution). Idempotent / re-runnable.

alter table public.mail_accounts
  add column if not exists mail_stack text not null default 'imap';

-- Guard the check-constraint add so re-running the migration does not error on
-- the already-present constraint.
do $$
begin
  alter table public.mail_accounts
    add constraint mail_accounts_mail_stack_check
    check (mail_stack in ('imap', 'outlook'));
exception
  when duplicate_object then null;
end $$;

comment on column public.mail_accounts.mail_stack is
  'Authoritative stack that OWNS this mailbox (ADR-004 / REQ-16): ''imap'' = IMAP/SMTP company mailbox (default), ''outlook'' = user-personal Graph send/draft only. The agent send path asserts ''imap'' and never falls back across stacks.';
