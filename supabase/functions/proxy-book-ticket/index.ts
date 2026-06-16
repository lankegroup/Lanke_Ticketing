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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is an authenticated admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Apikey: serviceRoleKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!userRes.ok) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userJson = await userRes.json();
    const callerId = userJson?.id;

    // Confirm caller is in admin_profiles
    const adminCheck = await fetch(
      `${supabaseUrl}/rest/v1/admin_profiles?id=eq.${callerId}&select=id`,
      {
        headers: {
          Apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    const adminData = await adminCheck.json();
    if (!Array.isArray(adminData) || adminData.length === 0) {
      return new Response(JSON.stringify({ error: "admin_only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      p_session_id, p_seat_id, p_name, p_phone, p_user_id,
      p_force, p_order_source, p_is_supplementary, p_ticket_type,
    } = await req.json();

    if (!p_session_id || !p_name || !p_phone) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/admin_book_ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        p_session_id,
        p_seat_id: p_seat_id ?? null,
        p_name,
        p_phone,
        p_user_id,
        p_force: p_force ?? false,
        p_order_source: p_order_source ?? "admin",
        p_is_supplementary: p_is_supplementary ?? false,
        p_ticket_type: p_ticket_type ?? "adult",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("admin_book_ticket rpc failed:", res.status, data);
      return new Response(JSON.stringify({ error: data?.message || "rpc_failed" }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("proxy-book-ticket error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
