/**
 * RoyaltyOS Supabase Keepalive Cloudflare Worker
 *
 * Runs every 3 days to prevent Supabase free tier pause (7-day idle limit).
 * Inserts a ping row, then cleans it up 5 minutes later to prevent table bloat.
 *
 * Cron 1: 0 0 */3 * *  (Midnight every 3 days) -> INSERT keepalive row
 * Cron 2: 5 0 */3 * *  (5 mins later)          -> DELETE keepalive row
 *
 * Environment variables required in Cloudflare Worker settings:
 * - SUPABASE_URL: https://<your-project>.supabase.co
 * - SUPABASE_SECRET_KEY: <your-service-role-key>
 * - MANUAL_TRIGGER_TOKEN: (Optional) Secret bearer token for manual /ping & /cleanup HTTP triggers
 */

const INSERT_CRON = "0 0 */3 * *";
const CLEANUP_CRON = "5 0 */3 * *";
const CRON_SOURCE = "cloudflare-cron";

function getSupabaseSecretKey(env) {
  return env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || "";
}

export default {
  /**
   * Cloudflare scheduled cron triggers.
   */
  async scheduled(controller, env, ctx) {
    console.log(`[CRON] Triggered | cron=${controller.cron} | time=${new Date().toISOString()}`);

    // INSERT CRON
    if (controller.cron === INSERT_CRON) {
      console.log("[CRON] Running RoyaltyOS keepalive INSERT");
      ctx.waitUntil(insertKeepalive(env, CRON_SOURCE));
      return;
    }

    // CLEANUP CRON
    if (controller.cron === CLEANUP_CRON) {
      console.log("[CRON] Running RoyaltyOS keepalive CLEANUP");
      ctx.waitUntil(cleanupLatestKeepalive(env, CRON_SOURCE));
      return;
    }

    console.warn(`[CRON] Unknown cron expression: ${controller.cron}`);
  },

  /**
   * HTTP routes for health checks and manual testing.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // GET /
    if (url.pathname === "/") {
      return json({
        ok: true,
        worker: "royaltyos-supabase-keepalive",
        schedules: {
          insert: INSERT_CRON,
          cleanup: CLEANUP_CRON,
        },
        routes: {
          health: "GET /health",
          insert: "POST /ping",
          cleanup: "POST /cleanup",
        },
        timestamp: new Date().toISOString(),
      });
    }

    // GET /health
    if (url.pathname === "/health") {
      return json({
        ok: true,
        worker: "royaltyos-supabase-keepalive",
        environment: {
          SUPABASE_URL_SET: Boolean(env.SUPABASE_URL),
          SUPABASE_SECRET_KEY_SET: Boolean(getSupabaseSecretKey(env)),
          MANUAL_TRIGGER_TOKEN_SET: Boolean(env.MANUAL_TRIGGER_TOKEN),
        },
        schedules: {
          insert: INSERT_CRON,
          cleanup: CLEANUP_CRON,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // POST /ping (Manual insert trigger)
    if (url.pathname === "/ping") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed. Use POST." }, 405);
      }
      const authResult = validateManualRequest(request, env);
      if (!authResult.ok) {
        return json({ ok: false, error: authResult.error }, authResult.status);
      }
      console.log("[MANUAL] Manual keepalive INSERT requested");
      const result = await insertKeepalive(env, "manual");
      return json(result, result.ok ? 200 : 502);
    }

    // POST /cleanup (Manual cleanup trigger)
    if (url.pathname === "/cleanup") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed. Use POST." }, 405);
      }
      const authResult = validateManualRequest(request, env);
      if (!authResult.ok) {
        return json({ ok: false, error: authResult.error }, authResult.status);
      }
      console.log("[MANUAL] Manual keepalive CLEANUP requested");
      const result = await cleanupLatestKeepalive(env, "manual");
      return json(result, result.ok ? 200 : 502);
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

/**
 * Inserts a keepalive row into keepalive_pings
 */
async function insertKeepalive(env, source) {
  const startedAt = Date.now();
  console.log(`[KEEPALIVE INSERT] Starting | source=${source}`);

  const configError = validateSupabaseConfig(env);
  if (configError) {
    console.error(`[KEEPALIVE INSERT] ${configError}`);
    return {
      ok: false,
      operation: "insert",
      error: configError,
      timestamp: new Date().toISOString(),
    };
  }

  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const endpoint = `${supabaseUrl}/rest/v1/keepalive_pings`;
  const headers = buildSupabaseHeaders(env, {
    Prefer: "return=representation",
  });
  const payload = { source };

  try {
    console.log(`[KEEPALIVE INSERT] POST ${endpoint}`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const latency = Date.now() - startedAt;
    const responseBody = await readResponse(response);

    if (!response.ok) {
      console.error(
        `[KEEPALIVE INSERT] FAILED | status=${response.status} | latency=${latency}ms`,
        responseBody
      );
      return {
        ok: false,
        operation: "insert",
        status: response.status,
        latency_ms: latency,
        source,
        response: responseBody,
        timestamp: new Date().toISOString(),
      };
    }

    console.log(
      `[KEEPALIVE INSERT] SUCCESS | status=${response.status} | latency=${latency}ms`,
      responseBody
    );
    return {
      ok: true,
      operation: "insert",
      status: response.status,
      latency_ms: latency,
      source,
      inserted: responseBody,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const latency = Date.now() - startedAt;
    console.error(`[KEEPALIVE INSERT] ERROR | latency=${latency}ms`, error);
    return {
      ok: false,
      operation: "insert",
      status: 0,
      latency_ms: latency,
      source,
      error: error?.message || String(error),
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Finds the latest row inserted for this source in the last 15 mins and deletes it.
 */
async function cleanupLatestKeepalive(env, source) {
  const startedAt = Date.now();
  console.log(`[KEEPALIVE CLEANUP] Starting | source=${source}`);

  const configError = validateSupabaseConfig(env);
  if (configError) {
    console.error(`[KEEPALIVE CLEANUP] ${configError}`);
    return {
      ok: false,
      operation: "cleanup",
      error: configError,
      timestamp: new Date().toISOString(),
    };
  }

  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Step 1: Find recent row
  const findUrl = new URL(`${supabaseUrl}/rest/v1/keepalive_pings`);
  findUrl.searchParams.set("select", "id,source,created_at");
  findUrl.searchParams.set("source", `eq.${source}`);
  findUrl.searchParams.set("created_at", `gte.${cutoff}`);
  findUrl.searchParams.set("order", "created_at.desc");
  findUrl.searchParams.set("limit", "1");

  try {
    console.log(`[KEEPALIVE CLEANUP] Looking for recent row | source=${source}`);
    const findResponse = await fetch(findUrl.toString(), {
      method: "GET",
      headers: buildSupabaseHeaders(env),
    });

    const findBody = await readResponse(findResponse);
    if (!findResponse.ok) {
      const latency = Date.now() - startedAt;
      console.error(
        `[KEEPALIVE CLEANUP] SELECT FAILED | status=${findResponse.status}`,
        findBody
      );
      return {
        ok: false,
        operation: "cleanup-select",
        status: findResponse.status,
        latency_ms: latency,
        source,
        response: findBody,
        timestamp: new Date().toISOString(),
      };
    }

    if (!Array.isArray(findBody) || findBody.length === 0) {
      const latency = Date.now() - startedAt;
      console.log("[KEEPALIVE CLEANUP] No recent keepalive row found. Nothing to delete.");
      return {
        ok: true,
        operation: "cleanup",
        deleted: false,
        reason: "No recent keepalive row found",
        source,
        latency_ms: latency,
        timestamp: new Date().toISOString(),
      };
    }

    const row = findBody[0];
    console.log(`[KEEPALIVE CLEANUP] Found row | id=${row.id} | created_at=${row.created_at}`);

    // Step 2: Delete exact row
    const deleteUrl = new URL(`${supabaseUrl}/rest/v1/keepalive_pings`);
    deleteUrl.searchParams.set("id", `eq.${row.id}`);
    deleteUrl.searchParams.set("source", `eq.${source}`);

    const deleteResponse = await fetch(deleteUrl.toString(), {
      method: "DELETE",
      headers: buildSupabaseHeaders(env, {
        Prefer: "return=representation",
      }),
    });

    const deleteBody = await readResponse(deleteResponse);
    const latency = Date.now() - startedAt;

    if (!deleteResponse.ok) {
      console.error(
        `[KEEPALIVE CLEANUP] DELETE FAILED | id=${row.id} | status=${deleteResponse.status}`,
        deleteBody
      );
      return {
        ok: false,
        operation: "cleanup-delete",
        status: deleteResponse.status,
        latency_ms: latency,
        source,
        row,
        response: deleteBody,
        timestamp: new Date().toISOString(),
      };
    }

    console.log(
      `[KEEPALIVE CLEANUP] SUCCESS | deleted id=${row.id} | latency=${latency}ms`,
      deleteBody
    );
    return {
      ok: true,
      operation: "cleanup",
      deleted: true,
      deleted_row: {
        id: row.id,
        source: row.source,
        created_at: row.created_at,
      },
      response: deleteBody,
      latency_ms: latency,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const latency = Date.now() - startedAt;
    console.error(`[KEEPALIVE CLEANUP] ERROR | latency=${latency}ms`, error);
    return {
      ok: false,
      operation: "cleanup",
      status: 0,
      latency_ms: latency,
      source,
      error: error?.message || String(error),
      timestamp: new Date().toISOString(),
    };
  }
}

function buildSupabaseHeaders(env, extraHeaders = {}) {
  const secretKey = getSupabaseSecretKey(env);
  const headers = {
    apikey: secretKey,
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }

  return headers;
}

function validateSupabaseConfig(env) {
  if (!env.SUPABASE_URL) return "SUPABASE_URL is not configured";
  if (!getSupabaseSecretKey(env)) return "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not configured";
  return null;
}

function validateManualRequest(request, env) {
  if (!env.MANUAL_TRIGGER_TOKEN) {
    return { ok: false, status: 500, error: "MANUAL_TRIGGER_TOKEN is not configured" };
  }
  const authorization = request.headers.get("Authorization");
  const expected = `Bearer ${env.MANUAL_TRIGGER_TOKEN}`;
  if (authorization !== expected) {
    console.warn("[AUTH] Unauthorized manual request");
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

function normalizeSupabaseUrl(url) {
  return url.replace(/\/+$/, "");
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
