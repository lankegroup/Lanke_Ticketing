import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, callEdgeFunction, Registration, FeedbackTicket, formatSeatName, SeatMapRow, Session, getDisplayStatus } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Ticket, LogOut, LogIn, ChevronRight, Settings, MessageSquare, KeyRound, User, X, Send, Pencil, Headphones, Trash2, PackageOpen, RefreshCw, Coins, Package, History, Info, Crown } from 'lucide-react';
import QRCodeView from './QRCodeView';
import LoginModal from './LoginModal';
import Toast from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import CancelConfirmModal, { type CancelPreviewData } from '../CancelConfirmModal';
import ChatView from './ChatView';
import SeatMap from '../SeatMap';

type SubView = 'main' | 'feedback' | 'change_password' | 'edit_profile' | 'chat' | 'orders' | 'balance';

export default function MyPage() {
  const { t, i18n } = useTranslation();
  const { user, userProfile, signOut, refreshUserProfile } = useAuth();
  const [tickets, setTickets] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Registration | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [subView, setSubView] = useState<SubView>('main');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [isVip, setIsVip] = useState(false);
  const [vipExpireAt, setVipExpireAt] = useState<string | null>(null);

  const isEn = i18n.language === 'en';

  useEffect(() => {
    if (!user) return;
    fetchBalance();
    checkVipStatus();

    const ch = supabase
      .channel(`balance:user:${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_balances', filter: `user_id=eq.${user.id}` }, (payload) => {
        setBalance(String((payload.new as any).balance));
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [user]);

  async function fetchBalance() {
    try {
      console.log('fetchBalance called, user.id:', user?.id);
      const { data, error } = await supabase.rpc('get_user_lcoin_balance', { p_user_id: user?.id });
      console.log('fetchBalance result:', { data, error, dataType: typeof data, dataString: JSON.stringify(data) });
      if (error) {
        console.error('Failed to fetch balance:', error);
        setBalance('0');
        return;
      }
      let bal: number | null = null;
      if (data !== null && data !== undefined) {
        if (typeof data === 'object') {
          bal = (data as any).balance ?? (data as any).l_coin_balance ?? (data as any).lcoin ?? null;
        } else if (typeof data === 'number' || typeof data === 'string') {
          bal = Number(data);
        }
      }
      const finalBalance = (bal !== null && !isNaN(bal)) ? String(bal) : '0';
      console.log('Setting balance to:', finalBalance);
      setBalance(finalBalance);
    } catch (err) {
      console.error('Failed to fetch balance:', err);
      setBalance('0');
    }
  }

  async function checkVipStatus() {
    if (!user?.id) return;
    try {
      const { data } = await supabase.rpc('check_and_update_vip_status', { p_user_id: user.id });
      if (data?.success) {
        setIsVip(data.is_vip || false);
      }
      const { data: profileData } = await supabase.from('user_profiles').select('is_vip, vip_expire_at').eq('id', user.id).single();
      if (profileData) {
        const expireAt = profileData.vip_expire_at;
        const isValid = expireAt && new Date(expireAt) > new Date();
        setIsVip(profileData.is_vip && isValid);
        setVipExpireAt(isValid ? expireAt : null);
      }
    } catch (err) {
      console.error('Failed to check VIP status:', err);
    }
  }

  function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'warning') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    if (!user) {
      setTickets([]);
      setSelectedTicket(null);
      setSubView('main');
      return;
    }
    fetchTickets();

    function handleRegUpdate(payload: any) {
      setTickets(prev => prev.map(tk => tk.id === payload.new.id ? { ...tk, ...payload.new } : tk));
      setSelectedTicket(prev => prev?.id === payload.new.id ? { ...prev, ...payload.new } : prev);
    }

    const ch1 = supabase
      .channel(`mypage:regs:owner:${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'registrations', filter: `user_id=eq.${user.id}` }, handleRegUpdate)
      .subscribe();

    const ch2 = supabase
      .channel(`mypage:regs:buyer:${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'registrations', filter: `buyer_user_id=eq.${user.id}` }, handleRegUpdate)
      .subscribe();

    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [user]);

  async function handleSignOut() {
    setTickets([]);
    setSelectedTicket(null);
    setSubView('main');
    await signOut();
  }

  async function fetchTickets() {
    setLoading(true);
    try {
      await supabase.rpc('expire_past_tickets');
      await supabase.rpc('auto_manage_session_status');
    } catch { /* ignore */ }
    const { data } = await supabase
      .from('registrations')
      .select('*, sessions(name, session_date, start_time, end_time), seats(seat_name)')
      .or(`user_id.eq.${user!.id},buyer_user_id.eq.${user!.id}`)
      .not('status', 'in', '("cancelled","expired")')
      .order('created_at', { ascending: false });
    setTickets(data ?? []);
    setLoading(false);
  }

  // 鈹€鈹€ Sub-views 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  if (selectedTicket) {
    return <QRCodeView ticket={selectedTicket} onBack={() => { setSelectedTicket(null); fetchTickets(); }} />;
  }

  if (subView === 'chat') {
    return (
      <div className="fixed inset-0 z-50 bg-gray-50 overflow-hidden">
        <div className="h-full flex flex-col max-w-md mx-auto bg-white relative">
          <ChatView isEn={isEn} onBack={() => setSubView('main')} />
        </div>
      </div>
    );
  }

  if (subView === 'orders') {
    return (
      <OrdersView
        tickets={tickets}
        loading={loading}
        isEn={isEn}
        onBack={() => setSubView('main')}
        onViewTicket={(tk) => setSelectedTicket(tk)}
        onRefresh={fetchTickets}
        showToast={showToast}
      />
    );
  }

  if (subView === 'edit_profile') {
    return <EditProfileView onBack={() => setSubView('main')} />;
  }

  if (subView === 'feedback') {
    return <FeedbackView onBack={() => { setSubView('main'); fetchTickets(); }} />;
  }

  if (subView === 'balance') {
    return <BalanceView balance={balance} onBack={() => setSubView('main')} />;
  }

  if (subView === 'change_password') {
    return <ChangePasswordView onBack={() => setSubView('main')} />;
  }

  // 鈹€鈹€ Main view 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  const activeTickets = tickets.filter(tk => tk.status === 'active');

  return (
    <div className="p-4 space-y-4">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />

      {/* User card */}
      <div className={`rounded-2xl shadow-sm border p-4 ${isVip ? 'bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 border-amber-200' : 'bg-white border-gray-100'}`}>
        {user ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isVip ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg' : 'bg-sky-100'}`}>
                {isVip ? <Crown size={24} className="text-white" /> : <User size={20} className={isVip ? 'text-white' : 'text-sky-500'} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`font-bold text-gray-900 truncate ${isEn ? 'text-base' : 'text-lg'}`}>
                    {userProfile?.display_name || user.email?.split('@')[0] || ''}
                  </p>
                  {isVip && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold rounded-full shadow-sm">
                      <Crown size={10} /> VIP
                    </span>
                  )}
                </div>
                {userProfile?.phone && <p className="text-xs text-gray-500">{userProfile.phone}</p>}
                {isVip && vipExpireAt && (
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                    <Crown size={10} />
                    {isEn ? 'Valid until' : '有效期至'}: {new Date(vipExpireAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setSubView('edit_profile')}
                  className={`flex-1 flex items-center justify-center gap-1.5 border rounded-xl py-2 text-sm transition-colors ${isVip ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  <Pencil size={14} /> {t('edit_profile')}
                </button>
                <button
                  onClick={() => setSubView('change_password')}
                  className={`flex-1 flex items-center justify-center gap-1.5 border rounded-xl py-2 text-sm transition-colors ${isVip ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  <KeyRound size={14} /> {t('change_password')}
                </button>
              </div>
              <button
                onClick={handleSignOut}
                className={`w-full flex items-center justify-center gap-1.5 border rounded-xl py-2 text-sm transition-colors ${isVip ? 'border-red-300 text-red-500 hover:bg-red-50' : 'border-red-200 text-red-500 hover:bg-red-50'}`}
              >
                <LogOut size={14} /> {t('logout')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowLoginModal(true)}
            className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            <LogIn size={16} /> {t('login')}
          </button>
        )}
      </div>

      {user && (
        <>
          {/* My Orders entry */}
          <button
            onClick={() => setSubView('orders')}
            className={`w-full rounded-2xl shadow-sm border p-4 flex items-center gap-3 text-left transition-colors ${isVip ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 hover:border-amber-300' : 'bg-white border-gray-100 hover:border-sky-200'}`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isVip ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-sky-50'}`}>
              <PackageOpen size={20} className={isVip ? 'text-white' : 'text-sky-500'} />
            </div>
            <div className="flex-1">
              <p className={`font-semibold text-gray-900 ${isEn ? 'text-sm' : 'text-base'}`}>{isEn ? 'My Orders' : '我的订单'}</p>
              <p className={`text-gray-400 ${isEn ? 'text-xs' : 'text-sm'}`}>{isEn ? 'All bookings & history' : '查看全部预订记录'}</p>
            </div>
            {tickets.length > 0 && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isVip ? 'bg-amber-100 text-amber-600' : 'bg-sky-100 text-sky-600'}`}>{activeTickets.length}</span>
            )}
            <ChevronRight size={16} className="text-gray-300" />
          </button>

          {/* Balance Management */}
          <button
            onClick={() => setSubView('balance')}
            className="w-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-2xl shadow-sm p-4 flex items-center gap-3 text-left hover:from-amber-400 hover:to-amber-300 transition-all"
          >
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Coins size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white">{isEn ? 'Lanke Coins Balance' : '兰克币余额'}</p>
              <p className="text-white/80 text-sm">{balance} {isEn ? 'Lanke Coins' : '兰克币'}</p>
            </div>
            <ChevronRight size={16} className="text-white/70" />
          </button>

          {/* Feedback */}
          <button
            onClick={() => setSubView('feedback')}
            className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3 text-left hover:border-sky-200 transition-colors"
          >
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <MessageSquare size={20} className="text-amber-500" />
            </div>
            <div className="flex-1">
              <p className={`font-semibold text-gray-900 ${isEn ? 'text-sm' : 'text-base'}`}>{t('feedback_title')}</p>
              <p className={`text-gray-400 ${isEn ? 'text-xs' : 'text-sm'}`}>{t('my_feedback')}</p>
            </div>
            <ChevronRight size={16} className="text-gray-300" />
          </button>

          {/* Live chat */}
          <button
            onClick={() => setSubView('chat')}
            className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3 text-left hover:border-sky-200 transition-colors"
          >
            <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center">
              <Headphones size={20} className="text-sky-500" />
            </div>
            <div className="flex-1">
              <p className={`font-semibold text-gray-900 ${isEn ? 'text-sm' : 'text-base'}`}>{isEn ? 'Live Support' : '在线客服'}</p>
              <p className={`text-gray-400 ${isEn ? 'text-xs' : 'text-sm'}`}>{isEn ? 'Chat with our support team' : '与客服人员即时沟通'}</p>
            </div>
            <ChevronRight size={16} className="text-gray-300" />
          </button>
        </>
      )}

      {/* Admin portal */}
      <div className="pt-4 flex justify-center">
        <button
          onClick={() => window.location.href = '/admin'}
          className="flex items-center gap-1.5 text-gray-300 hover:text-gray-400 transition-colors text-xs"
        >
          <Settings size={13} />
          <span>{t('admin_portal')}</span>
        </button>
      </div>
    </div>
  );
}

// 鈹€鈹€鈹€ OrdersView 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function OrdersView({
  tickets, loading, isEn, onBack, onViewTicket, onRefresh, showToast,
}: {
  tickets: Registration[];
  loading: boolean;
  isEn: boolean;
  onBack: () => void;
  onViewTicket: (t: Registration) => void;
  onRefresh: () => void;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelPreview, setCancelPreview] = useState<CancelPreviewData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [localToast, setLocalToast] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [changeSeatTicket, setChangeSeatTicket] = useState<Registration | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  function showLocalToast(msg: string, type: 'success' | 'error' | 'warning' = 'warning') {
    setLocalToast({ msg, type });
    setTimeout(() => setLocalToast(null), 3500);
  }

  const statusConfig: Record<string, { color: string; bg: string }> = {
    active:    { color: 'text-emerald-700', bg: 'bg-emerald-100' },
    used:      { color: 'text-gray-500',    bg: 'bg-gray-100' },
    cancelled: { color: 'text-red-600',     bg: 'bg-red-100' },
    expired:   { color: 'text-amber-600',   bg: 'bg-amber-100' },
  };
  const statusLabels: Record<string, string> = {
    active:    t('status_active'),
    used:      t('status_used'),
    cancelled: t('status_cancelled'),
    expired:   t('status_expired'),
  };

  async function handleDelete(id: string) {
    setDeleting(true);
    console.log('handleDelete called with id:', id);
    const { data, error } = await supabase.rpc('client_delete_registration', { p_registration_id: id });
    setDeleting(false);
    setConfirmDelete(null);
    if (error || (data as any)?.success === false) {
      showLocalToast(t('operation_failed'), 'error');
    } else {
      showLocalToast(isEn ? 'Order deleted' : '订单已删除', 'success');
      onRefresh();
    }
  }

  async function handleCancel(id: string) {
    setCancelling(true);
    console.log('handleCancel called with id:', id);
    const { data, error } = await supabase.rpc('cancel_ticket', {
      p_registration_id: id,
      p_reason: 'user_cancel',
      p_operator_id: null,
    });
    setCancelling(false);
    setConfirmCancel(null);
    setCancelPreview(null);
    if (error || (data as any)?.success === false) {
      console.log('Cancel failed:', { error, data });
      const msg = (data as any)?.message || (data as any)?.error || t('operation_failed');
      showLocalToast(msg, 'error');
    } else {
      const result = data as any;
      const penaltyMsg = result.penalty_amount && result.penalty_amount > 0
        ? isEn 
          ? `Booking cancelled. Penalty: ${result.penalty_amount} LC, Refunded: ${result.refunded_lcoin} LC`
          : `订单已取消。扣除手续费：${result.penalty_amount} 兰克币，退回：${result.refunded_lcoin} 兰克币`
        : isEn 
          ? 'Booking cancelled, full refund processed'
          : '订单已取消，全额退款已处理';
      showLocalToast(penaltyMsg, 'success');
      onRefresh();
    }
  }

  async function handleCancelPreview(id: string) {
    const { data, error } = await supabase.rpc('get_cancel_preview', { p_registration_id: id });
    if (error || (data as any)?.success === false) {
      console.log('get_cancel_preview failed:', { error, data });
      showLocalToast(isEn ? 'Failed to get refund info' : '获取退票信息失败', 'error');
    } else {
      const preview = data as any;
      setCancelPreview({
        original_lcoin: preview.original_lcoin || 0,
        original_cash: preview.original_cash || 0,
        penalty_rate: preview.penalty_rate || 0,
        penalty_amount: preview.penalty_amount || 0,
        refund_amount: preview.refund_amount || 0,
        description: preview.description || '',
        hours_before: preview.hours_before || 0,
        has_cash_payment: preview.has_cash_payment || false,
        session_name: preview.session_name || '',
        ticket_code: preview.ticket_code || '',
      });
      setConfirmCancel(id);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {changeSeatTicket && (
        <ChangeSeatModal
          ticket={changeSeatTicket}
          isEn={isEn}
          onClose={() => setChangeSeatTicket(null)}
          onSuccess={() => {
            setChangeSeatTicket(null);
            showLocalToast(isEn ? 'Seat changed successfully' : '座位更换成功', 'success');
            onRefresh();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={isEn ? 'Delete Order' : '删除订单'}
          message={isEn
            ? 'Are you sure you want to delete this order? This cannot be undone.'
            : '确定要删除此订单吗？删除后将无法恢复。'}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {localToast && <Toast message={localToast.msg} type={localToast.type} onClose={() => setLocalToast(null)} />}
      {confirmCancel && (
        <CancelConfirmModal
          role="user"
          preview={cancelPreview}
          isEn={isEn}
          onConfirm={() => handleCancel(confirmCancel)}
          onCancel={() => { setConfirmCancel(null); setCancelPreview(null); }}
        />
      )}

      <div className="bg-gradient-to-r from-sky-600 to-cyan-500 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X size={18} />
        </button>
        <span className={`font-semibold ${isEn ? 'text-sm' : 'text-base'}`}>{isEn ? 'My Orders' : '我的订单'}</span>
        <span className="text-sky-200 text-xs">{tickets.length} {isEn ? 'total' : '记录数'}</span>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="ml-auto p-1.5 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
          title={isEn ? 'Refresh' : '刷新'}
        >
          <RefreshCw size={16} className={refreshing || loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-gray-400 py-12">{t('loading')}</p>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <Ticket size={28} className="text-gray-300" />
            </div>
            <p className={`font-semibold text-gray-700 mb-1 ${isEn ? 'text-sm' : 'text-base'}`}>{t('no_tickets')}</p>
            <p className={`text-gray-400 max-w-[200px] leading-relaxed ${isEn ? 'text-xs' : 'text-sm'}`}>{t('no_tickets_tip')}</p>
          </div>
        ) : (() => {
          const activeTickets = tickets.filter(tk => getDisplayStatus(tk) === 'active');
          const historicalTickets = tickets.filter(tk => getDisplayStatus(tk) !== 'active');

          function TicketCard({ ticket }: { ticket: Registration }) {
            const s = ticket.sessions as any;
            const sessionLabel = s
              ? `${s.name} - ${s.session_date} ${s.start_time?.slice(0, 5)}-${s.end_time?.slice(0, 5)}`
              : (isEn ? '(Session deleted)' : '（会场已删除）');
            const effectiveStatus = getDisplayStatus(ticket);
            const cfg = statusConfig[effectiveStatus] || statusConfig.active;
            const isActive = effectiveStatus === 'active';
            const isDeletable = effectiveStatus !== 'active';

            return (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className={`h-1.5 ${isActive ? 'bg-gradient-to-r from-sky-500 to-cyan-500' : 'bg-gray-200'}`} />
                <div className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-sky-50' : 'bg-gray-50'}`}>
                    <Ticket size={20} className={isActive ? 'text-sky-500' : 'text-gray-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-gray-900 ${isEn ? 'text-xs' : 'text-sm'}`}>{ticket.name}</p>
                    <p className={`text-gray-500 truncate ${isEn ? 'text-[10px]' : 'text-xs'}`}>{sessionLabel}</p>
                    {(ticket as any).seats?.seat_name && (
                      <p className="text-sky-600 text-xs font-medium mt-0.5">{isEn ? 'Seat: ' : '座位：'}{formatSeatName((ticket as any).seats.seat_name, isEn)}</p>
                    )}
                    <p className="font-mono text-sky-600 text-xs mt-0.5">{ticket.ticket_code}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                    {statusLabels[effectiveStatus]}
                  </span>
                </div>
                {(isActive || isDeletable) && (
                  <div className="px-4 pb-3 flex gap-2 flex-wrap">
                    {isActive && (
                      <button
                        onClick={() => onViewTicket(ticket)}
                        className="flex-1 text-xs text-sky-600 border border-sky-200 py-1.5 rounded-lg hover:bg-sky-50 transition-colors text-center"
                      >
                        {t('view_ticket')}
                      </button>
                    )}
                    {isActive && ticket.seat_id && (ticket.reschedule_count ?? 0) === 0 && (
                      <button
                        onClick={() => setChangeSeatTicket(ticket)}
                        className="flex-1 text-xs text-emerald-600 border border-emerald-200 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors text-center flex items-center justify-center gap-1"
                      >
                        <RefreshCw size={10} /> {isEn ? 'Change Seat' : '更换座位'}
                      </button>
                    )}
                    {isActive && (
                      <button
                        onClick={() => handleCancelPreview(ticket.id)}
                        disabled={cancelling}
                        className="flex-1 text-xs text-red-500 border border-red-200 py-1.5 rounded-lg hover:bg-red-50 transition-colors text-center disabled:opacity-50"
                      >
                        {t('cancel_booking')}
                      </button>
                    )}
                    {isDeletable && (
                      <button
                        onClick={() => setConfirmDelete(ticket.id)}
                        disabled={deleting}
                        className="flex items-center justify-center gap-1 text-xs text-gray-400 border border-gray-200 py-1.5 px-3 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={11} /> {isEn ? 'Delete' : '删除'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div className="space-y-4">
              {activeTickets.length > 0 && (
                <div className="space-y-3">
                  <p className={`font-semibold text-gray-700 ${isEn ? 'text-xs' : 'text-sm'}`}>{isEn ? 'Active Tickets' : '进行中的订单'}</p>
                  {activeTickets.map(ticket => <TicketCard key={ticket.id} ticket={ticket} />)}
                </div>
              )}
              {historicalTickets.length > 0 && (
                <div className="space-y-3">
                  <p className={`font-semibold text-gray-500 ${isEn ? 'text-xs' : 'text-sm'}`}>{isEn ? 'History' : '历史记录'}</p>
                  {historicalTickets.map(ticket => <TicketCard key={ticket.id} ticket={ticket} />)}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// 鈹€鈹€鈹€ ChangeSeatModal 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function ChangeSeatModal({
  ticket,
  isEn,
  onClose,
  onSuccess,
}: {
  ticket: Registration;
  isEn: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [lockExpiresAt, setLockExpiresAt] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lockedSeatRef = useRef<string | null>(null);

  async function fetchSeats() {
    const { data } = await supabase.rpc('get_seat_map', { p_session_id: ticket.session_id });
    setSeats((data as SeatMapRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase.from('sessions').select('*').eq('id', ticket.session_id).single();
      setSession(sessionData);
      await fetchSeats();
    }
    load();
    const interval = setInterval(fetchSeats, 8000);
    return () => {
      clearInterval(interval);
      if (lockedSeatRef.current) {
        supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      }
    };
  }, [ticket.session_id]);

  // Auto-release on lock expiry
  useEffect(() => {
    if (!lockExpiresAt) return;
    const ms = new Date(lockExpiresAt).getTime() - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(async () => {
      setSelectedSeatId(null);
      setLockExpiresAt('');
      lockedSeatRef.current = null;
      await fetchSeats();
    }, ms + 500);
    return () => clearTimeout(t);
  }, [lockExpiresAt]);

  async function handleSeatClick(seat: SeatMapRow) {
    if (seat.is_booked || seat.is_blocked || seat.id === ticket.seat_id) return;

    if (seat.id === selectedSeatId) {
      await supabase.rpc('unlock_seat', { p_seat_id: seat.id });
      lockedSeatRef.current = null;
      setSelectedSeatId(null);
      setLockExpiresAt('');
      return;
    }

    if (selectedSeatId) {
      await supabase.rpc('unlock_seat', { p_seat_id: selectedSeatId });
    }

    setLocking(true);
    const { data, error: lockErr } = await supabase.rpc('lock_seat', { p_seat_id: seat.id });
    setLocking(false);

    if (lockErr || !data?.success) {
      const reason = data?.reason;
      if (reason === 'already_booked') setError(isEn ? 'This seat is already booked' : '该座位已被预订');
      else if (reason === 'locked_by_other') setError(isEn ? 'This seat is being held by someone else, please try again' : '该座位正被他人选择，请稍后重试');
      else setError(isEn ? 'Failed to lock seat, please try again' : '座位锁定失败，请重试');
      setTimeout(() => setError(''), 3000);
      await fetchSeats();
      return;
    }

    lockedSeatRef.current = seat.id;
    setSelectedSeatId(seat.id);
    setLockExpiresAt(data.expires_at);
    setError('');
  }

  async function handleClose() {
    if (lockedSeatRef.current) {
      await supabase.rpc('unlock_seat', { p_seat_id: lockedSeatRef.current });
      lockedSeatRef.current = null;
    }
    onClose();
  }

  async function handleConfirm() {
    if (!selectedSeatId) return;
    setSaving(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('change_seat', {
      p_registration_id: ticket.id,
      p_new_seat_id: selectedSeatId,
    });
    setSaving(false);
    if (rpcError || (data as any)?.success === false) {
      setError((data as any)?.error || rpcError?.message || (isEn ? 'Failed to change seat' : '换座失败，请重试'));
    } else {
      lockedSeatRef.current = null;
      onSuccess();
    }
  }

  const actualRows = seats.length > 0 ? Math.max(...seats.map(s => s.row_index)) : (session?.seat_rows ?? 1);
  const actualCols = seats.length > 0 ? Math.max(...seats.map(s => s.col_index)) : (session?.seats_per_row ?? 1);
  const selectedSeat = seats.find(s => s.id === selectedSeatId);
  const currentSeatName = (ticket as any).seats?.seat_name ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-lg flex flex-col" style={{ maxHeight: '88vh' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 text-base">{isEn ? 'Change Seat' : '更换座位'}</h3>
            <p className="text-xs text-gray-400">{currentSeatName ? `${isEn ? 'Current:' : '当前：'}${currentSeatName}` : (isEn ? 'No current seat' : '暂无座位')}</p>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={18} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
            {isEn ? 'You may change your seat once only.' : '每张票仅可更换一次座位。'}
          </div>

          {ticket.reschedule_history && ticket.reschedule_history.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-medium text-gray-500 mb-2">{isEn ? 'Change history' : '更换记录'}</p>
              {ticket.reschedule_history.map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                  <span>{h.from_seat}</span>
                  <span className="text-gray-400">→</span>
                  <span>{h.to_seat}</span>
                  <span className="text-gray-400 ml-auto">{new Date(h.changed_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-center text-sm text-gray-400 py-6">{isEn ? 'Loading...' : '加载中...'}</p>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-3">
              <SeatMap
                seats={seats}
                rows={actualRows}
                seatsPerRow={actualCols}
                screenDirection={session?.screen_direction as any ?? 'top'}
                selectedSeatId={selectedSeatId}
                onSeatClick={locking ? () => {} : handleSeatClick}
                lockExpiresAt={lockExpiresAt || undefined}
                isEn={isEn}
                stageCenterCol={session?.stage_center_col ?? undefined}
              />
            </div>
          )}

          {selectedSeat && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5">
              <p className="text-xs text-sky-600">{isEn ? 'New seat' : '新座位'}</p>
              <p className="font-bold text-sky-700">{selectedSeat.seat_name}</p>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-6 pt-3 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button
            onClick={handleClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {isEn ? 'Cancel' : '取消'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedSeatId || saving || locking}
            className="flex-1 py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {saving ? (isEn ? 'Saving...' : '保存中...') : selectedSeatId ? (isEn ? `Confirm: ${selectedSeat?.seat_name}` : `确认换到 ${selectedSeat?.seat_name}`) : (isEn ? 'Select a seat' : '请选择座位')}
          </button>
        </div>
      </div>
    </div>
  );
}

// 鈹€鈹€鈹€ FeedbackView 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function FeedbackView({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [feedbacks, setFeedbacks] = useState<FeedbackTicket[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const isEn = i18n.language === 'en';

  useEffect(() => { fetchFeedbacks(); }, []);

  async function fetchFeedbacks() {
    const { data } = await supabase.from('feedback_tickets').select('*').eq('user_id', user!.id).order('created_at', { ascending: false });
    setFeedbacks(data ?? []);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from('feedback_tickets').insert({
      user_id: user!.id,
      subject: subject.trim(),
      description: description.trim(),
    });
    if (error) {
      setToast({ msg: t('operation_failed'), type: 'error' });
    } else {
      setToast({ msg: t('feedback_success'), type: 'success' });
      setSubject('');
      setDescription('');
      setShowForm(false);
      fetchFeedbacks();
    }
    setSubmitting(false);
    setTimeout(() => setToast(null), 3000);
  }

  const statusLabels: Record<string, string> = {
    pending:     t('status_pending'),
    in_progress: t('status_in_progress'),
    resolved:    t('status_resolved'),
  };
  const statusColors: Record<string, string> = {
    pending:     'bg-amber-100 text-amber-700',
    in_progress: 'bg-sky-100 text-sky-700',
    resolved:    'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="bg-gradient-to-r from-sky-600 to-cyan-500 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X size={18} />
        </button>
        <span className={`font-semibold ${isEn ? 'text-sm' : 'text-base'}`}>{t('feedback_title')}</span>
      </div>

      <div className="p-4 space-y-4">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium py-3 rounded-xl transition-colors"
          >
            <Send size={16} /> {t('new_feedback')}
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={t('feedback_subject')}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
              required
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('feedback_description')}
              rows={4}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">{t('cancel')}</button>
              <button type="submit" disabled={submitting} className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60">{submitting ? t('loading') : t('feedback_submit')}</button>
            </div>
          </form>
        )}

        {feedbacks.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare size={32} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm text-gray-400">{t('no_feedback')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {feedbacks.map(fb => (
              <div key={fb.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className={`font-semibold text-gray-900 flex-1 ${isEn ? 'text-sm' : 'text-base'}`}>{fb.subject}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColors[fb.status] || ''}`}>
                    {statusLabels[fb.status]}
                  </span>
                </div>
                {fb.description && <p className="text-xs text-gray-500">{fb.description}</p>}
                <p className="text-[10px] text-gray-400">{t('feedback_number')}: {fb.ticket_number} - {new Date(fb.created_at).toLocaleString()}</p>
                {fb.admin_reply ? (
                  <div className="bg-sky-50 rounded-xl p-3 mt-1">
                    <p className="text-xs font-medium text-sky-700 mb-1">{t('feedback_reply')}</p>
                    <p className="text-xs text-gray-700">{fb.admin_reply}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{new Date(fb.replied_at!).toLocaleString()}</p>
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-300">{t('feedback_no_reply')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 鈹€鈹€鈹€ EditProfileView 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function EditProfileView({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, userProfile, refreshUserProfile } = useAuth();
  const [displayName, setDisplayName] = useState(userProfile?.display_name || '');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const isEn = i18n.language === 'en';

  async function handleSave() {
    if (!displayName.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('user_profiles')
      .upsert({ id: user!.id, display_name: displayName.trim() });
    if (error) {
      setToast({ msg: t('operation_failed'), type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } else {
      await refreshUserProfile();
      setToast({ msg: t('update_success'), type: 'success' });
      setTimeout(() => { setToast(null); onBack(); }, 1200);
    }
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="bg-gradient-to-r from-sky-600 to-cyan-500 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X size={18} />
        </button>
        <span className={`font-semibold ${isEn ? 'text-sm' : 'text-base'}`}>{t('edit_profile')}</span>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('display_name_label')}</label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={t('display_name_placeholder')}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !displayName.trim()}
          className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
        >
          {saving ? t('loading') : t('save')}
        </button>
      </div>
    </div>
  );
}

// 鈹€鈹€鈹€ ChangePasswordView 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function ChangePasswordView({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const isEn = i18n.language === 'en';

  async function handleSave() {
    if (newPassword !== confirmPassword) {
      setToast({ msg: t('passwords_not_match'), type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (!newPassword) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setToast({ msg: t('operation_failed'), type: 'error' });
    } else {
      setToast({ msg: t('update_success'), type: 'success' });
      setNewPassword('');
      setConfirmPassword('');
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="bg-gradient-to-r from-sky-600 to-cyan-500 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X size={18} />
        </button>
        <span className={`font-semibold ${isEn ? 'text-sm' : 'text-base'}`}>{t('change_password')}</span>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('new_password')}</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('confirm_password')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !newPassword}
          className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
        >
          {saving ? t('loading') : t('save')}
        </button>
      </div>
    </div>
  );
}

function BalanceView({ balance, onBack }: { balance: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isEn = i18n.language === 'en';
  const [activeTab, setActiveTab] = useState<'packages' | 'transactions' | 'guide'>('packages');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const [loadingPkgs, setLoadingPkgs] = useState(true);
  const [rechargeSettings, setRechargeSettings] = useState<{ banner_image: string; description: string; enabled: boolean } | null>(null);
  const [loadingGuide, setLoadingGuide] = useState(true);

  useEffect(() => {
    fetchPackages();
    fetchTransactions();
    fetchGuide();
  }, []);

  async function fetchPackages() {
    setLoadingPkgs(true);
    try {
      const { data } = await supabase.from('lcoin_recharge_packages').select('*').eq('is_active', true).order('sort_order');
      setPackages(data || []);
    } catch {
      setPackages([]);
    }
    setLoadingPkgs(false);
  }

  async function fetchTransactions() {
    setLoadingTxs(true);
    try {
      const { data, error } = await supabase
        .from('lcoin_transactions')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        console.error('fetchTransactions error:', error);
        setTransactions([]);
      } else {
        setTransactions(data || []);
      }
    } catch (err) {
      console.error('fetchTransactions exception:', err);
      setTransactions([]);
    }
    setLoadingTxs(false);
  }

  async function fetchGuide() {
    setLoadingGuide(true);
    try {
      const { data } = await supabase.from('recharge_settings').select('banner_image, description, enabled').single();
      setRechargeSettings(data || { banner_image: '', description: '', enabled: true });
    } catch {
      setRechargeSettings({ banner_image: '', description: '', enabled: true });
    }
    setLoadingGuide(false);
  }

  const formatType = (type: string) => {
    switch (type) {
      case 'recharge': return isEn ? 'Recharge' : '充值';
      case 'purchase': return isEn ? 'Purchase' : '购票消费';
      case 'refund': return isEn ? 'Refund' : '退款';
      case 'adjust_add': return isEn ? 'Adjustment (+)' : '调整增加';
      case 'adjust_subtract': return isEn ? 'Adjustment (-)' : '调整减少';
      case 'fee': return isEn ? 'Fee' : '手续费';
      case 'reschedule': return isEn ? 'Reschedule' : '改签';
      default: return type;
    }
  };

  const formatAmount = (direction: string, amount: string | number) => {
    const prefix = direction === 'in' ? '+' : '-';
    return `${prefix}${amount} ${isEn ? 'LC' : '兰克币'}`;
  };

  function parseMarkdown(text: string): string {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
    html = html.replace(/<\/li>\n<li>/g, '</li><li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul class="list-disc list-inside space-y-1">$1</ul>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-amber-600 underline">$1</a>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  }

  const defaultDesc = isEn
    ? 'Please contact customer service to confirm your Lanke Coins recharge.'
    : '如需充值兰克币，请联系客服确认。';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-amber-500 to-amber-400 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X size={18} />
        </button>
        <span className="font-semibold">{isEn ? 'Lanke Coins' : '兰克币余额'}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Balance Card */}
        <div className="bg-gradient-to-br from-amber-500 to-amber-400 rounded-2xl p-6 text-white text-center">
          <p className="text-white/80 text-sm mb-1">{isEn ? 'Current Balance' : '当前余额'}</p>
          <p className="text-4xl font-bold">{balance}</p>
          <p className="text-white/70 text-xs mt-1">{isEn ? 'Lanke Coins' : '兰克币'}</p>
        </div>

        {/* Tabs */}
        <div className="flex bg-white rounded-xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => setActiveTab('packages')}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'packages' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Package size={15} /> {isEn ? 'Packages' : '充值套餐'}
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'transactions' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <History size={15} /> {isEn ? 'Records' : '交易记录'}
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'guide' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Info size={15} /> {isEn ? 'Guide' : '充值说明'}
          </button>
        </div>

        {/* Tab: Packages */}
        {activeTab === 'packages' && (
          <div className="space-y-3">
            {loadingPkgs ? (
              <div className="py-8 text-center text-gray-400 text-sm">{t('loading')}</div>
            ) : packages.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                <Package size={32} className="text-gray-300 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">{isEn ? 'No packages available' : '暂无充值套餐'}</p>
              </div>
            ) : (
              packages.map(pkg => (
                <div key={pkg.id} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-gray-900">{isEn ? (pkg.name_en || pkg.name) : pkg.name}</h4>
                    <span className="text-lg font-bold text-amber-500">{pkg.lcoin_amount} {isEn ? 'LC' : '兰克币'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">{isEn ? 'Price' : '价格'}：<span className="font-medium text-gray-900">{pkg.price}</span> {isEn ? 'RMB' : '元'}</span>
                  </div>
                  {pkg.description && (
                    <p className="text-xs text-gray-400">{isEn ? (pkg.description_en || pkg.description) : pkg.description}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab: Transactions */}
        {activeTab === 'transactions' && (
          <div className="space-y-3">
            {loadingTxs ? (
              <div className="py-8 text-center text-gray-400 text-sm">{t('loading')}</div>
            ) : transactions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                <History size={32} className="text-gray-300 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">{isEn ? 'No transactions yet' : '暂无交易记录'}</p>
              </div>
            ) : (
              transactions.map((tx) => (
                <div key={tx.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      tx.transaction_type === 'recharge' ? 'bg-emerald-100 text-emerald-700' :
                      tx.transaction_type === 'purchase' ? 'bg-red-100 text-red-700' :
                      tx.transaction_type === 'refund' ? 'bg-blue-100 text-blue-700' :
                      tx.transaction_type === 'adjust_add' ? 'bg-purple-100 text-purple-700' :
                      tx.transaction_type === 'adjust_subtract' ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {formatType(tx.transaction_type)}
                    </span>
                    <span className={`font-semibold ${tx.direction === 'in' ? 'text-emerald-600' : 'text-red-500'}`}>
                      {formatAmount(tx.direction, tx.amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{tx.created_at ? new Date(tx.created_at).toLocaleString(isEn ? 'en-US' : 'zh-CN') : ''}</span>
                  </div>
                  {tx.description && <p className="text-xs text-gray-500 mt-1">{tx.description}</p>}
                  <div className="text-xs text-gray-400 mt-1">
                    {isEn ? 'Balance' : '余额'}：${tx.balance_before} → ${tx.balance_after}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab: Recharge Guide */}
        {activeTab === 'guide' && (
          <div className="space-y-4">
            {loadingGuide ? (
              <div className="py-8 text-center text-gray-400 text-sm">{t('loading')}</div>
            ) : !rechargeSettings?.enabled ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                <Coins size={40} className="text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-sm">{isEn ? 'Recharge service is temporarily unavailable.' : '充值服务暂时不可用。'}</p>
              </div>
            ) : (
              <>
                {rechargeSettings?.banner_image && (
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                    <img src={rechargeSettings.banner_image} alt={isEn ? 'Recharge Banner' : '充值Banner'} className="w-full h-48 object-cover" />
                  </div>
                )}

                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Coins size={16} className="text-amber-500" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 mb-1">{isEn ? 'How to Recharge' : '充值方式'}</h4>
                      <div className="text-sm text-gray-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: parseMarkdown(rechargeSettings?.description || defaultDesc) }} />
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-xs text-amber-700 font-medium mb-1">{isEn ? 'Important Notice' : '温馨提示'}</p>
                    <p className="text-xs text-amber-600">
                      {isEn ? 'Recharge requests are processed manually by our customer service team. Please allow some time for your balance to be updated.' : '充值请求由客服人员人工处理，请耐心等待余额到账。'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}






