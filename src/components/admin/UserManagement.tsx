import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, callEdgeFunction, UserProfile, Registration, SeatMapRow, Session } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Plus, Trash2, User, Users, Pencil, TicketCheck, PackageOpen, X, Ticket, RefreshCw, Printer, AlertTriangle } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { renderTicketToCanvas, downloadTicket } from '../../lib/ticketGenerator';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';
import ProxyBookingModal from './ProxyBookingModal';
import ReprintConfirmModal from './ReprintConfirmModal';
import SeatMap from '../SeatMap';

type UserRow = UserProfile & { username: string };

export default function UserManagement() {
  const { t } = useTranslation();
  const [ordersUser, setOrdersUser] = useState<UserRow | null>(null);
  const [toastMsg, setToastMsg] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToastMsg({ msg, type });
    setTimeout(() => setToastMsg(null), 3000);
  }

  if (ordersUser) {
    return (
      <>
        {toastMsg && <Toast message={toastMsg.msg} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
        <UserOrdersPage
          user={ordersUser}
          onClose={() => setOrdersUser(null)}
          showToast={showToast}
        />
      </>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {toastMsg && <Toast message={toastMsg.msg} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
      <h2 className="text-lg font-bold text-gray-900">{t('users')}</h2>
      <UserList onViewOrders={setOrdersUser} showToast={showToast} />
    </div>
  );
}

function UserList({ onViewOrders }: { onViewOrders: (user: UserRow) => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Edit state
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [updating, setUpdating] = useState(false);

  // Proxy booking
  const [proxyUser, setProxyUser] = useState<UserRow | null>(null);

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    const { data } = await supabase.from('user_profiles').select('*').order('created_at', { ascending: false });
    setUsers((data ?? []).map(u => ({
      ...u,
      username: u.display_name || u.id.slice(0, 8),
    })));
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleCreate() {
    if (!formUsername.trim() || !formPassword.trim() || !formPhone.trim()) return;
    setCreating(true);
    try {
      const { data, error } = await callEdgeFunction('create-user', {
        username: formUsername.trim(),
        password: formPassword,
        phone: formPhone.trim(),
        display_name: formUsername.trim(),
      });

      if (error || !data?.success) {
        showToast((data as any)?.error || error || t('create_user_failed'), 'error');
        setCreating(false);
        return;
      }

      showToast(t('user_created'));
      setFormUsername('');
      setFormPassword('');
      setFormPhone('');
      setShowForm(false);
      await fetchUsers();
    } catch (e: any) {
      showToast(e.message || t('create_user_failed'), 'error');
    }
    setCreating(false);
  }

  async function handleDelete(uid: string) {
    try {
      const { data, error } = await callEdgeFunction('delete-user', { user_id: uid });
      if (error || !data?.success) {
        showToast((data as any)?.error || error || t('operation_failed'), 'error');
      } else {
        showToast(t('delete_user_success'));
        await fetchUsers();
      }
    } catch (e: any) {
      showToast(e.message || t('operation_failed'), 'error');
    }
    setConfirm(null);
  }

  function openEdit(u: UserRow) {
    setEditUser(u);
    setEditDisplayName(u.display_name || '');
    setEditPhone(u.phone || '');
  }

  async function handleUpdate() {
    if (!editUser) return;
    setUpdating(true);
    try {
      const { error } = await supabase.from('user_profiles').update({
        display_name: editDisplayName.trim(),
        phone: editPhone.trim(),
      }).eq('id', editUser.id);

      if (error) {
        showToast(error.message || t('operation_failed'), 'error');
      } else {
        showToast(t('update_user_success'));
        setEditUser(null);
        await fetchUsers();
      }
    } catch (e: any) {
      showToast(e.message || t('operation_failed'), 'error');
    }
    setUpdating(false);
  }

  return (
    <div className="space-y-3">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {confirm && (
        <ConfirmDialog
          title={t('delete_user')}
          message={t('confirm_delete_user')}
          onConfirm={() => handleDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Proxy Booking Modal */}
      {proxyUser && (
        <ProxyBookingModal
          user={proxyUser}
          onClose={() => setProxyUser(null)}
          onSuccess={() => showToast('代客预约成功')}
        />
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setEditUser(null)}>
          <div
            className="bg-white rounded-t-3xl w-full max-w-md p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-bold text-gray-900 text-base">{t('edit_user')}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('display_name')}</label>
                <input
                  value={editDisplayName}
                  onChange={e => setEditDisplayName(e.target.value)}
                  placeholder={t('display_name')}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('phone')}</label>
                <input
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  placeholder={t('phone')}
                  type="tel"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                <p className="text-[10px] text-amber-600 mt-1">修改手机号将同步更新登录凭证</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1 pb-2">
              <button
                onClick={() => setEditUser(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleUpdate}
                disabled={updating}
                className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
              >
                {updating ? '...' : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium py-3 rounded-xl transition-colors"
        >
          <Plus size={16} /> {t('add_user')}
        </button>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
          <h3 className="font-semibold text-gray-900 text-sm">{t('add_user')}</h3>
          <input
            value={formUsername}
            onChange={e => setFormUsername(e.target.value)}
            placeholder={t('username')}
            autoComplete="off"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            required
          />
          <input
            type="password"
            value={formPassword}
            onChange={e => setFormPassword(e.target.value)}
            placeholder={t('password')}
            autoComplete="new-password"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            required
          />
          <input
            value={formPhone}
            onChange={e => setFormPhone(e.target.value)}
            placeholder={t('phone') + ' (必填，用于登录)'}
            type="tel"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            required
          />
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">{t('cancel')}</button>
            <button
              onClick={handleCreate}
              disabled={creating || !formUsername.trim() || !formPassword.trim() || !formPhone.trim()}
              className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
            >
              {creating ? '...' : t('save')}
            </button>
          </div>
        </div>
      )}

      {users.length === 0 ? (
        <div className="text-center py-10">
          <Users size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">{t('no_data')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-sky-50 rounded-xl flex items-center justify-center">
                    <User size={16} className="text-sky-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{u.username}</p>
                    <p className="text-xs text-gray-400">
                      {u.phone ? u.phone : <span className="text-amber-500">未填手机号</span>}
                      {' · '}{new Date(u.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <button
                    onClick={() => onViewOrders(u)}
                    className="flex items-center gap-1 text-xs text-sky-600 border border-sky-200 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors"
                  >
                    <PackageOpen size={12} /> 查看订单
                  </button>
                  <button
                    onClick={() => setProxyUser(u)}
                    className="flex items-center gap-1 text-xs text-emerald-600 border border-emerald-200 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    <TicketCheck size={12} /> 代客预约
                  </button>
                  <button
                    onClick={() => openEdit(u)}
                    className="flex items-center gap-1 text-xs text-sky-600 border border-sky-200 px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors"
                  >
                    <Pencil size={12} /> {t('edit')}
                  </button>
                  <button
                    onClick={() => setConfirm(u.id)}
                    className="flex items-center gap-1 text-xs text-red-500 border border-red-200 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={12} /> {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── UserOrdersPage ──────────────────────────────────────────────────────────

function checkVerifyTimeWindow(order: Registration): 'before' | 'within' | 'past' | 'no_window' {
  const s = order.sessions as any;
  if (!s?.verification_start || !s?.verification_end) return 'no_window';
  const now = new Date();
  const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const start = (s.verification_start as string).slice(0, 5);
  const end = (s.verification_end as string).slice(0, 5);
  if (cur < start) return 'before';
  if (cur > end) return 'past';
  return 'within';
}

function UserOrdersPage({
  user,
  onClose,
  showToast,
}: {
  user: UserRow;
  onClose: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const { user: adminUser, profile } = useAuth();
  const [orders, setOrders] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduleOrder, setRescheduleOrder] = useState<Registration | null>(null);
  const [verifyConfirm, setVerifyConfirm] = useState<Registration | null>(null);
  const [expiredVerify, setExpiredVerify] = useState<Registration | null>(null);
  const [printingOrder, setPrintingOrder] = useState<Registration | null>(null);
  const [showReprintConfirm, setShowReprintConfirm] = useState(false);
  const [pendingPrintOrder, setPendingPrintOrder] = useState<Registration | null>(null);
  const [reprintCountForConfirm, setReprintCountForConfirm] = useState(0);
  const printCanvasRef = useRef<HTMLCanvasElement>(null);
  const printQrRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchOrders(); }, [user.id]);

  async function fetchOrders() {
    setLoading(true);
    const { data } = await supabase
      .from('registrations')
      .select('*, sessions(name, session_date, start_time, end_time, verification_start, verification_end), seats(seat_name)')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    setOrders((data as Registration[]) ?? []);
    setLoading(false);
  }

  function handlePrint(order: Registration) {
    const reprintCount = (order as any).reprint_count ?? 0;
    const nextCount = reprintCount + 1;
    if (nextCount >= 2) {
      setPendingPrintOrder(order);
      setReprintCountForConfirm(nextCount);
      setShowReprintConfirm(true);
    } else {
      executePrint(order);
    }
  }

  async function executePrint(order: Registration) {
    setPrintingOrder(order);
    await new Promise(resolve => setTimeout(resolve, 150));
    
    try {
      const canvas = printCanvasRef.current;
      if (!canvas) {
        return;
      }
      const qrEl = printQrRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
      
      const reprintCount = (order as any).reprint_count ?? 0;
      const newReprintCount = reprintCount + 1;
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, reprint_count: newReprintCount } as any : o));
      
      supabase.rpc('admin_increment_reprint_count', { p_registration_id: order.id }).catch(() => {});
      
      const isReprint = newReprintCount > 1;
      const s = order.sessions as any;
      renderTicketToCanvas({
        canvas, qrEl,
        ticketCode:        order.ticket_code,
        sessionName:       s?.name ?? '—',
        sessionDate:       s?.session_date ?? '—',
        startTime:         s?.start_time ?? '00:00',
        endTime:           s?.end_time ?? '00:00',
        verificationStart: s?.verification_start,
        verificationEnd:   s?.verification_end,
        name:              order.name,
        phone:             order.phone,
        seatName:          (order as any).seats?.seat_name,
        operatorName:      profile?.username ?? '系统',
        orderTime:         new Date(order.created_at).toLocaleString('zh-CN', { hour12: false }),
        isSupplementary:   order.is_supplementary,
        isReprint,
        orderStatus:       order.status,
      });
      downloadTicket(canvas, order.ticket_code);
    } catch (err) {
      console.error('Print error:', err);
    } finally {
      setPrintingOrder(null);
    }
  }

  function handleReprintConfirm() {
    setShowReprintConfirm(false);
    if (pendingPrintOrder) {
      executePrint(pendingPrintOrder);
    }
  }

  function handleReprintCancel() {
    setShowReprintConfirm(false);
    setPendingPrintOrder(null);
  }

  async function handleCancel() {
    if (!cancelId) return;
    setCancelling(true);
    const { data, error } = await supabase.rpc('admin_cancel_registration', { p_registration_id: cancelId });
    setCancelling(false);
    setCancelId(null);
    if (error || (data as any)?.success === false) {
      showToast((data as any)?.error || error?.message || '取消失败', 'error');
    } else {
      showToast('订单已取消', 'success');
      fetchOrders();
    }
  }

  function handleVerifyClick(order: Registration) {
    const window = checkVerifyTimeWindow(order);
    if (window === 'past') {
      setExpiredVerify(order);
    } else {
      setVerifyConfirm(order);
    }
  }

  async function doVerify(order: Registration, newStatus: 'used' | 'expired') {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('registrations')
      .update({ status: newStatus, validated_at: now, validated_by: adminUser?.id ?? null })
      .eq('id', order.id)
      .eq('status', 'active');
    if (error) {
      showToast('核销失败', 'error');
    } else {
      if (newStatus === 'used') {
        await supabase.from('validation_logs').insert({
          registration_id: order.id,
          ticket_code: order.ticket_code,
          admin_id: adminUser?.id ?? null,
          scanned_at: now,
        });
        showToast('核销成功');
      } else {
        showToast('已标记为已过期');
      }
      fetchOrders();
    }
  }

  const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
    active:    { color: 'text-emerald-700', bg: 'bg-emerald-100', label: '进行中' },
    used:      { color: 'text-gray-500',    bg: 'bg-gray-100',    label: '已使用' },
    cancelled: { color: 'text-red-600',     bg: 'bg-red-100',     label: '已取消' },
    expired:   { color: 'text-amber-600',   bg: 'bg-amber-100',   label: '已过期' },
  };

  const sourceLabels: Record<string, string> = {
    user: '用户自订',
    admin: '管理员代订',
    front_desk: '前台售票',
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Hidden print canvas + QR */}
      <canvas ref={printCanvasRef} className="hidden" />
      <div ref={printQrRef} className="hidden" aria-hidden="true">
        {printingOrder && <QRCodeCanvas value={printingOrder.ticket_code} size={240} level="H" />}
      </div>
      {rescheduleOrder && (
        <UserRescheduleModal
          reg={rescheduleOrder}
          onClose={() => setRescheduleOrder(null)}
          onSuccess={() => {
            setRescheduleOrder(null);
            showToast('换座成功', 'success');
            fetchOrders();
          }}
        />
      )}
      {cancelId && (
        <ConfirmDialog
          title="取消订单"
          message="确定要取消此订单吗？取消后座位将被释放。"
          onConfirm={handleCancel}
          onCancel={() => setCancelId(null)}
        />
      )}
      {verifyConfirm && (
        <ConfirmDialog
          title="确认核销"
          message="确定要核销此票吗？核销后无法撤销。"
          onConfirm={() => { doVerify(verifyConfirm, 'used'); setVerifyConfirm(null); }}
          onCancel={() => setVerifyConfirm(null)}
        />
      )}
      {expiredVerify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
              <h3 className="font-bold text-gray-900 text-base">核销时间已过</h3>
            </div>
            <p className="text-sm text-gray-600 mb-5">该场次的核销时间已过，请选择操作方式。</p>
            <div className="flex gap-2">
              <button
                onClick={() => { doVerify(expiredVerify, 'used'); setExpiredVerify(null); }}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                强制核销
              </button>
              <button
                onClick={() => { doVerify(expiredVerify, 'expired'); setExpiredVerify(null); }}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                标记已过期
              </button>
            </div>
            <button onClick={() => setExpiredVerify(null)} className="w-full mt-2 text-xs text-gray-400 py-1.5">取消</button>
          </div>
        </div>
      )}
      <ReprintConfirmModal
        show={showReprintConfirm}
        reprintCount={reprintCountForConfirm}
        onConfirm={handleReprintConfirm}
        onCancel={handleReprintCancel}
      />
      <div className="bg-gradient-to-r from-sky-600 to-cyan-500 text-white px-6 py-4 flex items-center gap-4 sticky top-0 z-10 shadow">
        <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
          <X size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-lg">{user.display_name || user.id.slice(0, 8)} 的订单</p>
          {user.phone && <p className="text-sm text-sky-200">{user.phone}</p>}
        </div>
        <button onClick={fetchOrders} className="p-2 hover:bg-white/20 rounded-lg transition-colors" title="刷新">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="flex-1 p-6">
        {loading ? (
          <p className="text-center text-sm text-gray-400 py-12">加载中...</p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Ticket size={40} className="text-gray-200 mb-3" />
            <p className="text-sm text-gray-400">暂无订单记录</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {orders.map(order => {
              const s = order.sessions as any;
              const cfg = statusConfig[order.status] ?? statusConfig.active;
              const isActive = order.status === 'active';
              return (
                <div key={order.id} className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden flex flex-col">
                  <div className={`h-1.5 ${isActive ? 'bg-gradient-to-r from-sky-500 to-cyan-500' : 'bg-gray-200'}`} />
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900">{order.name}</p>
                        <p className="text-sm text-gray-500 truncate">
                          {s ? `${s.name} · ${s.session_date} ${s.start_time?.slice(0, 5)}–${s.end_time?.slice(0, 5)}` : '场次已删除'}
                        </p>
                        {(order as any).seats?.seat_name && (
                          <p className="text-sm text-sky-600 font-medium mt-0.5">座位：{(order as any).seats.seat_name}</p>
                        )}
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-mono text-xs text-gray-400">{order.ticket_code}</span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                        {sourceLabels[order.order_source] ?? order.order_source}
                      </span>
                      {order.is_supplementary && (
                        <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium">补票</span>
                      )}
                      {order.was_force_booked && (
                        <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">强制预订</span>
                      )}
                      {order.reschedule_count > 0 && (
                        <span className="text-xs px-2 py-0.5 bg-sky-100 text-sky-600 rounded-full">已换座×{order.reschedule_count}</span>
                      )}
                      {(order.reprint_count ?? 0) > 0 && (
                        <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold">补打{order.reprint_count}次</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mb-3">{new Date(order.created_at).toLocaleString()}</p>
                    <div className="flex gap-2 flex-wrap mt-auto">
                      <button
                        onClick={() => handlePrint(order)}
                        disabled={printingOrder?.id === order.id}
                        className="flex items-center gap-1.5 text-sm text-sky-600 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-50 transition-colors disabled:opacity-50"
                      >
                        <Printer size={14} /> {printingOrder?.id === order.id ? '生成中…' : '打印票面'}
                      </button>
                      {isActive && order.seat_id && (order.reschedule_count ?? 0) === 0 && (
                        <button
                          onClick={() => setRescheduleOrder(order)}
                          className="text-sm text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition-colors flex items-center gap-1.5"
                        >
                          <RefreshCw size={14} /> 协助换座
                        </button>
                      )}
                      {isActive && (
                        <button
                          onClick={() => handleVerifyClick(order)}
                          className="text-sm text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors flex items-center gap-1.5"
                        >
                          <TicketCheck size={14} /> 核销
                        </button>
                      )}
                      {isActive && (
                        <button
                          onClick={() => setCancelId(order.id)}
                          disabled={cancelling}
                          className="text-sm text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          取消订单
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function UserRescheduleModal({
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
      return;
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
  const isForceBooking = pendingForce || (selectedSeat?.is_blocked ?? false);
  const actualRows = seats.length > 0 ? Math.max(...seats.map(s => s.row_index)) : (session?.seat_rows ?? 1);
  const actualCols = seats.length > 0 ? Math.max(...seats.map(s => s.col_index)) : (session?.seats_per_row ?? 1);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-lg flex flex-col" style={{ maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 text-base">协助换座</h3>
            <p className="text-xs text-gray-400">{reg.name} · {reg.phone} · 当前：{(reg as any).seats?.seat_name || '-'}</p>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            管理员可强制换座至屏蔽座位——点击屏蔽座位后需确认"强制换座"
          </p>

          {/* Force booking warning */}
          {showForceWarning && selectedSeat && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-800 text-sm">该座位已屏蔽</p>
                  <p className="text-amber-700 text-xs mt-1">
                    座位 <strong>{selectedSeat.seat_name}</strong> 当前处于屏蔽状态
                    {selectedSeat.block_reason ? `（原因：${selectedSeat.block_reason}）` : ''}。
                    确认强制换座后，订单将换至该座位；若此订单日后被取消，座位将自动恢复为屏蔽状态。
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={cancelForce} className="flex-1 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm hover:bg-amber-100 transition-colors">
                  取消选择
                </button>
                <button onClick={confirmForce} className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-semibold transition-colors">
                  确认强制换座
                </button>
              </div>
            </div>
          )}

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

          {selectedSeat && !showForceWarning && (
            <div className={`border rounded-xl px-4 py-2.5 ${isForceBooking ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
              <p className={`text-xs ${isForceBooking ? 'text-amber-600' : 'text-teal-600'}`}>
                {isForceBooking ? '新座位（强制换座）' : '新座位'}
              </p>
              <p className={`font-bold ${isForceBooking ? 'text-amber-700' : 'text-teal-700'}`}>
                {selectedSeat.seat_name}
                {isForceBooking && <span className="text-xs font-normal ml-1.5">（屏蔽座位）</span>}
              </p>
            </div>
          )}

          {isForceBooking && !showForceWarning && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 font-medium">强制换座模式：将换至屏蔽座位 {selectedSeat?.seat_name}，取消后该座位会恢复为屏蔽状态</p>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>
        <div className="px-5 pb-6 pt-3 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button onClick={handleClose} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedSeatId || submitting || locking || showForceWarning}
            className={`flex-1 py-3 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors ${
              isForceBooking ? 'bg-amber-500 hover:bg-amber-400' : 'bg-teal-500 hover:bg-teal-400'
            }`}
          >
            {submitting ? '换座中...' : locking ? '锁定中...' : isForceBooking ? '强制换座确认' : selectedSeatId ? `确认换至 ${selectedSeat?.seat_name}` : '请选择新座位'}
          </button>
        </div>
      </div>
    </div>
  );
}
