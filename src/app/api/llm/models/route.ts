import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { friendlyError, listModels, settingsFromProvider } from "@/lib/ai/llm";
import { ProviderConfigSchema } from "@/lib/validation";
import { withLog } from "@/lib/request-log";

/**
 * POST /api/llm/models
 *
 * Lists the models a provider config can use, for the Settings model picker.
 * Works for every provider except Azure (deployments are named in the
 * portal). Runs server-side so the key never has to reach a third-party
 * origin from the browser, and so HTTP local servers work from an HTTPS page.
 *
 * Body: { provider: ProviderConfig }
 * Returns: { models: string[] } or { error: string, models: [] }
 */
const BodySchema = z.object({ provider: ProviderConfigSchema });

async function handlePOST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  try {
    const models = await listModels(settingsFromProvider(parsed.data.provider), AbortSignal.timeout(10_000));
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({ error: friendlyError(err), models: [] });
  }
}

export const POST = withLog(handlePOST);
