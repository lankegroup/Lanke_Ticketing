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

    const { action, user_id, order_id, session_id, amount, ticket_type, seat_name, service_fee_amount, description, payment_method } = await req.json();

    if (!action || !user_id || !amount) {
      return new Response(JSON.stringify({ success: false, error: "missing_params" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let rpcName = "";
    let rpcParams: Record<string, unknown> = {};

    switch (action) {
      case "recharge":
        rpcName = "admin_recharge_lcoin";
        rpcParams = { p_user_id: user_id, p_amount: amount, p_description: description || "管理员充值" };
        break;
      case "adjust_add":
        rpcName = "admin_adjust_lcoin";
        rpcParams = { p_user_id: user_id, p_amount: amount, p_is_add: true, p_description: description || "管理员调整" };
        break;
      case "adjust_subtract":
        rpcName = "admin_adjust_lcoin";
        rpcParams = { p_user_id: user_id, p_amount: amount, p_is_add: false, p_description: description || "管理员调整" };
        break;
      case "purchase":
        rpcName = "deduct_lcoin_for_purchase";
        rpcParams = { p_user_id: user_id, p_order_id: order_id, p_session_id: session_id, p_amount: amount, p_ticket_type: ticket_type, p_seat_name: seat_name, p_service_fee_amount: service_fee_amount || 0 };
        break;
      case "refund":
        rpcName = "refund_lcoin_for_cancellation";
        rpcParams = { p_user_id: user_id, p_order_id: order_id, p_session_id: session_id, p_amount: amount, p_ticket_type: ticket_type, p_seat_name: seat_name, p_service_fee_amount: service_fee_amount || 0 };
        break;
      default:
        return new Response(JSON.stringify({ success: false, error: "invalid_action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const rpcUrl = supabaseUrl + "/rest/v1/rpc/" + rpcName;
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Apikey": serviceRoleKey,
        "Authorization": "Bearer " + serviceRoleKey,
      },
      body: JSON.stringify(rpcParams),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(rpcName + " rpc failed:", res.status, data);
      return new Response(JSON.stringify({ success: false, error: data?.message || data?.error || "rpc_failed" }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("lcoin-transaction error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});