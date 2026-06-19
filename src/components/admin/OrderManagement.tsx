import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, callEdgeFunction, uploadImageViaFunction, Registration, Session, SeatMapRow, TicketType, TICKET_TYPE_LABELS, getDisplayStatus } from '../../lib/supabase';
import { validateRemark, truncateRemark } from '../../lib/remarkValidator';
import { useAuth } from '../../contexts/AuthContext';
import { Plus, Trash2, Calendar, Users, Clock, Filter, Search, X, CheckCircle, AlertCircle, Edit3, ArrowLeft, Image, LayoutGrid, Ban, RefreshCw, Printer, Ticket, AlertTriangle } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';
import PrintConfirmModal, { PrintConfirmResult } from './PrintConfirmModal';
import ReprintConfirmModal from './ReprintConfirmModal';
import SessionDetailView from './SessionDetailView';
import SeatMap from '../SeatMap';
import AdminSeatPreview from './AdminSeatPreview';

type TabMode = 'registrations' | 'sessions';

export default function OrderManagement() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabMode>('registrations');

  return (
    <div className="p-4 space-y-4">
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => setTab('registrations')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'registrations' ? 'bg-white shadow text-sky-600' : 'text-gray-500'}`}
        >
          {t('registrations')}
        </button>
        <button
          onClick={() => setTab('sessions')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'sessions' ? 'bg-white shadow text-sky-600' : 'text-gray-500'}`}
        >
          {t('session_management')}
        </button>
      </div>
      {tab === 'registrations' ? <RegistrationsList /> : <SessionsManager />}
    </div>
  );
}

function checkVerifyTimeWindow(reg: Registration): 'before' | 'within' | 'past' | 'no_window' {
  const s = reg.sessions as any;
  if (!s?.verification_start || !s?.verification_end) return 'no_window';
  const now = new Date();
  const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const start = (s.verification_start as string).slice(0, 5);
  const end = (s.verification_end as string).slice(0, 5);
  if (cur < start) return 'before';
  if (cur > end) return 'past';
  return 'within';
}

function RegistrationsList() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const { user, profile } = useAuth();
  const [regs, setRegs] = useState<Registration[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filter, setFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [verifyConfirm, setVerifyConfirm] = useState<Registration | null>(null);
  const [detail, setDetail] = useState<Registration | null>(null);
  const [detailProfile, setDetailProfile] = useState<{ display_name: string | null; phone: string | null } | null>(null);
  const [noteEditing, setNoteEditing] = useState(false);
  const [adminNoteContent, setAdminNoteContent] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [rescheduleReg, setRescheduleReg] = useState<Registration | null>(null);
  const [rescheduleConfirm, setRescheduleConfirm] = useState<Registration | null>(null);
  const [printingReg, setPrintingReg] = useState<Registration | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [pendingPrintReg, setPendingPrintReg] = useState<Registration | null>(null);
  const [showReprintConfirm, setShowReprintConfirm] = useState(false);
  const [reprintCountForConfirm, setReprintCountForConfirm] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const printCanvasRef = useRef<HTMLCanvasElement>(null);
  const printQrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!detail?.user_id) { setDetailProfile(null); return; }
    supabase
      .from('user_profiles')
      .select('display_name, phone')
      .eq('id', detail.user_id)
      .maybeSingle()
      .then(({ data }) => setDetailProfile(data));
  }, [detail]);

  async function fetchData() {
    // Replace Edge Function call with direct RPC
    try {
      await supabase.rpc('expire_past_tickets');
      await supabase.rpc('auto_manage_session_status');
    } catch { /* ignore */ }
    const [regsRes, sessRes] = await Promise.all([
      supabase
        .from('registrations')
        .select('*, sessions(name, session_date, start_time, end_time, verification_start, verification_end, ticket_price, default_service_fee), seats(seat_name)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('sessions').select('*').order('session_date'),
    ]);
    setRegs(regsRes.data ?? []);
    setSessions(sessRes.data ?? []);
  }

  async function handleManualRefresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function requestPrint(reg: Registration) {
    const reprintCount = (reg as any).reprint_count ?? 0;
    const nextCount = reprintCount + 1;
    if (nextCount >= 2) {
      setPendingPrintReg(reg);
      setReprintCountForConfirm(nextCount);
      setShowReprintConfirm(true);
    } else {
      setPendingPrintReg(reg);
      setShowPrintModal(true);
    }
  }

  function handleReprintConfirm() {
    setShowReprintConfirm(false);
    setShowPrintModal(true);
  }

  function handleReprintCancel() {
    setShowReprintConfirm(false);
    setPendingPrintReg(null);
  }

  async function handlePrintConfirm(result: PrintConfirmResult) {
    // 票面生成功能已禁用
    setShowPrintModal(false);
    setPrintingReg(null);
    return;
  }

  async function cancelReg(id: string) {
    const { data, error } = await supabase.rpc('cancel_ticket', {
      p_registration_id: id,
      p_user_id: null,
    });
    if (error || (data as any)?.success === false) {
      showToast(t('operation_failed'), 'error');
    } else {
      showToast(t('cancel_success'));
    }
    setConfirm(null);
    fetchData();
  }

  async function adminDeleteReg(id: string) {
    const { data, error } = await supabase.rpc('admin_delete_registration', {
      p_registration_id: id,
      p_note: 'Manual delete by admin',
    });
    if (error || (data as any)?.success === false) {
      showToast(t('operation_failed'), 'error');
    } else {
      showToast(t('delete_success'));
      setDetail(null);
    }
    setConfirmDelete(null);
    fetchData();
  }

  function handleVerifyClick(reg: Registration) {
    const window = checkVerifyTimeWindow(reg);
    if (window === 'before') {
      showToast(t('verification_not_open', { start: (reg.sessions as any)?.verification_start?.slice(0, 5) }), 'error');
    } else if (window === 'past') {
      showToast(t('verification_expired'), 'error');
    } else {
      setVerifyConfirm(reg);
    }
  }

  async function doVerify(reg: Registration, newStatus: 'used' | 'expired') {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('registrations')
      .update({ status: newStatus, validated_at: now, validated_by: user?.id ?? null })
      .eq('id', reg.id)
      .eq('status', 'active');
    if (error) {
      showToast(t('operation_failed'), 'error');
    } else {
      if (newStatus === 'used') {
        await supabase.from('validation_logs').insert({
          registration_id: reg.id,
          ticket_code: reg.ticket_code,
          admin_id: user?.id ?? null,
          scanned_at: now,
        });
        showToast(t('verify_done'));
      } else {
        showToast(t('status_expired'));
      }
      setDetail(prev => prev?.id === reg.id ? { ...prev, status: newStatus, validated_at: now } : prev);
      fetchData();
    }
  }

  const filtered = regs.filter(r => {
    const matchSearch = !filter || r.name.includes(filter) || r.phone.includes(filter) || r.ticket_code.includes(filter.toUpperCase());
    const matchSession = !sessionFilter || r.session_id === sessionFilter;
    return matchSearch && matchSession;
  });

  const statusColors: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    used: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-100 text-red-600',
    expired: 'bg-amber-100 text-amber-600',
  };

  const statusLabels: Record<string, string> = {
    active: t('status_active'),
    used: t('status_used'),
    cancelled: t('status_cancelled'),
    expired: t('status_expired'),
  };

  function renderRegCard(r: Registration) {
    const s = r.sessions as any;
    const sessionLabel = s ? `${s.name} · ${s.session_date} ${s.start_time?.slice(0, 5)}` : '-';
    // Check if this registration has an unread note
    const hasUnreadNote = r.note_content && !r.is_note_read;
    return (
      <div
        key={r.id}
        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 cursor-pointer hover:border-sky-200 transition-all active:scale-[0.99]"
        onClick={() => {
          setDetail(r);
          // Mark note as read when viewing detail
          if (r.note_content && !r.is_note_read) {
            supabase.from('registrations').update({ is_note_read: true }).eq('id', r.id).then(() => {
              setRegs(prev => prev.map(reg => reg.id === r.id ? { ...reg, is_note_read: true } : reg));
            });
          }
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div>
            <span className="font-semibold text-gray-900 text-sm">{r.name}</span>
            <span className="text-gray-400 text-xs ml-2">{r.phone}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {hasUnreadNote && (
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="有未读备注" />
            )}
            {r.is_supplementary && (
              <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full font-semibold">补票</span>
            )}
            {(r.reprint_count ?? 0) > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold">补打{r.reprint_count}次</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[getDisplayStatus(r)]}`}>
              {statusLabels[getDisplayStatus(r)]}
            </span>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-1">
          <span className="font-mono bg-gray-50 px-1.5 py-0.5 rounded">{r.ticket_code}</span>
          <span className="ml-2">{sessionLabel}</span>
          {(r as any).seats?.seat_name && (
            <span className="ml-2 font-medium text-sky-600">{(r as any).seats.seat_name}</span>
          )}
          {r.ticket_type && (
            <span className={`ml-2 font-medium ${TICKET_TYPE_LABELS[r.ticket_type as TicketType].color}`}>
              · {TICKET_TYPE_LABELS[r.ticket_type as TicketType].cn}
            </span>
          )}
        </p>
        <div className="flex items-center justify-between mt-2" onClick={e => e.stopPropagation()}>
          <p className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString()}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => requestPrint(r)}
              disabled={printingReg?.id === r.id}
              className="flex items-center gap-1 text-xs text-sky-600 border border-sky-200 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors disabled:opacity-50"
            >
              <Printer size={12} /> {printingReg?.id === r.id ? '生成中…' : '打印票面'}
            </button>
            {r.status === 'active' && r.seat_id && (
              <button
                onClick={() => {
                  if (r.reschedule_count >= 1) setRescheduleConfirm(r);
                  else setRescheduleReg(r);
                }}
                className={`flex items-center gap-1 text-xs border px-2.5 py-1.5 rounded-lg transition-colors ${r.reschedule_count >= 1 ? 'text-amber-600 border-amber-200 hover:bg-amber-50' : 'text-teal-600 border-teal-200 hover:bg-teal-50'}`}
              >
                <RefreshCw size={11} /> 换座{r.reschedule_count >= 1 ? `(${r.reschedule_count}次)` : ''}
              </button>
            )}
            {r.status === 'active' && (
              <button
                onClick={() => handleVerifyClick(r)}
                className="flex items-center gap-1 text-xs text-emerald-600 border border-emerald-200 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
              >
                <CheckCircle size={12} /> {t('verify')}
              </button>
            )}
            {r.status === 'active' && (
              <button
                onClick={() => setConfirm(r.id)}
                className="flex items-center gap-1 text-xs text-red-500 border border-red-200 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={12} /> {t('cancel_reg')}
              </button>
            )}
            {r.status !== 'active' && (
              <button
                onClick={() => setConfirmDelete(r.id)}
                className="flex items-center gap-1 text-xs text-gray-400 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
              >
                <Trash2 size={12} /> {t('delete')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hidden print canvas + QR */}
      <canvas ref={printCanvasRef} className="hidden" />
      <div ref={printQrRef} className="hidden" aria-hidden="true">
        {printingReg && <QRCodeCanvas value={printingReg.ticket_code} size={240} level="H" />}
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {rescheduleReg && (
        <AdminRescheduleModal
          reg={rescheduleReg}
          onClose={() => setRescheduleReg(null)}
          onSuccess={() => { setRescheduleReg(null); showToast('换座成功'); fetchData(); }}
        />
      )}
      {rescheduleConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={20} className="text-amber-500 flex-shrink-0" />
              <h3 className="font-bold text-gray-900 text-base">多次换座提醒</h3>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              该订单已换座 <strong>{rescheduleConfirm.reschedule_count}</strong> 次，继续换座可能影响座位管理。
            </p>
            <p className="text-sm text-gray-500 mb-5">确定要再次为该订单更换座位吗？</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setRescheduleReg(rescheduleConfirm); setRescheduleConfirm(null); }}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                确认继续换座
              </button>
              <button
                onClick={() => setRescheduleConfirm(null)}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm transition-colors hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={t('cancel_reg')}
          message={t('confirm_cancel_booking')}
          onConfirm={() => cancelReg(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t('confirm_delete')}
          message="确定要删除此订单记录吗？操作将被记录至审计日志，且无法撤销。"
          onConfirm={() => adminDeleteReg(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {verifyConfirm && (
        <ConfirmDialog
          title={t('quick_verify')}
          message={t('confirm_verify')}
          onConfirm={() => { doVerify(verifyConfirm, 'used'); setVerifyConfirm(null); }}
          onCancel={() => setVerifyConfirm(null)}
        />
      )}

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('search_placeholder')}
          className="w-full border border-gray-200 rounded-xl py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
      </div>

      <div className="relative">
        <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <select
          value={sessionFilter}
          onChange={e => setSessionFilter(e.target.value)}
          className="w-full border border-gray-200 rounded-xl py-2.5 pl-9 pr-8 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400 appearance-none bg-white"
        >
          <option value="">{t('all')}</option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.name} · {s.session_date}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{t('total_registrations', { count: filtered.length })}</p>
        <button
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 text-xs text-sky-600 border border-sky-200 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '刷新中...' : '刷新'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">{t('no_data')}</div>
      ) : (() => {
        const activeRegs = filtered.filter(r => getDisplayStatus(r) === 'active');
        const historicalRegs = filtered.filter(r => getDisplayStatus(r) !== 'active');

        // Group active by session date
        const activeByDate = new Map<string, Registration[]>();
        activeRegs.forEach(r => {
          const s = r.sessions as any;
          const dateKey = s?.session_date ?? '未知日期';
          const list = activeByDate.get(dateKey) ?? [];
          list.push(r);
          activeByDate.set(dateKey, list);
        });

        // Sort historical by operation time desc
        const sortedHistorical = [...historicalRegs].sort((a, b) => {
          const ta = a.validated_at || a.deleted_at || a.created_at;
          const tb = b.validated_at || b.deleted_at || b.created_at;
          return tb.localeCompare(ta);
        });

        return (
          <div className="space-y-4">
            {/* Active section grouped by session date */}
            {activeRegs.length > 0 && (
              <div className="space-y-3">
                {Array.from(activeByDate.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([dateKey, dateRegs]) => (
                    <div key={dateKey}>
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar size={13} className="text-sky-500" />
                        <span className="text-xs font-semibold text-gray-600">{dateKey}</span>
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{dateRegs.length} 张</span>
                      </div>
                      <div className="space-y-2">
                        {dateRegs.map(r => renderRegCard(r))}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Historical section — collapsible */}
            {sortedHistorical.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <button
                  onClick={() => setHistoryExpanded(v => !v)}
                  className="w-full flex items-center justify-between py-2 px-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-gray-400" />
                    <span className="text-xs font-semibold text-gray-500">{isEn ? 'Historical' : '历史记录'}</span>
                    <span className="text-[10px] text-gray-400 bg-white px-1.5 py-0.5 rounded-full">{sortedHistorical.length}</span>
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {historyExpanded && (
                  <div className="space-y-2 mt-2">
                    {sortedHistorical.map(r => renderRegCard(r))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setDetail(null)}>
          <div
            className="bg-white rounded-t-3xl w-full max-w-lg p-5 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-base">{t('order_detail')}</h3>
              <button onClick={() => setDetail(null)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={18} /></button>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-lg text-gray-900 tracking-widest">{detail.ticket_code}</span>
              <div className="flex items-center gap-2">
                {detail.is_supplementary && (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-orange-100 text-orange-700">补票</span>
                )}
                {detail.print_count > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">已打印 {detail.print_count} 次</span>
                )}
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[getDisplayStatus(detail)]}`}>
                  {statusLabels[getDisplayStatus(detail)]}
                </span>
              </div>
            </div>

            <div className="space-y-2.5 border-t border-gray-100 pt-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('name')}</span>
                <span className="font-medium text-gray-900">{detail.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('phone')}</span>
                <span className="font-medium text-gray-900">{detail.phone}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('user_account')}</span>
                <span className="font-medium text-gray-900 text-right">
                  {detail.is_admin_generated && !detail.user_id
                    ? '前台售票'
                    : detail.is_admin_generated && detail.user_id
                      ? (detailProfile?.display_name || detailProfile?.phone || '已关联账号') + '（前台录入）'
                      : detail.user_id
                        ? (detailProfile?.display_name || detailProfile?.phone || '已注册用户')
                        : '管理员代买'
                  }
                </span>
              </div>
              {detailProfile?.phone && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t('account_phone')}</span>
                  <span className="font-medium text-gray-900">{detailProfile.phone}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('registered_at')}</span>
                <span className="font-medium text-gray-900">{new Date(detail.created_at).toLocaleString()}</span>
              </div>
              {(() => {
                const s = detail.sessions as any;
                const seat = (detail as any).seats;
                return s ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{t('reg_session')}</span>
                      <span className="font-medium text-gray-900 text-right max-w-[60%]">{s.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">{t('session_date')}</span>
                      <span className="font-medium text-gray-900">{s.session_date} {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}</span>
                    </div>
                    {seat?.seat_name && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">座位</span>
                        <span className="font-bold text-sky-600">{seat.seat_name}</span>
                      </div>
                    )}
                    {detail.ticket_type && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500 flex items-center gap-1"><Ticket size={12} /> 票种</span>
                        <span className={`font-medium ${TICKET_TYPE_LABELS[detail.ticket_type as TicketType].color}`}>
                          {TICKET_TYPE_LABELS[detail.ticket_type as TicketType].cn}
                        </span>
                      </div>
                    )}
                  </>
                ) : null;
              })()}
              {detail.validated_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t('validated_at')}</span>
                  <span className="font-medium text-gray-900">{new Date(detail.validated_at).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Note Section */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">订单备注</h4>
                <div className="flex items-center gap-2">
                  {detail.note_content && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${detail.note_status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {detail.note_status === 'completed' ? '已完成' : '待处理'}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">限制：中文30字 / 英文20词(120字符)</span>
                </div>
              </div>
              {detail.note_content ? (
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{detail.note_content}</p>
                      {(() => {
                        const validation = validateRemark(detail.note_content, 'zh');
                        if (!validation.valid) {
                          return (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-600">
                              <AlertTriangle size={10} />
                              <span>该备注超出常规长度（限制：中文30字/英文20词）</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      <p className="text-[10px] text-gray-400 mt-1">
                        来自：{detail.note_author === 'user' ? '用户' : '管理员'}
                      </p>
                    </div>
                    {!noteEditing && (
                      <button
                        onClick={() => {
                          setNoteEditing(true);
                          setAdminNoteContent(detail.note_content || '');
                        }}
                        className="text-xs text-sky-600 hover:text-sky-500"
                      >
                        {detail.note_author === 'admin' ? '查看' : '补充'}
                      </button>
                    )}
                  </div>
                  {noteEditing && detail.note_author === 'admin' && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500">管理员备注不可修改</p>
                      <button onClick={() => setNoteEditing(false)} className="mt-1 text-xs text-sky-600">关闭</button>
                    </div>
                  )}
                  {noteEditing && detail.note_author === 'user' && (
                    <div className="mt-2 pt-2 border-t border-gray-200 space-y-2">
                      <textarea
                        value={adminNoteContent}
                        onChange={e => {
                          const newValue = e.target.value;
                          setAdminNoteContent(newValue);
                          const validation = validateRemark(newValue, 'zh');
                          if (!validation.valid) {
                            showToast(validation.message, 'error');
                          }
                        }}
                        placeholder="补充管理员备注..."
                        rows={2}
                        maxLength={120}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
                      />
                      <p className="text-[10px] text-gray-400 mt-1">限制：中文30字 / 英文20词(120字符)</p>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const validation = validateRemark(adminNoteContent, 'zh');
                            if (!validation.valid) {
                              showToast(validation.message, 'error');
                              return;
                            }
                            const { error } = await supabase.from('registrations').update({
                              note_content: (detail.note_content || '') + '\n[管理员补充] ' + adminNoteContent,
                              note_author: 'admin',
                              is_note_read: true,
                            }).eq('id', detail.id);
                            if (!error) {
                              setDetail({ ...detail, note_content: (detail.note_content || '') + '\n[管理员补充] ' + adminNoteContent, note_author: 'admin' });
                              showToast('备注已补充');
                              setNoteEditing(false);
                              fetchData();
                            }
                          }}
                          className="flex-1 bg-sky-500 hover:bg-sky-400 text-white py-2 rounded-lg text-xs font-medium"
                        >
                          保存补充
                        </button>
                        <button
                          onClick={() => setNoteEditing(false)}
                          className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-xs font-medium hover:bg-gray-50"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 rounded-xl p-3">
                  {noteEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={adminNoteContent}
                        onChange={e => {
                          const newValue = e.target.value;
                          setAdminNoteContent(newValue);
                          const validation = validateRemark(newValue, 'zh');
                          if (!validation.valid) {
                            showToast(validation.message, 'error');
                          }
                        }}
                        placeholder="输入管理员备注（代用户记录）..."
                        rows={2}
                        maxLength={120}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
                      />
                      <p className="text-[10px] text-gray-400">限制：中文30字 / 英文20词(120字符)</p>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const validation = validateRemark(adminNoteContent, 'zh');
                            if (!validation.valid) {
                              showToast(validation.message, 'error');
                              return;
                            }
                            const { error } = await supabase.from('registrations').update({
                              note_content: adminNoteContent,
                              note_author: 'admin',
                              is_note_read: true,
                            }).eq('id', detail.id);
                            if (!error) {
                              setDetail({ ...detail, note_content: adminNoteContent, note_author: 'admin' });
                              showToast('备注已添加');
                              setNoteEditing(false);
                              fetchData();
                            }
                          }}
                          className="flex-1 bg-sky-500 hover:bg-sky-400 text-white py-2 rounded-lg text-xs font-medium"
                        >
                          保存备注
                        </button>
                        <button
                          onClick={() => { setNoteEditing(false); setAdminNoteContent(''); }}
                          className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-xs font-medium hover:bg-gray-50"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-400">暂无备注</p>
                      <button
                        onClick={() => setNoteEditing(true)}
                        className="text-xs text-sky-600 hover:text-sky-500"
                      >
                        添加备注
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => requestPrint(detail)}
              disabled={printingReg?.id === detail.id}
              className="w-full flex items-center justify-center gap-1.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white py-3 rounded-xl text-sm font-medium transition-colors"
            >
              <Printer size={15} /> {printingReg?.id === detail.id ? '生成中…' : '打印 / 下载票面'}
            </button>

            {detail.status === 'active' && (
              <div className="flex gap-2 pt-1 flex-wrap">
                {detail.seat_id && (
                  <button
                    onClick={() => {
                      setDetail(null);
                      if (detail.reschedule_count >= 1) setRescheduleConfirm(detail);
                      else setRescheduleReg(detail);
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-medium transition-colors ${detail.reschedule_count >= 1 ? 'bg-amber-500 hover:bg-amber-400 text-white' : 'bg-teal-500 hover:bg-teal-400 text-white'}`}
                  >
                    <RefreshCw size={14} /> 协助换座{detail.reschedule_count >= 1 ? ` (已${detail.reschedule_count}次)` : ''}
                  </button>
                )}
                <button
                  onClick={() => { setDetail(null); handleVerifyClick(detail); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white py-3 rounded-xl text-sm font-medium transition-colors"
                >
                  <CheckCircle size={15} /> {t('quick_verify')}
                </button>
                <button
                  onClick={() => { setDetail(null); setConfirm(detail.id); }}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-red-200 text-red-500 hover:bg-red-50 py-3 rounded-xl text-sm font-medium transition-colors"
                >
                  <Trash2 size={15} /> {t('cancel_reg')}
                </button>
              </div>
            )}
            {detail.status !== 'active' && (
              <button
                onClick={() => { setDetail(null); setConfirmDelete(detail.id); }}
                className="w-full flex items-center justify-center gap-1.5 border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 py-3 rounded-xl text-sm font-medium transition-colors mt-1"
              >
                <Trash2 size={15} /> {t('delete')}
              </button>
            )}
          </div>
        </div>
      )}

      <ReprintConfirmModal
        show={showReprintConfirm}
        reprintCount={reprintCountForConfirm}
        onConfirm={handleReprintConfirm}
        onCancel={handleReprintCancel}
      />

      {showPrintModal && (
        <PrintConfirmModal
          ticketCode={pendingPrintReg?.ticket_code}
          ticketPrice={(pendingPrintReg?.sessions as any)?.ticket_price}
          defaultServiceFee={(pendingPrintReg?.sessions as any)?.default_service_fee ?? 0}
          onConfirm={handlePrintConfirm}
          onCancel={() => { setShowPrintModal(false); setPendingPrintReg(null); }}
        />
      )}
    </div>
  );
}

// ─── AdminRescheduleModal ──────────────────────────────────────────────────────

function AdminRescheduleModal({
  reg, onClose, onSuccess,
}: { reg: Registration; onClose: () => void; onSuccess: () => void }) {
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [lockExpiresAt, setLockExpiresAt] = useState<string>('');
  const [locking, setLocking] = useState(false);
  const [showForceWarning, setShowForceWarning] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const lockedSeatRef = useRef<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: sess } = await supabase.from('sessions').select('*').eq('id', reg.session_id).maybeSingle();
      setSession(sess);
      const { data } = await supabase.rpc('get_seat_map', { p_session_id: reg.session_id });
      setSeats((data as SeatMapRow[]) ?? []);
    }
    load();
    const interval = setInterval(async () => {
      const { data } = await supabase.rpc('get_seat_map', { p_session_id: reg.session_id });
      setSeats((data as SeatMapRow[]) ?? []);
    }, 8000);
    return () => {
      clearInterval(interval);
      if (lockedSeatRef.current) {
        supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      }
    };
  }, [reg.session_id]);

  // Auto-release on lock expiry
  useEffect(() => {
    if (!lockExpiresAt) return;
    const ms = new Date(lockExpiresAt).getTime() - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(async () => {
      setSelectedSeatId(null);
      setLockExpiresAt('');
      lockedSeatRef.current = null;
      const { data } = await supabase.rpc('get_seat_map', { p_session_id: reg.session_id });
      setSeats((data as SeatMapRow[]) ?? []);
    }, ms + 500);
    return () => clearTimeout(t);
  }, [lockExpiresAt]);

  async function handleSeatClick(seat: SeatMapRow) {
    if (seat.is_booked || seat.id === reg.seat_id) return;

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
      return;
    }

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
      const { data: fresh } = await supabase.rpc('get_seat_map', { p_session_id: reg.session_id });
      setSeats((fresh as SeatMapRow[]) ?? []);
      return;
    }

    lockedSeatRef.current = seat.id;
    setSelectedSeatId(seat.id);
    setLockExpiresAt(data.expires_at);
    setError('');
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
    if (lockedSeatRef.current) {
      await supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      lockedSeatRef.current = null;
    }
    onClose();
  }

  async function handleSubmit() {
    if (!selectedSeatId) return;
    setError('');
    setSubmitting(true);
    const selectedSeat = seats.find(s => s.id === selectedSeatId);
    const isForce = pendingForce || (selectedSeat?.is_blocked ?? false);
    const { data, error: err } = await supabase.rpc('admin_reschedule_seat', {
      p_registration_id: reg.id,
      p_new_seat_id: selectedSeatId,
      p_force: isForce,
    });
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    const d = data as any;
    if (!d?.success) {
      const msg = d?.error;
      if (msg === 'seat_taken') setError('该座位已被预订，请重新选择');
      else if (msg === 'seat_blocked') setError('该座位已屏蔽，请使用强制换座');
      else setError(msg || '换座失败');
      return;
    }
    lockedSeatRef.current = null;
    onSuccess();
  }

  const selectedSeat = seats.find(s => s.id === selectedSeatId);
  const actualRows = seats.length > 0 ? Math.max(...seats.map(s => s.row_index)) : (session?.seat_rows ?? 1);
  const actualCols = seats.length > 0 ? Math.max(...seats.map(s => s.col_index)) : (session?.seats_per_row ?? 1);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-lg flex flex-col" style={{ maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 text-base">协助换座</h3>
            <p className="text-xs text-gray-400">{reg.name} · {reg.phone} · 当前：{(reg as any).seats?.seat_name || '-'}</p>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
            {reg.reschedule_count >= 1
              ? `此订单已换座 ${reg.reschedule_count} 次，请注意多次换座可能影响座位管理。`
              : '每张票仅限换座一次，换座后不可再次更改。'}
          </div>

          {reg.reschedule_history && reg.reschedule_history.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-medium text-gray-500 mb-2">换座记录</p>
              {reg.reschedule_history.map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                  <span>{h.from_seat}</span>
                  <span className="text-gray-400">→</span>
                  <span>{h.to_seat}</span>
                  {h.by_admin && <span className="text-amber-500">(管理员)</span>}
                  <span className="text-gray-400 ml-auto">{new Date(h.changed_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}

          {showForceWarning && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-orange-700">该座位已被锁定（暂不可用）</p>
              <p className="text-xs text-orange-600">以管理员身份强制换座将忽略锁定状态，请确认是否继续？</p>
              <div className="flex gap-2">
                <button onClick={confirmForce} className="flex-1 bg-orange-500 hover:bg-orange-400 text-white py-2 rounded-lg text-xs font-semibold transition-colors">强制换座</button>
                <button onClick={cancelForce} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-xs transition-colors hover:bg-gray-50">取消</button>
              </div>
            </div>
          )}

          {pendingForce && selectedSeatId && (() => {
            const s = seats.find(seat => seat.id === selectedSeatId);
            return s ? (
              <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
                <p className="text-xs text-orange-600">将强制换至（已锁定座位）</p>
                <p className="font-bold text-orange-700">{s.seat_name}</p>
              </div>
            ) : null;
          })()}

          {seats.length > 0 && session ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-3">
              <SeatMap
                seats={seats}
                rows={actualRows}
                seatsPerRow={actualCols}
                screenDirection={session.screen_direction}
                selectedSeatId={selectedSeatId}
                onSeatClick={locking ? () => {} : handleSeatClick}
                lockExpiresAt={lockExpiresAt || undefined}
                stageCenterCol={session.stage_center_col}
                adminProxyMode
              />
            </div>
          ) : (
            <p className="text-center text-sm text-gray-400 py-6">加载座位图中...</p>
          )}
          {selectedSeat && !pendingForce && !showForceWarning && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5">
              <p className="text-xs text-teal-600">新座位</p>
              <p className="font-bold text-teal-700">{selectedSeat.seat_name}</p>
            </div>
          )}
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>}
          <button
            onClick={handleSubmit}
            disabled={!selectedSeatId || submitting || locking || showForceWarning}
            className="w-full bg-teal-500 hover:bg-teal-400 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3.5 rounded-xl text-sm transition-colors"
          >
            {submitting ? '处理中...' : (selectedSeatId && !showForceWarning) ? `确认换至 ${selectedSeat?.seat_name ?? ''}` : '请选择新座位'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sessions Manager ──────────────────────────────────────────────────────────

type EditorMode = 'list' | 'edit' | 'new' | 'detail';

function SessionsManager() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [mode, setMode] = useState<EditorMode>('list');
  const [editing, setEditing] = useState<Session | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchSessions();
    const channel = supabase
      .channel('admin:sessions')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions' }, (payload) => {
        setSessions(prev => prev.map(s => s.id === (payload.new as Session).id ? payload.new as Session : s));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, fetchSessions)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sessions' }, fetchSessions)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchSessions() {
    const { data } = await supabase.from('sessions').select('*').order('session_date').order('start_time');
    setSessions(data ?? []);
    try {
      await supabase.rpc('expire_past_tickets');
      await supabase.rpc('auto_manage_session_status');
    } catch { /* ignore */ }
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function startNew() {
    setEditing({
      id: '', name: '', session_date: '', start_time: '', end_time: '',
      capacity: 100, available_stock: 100, is_active: true,
      verification_start: null, verification_end: null,
      verify_date: '', stop_selling_minutes: 0,
      description: '', cover_image: null, created_at: '',
      has_seating_chart: false, seat_rows: 5, seats_per_row: 10, screen_direction: 'top',
      stage_center_col: null, booking_notice: '', ticket_price: 0, default_service_fee: 0,
    });
    setMode('new');
  }

  function startEdit(s: Session) {
    setEditing({ ...s });
    setMode('edit');
  }

  async function handleDelete(id: string, name: string) {
    setDeleting(true);
    // Cancel active orders and notify affected users before deleting session
    await supabase.rpc('admin_send_session_cancelled_notifications', {
      p_session_id: id,
      p_session_name: name,
    });
    const { error } = await supabase.from('sessions').delete().eq('id', id);
    setDeleting(false);
    if (error) { showToast(error.message, 'error'); setConfirm(null); return; }
    setSessions(prev => prev.filter(s => s.id !== id));
    showToast('场次已删除，相关订单已作废并通知用户');
    setConfirm(null);
  }

  async function toggleActive(s: Session) {
    await supabase.from('sessions').update({ is_active: !s.is_active }).eq('id', s.id);
    await fetchSessions();
  }

  if (mode === 'edit' || mode === 'new') {
    return (
      <SessionEditor
        initial={editing!}
        isNew={mode === 'new'}
        onSave={() => { setMode('list'); fetchSessions(); showToast(t('save_success')); }}
        onCancel={() => setMode('list')}
      />
    );
  }

  if (mode === 'detail' && editing) {
    return (
      <SessionDetailView
        session={editing}
        onBack={() => setMode('list')}
        onEdit={() => { setEditing({ ...editing }); setMode('edit'); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {confirm && (
        <ConfirmDialog
          title={t('confirm_delete')}
          message={`删除场次【${confirm.name}】后，所有有效订单将自动作废，并向相关用户发送通知。此操作不可撤销，确定继续？`}
          onConfirm={() => handleDelete(confirm.id, confirm.name)}
          onCancel={() => setConfirm(null)}
        />
      )}

      <button
        onClick={startNew}
        className="w-full flex items-center justify-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium py-3 rounded-xl transition-colors"
      >
        <Plus size={16} /> {t('add_session')}
      </button>

      {sessions.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">{t('no_data')}</div>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <div key={s.id} className={`bg-white rounded-2xl shadow-sm border p-4 ${s.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
              {s.cover_image && (
                <img src={s.cover_image} alt="" className="w-full h-28 object-cover rounded-xl mb-3" />
              )}
              <div className="flex items-start justify-between mb-1">
                <span className="font-semibold text-gray-900 text-sm">{s.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {s.is_active ? t('active') : t('inactive')}
                </span>
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                <Calendar size={11} /> {s.session_date}
                <Clock size={11} className="ml-1" /> {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                <Users size={11} className="ml-1" /> {t('remaining_stock')}: {s.available_stock ?? s.capacity}
              </p>
              {(s.verification_start || s.verification_end) && (
                <p className="text-[10px] text-amber-600 mb-2">
                  {t('verification_start')}: {s.verification_start?.slice(0, 5) || '-'} – {t('verification_end')}: {s.verification_end?.slice(0, 5) || '-'}
                </p>
              )}
              {s.description && (
                <p className="text-xs text-gray-400 mb-2 line-clamp-1"
                  dangerouslySetInnerHTML={{ __html: s.description.replace(/<[^>]+>/g, ' ').slice(0, 60) + '…' }}
                />
              )}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => startEdit(s)} className="flex items-center gap-1 text-xs text-sky-600 border border-sky-200 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors">
                  <Edit3 size={11} /> {t('edit')}
                </button>
                {s.has_seating_chart && (
                  <button
                    onClick={() => { setEditing({ ...s }); setMode('detail'); }}
                    className="flex items-center gap-1 text-xs text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <LayoutGrid size={11} /> 场次详情
                  </button>
                )}
                <button onClick={() => toggleActive(s)} className="text-xs text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">{t('toggle_active')}</button>
                <button onClick={() => setConfirm({ id: s.id, name: s.name })} disabled={deleting} className="text-xs text-red-500 border border-red-200 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">{t('delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Session Editor (full-page) ────────────────────────────────────────────────

function SessionEditor({
  initial, isNew, onSave, onCancel,
}: { initial: Session; isNew: boolean; onSave: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [name, setName] = useState(initial.name);
  const [sessionDate, setSessionDate] = useState(initial.session_date);
  const [startTime, setStartTime] = useState(initial.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(initial.end_time.slice(0, 5));
  const [availableStock, setAvailableStock] = useState(initial.available_stock ?? initial.capacity ?? 100);
  const [verStart, setVerStart] = useState(initial.verification_start?.slice(0, 5) || '');
  const [verEnd, setVerEnd] = useState(initial.verification_end?.slice(0, 5) || '');
  const [verifyDate, setVerifyDate] = useState(initial.verify_date || initial.session_date || '');
  const [stopSellingMinutes, setStopSellingMinutes] = useState(initial.stop_selling_minutes ?? 0);
  const [coverImage, setCoverImage] = useState(initial.cover_image || '');
  const [isActive, setIsActive] = useState(initial.is_active);
  const [ticketPrice, setTicketPrice] = useState(initial.ticket_price ?? 0);
  const [childPrice, setChildPrice] = useState(initial.child_price ?? 0);
  const [concessionPrice, setConcessionPrice] = useState(initial.concession_price ?? 0);
  const [vipPrice, setVipPrice] = useState(initial.vip_price ?? 0);
  const [defaultServiceFee, setDefaultServiceFee] = useState(initial.default_service_fee ?? 0);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seat configuration
  const [hasSeatingChart, setHasSeatingChart] = useState(initial.has_seating_chart ?? false);
  const [seatRows, setSeatRows] = useState(initial.seat_rows || 5);
  const [seatsPerRow, setSeatsPerRow] = useState(initial.seats_per_row || 10);
  const [screenDirection, setScreenDirection] = useState<'top' | 'bottom' | 'left' | 'right'>(
    (['top', 'bottom'] as const).includes(initial.screen_direction as any)
      ? (initial.screen_direction as 'top' | 'bottom')
      : 'top',
  );
  const [stageCenterCol, setStageCenterCol] = useState<number>(
    initial.stage_center_col ?? ((initial.seats_per_row || 10) + 1) / 2,
  );
  // Field-level errors (shown next to the offending field)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Refs for auto-scroll on validation errors
  const endTimeRef = useRef<HTMLInputElement>(null);
  const verEndTimeRef = useRef<HTMLInputElement>(null);
  const availableStockRef = useRef<HTMLInputElement>(null);
  const formTopRef = useRef<HTMLDivElement>(null);

  function scrollToError(field: string) {
    setTimeout(() => {
      const map: Record<string, React.RefObject<HTMLInputElement>> = {
        endTime: endTimeRef,
        verEndTime: verEndTimeRef,
        availableStock: availableStockRef,
      };
      if (field === 'top') {
        formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      map[field]?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function setFieldError(field: string, msg: string) {
    setFieldErrors(prev => ({ ...prev, [field]: msg }));
    scrollToError(field);
  }

  function clearAllErrors() {
    setFieldErrors({});
    setGeneralError('');
  }

  // Track last-saved seat dimensions to avoid unnecessary seat regeneration
  const savedRowsRef = useRef(initial.seat_rows || 0);
  const savedColsRef = useRef(initial.seats_per_row || 0);

  // Saved session ID — populated after a new session is created, or use initial.id for edits
  const [savedSessionId, setSavedSessionId] = useState(initial.id || '');

  // Inline seat block management state
  const [blockSeats, setBlockSeats] = useState<SeatMapRow[]>([]);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockSelected, setBlockSelected] = useState<Set<string>>(new Set());
  const [blockReason, setBlockReason] = useState('');
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockSectionOpen, setBlockSectionOpen] = useState(false);
  const [blockToast, setBlockToast] = useState<string | null>(null);
  const [soldOrders, setSoldOrders] = useState<{ name: string; ticket_code: string; ticket_type: TicketType; seat_name: string }[]>([]);

  // Admin seat cancellation confirmation
  const [cancelSeatReg, setCancelSeatReg] = useState<{
    id: string; name: string; phone: string; ticket_code: string; seat_name: string;
  } | null>(null);
  const [cancelSeatSaving, setCancelSeatSaving] = useState(false);

  // Preview grid sold-seat action
  const [previewSoldAction, setPreviewSoldAction] = useState<{
    reg: Registration;
    seat: SeatMapRow;
  } | null>(null);
  const [previewRescheduleReg, setPreviewRescheduleReg] = useState<Registration | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillInstance = useRef<any>(null);
  const noticeEditorRef = useRef<HTMLDivElement>(null);
  const noticeQuillInstance = useRef<any>(null);

  useEffect(() => {
    // For edit mode with seating chart: pre-load seats so preview can sync blocked state
    if (!isNew && savedSessionId && hasSeatingChart) {
      fetchBlockSeats(savedSessionId);
    }
  }, []);

  useEffect(() => {
    Promise.all([import('quill'), import('quill/dist/quill.snow.css')]).then(([{ default: Quill }]) => {
      if (!editorRef.current || quillInstance.current) return;
      quillInstance.current = new Quill(editorRef.current, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'image'],
            [{ color: [] }],
            ['clean'],
          ],
        },
      });
      quillInstance.current.root.innerHTML = initial.description || '';
    });
    return () => {};
  }, []);

  useEffect(() => {
    Promise.all([import('quill'), import('quill/dist/quill.snow.css')]).then(([{ default: Quill }]) => {
      if (!noticeEditorRef.current || noticeQuillInstance.current) return;
      noticeQuillInstance.current = new Quill(noticeEditorRef.current, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'image'],
            [{ color: [] }],
            ['clean'],
          ],
        },
      });
      noticeQuillInstance.current.root.innerHTML = initial.booking_notice || '';
    });
    return () => {};
  }, []);

  async function fetchBlockSeats(sessionId?: string) {
    const id = sessionId ?? savedSessionId;
    if (!id) return;
    setBlockLoading(true);
    const { data } = await supabase.rpc('get_seat_map', { p_session_id: id });
    setBlockSeats((data as SeatMapRow[]) ?? []);
    // Also fetch sold orders for this session
    const { data: regData } = await supabase
      .from('registrations')
      .select('name, ticket_code, ticket_type, seats(seat_name)')
      .eq('session_id', id)
      .in('status', ['active', 'used'])
      .is('deleted_at', null);
    setSoldOrders((regData as any[])?.map(r => ({ name: r.name, ticket_code: r.ticket_code, ticket_type: r.ticket_type as TicketType, seat_name: (r as any).seats?.seat_name ?? '-' })) ?? []);
    setBlockLoading(false);
  }

  function toggleBlockSection() {
    if (!blockSectionOpen && blockSeats.length === 0) fetchBlockSeats();
    setBlockSectionOpen(v => !v);
  }

  function handleBlockSeatClick(seat: SeatMapRow) {
    if (seat.is_booked) {
      // Fetch registration details then show cancel confirmation
      supabase
        .from('registrations')
        .select('id, name, phone, ticket_code')
        .eq('seat_id', seat.id)
        .not('status', 'in', '("cancelled","expired")')
        .is('deleted_at', null)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setCancelSeatReg({ ...data, seat_name: seat.seat_name });
          }
        });
      return;
    }
    setBlockSelected(prev => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.add(seat.id);
      return next;
    });
  }

  async function confirmCancelSeat() {
    if (!cancelSeatReg) return;
    setCancelSeatSaving(true);
    const { data, error } = await supabase.rpc('admin_cancel_registration', {
      p_registration_id: cancelSeatReg.id,
    });
    setCancelSeatSaving(false);
    if (error || (data as any)?.success === false) {
      setBlockToast('取消失败：' + (error?.message || (data as any)?.error || '未知错误'));
    } else {
      setBlockToast(`已取消 ${cancelSeatReg.name} 的预订，座位已释放`);
      await fetchBlockSeats();
    }
    setCancelSeatReg(null);
    setTimeout(() => setBlockToast(null), 4000);
  }

  async function applyBlockSeats(blocked: boolean) {
    if (blockSelected.size === 0) return;
    setBlockSaving(true);
    const ids = [...blockSelected];
    const { data, error } = await supabase.rpc('admin_bulk_block_seats', {
      p_seat_ids: ids,
      p_blocked: blocked,
      p_reason: blocked ? (blockReason || null) : null,
    });
    setBlockSaving(false);
    if (error || (data as any)?.success === false) {
      setBlockToast('操作失败，请重试');
    } else {
      setBlockToast(`已${blocked ? '屏蔽' : '解除屏蔽'} ${(data as any).updated} 个座位`);
      setBlockSelected(new Set());
      if (blocked) setBlockReason('');
      fetchBlockSeats();
    }
    setTimeout(() => setBlockToast(null), 3000);
  }

  async function handleImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setUploadError('');
    const { url, error } = await uploadImageViaFunction(file, 'sessions');
    if (error || !url) {
      setUploadError(`上传失败：${error ?? '未知错误'}`);
    } else {
      setCoverImage(url);
    }
    setUploadingImage(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSave() {
    clearAllErrors();
    setSuccessMsg('');

    // Validate required basic fields
    if (!name) {
      setFieldError('name', '请填写场次名称');
      return;
    }
    if (!sessionDate) {
      setFieldError('sessionDate', '请选择场次日期');
      return;
    }
    if (!startTime) {
      setFieldError('startTime', '请选择开始时间');
      return;
    }
    if (!endTime) {
      setFieldError('endTime', '请选择结束时间');
      return;
    }

    // Validate end time is after start time
    if (endTime <= startTime) {
      setFieldError('endTime', '结束时间必须晚于开始时间');
      return;
    }

    // Validate verification times if set
    if (verStart && verEnd && verEnd <= verStart) {
      setFieldError('verEndTime', '核销结束时间必须晚于核销开始时间');
      return;
    }

    const description = quillInstance.current?.root.innerHTML ?? initial.description ?? '';
    const bookingNoticeHtml = noticeQuillInstance.current?.root.innerHTML ?? initial.booking_notice ?? '';

    let finalAvailableStock = availableStock;
    if (hasSeatingChart && seatRows > 0 && seatsPerRow > 0) {
      const blockedCount = savedSessionId
        ? blockSeats.filter(s => s.is_blocked).length
        : previewBlocked.size;
      const availableSeats = seatRows * seatsPerRow - blockedCount;
      finalAvailableStock = availableSeats;
    }

    setSaving(true);

    const payload: Record<string, unknown> = {
      name,
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      available_stock: finalAvailableStock,
      verification_start: verStart || null,
      verification_end: verEnd || null,
      verify_date: verifyDate || null,
      stop_selling_minutes: stopSellingMinutes || 0,
      cover_image: coverImage || null,
      description,
      is_active: isActive,
      has_seating_chart: hasSeatingChart,
      seat_rows: hasSeatingChart ? seatRows : 0,
      seats_per_row: hasSeatingChart ? seatsPerRow : 0,
      screen_direction: screenDirection,
      stage_center_col: hasSeatingChart ? stageCenterCol : null,
      booking_notice: bookingNoticeHtml === '<p><br></p>' ? '' : bookingNoticeHtml,
      ticket_price: ticketPrice,
      child_price: childPrice || null,
      concession_price: concessionPrice || null,
      vip_price: vipPrice || null,
      default_service_fee: defaultServiceFee,
    };

    let sessionId = savedSessionId;

    if (isNew || !sessionId) {
      payload.capacity = availableStock;
      const { data, error } = await supabase.from('sessions').insert(payload).select('id').single();
      if (error || !data?.id) {
        setGeneralError('保存场次失败：' + (error?.message ?? '未知错误'));
        scrollToError('top');
        setSaving(false);
        return;
      }
      sessionId = data.id;
      setSavedSessionId(sessionId);
    } else {
      const { error } = await supabase.from('sessions').update(payload).eq('id', sessionId);
      if (error) {
        setGeneralError('保存失败：' + error.message);
        scrollToError('top');
        setSaving(false);
        return;
      }
    }

    // Only regenerate seats when dimensions actually changed (or it's a new session)
    const dimensionsChanged = seatRows !== savedRowsRef.current || seatsPerRow !== savedColsRef.current;
    const needsGenerate = hasSeatingChart && sessionId && seatRows > 0 && seatsPerRow > 0 && (isNew || !savedSessionId || dimensionsChanged);

    if (needsGenerate) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('generate_session_seats', {
        p_session_id: sessionId,
        p_rows: seatRows,
        p_seats_per_row: seatsPerRow,
      });
      if (rpcErr) {
        setGeneralError('座位图生成失败：' + rpcErr.message);
        scrollToError('top');
        setSaving(false);
        return;
      }
      savedRowsRef.current = seatRows;
      savedColsRef.current = seatsPerRow;
      const cancelled = (rpcData as any)?.cancelled_bookings ?? 0;
      if (cancelled > 0) {
        setGeneralError(`保存成功。注意：${cancelled} 个超出新座位范围的订单已自动取消并恢复名额。`);
        setSaving(false);
        if (hasSeatingChart) fetchBlockSeats(sessionId);
        return;
      }
    }

    // After saving, refresh seat list for the block section
    if (hasSeatingChart && sessionId) {
      await fetchBlockSeats(sessionId);
      setBlockSectionOpen(true);
    }

    // Apply any seats pre-selected in the preview as blocked (new session flow)
    if (hasSeatingChart && sessionId && previewBlocked.size > 0 && (isNew || !savedSessionId || needsGenerate)) {
      const { data: freshSeats } = await supabase.rpc('get_seat_map', { p_session_id: sessionId });
      if (freshSeats && (freshSeats as SeatMapRow[]).length > 0) {
        const idsToBlock: string[] = [];
        (freshSeats as SeatMapRow[]).forEach(s => {
          const m = s.seat_name.match(/^([A-Z])排(\d+)座$/);
          if (m) {
            const key = `R${m[1].charCodeAt(0) - 65}-C${parseInt(m[2]) - 1}`;
            if (previewBlocked.has(key)) idsToBlock.push(s.id);
          }
        });
        if (idsToBlock.length > 0) {
          await supabase.rpc('admin_bulk_block_seats', { p_seat_ids: idsToBlock, p_blocked: true, p_reason: null });
          await fetchBlockSeats(sessionId);
        }
      }
    }

    setSaving(false);
    if (!isNew || !hasSeatingChart) {
      onSave();
    } else {
      setSuccessMsg('场次已保存！可直接点击预览格子屏蔽座位，或在下方"座位屏蔽管理"中批量操作，完成后点击"完成"。');
    }
  }

  // Live seat grid preview
  const previewRows = Math.min(Math.max(seatRows, 1), 26);
  const previewCols = Math.min(Math.max(seatsPerRow, 1), 20);

  // Preview-level blocked set: key = "R{row}-C{col}" (0-indexed)
  // For new sessions: applied after save. For existing sessions: synced from blockSeats.
  const [previewBlocked, setPreviewBlocked] = useState<Set<string>>(new Set());

  // Booked seats derived from blockSeats (read-only, no interaction)
  const previewBooked = new Set<string>(
    blockSeats
      .filter(s => s.is_booked)
      .map(s => {
        const m = s.seat_name.match(/^([A-Z])排(\d+)座$/);
        return m ? `R${m[1].charCodeAt(0) - 65}-C${parseInt(m[2]) - 1}` : null;
      })
      .filter((k): k is string => k !== null)
  );

  // Ticket type map for booked seats: key → TicketType
  const previewTicketTypes = Object.fromEntries(
    blockSeats
      .filter(s => s.is_booked && s.booked_ticket_type)
      .map(s => {
        const m = s.seat_name.match(/^([A-Z])排(\d+)座$/);
        const key = m ? `R${m[1].charCodeAt(0) - 65}-C${parseInt(m[2]) - 1}` : null;
        return key ? [key, s.booked_ticket_type as TicketType] : null;
      })
      .filter((e): e is [string, TicketType] => e !== null)
  );

  const PREVIEW_BOOKED_CLS: Record<TicketType, string> = {
    adult:      'bg-sky-400 text-white hover:bg-sky-500',
    child:      'bg-teal-500 text-white hover:bg-teal-600',
    concession: 'bg-amber-400 text-white hover:bg-amber-500',
  };
  const PREVIEW_BOOKED_LABEL: Record<TicketType, string> = {
    adult: '成', child: '童', concession: '优',
  };

  // When blockSeats loads (edit mode), sync previewBlocked from actual DB state
  useEffect(() => {
    if (blockSeats.length === 0) return;
    const blocked = new Set<string>();
    blockSeats.forEach(s => {
      if (!s.is_blocked) return;
      // seat_name format: "A排1座" → row index = charCode(A)-65, col = 0-indexed = number-1
      const m = s.seat_name.match(/^([A-Z])排(\d+)座$/);
      if (m) blocked.add(`R${m[1].charCodeAt(0) - 65}-C${parseInt(m[2]) - 1}`);
    });
    setPreviewBlocked(blocked);
  }, [blockSeats]);

  async function handlePreviewSeatClick(r: number, c: number) {
    const key = `R${r}-C${c}`;
    const rowLetter = String.fromCharCode(65 + r);
    const seatName = `${rowLetter}排${c + 1}座`;

    // If booked — look up registration and show action modal
    if (previewBooked.has(key) && savedSessionId) {
      const { data } = await supabase
        .from('registrations')
        .select('*, sessions(name, session_date, start_time, end_time, ticket_price, default_service_fee), seats(seat_name)')
        .eq('seat_id', blockSeats.find(s => s.seat_name === seatName)?.id ?? '')
        .not('status', 'in', '("cancelled","expired")')
        .is('deleted_at', null)
        .maybeSingle();
      if (data) {
        const seat = blockSeats.find(s => s.seat_name === seatName);
        setPreviewSoldAction({ reg: data as Registration, seat: seat! });
      }
      return;
    }

    if (!savedSessionId) {
      setPreviewBlocked(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      return;
    }
    // Existing session — toggle blocked state
    const seat = blockSeats.find(s => s.seat_name === seatName);
    if (!seat) return;
    const willBlock = !seat.is_blocked;
    setBlockSaving(true);
    const { data, error } = await supabase.rpc('admin_bulk_block_seats', {
      p_seat_ids: [seat.id],
      p_blocked: willBlock,
      p_reason: null,
    });
    setBlockSaving(false);
    if (!error && (data as any)?.success !== false) {
      setPreviewBlocked(prev => {
        const next = new Set(prev);
        if (willBlock) next.add(key); else next.delete(key);
        return next;
      });
      setBlockSeats(prev => prev.map(s => s.seat_name === seatName ? { ...s, is_blocked: willBlock } : s));
    } else {
      setBlockToast('操作失败，请重试');
      setTimeout(() => setBlockToast(null), 3000);
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 -mx-4 -mt-4" ref={formTopRef}>

      {/* Preview sold-seat action modal */}
      {previewSoldAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={20} className="text-sky-500" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-sm">已售座位 · {previewSoldAction.seat.seat_name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{previewSoldAction.reg.name} · {previewSoldAction.reg.phone}</p>
                <p className="font-mono text-xs text-gray-400 mt-0.5">{previewSoldAction.reg.ticket_code}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500">请选择操作：</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setPreviewRescheduleReg(previewSoldAction.reg);
                  setPreviewSoldAction(null);
                }}
                className="w-full py-2.5 bg-teal-500 hover:bg-teal-400 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                协助换座
              </button>
              <button
                onClick={() => {
                  setCancelSeatReg({
                    id: previewSoldAction.reg.id,
                    name: previewSoldAction.reg.name,
                    phone: previewSoldAction.reg.phone ?? '',
                    ticket_code: previewSoldAction.reg.ticket_code,
                    seat_name: previewSoldAction.seat.seat_name,
                  });
                  setPreviewSoldAction(null);
                }}
                className="w-full py-2.5 border border-red-200 text-red-500 hover:bg-red-50 rounded-xl text-sm font-semibold transition-colors"
              >
                取消预订并释放座位
              </button>
              <button
                onClick={() => setPreviewSoldAction(null)}
                className="w-full py-2.5 border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-xl text-sm transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview reschedule modal */}
      {previewRescheduleReg && (
        <AdminRescheduleModal
          reg={previewRescheduleReg}
          onClose={() => setPreviewRescheduleReg(null)}
          onSuccess={() => {
            setPreviewRescheduleReg(null);
            setBlockToast('换座成功，座位图已更新');
            fetchBlockSeats();
            setTimeout(() => setBlockToast(null), 3000);
          }}
        />
      )}

      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <h2 className="flex-1 font-semibold text-gray-900 text-sm">
          {isNew ? t('add_session') : t('edit')}
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <div
            onClick={() => setIsActive(!isActive)}
            className={`w-9 h-5 rounded-full transition-colors relative ${isActive ? 'bg-sky-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${isActive ? 'left-4' : 'left-0.5'}`} />
          </div>
          {isActive ? t('active') : t('inactive')}
        </label>
        <button
          onClick={isNew && savedSessionId ? onSave : handleSave}
          disabled={saving || (!savedSessionId && (!name || !sessionDate || !startTime || !endTime))}
          className="bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving ? '...' : (isNew && savedSessionId ? '完成' : t('save'))}
        </button>
      </div>

      {(generalError || successMsg) && (
        <div className="px-4 pt-3">
          {generalError && (
            <div className={`border rounded-xl px-3 py-2.5 flex items-start gap-2 ${
              generalError.startsWith('保存成功') ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
            }`}>
              <AlertCircle size={14} className={`flex-shrink-0 mt-0.5 ${generalError.startsWith('保存成功') ? 'text-amber-600' : 'text-red-500'}`} />
              <p className={`text-xs leading-relaxed ${
                generalError.startsWith('保存成功') ? 'text-amber-700' : 'text-red-600'
              }`}>{generalError}</p>
            </div>
          )}
          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-700 leading-relaxed">{successMsg}</p>
            </div>
          )}
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Basic Info */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">基本信息</h3>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setFieldErrors(prev => ({ ...prev, name: undefined })); }}
            placeholder={t('session_name')}
            className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${
              fieldErrors.name ? 'border-red-400 bg-red-50 ring-2 ring-red-200' : 'border-gray-200 focus:ring-sky-400'
            }`}
          />
          {fieldErrors.name && <p className="text-[10px] text-red-600 -mt-1">{fieldErrors.name}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t('session_date')}</label>
              <input type="date" value={sessionDate} onChange={e => { setSessionDate(e.target.value); setFieldErrors(prev => ({ ...prev, sessionDate: undefined })); }}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                  fieldErrors.sessionDate ? 'border-red-400 bg-red-50 ring-2 ring-red-200' : 'border-gray-200 focus:ring-sky-400'
                }`} />
              {fieldErrors.sessionDate && <p className="text-[10px] text-red-600 mt-1">{fieldErrors.sessionDate}</p>}
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                {t('available_stock')}
                {hasSeatingChart && seatRows > 0 && seatsPerRow > 0 && (() => {
                  const blocked = savedSessionId
                    ? blockSeats.filter(s => s.is_blocked).length
                    : previewBlocked.size;
                  const avail = seatRows * seatsPerRow - blocked;
                  return (
                    <span className={`ml-1.5 font-medium ${availableStock > avail ? 'text-red-500' : 'text-gray-400'}`}>
                      (上限 {avail} 座)
                    </span>
                  );
                })()}
              </label>
              <input type="number" min={0} ref={availableStockRef} value={availableStock} onChange={e => { setAvailableStock(parseInt(e.target.value) || 0); setFieldErrors(prev => ({ ...prev, availableStock: undefined })); }}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                  fieldErrors.availableStock ? 'border-red-400 bg-red-50 ring-2 ring-red-200' :
                  hasSeatingChart && availableStock > seatRows * seatsPerRow - (savedSessionId ? blockSeats.filter(s => s.is_blocked).length : previewBlocked.size)
                    ? 'border-red-300 bg-red-50 focus:ring-red-400'
                    : 'border-gray-200 focus:ring-sky-400'
                }`} />
              {fieldErrors.availableStock && <p className="text-[10px] text-red-600 mt-1">{fieldErrors.availableStock}</p>}
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t('start_time')}</label>
              <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setFieldErrors(prev => ({ ...prev, startTime: undefined, endTime: undefined })); }}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                  fieldErrors.startTime ? 'border-red-400 bg-red-50 ring-2 ring-red-200' :
                  fieldErrors.endTime ? 'border-amber-300 bg-amber-50 focus:ring-amber-400' :
                  'border-gray-200 focus:ring-sky-400'
                }`} />
              {fieldErrors.startTime && <p className="text-[10px] text-red-600 mt-1">{fieldErrors.startTime}</p>}
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{t('end_time')}</label>
              <input type="time" ref={endTimeRef} value={endTime} onChange={e => { setEndTime(e.target.value); setFieldErrors(prev => ({ ...prev, endTime: undefined })); }}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                  fieldErrors.endTime ? 'border-red-400 bg-red-50 ring-2 ring-red-200' :
                  'border-gray-200 focus:ring-sky-400'
                }`} />
              {fieldErrors.endTime && <p className="text-[10px] text-red-600 mt-1">{fieldErrors.endTime}</p>}
            </div>
          </div>
        </div>

        {/* Seat Layout */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid size={14} className="text-sky-500" />
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">座位布局</h3>
            </div>
            <div
              onClick={() => setHasSeatingChart(v => !v)}
              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${hasSeatingChart ? 'bg-sky-500' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${hasSeatingChart ? 'left-4' : 'left-0.5'}`} />
            </div>
          </div>

          {hasSeatingChart && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">排数（行）</label>
                  <input
                    type="number" min={1} max={26} value={seatRows}
                    onChange={e => setSeatRows(Math.min(26, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">每排座位数</label>
                  <input
                    type="number" min={1} max={30} value={seatsPerRow}
                    onChange={e => setSeatsPerRow(Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-2 block">舞台/屏幕方向</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['top', 'bottom'] as const).map(dir => {
                    const labels: Record<string, string> = { top: '屏幕在上 (默认)', bottom: '屏幕在下' };
                    return (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => setScreenDirection(dir)}
                        className={`py-2 px-3 rounded-xl text-xs font-medium border transition-colors ${
                          screenDirection === dir
                            ? 'bg-sky-500 text-white border-sky-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
                        }`}
                      >
                        {labels[dir]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  舞台中心对齐列号 (1-{seatsPerRow})
                  {stageCenterCol === (seatsPerRow + 1) / 2 && <span className="text-gray-400"> · 自动居中</span>}
                </label>
                <input
                  type="number"
                  min={1}
                  max={seatsPerRow}
                  step={0.5}
                  value={stageCenterCol}
                  onChange={e => setStageCenterCol(Math.min(seatsPerRow, Math.max(1, parseFloat(e.target.value) || 1)))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  placeholder={`默认: ${((seatsPerRow + 1) / 2).toFixed(1)}`}
                />
                <p className="text-[10px] text-gray-400 mt-1">设置舞台在哪一列正前方。1 表示靠左，{seatsPerRow} 表示靠右。</p>
              </div>

              {/* Live preview */}
              <div>
                <p className="text-xs text-gray-500 mb-1">
                  预览（{previewRows}排 × {previewCols}座 = {previewRows * previewCols}个座位）
                </p>
                {hasSeatingChart && (
                  <p className="text-[10px] text-gray-400 mb-2">
                    {savedSessionId ? '点击座位可直接切换屏蔽状态' : '点击座位预设屏蔽，保存后自动应用'}
                  </p>
                )}
                {hasSeatingChart && blockSeats.length > 0 && (
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-lg bg-emerald-100" /><span className="text-[10px] text-gray-400">空闲</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-lg bg-sky-400" /><span className="text-[10px] text-gray-400">成人票</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-lg bg-teal-500" /><span className="text-[10px] text-gray-400">儿童票</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-lg bg-amber-400" /><span className="text-[10px] text-gray-400">优待票</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-lg bg-red-400" /><span className="text-[10px] text-gray-400">已屏蔽</span></div>
                  </div>
                )}
                <AdminSeatPreview
                  rows={previewRows}
                  cols={previewCols}
                  screenDirection={screenDirection as 'top' | 'bottom'}
                  stageCenterCol={stageCenterCol}
                  previewBlocked={previewBlocked}
                  previewBooked={previewBooked}
                  previewTicketTypes={previewTicketTypes}
                  onSeatClick={handlePreviewSeatClick}
                  disabled={blockSaving}
                />
                {previewBlocked.size > 0 && (
                  <p className="text-[10px] text-red-500 mt-1">
                    已选择屏蔽 {previewBlocked.size} 个座位{!savedSessionId ? '（保存场次后自动应用）' : ''}
                  </p>
                )}
                {blockToast && (
                  <div className="mt-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 text-xs text-sky-700">{blockToast}</div>
                )}
              </div>

              {generalError && (
                <div className={`border rounded-xl px-3 py-2 ${
                  generalError.startsWith('保存成功') ? 'bg-amber-50 border-amber-200' :
                  'bg-red-50 border-red-200'
                }`}>
                  <p className={`text-xs ${
                    generalError.startsWith('保存成功') ? 'text-amber-700' : 'text-red-600'
                  }`}>{generalError}</p>
                </div>
              )}
              {successMsg && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <p className="text-xs text-emerald-700">{successMsg}</p>
                </div>
              )}

              <p className="text-[10px] text-amber-600">
                注意：修改座位配置后，已有订单的座位图不可重新生成。容量建议与座位总数保持一致。
              </p>

              {isNew && !savedSessionId && (
                <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2">
                  <p className="text-[11px] text-sky-700">保存场次后，即可在下方"座位屏蔽管理"中锁定特定座位。</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Verification Window */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('verification_start')} / {t('verification_end')}</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{isEn ? 'Verification Date' : '核销日期'}</label>
              <input type="date" value={verifyDate} onChange={e => setVerifyDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{isEn ? 'Stop Selling (min)' : '停售倒计时（分钟）'}</label>
              <input type="number" min="0" value={stopSellingMinutes} onChange={e => setStopSellingMinutes(parseInt(e.target.value) || 0)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{t('verification_start')}</label>
              <input type="time" value={verStart} onChange={e => { setVerStart(e.target.value); setFieldErrors(prev => ({ ...prev, verStart: undefined, verEndTime: undefined })); }}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                  fieldErrors.verEndTime ? 'border-amber-300 bg-amber-50 focus:ring-amber-400' : 'border-gray-200 focus:ring-sky-400'
                }`} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{t('verification_end')}</label>
              <input type="time" ref={verEndTimeRef} value={verEnd} onChange={e => { setVerEnd(e.target.value); setFieldErrors(prev => ({ ...prev, verEndTime: undefined })); }}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                  fieldErrors.verEndTime ? 'border-red-400 bg-red-50 ring-2 ring-red-200' : 'border-gray-200 focus:ring-sky-400'
                }`} />
              {fieldErrors.verEndTime && <p className="text-[10px] text-red-600 mt-1 col-span-2">{fieldErrors.verEndTime}</p>}
            </div>
          </div>
          <p className="text-[10px] text-amber-600">{isEn ? 'Booking stops at: verifyEndTime - stopSellingMinutes' : '停售时间点 = 核销结束时间 - 停售倒计时'}</p>
        </div>

        {/* Ticket Price + Default Service Fee */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{isEn ? 'Pricing (Lanke Coins)' : '价格设置（兰克币）'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{isEn ? 'Adult Ticket Price' : '成人票价'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-medium text-sm">LC</span>
                <input type="number" min="0" step="0.01" value={ticketPrice || ''} onChange={e => setTicketPrice(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{isEn ? 'Child Ticket Price' : '儿童票价'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-medium text-sm">LC</span>
                <input type="number" min="0" step="0.01" value={childPrice || ''} onChange={e => setChildPrice(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{isEn ? 'Concession Price' : '优待票价'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-medium text-sm">LC</span>
                <input type="number" min="0" step="0.01" value={concessionPrice || ''} onChange={e => setConcessionPrice(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">{isEn ? 'VIP Ticket Price' : 'VIP票价'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-medium text-sm">LC</span>
                <input type="number" min="0" step="0.01" value={vipPrice || ''} onChange={e => setVipPrice(parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="0.00" />
              </div>
            </div>
          </div>
          <div className="pt-2 border-t border-gray-100">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-400 mb-1 block">{isEn ? 'Default Service Fee' : '默认手续费'}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 font-medium text-sm">LC</span>
                  <input type="number" min="0" step="0.01" value={defaultServiceFee || ''} onChange={e => setDefaultServiceFee(parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="0.00" />
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400">{isEn ? 'Prices are in Lanke Coins. Default service fee will pre-fill the print modal.' : '价格以兰克币计价。默认手续费将在打印弹窗中自动填入。'}</p>
        </div>

        {/* Cover Image */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('session_cover_image')}</h3>
          <div className="flex items-center gap-3">
            {coverImage && (
              <div className="relative">
                <img src={coverImage} alt="" className="w-24 h-16 object-cover rounded-xl" />
                <button onClick={() => setCoverImage('')} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5">
                  <X size={10} />
                </button>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-1.5 text-xs text-sky-600 border border-sky-200 px-3 py-2 rounded-xl cursor-pointer hover:bg-sky-50 transition-colors">
                <Image size={14} />
                {uploadingImage ? '上传中...' : '上传封面'}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              <input
                value={coverImage}
                onChange={e => { setCoverImage(e.target.value); setUploadError(''); }}
                placeholder="或粘贴图片 URL"
                className="w-full border border-gray-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              {uploadError && (
                <p className="text-xs text-red-500">{uploadError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('session_description')}</h3>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div ref={editorRef} style={{ minHeight: 260 }} />
          </div>
        </div>

        {/* Booking Notice */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {isEn ? 'Booking Notice' : '订票须知'}
          </h3>
          <p className="text-xs text-gray-400">
            {isEn ? 'Displayed before booking confirmation. Leave empty to skip.' : '用户下单确认前弹窗展示，留空则不弹出。'}
          </p>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div ref={noticeEditorRef} style={{ minHeight: 180 }} />
          </div>
        </div>

        {/* Seat Cancellation Confirmation */}
          {cancelSeatReg && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                    <AlertCircle size={20} className="text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">取消用户预订</h3>
                    <p className="text-xs text-gray-500 mt-0.5">确认后将取消该预订并释放座位，同时向用户发送通知</p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">姓名</span>
                    <span className="font-medium text-gray-900 text-xs">{cancelSeatReg.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">联系方式</span>
                    <span className="font-medium text-gray-900 text-xs">{cancelSeatReg.phone || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">订单号</span>
                    <span className="font-mono font-medium text-sky-600 text-xs">{cancelSeatReg.ticket_code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">座位</span>
                    <span className="font-bold text-gray-900 text-xs">{cancelSeatReg.seat_name}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCancelSeatReg(null)}
                    className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    返回
                  </button>
                  <button
                    onClick={confirmCancelSeat}
                    disabled={cancelSeatSaving}
                    className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    {cancelSeatSaving ? '取消中…' : '确认取消预订'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Seat Block Management — visible once the session has been saved and has a seating chart */}
        {savedSessionId && hasSeatingChart && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <button
              type="button"
              onClick={toggleBlockSection}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Ban size={14} className="text-gray-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">座位管理</span>
                {blockSeats.filter(s => s.is_blocked).length > 0 && (
                  <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    已屏蔽 {blockSeats.filter(s => s.is_blocked).length} 座
                  </span>
                )}
              </div>
              <span className="text-gray-400 text-sm">{blockSectionOpen ? '▲' : '▼'}</span>
            </button>

            {blockSectionOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
                {/* Data stats */}
                {blockSeats.length > 0 && (() => {
                  const totalSeats = blockSeats.length;
                  const blockedSeats = blockSeats.filter(s => s.is_blocked).length;
                  const soldSeats = blockSeats.filter(s => s.is_booked).length;
                  const availableSeats = totalSeats - blockedSeats - soldSeats;
                  const sellRate = totalSeats > 0 ? ((soldSeats / totalSeats) * 100).toFixed(1) : '0';
                  return (
                    <div className="grid grid-cols-2 gap-2 pt-3">
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-lg font-bold text-gray-800">{totalSeats}</p>
                        <p className="text-[10px] text-gray-400">{isEn ? 'Total Seats' : '总座位'}</p>
                      </div>
                      <div className="bg-sky-50 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-lg font-bold text-sky-700">{soldSeats}</p>
                        <p className="text-[10px] text-sky-400">{isEn ? 'Sold' : '已售'}</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-lg font-bold text-emerald-700">{availableSeats}</p>
                        <p className="text-[10px] text-emerald-400">{isEn ? 'Available' : '剩余'}</p>
                      </div>
                      <div className="bg-amber-50 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-lg font-bold text-amber-700">{sellRate}%</p>
                        <p className="text-[10px] text-amber-400">{isEn ? 'Sell Rate' : '售出率'}</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Sold orders list */}
                {soldOrders.length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500">{isEn ? 'Sold Orders' : '已售订单'}</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {soldOrders.map((r, i) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 text-xs">
                          <span className="font-medium text-gray-700">{r.name}</span>
                          <span className="text-gray-400">{r.seat_name}</span>
                          <span className={`font-medium px-1.5 py-0.5 rounded-full text-[10px] ${
                            r.ticket_type === 'child' ? 'bg-teal-100 text-teal-700' :
                            r.ticket_type === 'concession' ? 'bg-amber-100 text-amber-700' :
                            'bg-sky-100 text-sky-700'
                          }`}>{TICKET_TYPE_LABELS[r.ticket_type ?? 'adult'].cn}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {blockToast && (
                  <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 text-xs text-sky-700">{blockToast}</div>
                )}

                {blockLoading ? (
                  <p className="text-center text-sm text-gray-400 py-6">加载中…</p>
                ) : blockSeats.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-6">尚未生成座位图，请先保存座位配置</p>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-400 pt-3">点击<span className="text-gray-600 font-medium">空闲座位</span>可选中后批量屏蔽/解除；点击<span className="text-sky-600 font-medium">已售座位</span>可取消用户预订</p>
                    <SeatMap
                      seats={blockSeats}
                      rows={seatRows}
                      seatsPerRow={seatsPerRow}
                      screenDirection={screenDirection}
                      selectedSeatId={null}
                      onSeatClick={() => {}}
                      adminBlockMode
                      adminSelectedIds={blockSelected}
                      onAdminSeatClick={handleBlockSeatClick}
                      stageCenterCol={stageCenterCol}
                    />

                    {blockSelected.size > 0 && (
                      <div className="space-y-2 pt-1">
                        <p className="text-sm font-medium text-gray-700">
                          已选 <span className="text-sky-600">{blockSelected.size}</span> 个座位
                        </p>
                        <input
                          value={blockReason}
                          onChange={e => setBlockReason(e.target.value)}
                          placeholder="屏蔽原因（选填，如：维修、预留）"
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        />
                        <div className="flex gap-2">
                          {[...blockSelected].some(id => !blockSeats.find(s => s.id === id)?.is_blocked) && (
                            <button
                              type="button"
                              onClick={() => applyBlockSeats(true)}
                              disabled={blockSaving}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                            >
                              <Ban size={13} /> 屏蔽
                            </button>
                          )}
                          {[...blockSelected].some(id => blockSeats.find(s => s.id === id)?.is_blocked) && (
                            <button
                              type="button"
                              onClick={() => applyBlockSeats(false)}
                              disabled={blockSaving}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                            >
                              <LayoutGrid size={13} /> 解除屏蔽
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setBlockSelected(new Set())}
                            className="px-4 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
