import { NextRequest, NextResponse } from "next/server";

/**
 * Optional site-wide HTTP Basic Auth.
 *
 * Protection is **opt-in**: enabled only when BOTH `CARMENITA_USER`
 * and `CARMENITA_PASS` environment variables are set. Leave them
 * unset — which is the case for local development by default — and
 * the middleware lets every request through.
 *
 * This runs on every route (pages + API) except Next.js internals
 * and static assets (see `config.matcher` below). So when enabled,
 * the whole site, including the LLM-callable `/api/*` routes, is
 * behind the password.
 *
 * Usage on a deployed server (Fly.io / Vercel / a VPS):
 *   1. Pick a username and a reasonably random password.
 *   2. Set the two env vars on the host:
 *        CARMENITA_USER=alice
 *        CARMENITA_PASS=some-long-random-string
 *   3. Redeploy / restart the Node process so it picks up the vars.
 *   4. Visiting the site now triggers the browser's native basic-auth
 *      dialog. Correct credentials → normal Carmenita. Wrong → 401.
 *
 * Notes:
 *   - HTTP Basic Auth sends credentials on every request. USE HTTPS.
 *     On plain HTTP, anyone on the same network can sniff the password.
 *     Vercel, Fly.io and most PaaSes give you HTTPS by default. If you
 *     self-host, terminate TLS at a reverse proxy (Caddy, nginx, Traefik).
 *   - The credentials live in env vars on the server. They are NOT in
 *     the git repo. Do not commit a `.env` file with them set.
 *   - Does NOT work on GitHub Pages. Pages is a static file host; there
 *     is no middleware, no Node runtime. For a static deploy, auth has
 *     to be done at a layer above (e.g., putting the site behind Cloudflare
 *     Access) or not at all.
 *   - The matcher excludes `/_next/static`, `/_next/image`, and
 *     `favicon.ico` so CSS/JS/fonts load without re-prompting the user
 *     on every asset request.
 */
export function middleware(req: NextRequest) {
  const user = process.env.CARMENITA_USER;
  const pass = process.env.CARMENITA_PASS;

  // Not configured → auth is off, let everything through.
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      // `atob` works in the Edge runtime; Buffer does not.
      let decoded = "";
      try {
        decoded = atob(encoded);
      } catch {
        // Malformed base64 → fall through to the 401 response.
      }
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const u = decoded.slice(0, sep);
        const p = decoded.slice(sep + 1);
        if (u === user && p === pass) {
          return NextResponse.next();
        }
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Carmenita", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Exclude Next.js internals and static assets so a successful auth
 * doesn't cause the browser to re-prompt for every CSS/JS file it
 * loads. Everything else — pages, API routes, dynamic routes — is
 * protected when the env vars are set.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
