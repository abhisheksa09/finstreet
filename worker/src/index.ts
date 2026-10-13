// FinStreet — Cloudflare Worker entry point.
//   scheduled(): collector, every 15 minutes (wrangler.toml [triggers])
//   fetch():     read-only JSON API for the app under /api/*
import { handleApi } from "./api";
import { runCollector } from "./collector";

export interface Env {
  DB: D1Database;
  CONTACT_EMAIL: string;
  ALLOWED_ORIGIN: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCollector(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    return handleApi(req, env);
  },
} satisfies ExportedHandler<Env>;
