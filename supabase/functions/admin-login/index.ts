import { createClient } from 'https://esm.sh/@supabase/supabase-js';

Deno.serve(async (req) => {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'missing_params' }), { status: 400 });
    }

    const email = `${username.toUpperCase()}@admin.ticketing.local`;

    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find((u: any) => u.email === email);

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirmed_at: new Date().toISOString(),
      });
    } else {
      const { data: newUser } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (!newUser?.id) {
        return new Response(JSON.stringify({ error: 'create_user_failed' }), { status: 500 });
      }
      userId = newUser.id;
    }

    await supabaseAdmin.from('admin_profiles').upsert(
      { id: userId, username: username.toUpperCase() },
      { onConflict: 'username' }
    );

    return new Response(JSON.stringify({ success: true, email }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
