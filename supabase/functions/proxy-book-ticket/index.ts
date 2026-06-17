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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      p_force, p_order_source, p_is_supplementary, p_ticket_type, p_note_content,
    } = await req.json();

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
        p_user_id: p_user_id ?? null,
        p_force: p_force ?? false,
        p_order_source: p_order_source ?? "admin",
        p_is_supplementary: p_is_supplementary ?? false,
        p_ticket_type: p_ticket_type ?? "adult",
        p_note_content: p_note_content ?? null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("admin_book_ticket rpc failed:", res.status, data);
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
    console.error("proxy-book-ticket error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
