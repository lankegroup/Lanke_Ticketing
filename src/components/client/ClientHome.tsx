import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, callEdgeFunction, Announcement, Session, SeatMapRow, formatSeatName, TicketType } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ChevronRight, Calendar, Clock, Users, ArrowLeft, X, LayoutGrid, Plus, Minus, Ticket } from 'lucide-react';
import Toast from '../Toast';
import LoginModal from './LoginModal';
import SeatMap from '../SeatMap';
import BookingNoticeModal from '../BookingNoticeModal';

// ─── TicketTypeSegmented ──────────────────────────────────────────────────────

function TicketTypeSegmented({ value, onChange, isEn }: { value: TicketType; onChange: (t: TicketType) => void; isEn: boolean }) {
  const opts: { v: TicketType; label: string; activeCls: string }[] = [
    { v: 'adult',      label: isEn ? 'Adult'       : '成人票', activeCls: 'bg-sky-500 text-white shadow-sm' },
    { v: 'child',      label: isEn ? 'Child'       : '儿童票', activeCls: 'bg-teal-500 text-white shadow-sm' },
    { v: 'concession', label: isEn ? 'Concession'  : '优待票', activeCls: 'bg-amber-500 text-white shadow-sm' },
  ];
  return (
    <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-xl flex-1 ml-3">
      {opts.map(o => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
            value === o.v ? o.activeCls : 'text-gray-500 hover:text-gray-700'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Step = 'home' | 'detail' | 'seats' | 'booking';

interface SeatWithTicket {
  seatId: string;
  seatName: string;
  expiresAt: string;
  ticketType: TicketType;
}

interface NonSeatEntry {
  id: string;
  ticketType: TicketType;
}

export default function ClientHome() {
  const { t, i18n } = useTranslation();
  const { user, userProfile } = useAuth();
  const isEn = i18n.language === 'en';

  const [step, setStep] = useState<Step>('home');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedAnn, setSelectedAnn] = useState<Announcement | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showBookingNotice, setShowBookingNotice] = useState(false);

  // Multi-seat selection state (up to 3)
  const [selectedSeats, setSelectedSeats] = useState<SeatWithTicket[]>([]);
  const [nonSeatEntries, setNonSeatEntries] = useState<NonSeatEntry[]>([{ id: '1', ticketType: 'adult' }]);

  function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function fetchSessions() {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('is_active', true)
      .order('session_date')
      .order('start_time');
    const list = data ?? [];
    setSessions(list);
    setSelectedSession(prev => {
      if (!prev) return prev;
      const updated = list.find(s => s.id === prev.id);
      return updated ?? null;
    });
  }

  async function fetchAnnouncements() {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });
    setAnnouncements(data ?? []);
  }

  useEffect(() => {
    fetchAnnouncements();
    fetchSessions();

    const channel = supabase
      .channel('client:live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions' }, (payload) => {
        const updated = payload.new as Session;
        setSessions(prev =>
          updated.is_active
            ? prev.map(s => s.id === updated.id ? updated : s)
            : prev.filter(s => s.id !== updated.id)
        );
        setSelectedSession(prev => {
          if (!prev || prev.id !== updated.id) return prev;
          return updated.is_active ? updated : null;
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, fetchSessions)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sessions' }, fetchSessions)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, fetchAnnouncements)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  function selectSession(s: Session) {
    setSelectedSession(s);
    setStep('detail');
    window.scrollTo(0, 0);
  }

  function proceedAfterNotice() {
    if (selectedSession?.has_seating_chart) {
      setStep('seats');
    } else {
      setStep('booking');
    }
    window.scrollTo(0, 0);
  }

  function handleBookClick() {
    if (!user) {
      showToast(t('login_required'), 'warning');
      setShowLoginModal(true);
      return;
    }
    if (selectedSession?.booking_notice?.trim()) {
      setShowBookingNotice(true);
    } else {
      proceedAfterNotice();
    }
  }

  function handleNoticeAbort() {
    setShowBookingNotice(false);
  }

  async function unlockAllSeats() {
    for (const seat of selectedSeats) {
      await supabase.rpc('unlock_seat', { p_seat_id: seat.seatId });
    }
    setSelectedSeats([]);
  }

  function updateSeatTicketType(seatId: string, ticketType: TicketType) {
    setSelectedSeats(prev => prev.map(s => s.seatId === seatId ? { ...s, ticketType } : s));
  }

  function updateNonSeatEntryTicketType(id: string, ticketType: TicketType) {
    setNonSeatEntries(prev => prev.map(e => e.id === id ? { ...e, ticketType } : e));
  }

  function addNonSeatEntry() {
    if (nonSeatEntries.length < 3) {
      setNonSeatEntries(prev => [...prev, { id: crypto.randomUUID(), ticketType: 'adult' }]);
    }
  }

  function removeNonSeatEntry(id: string) {
    if (nonSeatEntries.length > 1) {
      setNonSeatEntries(prev => prev.filter(e => e.id !== id));
    }
  }

  if (selectedAnn) {
    return <AnnouncementDetail ann={selectedAnn} onBack={() => setSelectedAnn(null)} />;
  }

  return (
    <div className="pb-10 min-h-screen bg-gray-50">
      {toast && <Toast message={toast.msg} type={toast.type as any} onClose={() => setToast(null)} />}
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />

      {showBookingNotice && selectedSession?.booking_notice?.trim() && (
        <BookingNoticeModal
          notice={selectedSession.booking_notice}
          onConfirm={() => { setShowBookingNotice(false); proceedAfterNotice(); }}
          onAbort={handleNoticeAbort}
        />
      )}

      {step === 'home' && (
        <HomeView
          announcements={announcements}
          sessions={sessions}
          isEn={isEn}
          onSelectAnn={setSelectedAnn}
          onSelectSession={selectSession}
        />
      )}

      {step === 'detail' && selectedSession && (
        <SessionDetailView
          session={selectedSession}
          isEn={isEn}
          onBack={() => { setStep('home'); setSelectedSession(null); window.scrollTo(0, 0); }}
          onBook={handleBookClick}
        />
      )}

      {step === 'seats' && selectedSession && (
        <SeatSelectionView
          session={selectedSession}
          isEn={isEn}
          userId={user?.id || null}
          selectedSeats={selectedSeats}
          onSeatsChanged={(seats) => setSelectedSeats(seats)}
          onProceed={() => { setStep('booking'); window.scrollTo(0, 0); }}
          onBack={() => {
            unlockAllSeats();
            setStep('detail');
            window.scrollTo(0, 0);
          }}
          showToast={showToast}
        />
      )}

      {step === 'booking' && selectedSession && (
        <BookingFormView
          session={selectedSession}
          isEn={isEn}
          prefillName={userProfile?.display_name || ''}
          prefillPhone={userProfile?.phone || ''}
          userId={user?.id || null}
          selectedSeats={selectedSeats}
          nonSeatEntries={nonSeatEntries}
          onUpdateSeatTicketType={updateSeatTicketType}
          onUpdateNonSeatEntryTicketType={updateNonSeatEntryTicketType}
          onAddNonSeatEntry={addNonSeatEntry}
          onRemoveNonSeatEntry={removeNonSeatEntry}
          onBack={() => {
            if (selectedSession.has_seating_chart) {
              setStep('seats');
            } else {
              setStep('detail');
            }
            window.scrollTo(0, 0);
          }}
          onSuccess={() => {
            showToast(t('booking_success') + ' ' + t('booking_success_msg'), 'success');
            setStep('home');
            setSelectedSession(null);
            setSelectedSeats([]);
            setNonSeatEntries([{ id: '1', ticketType: 'adult' }]);
            fetchSessions();
            window.scrollTo(0, 0);
          }}
          onSoldOut={() => {
            showToast(t('sold_out'), 'error');
            fetchSessions();
            setStep('detail');
          }}
          onSessionExpired={() => {
            showToast(t('session_expired_tip'), 'error');
            fetchSessions();
            setStep('detail');
          }}
        />
      )}
    </div>
  );
}

// ─── Home View ──────────────────────────────────────────────────────────────

function HomeView({
  announcements, sessions, isEn, onSelectAnn, onSelectSession,
}: {
  announcements: Announcement[];
  sessions: Session[];
  isEn: boolean;
  onSelectAnn: (a: Announcement) => void;
  onSelectSession: (s: Session) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="bg-gradient-to-br from-sky-500 via-sky-400 to-cyan-400 px-5 pt-8 pb-8 text-white">
        <p className="text-sky-100 text-xs font-medium tracking-widest uppercase mb-1">
          {isEn ? 'Welcome' : '欢迎使用'}
        </p>
        <h1 className={`font-bold leading-tight ${isEn ? 'text-xl' : 'text-2xl'}`}>
          {isEn ? 'Event Booking' : '活动预订平台'}
        </h1>
        <p className={`text-sky-100 mt-1 ${isEn ? 'text-xs' : 'text-sm'}`}>
          {isEn ? 'Browse sessions and book your ticket' : '浏览场次，立即选择心仪的活动'}
        </p>
      </div>

      <div className="px-4 space-y-4">
        {announcements.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden -mt-6 shadow-md">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <h2 className={`font-bold text-gray-900 ${isEn ? 'text-xs' : 'text-sm'}`}>{t('announcements')}</h2>
              <span className="text-xs text-gray-400">{announcements.length}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {announcements.map(a => (
                <button
                  key={a.id}
                  onClick={() => onSelectAnn(a)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors active:bg-gray-100"
                >
                  {a.cover_image ? (
                    <img src={a.cover_image} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0 text-lg">📢</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-gray-900 truncate ${isEn ? 'text-xs' : 'text-sm'}`}>{a.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(a.created_at).toLocaleDateString()}</p>
                  </div>
                  <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="pt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className={`font-bold text-gray-900 ${isEn ? 'text-xs' : 'text-sm'}`}>{t('activities')}</h2>
            <span className="text-xs text-gray-400">
              {sessions.length} {isEn ? 'available' : '场可预订'}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 py-12 text-center">
              <Calendar size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">{t('sessions_empty')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map(s => {
                const stock = s.available_stock ?? s.capacity;
                const isFull = stock <= 0;
                return (
                  <button
                    key={s.id}
                    onClick={() => !isFull && onSelectSession(s)}
                    disabled={isFull}
                    className={`w-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden text-left transition-all active:scale-[0.98] ${
                      isFull ? 'opacity-50 cursor-not-allowed' : 'hover:border-sky-200 hover:shadow-md'
                    }`}
                  >
                    {s.cover_image && (
                      <div className="relative">
                        <img src={s.cover_image} alt="" className="w-full h-36 object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                        <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between">
                          <p className="text-white font-bold text-sm drop-shadow">{s.name}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isFull ? 'bg-red-500 text-white' : 'bg-sky-500/90 text-white'}`}>
                            {isFull ? (isEn ? 'Sold Out' : '售罄') : (isEn ? `${stock} Left` : `余 ${stock}`)}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="p-3">
                      {!s.cover_image && (
                        <div className="flex items-center justify-between mb-1.5">
                          <p className={`font-semibold text-gray-900 ${isEn ? 'text-xs' : 'text-sm'}`}>{s.name}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isFull ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                            {isFull ? (isEn ? 'Sold Out' : '售罄') : (isEn ? `${stock} Left` : `余 ${stock}`)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-gray-500">
                        <span className="flex items-center gap-1 text-xs"><Calendar size={11} /> {s.session_date}</span>
                        <span className="flex items-center gap-1 text-xs"><Clock size={11} /> {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</span>
                      </div>
                      {!isFull && (
                        <div className="mt-2 flex items-center justify-end">
                          <span className="text-xs text-sky-500 font-medium flex items-center gap-0.5">
                            {isEn ? 'View Details' : '查看详情'} <ChevronRight size={13} />
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Session Detail View ────────────────────────────────────────────────────

function SessionDetailView({
  session, isEn, onBack, onBook,
}: {
  session: Session;
  isEn: boolean;
  onBack: () => void;
  onBook: () => void;
}) {
  const { t } = useTranslation();
  const stock = session.available_stock ?? session.capacity;
  const isFull = stock <= 0;

  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={18} className="text-gray-700" />
        </button>
        <h1 className={`flex-1 font-semibold text-gray-900 truncate ${isEn ? 'text-sm' : 'text-base'}`}>{session.name}</h1>
      </div>

      {session.cover_image && (
        <div className="relative">
          <img src={session.cover_image} alt="" className="w-full h-52 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <h2 className="text-white font-bold text-xl drop-shadow">{session.name}</h2>
          </div>
        </div>
      )}

      <div className="px-4 py-4 space-y-4 pb-48">
        <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center gap-2.5 text-sm text-gray-700">
            <Calendar size={15} className="text-sky-500 flex-shrink-0" />
            <span>{session.session_date}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-gray-700">
            <Clock size={15} className="text-sky-500 flex-shrink-0" />
            <span>{session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm">
            <Users size={15} className="text-sky-500 flex-shrink-0" />
            <span className={isFull ? 'text-red-500 font-medium' : 'text-gray-700'}>
              {isFull
                ? (isEn ? 'Sold Out' : '已售罄')
                : `${isEn ? 'Remaining' : '剩余名额'}：${stock}`}
            </span>
          </div>
          {session.verification_start && session.verification_end && (
            <div className="flex items-center gap-2.5 text-xs text-amber-600">
              <span className="w-3.5 h-3.5 rounded-full bg-amber-100 flex-shrink-0" />
              {isEn ? 'Check-in' : '核销时间'}：{session.verification_start.slice(0, 5)} – {session.verification_end.slice(0, 5)}
            </div>
          )}
        </div>

        {session.description && session.description.trim() && session.description !== '<p><br></p>' && (
          <div>
            <h3 className={`font-bold text-gray-900 mb-3 ${isEn ? 'text-sm' : 'text-base'}`}>
              {isEn ? 'About This Session' : '活动介绍'}
            </h3>
            <div
              className="quill-content"
              dangerouslySetInnerHTML={{ __html: session.description }}
            />
          </div>
        )}
      </div>

      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 px-4 py-3">
        <button
          onClick={onBook}
          disabled={isFull}
          className="w-full bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 disabled:from-gray-300 disabled:to-gray-300 text-white font-bold py-4 rounded-2xl transition-all shadow-md hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed text-base"
        >
          {isFull ? (isEn ? 'Sold Out' : '已售罄') : t('book_session')}
        </button>
      </div>
    </div>
  );
}

// ─── Booking Form View ──────────────────────────────────────────────────────

function BookingFormView({
  session, isEn, prefillName, prefillPhone, userId,
  selectedSeats, nonSeatEntries, onUpdateSeatTicketType, onUpdateNonSeatEntryTicketType,
  onAddNonSeatEntry, onRemoveNonSeatEntry,
  onBack, onSuccess, onSoldOut, onSessionExpired,
}: {
  session: Session;
  isEn: boolean;
  prefillName: string;
  prefillPhone: string;
  userId: string | null;
  selectedSeats: SeatWithTicket[];
  nonSeatEntries: NonSeatEntry[];
  onUpdateSeatTicketType: (seatId: string, ticketType: TicketType) => void;
  onUpdateNonSeatEntryTicketType: (id: string, ticketType: TicketType) => void;
  onAddNonSeatEntry: () => void;
  onRemoveNonSeatEntry: (id: string) => void;
  onBack: () => void;
  onSuccess: () => void;
  onSoldOut: () => void;
  onSessionExpired: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(prefillName);
  const [phone, setPhone] = useState(prefillPhone);
  const [noteContent, setNoteContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const hasSeats = session.has_seating_chart;
  const orders = hasSeats ? selectedSeats : nonSeatEntries;
  const totalOrders = orders.length;

  const ticketTypeLabels: Record<TicketType, string> = {
    adult: isEn ? 'Adult' : '成人票',
    child: isEn ? 'Child' : '儿童票',
    concession: isEn ? 'Concession' : '优待票',
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t('fill_name')); return; }
    if (!phone.trim()) { setError(t('fill_phone')); return; }
    setError('');

    // New booking time logic: StopSellingTime = verifyDate + verifyEndTime - stopSellingMinutes
    // Booking is allowed only if CurrentTime < StopSellingTime
    if (session.verify_date && session.verification_end && session.stop_selling_minutes > 0) {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      // Calculate stop selling time
      // StopSellingTime = verifyDate + verifyEndTime - stopSellingMinutes (in minutes)
      const [endHour, endMin] = session.verification_end.slice(0, 5).split(':').map(Number);
      const stopMinutesFromMidnight = endHour * 60 + endMin - session.stop_selling_minutes;

      if (stopMinutesFromMidnight < 0) {
        // Negative means stop selling was yesterday
        if (today >= session.verify_date) {
          onSessionExpired();
          return;
        }
      } else {
        const stopHour = Math.floor(stopMinutesFromMidnight / 60);
        const stopMin = stopMinutesFromMidnight % 60;
        const currentMinutesFromMidnight = now.getHours() * 60 + now.getMinutes();

        // If verify_date is today or later, check stop selling time
        if (today >= session.verify_date && currentMinutesFromMidnight >= stopMinutesFromMidnight) {
          onSessionExpired();
          return;
        }
      }
    }

    setSubmitting(true);
    setProgress({ done: 0, total: totalOrders });

    // Phone-based user association: look up whether the entered phone belongs
    // to a registered user different from the current buyer.
    let effectiveUserId: string | null = userId;
    let buyerUserId: string | null = null;
    const trimmedPhone = phone.trim();
    if (trimmedPhone.length >= 7) {
      const { data: phoneMatch } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('phone', trimmedPhone)
        .maybeSingle();
      if (phoneMatch && phoneMatch.id !== userId) {
        effectiveUserId = phoneMatch.id;
        buyerUserId = userId;
      }
    }

    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      setProgress({ done: i, total: totalOrders });

      const seatId = hasSeats ? (order as SeatWithTicket).seatId : null;
      const ticketType = order.ticketType;

      const bookResult = await callEdgeFunction('book-ticket', {
        p_session_id: session.id,
        p_seat_id: seatId ?? null,
        p_name: name.trim(),
        p_phone: trimmedPhone,
        p_user_id: effectiveUserId ?? null,
        p_ticket_type: ticketType,
        p_buyer_user_id: buyerUserId ?? null,
        p_note_content: noteContent.trim() || null,
      });
      const rpcResult = bookResult.data as any;
      console.log('[book-ticket] result:', bookResult, 'rpcResult:', rpcResult);

      if (bookResult.error || !rpcResult?.success) {
        if (rpcResult?.error === 'sold_out') {
          onSoldOut();
          setSubmitting(false);
          return;
        } else if (rpcResult?.error === 'seat_taken' || rpcResult?.error === 'lock_expired') {
          errors.push(hasSeats ? (order as SeatWithTicket).seatName : `Order ${i + 1}`);
        } else {
          errors.push(`Order ${i + 1}`);
        }
      } else {
        successCount++;
      }
    }

    setSubmitting(false);

    if (successCount === totalOrders) {
      onSuccess();
    } else if (successCount > 0) {
      onSuccess();
    } else if (errors.length > 0) {
      setError(isEn ? `Some bookings failed: ${errors.join(', ')}` : `部分预订失败: ${errors.join(', ')}`);
    } else {
      setError(t('booking_failed'));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={18} className="text-gray-700" />
        </button>
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-gray-900 truncate ${isEn ? 'text-sm' : 'text-base'}`}>{t('booking_info')}</p>
          <p className="text-xs text-gray-400 truncate">{session.name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-4 space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
          {session.cover_image && (
            <img src={session.cover_image} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
          )}
          <div>
            <p className={`font-semibold text-gray-900 ${isEn ? 'text-xs' : 'text-sm'}`}>{session.name}</p>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
              <Calendar size={10} /> {session.session_date}
              <Clock size={10} className="ml-1" /> {session.start_time.slice(0, 5)}
            </p>
            <p className="text-xs text-sky-600 font-medium mt-0.5">
              {totalOrders} {isEn ? 'tickets' : '张票'}
            </p>
          </div>
        </div>

        {/* Ticket list with type selection */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <Ticket size={12} /> {isEn ? 'Your Tickets' : '您的票据'}
          </h3>

          {hasSeats && selectedSeats.map(s => (
            <div key={s.seatId} className="flex items-center bg-gray-50 rounded-xl px-3 py-2 gap-2">
              <div className="flex-shrink-0">
                <p className="text-sm font-semibold text-gray-700">{formatSeatName(s.seatName, isEn)}</p>
                <p className="text-xs text-gray-400">{isEn ? 'Seat' : '座位'}</p>
              </div>
              <TicketTypeSegmented
                value={s.ticketType}
                onChange={v => onUpdateSeatTicketType(s.seatId, v)}
                isEn={isEn}
              />
            </div>
          ))}

          {!hasSeats && nonSeatEntries.map((entry, idx) => (
            <div key={entry.id} className="flex items-center bg-gray-50 rounded-xl px-3 py-2 gap-2">
              <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <TicketTypeSegmented
                value={entry.ticketType}
                onChange={v => onUpdateNonSeatEntryTicketType(entry.id, v)}
                isEn={isEn}
              />
              {nonSeatEntries.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveNonSeatEntry(entry.id)}
                  className="p-1 hover:bg-red-100 rounded-lg text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}

          {!hasSeats && nonSeatEntries.length < 3 && (
            <button
              type="button"
              onClick={onAddNonSeatEntry}
              className="w-full flex items-center justify-center gap-1 text-sky-600 text-xs font-medium py-2 border border-dashed border-sky-300 rounded-xl hover:bg-sky-50 transition-colors"
            >
              <Plus size={14} /> {isEn ? 'Add Another Ticket' : '添加更多票'}
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {isEn ? 'Contact Information' : '填写信息'}
          </h3>
          <div>
            <label className={`block font-medium text-gray-700 mb-1.5 ${isEn ? 'text-xs' : 'text-sm'}`}>{t('name')}</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('enter_name')}
              className={`w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 ${isEn ? 'text-xs' : 'text-sm'}`}
              required
            />
          </div>
          <div>
            <label className={`block font-medium text-gray-700 mb-1.5 ${isEn ? 'text-xs' : 'text-sm'}`}>{t('phone')}</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder={t('enter_phone')}
              type="tel"
              className={`w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 ${isEn ? 'text-xs' : 'text-sm'}`}
              required
            />
          </div>
          <div>
            <label className={`block font-medium text-gray-700 mb-1.5 ${isEn ? 'text-xs' : 'text-sm'}`}>
              {isEn ? 'Order Note (Optional)' : '订单备注（选填）'}
            </label>
            <textarea
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              placeholder={isEn ? 'Add any special requirements...' : '如有特殊需求请在此填写...'}
              rows={2}
              maxLength={200}
              className={`w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none ${isEn ? 'text-xs' : 'text-sm'}`}
            />
            <p className="text-[10px] text-gray-400 mt-1">{isEn ? 'Notes cannot be modified after submission' : '备注提交后不可修改'}</p>
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          <p className="text-xs text-amber-700 leading-relaxed">{t('ticket_only_valid')}</p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 disabled:opacity-60 text-white font-bold py-4 rounded-2xl transition-all shadow-md hover:shadow-lg active:scale-[0.98] text-base flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {isEn ? `Booking ${progress.done + 1}/${progress.total}...` : `正在预订 ${progress.done + 1}/${progress.total}...`}
            </>
          ) : (
            `${t('book_now')} (${totalOrders})`
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Seat Selection View ────────────────────────────────────────────────────

function SeatSelectionView({
  session, isEn, userId, selectedSeats, onSeatsChanged, onProceed, onBack, showToast,
}: {
  session: Session;
  isEn: boolean;
  userId: string | null;
  selectedSeats: SeatWithTicket[];
  onSeatsChanged: (seats: SeatWithTicket[]) => void;
  onProceed: () => void;
  onBack: () => void;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}) {
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const MAX_SEATS = 3;

  async function fetchSeats() {
    const { data } = await supabase.rpc('get_seat_map', { p_session_id: session.id });
    setSeats((data as SeatMapRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchSeats();
    const interval = setInterval(fetchSeats, 3000);
    return () => clearInterval(interval);
  }, [session.id]);

  // Auto-release on lock expiry for any seat
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const seat of selectedSeats) {
      const ms = new Date(seat.expiresAt).getTime() - Date.now();
      if (ms > 0) {
        const t = setTimeout(() => {
          onSeatsChanged(selectedSeats.filter(s => s.seatId !== seat.seatId));
          showToast(isEn ? `Seat ${seat.seatName} lock expired` : `座位 ${seat.seatName} 锁定已过期`, 'warning');
          fetchSeats();
        }, ms + 500);
        timers.push(t);
      }
    }
    return () => timers.forEach(t => clearTimeout(t));
  }, [selectedSeats]);

  async function handleSeatClick(seat: SeatMapRow) {
    if (!userId) return;

    // Deselect if clicking an already-selected seat
    const existingIdx = selectedSeats.findIndex(s => s.seatId === seat.id);
    if (existingIdx !== -1) {
      await supabase.rpc('unlock_seat', { p_seat_id: seat.id });
      onSeatsChanged(selectedSeats.filter(s => s.seatId !== seat.id));
      fetchSeats();
      return;
    }

    // Refresh seat map to show latest state before attempting lock
    fetchSeats();

    // Check max limit
    if (selectedSeats.length >= MAX_SEATS) {
      showToast(isEn ? `Maximum ${MAX_SEATS} seats allowed` : `最多选择 ${MAX_SEATS} 个座位`, 'warning');
      return;
    }

    setLocking(true);
    const { data, error } = await supabase.rpc('lock_seat', { p_seat_id: seat.id });
    setLocking(false);

    if (error || !data?.success) {
      const reason = data?.reason;
      if (reason === 'already_booked') showToast(isEn ? 'This seat is already booked' : '该座位已被预订', 'error');
      else if (reason === 'locked_by_other') showToast(isEn ? 'This seat is being held by someone else' : '该座位正被他人选择，请稍后重试', 'warning');
      else showToast(isEn ? 'Failed to lock seat, please try again' : '座位锁定失败，请重试', 'error');
      fetchSeats();
      return;
    }

    onSeatsChanged([...selectedSeats, {
      seatId: seat.id,
      seatName: seat.seat_name,
      expiresAt: data.expires_at,
      ticketType: 'adult' as TicketType,
    }]);
    fetchSeats();
  }

  // Derive actual dimensions from loaded seats
  const actualRows = seats.length > 0 ? Math.max(...seats.map(s => s.row_index)) : session.seat_rows;
  const actualCols = seats.length > 0 ? Math.max(...seats.map(s => s.col_index)) : session.seats_per_row;

  // Get selected seat IDs for SeatMap
  const selectedSeatIds = selectedSeats.map(s => s.seatId);
  const selectedSeatTypes = Object.fromEntries(selectedSeats.map(s => [s.seatId, s.ticketType]));

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={18} className="text-gray-700" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">
            {isEn ? 'Choose Seats' : '选择座位'}
          </p>
          <p className="text-xs text-gray-400 truncate">{session.name}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <LayoutGrid size={12} />
          <span>{isEn ? `${actualRows}×${actualCols}` : `${actualRows}排×${actualCols}座`}</span>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4 pb-40">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">{isEn ? 'Loading seats...' : '加载座位图...'}</div>
        ) : seats.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">{isEn ? 'Seat map not configured' : '座位图暂未配置'}</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <SeatMap
              seats={seats}
              rows={actualRows}
              seatsPerRow={actualCols}
              screenDirection={session.screen_direction}
              selectedSeatId={selectedSeatIds.length === 1 ? selectedSeatIds[0] : undefined}
              selectedSeatIds={selectedSeatIds}
              selectedSeatTypes={selectedSeatTypes}
              onSeatClick={handleSeatClick}
              lockExpiresAt={selectedSeats.length > 0
                ? selectedSeats.reduce((min, s) => !min || s.expiresAt < min ? s.expiresAt : min, '')
                : undefined}
              isEn={isEn}
              stageCenterCol={session.stage_center_col}
            />
          </div>
        )}

        {selectedSeats.length > 0 && (
          <div className="bg-sky-50 border border-sky-200 rounded-2xl px-4 py-3 space-y-2">
            <p className="text-xs text-sky-600 font-medium">{isEn ? 'Selected Seats' : '已选座位'} ({selectedSeats.length}/{MAX_SEATS})</p>
            {selectedSeats.map(s => (
              <div key={s.seatId} className="flex items-center bg-white rounded-xl px-3 py-2">
                <span className="text-sm font-semibold text-sky-700 shrink-0">{formatSeatName(s.seatName, isEn)}</span>
                <TicketTypeSegmented
                  value={s.ticketType}
                  onChange={v => onSeatsChanged(selectedSeats.map(x => x.seatId === s.seatId ? { ...x, ticketType: v } : x))}
                  isEn={isEn}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 px-4 py-3">
        <button
          onClick={onProceed}
          disabled={selectedSeats.length === 0 || locking}
          className="w-full bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 disabled:from-gray-300 disabled:to-gray-300 text-white font-bold py-4 rounded-2xl transition-all shadow-md hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed text-base"
        >
          {locking
            ? (isEn ? 'Locking...' : '锁定中...')
            : selectedSeats.length > 0
              ? `${isEn ? 'Next' : '下一步'} — ${selectedSeats.length} ${isEn ? 'seats' : '个座位'}`
              : (isEn ? 'Please select at least one seat' : '请至少选择一个座位')}
        </button>
      </div>
    </div>
  );
}

// ─── Announcement Detail ────────────────────────────────────────────────────

function AnnouncementDetail({ ann, onBack }: { ann: Announcement; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-r from-sky-600 to-cyan-500 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X size={18} />
        </button>
        <span className={`font-semibold ${isEn ? 'text-sm' : 'text-base'}`}>{t('announcement_detail')}</span>
      </div>
      {ann.cover_image && (
        <img src={ann.cover_image} alt="" className="w-full h-48 object-cover" />
      )}
      <div className="p-4">
        <h1 className={`font-bold text-gray-900 mb-1 ${isEn ? 'text-base' : 'text-xl'}`}>{ann.title}</h1>
        <p className="text-xs text-gray-400 mb-4">{new Date(ann.created_at).toLocaleDateString()}</p>
        <div
          className="quill-content"
          dangerouslySetInnerHTML={{ __html: ann.content }}
        />
      </div>
    </div>
  );
}
