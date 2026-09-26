import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, listUsers, requireAdmin, UserExistsError } from "@/lib/auth";

/**
 * Admin-only account management (the /users page).
 *
 *   GET  → { users: Array<{ id, username, isAdmin, createdAt, questionCount }> }
 *   POST body { username, password, isAdmin? } → { user } (201)
 *        409 if the username is taken, 400 on invalid input.
 *
 * Non-admins get 403; signed-out requests 401.
 */

const CreateSchema = z.object({
  username: z.string().max(100),
  password: z.string().max(1000),
  isAdmin: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: listUsers() });
}

export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  try {
    const user = createUser(parsed.data.username, parsed.data.password, { isAdmin: parsed.data.isAdmin });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof UserExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // checkCredentials: empty username / short password.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }
}
