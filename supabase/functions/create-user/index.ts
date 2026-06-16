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
    const { username, password, display_name, phone } = await req.json();

    if (!username || !password) {
      return new Response(JSON.stringify({ error: "Username and password required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!phone) {
      return new Response(JSON.stringify({ error: "Phone number is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create auth user via admin API
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use digits-only phone as email prefix so login can reconstruct the email
    const phoneDigits = phone.replace(/\D/g, '');
    const email = `${phoneDigits}@user.ticketing.local`;

    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
      }),
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      return new Response(JSON.stringify({ error: createData.msg || createData.message || "Failed to create user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = createData.id;

    // Create user profile
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: userId,
        display_name: display_name || null,
        phone: phone || null,
      }),
    });

    const profileData = await profileRes.json();

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      profile: Array.isArray(profileData) ? profileData[0] : profileData,
    }), {
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
