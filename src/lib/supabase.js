import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) 
  ? import.meta.env 
  : (typeof process !== 'undefined' && process.env ? process.env : {});

const rawUrl = env.VITE_SUPABASE_URL || "https://kfksyxgkvffhmulfxgcn.supabase.co";
const anonKey = env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtma3N5eGdrdmZmaG11bGZ4Z2NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTQ4ODIsImV4cCI6MjEwODY5MDg4Mn0.UEiQhnQGFkfEWUUbd2HKWXpl1NUgbHZphIz_7G_7W9M";

// Defensive check: strip trailing `/rest/v1` or trailing slashes if inadvertently provided
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

export const supabase = createClient(supabaseUrl, anonKey);
