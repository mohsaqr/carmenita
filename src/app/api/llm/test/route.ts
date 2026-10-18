import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { settingsFromProvider, testConnection } from "@/lib/ai/llm";
import { ProviderConfigSchema } from "@/lib/validation";

/**
 * POST /api/llm/test
 *
 * Sends one tiny real completion down the same path quiz generation uses,
 * so a wrong key, a dead model id or a refused parameter shows up in
 * Settings instead of mid-generation.
 *
 * Body: { provider: ProviderConfig, temperature?: number }
 * Returns: { ok: boolean, output: string, latencyMs: number } or { ok: false, error: string }
 */
const BodySchema = z.object({
  provider: ProviderConfigSchema,
  temperature: z.number().min(0).max(2).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const { provider, temperature } = parsed.data;
  try {
    const result = await testConnection(settingsFromProvider(provider, { temperature }));
    return NextResponse.json({ ok: result.ok, output: result.output, latencyMs: result.latencyMs });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
