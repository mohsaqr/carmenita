import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * POST /api/local-models
 *
 * Probes a local or custom OpenAI-compatible endpoint for its list of
 * available models. Works with:
 *   • LM Studio   (GET http://localhost:1234/v1/models)
 *   • Ollama      (GET http://localhost:11434/v1/models)
 *   • Custom      (GET {baseUrl}/models)
 *
 * Body: { baseUrl: string, apiKey?: string }
 *
 * Returns: { models: string[], baseUrl: string }
 *   or    { error: string, models: [] }
 *
 * The route runs server-side so the browser doesn't have to worry about
 * mixed-content/HTTPS restrictions when the user's Next.js dev server is
 * HTTP and their local LLM server is also HTTP.
 */

const BodySchema = z.object({
  baseUrl: z.string().min(1).max(500),
  apiKey: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Normalize baseUrl — strip trailing slash, strip a trailing /v1 if the
  // user accidentally typed https://.../v1/ for an endpoint that takes
  // just the base. Both shapes work because we append /models.
  const baseUrl = parsed.data.baseUrl.replace(/\/$/, "");
  const modelsUrl = `${baseUrl}/models`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Most local servers don't check the Authorization header, but sending
  // one matches what the inference client would do and avoids any
  // picky middleware.
  if (parsed.data.apiKey) {
    headers["Authorization"] = `Bearer ${parsed.data.apiKey}`;
  }

  try {
    const res = await fetch(modelsUrl, {
      method: "GET",
      headers,
      // Short timeout so a misconfigured baseUrl doesn't hang the UI.
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Endpoint responded with HTTP ${res.status} ${res.statusText}`,
          models: [],
          baseUrl,
        },
        { status: 200 },
      );
    }

    const data: unknown = await res.json();
    const models = extractModelIds(data);

    return NextResponse.json({ models, baseUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Could not reach ${modelsUrl}: ${msg}`,
        models: [],
        baseUrl,
      },
      { status: 200 },
    );
  }
}

/**
 * Extract a flat list of model ids from a variety of server response
 * shapes. Supports:
 *   • OpenAI / LM Studio / Ollama (OpenAI-compat):
 *       { object: "list", data: [ { id: "..." }, ... ] }
 *   • Ollama native /api/tags:
 *       { models: [ { name: "..." }, ... ] }
 *   • Bare arrays: ["foo", "bar"] or [{ id: "foo" }, ...]
 */
function extractModelIds(data: unknown): string[] {
  if (!data) return [];
  // OpenAI-compatible
  if (
    typeof data === "object" &&
    data !== null &&
    "data" in data &&
    Array.isArray((data as { data: unknown }).data)
  ) {
    return (data as { data: Array<{ id?: unknown; name?: unknown }> }).data
      .map((m) => (typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : null))
      .filter((x): x is string => !!x)
      .sort();
  }
  // Ollama native
  if (
    typeof data === "object" &&
    data !== null &&
    "models" in data &&
    Array.isArray((data as { models: unknown }).models)
  ) {
    return (data as { models: Array<{ name?: unknown; model?: unknown }> }).models
      .map((m) =>
        typeof m.name === "string"
          ? m.name
          : typeof m.model === "string"
            ? m.model
            : null,
      )
      .filter((x): x is string => !!x)
      .sort();
  }
  // Bare array
  if (Array.isArray(data)) {
    return data
      .map((m) => {
        if (typeof m === "string") return m;
        if (m && typeof m === "object" && "id" in m && typeof (m as { id: unknown }).id === "string")
          return (m as { id: string }).id;
        return null;
      })
      .filter((x): x is string => !!x)
      .sort();
  }
  return [];
}
