import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import AdminWorkbench from './AdminWorkbench';
import ContentPublishing from './ContentPublishing';
import OrderManagement from './OrderManagement';
import AdminSettings from './AdminSettings';
import CustomerCenter from './CustomerCenter';
import UserManagement from './UserManagement';
import LcoinManagement from './LcoinManagement';
import {
  ScanLine, FileText, ClipboardList, MessageSquare,
  Users, Settings, LogOut, Ticket, Monitor, Smartphone, Wallet,
} from 'lucide-react';

type Tab = 'workbench' | 'content' | 'orders' | 'feedback' | 'users' | 'lcoin';
type ViewMode = 'pc' | 'mobile';

function readStoredViewMode(): ViewMode {
  try {
    const v = localStorage.getItem('admin_view_mode');
    if (v === 'pc' || v === 'mobile') return v;
  } catch { /* ignore */ }
  return 'mobile';
}

export default function AdminLayout() {
  const { t, i18n } = useTranslation();
  const { profile, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('workbench');
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Force Admin to Chinese
  useEffect(() => { i18n.changeLanguage('zh'); }, [i18n]);

  useEffect(() => {
    fetchUnreadCounts();
    const interval = setInterval(fetchUnreadCounts, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function fetchUnreadCounts() {
    const [notesRes, chatRes, feedbackRes] = await Promise.all([
      supabase.from('registrations').select('id', { count: 'exact' }).not('note_content', null).eq('is_note_read', false).is('deleted_at', null),
      supabase.from('chat_conversations').select('id', { count: 'exact' }).gt('unread_count', 0),
      supabase.from('feedback_tickets').select('id', { count: 'exact' }).eq('status', 'pending'),
    ]);
    const notesCount = (notesRes.count as number) ?? 0;
    const chatCount = (chatRes.count as number) ?? 0;
    const feedbackCount = (feedbackRes.count as number) ?? 0;
    setUnreadCount(notesCount + chatCount + feedbackCount);
  }

  function toggleViewMode() {
    const next: ViewMode = viewMode === 'pc' ? 'mobile' : 'pc';
    setViewMode(next);
    try { localStorage.setItem('admin_view_mode', next); } catch { /* ignore */ }
  }

  const tabs = [
    { id: 'workbench' as Tab, label: t('workbench'), icon: ScanLine },
    { id: 'content'   as Tab, label: t('content'),   icon: FileText },
    { id: 'orders'    as Tab, label: t('orders'),     icon: ClipboardList },
    { id: 'feedback'  as Tab, label: '客户中心',        icon: MessageSquare },
    { id: 'users'     as Tab, label: t('users'),      icon: Users },
    { id: 'lcoin'     as Tab, label: '兰克币管理',    icon: Wallet },
  ];

  useEffect(() => {
    if (tab !== 'workbench' || showSettings) setSidebarCollapsed(false);
  }, [tab, showSettings]);

  function renderContent() {
    if (showSettings) return <AdminSettings onBack={() => setShowSettings(false)} />;
    if (tab === 'workbench') return <AdminWorkbench isMobile={viewMode === 'mobile'} onFrontDeskMode={setSidebarCollapsed} />;
    if (tab === 'content')   return <ContentPublishing />;
    if (tab === 'orders')    return <OrderManagement />;
    if (tab === 'feedback')  return <CustomerCenter />;
    if (tab === 'users')     return <UserManagement />;
    if (tab === 'lcoin')     return <LcoinManagement onBack={() => setTab('workbench')} />;
    return null;
  }

  // ── PC LAYOUT ──────────────────────────────────────────────────────────────
  if (viewMode === 'pc') {
    const sidebarW = sidebarCollapsed ? 'w-14' : 'w-56';
    const mainMl = sidebarCollapsed ? 'ml-14' : 'ml-56';
    return (
      <div className="min-h-screen bg-gray-50 flex">

        {/* Sidebar */}
        <aside className={`${sidebarW} bg-slate-800 min-h-screen flex flex-col fixed left-0 top-0 z-30 shadow-xl transition-all duration-300`}>

          {/* Brand */}
          <div className={`${sidebarCollapsed ? 'px-2 py-4' : 'px-4 py-4'} border-b border-slate-700/60`}>
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2'}`}>
              <Ticket size={18} className="text-sky-400 flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-bold text-white text-sm tracking-wide">管理终端</span>}
            </div>
            {profile && !sidebarCollapsed && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[9px] font-bold">{profile.username[0]}</span>
                </div>
                <span className="text-slate-400 text-xs truncate">{profile.username}</span>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { setTab(id); setShowSettings(false); if (id !== 'workbench') setSidebarCollapsed(false); }}
                title={sidebarCollapsed ? label : undefined}
                className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-xl ${sidebarCollapsed ? '' : 'text-left'} transition-all text-sm group relative ${
                  tab === id && !showSettings
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <div className="relative">
                  <Icon size={16} className="flex-shrink-0" />
                  {id === 'feedback' && unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                {!sidebarCollapsed && <span className="font-medium">{label}</span>}
              </button>
            ))}
          </nav>

          {/* Bottom actions */}
          <div className="px-2 py-3 border-t border-slate-700/60 space-y-0.5">
            <button
              onClick={() => setShowSettings(true)}
              title={sidebarCollapsed ? '系统设置' : undefined}
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-xl transition-all text-sm ${
                showSettings
                  ? 'bg-sky-500 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <Settings size={16} className="flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">系统设置</span>}
            </button>

            <button
              onClick={toggleViewMode}
              title="切换至手机视图"
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-xl text-slate-300 hover:bg-slate-700 hover:text-white transition-all text-sm`}
            >
              <Smartphone size={16} className="flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">手机视图</span>}
            </button>

            <button
              onClick={signOut}
              title={sidebarCollapsed ? '退出登录' : undefined}
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-xl text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-all text-sm`}
            >
              <LogOut size={16} className="flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">退出登录</span>}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className={`${mainMl} flex-1 min-h-screen overflow-y-auto transition-all duration-300`}>
          {renderContent()}
        </main>
      </div>
    );
  }

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto relative">

      {/* Header */}
      <header className="bg-slate-800 text-white px-4 pt-5 pb-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <Ticket size={20} className="text-sky-400" />
          <span className="font-semibold text-sm">管理终端</span>
          {profile && <span className="text-slate-400 text-xs">· {profile.username}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleViewMode}
            title="切换至电脑视图"
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors relative group"
          >
            <Monitor size={18} className="text-slate-300" />
            <span className="absolute right-0 top-full mt-1 whitespace-nowrap bg-slate-900 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              切换至电脑视图
            </span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <Settings size={18} className="text-slate-300" />
          </button>
          <button
            onClick={signOut}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <LogOut size={18} className="text-slate-300" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {showSettings
          ? <AdminSettings onBack={() => setShowSettings(false)} />
          : renderContent()
        }
      </main>

      {/* Bottom Nav */}
      {!showSettings && (
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200 flex z-30">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
                tab === id ? 'text-sky-500' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon size={20} />
              <span className="text-[9px] font-medium">{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
