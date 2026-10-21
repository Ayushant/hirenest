import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== 'https://your-project-id.supabase.co' &&
    supabaseAnonKey !== 'your-supabase-anon-key' &&
    supabaseUrl.startsWith('http')
);

// Single Supabase client instance using only the publishable anon key.
// Never uses a service-role key and never hardcodes credentials.
export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? supabaseUrl! : 'https://placeholder-unconfigured.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey! : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
