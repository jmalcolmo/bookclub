// Supabase client (loaded from CDN as an ES module).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONFIG, ENV_NAME } from "../config.js";

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export { ENV_NAME };
