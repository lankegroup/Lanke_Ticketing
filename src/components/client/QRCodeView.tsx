import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, Registration, formatSeatName, TicketType, TICKET_TYPE_LABELS } from '../../lib/supabase';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

type Props = {
  ticket: Registration;
  onBack: () => void;
};

export default function QRCodeView({ ticket, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const [QRCode, setQRCode] = useState<any>(null);
  const [liveStatus, setLiveStatus] = useState(ticket.status);
  const isEn = i18n.language === 'en';
  const s = ticket.sessions as any;
  const seat = (ticket as any).seats;

  useEffect(() => {
    import('qrcode.react').then(mod => setQRCode(() => mod.QRCodeCanvas));
  }, []);

  useEffect(() => {
    setLiveStatus(ticket.status);
  }, [ticket.status]);

  useEffect(() => {
    if (ticket.status !== 'active') return;
    const channel = supabase
      .channel(`qrview:${ticket.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'registrations', filter: `id=eq.${ticket.id}` },
        (payload) => setLiveStatus((payload.new as Registration).status)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [ticket.id, ticket.status]);

  const isActive = liveStatus === 'active';
  const justVerified = ticket.status === 'active' && liveStatus === 'used';

  const sessionName = s?.name || '';
  const sessionDate = s?.session_date || '';
  const sessionTime = s ? `${s.start_time?.slice(0, 5) || ''}–${s.end_time?.slice(0, 5) || ''}` : '';
  const seatName = seat?.seat_name ? formatSeatName(seat.seat_name, isEn) : (isEn ? 'No Seat' : '不分座');

  const statusLabel: Record<string, string> = {
    active: isEn ? 'VALID' : '待入场',
    used: isEn ? 'USED' : '已核销',
    cancelled: isEn ? 'CANCELLED' : '已取消',
    expired: isEn ? 'EXPIRED' : '已过期',
  };
  const statusColor: Record<string, string> = {
    active: 'text-emerald-400',
    used: 'text-gray-400',
    cancelled: 'text-red-400',
    expired: 'text-amber-400',
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="bg-slate-800/80 backdrop-blur text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={18} />
        </button>
        <span className={`font-semibold ${isEn ? 'text-sm' : 'text-base'}`}>{t('view_ticket')}</span>
      </div>

      <div className="p-4 flex flex-col items-center">
        <div className="w-full max-w-sm relative">

          {/* ── Verified overlay ─────────────────────────────────────────── */}
          {justVerified && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/95 rounded-3xl">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                <ShieldCheck size={44} className="text-emerald-400" />
              </div>
              <p className="text-2xl font-black text-emerald-400 mb-1 tracking-wide">
                {isEn ? 'VERIFIED' : '核销成功'}
              </p>
              <p className="text-slate-400 text-sm text-center px-8 mt-1 leading-relaxed">
                {isEn ? 'Ticket successfully checked in.' : '该票已核销，不可再次使用。'}
              </p>
              <button
                onClick={onBack}
                className="mt-6 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                {isEn ? 'Back' : '返回'}
              </button>
            </div>
          )}

          {/* ── Main ticket card ─────────────────────────────────────────── */}
          <div className={`rounded-3xl overflow-hidden shadow-2xl transition-opacity ${!isActive ? 'opacity-60' : ''}`}
            style={{ background: 'linear-gradient(160deg, #1e293b 0%, #0f172a 100%)' }}
          >
            {/* Top accent bar */}
            <div className="h-1 w-full bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-500" />

            {/* Header section */}
            <div className="relative z-10 px-6 pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-3">
                  <p className="text-sky-400 text-[10px] font-bold tracking-widest uppercase mb-1">
                    {isEn ? 'E-TICKET' : '电子入场券'}
                  </p>
                  <h2 className="text-white font-bold text-lg leading-tight line-clamp-2">{sessionName || (isEn ? 'Event' : '活动')}</h2>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className={`text-xs font-black tracking-widest ${statusColor[liveStatus] || 'text-gray-400'}`}>
                    {statusLabel[liveStatus] || liveStatus}
                  </span>
                </div>
              </div>

              {/* Date + Time row */}
              {sessionDate && (
                <div className="flex items-center gap-4 mt-3">
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wider">{isEn ? 'Date' : '日期'}</p>
                    <p className="text-white text-sm font-semibold">{sessionDate}</p>
                  </div>
                  {sessionTime && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wider">{isEn ? 'Time' : '时间'}</p>
                      <p className="text-white text-sm font-semibold">{sessionTime}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Seat highlight */}
            <div className="relative z-10 mx-6 mb-4 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-0.5">{isEn ? 'Seat' : '座位'}</p>
                <p className="text-white font-black text-3xl leading-none tracking-tight">{seatName}</p>
                {ticket.ticket_type && (
                  <span className={`inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${TICKET_TYPE_LABELS[ticket.ticket_type as TicketType].bg} ${TICKET_TYPE_LABELS[ticket.ticket_type as TicketType].color}`}>
                    {TICKET_TYPE_LABELS[ticket.ticket_type as TicketType][isEn ? 'en' : 'cn']}
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-0.5">{isEn ? 'Name' : '姓名'}</p>
                <p className="text-white font-semibold text-base">{ticket.name}</p>
                {ticket.phone && <p className="text-slate-400 text-xs mt-0.5">{ticket.phone}</p>}
              </div>
            </div>

            {/* Dashed perforation line */}
            <div className="relative z-10 flex items-center mx-0 my-0">
              <div className="w-6 h-6 bg-slate-900 rounded-full -ml-3 flex-shrink-0" />
              <div className="flex-1 border-t-2 border-dashed border-white/10" />
              <div className="w-6 h-6 bg-slate-900 rounded-full -mr-3 flex-shrink-0" />
            </div>

            {/* QR Code stub */}
            <div className="relative z-10 px-6 pt-4 pb-5">
              <div className="flex items-center gap-5">
                {/* QR code */}
                <div className="flex-shrink-0">
                  {isActive ? (
                    <div className="bg-white p-2.5 rounded-2xl shadow-inner">
                      {QRCode ? (
                        <QRCode
                          value={ticket.ticket_code}
                          size={110}
                          level="H"
                          includeMargin={false}
                          style={{ display: 'block' }}
                        />
                      ) : (
                        <div className="w-[110px] h-[110px] flex items-center justify-center text-gray-300 text-xs">{t('loading')}</div>
                      )}
                    </div>
                  ) : (
                    <div className="w-[126px] h-[126px] bg-white/5 rounded-2xl flex items-center justify-center">
                      <span className="text-slate-600 text-xs">N/A</span>
                    </div>
                  )}
                </div>

                {/* Right side: code + tip */}
                <div className="flex-1 min-w-0">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-1.5">{isEn ? 'Ticket Code' : '票号'}</p>
                  <p className="font-mono font-black text-white text-lg tracking-widest leading-none break-all">{ticket.ticket_code}</p>
                  <div className="mt-3 space-y-1">
                    <p className="text-slate-500 text-[10px] leading-relaxed">
                      {isEn ? 'Scan QR code at the entrance for admission.' : '入场时出示二维码供工作人员扫描核销。'}
                    </p>
                    {isActive && (
                      <div className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2 py-0.5 mt-1">
                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                        <span className="text-emerald-400 text-[10px] font-semibold">{isEn ? 'Ready to scan' : '可扫码入场'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Order number at very bottom */}
              <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-center">
                <span className="text-slate-600 text-[10px]">{isEn ? 'Order' : '订单号'}</span>
                <span className="text-slate-500 text-[10px] font-mono">{ticket.id.slice(0, 16).toUpperCase()}</span>
              </div>
            </div>
          </div>

          <p className="text-center text-slate-600 text-[11px] mt-4 px-4 leading-relaxed">
            {t('ticket_only_valid')}
          </p>
        </div>
      </div>
    </div>
  );
}
