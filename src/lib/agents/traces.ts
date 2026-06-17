import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Persistence for per-turn agent traces (REQ-14, M2). Rows live in
 * `public.agent_traces` (see 0011_agent_traces.sql). All access goes through the
 * service-role client — the table has RLS enabled with no public policies, so
 * only server code can touch it. The agent loop writes one row per turn
 * (`insertTrace`) and the metrics surface reads them back (`getTrace`).
 */

const TABLE = "agent_traces";

export type Provider = "openrouter" | "gemini";

export interface ToolCallTrace {
  name: string;
  argsSummary: string;
  resultSummary: string;
  latencyMs: number;
  error: string | null;
}

export interface AgentTraceInput {
  principal: string;
  model: string;
  provider: Provider;
  toolCalls: ToolCallTrace[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  error: string | null;
}

export interface AgentTrace {
  id: string;
  principal: string;
  model: string;
  provider: Provider;
  toolCalls: ToolCallTrace[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  error: string | null;
  createdAt: string;
}

interface AgentTraceRow {
  id: string;
  principal: string;
  model: string;
  provider: string;
  tool_calls: ToolCallTrace[] | null;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  error: string | null;
  created_at: string;
}

function toAgentTrace(row: AgentTraceRow): AgentTrace {
  return {
    id: row.id,
    principal: row.principal,
    model: row.model,
    provider: row.provider as Provider,
    toolCalls: row.tool_calls ?? [],
    latencyMs: row.latency_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    error: row.error,
    createdAt: row.created_at,
  };
}

const COLUMNS =
  "id, principal, model, provider, tool_calls, latency_ms, prompt_tokens, completion_tokens, error, created_at";

/** Insert one trace row for an agent turn. Returns the generated id. */
export async function insertTrace(input: AgentTraceInput): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      principal: input.principal,
      model: input.model,
      provider: input.provider,
      tool_calls: input.toolCalls,
      latency_ms: input.latencyMs,
      prompt_tokens: input.promptTokens,
      completion_tokens: input.completionTokens,
      error: input.error,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to insert agent trace: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Fetch a single trace by id, scoped to the principal (REQ-3). Returns null
 * when it does not exist OR belongs to a different principal — the caller
 * cannot distinguish the two, which is the point.
 */
export async function getTrace(
  id: string,
  principal: string,
): Promise<AgentTrace | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("id", id)
    .eq("principal", principal)
    .maybeSingle();

  if (error) throw new Error(`Failed to load agent trace: ${error.message}`);
  if (!data) return null;
  return toAgentTrace(data as AgentTraceRow);
}
