import { NextResponse } from "next/server";
import { GraphError } from "@/lib/microsoft/graph";

/** Uniform success envelope. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

/** Uniform error envelope. */
export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Wrap a route handler so thrown errors become a consistent JSON envelope.
 * GraphErrors keep their HTTP status; everything else is a 500 unless it's a
 * known client-input problem (those throw with a leading "BadRequest:").
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GraphError) {
      return fail(`${err.code}: ${err.message}`, err.status >= 400 ? err.status : 502);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    const status = message.startsWith("BadRequest:") ? 400 : 500;
    return fail(message.replace(/^BadRequest:\s*/, ""), status);
  }
}
