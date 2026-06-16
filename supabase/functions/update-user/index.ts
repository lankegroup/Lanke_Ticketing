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
    const { user_id, display_name, phone } = await req.json();

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

    // Refuse to update admin users — their email is managed separately
    const adminCheck = await fetch(`${supabaseUrl}/rest/v1/admin_profiles?id=eq.${user_id}&select=id`, {
      headers: restHeaders,
    });
    if (adminCheck.ok) {
      const admins = await adminCheck.json();
      if (Array.isArray(admins) && admins.length > 0) {
        return new Response(JSON.stringify({ error: "Cannot update admin users via this endpoint" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Update user_profiles
    const profileUpdate: Record<string, unknown> = {};
    if (display_name !== undefined) profileUpdate.display_name = display_name || null;
    if (phone !== undefined) profileUpdate.phone = phone || null;

    if (Object.keys(profileUpdate).length > 0) {
      const pRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${user_id}`, {
        method: "PATCH",
        headers: { ...restHeaders, Prefer: "return=minimal" },
        body: JSON.stringify(profileUpdate),
      });
      if (!pRes.ok) {
        const body = await pRes.text();
        return new Response(JSON.stringify({ error: `Profile update failed: ${body}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // If phone changed, update the auth user's email to keep login working
    if (phone) {
      const phoneDigits = String(phone).replace(/\D/g, "");
      if (phoneDigits) {
        const newEmail = `${phoneDigits}@user.ticketing.local`;
        const aRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user_id}`, {
          method: "PUT",
          headers: restHeaders,
          body: JSON.stringify({ email: newEmail, email_confirm: true }),
        });
        if (!aRes.ok) {
          const body = await aRes.text();
          return new Response(JSON.stringify({ error: `Auth update failed: ${body}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
