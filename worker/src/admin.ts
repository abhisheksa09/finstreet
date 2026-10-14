// Admin-only: run the collector on demand (same work as the 15-minute cron).
//   POST /api/admin/check     Authorization: Bearer <ADMIN_TOKEN>   → 200 if the password is right (sign-in)
//   POST /api/admin/collect   Authorization: Bearer <ADMIN_TOKEN>   → runs the collector
// ADMIN_TOKEN is a Worker secret (`wrangler secret put ADMIN_TOKEN`); without it the endpoint is disabled.
import type { Env } from "./index";
import { runCollector } from "./collector";

const MIN_GAP_S = 60; // refuse if the collector ran this recently, so repeat clicks can't hammer publishers

export async function handleAdmin(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  if (url.pathname !== "/api/admin/check" && url.pathname !== "/api/admin/collect") {
    return reply({ error: "not found" }, 404, env);
  }
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405, env);

  if (!env.ADMIN_TOKEN) return reply({ error: "admin disabled" }, 403, env);
  const given = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!(await sameSecret(given, env.ADMIN_TOKEN))) return reply({ error: "unauthorized" }, 401, env);
  if (url.pathname === "/api/admin/check") return reply({ ok: true }, 200, env);

  const last = await env.DB
    .prepare("SELECT value FROM meta WHERE key = 'last_run_at'")
    .first<{ value: string }>();
  const since = Math.floor(Date.now() / 1000) - Number(last?.value ?? 0);
  if (since < MIN_GAP_S) {
    return reply({ error: `collector ran ${since}s ago, try again in ${MIN_GAP_S - since}s` }, 429, env);
  }

  try {
    const summary = await runCollector(env);
    console.log(JSON.stringify({ event: "admin_collect", newStories: summary.newStories }));
    return reply(summary, 200, env);
  } catch (e) {
    console.error("[admin] collect failed", e);
    return reply({ error: "collector failed" }, 500, env);
  }
}

/** Constant-time comparison (hash both sides so lengths match). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function cors(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function reply(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(env) },
  });
}
