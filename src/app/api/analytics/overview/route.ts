import { NextRequest, NextResponse } from "next/server";
import { overview } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const data = await overview(userId);
  return NextResponse.json(data);
}
