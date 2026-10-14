// FinStreet — Cloudflare Worker entry point.
//   scheduled(): collector, every 15 minutes (wrangler.toml [triggers])
//   fetch():     read-only JSON API for the app under /api/*, plus the admin-only /api/admin/*
import { handleAdmin } from "./admin";
import { handleApi } from "./api";
import { runCollector } from "./collector";

export interface Env {
  DB: D1Database;
  CONTACT_EMAIL: string;
  ALLOWED_ORIGIN: string;
  ADMIN_TOKEN?: string; // secret; enables POST /api/admin/collect
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCollector(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/api/admin/")) return handleAdmin(req, env);
    return handleApi(req, env);
  },
} satisfies ExportedHandler<Env>;
