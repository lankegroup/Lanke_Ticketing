import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, formatSeatName, SeatMapRow, Session, TicketType } from '../../lib/supabase';
import { renderTicketToCanvas, downloadTicket, formatOrderTime } from '../../lib/ticketGenerator';
import { useAuth } from '../../contexts/AuthContext';
import { enterKioskMode, getKioskPassword, KIOSK_PASSWORD_KEY } from '../AppRouter';
import {
  ScanLine, Keyboard, CheckCircle, XCircle, AlertCircle,
  RotateCcw, CameraOff, Clock, MonitorSmartphone, Eye, EyeOff, Pencil,
  ShoppingCart, ArrowLeft, X, Ticket,
} from 'lucide-react';
import SeatMap from '../SeatMap';
import BookingNoticeModal from '../BookingNoticeModal';
import PrintConfirmModal, { PrintConfirmResult } from './PrintConfirmModal';
import { QRCodeCanvas } from 'qrcode.react';

type ScanResult = {
  status: 'success' | 'used' | 'cancelled' | 'expired' | 'not_found' | 'recent' | 'camera_error' | 'verification_not_open' | 'verification_expired';
  message: string;
  name?: string;
  session?: string;
  seat?: string;
};

const RESCAN_COOLDOWN_MS = 10000;
const recentScans = new Map<string, number>();

async function stopScanner(scanner: any) {
  if (!scanner) return;
  try {
    const state = scanner.getRunningState?.();
    if (state === 2) await scanner.stop();
  } catch {}
  try { scanner.clear(); } catch {}
}

export default function AdminWorkbench({ isMobile = false, onFrontDeskMode }: { isMobile?: boolean; onFrontDeskMode?: (active: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const { user } = useAuth();
  const [mode, setMode] = useState<'scan' | 'manual' | 'front_desk'>('scan');
  const [manualCode, setManualCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);

  // Password config state
  const [kioskPassword, setKioskPassword] = useState(getKioskPassword);
  const [editingPassword, setEditingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const scannerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<any>(null);
  const restartingRef = useRef(false);
  const scannerKeyRef = useRef(0);
  const verifyingRef = useRef(false);

  function stopStreamTracks() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  function releaseWorkbenchWakeLock() {
    try { wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;
  }

  const validateTicket = useCallback(async (code: string) => {
    if (!code.trim()) return;
    if (verifyingRef.current) return;
    verifyingRef.current = true;

    const trimmed = code.trim().toUpperCase();
    setLoading(true);

    try {
      if (scannerRef.current) {
        await stopScanner(scannerRef.current);
        scannerRef.current = null;
        setScannerActive(false);
        stopStreamTracks();
        releaseWorkbenchWakeLock();
      }

      const lastScan = recentScans.get(trimmed);
      if (lastScan && Date.now() - lastScan < RESCAN_COOLDOWN_MS) {
        setResult({ status: 'recent', message: t('recently_scanned') });
        return;
      }

      const { data: reg, error } = await supabase
        .from('registrations')
        .select('*, sessions(name, session_date, start_time, end_time, verification_start, verification_end, verify_date), seats(seat_name)')
        .eq('ticket_code', trimmed)
        .maybeSingle();

      if (error || !reg) {
        setResult({ status: 'not_found', message: t('ticket_not_found') });
        return;
      }

      if (reg.status === 'used') {
        const lastScanTime = recentScans.get(trimmed);
        const justValidated = !!lastScanTime && (Date.now() - lastScanTime < RESCAN_COOLDOWN_MS);
        if (justValidated) {
          const s = reg.sessions as any;
          const sessionLabel = s ? `${s.name} · ${s.session_date} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}` : '';
          setResult({ status: 'success', message: t('verify_success'), name: reg.name, session: sessionLabel, seat: (reg as any).seats?.seat_name ? formatSeatName((reg as any).seats.seat_name, isEn) : undefined });
        } else {
          setResult({ status: 'used', message: t('ticket_used'), name: reg.name });
        }
        return;
      }

      if (reg.status === 'cancelled') {
        setResult({ status: 'cancelled', message: t('ticket_cancelled'), name: reg.name });
        return;
      }

      if (reg.status === 'expired') {
        setResult({ status: 'expired', message: t('status_expired'), name: reg.name });
        return;
      }

      const session = reg.sessions as any;
      // Verification logic: only allow verification when:
      // 1. CurrentDate == verifyDate (if verifyDate is set)
      // 2. verifyStartTime <= CurrentTime <= verifyEndTime (if times are set)
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Check verify_date if it's set
      if (session?.verify_date) {
        const verifyDate = session.verify_date instanceof Date
          ? session.verify_date.toISOString().slice(0, 10)
          : String(session.verify_date).slice(0, 10);

        if (today !== verifyDate) {
          setResult({
            status: 'verification_not_open',
            message: today < verifyDate
              ? t('verification_not_open_date_future', { date: verifyDate })
              : t('verification_not_open_date_past', { date: verifyDate }),
            name: reg.name,
          });
          return;
        }
      }

      // Check verification_start time if it's set
      if (session?.verification_start) {
        const verStart = session.verification_start.slice(0, 5);
        if (currentTime < verStart) {
          setResult({
            status: 'verification_not_open',
            message: t('verification_not_open', { start: verStart }),
            name: reg.name,
          });
          return;
        }
      }

      // Check verification_end time if it's set
      if (session?.verification_end) {
        const verEnd = session.verification_end.slice(0, 5);
        if (currentTime > verEnd) {
          setResult({ status: 'verification_expired', message: t('verification_expired'), name: reg.name });
          return;
        }
      }

      await supabase.from('registrations').update({
        status: 'used',
        validated_at: new Date().toISOString(),
        validated_by: user?.id,
      }).eq('id', reg.id);

      await supabase.from('validation_logs').insert({
        ticket_code: trimmed,
        registration_id: reg.id,
        admin_id: user?.id,
      });

      recentScans.set(trimmed, Date.now());

      const s = reg.sessions as any;
      const sessionLabel = s ? `${s.name} · ${s.session_date} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}` : '';
      setResult({ status: 'success', message: t('verify_success'), name: reg.name, session: sessionLabel, seat: (reg as any).seats?.seat_name });
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
  }, [t, user]);

  useEffect(() => {
    if (mode !== 'scan' || result) return;
    let cancelled = false;
    let html5QrCode: any;

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const el = document.getElementById('qr-reader');
        if (el) el.innerHTML = '';
        html5QrCode = new Html5Qrcode('qr-reader');
        scannerRef.current = html5QrCode;
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText: string) => { if (!cancelled) validateTicket(decodedText); },
          undefined
        );
        // Cleanup fired while camera was still starting — stop it now
        if (cancelled) {
          await stopScanner(html5QrCode);
          stopStreamTracks();
          scannerRef.current = null;
          return;
        }
        // Grab MediaStream for explicit track management on cleanup
        const videoEl = document.querySelector<HTMLVideoElement>('#qr-reader video');
        if (videoEl?.srcObject) streamRef.current = videoEl.srcObject as MediaStream;
        // Acquire wake lock while scanner is live
        if ('wakeLock' in navigator) {
          try { wakeLockRef.current = await (navigator as any).wakeLock.request('screen'); } catch {}
        }
        if (!cancelled) setScannerActive(true);
      } catch (e) {
        console.error('Camera error:', e);
        if (!cancelled) setResult({ status: 'camera_error', message: t('camera_error') });
      }
    }

    startScanner();
    return () => {
      cancelled = true;
      stopScanner(html5QrCode);
      stopStreamTracks();
      scannerRef.current = null;
      setScannerActive(false);
      releaseWorkbenchWakeLock();
    };
  }, [mode, result, scannerKeyRef.current, validateTicket, t]);

  async function resetResult() {
    if (restartingRef.current) return;
    restartingRef.current = true;
    await stopScanner(scannerRef.current);
    scannerRef.current = null;
    stopStreamTracks();
    releaseWorkbenchWakeLock();
    setResult(null);
    setManualCode('');
    scannerKeyRef.current += 1;
    setTimeout(() => { restartingRef.current = false; }, 300);
  }

  function saveKioskPassword() {
    const trimmed = newPassword.trim();
    if (!trimmed) return;
    try { localStorage.setItem(KIOSK_PASSWORD_KEY, trimmed); } catch {}
    setKioskPassword(trimmed);
    setNewPassword('');
    setEditingPassword(false);
    setShowNewPassword(false);
  }

  const resultConfig: Record<string, { icon: any; color: string; bg: string }> = {
    success:               { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50 border-emerald-200' },
    used:                  { icon: XCircle,     color: 'text-amber-500',   bg: 'bg-amber-50 border-amber-200'   },
    cancelled:             { icon: XCircle,     color: 'text-red-500',     bg: 'bg-red-50 border-red-200'       },
    expired:               { icon: XCircle,     color: 'text-amber-500',   bg: 'bg-amber-50 border-amber-200'   },
    not_found:             { icon: AlertCircle, color: 'text-red-500',     bg: 'bg-red-50 border-red-200'       },
    recent:                { icon: AlertCircle, color: 'text-amber-500',   bg: 'bg-amber-50 border-amber-200'   },
    camera_error:          { icon: CameraOff,   color: 'text-red-500',     bg: 'bg-red-50 border-red-200'       },
    verification_not_open: { icon: Clock,       color: 'text-amber-500',   bg: 'bg-amber-50 border-amber-200'   },
    verification_expired:  { icon: Clock,       color: 'text-red-500',     bg: 'bg-red-50 border-red-200'       },
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">{t('workbench')}</h2>

      {/* Mode Switch — hidden when in front_desk mode */}
      {mode !== 'front_desk' && (
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => { setMode('scan'); setResult(null); onFrontDeskMode?.(false); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'scan' ? 'bg-white shadow text-sky-600' : 'text-gray-500'
          }`}
        >
          <ScanLine size={16} /> {t('scan_qr')}
        </button>
        <button
          onClick={() => { setMode('manual'); setResult(null); onFrontDeskMode?.(false); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'manual' ? 'bg-white shadow text-sky-600' : 'text-gray-500'
          }`}
        >
          <Keyboard size={16} /> {t('manual_input')}
        </button>
        <button
          onClick={() => { setMode('front_desk'); setResult(null); onFrontDeskMode?.(true); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'front_desk' ? 'bg-white shadow text-sky-600' : 'text-gray-500'
          }`}
        >
          <ShoppingCart size={16} /> {isMobile ? '补票' : '前台售票'}
        </button>
      </div>
      )}

      {/* Front Desk Mode */}
      {mode === 'front_desk' && <FrontDeskView isMobile={isMobile} onExit={() => { setMode('scan'); setResult(null); onFrontDeskMode?.(false); }} />}

      {/* Scanner */}
      {mode === 'scan' && !result && (
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
          <div id="qr-reader" className="w-full" style={{ minHeight: 280 }} />
          {!scannerActive && <p className="text-center text-sm text-gray-400 py-3">{t('loading')}</p>}
          {scannerActive && <p className="text-center text-sm text-gray-400 py-3">{t('scan_tip')}</p>}
        </div>
      )}

      {/* Manual Input */}
      {mode === 'manual' && !result && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
          <input
            type="text"
            value={manualCode}
            onChange={e => setManualCode(e.target.value.toUpperCase())}
            placeholder={t('enter_ticket_code')}
            disabled={loading}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 text-sm uppercase tracking-widest disabled:opacity-50 disabled:bg-gray-50"
            onKeyDown={e => e.key === 'Enter' && validateTicket(manualCode)}
          />
          <button
            onClick={() => validateTicket(manualCode)}
            disabled={loading || !manualCode.trim()}
            className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? t('verifying') : t('verify')}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (() => {
        const cfg = resultConfig[result.status] || resultConfig.not_found;
        const Icon = cfg.icon;
        return (
          <div className={`rounded-2xl border p-6 flex flex-col items-center gap-3 ${cfg.bg}`}>
            <Icon size={48} className={cfg.color} />
            <p className={`text-lg font-bold ${cfg.color}`}>{result.message}</p>
            {result.name && <p className="text-gray-700 text-sm font-medium">{result.name}</p>}
            {result.seat && (
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-center">
                <p className="text-[10px] text-gray-400 mb-0.5">座位</p>
                <p className="font-bold text-gray-900 text-base">{result.seat}</p>
              </div>
            )}
            {result.session && <p className="text-gray-500 text-xs">{result.session}</p>}
            <button
              onClick={resetResult}
              className="mt-2 flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <RotateCcw size={14} />
              {t('scan_again')}
            </button>
          </div>
        );
      })()}

      {/* ── Kiosk Mode Entry — hidden when in front desk mode ─────────────── */}
      {mode !== 'front_desk' && (
      <div className="space-y-3">
        <div className="border-t border-gray-100 pt-4">
          <button
            onClick={enterKioskMode}
            className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 text-white px-4 py-3.5 rounded-2xl transition-colors"
          >
            <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <MonitorSmartphone size={18} />
            </div>
            <div className="text-left">
              <p className="font-semibold text-sm">进入自助核销模式</p>
              <p className="text-white/50 text-xs mt-0.5">全屏扫码 · 屏幕常亮</p>
            </div>
          </button>
        </div>

        {/* Kiosk password config */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">自助模式退出密码</p>
              <p className="text-xs text-gray-400 mt-0.5">用于退出全屏自助核销模式</p>
            </div>
            {!editingPassword && (
              <button
                onClick={() => { setNewPassword(''); setEditingPassword(true); setShowNewPassword(false); }}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Pencil size={15} className="text-gray-400" />
              </button>
            )}
          </div>

          {!editingPassword ? (
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-2.5">
              <span className="font-mono text-sm text-gray-500 tracking-widest flex-1">
                {'●'.repeat(kioskPassword.length)}
              </span>
              <span className="text-xs text-gray-400">{kioskPassword.length} 位</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="输入新密码（数字或字母）"
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 font-mono tracking-widest"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditingPassword(false); setNewPassword(''); }}
                  className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={saveKioskPassword}
                  disabled={!newPassword.trim()}
                  className="flex-1 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ─── TicketTypeSegmented ─────────────────────────────────────────────────────

const TICKET_OPTS: { v: TicketType; label: string; dot: string; active: string }[] = [
  { v: 'adult',      label: '成人', dot: 'bg-sky-400',   active: 'bg-sky-500 text-white' },
  { v: 'child',      label: '儿童', dot: 'bg-teal-400',  active: 'bg-teal-500 text-white' },
  { v: 'concession', label: '优待', dot: 'bg-amber-400', active: 'bg-amber-500 text-white' },
];

function TicketTypeSegmented({ value, onChange }: { value: TicketType; onChange: (t: TicketType) => void }) {
  return (
    <div className="inline-flex gap-0.5 bg-gray-100 p-0.5 rounded-lg">
      {TICKET_OPTS.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
            value === o.v ? o.active + ' shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${value === o.v ? 'bg-white/70' : o.dot}`} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── FrontDeskView ────────────────────────────────────────────────────────────

type FDStep = 'session' | 'seat' | 'buyer' | 'done';

function FrontDeskView({ isMobile = false, onExit }: { isMobile?: boolean; onExit?: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [step, setStep] = useState<FDStep>('session');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [seatTicketTypes, setSeatTicketTypes] = useState<Record<string, TicketType>>({});
  const [lockExpiresAt, setLockExpiresAt] = useState<string>('');
  const [locking, setLocking] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [entryTicketTypes, setEntryTicketTypes] = useState<TicketType[]>(['adult']);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [matchedUserId, setMatchedUserId] = useState<string | null>(null);
  const [matchedUserName, setMatchedUserName] = useState<string | null>(null);
  const [phoneLooking, setPhoneLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successTickets, setSuccessTickets] = useState<{ ticket_code: string; seat_name?: string; registration_id?: string; ticket_type?: TicketType }[]>([]);
  const [isSupplementary, setIsSupplementary] = useState(isMobile);
  const [showBookingNotice, setShowBookingNotice] = useState(false);
  const [pendingPrint, setPendingPrint] = useState<{ ticketCode: string; seatName?: string; supplementary: boolean; registrationId?: string } | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'rmb' | 'lcoin' | 'mixed'>('rmb');
  const [rmbAmount, setRmbAmount] = useState('');
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const [customerBalance, setCustomerBalance] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const lockedSeatRefs = useRef<Set<string>>(new Set());
  const seatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    supabase.from('sessions').select('*').eq('is_active', true)
      .order('session_date').order('start_time')
      .then(({ data }) => setSessions((data as Session[]) ?? []));
    return () => {
      lockedSeatRefs.current.forEach(seatId => {
        supabase.rpc('unlock_seat', { p_seat_id: seatId });
      });
      if (seatPollRef.current) clearInterval(seatPollRef.current);
    };
  }, []);

  // Auto-release on lock expiry
  useEffect(() => {
    if (!lockExpiresAt || !selectedSession) return;
    const ms = new Date(lockExpiresAt).getTime() - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(async () => {
      setSelectedSeatIds([]);
      setLockExpiresAt('');
      lockedSeatRefs.current.clear();
      const { data } = await supabase.rpc('get_seat_map', { p_session_id: selectedSession.id });
      setSeats((data as SeatMapRow[]) ?? []);
    }, ms + 500);
    return () => clearTimeout(t);
  }, [lockExpiresAt, selectedSession]);

  async function refreshSeats(sessionId: string) {
    const { data } = await supabase.rpc('get_seat_map', { p_session_id: sessionId });
    setSeats((data as SeatMapRow[]) ?? []);
  }

  async function pickSession(s: Session) {
    setSelectedSession(s);
    setSelectedSeatIds([]);
    setSeatTicketTypes({});
    setLockExpiresAt('');
    setSeats([]);
    setQuantity(1);
    setEntryTicketTypes(['adult']);
    lockedSeatRefs.current.forEach(seatId => {
      supabase.rpc('unlock_seat', { p_seat_id: seatId });
    });
    lockedSeatRefs.current.clear();
    if (seatPollRef.current) clearInterval(seatPollRef.current);
    if (s.has_seating_chart) {
      await refreshSeats(s.id);
      seatPollRef.current = setInterval(() => refreshSeats(s.id), 3000);
      setStep('seat');
    } else {
      setStep('buyer');
    }
  }

  async function handleSeatClick(seat: SeatMapRow) {
    if (!selectedSession || seat.is_booked || seat.is_blocked) return;
    const maxTickets = Math.min(3, selectedSession.available_stock ?? selectedSession.capacity ?? 3);

    // If seat is already selected, deselect it
    if (selectedSeatIds.includes(seat.id)) {
      await supabase.rpc('unlock_seat', { p_seat_id: seat.id });
      lockedSeatRefs.current.delete(seat.id);
      const newIds = selectedSeatIds.filter(id => id !== seat.id);
      setSelectedSeatIds(newIds);
      setSeatTicketTypes(prev => {
        const next = { ...prev };
        delete next[seat.id];
        return next;
      });
      if (newIds.length === 0) {
        setLockExpiresAt('');
      }
      refreshSeats(selectedSession.id);
      return;
    }

    // Refresh seat map before attempting lock
    refreshSeats(selectedSession.id);

    // Check if we've reached max selection
    if (selectedSeatIds.length >= maxTickets) {
      setError(`最多选择 ${maxTickets} 个座位`);
      setTimeout(() => setError(''), 2000);
      return;
    }

    setLocking(true);
    const { data, error: lockErr } = await supabase.rpc('lock_seat', { p_seat_id: seat.id });
    setLocking(false);

    if (lockErr || !data?.success) {
      const reason = data?.reason;
      setError(reason === 'locked_by_other' ? '该座位正被他人选择，请稍后重试' : '座位锁定失败，请重试');
      setTimeout(() => setError(''), 3000);
      await refreshSeats(selectedSession.id);
      return;
    }

    lockedSeatRefs.current.add(seat.id);
    const newSelectedIds = [...selectedSeatIds, seat.id];
    setSelectedSeatIds(newSelectedIds);
    setSeatTicketTypes(prev => ({ ...prev, [seat.id]: 'adult' }));
    setLockExpiresAt(data.expires_at);
    setError('');
    refreshSeats(selectedSession.id);
  }

  async function lookupPhone(val: string) {
    setPhone(val);
    setMatchedUserId(null);
    setMatchedUserName(null);
    setCustomerBalance(0);
    if (val.trim().length < 7) return;
    setPhoneLooking(true);
    const { data } = await supabase.from('user_profiles').select('id, display_name').eq('phone', val.trim()).maybeSingle();
    setPhoneLooking(false);
    if (data) {
      setMatchedUserId(data.id);
      setMatchedUserName(data.display_name);
      if (!name.trim() && data.display_name) setName(data.display_name);
      const { data: balData } = await supabase.rpc('get_user_balance', { p_user_id: data.id });
      setCustomerBalance(Number(balData) || 0);
    }
  }

  function handleBookClick() {
    if (!selectedSession || !name.trim() || !phone.trim()) return;
    if (selectedSession.has_seating_chart && selectedSeatIds.length === 0) { setError('请选择座位'); return; }
    if (selectedSession.booking_notice?.trim()) {
      setShowBookingNotice(true);
    } else {
      handleSubmit();
    }
  }

  const getTicketPrice = (type: TicketType) => {
    if (!selectedSession) return 0;
    switch (type) {
      case 'child': return selectedSession.child_price ?? selectedSession.ticket_price * 0.5;
      case 'concession': return selectedSession.concession_price ?? selectedSession.ticket_price * 0.8;
      case 'vip': return selectedSession.vip_price ?? selectedSession.ticket_price * 1.5;
      default: return selectedSession.ticket_price;
    }
  };

  const totalPrice = selectedSession
    ? [...(selectedSession.has_seating_chart ? selectedSeatIds.map(id => seatTicketTypes[id] || 'adult') : entryTicketTypes)]
        .reduce((sum, type) => sum + getTicketPrice(type), 0) + (selectedSession.default_service_fee || 0)
    : 0;

  function handleBookClick() {
    if (!selectedSession || !name.trim() || !phone.trim()) return;
    if (selectedSession.has_seating_chart && selectedSeatIds.length === 0) { setError('请选择座位'); return; }
    if (selectedSession.booking_notice?.trim()) {
      setShowBookingNotice(true);
    } else {
      setShowPaymentConfirm(true);
    }
  }

  async function doSubmit() {
    if (!selectedSession || !name.trim() || !phone.trim()) return;
    if (selectedSession.has_seating_chart && selectedSeatIds.length === 0) { setError('请选择座位'); return; }
    setSubmitting(true);
    setError('');

    const rmbPayAmount = parseFloat(rmbAmount || '0');
    const lcoinPayAmount = paymentMethod === 'mixed' ? Math.max(0, totalPrice - rmbPayAmount) : 
                          paymentMethod === 'lcoin' ? totalPrice : 0;

    if (lcoinPayAmount > 0 && matchedUserId) {
      if (customerBalance < lcoinPayAmount) {
        setError(`余额不足！当前余额 ${customerBalance} L-Coin，需支付 ${lcoinPayAmount} L-Coin`);
        setSubmitting(false);
        return;
      }

      const deductResult = await supabase.rpc('lcoin_transaction', {
        p_user_id: matchedUserId,
        p_amount: lcoinPayAmount,
        p_description: `购票：${selectedSession.name}`,
        p_type: 'purchase',
      });

      if (!deductResult.data?.success) {
        setError('扣款失败，请重试');
        setSubmitting(false);
        return;
      }
    }

    const itemsToBook: { seatId: string | null; ticketType: TicketType }[] = selectedSession.has_seating_chart
      ? selectedSeatIds.map(seatId => ({ seatId, ticketType: seatTicketTypes[seatId] || 'adult' }))
      : entryTicketTypes.map(ticketType => ({ seatId: null, ticketType }));

    const results: { ticket_code: string; seat_name?: string; registration_id?: string; ticket_type?: TicketType }[] = [];

    for (const item of itemsToBook) {
      const res = await supabase.rpc('admin_book_ticket', {
        p_session_id: selectedSession.id,
        p_seat_id: item.seatId,
        p_name: name.trim(),
        p_phone: phone.trim(),
        p_user_id: matchedUserId ?? null,
        p_force: false,
        p_order_source: 'front_desk',
        p_ticket_type: item.ticketType,
        p_is_supplementary: isSupplementary,
      });
      const rpcResult = res.data as any;
      if (res.error || !rpcResult?.success) {
        setSubmitting(false);
        setError(rpcResult?.error || '出票失败，请重试');
        return;
      }
      const seatName = item.seatId ? seats.find(s => s.id === item.seatId)?.seat_name : undefined;
      results.push({ ticket_code: rpcResult.ticket_code, seat_name: seatName, registration_id: rpcResult.registration_id, ticket_type: item.ticketType });
    }

    setSubmitting(false);
    setSuccessTickets(results);
    setStep('done');

    if ((paymentMethod === 'lcoin' || paymentMethod === 'mixed') && matchedUserId) {
      const { data: balData } = await supabase.rpc('get_user_balance', { p_user_id: matchedUserId });
      setCustomerBalance(Number(balData) || 0);
    }

    if (results.length > 0) {
      setTimeout(() => {
        results.forEach((t, i) => {
          setTimeout(() => generateAndDownload(t.ticket_code, t.seat_name, isSupplementary, t.registration_id), i * 300);
        });
      }, 500);
    }
  }

  async function generateAndDownload(ticketCode: string, seatName?: string, supplementary = false, registrationId?: string, printResult?: PrintConfirmResult) {
    const canvas = canvasRef.current;
    if (!canvas || !selectedSession) return;

    const qrEl = qrContainerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;

    let isReprint = false;
    if (registrationId) {
      const { data: printCount } = await supabase.rpc('admin_increment_print_count', { p_registration_id: registrationId });
      isReprint = typeof printCount === 'number' && printCount > 1;
    }

    const s = selectedSession;
    renderTicketToCanvas({
      canvas,
      qrEl,
      ticketCode,
      sessionName:       s.name,
      sessionDate:       s.session_date,
      startTime:         s.start_time,
      endTime:           s.end_time,
      verificationStart: s.verification_start,
      verificationEnd:   s.verification_end,
      name:              name.trim(),
      seatName,
      operatorName:      '001',
      orderTime:         formatOrderTime(),
      isSupplementary:   supplementary,
      isReprint,
      ticketPrice:       s.ticket_price,
      serviceFee:        printResult?.serviceFee,
      paidAt:            printResult?.paidAt,
      printedAt:         printResult?.printedAt,
    });
    downloadTicket(canvas, ticketCode);
  }

  async function handlePrintConfirm(result: PrintConfirmResult) {
    setShowPrintModal(false);
    const p = pendingPrint;
    if (!p) return;
    setPendingPrint(null);

    // Write service_fee, paid_at, printed_at to DB for all tickets
    for (const t of successTickets) {
      if (t.registration_id) {
        await supabase.from('registrations').update({
          service_fee: result.serviceFee,
          paid_at: result.paidAt,
          printed_at: result.printedAt,
        }).eq('id', t.registration_id);
      }
    }

    // Download all tickets
    successTickets.forEach((t, i) => {
      setTimeout(() => generateAndDownload(t.ticket_code, t.seat_name, p.supplementary, t.registration_id, result), i * 100);
    });
  }

  function reset() {
    lockedSeatRefs.current.forEach(seatId => {
      supabase.rpc('unlock_seat', { p_seat_id: seatId });
    });
    lockedSeatRefs.current.clear();
    if (seatPollRef.current) { clearInterval(seatPollRef.current); seatPollRef.current = null; }
    setStep('session'); setSelectedSession(null); setSeats([]);
    setSelectedSeatIds([]); setSeatTicketTypes({}); setQuantity(1); setEntryTicketTypes(['adult']);
    setLockExpiresAt(''); setName(''); setPhone('');
    setMatchedUserId(null); setMatchedUserName(null);
    setError(''); setSuccessTickets([]);
  }

  const selectedSeatsList = selectedSeatIds.map(id => seats.find(s => s.id === id)).filter(Boolean) as SeatMapRow[];
  const actualRows = seats.length > 0 ? Math.max(...seats.map(s => s.row_index)) : (selectedSession?.seat_rows ?? 1);
  const actualCols = seats.length > 0 ? Math.max(...seats.map(s => s.col_index)) : (selectedSession?.seats_per_row ?? 1);

  if (step === 'done' && successTickets.length > 0) {
    return (
      <div className="space-y-4">
        <canvas ref={canvasRef} className="hidden" />
        <div ref={qrContainerRef} className="hidden" aria-hidden="true">
          <QRCodeCanvas value={successTickets[0].ticket_code} size={240} level="H" />
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex flex-col items-center gap-3">
          <CheckCircle size={44} className="text-emerald-500" />
          <p className="text-lg font-bold text-emerald-700">{isSupplementary ? '补票成功' : '出票成功'}</p>
          <p className="text-sm text-emerald-600">共 {successTickets.length} 张票</p>
          {isSupplementary && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-1.5 text-xs text-orange-700 font-medium">
              已标记为补票
            </div>
          )}
          {matchedUserId && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-1.5 text-xs text-sky-700">
              已关联用户账号 {matchedUserName ? `· ${matchedUserName}` : ''}，票据将出现在用户"我的订单"中
            </div>
          )}
          <div className="bg-white rounded-xl border border-emerald-200 px-4 py-3 w-full space-y-2">
            {successTickets.map((t, i) => (
              <div key={t.registration_id || i} className="text-center">
                <p className="text-xs text-gray-400 mb-0.5">票号 {successTickets.length > 1 ? `#${i + 1}` : ''}</p>
                <p className="font-mono font-bold text-emerald-700 tracking-widest">{t.ticket_code}</p>
                <div className="flex items-center justify-center gap-2 mt-0.5">
                  {t.seat_name && <span className="text-xs text-sky-600 font-medium">座位：{t.seat_name}</span>}
                  {t.ticket_type && (
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                      t.ticket_type === 'child' ? 'bg-teal-100 text-teal-700' :
                      t.ticket_type === 'concession' ? 'bg-amber-100 text-amber-700' :
                      'bg-sky-100 text-sky-700'
                    }`}>{t.ticket_type === 'adult' ? '成人票' : t.ticket_type === 'child' ? '儿童票' : '优待票'}</span>
                  )}
                </div>
                {i < successTickets.length - 1 && <hr className="border-t border-gray-200 mt-2" />}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">电子票已自动下载</p>
          <div className="flex gap-2 w-full">
            <button onClick={() => {
              successTickets.forEach((t, i) => {
                setTimeout(() => generateAndDownload(t.ticket_code, t.seat_name, isSupplementary, t.registration_id), i * 100);
              });
            }}
              className="flex-1 py-2.5 border border-emerald-200 text-emerald-600 rounded-xl text-sm hover:bg-emerald-50 transition-colors">
              重新下载
            </button>
            <button onClick={reset}
              className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-sm font-semibold transition-colors">
              继续出票
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
      <canvas ref={canvasRef} className="hidden" />
      {successTickets.length > 0 && (
        <div ref={qrContainerRef} className="hidden" aria-hidden="true">
          <QRCodeCanvas value={successTickets[0].ticket_code} size={240} level="H" />
        </div>
      )}

      {/* Step header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 flex items-center gap-3">
        <button
          onClick={async () => {
            if (step === 'session') {
              onExit?.();
            } else if (step === 'seat') {
              lockedSeatRefs.current.forEach(seatId => {
                supabase.rpc('unlock_seat', { p_seat_id: seatId });
              });
              lockedSeatRefs.current.clear();
              setSelectedSeatIds([]); setSeatTicketTypes({}); setLockExpiresAt('');
              if (seatPollRef.current) { clearInterval(seatPollRef.current); seatPollRef.current = null; }
              setStep('session');
            } else if (step === 'buyer') {
              setStep(selectedSession?.has_seating_chart ? 'seat' : 'session');
            }
          }}
          className="p-1.5 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0"
          title={step === 'session' ? '返回工作台' : '返回上一步'}
        >
          <ArrowLeft size={16} className="text-white" />
        </button>
        <div className="flex-1">
          <p className="font-semibold text-white text-sm">{isMobile ? '补票' : '前台售票'}</p>
          <div className="flex items-center gap-1 mt-0.5">
            {(['选场次', '选座位', '填信息'] as const).map((lbl, i) => {
              const active = (step === 'session' && i === 0) || (step === 'seat' && i === 1) || (step === 'buyer' && i === 2);
              return (
                <div key={i} className="flex items-center gap-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-all ${active ? 'bg-white text-emerald-600' : 'text-white/50'}`}>{lbl}</span>
                  {i < 2 && <span className="text-white/30 text-[10px]">›</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step: Session */}
      {step === 'session' && (
        <div className="bg-white p-4 space-y-2">
          {/* 补票 toggle — PC only, mobile is always supplementary */}
          {!isMobile && (
            <button
              onClick={() => setIsSupplementary(v => !v)}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border transition-all mb-1 ${
                isSupplementary ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${isSupplementary ? 'bg-orange-400' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${isSupplementary ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
                <span className="text-sm font-medium text-gray-700">补票模式</span>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isSupplementary ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-500'}`}>
                {isSupplementary ? '已开启' : '已关闭'}
              </span>
            </button>
          )}
          {sessions.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">暂无可用场次</p>
          ) : sessions.map(s => {
            const avail = s.available_stock ?? s.capacity;
            const full = avail <= 0;
            return (
              <button key={s.id} disabled={full} onClick={() => pickSession(s)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all text-sm ${full ? 'border-gray-100 opacity-50 cursor-not-allowed bg-gray-50' : 'border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 active:scale-[0.99]'}`}>
                <div className="flex justify-between items-center">
                  <p className="font-semibold text-gray-900">{s.name}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${full ? 'bg-red-100 text-red-500' : 'bg-emerald-100 text-emerald-700'}`}>{full ? '售罄' : `余 ${avail}`}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{s.session_date} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{s.has_seating_chart ? ' · 有座位图' : ''}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Step: Seat */}
      {step === 'seat' && selectedSession && (
        <div className="bg-white p-4 space-y-3">
          <button onClick={async () => {
            lockedSeatRefs.current.forEach(seatId => {
              supabase.rpc('unlock_seat', { p_seat_id: seatId });
            });
            lockedSeatRefs.current.clear();
            setSelectedSeatIds([]);
            setLockExpiresAt('');
            if (seatPollRef.current) { clearInterval(seatPollRef.current); seatPollRef.current = null; }
            setStep('session');
          }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-1">
            <ArrowLeft size={12} /> {selectedSession.name}
          </button>
          {/* Enlarged seat map on desktop via zoom */}
          <div style={!isMobile ? { zoom: 1.55, transformOrigin: 'top left' } : undefined}>
            <SeatMap
              seats={seats}
              rows={actualRows}
              seatsPerRow={actualCols}
              screenDirection={selectedSession.screen_direction ?? 'top'}
              selectedSeatId={null}
              selectedSeatIds={selectedSeatIds}
              selectedSeatTypes={seatTicketTypes}
              onSeatClick={locking ? () => {} : handleSeatClick}
              lockExpiresAt={lockExpiresAt || undefined}
              stageCenterCol={selectedSession.stage_center_col ?? undefined}
              ticketPrice={selectedSession.ticket_price}
            />
          </div>
          {selectedSeatsList.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 space-y-1.5">
              <p className="text-xs text-emerald-600 mb-1">已选座位 ({selectedSeatsList.length}/{Math.min(3, selectedSession.available_stock ?? selectedSession.capacity ?? 3)})</p>
              {selectedSeatsList.map(seat => (
                <div key={seat.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-1.5 gap-3">
                  <span className="font-bold text-emerald-700 text-sm whitespace-nowrap">{seat.seat_name}</span>
                  <TicketTypeSegmented
                    value={seatTicketTypes[seat.id] || 'adult'}
                    onChange={v => setSeatTicketTypes(prev => ({ ...prev, [seat.id]: v }))}
                  />
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setStep('buyer')} disabled={selectedSeatIds.length === 0}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
            {selectedSeatIds.length > 0 ? `下一步：填写购票信息 (${selectedSeatIds.length} 张)` : '请先选择座位'}
          </button>
        </div>
      )}

      {/* Step: Buyer Info */}
      {step === 'buyer' && selectedSession && (
        <div className="bg-white p-4 space-y-3">
          <button onClick={async () => {
            if (selectedSession.has_seating_chart) {
              setStep('seat');
            } else {
              setStep('session');
            }
          }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft size={12} /> 返回{selectedSession.has_seating_chart ? '选座' : '选场次'}
          </button>

          <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-gray-400">场次</span><span className="font-medium text-gray-800">{selectedSession.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">时间</span><span className="font-medium text-gray-800">{selectedSession.session_date} {selectedSession.start_time.slice(0, 5)}</span></div>
            {selectedSeatsList.length > 0 && (
              <div className="flex justify-between items-start pt-1">
                <span className="text-gray-400">座位</span>
                <div className="text-right space-y-0.5">
                  {selectedSeatsList.map(s => (
                    <div key={s.id} className="flex items-center gap-1.5 justify-end">
                      <span className="font-bold text-emerald-600">{s.seat_name}</span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                        seatTicketTypes[s.id] === 'child' ? 'bg-teal-100 text-teal-700' :
                        seatTicketTypes[s.id] === 'concession' ? 'bg-amber-100 text-amber-700' :
                        'bg-sky-100 text-sky-700'
                      }`}>{seatTicketTypes[s.id] === 'adult' ? '成人' : seatTicketTypes[s.id] === 'child' ? '儿童' : '优待'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quantity and ticket type selector for non-seating chart sessions */}
          {!selectedSession.has_seating_chart && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500">票种选择</label>
                <button
                  type="button"
                  onClick={() => {
                    const max = Math.min(3, selectedSession.available_stock ?? selectedSession.capacity ?? 3);
                    if (entryTicketTypes.length < max) {
                      setEntryTicketTypes([...entryTicketTypes, 'adult']);
                    }
                  }}
                  disabled={entryTicketTypes.length >= Math.min(3, selectedSession.available_stock ?? selectedSession.capacity ?? 3)}
                  className="text-xs text-sky-600 hover:text-sky-700 disabled:text-gray-300 font-medium"
                >
                  + 添加
                </button>
              </div>
              <div className="space-y-2">
                {entryTicketTypes.map((tt, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-xl px-3 py-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="w-5 h-5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </span>
                      {entryTicketTypes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setEntryTicketTypes(entryTicketTypes.filter((_, i) => i !== idx))}
                          className="p-1 hover:bg-red-100 rounded-lg text-red-400 hover:text-red-600 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <TicketTypeSegmented
                      value={tt}
                      onChange={v => {
                        const newTypes = [...entryTicketTypes];
                        newTypes[idx] = v;
                        setEntryTicketTypes(newTypes);
                      }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400">最多 {Math.min(3, selectedSession.available_stock ?? selectedSession.capacity ?? 3)} 张</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">手机号 *</label>
            <div className="relative">
              <input value={phone} onChange={e => lookupPhone(e.target.value)} placeholder="输入手机号" type="tel"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              {phoneLooking && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">查询中…</span>}
            </div>
            {matchedUserId && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5">
                <CheckCircle size={12} className="text-sky-500" />
                已匹配用户账号{matchedUserName ? `：${matchedUserName}` : ''}（票据将同步至其订单）
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">姓名 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="购票人姓名"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">票价明细</span>
              <span className="text-xs text-gray-400">
                {selectedSession.has_seating_chart ? selectedSeatIds.length : entryTicketTypes.length} 张
              </span>
            </div>
            <div className="space-y-1">
              {selectedSession.has_seating_chart ? selectedSeatIds.map(id => {
                const type = seatTicketTypes[id] || 'adult';
                const price = getTicketPrice(type);
                const seat = seats.find(s => s.id === id);
                return (
                  <div key={id} className="flex justify-between text-xs">
                    <span className="text-gray-600">
                      {seat?.seat_name} · {type === 'adult' ? '成人票' : type === 'child' ? '儿童票' : type === 'concession' ? '优待票' : 'VIP票'}
                    </span>
                    <span className="font-medium text-gray-800">{price} LC</span>
                  </div>
                );
              }) : entryTicketTypes.map((type, idx) => {
                const price = getTicketPrice(type);
                return (
                  <div key={idx} className="flex justify-between text-xs">
                    <span className="text-gray-600">
                      {idx + 1} · {type === 'adult' ? '成人票' : type === 'child' ? '儿童票' : type === 'concession' ? '优待票' : 'VIP票'}
                    </span>
                    <span className="font-medium text-gray-800">{price} LC</span>
                  </div>
                );
              })}
            </div>
            {selectedSession.default_service_fee > 0 && (
              <div className="flex justify-between text-xs pt-1 border-t border-gray-200">
                <span className="text-gray-600">手续费</span>
                <span className="font-medium text-gray-800">{selectedSession.default_service_fee} LC</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-gray-200">
              <span className="text-sm font-semibold text-gray-700">应付总额</span>
              <span className="text-lg font-bold text-amber-500">{totalPrice} LC</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">支付方式</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('rmb')}
                className={`p-2.5 rounded-xl border-2 text-left transition-all ${
                  paymentMethod === 'rmb' ? 'border-sky-500 bg-sky-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${paymentMethod === 'rmb' ? 'bg-sky-500' : 'bg-gray-200'}`}>
                    <span className="text-white text-xs font-bold">¥</span>
                  </div>
                  <span className={`text-xs font-medium ${paymentMethod === 'rmb' ? 'text-sky-700' : 'text-gray-600'}`}>人民币</span>
                </div>
                <p className="text-[9px] text-gray-400 mt-0.5">操作员验收</p>
              </button>
              <button
                type="button"
                onClick={() => matchedUserId && setPaymentMethod('lcoin')}
                disabled={!matchedUserId}
                className={`p-2.5 rounded-xl border-2 text-left transition-all ${
                  paymentMethod === 'lcoin' ? 'border-amber-500 bg-amber-50' :
                  !matchedUserId ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed' :
                  'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    paymentMethod === 'lcoin' ? 'bg-amber-500' : !matchedUserId ? 'bg-gray-300' : 'bg-amber-100'
                  }`}>
                    <span className={`text-xs font-bold ${paymentMethod === 'lcoin' || !matchedUserId ? 'text-white' : 'text-amber-600'}`}>LC</span>
                  </div>
                  <span className={`text-xs font-medium ${
                    paymentMethod === 'lcoin' ? 'text-amber-700' : !matchedUserId ? 'text-gray-400' : 'text-gray-600'
                  }`}>兰克币</span>
                </div>
                <p className="text-[9px] text-gray-400 mt-0.5">
                  {matchedUserId ? `余额: ${customerBalance}` : '需匹配用户'}
                </p>
              </button>
              <button
                type="button"
                onClick={() => matchedUserId && setPaymentMethod('mixed')}
                disabled={!matchedUserId}
                className={`p-2.5 rounded-xl border-2 text-left transition-all ${
                  paymentMethod === 'mixed' ? 'border-purple-500 bg-purple-50' :
                  !matchedUserId ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed' :
                  'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    paymentMethod === 'mixed' ? 'bg-purple-500' : !matchedUserId ? 'bg-gray-300' : 'bg-purple-100'
                  }`}>
                    <span className={`text-xs font-bold ${paymentMethod === 'mixed' || !matchedUserId ? 'text-white' : 'text-purple-600'}`}>¥+LC</span>
                  </div>
                  <span className={`text-xs font-medium ${
                    paymentMethod === 'mixed' ? 'text-purple-700' : !matchedUserId ? 'text-gray-400' : 'text-gray-600'
                  }`}>混合支付</span>
                </div>
                <p className="text-[9px] text-gray-400 mt-0.5">人民币+兰克币</p>
              </button>
            </div>
          </div>

          {paymentMethod === 'mixed' && matchedUserId && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">应付总额</span>
                <span className="text-sm font-bold text-purple-700">{totalPrice} LC</span>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">人民币支付金额（元）</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">¥</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rmbAmount}
                    onChange={e => setRmbAmount(e.target.value)}
                    className="w-full border border-purple-200 rounded-xl pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs pt-1 border-t border-purple-200">
                <span className="text-gray-600">兰克币支付金额</span>
                <span className="font-medium text-amber-600">
                  {Math.max(0, totalPrice - parseFloat(rmbAmount || '0')).toFixed(2)} LC
                </span>
              </div>
              {customerBalance < totalPrice - parseFloat(rmbAmount || '0') && (
                <p className="text-[10px] text-red-500">余额不足！当前余额 {customerBalance} LC</p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button onClick={handleBookClick} disabled={submitting || !name.trim() || !phone.trim()}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white font-bold py-3.5 rounded-xl text-sm transition-colors">
            {submitting ? '出票中...' : `确认出票 · ${selectedSession.has_seating_chart ? selectedSeatIds.length : entryTicketTypes.length} 张`}
          </button>
        </div>
      )}

      {showBookingNotice && selectedSession?.booking_notice?.trim() && (
        <BookingNoticeModal
          notice={selectedSession.booking_notice}
          onConfirm={() => { setShowBookingNotice(false); setShowPaymentConfirm(true); }}
          onAbort={() => setShowBookingNotice(false)}
        />
      )}

      {showPrintModal && (
        <PrintConfirmModal
          ticketCode={pendingPrint?.ticketCode}
          ticketPrice={selectedSession?.ticket_price}
          defaultServiceFee={selectedSession?.default_service_fee ?? 0}
          onConfirm={handlePrintConfirm}
          onCancel={() => { setShowPrintModal(false); setPendingPrint(null); }}
        />
      )}

      {showPaymentConfirm && selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
                paymentMethod === 'rmb' ? 'bg-sky-100' : paymentMethod === 'lcoin' ? 'bg-amber-100' : 'bg-purple-100'
              }`}>
                <span className={`text-lg font-bold ${paymentMethod === 'rmb' ? 'text-sky-600' : paymentMethod === 'lcoin' ? 'text-amber-600' : 'text-purple-600'}`}>
                  {paymentMethod === 'rmb' ? '¥' : paymentMethod === 'lcoin' ? 'LC' : '¥+LC'}
                </span>
              </div>
              <h3 className="text-lg font-bold text-gray-900">
                {paymentMethod === 'rmb' ? '人民币支付确认' : paymentMethod === 'lcoin' ? '兰克币支付确认' : '混合支付确认'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {paymentMethod === 'rmb' ? '请确认已完成人民币收款' : 
                 paymentMethod === 'lcoin' ? '将从用户账户中扣除兰克币' : '人民币+兰克币混合支付'}
              </p>
            </div>
            
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">活动名称</span>
                <span className="font-medium text-gray-900 truncate max-w-[150px]">{selectedSession.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">票数</span>
                <span className="font-medium text-gray-900">
                  {selectedSession.has_seating_chart ? selectedSeatIds.length : entryTicketTypes.length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">支付方式</span>
                <span className={`font-medium ${paymentMethod === 'rmb' ? 'text-sky-600' : paymentMethod === 'lcoin' ? 'text-amber-600' : 'text-purple-600'}`}>
                  {paymentMethod === 'rmb' ? '人民币' : paymentMethod === 'lcoin' ? '兰克币' : '混合支付'}
                </span>
              </div>
              {paymentMethod === 'mixed' && (
                <>
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-gray-600">人民币支付</span>
                    <span className="font-medium text-sky-600">¥{parseFloat(rmbAmount || '0').toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">兰克币支付</span>
                    <span className="font-medium text-amber-600">{Math.max(0, totalPrice - parseFloat(rmbAmount || '0')).toFixed(2)} LC</span>
                  </div>
                </>
              )}
              <div className="border-t border-gray-200 pt-2 flex justify-between">
                <span className="text-gray-600">应付总额</span>
                <span className={`text-xl font-bold ${paymentMethod === 'rmb' ? 'text-sky-500' : paymentMethod === 'lcoin' ? 'text-amber-500' : 'text-purple-500'}`}>
                  {totalPrice} LC
                </span>
              </div>
              {(paymentMethod === 'lcoin' || paymentMethod === 'mixed') && matchedUserId && (
                <div className="text-xs text-gray-400 pt-1">
                  当前余额: {customerBalance} LC
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
                className={`flex-1 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  paymentMethod === 'rmb'
                    ? 'bg-gradient-to-r from-sky-500 to-sky-400 text-white hover:from-sky-400 hover:to-sky-300'
                    : 'bg-gradient-to-r from-amber-500 to-amber-400 text-white hover:from-amber-400 hover:to-amber-300'
                }`}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {paymentMethod === 'rmb' ? '出票中...' : '支付中...'}
                  </span>
                ) : (
                  paymentMethod === 'rmb' ? '确认收款并出票' : '确认支付'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

