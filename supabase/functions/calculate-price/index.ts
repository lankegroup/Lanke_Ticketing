import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.33.1'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { session_id, ticket_type, quantity, user_id, operation_type } = await req.json()

  if (!session_id || !ticket_type || !quantity) {
    return new Response(JSON.stringify({ success: false, error: 'missing_parameters' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const { data, error } = await supabase.rpc('calculate_price', {
      p_session_id: session_id,
      p_ticket_type: ticket_type,
      p_quantity: quantity,
      p_user_id: user_id || null,
      p_operation_type: operation_type || 'purchase',
    })

    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      headers: { 'Content-Type': 'application/json' },
    })
