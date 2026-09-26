import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 
                    import.meta.env.NEXT_PUBLIC_SUPABASE_URL || 
                    'https://vlyfifpdsmimphchitnm.supabase.co';

const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 
                    import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
                    'sb_publishable_co9uWjRY8D5PSec1rezazA_O2P2PyHs';

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function checkSupabaseHealth() {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    return {
      connected: res.status < 500,
      url: supabaseUrl,
      status: res.status
    };
  } catch (err) {
    return {
      connected: false,
      url: supabaseUrl,
      error: err.message
    };
  }
}
