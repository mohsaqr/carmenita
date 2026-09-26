import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";

/**
 * Site-wide login gate (Next 16 "proxy", the successor to middleware).
 *
 * Unlike the old Edge middleware, a Next 16 proxy runs on the Node.js
 * runtime, so it can check the session token directly against SQLite.
 *
 *   - Signed in            → request passes through.
 *   - Not signed in, page  → redirect to /login?next=<original path>.
 *   - Not signed in, /api  → 401 JSON (fetch callers can't follow a
 *                            redirect to an HTML login page usefully).
 *
 * Accounts live in the `users` table. Create or reset one with:
 *   node scripts/create-user.mjs <username> <password>
 *
 * Not used by the static GitHub Pages build (build-static.sh stashes
 * this file): Pages has no server, so it keeps the client-side
 * PasswordGate instead.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (getUserFromRequest(req)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

/**
 * Skip Next internals and static assets so CSS/JS/fonts and the
 * sql.js WASM files load without a session.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|wasm|txt)$).*)"],
};
