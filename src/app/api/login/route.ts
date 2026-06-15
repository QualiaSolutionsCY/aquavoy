import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, signSession, verifyCredential } from "@/lib/auth/session";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LoginBody = z.object({
  principal: z.enum(["Wency", "Jeanette"]),
  password: z.string().min(1),
});

/**
 * POST /api/login  { principal: "Wency"|"Jeanette", password: string }
 * Verifies the operator credential and, on success, sets the signed httpOnly
 * session cookie carrying the verified principal (ADR-001).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body", 400);
  }

  const parsed = LoginBody.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid credentials", 401);
  }

  const { principal, password } = parsed.data;
  if (!verifyCredential(principal, password)) {
    return fail("Invalid credentials", 401);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: signSession(principal),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
