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

    const headers = {
      "Content-Type": "application/json",
      Apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };

    const [ticketsRes, sessionsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/rpc/expire_past_tickets`, { method: "POST", headers, body: "{}" }),
      fetch(`${supabaseUrl}/rest/v1/rpc/auto_manage_session_status`, { method: "POST", headers, body: "{}" }),
    ]);

    const data = await ticketsRes.json();

    if (!ticketsRes.ok) {
      console.error("expire_past_tickets rpc failed:", ticketsRes.status, data);
      return new Response(JSON.stringify({ error: data?.message || "rpc_failed" }), {
        status: ticketsRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sessionsRes.ok) {
      const sessErr = await sessionsRes.text();
      console.error("auto_manage_session_status rpc failed:", sessionsRes.status, sessErr);
    }

    return new Response(JSON.stringify({ count: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("expire-tickets error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
