import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { noteLog, withLog } from "@/lib/request-log";

/**
 * POST /api/client-errors — a failure the browser saw (see
 * src/lib/client-errors.ts). The request is logged by `withLog` like any
 * other; the report's fields go onto that line:
 *
 *   [api] ref=… POST /api/client-errors 200 ms=1 user=… where=create.generate page=/create message="…"
 */
const ClientErrorSchema = z.object({
  where: z.string().min(1).max(100),
  message: z.string().max(1000),
  page: z.string().max(300).optional(),
});

async function handlePOST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ClientErrorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  noteLog({ where: parsed.data.where, page: parsed.data.page, message: parsed.data.message }, "warn");
  return NextResponse.json({ ok: true });
}

export const POST = withLog(handlePOST);
