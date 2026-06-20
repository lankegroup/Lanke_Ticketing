import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function validateRemark(text: string | null | undefined): { valid: boolean; message: string } {
  if (!text || text.trim().length === 0) {
    return { valid: true, message: '' };
  }

  const trimmed = text.trim();
  
  const chineseCount = (trimmed.match(/[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]/g) || []).length;
  
  const noSpaceText = trimmed.replace(/\s+/g, '');
  const westernGroups = (noSpaceText.match(/[a-zA-Z0-9]+|[^\u4e00-\u9fa5\s]/g) || []).length;

  if (chineseCount > 30) {
    return { valid: false, message: `备注中文内容超过30个字符（当前${chineseCount}个）` };
  }

  if (westernGroups > 20) {
    return { valid: false, message: `备注西文字组超过20个（当前${westernGroups}个）` };
  }

  return { valid: true, message: '' };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { p_session_id, p_seat_id, p_name, p_phone, p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, p_lcoin_amount, p_cash_amount } = await req.json();

    if (!p_session_id || !p_name || !p_phone) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const noteValidation = validateRemark(p_note_content);
    if (!noteValidation.valid) {
      return new Response(JSON.stringify({ 
        success: false,
        error: "invalid_remark",
        message: noteValidation.message,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const ticketType = p_ticket_type ?? "adult";

    const rpcName = p_seat_id ? "book_ticket_with_seat" : "book_ticket";
    const rpcBody = p_seat_id
      ? { p_session_id, p_seat_id, p_name, p_phone, p_user_id: p_user_id ?? null, p_ticket_type: ticketType, p_buyer_user_id: p_buyer_user_id ?? null, p_note_content: p_note_content ?? null, p_lcoin_amount: p_lcoin_amount ?? 0, p_cash_amount: p_cash_amount ?? 0 }
      : { p_session_id, p_name, p_phone, p_user_id: p_user_id ?? null, p_ticket_type: ticketType, p_buyer_user_id: p_buyer_user_id ?? null, p_note_content: p_note_content ?? null, p_lcoin_amount: p_lcoin_amount ?? 0, p_cash_amount: p_cash_amount ?? 0 };

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
      return new Response(JSON.stringify({ 
        success: false,
        error: data?.message || data?.error || "rpc_failed",
        details: data,
        status: res.status,
        rpcName: rpcName,
      }), {
        status: 200,
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
