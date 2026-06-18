import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const envConfig = {
  supabaseUrl: supabaseUrl || '',
  supabaseAnonKey: supabaseAnonKey || '',
  hasValidConfig: !!(supabaseUrl && supabaseAnonKey),
};

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

/** Convert Chinese seat name format "A排1座" to English "Row A, Seat 1" */
export function formatSeatName(seatName: string, isEn: boolean): string {
  if (!isEn) return seatName;
  const m = seatName.match(/^([A-Z])排(\d+)座$/);
  if (!m) return seatName;
  return `Row ${m[1]}, Seat ${m[2]}`;
}

export async function uploadImageViaFunction(
  file: File,
  folder: string,
): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() ?? 'bin';
  const filename = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const { data, error } = await supabase.storage
      .from('announcements')
      .upload(filename, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      });

    if (error || !data?.path) {
      return { url: null, error: error?.message ?? 'upload failed' };
    }

    const { data: urlData } = supabase.storage
      .from('announcements')
      .getPublicUrl(data.path);

    return { url: urlData.publicUrl, error: null };
  } catch (e: any) {
    return { url: null, error: e.message };
  }
}

export async function callEdgeFunction<T = unknown>(slug: string, body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const session = (await supabase.auth.getSession()).data.session;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Apikey': supabaseAnonKey,
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: data?.error || `http_${res.status}` };
    return { data: data as T, error: null };
  } catch (e: any) {
    return { data: null, error: e.message };
  }
}

export type Session = {
  id: string;
  name: string;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  available_stock: number;
  is_active: boolean;
  verification_start: string | null;
  verification_end: string | null;
  verify_date: string; // Verification date (year-month-day)
  stop_selling_minutes: number; // Stop selling countdown in minutes
  description: string;
  cover_image: string | null;
  created_at: string;
  has_seating_chart: boolean;
  seat_rows: number;
  seats_per_row: number;
  screen_direction: 'top' | 'bottom' | 'left' | 'right';
  stage_center_col: number | null;
  booking_notice: string;
  ticket_price: number;
  child_price: number | null;
  concession_price: number | null;
  vip_price: number | null;
  default_service_fee: number;
};

export type TicketType = 'adult' | 'child' | 'concession' | 'vip';

export const TICKET_TYPE_LABELS: Record<TicketType, { cn: string; en: string; color: string; bg: string; vipOnly: boolean }> = {
  adult:     { cn: '成人票', en: 'Adult',       color: 'text-sky-700',    bg: 'bg-sky-100',     vipOnly: false },
  child:     { cn: '儿童票', en: 'Child',       color: 'text-emerald-700', bg: 'bg-emerald-100', vipOnly: false },
  concession:{ cn: '优待票', en: 'Concession',  color: 'text-amber-700',  bg: 'bg-amber-100',   vipOnly: false },
  vip:       { cn: 'VIP票',  en: 'VIP',         color: 'text-yellow-700', bg: 'bg-yellow-100',  vipOnly: true  },
};

export type LCoinTransactionType = 'recharge' | 'purchase' | 'refund' | 'adjust_add' | 'adjust_subtract' | 'fee' | 'reschedule';
export type LCoinOperationType = 'user' | 'admin' | 'system' | 'front_desk';
export type LCoinPaymentMethod = 'lcoin' | 'rmb' | 'wechat' | 'alipay';

export type LCoinAccount = {
  id: string;
  user_id: string;
  balance: number;
  frozen_balance: number;
  is_vip: boolean;
  vip_expire_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LCoinTransaction = {
  id: string;
  user_id: string;
  order_id: string | null;
  session_id: string | null;
  transaction_type: LCoinTransactionType;
  direction: 'in' | 'out';
  amount: number;
  balance_before: number;
  balance_after: number;
  ticket_type: string | null;
  seat_name: string | null;
  service_fee_amount: number;
  operator_type: LCoinOperationType | null;
  operator_id: string | null;
  description: string | null;
  transaction_status: 'pending' | 'completed' | 'failed' | 'cancelled';
  third_party_transaction_id: string | null;
  payment_method: LCoinPaymentMethod | null;
  created_at: string;
};

export type LCoinRechargePackage = {
  id: string;
  name: string;
  name_en: string | null;
  price: number;
  lcoin_amount: number;
  description: string | null;
  description_en: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type LCoinServiceFeeRule = {
  id: string;
  session_id: string | null;
  apply_to_all_sessions: boolean;
  rule_type: 'cancellation' | 'reschedule' | 'change_seat';
  time_before_session: number;
  fee_percent: number;
  min_fee: number;
  max_fee: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type LCoinExchangeRate = {
  id: string;
  from_currency: 'rmb' | 'lcoin';
  to_currency: 'rmb' | 'lcoin';
  rate: number;
  is_active: boolean;
  effective_date: string;
  created_at: string;
};

export type PriceCalculationResult = {
  success: boolean;
  base_price?: number;
  service_fee?: number;
  total_price?: number;
  user_balance?: number;
  deduct_amount?: number;
  final_pay?: number;
  ticket_type?: string;
  quantity?: number;
  error?: string;
};

export async function calculatePrice(
  sessionId: string,
  ticketType: TicketType,
  quantity: number,
  userId?: string | null,
  operationType: string = 'purchase'
): Promise<PriceCalculationResult> {
  const result = await callEdgeFunction<PriceCalculationResult>('calculate-price', {
    session_id: sessionId,
    ticket_type: ticketType,
    quantity: quantity,
    user_id: userId || null,
    operation_type: operationType,
  });
  return result.data || { success: false, error: result.error || 'calculation_failed' };
}

export async function getLcoinBalance(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_user_lcoin_balance', { p_user_id: userId });
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}

export async function getLcoinAccount(userId: string): Promise<LCoinAccount | null> {
  const { data, error } = await supabase
    .from('lcoin_accounts')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) return null;
  return data as LCoinAccount;
}

export async function getUserTransactions(userId: string): Promise<LCoinTransaction[]> {
  const { data, error } = await supabase
    .from('lcoin_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data as LCoinTransaction[];
}

export async function getRechargePackages(): Promise<LCoinRechargePackage[]> {
  const { data, error } = await supabase
    .from('lcoin_recharge_packages')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return data as LCoinRechargePackage[];
}

export async function getServiceFeeRules(): Promise<LCoinServiceFeeRule[]> {
  const { data, error } = await supabase
    .from('lcoin_service_fee_rules')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return data as LCoinServiceFeeRule[];
}

export async function getExchangeRates(): Promise<LCoinExchangeRate[]> {
  const { data, error } = await supabase
    .from('lcoin_exchange_rates')
    .select('*')
    .eq('is_active', true);
  if (error) return [];
  return data as LCoinExchangeRate[];
}

export async function getLcoinConfig(): Promise<{ key: string; value: string; value_en: string }[]> {
  const { data, error } = await supabase.from('lcoin_config').select('*');
  if (error) return [];
  return data as { key: string; value: string; value_en: string }[];
}

export async function rechargeLcoin(userId: string, amount: number, description?: string): Promise<{ success: boolean; error?: string }> {
  const result = await callEdgeFunction('lcoin-transaction', {
    action: 'recharge',
    user_id: userId,
    amount: amount,
    description: description || '管理员充值',
  });
  if (result.error) return { success: false, error: result.error };
  const data = result.data as { success: boolean; error?: string };
  return data || { success: false, error: 'recharge_failed' };
}

export async function adjustLcoin(userId: string, amount: number, isAdd: boolean, description?: string): Promise<{ success: boolean; error?: string }> {
  const result = await callEdgeFunction('lcoin-transaction', {
    action: isAdd ? 'adjust_add' : 'adjust_subtract',
    user_id: userId,
    amount: amount,
    description: description || '管理员调整',
  });
  if (result.error) return { success: false, error: result.error };
  const data = result.data as { success: boolean; error?: string };
  return data || { success: false, error: 'adjust_failed' };
}

export async function deductLcoinForPurchase(
  userId: string,
  orderId: string,
  sessionId: string,
  amount: number,
  ticketType: TicketType,
  seatName?: string,
  serviceFeeAmount?: number
): Promise<{ success: boolean; error?: string }> {
  const result = await callEdgeFunction('lcoin-transaction', {
    action: 'purchase',
    user_id: userId,
    order_id: orderId,
    session_id: sessionId,
    amount: amount,
    ticket_type: ticketType,
    seat_name: seatName || null,
    service_fee_amount: serviceFeeAmount || 0,
  });
  if (result.error) return { success: false, error: result.error };
  const data = result.data as { success: boolean; error?: string };
  return data || { success: false, error: 'purchase_failed' };
}

export async function refundLcoinForCancellation(
  userId: string,
  orderId: string,
  sessionId: string,
  amount: number,
  ticketType: TicketType,
  seatName?: string,
  serviceFeeAmount?: number
): Promise<{ success: boolean; error?: string }> {
  const result = await callEdgeFunction('lcoin-transaction', {
    action: 'refund',
    user_id: userId,
    order_id: orderId,
    session_id: sessionId,
    amount: amount,
    ticket_type: ticketType,
    seat_name: seatName || null,
    service_fee_amount: serviceFeeAmount || 0,
  });
  if (result.error) return { success: false, error: result.error };
  const data = result.data as { success: boolean; error?: string };
  return data || { success: false, error: 'refund_failed' };
}

export type SeatMapRow = {
  id: string;
  row_index: number;
  col_index: number;
  seat_name: string;
  is_booked: boolean;
  is_locked: boolean;
  locked_by_me: boolean;
  is_blocked: boolean;
  block_reason: string | null;
  booked_ticket_type: TicketType | null;
};

export type Registration = {
  id: string;
  name: string;
  phone: string;
  session_id: string;
  seat_id: string | null;
  ticket_code: string;
  status: 'active' | 'used' | 'cancelled' | 'expired';
  validated_at: string | null;
  validated_by: string | null;
  user_id: string | null;
  buyer_user_id: string | null;
  deleted_at: string | null;
  created_at: string;
  order_source: 'user' | 'admin' | 'front_desk';
  was_force_booked: boolean;
  is_supplementary: boolean;
  ticket_type: TicketType;
  print_count: number;
  reschedule_count: number;
  reschedule_history: Array<{ from_seat: string; to_seat: string; changed_at: string }>;
  service_fee: number;
  paid_at: string | null;
  printed_at: string | null;
  // One-way note system fields
  note_content: string | null;
  note_author: 'user' | 'admin' | null;
  is_note_read: boolean;
  note_status: 'pending' | 'completed' | null;
  sessions?: Session;
  seats?: { seat_name: string } | null;
};

/** Returns 'active' for a ticket whose DB status is 'expired' but whose
 *  session_date is today or in the future — guards against premature expiry. */
export function getDisplayStatus(reg: Registration): Registration['status'] {
  if (reg.status === 'expired') {
    const s = reg.sessions as any;
    if (s?.session_date) {
      const today = new Date().toISOString().slice(0, 10);
      if (s.session_date >= today) return 'active';
    }
  }
  return reg.status;
}

export type Notification = {
  id: string;
  user_id: string;
  type: 'info' | 'warning' | 'success';
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

export type UserNote = {
  id: string;
  user_id: string;
  note_content: string;
  note_author: 'user' | 'admin';
  is_handled: boolean;
  created_at: string;
  updated_at: string;
};

export type Announcement = {
  id: string;
  title: string;
  content: string;
  cover_image: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminProfile = {
  id: string;
  username: string;
  employee_id: string;
  created_at: string;
};

export type UserProfile = {
  id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;
};

export type FeedbackTicket = {
  id: string;
  ticket_number: string;
  user_id: string | null;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'resolved';
  admin_reply: string | null;
  replied_at: string | null;
  replied_by: string | null;
  created_at: string;
  updated_at: string;
};
