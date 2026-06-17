import { createClient } from 'https://esm.sh/@supabase/supabase-js';

Deno.serve(async (req) => {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const { username, password, phone, display_name } = await req.json();

    if (!username || !password || !phone) {
      return new Response(JSON.stringify({ error: 'missing_params' }), { status: 400 });
    }

    const phoneDigits = phone.replace(/\D/g, '');
    const email = `${phoneDigits}@user.ticketing.local`;

    const { data: user, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !user) {
      return new Response(JSON.stringify({ error: createError?.message || 'create_user_failed' }), { status: 500 });
    }

    const { error: profileError } = await supabaseAdmin.from('user_profiles').insert({
      id: user.id,
      display_name: display_name || username,
      phone,
    });

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message || 'create_profile_failed' }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, user_id: user.id }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
