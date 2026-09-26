import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  deleteSetting,
  getSetting,
  setSetting,
  SETTINGS_KEY_PATTERN,
} from "@/lib/settings-store";

/**
 * /api/settings/[key] — one per-user setting.
 *   GET    → { value } (value is null when unset)
 *   PUT    body { value } → { ok: true }
 *   DELETE → { ok: true }
 */

type Ctx = { params: Promise<{ key: string }> };

async function resolve(req: NextRequest, ctx: Ctx) {
  const user = getUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  const { key } = await ctx.params;
  if (!SETTINGS_KEY_PATTERN.test(key)) {
    return { error: NextResponse.json({ error: "Invalid settings key" }, { status: 400 }) };
  }
  return { userId: user.id, key };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  return NextResponse.json({ value: getSetting(r.userId, r.key) });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("value" in body)) {
    return NextResponse.json({ error: "Body must be { value }" }, { status: 400 });
  }
  const value = (body as { value: unknown }).value;
  if (value === undefined || value === null) {
    return NextResponse.json({ error: "Use DELETE to clear a setting" }, { status: 400 });
  }
  setSetting(r.userId, r.key, value);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  deleteSetting(r.userId, r.key);
  return NextResponse.json({ ok: true });
}
