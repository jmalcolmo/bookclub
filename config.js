// ============================================================================
// ENVIRONMENT CONFIG
// ----------------------------------------------------------------------------
// Anon keys are SAFE to commit — they only grant access allowed by Row-Level
// Security. Do NOT put the service_role key here; it bypasses RLS.
//
// The environment is chosen by hostname:
//   localhost / 127.0.0.1            -> DEV   Supabase project
//   <anything else, e.g. *.github.io> -> PROD  Supabase project
// ============================================================================

const ENVIRONMENTS = {
  dev: {
    // TODO: paste your DEV Supabase project values
    SUPABASE_URL: "https://YOUR_DEV_PROJECT.supabase.co",
    SUPABASE_ANON_KEY: "YOUR_DEV_ANON_KEY",
  },
  prod: {
    // TODO: paste your PROD Supabase project values
    SUPABASE_URL: "https://YOUR_PROD_PROJECT.supabase.co",
    SUPABASE_ANON_KEY: "YOUR_PROD_ANON_KEY",
  },
};

const host = window.location.hostname;
const isDev = host === "localhost" || host === "127.0.0.1" || host === "";

export const ENV_NAME = isDev ? "dev" : "prod";
export const CONFIG = ENVIRONMENTS[ENV_NAME];

if (CONFIG.SUPABASE_URL.includes("YOUR_")) {
  console.warn(
    `[config] ${ENV_NAME} Supabase credentials are not set yet. Edit config.js.`
  );
}
