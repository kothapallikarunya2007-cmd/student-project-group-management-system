import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    'https://vlyfifpdsmimphchitnm.supabase.co';

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                    process.env.SUPABASE_KEY || 
                    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
                    'sb_publishable_co9uWjRY8D5PSec1rezazA_O2P2PyHs';

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

export async function checkSupabaseConnection() {
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, message: 'Supabase credentials not configured' };
  }
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    // Even if it returns 200 or 404 (endpoint info) or requires secret key, the server is reachable
    return { 
      ok: res.status < 500, 
      status: res.status, 
      url: supabaseUrl, 
      configured: true 
    };
  } catch (error) {
    return { ok: false, error: error.message, url: supabaseUrl, configured: true };
  }
}
