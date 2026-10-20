import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  deleteSetting,
  getSetting,
  setSetting,
  SETTINGS_KEY_PATTERN,
} from "@/lib/settings-store";
import { isScoringMethod, SCORING_SETTING_KEY } from "@/lib/scoring";
import { rescoreAttempts } from "@/lib/rescore";
import { withLog } from "@/lib/request-log";

/**
 * /api/settings/[key] — one per-user setting.
 *   GET    → { value } (value is null when unset)
 *   PUT    body { value } → { ok: true }
 *   DELETE → { ok: true }
 */

type Ctx = { params: Promise<{ key: string }> };

async function resolve(
  req: NextRequest,
  ctx: Ctx,
): Promise<{ error: NextResponse } | { userId: string; key: string }> {
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

async function handleGET(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  return NextResponse.json({ value: getSetting(r.userId, r.key) });
}

async function handlePUT(req: NextRequest, ctx: Ctx) {
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
  if (r.key === SCORING_SETTING_KEY) {
    if (!isScoringMethod(value)) {
      return NextResponse.json({ error: "Unknown scoring method" }, { status: 400 });
    }
    setSetting(r.userId, r.key, value);
    // Past results follow the new method (quizzes with an override keep theirs).
    return NextResponse.json({ ok: true, rescored: rescoreAttempts(r.userId) });
  }
  setSetting(r.userId, r.key, value);
  return NextResponse.json({ ok: true });
}

async function handleDELETE(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  deleteSetting(r.userId, r.key);
  if (r.key === SCORING_SETTING_KEY) {
    return NextResponse.json({ ok: true, rescored: rescoreAttempts(r.userId) });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withLog(handleGET);
export const PUT = withLog(handlePUT);
export const DELETE = withLog(handleDELETE);
