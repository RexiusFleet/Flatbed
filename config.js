/* Dept 12 Dashboard — connection settings.
 *
 * Paste your Supabase project's values here (SETUP.md, step 5):
 *   Project URL      → Supabase dashboard → Project Settings → Data API
 *   Publishable key  → Project Settings → API Keys ("sb_publishable_…",
 *                      or the legacy "anon" key on older projects)
 *
 * Both values are PUBLIC by design — they are safe to commit and ship to
 * the browser. They only identify the project; Row Level Security and the
 * sign-in decide what anyone can see. NEVER put a secret / service_role key,
 * the Motive key, or the Google service-account JSON in this file.
 *
 * googleClientId (Google Cloud → APIs & Services → Credentials, OAuth client)
 * is public too: it only names the app on Google's sign-in popup for
 * "Update Google Schedule". Each person's own Google account decides access.
 */
window.DEPT12_CONFIG = {
  supabaseUrl: "https://hejfskuvehauviocqhxu.supabase.co",
  supabaseKey: "sb_publishable_Qvyugu-byMr-vq3FMb6cZA_tNevprb-",
  googleClientId: "200024464110-geud915kbljc4ptc1oah56ofolvr61lm.apps.googleusercontent.com"
};
