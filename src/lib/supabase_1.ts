import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  const session = (await supabase.auth.getSession()).data.session;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/upload-image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token ?? ''}`,
        Apikey: supabaseAnonKey,
      },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data?.url) return { url: null, error: data?.error ?? 'upload failed' };
    return { url: data.url, error: null };
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
  default_service_fee: number;
};

export type TicketType = 'adult' | 'child' | 'concession';

export const TICKET_TYPE_LABELS: Record<TicketType, { cn: string; en: string; color: string; bg: string }> = {
  adult:     { cn: '成人票', en: 'Adult',       color: 'text-sky-700',    bg: 'bg-sky-100'    },
  child:     { cn: '儿童票', en: 'Child',       color: 'text-emerald-700', bg: 'bg-emerald-100' },
  concession:{ cn: '优待票', en: 'Concession',  color: 'text-amber-700',  bg: 'bg-amber-100'  },
};

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
