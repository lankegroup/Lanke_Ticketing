import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const email = "lanke@admin.ticketing.local";

  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = (existing?.users ?? []).find((u: any) => u.email === email);
  if (found) {
    return new Response(JSON.stringify({ ok: true, existed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: "88888888",
    email_confirm: true,
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (data.user) {
    await supabase.from("admin_profiles").insert({ id: data.user.id, username: "LANKE" });
  }

  return new Response(JSON.stringify({ ok: true, existed: false }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
