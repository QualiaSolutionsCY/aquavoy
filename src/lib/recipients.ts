import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Persistence for recipients (the "crew" the automation emails). Server-only,
 * via the service-role client. Thin CRUD — the seam the API routes wrap.
 */

const TABLE = "recipients";

export interface Recipient {
  id: string;
  name: string;
  email: string;
  role: string | null;
  notes: string | null;
}

interface Row {
  id: string;
  name: string;
  email: string;
  role: string | null;
  notes: string | null;
}

export async function listRecipients(): Promise<Recipient[]> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .select("id, name, email, role, notes")
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to list recipients: ${error.message}`);
  return data as Row[];
}

export async function createRecipient(input: {
  name: string;
  email: string;
  role?: string | null;
  notes?: string | null;
}): Promise<Recipient> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .insert({
      name: input.name,
      email: input.email,
      role: input.role ?? null,
      notes: input.notes ?? null,
    })
    .select("id, name, email, role, notes")
    .single();
  if (error) throw new Error(`Failed to create recipient: ${error.message}`);
  return data as Row;
}

export async function deleteRecipient(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`Failed to delete recipient: ${error.message}`);
}
