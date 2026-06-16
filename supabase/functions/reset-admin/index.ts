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

  const targetEmail = "lanke@admin.ticketing.local";
  const targetPassword = "88888888";

  // Find the admin_profiles row for LANKE
  const { data: adminProfile, error: apErr } = await supabase
    .from("admin_profiles")
    .select("id, username")
    .eq("username", "LANKE")
    .maybeSingle();

  if (apErr || !adminProfile) {
    return new Response(JSON.stringify({ ok: false, error: "Admin profile not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = adminProfile.id;

  // Reset email + password + unban + confirm
  const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
    email: targetEmail,
    password: targetPassword,
    email_confirm: true,
    ban_duration: "none",
  });

  if (updateErr) {
    return new Response(JSON.stringify({ ok: false, error: updateErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Clear all auth sessions for this user so no stale tokens interfere
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ scope: "global" }),
  });

  // Remove user_sessions custom rows for this admin
  await supabase.from("user_sessions").delete().eq("user_id", userId);

  return new Response(JSON.stringify({ ok: true, user_id: userId, email: targetEmail }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
