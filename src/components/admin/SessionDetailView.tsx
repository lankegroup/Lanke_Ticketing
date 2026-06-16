import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, Session, SeatMapRow, TicketType, TICKET_TYPE_LABELS, Registration } from '../../lib/supabase';
import { ArrowLeft, Edit3, Calendar, Clock, Users, BarChart3, Ticket, MapPin } from 'lucide-react';
import SeatMap from '../SeatMap';

export default function SessionDetailView({
  session,
  onBack,
  onEdit,
}: {
  session: Session;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [recentOrders, setRecentOrders] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [session.id]);

  async function loadData() {
    setLoading(true);
    if (session.has_seating_chart) {
      const { data: seatData } = await supabase.rpc('get_seat_map', { p_session_id: session.id });
      setSeats((seatData as SeatMapRow[]) ?? []);
    }
    const { data: orders } = await supabase
      .from('registrations')
      .select('*, seats(seat_name)')
      .eq('session_id', session.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    setRecentOrders((orders as Registration[]) ?? []);
    setLoading(false);
  }

  // Compute stats
  const totalSeats = session.has_seating_chart ? seats.length : session.capacity;
  const soldSeats = session.has_seating_chart ? seats.filter(s => s.is_booked).length : (session.capacity - (session.available_stock ?? 0));
  const blockedSeats = session.has_seating_chart ? seats.filter(s => s.is_blocked).length : 0;
  const availableSeats = totalSeats - soldSeats - blockedSeats;
  const sellRate = totalSeats > 0 ? ((soldSeats / totalSeats) * 100).toFixed(1) : '0';

  // Session status
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const isPast = session.session_date < today;
  const isToday = session.session_date === today;
  const statusLabel = isPast ? (isEn ? 'Ended' : '已结束') : isToday ? (isEn ? 'In Progress' : '进行中') : (isEn ? 'Upcoming' : '未开始');
  const statusColor = isPast ? 'bg-gray-100 text-gray-600' : isToday ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700';

  const actualRows = seats.length > 0 ? Math.max(...seats.map(s => s.row_index)) : (session.seat_rows ?? 1);
  const actualCols = seats.length > 0 ? Math.max(...seats.map(s => s.col_index)) : (session.seats_per_row ?? 1);

  return (
    <div className="space-y-4 pb-6">
      {/* Top nav bar */}
      <div className="bg-gradient-to-r from-sky-500 to-cyan-500 rounded-2xl px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
          <ArrowLeft size={18} className="text-white" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white text-base truncate">场次详情</h2>
          <p className="text-white/60 text-xs mt-0.5">Session Detail</p>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Basic info card */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <h3 className="font-bold text-gray-900 text-lg">{session.name}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Calendar size={14} className="text-sky-500 flex-shrink-0" />
                <span>{session.session_date}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock size={14} className="text-sky-500 flex-shrink-0" />
                <span>{session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)}</span>
              </div>
              {session.verification_start && session.verification_end && (
                <div className="flex items-center gap-2 text-sm text-gray-600 col-span-2">
                  <Ticket size={14} className="text-emerald-500 flex-shrink-0" />
                  <span>核销 {session.verification_start.slice(0, 5)} – {session.verification_end.slice(0, 5)}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin size={14} className="text-amber-500 flex-shrink-0" />
                <span>{session.has_seating_chart ? `座位图 ${session.seat_rows}×${session.seats_per_row}` : '自由入场'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Users size={14} className="text-violet-500 flex-shrink-0" />
                <span>容量 {session.capacity}</span>
              </div>
            </div>
            {session.ticket_price > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">票价</span>
                <span className="font-bold text-sky-700">¥{session.ticket_price.toFixed(2)}</span>
                {session.default_service_fee > 0 && (
                  <>
                    <span className="text-gray-300">|</span>
                    <span className="text-gray-500">手续费</span>
                    <span className="font-medium text-amber-700">¥{session.default_service_fee.toFixed(2)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Sales statistics */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-sky-500" />
              <h4 className="font-semibold text-gray-800 text-sm">销售数据</h4>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-gray-50 rounded-xl px-3 py-3 text-center">
                <p className="text-lg font-bold text-gray-800">{totalSeats}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">总票数</p>
              </div>
              <div className="bg-sky-50 rounded-xl px-3 py-3 text-center">
                <p className="text-lg font-bold text-sky-700">{soldSeats}</p>
                <p className="text-[10px] text-sky-400 mt-0.5">已售</p>
              </div>
              <div className="bg-emerald-50 rounded-xl px-3 py-3 text-center">
                <p className="text-lg font-bold text-emerald-700">{availableSeats}</p>
                <p className="text-[10px] text-emerald-400 mt-0.5">剩余</p>
              </div>
              <div className="bg-amber-50 rounded-xl px-3 py-3 text-center">
                <p className="text-lg font-bold text-amber-700">{sellRate}%</p>
                <p className="text-[10px] text-amber-400 mt-0.5">售出率</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className="bg-sky-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, parseFloat(sellRate))}%` }}
              />
            </div>
          </div>

          {/* Seat map (read-only) */}
          {session.has_seating_chart && seats.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-sky-500" />
                <h4 className="font-semibold text-gray-800 text-sm">座位图</h4>
                <div className="flex items-center gap-3 ml-auto text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-white border border-gray-300" /> 空闲</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-sky-400" /> 已售</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-400" /> 屏蔽</span>
                </div>
              </div>
              <SeatMap
                seats={seats}
                rows={actualRows}
                seatsPerRow={actualCols}
                screenDirection={session.screen_direction}
                selectedSeatId={null}
                onSeatClick={() => {}}
                stageCenterCol={session.stage_center_col ?? undefined}
              />
            </div>
          )}

          {/* Recent orders */}
          {recentOrders.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-sky-500" />
                  <h4 className="font-semibold text-gray-800 text-sm">近期订单</h4>
                </div>
                <span className="text-[10px] text-gray-400">{recentOrders.length} 条</span>
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {recentOrders.map(r => {
                  const seatName = (r as any).seats?.seat_name;
                  return (
                    <div key={r.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-gray-700 truncate">{r.name}</span>
                        <span className={`font-semibold px-1.5 py-0.5 rounded-full text-[10px] flex-shrink-0 ${
                          r.ticket_type === 'child' ? 'bg-teal-100 text-teal-700' :
                          r.ticket_type === 'concession' ? 'bg-amber-100 text-amber-700' :
                          'bg-sky-100 text-sky-700'
                        }`}>{TICKET_TYPE_LABELS[r.ticket_type ?? 'adult'].cn}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {seatName && <span className="text-gray-400">{seatName}</span>}
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                          r.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                          r.status === 'used' ? 'bg-gray-200 text-gray-600' :
                          r.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                          'bg-gray-200 text-gray-500'
                        }`}>{r.status === 'active' ? '有效' : r.status === 'used' ? '已用' : r.status === 'cancelled' ? '已取消' : '已过期'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom action */}
          <button
            onClick={onEdit}
            className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            <Edit3 size={16} /> 编辑本场次
          </button>
        </>
      )}
    </div>
  );
}
