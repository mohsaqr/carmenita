import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { listSettings } from "@/lib/settings-store";
import { withLog } from "@/lib/request-log";

/** GET /api/settings — every saved setting for the signed-in user, as `{ settings: {key: value} }`. */
async function handleGET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ settings: listSettings(user.id) });
}

export const GET = withLog(handleGET);
