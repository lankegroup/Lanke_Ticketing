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
    const { p_session_id, p_seat_id, p_name, p_phone, p_user_id, p_ticket_type, p_buyer_user_id, p_note_content } = await req.json();

    if (!p_session_id || !p_name || !p_phone) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const ticketType = p_ticket_type ?? "adult";

    const rpcName = p_seat_id ? "book_ticket_with_seat" : "book_ticket";
    const rpcBody = p_seat_id
      ? { p_session_id, p_seat_id, p_name, p_phone, p_user_id: p_user_id ?? null, p_ticket_type: ticketType, p_buyer_user_id: p_buyer_user_id ?? null, p_note_content: p_note_content ?? null }
      : { p_session_id, p_name, p_phone, p_user_id: p_user_id ?? null, p_ticket_type: ticketType, p_buyer_user_id: p_buyer_user_id ?? null, p_note_content: p_note_content ?? null };

    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(rpcBody),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`${rpcName} rpc failed:`, res.status, data);
      return new Response(JSON.stringify({ error: data?.message || data?.error || "rpc_failed" }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("book-ticket error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
