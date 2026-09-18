import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://llftfgtswvmwtbmkegpd.supabase.co",
  "sb_publishable_8OYKt3WYC0bLoeeqq_jTMQ_ICDOG09x",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
