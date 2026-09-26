import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, createSession, SESSION_COOKIE } from "@/lib/auth";

const LoginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
});

/**
 * POST /api/auth/login
 * Body: { username, password }
 *
 * On success sets the httpOnly session cookie and returns the user.
 * The cookie is `Secure` only when the request arrived over HTTPS, so
 * the plain-HTTP LAN deploy still works.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const user = authenticate(parsed.data.username, parsed.data.password);
  if (!user) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const { token, expiresAt } = createSession(user.id);
  const isHttps =
    req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    expires: expiresAt,
  });
  return res;
}
