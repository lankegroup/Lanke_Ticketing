import { useEffect, useRef, useState } from 'react';
import { supabase, callEdgeFunction, Session, SeatMapRow, UserProfile, TicketType } from '../../lib/supabase';
import { X, Calendar, Clock, ArrowLeft, LayoutGrid, CheckCircle2, AlertTriangle, Ticket } from 'lucide-react';
import SeatMap from '../SeatMap';

function TicketTypeSegmented({ value, onChange }: { value: TicketType; onChange: (t: TicketType) => void }) {
  const opts: { v: TicketType; label: string; activeCls: string }[] = [
    { v: 'adult',      label: '成人票', activeCls: 'bg-sky-500 text-white shadow-sm' },
    { v: 'child',      label: '儿童票', activeCls: 'bg-teal-500 text-white shadow-sm' },
    { v: 'concession', label: '优待票', activeCls: 'bg-amber-500 text-white shadow-sm' },
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

type Step = 'session' | 'seat' | 'confirm' | 'done';

interface ProxyBookingModalProps {
  user: UserProfile;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProxyBookingModal({ user, onClose, onSuccess }: ProxyBookingModalProps) {
  const [step, setStep] = useState<Step>('session');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [lockExpiresAt, setLockExpiresAt] = useState<string>('');
  const [locking, setLocking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [ticketCode, setTicketCode] = useState('');
  const [showForceWarning, setShowForceWarning] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [ticketType, setTicketType] = useState<TicketType>('adult');
  const [customerBalance, setCustomerBalance] = useState<number>(0);
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const lockedSeatRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getTicketPrice = (type: TicketType) => {
    if (!selectedSession) return 0;
    switch (type) {
      case 'child': return selectedSession.child_price ?? selectedSession.ticket_price * 0.5;
      case 'concession': return selectedSession.concession_price ?? selectedSession.ticket_price * 0.8;
      case 'vip': return selectedSession.vip_price ?? selectedSession.ticket_price * 1.5;
      default: return selectedSession.ticket_price;
    }
  };

  const fetchCustomerBalance = async () => {
    const { data: balData } = await supabase.rpc('get_user_lcoin_balance', { p_user_id: user.id });
    setCustomerBalance(typeof balData === 'number' ? balData : 0);
  };

  useEffect(() => {
    supabase
      .from('sessions')
      .select('*')
      .eq('is_active', true)
      .order('session_date')
      .order('start_time')
      .then(({ data }) => setSessions(data ?? []));

    fetchCustomerBalance();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (lockedSeatRef.current) {
        supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      }
    };
  }, []);

  // Auto-release on lock expiry
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
      setStep('confirm');
    }
  }

  async function handleSeatClick(seat: SeatMapRow) {
    if (seat.is_booked) return;

    // Blocked seat: force-booking flow (no lock needed)
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

    // Deselect currently locked seat
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

    // Refresh seat map before attempting lock
    if (sessionIdRef.current) {
      const { data: fresh } = await supabase.rpc('get_seat_map', { p_session_id: sessionIdRef.current });
      setSeats((fresh as SeatMapRow[]) ?? []);
    }

    // Release previous lock if any
    if (lockedSeatRef.current) {
      await supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      lockedSeatRef.current = null;
    }

    setShowForceWarning(false);
    setPendingForce(false);
    setLocking(true);
    const { data, error: lockErr } = await supabase.rpc('lock_seat', { p_seat_id: seat.id });
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

  async function handleClose() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (lockedSeatRef.current) {
      await supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      lockedSeatRef.current = null;
    }
    onClose();
  }

  async function goBack() {
    setShowForceWarning(false);
    setPendingForce(false);
    setError('');
    if (step === 'seat') {
      // Going back to session — release lock
      await releaseLock();
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setStep('session');
    } else if (step === 'confirm') {
      // Going back to seat — keep lock if it's a normal seat
      setStep(selectedSession?.has_seating_chart ? 'seat' : 'session');
    }
  }

  async function handleSubmit() {
    if (!selectedSession) return;
    setError('');
    setSubmitting(true);

    const ticketPrice = getTicketPrice(ticketType);
    
    if (customerBalance < ticketPrice) {
      setError(`余额不足！当前余额 ${customerBalance} L-Coin，需支付 ${ticketPrice} L-Coin`);
      setSubmitting(false);
      return;
    }

    const deductResult = await supabase.rpc('create_lcoin_transaction', {
      p_user_id: user.id,
      p_transaction_type: 'purchase',
      p_amount: ticketPrice,
      p_session_id: selectedSession.id,
      p_operator_type: 'admin',
      p_description: `代客预约：${selectedSession.name}`,
      p_payment_method: 'lcoin',
    });

    const deductData = deductResult.data as any;
    if (!deductData?.success) {
      setError(deductData?.error || '扣款失败，请重试');
      setSubmitting(false);
      return;
    }

    const selectedSeat = seats.find(s => s.id === selectedSeatId);
    const isForce = pendingForce || (selectedSeat?.is_blocked ?? false);

    const bookResult = await supabase.rpc('admin_book_ticket', {
      p_session_id: selectedSession.id,
      p_seat_id: selectedSeatId ?? null,
      p_name: user.display_name || user.id.slice(0, 8),
      p_phone: user.phone || '',
      p_user_id: user.id,
      p_force: isForce,
      p_order_source: 'admin',
      p_is_supplementary: false,
      p_ticket_type: ticketType,
      p_note_content: null,
    });

    const rpcResult = bookResult.data as any;

    if (bookResult.error || !rpcResult?.success) {
      await supabase.rpc('create_lcoin_transaction', {
        p_user_id: user.id,
        p_transaction_type: 'refund',
        p_amount: ticketPrice,
        p_session_id: selectedSession.id,
        p_operator_type: 'admin',
        p_description: `退款：代客预约失败 ${selectedSession.name}`,
        p_payment_method: 'lcoin',
      });
      const msg = rpcResult?.error;
      if (msg === 'sold_out') setError('该场次已售罄');
      else if (msg === 'seat_taken') setError('座位已被预订，请返回重新选择');
      else if (msg === 'missing_params') setError('该用户缺少手机号，请先完善用户信息');
      else if (msg === 'session_not_found') setError('场次不存在');
      else if (msg === 'session_inactive') setError('该场次已停用');
      else if (msg === 'invalid_seat') setError('座位无效');
      else if (msg === 'seat_blocked') setError('该座位已锁定，需强制预约');
      else if (msg === 'unauthorized') setError('无权限执行此操作');
      else if (msg === 'not_found') setError('记录不存在');
      else {
        const errDetail = bookResult.error ? (typeof bookResult.error === 'object' ? JSON.stringify(bookResult.error) : String(bookResult.error)) : '';
        setError('预订失败：' + (msg || errDetail || '未知错误'));
      }
      setSubmitting(false);
      return;
    }

    lockedSeatRef.current = null;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setTicketCode(rpcResult.ticket_code || '');
    setStep('done');
    setSubmitting(false);
    onSuccess();
  }

  const selectedSeat = seats.find(s => s.id === selectedSeatId);
  const stock = selectedSession ? (selectedSession.available_stock ?? selectedSession.capacity) : 0;
  const isForceBooking = pendingForce || (selectedSeat?.is_blocked ?? false);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div
        className="bg-white rounded-t-3xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            {step !== 'session' && step !== 'done' && (
              <button
                onClick={goBack}
                className="p-1 hover:bg-gray-100 rounded-lg mr-1"
              >
                <ArrowLeft size={16} className="text-gray-600" />
              </button>
            )}
            <div>
              <h3 className="font-bold text-gray-900 text-base">代客预约</h3>
              <p className="text-xs text-gray-400">
                {user.display_name || user.id.slice(0, 8)}
                {user.phone ? ` · ${user.phone}` : ''}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-full">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Step indicator */}
        {step !== 'done' && (
          <div className="flex items-center gap-0 px-5 py-2 border-b border-gray-50 flex-shrink-0">
            {(['选场次', selectedSession?.has_seating_chart ? '选座位' : null, '确认'] as (string | null)[]).filter(Boolean).map((label, i, arr) => (
              <div key={i} className="flex items-center">
                <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                  (step === 'session' && i === 0) ||
                  (step === 'seat' && i === 1) ||
                  (step === 'confirm' && i === arr.length - 1)
                    ? 'bg-sky-100 text-sky-600 font-semibold'
                    : 'text-gray-400'
                }`}>
                  <span className="w-4 h-4 rounded-full bg-current opacity-20 inline-block" />
                  {label}
                </div>
                {i < arr.length - 1 && <div className="w-4 h-px bg-gray-200 mx-0.5" />}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Step: Select Session */}
          {step === 'session' && (
            <div className="p-4 space-y-2">
              {sessions.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">暂无可预订场次</p>
              ) : (
                sessions.map(s => {
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
                          : 'border-gray-200 hover:border-sky-300 hover:shadow-sm active:scale-[0.99]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-gray-900 text-sm">{s.name}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          full ? 'bg-red-100 text-red-500' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {full ? '售罄' : `余 ${avail}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Calendar size={10} /> {s.session_date}</span>
                        <span className="flex items-center gap-1"><Clock size={10} /> {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</span>
                        {s.has_seating_chart && (
                          <span className="flex items-center gap-1 text-sky-500"><LayoutGrid size={10} /> 有座位图</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Step: Select Seat */}
          {step === 'seat' && selectedSession && (
            <div className="p-4 space-y-4">
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                管理员可强制预订屏蔽座位——点击屏蔽座位后需确认"强制预订"
              </p>

              {/* Force booking warning modal */}
              {showForceWarning && selectedSeat && (
                <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-800 text-sm">该座位已屏蔽</p>
                      <p className="text-amber-700 text-xs mt-1">
                        座位 <strong>{selectedSeat.seat_name}</strong> 当前处于屏蔽状态
                        {selectedSeat.block_reason ? `（原因：${selectedSeat.block_reason}）` : ''}。
                        确认强制预订后，订单将正常生效；若此订单日后被取消，座位将自动恢复为屏蔽状态。
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={cancelForce}
                      className="flex-1 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm hover:bg-amber-100 transition-colors"
                    >
                      取消选择
                    </button>
                    <button
                      onClick={confirmForce}
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-semibold transition-colors"
                    >
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
                <div className={`border rounded-xl px-4 py-2.5 ${isForceBooking ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200'}`}>
                  <p className={`text-xs ${isForceBooking ? 'text-amber-600' : 'text-sky-600'}`}>
                    {isForceBooking ? '已选座位（强制预订）' : '已选座位'}
                  </p>
                  <p className={`font-bold ${isForceBooking ? 'text-amber-700' : 'text-sky-700'}`}>
                    {selectedSeat.seat_name}
                    {isForceBooking && <span className="text-xs font-normal ml-1.5">（屏蔽座位）</span>}
                  </p>
                </div>
              )}

              <button
                onClick={() => setStep('confirm')}
                disabled={!selectedSeatId || showForceWarning || locking}
                className="w-full bg-sky-500 hover:bg-sky-400 disabled:bg-gray-200 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:cursor-not-allowed"
              >
                {locking ? '锁定中...' : selectedSeatId && !showForceWarning ? `确认座位 — ${selectedSeat?.seat_name}` : '请先选择座位'}
              </button>
            </div>
          )}

          {/* Step: Confirm */}
          {step === 'confirm' && selectedSession && (
            <div className="p-4 space-y-4">
              {isForceBooking && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 flex items-start gap-2">
                  <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 font-medium">强制预订模式：将预订屏蔽座位 {selectedSeat?.seat_name}，取消后该座位会恢复为屏蔽状态</p>
                </div>
              )}

              {/* Show countdown if seat is still locked */}
              {lockExpiresAt && selectedSeatId && !isForceBooking && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-700 flex items-center gap-2">
                  <span>座位已锁定，请尽快完成预订，剩余时间：</span>
                  <span className="font-mono font-bold text-amber-800">
                    {/* Inline countdown display */}
                    <CountdownText expiresAt={lockExpiresAt} />
                  </span>
                </div>
              )}

              <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">订单摘要</h4>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">客户</span>
                  <span className="font-medium text-gray-900">{user.display_name || '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">手机</span>
                  <span className="font-medium text-gray-900">{user.phone || <span className="text-red-500">未填写</span>}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">场次</span>
                  <span className="font-medium text-gray-900 text-right max-w-[60%]">{selectedSession.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">日期</span>
                  <span className="font-medium text-gray-900">{selectedSession.session_date} {selectedSession.start_time.slice(0, 5)}</span>
                </div>
                {selectedSeat && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">座位</span>
                    <span className={`font-bold ${isForceBooking ? 'text-amber-600' : 'text-sky-600'}`}>
                      {selectedSeat.seat_name}{isForceBooking ? ' ⚠ 屏蔽座位' : ''}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">剩余名额</span>
                  <span className="font-medium text-gray-900">{stock}</span>
                </div>
                <div className="space-y-1.5 pt-1">
                  <span className="text-sm text-gray-500 flex items-center gap-1"><Ticket size={12} /> 票种</span>
                  <TicketTypeSegmented value={ticketType} onChange={setTicketType} />
                </div>
                <div className="border-t border-gray-200 pt-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">票价</span>
                    <span className="font-bold text-amber-600">{getTicketPrice(ticketType)} LC</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">当前余额</span>
                    <span className={`font-medium ${customerBalance >= getTicketPrice(ticketType) ? 'text-emerald-600' : 'text-red-500'}`}>
                      {customerBalance} LC
                    </span>
                  </div>
                </div>
              </div>

              {!user.phone && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                  该用户尚未填写手机号，提交时将使用空号。建议先在用户管理中完善信息。
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>
              )}

              <button
                onClick={() => setShowPaymentConfirm(true)}
                disabled={submitting}
                className={`w-full ${isForceBooking ? 'bg-amber-500 hover:bg-amber-400' : 'bg-emerald-500 hover:bg-emerald-400'} disabled:opacity-60 text-white font-bold py-3.5 rounded-xl text-sm transition-colors`}
              >
                {submitting ? '提交中...' : isForceBooking ? '强制预订确认' : '确认代客预约'}
              </button>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="p-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 size={32} className="text-emerald-500" />
              </div>
              <h4 className="font-bold text-gray-900 text-lg mb-1">代客预约成功</h4>
              <p className="text-sm text-gray-500 mb-4">订单已生成在客户名下，状态为"待核销"</p>
              {ticketCode && (
                <div className="bg-gray-50 rounded-xl px-5 py-3 mb-6">
                  <p className="text-xs text-gray-400 mb-1">券码</p>
                  <p className="font-mono font-bold text-xl text-gray-900 tracking-widest">{ticketCode}</p>
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full bg-sky-500 hover:bg-sky-400 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                关闭
              </button>
            </div>
          )}

          {showPaymentConfirm && selectedSession && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 bg-amber-100">
                    <span className="text-lg font-bold text-amber-600">LC</span>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">兰克币支付确认</h3>
                  <p className="text-sm text-gray-500 mt-1">将从用户账户中扣除兰克币</p>
                </div>
                
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">客户</span>
                    <span className="font-medium text-gray-900">{user.display_name || '-'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">活动名称</span>
                    <span className="font-medium text-gray-900 truncate max-w-[150px]">{selectedSession.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">票价</span>
                    <span className="font-bold text-amber-600">{getTicketPrice(ticketType)} LC</span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 flex justify-between">
                    <span className="text-gray-600">当前余额</span>
                    <span className={`font-medium ${customerBalance >= getTicketPrice(ticketType) ? 'text-emerald-600' : 'text-red-500'}`}>
                      {customerBalance} LC
                    </span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowPaymentConfirm(false)}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => { setShowPaymentConfirm(false); handleSubmit(); }}
                    disabled={customerBalance < getTicketPrice(ticketType)}
                    className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-gray-200 text-white font-semibold transition-colors"
                  >
                    确认扣款
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CountdownText({ expiresAt }: { expiresAt: string }) {
  const [secs, setSecs] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return <>{m}:{s}</>;
}
