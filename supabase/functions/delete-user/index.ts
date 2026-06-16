import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const restHeaders = {
      "Content-Type": "application/json",
      Apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };

    // Clean up all FK references to auth.users before deleting,
    // otherwise Supabase returns "Database error deleting user".
    await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/registrations?validated_by=eq.${user_id}`, {
        method: "PATCH",
        headers: { ...restHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ validated_by: null }),
      }),
      fetch(`${supabaseUrl}/rest/v1/registrations?user_id=eq.${user_id}`, {
        method: "PATCH",
        headers: { ...restHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: null }),
      }),
      fetch(`${supabaseUrl}/rest/v1/validation_logs?admin_id=eq.${user_id}`, {
        method: "PATCH",
        headers: { ...restHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ admin_id: null }),
      }),
      fetch(`${supabaseUrl}/rest/v1/feedback_tickets?user_id=eq.${user_id}`, {
        method: "PATCH",
        headers: { ...restHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: null }),
      }),
      fetch(`${supabaseUrl}/rest/v1/user_sessions?user_id=eq.${user_id}`, {
        method: "DELETE",
        headers: restHeaders,
      }),
    ]);

    // user_profiles has ON DELETE CASCADE so it will be removed automatically.
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user_id}`, {
      method: "DELETE",
      headers: {
        Apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Delete user failed:", res.status, body);
      return new Response(JSON.stringify({ error: `Auth delete failed: ${res.status}` }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("delete-user error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
