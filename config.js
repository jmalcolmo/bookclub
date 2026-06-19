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
    SUPABASE_URL: "https://wwzvwjhohkyudytoqvfl.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_oWZKSlHJFMQDSiAt-3SwOA_xslAn-_s",
  },
  prod: {
    SUPABASE_URL: "https://kxiyvqpmmfbibeoygmnw.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_B7uxeAfGEWdrZX4if8ZNQw_X6_KIWmH",
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
