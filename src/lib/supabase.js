import { createClient } from "@supabase/supabase-js";
import { getAuthCallbackType } from "../auth/authCallback.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const backendConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const initialAuthCallbackType = typeof window === "undefined"
  ? null
  : getAuthCallbackType(window.location.href);

export const supabase = backendConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
