-- ============================================================
-- PART 2: HELPER FUNCTIONS
-- ============================================================

DROP FUNCTION IF EXISTS get_lcoin_to_rmb_rate();
CREATE OR REPLACE FUNCTION get_lcoin_to_rmb_rate()
RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT rate FROM lcoin_exchange_rates 
     WHERE from_currency = 'lcoin' AND to_currency = 'rmb' AND is_active = true 
     ORDER BY effective_date DESC LIMIT 1),
    1
  );
END;
$$;

DROP FUNCTION IF EXISTS calculate_refund_penalty(UUID, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION calculate_refund_penalty(
  p_session_id UUID,
  p_cancel_time TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_hours_before DECIMAL;
  v_rules JSONB;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '场次不存在');
  END IF;

  BEGIN
    v_hours_before := EXTRACT(EPOCH FROM (v_session.session_date::date + v_session.start_time::time - p_cancel_time)) / 3600;
  EXCEPTION WHEN OTHERS THEN
    v_hours_before := -999999;
  END;

  v_rules := v_session.refund_penalty_rules;
  IF v_rules IS NULL OR jsonb_typeof(v_rules) != 'array' OR jsonb_array_length(v_rules) = 0 THEN
    RETURN jsonb_build_object('success', true, 'hours_before', v_hours_before, 'penalty_rate', 0, 'description', '全额退款');
  END IF;

  FOR i IN 0..jsonb_array_length(v_rules)-1 LOOP
    BEGIN
      IF v_hours_before >= (v_rules->i->>'hours_before')::DECIMAL THEN
        RETURN jsonb_build_object(
          'success', true,
          'hours_before', v_hours_before,
          'penalty_rate', (v_rules->i->>'penalty_rate')::DECIMAL,
          'description', COALESCE(v_rules->i->>'description', '')
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  BEGIN
    RETURN jsonb_build_object(
      'success', true,
      'hours_before', v_hours_before,
      'penalty_rate', (v_rules->(jsonb_array_length(v_rules)-1)->>'penalty_rate')::DECIMAL,
      'description', COALESCE(v_rules->(jsonb_array_length(v_rules)-1)->>'description', '')
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', true, 'hours_before', v_hours_before, 'penalty_rate', 1.0, 'description', '过期退票');
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', '计算失败: ' || SQLERRM);
END;
$$;