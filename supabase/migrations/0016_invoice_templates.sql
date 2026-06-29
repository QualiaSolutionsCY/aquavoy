-- Invoice templates: per-company .docx template registry (ADR-007 §4, M6 Phase 3).
-- The actual template FILES are committed to `assets/invoice-templates/` and
-- referenced here by path (template_ref). At invoice-generation time the agent
-- reads template_ref, fills the token set via docxtemplater, and writes the
-- rendered output to output_folder_path/<year>/ in OneDrive.
-- field_mapping_json is an identity map of the full token set defined in
-- assets/invoice-templates/README.md — keys ARE the template {tokens}, values
-- are the canonical field names the agent supplies at render time.
-- Like every service-role table in this project (0010, 0013, 0014, 0015) this
-- table has RLS enabled with NO policies, so anon/authenticated keys can read
-- nothing. Only server code using SUPABASE_SERVICE_ROLE_KEY touches it (via
-- src/lib/agents/invoiceTemplates.ts). Applied via CI/Supabase flow — never
-- hand-applied to a remote (constitution).

create table if not exists public.invoice_templates (
  id                 uuid        primary key default gen_random_uuid(),
  company            text        not null unique
                                   check (company in ('Gefo', 'Novo Porto')),
  template_ref       text        not null,
  output_folder_path text        not null,
  field_mapping_json jsonb,
  created_at         timestamptz not null default now()
);

comment on table public.invoice_templates is
  'Per-company .docx invoice template registry (ADR-007 §4, M6 P3). template_ref = committed asset path; output_folder_path = OneDrive destination (year appended at runtime). Service-role only (RLS on, no policies). Applied via CI, never hand-applied (constitution).';

-- RLS on, no policies → inaccessible to anon/authenticated roles.
alter table public.invoice_templates enable row level security;

-- Seed one row per company.  on conflict → idempotent re-runs.
insert into public.invoice_templates
  (company, template_ref, output_folder_path, field_mapping_json)
values
  (
    'Gefo',
    'assets/invoice-templates/gefo.docx',
    'alle firma''s/Aquavoy Ltd/Verzonden Facturen',
    '{
      "recipient_name":    "recipient_name",
      "recipient_address": "recipient_address",
      "recipient_vat":     "recipient_vat",
      "invoice_date":      "invoice_date",
      "invoice_number":    "invoice_number",
      "vessel":            "vessel",
      "crewing":           "crewing",
      "travel":            "travel",
      "service_fee":       "service_fee",
      "cash_advance":      "cash_advance",
      "total":             "total"
    }'::jsonb
  ),
  (
    'Novo Porto',
    'assets/invoice-templates/novo-porto.docx',
    'alle firma''s/Aquavoy Ltd/Verzonden Facturen',
    '{
      "recipient_name":    "recipient_name",
      "recipient_address": "recipient_address",
      "recipient_vat":     "recipient_vat",
      "invoice_date":      "invoice_date",
      "invoice_number":    "invoice_number",
      "vessel":            "vessel",
      "crewing":           "crewing",
      "travel":            "travel",
      "service_fee":       "service_fee",
      "cash_advance":      "cash_advance",
      "total":             "total"
    }'::jsonb
  )
on conflict (company) do nothing;
