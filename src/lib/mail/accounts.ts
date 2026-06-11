import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Persistence for SMTP/IMAP mail accounts. A "mail account" is one mailbox
 * whose SMTP credentials we store so the app can send (and eventually read)
 * email directly — no Microsoft Graph, no OAuth dance.
 *
 * Tokens/passwords live in Supabase (`mail_accounts`), readable only by the
 * service role. The public interface NEVER exposes the password field.
 */

const TABLE = "mail_accounts";

/** Safe public shape — password is never exposed. */
export interface MailAccount {
  id: string;
  email: string;
  displayName: string | null;
  smtpHost: string;
  smtpPort: number;
  imapHost: string | null;
  imapPort: number | null;
  username: string;
  verifiedAt: string | null;
}

/** Internal shape with the secret, used only for sending. */
export interface MailAccountWithSecret extends MailAccount {
  password: string;
}

interface AccountRow {
  id: string;
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  imap_host: string | null;
  imap_port: number | null;
  username: string;
  password: string;
  verified_at: string | null;
}

function toMailAccount(row: AccountRow): MailAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    username: row.username,
    verifiedAt: row.verified_at,
  };
}

function toMailAccountWithSecret(row: AccountRow): MailAccountWithSecret {
  return {
    ...toMailAccount(row),
    password: row.password,
  };
}

/** Upsert a mail account (keyed on email via unique index). */
export async function saveAccount(
  fields: {
    email: string;
    displayName?: string | null;
    smtpHost: string;
    smtpPort: number;
    imapHost?: string | null;
    imapPort?: number | null;
    username: string;
    password: string;
    verifiedAt?: string | null;
  },
): Promise<MailAccount> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        email: fields.email.toLowerCase(),
        display_name: fields.displayName ?? null,
        smtp_host: fields.smtpHost,
        smtp_port: fields.smtpPort,
        imap_host: fields.imapHost ?? null,
        imap_port: fields.imapPort ?? null,
        username: fields.username,
        password: fields.password,
        verified_at: fields.verifiedAt ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    )
    .select()
    .single();
  if (error) throw new Error(`Failed to save mail account: ${error.message}`);
  return toMailAccount(data as AccountRow);
}

/** List all mail accounts for the UI — never returns passwords. */
export async function listAccounts(): Promise<MailAccount[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("id, email, display_name, smtp_host, smtp_port, imap_host, imap_port, username, verified_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to list mail accounts: ${error.message}`);
  return (data as AccountRow[]).map(toMailAccount);
}

/** Delete a mail account by id. */
export async function deleteAccount(id: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`Failed to delete mail account: ${error.message}`);
}

/** Load a mail account WITH the password — internal, for sending only. */
export async function loadAccountWithSecret(id: string): Promise<MailAccountWithSecret> {
  const db = supabaseAdmin();
  const { data, error } = await db.from(TABLE).select("*").eq("id", id).single();
  if (error || !data) throw new Error(`Mail account not found: ${id}`);
  return toMailAccountWithSecret(data as AccountRow);
}
