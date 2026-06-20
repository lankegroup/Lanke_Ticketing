import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, callEdgeFunction, Session, SeatMapRow, UserProfile, TicketType } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { X, Calendar, Clock, ArrowLeft, LayoutGrid, CheckCircle2, AlertTriangle, Ticket, Phone, Coins, Wallet } from 'lucide-react';
import SeatMap from '../SeatMap';
import Toast from '../Toast';

function TicketTypeSegmented({ value, onChange }: { value: TicketType; onChange: (t: TicketType) => void }) {
  const opts: { v: TicketType; label: string; activeCls: string }[] = [
    { v: 'adult', label: '成人�?, activeCls: 'bg-sky-500 text-white shadow-sm' },
    { v: 'child', label: '儿童�?, activeCls: 'bg-teal-500 text-white shadow-sm' },
    { v: 'concession', label: '优待�?, activeCls: 'bg-amber-500 text-white shadow-sm' },
  ];
  return (
    <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-xl">
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

type Step = 'phone' | 'session' | 'seat' | 'payment' | 'done';
type PaymentMethod = 'lcoin' | 'cash';

export default function FrontDesk() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const isEn = i18n.language === 'en';

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [customerUser, setCustomerUser] = useState<UserProfile | null>(null);
  const [customerBalance, setCustomerBalance] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [lockExpiresAt, setLockExpiresAt] = useState<string>('');
  const [locking, setLocking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [ticketCode, setTicketCode] = useState('');
  const [showForceWarning, setShowForceWarning] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [ticketType, setTicketType] = useState<TicketType>('adult');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [customerName, setCustomerName] = useState('');
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const lockedSeatRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (lockedSeatRef.current) {
        supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      }
    };
  }, []);

  useEffect(() => {
    if (!lockExpiresAt) return;
    const ms = new Date(lockExpiresAt).getTime() - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(async () => {
      lockedSeatRef.current = null;
      setSelectedSeatId(null);
      setLockExpiresAt('');
      if (sessionIdRef.current) {
        const { data } = await supabase.rpc('get_seat_map', { p_session_id: sessionIdRef.current });
        setSeats((data as SeatMapRow[]) ?? []);
      }
    }, ms + 500);
    return () => clearTimeout(t);
  }, [lockExpiresAt]);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function searchUser() {
    if (!phone.trim()) return;
    setSearching(true);
    setError('');

    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('phone', phone.trim())
        .single();

      if (data) {
        setCustomerUser(data);
        setCustomerName(data.display_name || '');
        const { data: balData } = await supabase.rpc('get_user_lcoin_balance', { p_user_id: data.id });
        setCustomerBalance(Number(balData) || 0);
        showToast('找到已注册用�?, 'success');
      } else {
        setCustomerUser(null);
        setCustomerBalance(0);
        showToast('未找到用户，将按散客处理', 'success');
      }
      loadSessions();
      setStep('session');
    } catch (e) {
      setCustomerUser(null);
      loadSessions();
      setStep('session');
    }
    setSearching(false);
  }

  async function loadSessions() {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('is_active', true)
      .order('session_date')
      .order('start_time');
    setSessions(data ?? []);
  }

  async function fetchSeats(sessionId: string) {
    const { data } = await supabase.rpc('get_seat_map', { p_session_id: sessionId });
    setSeats((data as SeatMapRow[]) ?? []);
  }

  async function releaseLock() {
    if (lockedSeatRef.current) {
      await supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      lockedSeatRef.current = null;
    }
    setSelectedSeatId(null);
    setLockExpiresAt('');
    setShowForceWarning(false);
    setPendingForce(false);
  }

  async function selectSession(s: Session) {
    await releaseLock();
    setSelectedSession(s);
    sessionIdRef.current = s.id;

    if (pollRef.current) clearInterval(pollRef.current);

    if (s.has_seating_chart) {
      await fetchSeats(s.id);
      pollRef.current = setInterval(() => fetchSeats(s.id), 3000);
      setStep('seat');
    } else {
      setStep('payment');
    }
  }

  async function handleSeatClick(seat: SeatMapRow) {
    if (seat.is_booked) return;

    if (seat.is_blocked) {
      if (lockedSeatRef.current) {
        await supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
        lockedSeatRef.current = null;
        setLockExpiresAt('');
      }
      setSelectedSeatId(seat.id);
      setShowForceWarning(true);
      setPendingForce(false);
      return;
    }

    if (seat.id === selectedSeatId && lockedSeatRef.current) {
      await supabase.rpc('unlock_seat', { p_seat_id: seat.id });
      lockedSeatRef.current = null;
      setSelectedSeatId(null);
      setLockExpiresAt('');
      setShowForceWarning(false);
      setPendingForce(false);
      if (sessionIdRef.current) {
        const { data: fresh } = await supabase.rpc('get_seat_map', { p_session_id: sessionIdRef.current });
        setSeats((fresh as SeatMapRow[]) ?? []);
      }
      return;
    }

    if (sessionIdRef.current) {
      const { data: fresh } = await supabase.rpc('get_seat_map', { p_session_id: sessionIdRef.current });
      setSeats((fresh as SeatMapRow[]) ?? []);
    }

    if (lockedSeatRef.current) {
      await supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      lockedSeatRef.current = null;
    }

    setShowForceWarning(false);
    setPendingForce(false);
    setLocking(true);
    const { data: { user } } = await supabase.auth.getUser();
    const lockUserId = customerUser?.id ?? user?.id ?? '';
    const { data, error: lockErr } = await supabase.rpc('lock_seat_for_user', { p_seat_id: seat.id, p_user_id: lockUserId });
    setLocking(false);

    if (lockErr || !data?.success) {
      const reason = data?.reason;
      setError(reason === 'locked_by_other' ? '该座位正被他人选择，请稍后重试' : '座位锁定失败，请重试');
      setTimeout(() => setError(''), 3000);
      if (sessionIdRef.current) {
        const { data: fresh } = await supabase.rpc('get_seat_map', { p_session_id: sessionIdRef.current });
        setSeats((fresh as SeatMapRow[]) ?? []);
      }
      return;
    }

    lockedSeatRef.current = seat.id;
    setSelectedSeatId(seat.id);
    setLockExpiresAt(data.expires_at);
    setError('');
    if (sessionIdRef.current) {
      const { data: fresh } = await supabase.rpc('get_seat_map', { p_session_id: sessionIdRef.current });
      setSeats((fresh as SeatMapRow[]) ?? []);
    }
  }

  function confirmForce() {
    setPendingForce(true);
    setShowForceWarning(false);
  }

  function cancelForce() {
    setSelectedSeatId(null);
    setShowForceWarning(false);
    setPendingForce(false);
  }

  async function goBack() {
    setShowForceWarning(false);
    setPendingForce(false);
    setError('');
    if (step === 'session') {
      setStep('phone');
    } else if (step === 'seat') {
      await releaseLock();
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setStep('session');
    } else if (step === 'payment') {
      setStep(selectedSession?.has_seating_chart ? 'seat' : 'session');
    }
  }

  async function handleSubmit() {
    if (!selectedSession) return;
    setError('');

    const ticketPrice = getTicketPrice(ticketType);
    const totalPrice = ticketPrice + (selectedSession.default_service_fee || 0);

    if (paymentMethod === 'lcoin' && totalPrice > 0) {
      setShowPaymentConfirm(true);
      return;
    }

    await doSubmit();
  }

  async function doSubmit() {
    if (!selectedSession) return;
    setSubmitting(true);

    const ticketPrice = getTicketPrice(ticketType);
    const totalPrice = ticketPrice + (selectedSession.default_service_fee || 0);
    const selectedSeat = seats.find(s => s.id === selectedSeatId);
    const isForce = pendingForce || (selectedSeat?.is_blocked ?? false);
    const finalCustomerName = customerName.trim() || '散客';

    if (paymentMethod === 'lcoin' && customerUser) {
      if (customerBalance < totalPrice) {
        setError(`余额不足！当前余�?${customerBalance} L-Coin，需支付 ${totalPrice} L-Coin`);
        setSubmitting(false);
        return;
      }

      const deductResult = await callEdgeFunction('lcoin-transaction', {
        action: 'purchase',
        user_id: customerUser.id,
        amount: totalPrice,
        description: `购票�?{selectedSession.name}`,
      });

      if (!deductResult.data?.success) {
        setError('扣款失败，请重试');
        setSubmitting(false);
        return;
      }
    }

    const bookResult = await callEdgeFunction('proxy-book-ticket', {
      p_session_id: selectedSession.id,
      p_seat_id: selectedSeatId ?? null,
      p_name: finalCustomerName,
      p_phone: phone.trim(),
      p_user_id: customerUser?.id ?? null,
      p_force: isForce,
      p_order_source: 'front_desk',
      p_ticket_type: ticketType,
      p_payment_method: paymentMethod,
    });

    const rpcResult = bookResult.data as any;

    if (bookResult.error || !rpcResult?.success) {
      const msg = rpcResult?.error;
      if (msg === 'sold_out') setError('该场次已售罄');
      else if (msg === 'seat_taken') setError('座位已被预订，请返回重新选择');
      else setError('预订失败�? + (msg || bookResult.error || '未知错误'));
      setSubmitting(false);
      return;
    }

    lockedSeatRef.current = null;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setTicketCode(rpcResult.ticket_code || '');

    if (customerUser) {
      const { data: balData } = await supabase.rpc('get_user_lcoin_balance', { p_user_id: customerUser.id });
      setCustomerBalance(Number(balData) || 0);
    }

    setStep('done');
    setSubmitting(false);
  }

  const selectedSeat = seats.find(s => s.id === selectedSeatId);
  const isForceBooking = pendingForce || (selectedSeat?.is_blocked ?? false);

  const getTicketPrice = (type: TicketType) => {
    if (!selectedSession) return 0;
    switch (type) {
      case 'child': return selectedSession.child_price ?? selectedSession.ticket_price * 0.5;
      case 'concession': return selectedSession.concession_price ?? selectedSession.ticket_price * 0.8;
      case 'vip': return selectedSession.vip_price ?? selectedSession.ticket_price * 1.5;
      default: return selectedSession.ticket_price;
    }
  };

  const totalPrice = selectedSession ? getTicketPrice(ticketType) + (selectedSession.default_service_fee || 0) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-4 flex items-center gap-4 sticky top-0 z-10 shadow">
        <button onClick={() => window.history.back()} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="font-bold text-lg">前台售票</h2>
          <p className="text-xs text-amber-200">{profile?.username || '系统'} | 散客/会员购票</p>
        </div>
      </div>

      <div className="p-4">
        {step === 'phone' && (
          <div className="max-w-md mx-auto space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Phone size={28} className="text-amber-500" />
              </div>
              <h3 className="text-lg font-bold text-center text-gray-900 mb-2">客户信息</h3>
              <p className="text-gray-500 text-center text-sm mb-6">输入客户手机号，系统自动识别是否为会�?/p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">手机�?/label>
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="请输入客户手机号"
                    type="tel"
                    maxLength={11}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">客户姓名（选填，散客必填）</label>
                  <input
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="客户姓名"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 mt-4">{error}</div>
              )}

              <button
                onClick={searchUser}
                disabled={searching || !phone.trim()}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-200 text-white font-semibold py-3.5 rounded-xl text-base transition-colors mt-6"
              >
                {searching ? '查询�?..' : '开始售�?}
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs text-amber-700">
                <AlertTriangle size={12} className="inline mr-1" />
                如客户未注册账号，将按散客处理，仅支持现金支�?              </p>
            </div>
          </div>
        )}

        {step === 'session' && (
          <div className="max-w-md mx-auto space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <button onClick={goBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
                  <ArrowLeft size={16} className="text-gray-600" />
                </button>
                <div>
                  <p className="font-semibold text-gray-900">选择场次</p>
                  <p className="text-xs text-gray-400">
                    {customerUser
                      ? `会员�?{customerUser.display_name || '用户'} · ${customerBalance} L-Coin`
                      : `散客�?{customerName || '未填�?} · ${phone}`}
                  </p>
                </div>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center">
                <Ticket size={40} className="mx-auto text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">暂无可预订场�?/p>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => {
                  const avail = s.available_stock ?? s.capacity;
                  const full = avail <= 0;
                  return (
                    <button
                      key={s.id}
                      disabled={full}
                      onClick={() => selectSession(s)}
                      className={`w-full text-left bg-white rounded-2xl border p-3 transition-all ${
                        full
                          ? 'border-gray-100 opacity-50 cursor-not-allowed'
                          : 'border-gray-200 hover:border-amber-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-gray-900">{s.name}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          full ? 'bg-red-100 text-red-500' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {full ? '售罄' : `�?${avail}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Calendar size={10} /> {s.session_date}</span>
                        <span className="flex items-center gap-1"><Clock size={10} /> {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</span>
                        {s.has_seating_chart && (
                          <span className="flex items-center gap-1 text-amber-500"><LayoutGrid size={10} /> 有座位图</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-xs font-bold text-amber-600">{s.ticket_price} L-Coin</span>
                        {s.default_service_fee > 0 && (
                          <span className="text-xs text-gray-400">+{s.default_service_fee} 服务�?/span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 'seat' && selectedSession && (
          <div className="max-w-md mx-auto space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <ArrowLeft size={16} className="text-gray-600" />
              </button>
              <div>
                <p className="font-semibold text-gray-900">{selectedSession.name}</p>
                <p className="text-xs text-gray-400">{selectedSession.session_date} {selectedSession.start_time.slice(0, 5)}</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
              管理员可强制预订屏蔽座位——点击屏蔽座位后需确认
            </div>

            {showForceWarning && selectedSeat && (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-800 text-sm">该座位已屏蔽</p>
                    <p className="text-amber-700 text-xs mt-1">
                      座位 <strong>{selectedSeat.seat_name}</strong> 当前处于屏蔽状�?                      {selectedSeat.block_reason ? `（原因：${selectedSeat.block_reason}）` : ''}�?                      确认强制预订后，订单将正常生效�?                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={cancelForce} className="flex-1 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm hover:bg-amber-100">
                    取消选择
                  </button>
                  <button onClick={confirmForce} className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-semibold">
                    确认强制预订
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <SeatMap
                seats={seats}
                rows={seats.length > 0 ? Math.max(...seats.map(s => s.row_index)) : selectedSession.seat_rows}
                seatsPerRow={seats.length > 0 ? Math.max(...seats.map(s => s.col_index)) : selectedSession.seats_per_row}
                screenDirection={selectedSession.screen_direction}
                selectedSeatId={selectedSeatId}
                onSeatClick={locking ? () => {} : handleSeatClick}
                lockExpiresAt={lockExpiresAt || undefined}
                stageCenterCol={selectedSession.stage_center_col}
                adminProxyMode
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>
            )}

            {selectedSeat && !showForceWarning && (
              <div className={`border rounded-xl px-4 py-2.5 ${isForceBooking ? 'bg-amber-50 border-amber-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className={`text-xs ${isForceBooking ? 'text-amber-600' : 'text-amber-600'}`}>
                  {isForceBooking ? '已选座位（强制预订�? : '已选座�?}
                </p>
                <p className={`font-bold ${isForceBooking ? 'text-amber-700' : 'text-amber-700'}`}>
                  {selectedSeat.seat_name}
                  {isForceBooking && <span className="text-xs font-normal ml-1.5">（屏蔽座位）</span>}
                </p>
              </div>
            )}

            <button
              onClick={() => setStep('payment')}
              disabled={!selectedSeatId || showForceWarning || locking}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-200 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
            >
              {locking ? '锁定�?..' : selectedSeatId && !showForceWarning ? `确认座位 �?${selectedSeat?.seat_name}` : '请先选择座位'}
            </button>
          </div>
        )}

        {step === 'payment' && selectedSession && (
          <div className="max-w-md mx-auto space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <ArrowLeft size={16} className="text-gray-600" />
              </button>
              <div>
                <p className="font-semibold text-gray-900">确认订单</p>
                <p className="text-xs text-gray-400">{selectedSession.name}</p>
              </div>
            </div>

            {isForceBooking && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 font-medium">强制预订模式：预订屏蔽座�?{selectedSeat?.seat_name}</p>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">客户</span>
                <span className="font-medium text-gray-900">{customerName || (customerUser?.display_name || '散客')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">手机</span>
                <span className="font-medium text-gray-900">{phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">场次</span>
                <span className="font-medium text-gray-900">{selectedSession.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">时间</span>
                <span className="font-medium text-gray-900">{selectedSession.session_date} {selectedSession.start_time.slice(0, 5)}</span>
              </div>
              {selectedSeat && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">座位</span>
                  <span className="font-bold text-amber-600">{selectedSeat.seat_name}</span>
                </div>
              )}
              <div className="space-y-1.5 pt-1">
                <span className="text-sm text-gray-500 flex items-center gap-1"><Ticket size={12} /> 票种</span>
                <TicketTypeSegmented value={ticketType} onChange={setTicketType} />
              </div>
              <div className="border-t border-gray-100 pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">票价</span>
                  <span className="font-medium">{selectedSession.ticket_price} L-Coin</span>
                </div>
                {selectedSession.default_service_fee > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">服务�?/span>
                    <span className="font-medium">{selectedSession.default_service_fee} L-Coin</span>
                  </div>
                )}
                <div className="flex justify-between text-lg pt-2">
                  <span className="font-semibold text-gray-900">总计</span>
                  <span className="font-bold text-amber-600">{totalPrice} L-Coin</span>
                </div>
              </div>
            </div>

            {customerUser && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-amber-800">可用余额</span>
                  <span className="text-lg font-bold text-amber-600">{customerBalance} L-Coin</span>
                </div>
                <p className="text-xs text-amber-700">
                  {customerBalance >= totalPrice ? (
                    '余额充足，可选择兰克币支�?
                  ) : (
                    '余额不足，仅支持现金支付'
                  )}
                </p>
              </div>
            )}

            {customerUser && customerBalance >= totalPrice && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">支付方式</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPaymentMethod('lcoin')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all ${
                      paymentMethod === 'lcoin'
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Coins size={16} /> 兰克币支�?                  </button>
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all ${
                      paymentMethod === 'cash'
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Wallet size={16} /> 现金支付
                  </button>
                </div>
              </div>
            )}

            {!customerUser && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
                <Wallet size={20} className="text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-600">散客模式</p>
                  <p className="text-xs text-gray-400">仅支持现金支�?/p>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className={`w-full ${isForceBooking ? 'bg-amber-500 hover:bg-amber-400' : 'bg-amber-500 hover:bg-amber-400'} disabled:opacity-60 text-white font-bold py-3.5 rounded-xl text-sm transition-colors`}
            >
              {submitting ? '提交�?..' : isForceBooking ? '强制预订确认' : `确认购票�?{totalPrice} L-Coin）`}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="max-w-md mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 size={32} className="text-emerald-500" />
              </div>
              <h4 className="font-bold text-gray-900 text-lg mb-1">购票成功</h4>
              <p className="text-sm text-gray-500 mb-4">
                {customerUser ? '订单已生成在客户名下' : '散客订单已生�?}
              </p>
              {ticketCode && (
                <div className="bg-gray-50 rounded-xl px-5 py-3 mb-6">
                  <p className="text-xs text-gray-400 mb-1">券码</p>
                  <p className="font-mono font-bold text-xl text-gray-900 tracking-widest">{ticketCode}</p>
                </div>
              )}
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => {
                    setStep('phone');
                    setPhone('');
                    setCustomerName('');
                    setCustomerUser(null);
                    setCustomerBalance(0);
                    setSelectedSession(null);
                    setSelectedSeatId(null);
                    setTicketType('adult');
                    setPaymentMethod('cash');
                  }}
                  className="flex-1 bg-amber-100 hover:bg-amber-200 text-amber-700 font-semibold py-3 rounded-xl text-sm transition-colors"
                >
                  继续售票
                </button>
                <button
                  onClick={() => window.history.back()}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl text-sm transition-colors"
                >
                  返回
                </button>
              </div>
            </div>
          </div>
        )}

        {showPaymentConfirm && selectedSession && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Coins size={24} className="text-amber-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">确认支付</h3>
                <p className="text-sm text-gray-500 mt-1">将从客户账户中扣除兰克币</p>
              </div>
              
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">活动名称</span>
                  <span className="font-medium text-gray-900 truncate max-w-[150px]">{selectedSession.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">票据类型</span>
                  <span className="font-medium text-gray-900">
                    {ticketType === 'adult' ? '成人�? : ticketType === 'child' ? '儿童�? : ticketType === 'concession' ? '优待�? : 'VIP�?}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">支付方式</span>
                  <span className="font-medium text-amber-600">兰克�?/span>
                </div>
                <div className="border-t border-gray-200 pt-2 flex justify-between">
                  <span className="text-gray-600">应付总额</span>
                  <span className="text-xl font-bold text-amber-500">{totalPrice.toFixed(2)} L-Coin</span>
                </div>
                {customerUser && (
                  <div className="text-xs text-gray-400 pt-1">
                    当前余额: {customerBalance.toFixed(2)} L-Coin
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowPaymentConfirm(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => { setShowPaymentConfirm(false); doSubmit(); }}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 text-white font-semibold hover:from-amber-400 hover:to-amber-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      支付�?..
                    </span>
                  ) : (
                    '确认支付'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
  const [ticketCode, setTicketCode] = useState('');
  const [showForceWarning, setShowForceWarning] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [ticketType, setTicketType] = useState<TicketType>('adult');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');