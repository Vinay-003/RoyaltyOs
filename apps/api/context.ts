import { loadConfig } from "../../packages/core/config.ts";
import { SupabaseClient } from "../../packages/supabase/client.ts";
import { Repository } from "../../packages/supabase/repository.ts";
import { PayPalGateway } from "../../packages/paypal/gateway.ts";

export function createAppContext(fetchImpl: typeof fetch = fetch) {
  const config = loadConfig();
  const supabase = new SupabaseClient(config.supabase.url, config.supabase.anonKey, config.supabase.serviceRoleKey, fetchImpl);
  const repo = new Repository(supabase);
  const paypal = new PayPalGateway(config, fetchImpl);
  return { config, supabase, repo, paypal, fetchImpl };
}

export type AppContext = ReturnType<typeof createAppContext>;
