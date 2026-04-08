import { NextResponse } from "next/server";
import { overview } from "@/lib/analytics";

export async function GET() {
  const data = await overview();
  return NextResponse.json(data);
}
