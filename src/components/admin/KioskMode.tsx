import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, formatSeatName } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  Scan, Delete, LogOut, RefreshCcw,
} from 'lucide-react';

type KioskStatus = 'idle' | 'scanning' | 'success' | 'failed';

type ScanInfo = {
  name?: string;
  session?: string;
  seat?: string;
  ticket_type?: 'adult' | 'child' | 'concession';
  message: string;
  failTone?: 'red' | 'amber';
};

type Props = {
  exitPassword: string;
  onExit: () => void;
};

async function stopScanner(scanner: any) {
  if (!scanner) return;
  try { if (scanner.getRunningState?.() === 2) await scanner.stop(); } catch {}
  try { scanner.clear(); } catch {}
}

export default function KioskMode({ exitPassword, onExit }: Props) {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const { user } = useAuth();
  const [status, setStatus] = useState<KioskStatus>('idle');
  const [scanInfo, setScanInfo] = useState<ScanInfo>({ message: '' });
  const [scannerKey, setScannerKey] = useState(0);

  const [showExitModal, setShowExitModal] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);

  const scannerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const verifyingRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const mountedRef = useRef(true);

  // ── Wake lock ──────────────────────────────────────────────────────────────
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLockRef.current = await (navigator as any).wakeLock.request('screen'); } catch {}
  }

  function releaseWakeLock() {
    try { wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    requestWakeLock();
    const onVisibility = () => { if (document.visibilityState === 'visible') requestWakeLock(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      releaseWakeLock();
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  function scheduleReset(delay = 3000) {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      verifyingRef.current = false;
      setStatus('idle');
      setScannerKey(k => k + 1);
    }, delay);
  }

  // ── Ticket validation ──────────────────────────────────────────────────────
  const validateTicket = useCallback(async (code: string) => {
    if (verifyingRef.current) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    verifyingRef.current = true;

    if (scannerRef.current) {
      await stopScanner(scannerRef.current);
      scannerRef.current = null;
    }
    if (!mountedRef.current) { verifyingRef.current = false; return; }
    setStatus('scanning');

    try {
      const { data: reg, error } = await supabase
        .from('registrations')
        .select('*, sessions(name, session_date, start_time, end_time, verification_start, verification_end, verify_date), seats(seat_name)')
        .eq('ticket_code', trimmed)
        .maybeSingle();

      if (!mountedRef.current) return;

      if (error || !reg) {
        setScanInfo({ message: '无效票', failTone: 'red' });
        setStatus('failed'); scheduleReset(); return;
      }
      if (reg.status === 'used') {
        setScanInfo({ message: '此码已核销', failTone: 'amber' });
        setStatus('failed'); scheduleReset(); return;
      }
      if (reg.status === 'cancelled') {
        setScanInfo({ message: '此码已取消', failTone: 'red' });
        setStatus('failed'); scheduleReset(); return;
      }
      if (reg.status === 'expired') {
        setScanInfo({ message: '此码已过期', failTone: 'amber' });
        setStatus('failed'); scheduleReset(); return;
      }

      const session = reg.sessions as any;
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Check verify_date if it's set
      if (session?.verify_date) {
        let verifyDate = today;
        if (session.verify_date instanceof Date) {
          verifyDate = session.verify_date.toISOString().slice(0, 10);
        } else {
          const strDate = String(session.verify_date);
          const parsed = new Date(strDate);
          if (!isNaN(parsed.getTime())) {
            verifyDate = parsed.toISOString().slice(0, 10);
          } else {
            verifyDate = strDate.slice(0, 10);
          }
        }

        if (today !== verifyDate) {
          const dateMsg = today < verifyDate ? `未到核销日期 (${verifyDate})` : '该场次核销日期已过';
          setScanInfo({ message: dateMsg, failTone: today < verifyDate ? 'amber' : 'red' });
          setStatus('failed'); scheduleReset(); return;
        }
      }

      // Check verification_start time if it's set
      if (session?.verification_start) {
        const verStart = session.verification_start.slice(0, 5);
        if (hhmm < verStart) {
          setScanInfo({ message: `未到核销时间 (${verStart})`, failTone: 'amber' });
          setStatus('failed'); scheduleReset(); return;
        }
      }

      // Check verification_end time if it's set
      if (session?.verification_end) {
        const verEnd = session.verification_end.slice(0, 5);
        if (hhmm > verEnd) {
          setScanInfo({ message: `核销时间已过 (${verEnd})`, failTone: 'red' });
          setStatus('failed'); scheduleReset(); return;
        }
      }

      await supabase.from('registrations').update({
        status: 'used',
        validated_at: new Date().toISOString(),
        validated_by: user?.id,
      }).eq('id', reg.id);
      await supabase.from('validation_logs').insert({
        ticket_code: trimmed, registration_id: reg.id, admin_id: user?.id,
      });

      if (!mountedRef.current) return;
      const s = reg.sessions as any;
      const sessionLabel = s
        ? `${s.name} · ${s.session_date} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`
        : '';
      setScanInfo({
        name: reg.name,
        session: sessionLabel,
        seat: (reg as any).seats?.seat_name ? formatSeatName((reg as any).seats.seat_name, isEn) : undefined,
        ticket_type: reg.ticket_type,
        message: '核销成功',
      });
      setStatus('success');
      scheduleReset(3500);
    } catch {
      if (!mountedRef.current) return;
      setScanInfo({ message: '系统错误，请重试', failTone: 'red' });
      setStatus('failed'); scheduleReset();
    }
  }, [user]);

  // ── Scanner lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'idle') return;
    let disposed = false;
    let html5QrCode: any;

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (disposed) return;
        const el = document.getElementById('kiosk-qr-reader');
        if (el) el.innerHTML = '';
        html5QrCode = new Html5Qrcode('kiosk-qr-reader');
        scannerRef.current = html5QrCode;

        const config = { fps: 15, qrbox: { width: 220, height: 220 }, experimentalFeatures: { useBarCodeDetectorIfSupported: false } };
        try {
          await html5QrCode.start({ facingMode: 'user' }, config,
            (text: string) => { if (!disposed) validateTicket(text); }, undefined);
        } catch {
          if (disposed) return;
          await html5QrCode.start({ facingMode: 'environment' }, config,
            (text: string) => { if (!disposed) validateTicket(text); }, undefined);
        }

        if (disposed) {
          await stopScanner(html5QrCode);
          streamRef.current?.getTracks().forEach(t => t.stop());
          streamRef.current = null;
          scannerRef.current = null;
          return;
        }
        const videoEl = document.querySelector<HTMLVideoElement>('#kiosk-qr-reader video');
        if (videoEl?.srcObject) {
          streamRef.current = videoEl.srcObject as MediaStream;
          // Request continuous autofocus at minimum focal distance
          const track = streamRef.current.getVideoTracks()[0];
          if (track) {
            const caps = (track as any).getCapabilities?.() as Record<string, any> | undefined;
            const constraints: Record<string, any> = { focusMode: 'continuous' };
            if (caps?.focusDistance?.min !== undefined) {
              constraints.focusMode = 'manual';
              constraints.focusDistance = caps.focusDistance.min;
            }
            try { await (track as any).applyConstraints({ advanced: [constraints] }); } catch {}
          }
        }
      } catch (e) {
        console.error('Kiosk camera error:', e);
      }
    }

    startScanner();
    return () => {
      disposed = true;
      stopScanner(html5QrCode);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      scannerRef.current = null;
    };
  }, [status, scannerKey, validateTicket]);

  // ── Exit PIN ───────────────────────────────────────────────────────────────
  function openExitModal() { setPin(''); setPinError(false); setShowExitModal(true); }

  function appendDigit(d: string) {
    if (pin.length >= 8) return;
    const next = pin + d;
    setPin(next);
    if (next.length === exitPassword.length) setTimeout(() => submitPin(next), 150);
  }

  function submitPin(value: string) {
    if (value === exitPassword) { setShowExitModal(false); onExit(); }
    else { setPinError(true); setPin(''); }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function failedEnglish(msg: string): string {
    if (msg.includes('核销')) return 'Already Used';
    if (msg.includes('过期')) return 'Ticket Expired';
    if (msg.includes('取消')) return 'Ticket Cancelled';
    if (msg.includes('无效')) return 'Invalid Ticket';
    if (msg.includes('未到')) return 'Not Open Yet';
    if (msg.includes('时间已过')) return 'Window Closed';
    if (msg.includes('系统')) return 'System Error';
    return 'Verification Failed';
  }

  function manualContinue() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    verifyingRef.current = false;
    setStatus('idle');
    setScannerKey(k => k + 1);
  }

  const cardBg =
    status === 'idle'     ? 'bg-amber-400' :
    status === 'scanning' ? 'bg-sky-500' :
    status === 'success'  ? 'bg-emerald-500' :
    scanInfo.failTone === 'amber' ? 'bg-orange-400' : 'bg-red-500';

  const chineseLabel =
    status === 'idle'     ? '欢迎光临' :
    status === 'scanning' ? '识别中' :
    status === 'success'  ? '核销成功' :
    scanInfo.failTone === 'amber' ? '请注意' : '无效票券';

  const chineseSub =
    status === 'idle'     ? '请出示券码' :
    status === 'scanning' ? '请稍候...' :
    status === 'success'  ? (scanInfo.name || '请进') :
    scanInfo.message;

  const englishLabel =
    status === 'idle'     ? 'SCAN HERE' :
    status === 'scanning' ? 'SCANNING...' :
    status === 'success'  ? 'SUCCESS' :
    failedEnglish(scanInfo.message).toUpperCase();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-gray-100 flex flex-col overflow-hidden select-none">

      {/* ════════════════════════════════════════════════════════════════════
          TOP STATUS AREA — flex: 2 (~65% of screen height)
      ════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col px-3 pt-3 pb-2" style={{ flex: 2 }}>
        <div className={`${cardBg} flex-1 rounded-3xl flex flex-col items-center justify-center px-8 relative transition-colors duration-300 overflow-hidden`}>

          {/* Exit button — absolute, top-left */}
          <button
            onClick={openExitModal}
            className="absolute top-4 left-4 p-2.5 rounded-2xl bg-white/20 hover:bg-white/30 active:bg-white/40 transition-colors"
          >
            <LogOut size={16} className="text-white/80" />
          </button>

          {/* Icon — slightly smaller for breathing room */}
          <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mb-7">
            {status === 'idle'     && <Scan size={30} className="text-white" />}
            {status === 'scanning' && <Loader2 size={30} className="text-white animate-spin" />}
            {status === 'success'  && <CheckCircle2 size={30} className="text-white" />}
            {status === 'failed'   && (
              scanInfo.failTone === 'amber'
                ? <AlertTriangle size={30} className="text-white" />
                : <XCircle size={30} className="text-white" />
            )}
          </div>

          {/* Chinese primary — bold, large, 4 chars max per line */}
          <p className="font-black text-white text-center leading-none"
            style={{ fontSize: '3rem' }}>
            {chineseLabel}
          </p>

          {/* Chinese sub — short phrase below */}
          <p className="font-medium text-white/80 text-center mt-3 leading-snug"
            style={{ fontSize: '1.1rem' }}>
            {chineseSub}
          </p>

          {/* English — refined, spaced, below */}
          <p className="en-font font-semibold text-white/50 text-center mt-4 tracking-[0.22em]"
            style={{ fontSize: '0.75rem' }}>
            {englishLabel}
          </p>

          {/* Success extras */}
          {status === 'success' && scanInfo.seat && (
            <div className="mt-4 bg-white/25 rounded-2xl px-6 py-3 text-center">
              <p className="text-white/70 text-xs mb-0.5">座位</p>
              <p className="text-white font-black text-2xl leading-none">{scanInfo.seat}</p>
            </div>
          )}
          {status === 'success' && scanInfo.ticket_type && (
            <div className="mt-2 bg-purple-500/30 rounded-xl px-4 py-1.5 text-center">
              <span className="text-white/90 text-sm font-semibold">
                {scanInfo.ticket_type === 'adult' ? '成人票' : scanInfo.ticket_type === 'child' ? '儿童票' : '优待票'}
              </span>
            </div>
          )}
          {status === 'success' && scanInfo.session && (
            <p className="text-white/50 text-center mt-2 text-sm">{scanInfo.session}</p>
          )}

          {/* Continue pill — failed only */}
          {status === 'failed' && (
            <button
              onClick={manualContinue}
              className="mt-7 bg-white/90 hover:bg-white text-gray-800 font-semibold px-8 py-3 rounded-full text-base transition-colors flex items-center gap-2 active:scale-[0.97] shadow-sm"
            >
              <RefreshCcw size={15} />
              重新扫码
            </button>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          BOTTOM CAMERA AREA — flex: 1 (~35% of screen height)
          Square camera, height-constrained, centered.
      ════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-center px-3 pb-3 pt-2" style={{ flex: 1, minHeight: 0 }}>
        {/*
          height: 100% derives from the flex:1 parent (definite height).
          aspect-ratio: 1/1 sets width = height for a perfect square.
          max-width: 100% prevents overflow on narrow screens.
        */}
        <div
          className="relative rounded-2xl overflow-hidden bg-black"
          style={{ height: '100%', aspectRatio: '1 / 1', maxWidth: '100%' }}
        >
          {/* html5-qrcode renders here */}
          <div id="kiosk-qr-reader" className="absolute inset-0 kiosk-video" style={{ transform: 'scaleX(-1)' }} />

          {/* Corner brackets (idle) */}
          {status === 'idle' && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-4 left-4 w-7 h-7 border-t-[3px] border-l-[3px] border-white/80 rounded-tl-lg" />
              <div className="absolute top-4 right-4 w-7 h-7 border-t-[3px] border-r-[3px] border-white/80 rounded-tr-lg" />
              <div className="absolute bottom-4 left-4 w-7 h-7 border-b-[3px] border-l-[3px] border-white/80 rounded-bl-lg" />
              <div className="absolute bottom-4 right-4 w-7 h-7 border-b-[3px] border-r-[3px] border-white/80 rounded-br-lg" />
              <div className="kiosk-scan-line absolute left-5 right-5 h-px bg-white/60 rounded-full shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
            </div>
          )}

          {/* Scanning overlay */}
          {status === 'scanning' && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <Loader2 size={32} className="text-white/50 animate-spin" />
            </div>
          )}

          {/* Success flash */}
          {status === 'success' && (
            <div className="absolute inset-0 border-[3px] border-emerald-400 rounded-2xl kiosk-result-flash" />
          )}

          {/* Failed flash */}
          {status === 'failed' && (
            <div className={`absolute inset-0 border-[3px] rounded-2xl kiosk-result-flash ${
              scanInfo.failTone === 'amber' ? 'border-orange-400' : 'border-red-500'
            }`} />
          )}
        </div>
      </div>

      {/* ── Exit PIN modal ────────────────────────────────────────────────── */}
      {showExitModal && (
        <div className="absolute inset-0 z-[60] flex items-end bg-black/50">
          <div className="bg-white rounded-t-3xl w-full p-6 pb-8 shadow-2xl">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
            <h3 className="text-center font-bold text-gray-900 text-lg mb-1">退出自助模式</h3>
            <p className="text-center text-gray-500 text-sm mb-6">请输入退出密码</p>

            <div className="flex justify-center gap-2.5 mb-2">
              {Array.from({ length: exitPassword.length }).map((_, i) => (
                <div
                  key={i}
                  className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center transition-all ${
                    i < pin.length
                      ? pinError ? 'border-red-400 bg-red-50' : 'border-sky-400 bg-sky-50'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  {i < pin.length && (
                    <div className={`w-3 h-3 rounded-full ${pinError ? 'bg-red-400' : 'bg-sky-500'}`} />
                  )}
                </div>
              ))}
            </div>
            {pinError && <p className="text-center text-red-500 text-sm mb-4">密码错误，请重试</p>}
            {!pinError && <div className="mb-4" />}

            <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto">
              {['1','2','3','4','5','6','7','8','9'].map(d => (
                <button key={d} onClick={() => appendDigit(d)}
                  className="h-14 rounded-2xl bg-gray-100 text-gray-900 font-semibold text-2xl active:bg-gray-200 transition-colors">
                  {d}
                </button>
              ))}
              <button onClick={() => { setPin(''); setPinError(false); setShowExitModal(false); }}
                className="h-14 rounded-2xl bg-gray-100 text-gray-500 text-sm font-medium active:bg-gray-200 transition-colors">
                取消
              </button>
              <button onClick={() => appendDigit('0')}
                className="h-14 rounded-2xl bg-gray-100 text-gray-900 font-semibold text-2xl active:bg-gray-200 transition-colors">
                0
              </button>
              <button onClick={() => { setPinError(false); setPin(p => p.slice(0, -1)); }}
                className="h-14 rounded-2xl bg-gray-100 text-gray-500 active:bg-gray-200 transition-colors flex items-center justify-center">
                <Delete size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
