import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import FeedbackManagement from './FeedbackManagement';
import Toast from '../Toast';
import {
  MessageCircle, ClipboardList, Send, User, X, Circle,
  ChevronRight, Plus, Trash2, Zap, Ban, ArrowLeft, FileText,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChatStatus = 'online' | 'busy' | 'offline';

interface UserProfile {
  display_name: string | null;
  phone: string | null;
}

interface Conversation {
  id: string;
  user_id: string;
  status: 'open' | 'resolved' | 'closed';
  admin_unread: number;
  user_unread: number;
  last_message_at: string | null;
  is_blocked: boolean;
  created_at: string;
  user_profile: UserProfile | null;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_role: 'user' | 'admin';
  content: string;
  is_filtered: boolean;
  created_at: string;
}

interface QuickReply {
  id: string;
  label: string;
  content: string;
  sort_order: number;
}

const STATUS_OPTIONS: { value: ChatStatus; label: string; dot: string }[] = [
  { value: 'online',  label: '在线', dot: 'bg-emerald-500' },
  { value: 'busy',    label: '忙碌', dot: 'bg-amber-500' },
  { value: 'offline', label: '离线', dot: 'bg-gray-400' },
];

// ─── CustomerCenter shell ─────────────────────────────────────────────────────

export default function CustomerCenter() {
  const [tab, setTab] = useState<'chat' | 'feedback' | 'notes'>('chat');
  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">客户中心</h2>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {(['chat', 'feedback', 'notes'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t ? 'bg-white text-sky-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'chat' ? <MessageCircle size={15} /> : t === 'feedback' ? <ClipboardList size={15} /> : <FileText size={15} />}
            {t === 'chat' ? '客服工作台' : t === 'feedback' ? '工单列表' : '用户备注'}
          </button>
        ))}
      </div>
      {tab === 'chat'     && <ChatWorkbench />}
      {tab === 'feedback' && <FeedbackManagement />}
      {tab === 'notes'    && <NotesSummary />}
    </div>
  );
}

// ─── NotesSummary ──────────────────────────────────────────────────────────────

function NotesSummary() {
  const [notes, setNotes] = useState<Array<{
    id: string;
    note_content: string;
    note_author: 'user' | 'admin';
    is_handled: boolean;
    name: string;
    phone: string;
    user_id: string | null;
    ticket_code: string | null;
    session_name: string | null;
    session_date: string | null;
    created_at: string;
    source: 'user_notes' | 'registrations';
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'completed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  interface UserNotesGroup {
    name: string;
    phone: string;
    user_id: string | null;
    notes: typeof notes;
    pendingCount: number;
    completedCount: number;
  }

  const [groupedByUser, setGroupedByUser] = useState<UserNotesGroup[]>([]);

  useEffect(() => {
    fetchNotes();
  }, [filterStatus]);

  async function fetchNotes() {
    setLoading(true);
    
    // Fetch user_notes (global notes for users)
    const { data: userNotesData } = await supabase
      .from('user_notes')
      .select('id, note_content, note_author, is_handled, user_id, created_at')
      .order('created_at', { ascending: false });

    // Fetch registrations with notes (order-level notes)
    // Query all registrations and filter in code (handle both null and empty string)
    const { data: regData } = await supabase
      .from('registrations')
      .select('id, note_content, note_author, note_status, is_note_read, name, phone, user_id, ticket_code, created_at, sessions(name, session_date)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    const userNotes = (userNotesData as any[])?.map(n => ({
      id: n.id,
      note_content: n.note_content,
      note_author: n.note_author,
      is_handled: n.is_handled,
      name: '-',
      phone: '-',
      user_id: n.user_id || null,
      ticket_code: null,
      session_name: null,
      session_date: null,
      created_at: n.created_at,
      source: 'user_notes' as const,
    })) ?? [];

    // Filter registrations that have note_content (not null and not empty string)
    const regNotes = ((regData as any[]) ?? [])
      .filter(n => n.note_content && n.note_content.trim().length > 0)
      .map(n => ({
        id: n.id,
        note_content: n.note_content,
        note_author: n.note_author,
        is_handled: (n.note_status || 'pending') === 'completed',
        name: n.name,
        phone: n.phone,
        user_id: n.user_id || null,
        ticket_code: n.ticket_code,
        session_name: n.sessions?.name || null,
        session_date: n.sessions?.session_date || null,
        created_at: n.created_at,
        source: 'registrations' as const,
      }));

    const combinedNotes = [...userNotes, ...regNotes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const filteredNotes = filterStatus === 'all'
      ? combinedNotes
      : combinedNotes.filter(n => n.is_handled === (filterStatus === 'completed'));

    setNotes(filteredNotes);

    const userMap = new Map<string, UserNotesGroup>();
    filteredNotes.forEach(n => {
      const key = n.user_id || `${n.phone || 'unknown'}|${n.name || 'unknown'}`;
      if (!userMap.has(key)) {
        userMap.set(key, { name: n.name || '-', phone: n.phone || '-', user_id: n.user_id || null, notes: [], pendingCount: 0, completedCount: 0 });
      }
      const group = userMap.get(key)!;
      group.notes.push(n);
      if (!n.is_handled) group.pendingCount++;
      else group.completedCount++;
    });
    setGroupedByUser(Array.from(userMap.values()));
    setLoading(false);
  }

  async function toggleNoteStatus(noteId: string, currentHandled: boolean, source: 'user_notes' | 'registrations') {
    const newHandled = !currentHandled;
    if (source === 'user_notes') {
      await supabase.from('user_notes').update({ is_handled: newHandled }).eq('id', noteId);
    } else {
      await supabase.from('registrations').update({ note_status: newHandled ? 'completed' : 'pending', is_note_read: true }).eq('id', noteId);
    }
    fetchNotes();
  }

  async function addUserNote() {
    if (!selectedUserId || !newNoteContent.trim()) {
      setToast({ msg: '请选择用户并填写备注内容', type: 'error' });
      return;
    }
    await supabase.from('user_notes').insert({
      user_id: selectedUserId,
      note_content: newNoteContent.trim(),
      note_author: 'admin',
      is_handled: false,
    });
    setShowAddModal(false);
    setNewNoteContent('');
    setSelectedUserId(null);
    setSelectedUserName('');
    setToast({ msg: '备注添加成功', type: 'success' });
    fetchNotes();
    setTimeout(() => setToast(null), 3000);
  }

  function openAddModal(userGroup: UserNotesGroup) {
    setSelectedUserId(userGroup.user_id);
    setSelectedUserName(userGroup.name);
    setShowAddModal(true);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10"><div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const pendingCount = notes.filter(n => !n.is_handled).length;
  const completedCount = notes.filter(n => n.is_handled).length;

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">共 {notes.length} 条备注，{groupedByUser.length} 位用户</p>
        <button onClick={fetchNotes} className="text-xs text-sky-600 hover:text-sky-500">刷新</button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {(['all', 'pending', 'completed'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilterStatus(t)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterStatus === t ? 'bg-white text-sky-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'all' ? '全部' : t === 'pending' ? `待处理 (${pendingCount})` : `已完成 (${completedCount})`}
          </button>
        ))}
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <FileText size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无用户备注</p>
        </div>
      ) : (
        groupedByUser.map((userGroup, userIdx) => (
          <div key={userIdx} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-sky-500" />
                  <span className="text-sm font-semibold text-gray-900">{userGroup.name}</span>
                  {userGroup.phone && <span className="text-xs text-gray-400">{userGroup.phone}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {userGroup.pendingCount > 0 && (
                    <span className="text-[10px] font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      {userGroup.pendingCount} 待处理
                    </span>
                  )}
                  {userGroup.completedCount > 0 && (
                    <span className="text-[10px] font-medium bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                      {userGroup.completedCount} 已完成
                    </span>
                  )}
                  {userGroup.user_id && (
                    <button
                      onClick={() => openAddModal(userGroup)}
                      className="flex items-center gap-1 px-2 py-1 bg-sky-500 text-white text-[10px] font-medium rounded-lg hover:bg-sky-400 transition-colors"
                    >
                      <Plus size={10} /> 添加备注
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {userGroup.notes.map(note => (
                <div key={note.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {(note.ticket_code || note.session_name) && (
                        <div className="flex items-center gap-2 mb-1">
                          {note.ticket_code && (
                            <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{note.ticket_code}</span>
                          )}
                          {note.session_name && (
                            <span className="text-[10px] text-gray-400">{note.session_name} · {note.session_date}</span>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-gray-600 whitespace-pre-wrap mb-2">{note.note_content}</p>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span className={`px-1.5 py-0.5 rounded ${note.note_author === 'user' ? 'bg-sky-50 text-sky-600' : 'bg-purple-50 text-purple-600'}`}>
                          {note.note_author === 'user' ? '用户' : '管理员'}
                        </span>
                        <span>{new Date(note.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleNoteStatus(note.id, note.is_handled, note.source)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                        note.is_handled
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                      }`}
                    >
                      {note.is_handled ? '已处理' : '待处理'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Add note modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm">
            <h3 className="font-bold text-gray-900 text-base mb-3">为 {selectedUserName} 添加备注</h3>
            <textarea
              value={newNoteContent}
              onChange={e => setNewNoteContent(e.target.value)}
              placeholder="请输入备注内容（如：需轮椅服务、VIP接待等）"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
              rows={4}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowAddModal(false); setNewNoteContent(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={addUserNote}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-sky-500 text-white hover:bg-sky-400 transition-colors"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ChatWorkbench ────────────────────────────────────────────────────────────

function ChatWorkbench() {
  const { user } = useAuth();
  const [chatStatus, setChatStatus]       = useState<ChatStatus>('offline');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId]   = useState<string | null>(null);
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [input, setInput]                 = useState('');
  const [sending, setSending]             = useState(false);
  const [quickReplies, setQuickReplies]   = useState<QuickReply[]>([]);
  const [showQR, setShowQR]               = useState(false);
  const [showProfile, setShowProfile]     = useState(false);
  const [toast, setToast]                 = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const heartbeatRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref so interval callbacks always see the current activeConvId without stale closure
  const activeConvIdRef = useRef<string | null>(null);
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null;

  // ── Bootstrap ──
  useEffect(() => {
    fetchConversations();
    fetchQuickReplies();
    loadAdminStatus();
  }, []);

  // ── Heartbeat keeps admin status fresh ──
  useEffect(() => {
    if (!user) return;
    if (chatStatus !== 'offline') {
      upsertAdminStatus(chatStatus);
      heartbeatRef.current = setInterval(() => upsertAdminStatus(chatStatus), 120_000);
    }
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [chatStatus, user]);

  // ── Go offline on unmount ──
  useEffect(() => {
    return () => {
      if (user) {
        supabase.from('admin_chat_status')
          .upsert({ admin_id: user.id, status: 'offline', last_seen: new Date().toISOString() });
      }
    };
  }, [user]);

  // ── Realtime: conversation list (new conversations, unread counts) ──
  useEffect(() => {
    const ch = supabase
      .channel('admin-convs-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => {
        fetchConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Polling fallback for conversations (8 s) ──
  useEffect(() => {
    const t = setInterval(fetchConversations, 8_000);
    return () => clearInterval(t);
  }, []);

  // ── Realtime: messages in the active conversation ──
  // Critical: validate conversation_id client-side to prevent cross-user leakage
  // in case the server-side filter silently misses.
  useEffect(() => {
    if (!activeConvId) return;

    // Load history for this conversation
    fetchMessages(activeConvId);
    markAdminRead(activeConvId);

    const ch = supabase
      .channel(`admin-msgs-rt-${activeConvId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        payload => {
          const incoming = payload.new as ChatMessage;
          // ── Per-user isolation guard ──
          // Only process messages that belong to the currently viewed conversation.
          // This prevents messages from other users appearing here if the server-side
          // filter misfires.
          if (incoming.conversation_id !== activeConvIdRef.current) return;

          setMessages(prev => {
            const exists = prev.some(m => m.id === incoming.id);
            return exists ? prev : [...prev, incoming];
          });
          markAdminRead(incoming.conversation_id);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [activeConvId]);

  // ── Polling fallback for messages (4 s) ──
  useEffect(() => {
    const t = setInterval(() => {
      if (activeConvIdRef.current) refreshMessages(activeConvIdRef.current);
    }, 4_000);
    return () => clearInterval(t);
  }, []);

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Data fetchers ─────────────────────────────────────────────────────────

  async function loadAdminStatus() {
    if (!user) return;
    const { data } = await supabase
      .from('admin_chat_status').select('status').eq('admin_id', user.id).maybeSingle();
    if (data) setChatStatus(data.status as ChatStatus);
  }

  async function upsertAdminStatus(s: ChatStatus) {
    if (!user) return;
    await supabase.from('admin_chat_status')
      .upsert({ admin_id: user.id, status: s, last_seen: new Date().toISOString() });
  }

  async function fetchConversations() {
    // Step 1: fetch all conversations (admin RLS allows this)
    const { data: convs } = await supabase
      .from('chat_conversations')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (!convs || convs.length === 0) { setConversations([]); return; }

    // Step 2: fetch user profiles separately — no direct FK between
    // chat_conversations.user_id and user_profiles.id (both reference auth.users).
    const userIds = [...new Set(convs.map((c: any) => c.user_id as string))];
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name, phone')
      .in('id', userIds);

    const profileMap = new Map<string, UserProfile>(
      (profiles ?? []).map((p: any) => [p.id as string, { display_name: p.display_name, phone: p.phone }]),
    );

    setConversations(
      convs.map((c: any) => ({
        ...c,
        user_profile: profileMap.get(c.user_id) ?? null,
      })),
    );
  }

  async function fetchMessages(convId: string) {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    // Only update if this is still the active conversation
    if (convId === activeConvIdRef.current) {
      setMessages(data ?? []);
    }
  }

  // Background refresh: merges DB state while preserving pending optimistic entries
  async function refreshMessages(convId: string) {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    if (!data || convId !== activeConvIdRef.current) return;

    setMessages(prev => {
      const inFlight = prev.filter(m => m.id.startsWith('opt-'));
      return [...data, ...inFlight] as ChatMessage[];
    });
  }

  async function fetchQuickReplies() {
    const { data } = await supabase.from('chat_quick_replies').select('*').order('sort_order');
    setQuickReplies(data ?? []);
  }

  // Mark admin_unread = 0 for a conversation (direct UPDATE, no RPC needed)
  async function markAdminRead(convId: string) {
    await supabase.from('chat_conversations')
      .update({ admin_unread: 0 })
      .eq('id', convId);
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function sendMessage(content: string) {
    if (!activeConvId || !user || !content.trim() || sending) return;
    setSending(true);

    // Optimistic — admin sees their own reply immediately
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      conversation_id: activeConvId,
      sender_id: user.id,
      sender_role: 'admin',
      content: content.trim(),
      is_filtered: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');

    // Direct INSERT — preserves JWT context so Supabase Realtime works correctly.
    // No .select().single() — RETURNING + SELECT RLS can return 0 rows on success,
    // causing .single() to throw PGRST116 (false failure). Poll confirms the entry.
    const { error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: activeConvId,
        sender_id: user.id,
        sender_role: 'admin',
        content: content.trim(),
        is_filtered: false,
      });

    if (error) {
      console.error('[CustomerCenter] sendMessage failed:', error.code, error.message, error.details);
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setInput(content.trim());
      showToast('发送失败，请重试', 'error');
    } else {
      // INSERT succeeded — fetch real messages immediately to replace the optimistic
      // entry (opt- id, shows "Sending...") with the confirmed DB record.
      const { data: fresh } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', activeConvId)
        .order('created_at', { ascending: true });
      if (fresh && activeConvId === activeConvIdRef.current) {
        setMessages(fresh as ChatMessage[]);
      }
    }
    setSending(false);
  }

  async function toggleBlock(conv: Conversation) {
    await supabase.from('chat_conversations').update({ is_blocked: !conv.is_blocked }).eq('id', conv.id);
    fetchConversations();
    showToast(conv.is_blocked ? '已解除屏蔽' : '用户已屏蔽');
  }

  async function updateConvStatus(convId: string, status: Conversation['status']) {
    await supabase.from('chat_conversations').update({ status }).eq('id', convId);
    fetchConversations();
    showToast('状态已更新');
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Status bar — hidden on mobile when a chat is open to save space */}
      <div className={`flex items-center gap-2 bg-white rounded-2xl p-3 border border-gray-100 shadow-sm flex-wrap ${activeConvId ? 'hidden md:flex' : 'flex'}`}>
        <span className="text-xs text-gray-500 font-medium">客服状态：</span>
        <div className="flex gap-1.5">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setChatStatus(opt.value); upsertAdminStatus(opt.value); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                chatStatus === opt.value
                  ? 'border-sky-400 bg-sky-50 text-sky-700 shadow-sm'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Mobile: conversation list (shown when no active conv) ── */}
      <div className={`md:hidden ${activeConvId ? 'hidden' : 'flex flex-col gap-1'}`}>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1 mb-0.5">
          用户会话 ({conversations.length})
        </p>
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageCircle size={28} className="text-gray-200 mb-2" />
            <p className="text-xs text-gray-400">暂无会话</p>
          </div>
        )}
        {conversations.map(conv => (
          <ConvListItem key={conv.id} conv={conv} isActive={false} onClick={() => setActiveConvId(conv.id)} />
        ))}
        <QuickRepliesManager quickReplies={quickReplies} onRefresh={fetchQuickReplies} />
      </div>

      {/* ── Mobile: chat pane (full-screen overlay when a conv is active) ── */}
      {activeConvId && activeConv && (
        <div className="md:hidden fixed inset-0 z-50 bg-white flex flex-col">
          <ChatPane
            activeConv={activeConv}
            messages={messages}
            messagesEndRef={messagesEndRef}
            input={input}
            setInput={setInput}
            sending={sending}
            showQR={showQR}
            setShowQR={setShowQR}
            quickReplies={quickReplies}
            showProfile={showProfile}
            setShowProfile={setShowProfile}
            onSend={sendMessage}
            onKeyDown={handleKeyDown}
            onBlock={toggleBlock}
            onStatusChange={updateConvStatus}
            onBack={() => setActiveConvId(null)}
            showBackButton
          />
        </div>
      )}

      {/* ── Desktop: two-column workbench ── */}
      <div className="hidden md:flex gap-3" style={{ height: 'calc(100dvh - 220px)', minHeight: 480 }}>
        {/* Left: conversation list */}
        <div className="w-[200px] flex-shrink-0 flex flex-col gap-1 overflow-y-auto min-h-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1 mb-0.5">
            用户会话 ({conversations.length})
          </p>
          {conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageCircle size={28} className="text-gray-200 mb-2" />
              <p className="text-xs text-gray-400">暂无会话</p>
            </div>
          )}
          {conversations.map(conv => (
            <ConvListItem key={conv.id} conv={conv} isActive={conv.id === activeConvId} onClick={() => setActiveConvId(conv.id)} />
          ))}
        </div>

        {/* Right: chat pane */}
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden min-w-0">
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <MessageCircle size={40} className="text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-400">从左侧选择一个用户</p>
              <p className="text-xs text-gray-300 mt-1">每个用户对应独立的会话记录</p>
            </div>
          ) : (
            <ChatPane
              activeConv={activeConv}
              messages={messages}
              messagesEndRef={messagesEndRef}
              input={input}
              setInput={setInput}
              sending={sending}
              showQR={showQR}
              setShowQR={setShowQR}
              quickReplies={quickReplies}
              showProfile={showProfile}
              setShowProfile={setShowProfile}
              onSend={sendMessage}
              onKeyDown={handleKeyDown}
              onBlock={toggleBlock}
              onStatusChange={updateConvStatus}
              showBackButton={false}
            />
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <QuickRepliesManager quickReplies={quickReplies} onRefresh={fetchQuickReplies} />
      </div>
    </div>
  );
}

// ─── ConvListItem ─────────────────────────────────────────────────────────────

function ConvListItem({ conv, isActive, onClick }: { conv: Conversation; isActive: boolean; onClick: () => void }) {
  const name = conv.user_profile?.display_name || '匿名用户';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl px-2.5 py-2.5 transition-all border ${
        isActive ? 'bg-sky-50 border-sky-200' : 'bg-white border-gray-100 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center flex-shrink-0">
          <span className="text-sky-600 text-sm font-bold">{name[0].toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-semibold text-gray-800 truncate">{name}</span>
            {conv.admin_unread > 0 && (
              <span className="bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 flex-shrink-0">
                {conv.admin_unread > 9 ? '9+' : conv.admin_unread}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {conv.last_message_at
              ? new Date(conv.last_message_at).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })
              : '无消息'}
          </p>
        </div>
        {conv.is_blocked && <Ban size={10} className="text-red-400 flex-shrink-0" />}
      </div>
    </button>
  );
}

// ─── ChatPane ─────────────────────────────────────────────────────────────────

interface ChatPaneProps {
  activeConv: Conversation;
  messages: ChatMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  showQR: boolean;
  setShowQR: (v: boolean | ((p: boolean) => boolean)) => void;
  quickReplies: QuickReply[];
  showProfile: boolean;
  setShowProfile: (v: boolean | ((p: boolean) => boolean)) => void;
  onSend: (content: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlock: (conv: Conversation) => void;
  onStatusChange: (convId: string, status: Conversation['status']) => void;
  onBack?: () => void;
  showBackButton: boolean;
}

function ChatPane({
  activeConv, messages, messagesEndRef, input, setInput, sending,
  showQR, setShowQR, quickReplies, showProfile, setShowProfile,
  onSend, onKeyDown, onBlock, onStatusChange, onBack, showBackButton,
}: ChatPaneProps) {
  return (
    <>
      {/* Chat header */}
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50 flex-shrink-0">
        {showBackButton && onBack && (
          <button onClick={onBack} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors flex-shrink-0">
            <ArrowLeft size={16} className="text-gray-600" />
          </button>
        )}
        <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center flex-shrink-0">
          <span className="text-sky-600 text-xs font-bold">
            {(activeConv.user_profile?.display_name || '?')[0].toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {activeConv.user_profile?.display_name || '匿名用户'}
          </p>
          <p className="text-[10px] text-gray-400 truncate">
            {activeConv.user_profile?.phone || '该用户的专属会话'}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <select
            value={activeConv.status}
            onChange={e => onStatusChange(activeConv.id, e.target.value as Conversation['status'])}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white focus:outline-none"
          >
            <option value="open">进行中</option>
            <option value="resolved">已解决</option>
            <option value="closed">已关闭</option>
          </select>
          <button
            onClick={() => onBlock(activeConv)}
            title={activeConv.is_blocked ? '解除屏蔽' : '屏蔽用户'}
            className={`p-1.5 rounded-lg transition-colors ${activeConv.is_blocked ? 'text-red-500 bg-red-50' : 'text-gray-400 hover:bg-gray-100'}`}
          >
            <Ban size={14} />
          </button>
          <button
            onClick={() => setShowProfile(p => !p)}
            className={`p-1.5 rounded-lg transition-colors ${showProfile ? 'text-sky-500 bg-sky-50' : 'text-gray-400 hover:bg-gray-100'}`}
          >
            <User size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Message area + input */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-8">暂无消息记录</p>
            )}
            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {activeConv.is_blocked && (
            <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 text-center font-medium flex-shrink-0">
              该用户已被屏蔽
            </div>
          )}

          {!activeConv.is_blocked && (
            <div className="border-t border-gray-100 p-3 space-y-2 flex-shrink-0">
              {/* Quick reply toggle row */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <button
                  onClick={() => setShowQR(q => !q)}
                  className="flex-shrink-0 flex items-center gap-1 text-[10px] text-sky-500 border border-sky-200 rounded-lg px-2 py-1 hover:bg-sky-50 transition-colors"
                >
                  <Zap size={10} /> 快捷回复
                </button>
                {showQR && quickReplies.map(qr => (
                  <button
                    key={qr.id}
                    onClick={() => { setInput(qr.content); setShowQR(false); }}
                    className="flex-shrink-0 text-[10px] text-gray-600 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50 max-w-[120px] truncate transition-colors"
                  >
                    {qr.label}
                  </button>
                ))}
              </div>
              {/* Input row */}
              <div className="flex gap-2 items-end">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="回复内容（Enter 发送，Shift+Enter 换行）"
                  rows={2}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
                />
                <button
                  onClick={() => onSend(input)}
                  disabled={sending || !input.trim()}
                  className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-sky-500 hover:bg-sky-400 text-white rounded-xl transition-colors disabled:opacity-60"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Profile sidebar (desktop only) */}
        {showProfile && (
          <div className="hidden md:flex w-40 border-l border-gray-100 p-3 space-y-3 flex-shrink-0 flex-col overflow-y-auto bg-gray-50">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-600">用户资料</p>
              <button onClick={() => setShowProfile(false)} className="text-gray-400 hover:text-gray-600">
                <X size={12} />
              </button>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center mx-auto mb-2">
                <span className="text-sky-600 font-bold text-base">
                  {(activeConv.user_profile?.display_name || '?')[0].toUpperCase()}
                </span>
              </div>
              <p className="text-xs font-semibold text-gray-800 break-words">
                {activeConv.user_profile?.display_name || '匿名用户'}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {activeConv.user_profile?.phone || '未填写电话'}
              </p>
            </div>
            <div className="text-[10px] space-y-1.5 text-gray-500">
              <div className="flex justify-between">
                <span>状态</span>
                <span className={`font-semibold ${
                  activeConv.status === 'open'     ? 'text-sky-600'     :
                  activeConv.status === 'resolved' ? 'text-emerald-600' : 'text-gray-400'
                }`}>
                  {activeConv.status === 'open' ? '进行中' : activeConv.status === 'resolved' ? '已解决' : '已关闭'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>创建时间</span>
                <span>{new Date(activeConv.created_at).toLocaleDateString('zh')}</span>
              </div>
              <div className="flex justify-between">
                <span>屏蔽</span>
                <span className={activeConv.is_blocked ? 'text-red-500 font-semibold' : ''}>
                  {activeConv.is_blocked ? '是' : '否'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isAdmin = msg.sender_role === 'admin';
  const isPending = msg.id.startsWith('opt-');
  return (
    <div className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
        isAdmin ? 'bg-sky-500 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
      } ${isPending ? 'opacity-60' : ''}`}>
        <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
        <p className={`text-[9px] mt-0.5 text-right ${isAdmin ? 'text-sky-200' : 'text-gray-400'}`}>
          {new Date(msg.created_at).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
          {isPending && ' · 发送中'}
        </p>
      </div>
    </div>
  );
}

// ─── QuickRepliesManager ──────────────────────────────────────────────────────

function QuickRepliesManager({ quickReplies, onRefresh }: { quickReplies: QuickReply[]; onRefresh: () => void }) {
  const { user } = useAuth();
  const [expanded, setExpanded]   = useState(false);
  const [newLabel, setNewLabel]   = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function add() {
    if (!newLabel.trim() || !newContent.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('chat_quick_replies').insert({
      label: newLabel.trim(), content: newContent.trim(),
      sort_order: quickReplies.length, created_by: user?.id,
    });
    if (error) showToast('添加失败', 'error');
    else { showToast('已添加'); setNewLabel(''); setNewContent(''); onRefresh(); }
    setSaving(false);
  }

  async function remove(id: string) {
    await supabase.from('chat_quick_replies').delete().eq('id', id);
    onRefresh();
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-white rounded-2xl border border-gray-100 shadow-sm text-sm text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <Zap size={14} className="text-amber-500" />
        快捷回复管理
        <ChevronRight size={14} className="ml-auto text-gray-300" />
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-amber-500" />
          <p className="text-sm font-semibold text-gray-800">快捷回复管理</p>
        </div>
        <button onClick={() => setExpanded(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>

      {quickReplies.length === 0 && <p className="text-xs text-gray-400 text-center py-2">暂无快捷回复</p>}
      {quickReplies.map(qr => (
        <div key={qr.id} className="flex items-start gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-700">{qr.label}</p>
            <p className="text-xs text-gray-500 truncate">{qr.content}</p>
          </div>
          <button onClick={() => remove(qr.id)} className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
            <Trash2 size={12} />
          </button>
        </div>
      ))}

      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-xs font-semibold text-gray-500">添加新快捷回复</p>
        <input
          value={newLabel} onChange={e => setNewLabel(e.target.value)}
          placeholder="标签（如：感谢您的反馈）"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 text-gray-900 placeholder-gray-400"
        />
        <textarea
          value={newContent} onChange={e => setNewContent(e.target.value)}
          placeholder="回复内容" rows={2}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 text-gray-900 placeholder-gray-400 resize-none"
        />
        <button
          onClick={add} disabled={saving || !newLabel.trim() || !newContent.trim()}
          className="w-full flex items-center justify-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl py-2 text-sm font-medium transition-colors disabled:opacity-60"
        >
          <Plus size={14} /> 添加
        </button>
      </div>
    </div>
  );
}
