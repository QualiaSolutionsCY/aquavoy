import { NextResponse } from "next/server";
import { handle, ok } from "@/lib/http";
import { listConnections } from "@/lib/microsoft/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List connected Microsoft accounts (no tokens) for the UI account picker. */
export function GET(): Promise<NextResponse> {
  return handle(async () => ok(await listConnections()));
}
