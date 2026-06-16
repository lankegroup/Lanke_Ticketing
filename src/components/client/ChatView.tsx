import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Send, MessageCircle, RefreshCcw, LogIn, ArrowLeft } from 'lucide-react';

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_role: 'user' | 'admin';
  content: string;
  is_filtered: boolean;
  created_at: string;
}

interface ChatViewProps {
  isEn?: boolean;
  onBack?: () => void;
}

const T = {
  title:       { zh: '在线客服', en: 'Live Support' },
  online:      { zh: '在线', en: 'Online' },
  busy:        { zh: '忙碌', en: 'Busy' },
  offline:     { zh: '离线', en: 'Offline' },
  placeholder: { zh: '输入消息…（Enter 发送）', en: 'Type a message… (Enter to send)' },
  empty:       { zh: '发送消息，客服将尽快回复您。', en: 'Send a message and our team will reply shortly.' },
  send_failed: { zh: '发送失败，点击重试', en: 'Failed to send — tap to retry' },
  blocked:     { zh: '您的账号已被限制发送消息。', en: 'Your account has been restricted.' },
  loading:     { zh: '加载中…', en: 'Loading…' },
  login_tip:   { zh: '请先登录后再使用客服功能', en: 'Please log in to use live support' },
  sending:     { zh: '发送中', en: 'Sending' },
};

function tx(key: keyof typeof T, isEn: boolean): string {
  return isEn ? T[key].en : T[key].zh;
}

export default function ChatView({ isEn = false, onBack }: ChatViewProps) {
  const { user } = useAuth();
  const [convId, setConvId]             = useState<string | null>(null);
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [failedContent, setFailedContent] = useState<string | null>(null);
  const [adminStatus, setAdminStatus]   = useState<'online' | 'busy' | 'offline'>('offline');
  const [isBlocked, setIsBlocked]       = useState(false);
  const [loading, setLoading]           = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Ref so interval callbacks see the current convId without stale closure
  const convIdRef = useRef<string | null>(null);
  useEffect(() => { convIdRef.current = convId; }, [convId]);

  // ── Init when user is available ──
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    initConversation();
    fetchAdminStatus();
    const statusInterval = setInterval(fetchAdminStatus, 60_000);
    return () => clearInterval(statusInterval);
  }, [user]);

  // ── Realtime: listen for new messages in this conversation ──
  useEffect(() => {
    if (!convId || !user) return;

    const ch = supabase
      .channel(`client-chat-${convId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        payload => {
          const incoming = payload.new as ChatMessage;
          // Guard: only accept messages that belong to THIS user's conversation
          if (incoming.conversation_id !== convIdRef.current) return;
          setMessages(prev => {
            const exists = prev.some(m => m.id === incoming.id);
            return exists ? prev : [...prev, incoming];
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [convId, user]);

  // ── Polling fallback (4 s) — ensures delivery even if realtime subscription
  //    is delayed or the tab was backgrounded ──
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      if (convIdRef.current) refreshMessages(convIdRef.current);
    }, 4_000);
    return () => clearInterval(t);
  }, [user]);

  // ── Auto-scroll on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Mark user's unread as 0 when viewing (direct UPDATE, no RPC) ──
  useEffect(() => {
    if (!convId || !user) return;
    supabase.from('chat_conversations').update({ user_unread: 0 }).eq('id', convId);
  }, [convId, messages.length]);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async function initConversation() {
    setLoading(true);
    // get_or_create_conversation is SECURITY DEFINER — keeps atomic create-or-find
    const { data, error } = await supabase.rpc('get_or_create_conversation');
    if (error || !data) {
      console.error('get_or_create_conversation failed:', error);
      setLoading(false);
      return;
    }
    const conv = data as { id: string; is_blocked: boolean };
    setConvId(conv.id);
    setIsBlocked(conv.is_blocked ?? false);

    const { data: msgs, error: msgsErr } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    if (msgsErr) console.error('fetchMessages failed:', msgsErr);
    setMessages(msgs ?? []);
    setLoading(false);
  }

  async function fetchAdminStatus() {
    const { data } = await supabase
      .from('admin_chat_status')
      .select('status')
      .order('last_seen', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) setAdminStatus((data as { status: 'online' | 'busy' | 'offline' }).status);
  }

  // Background poll: replace all messages with DB state.
  // opt- entries that are still in-flight (INSERT not yet returned) are preserved;
  // all others are dropped since the DB now has the authoritative list.
  async function refreshMessages(cId: string) {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', cId)
      .order('created_at', { ascending: true });

    if (!data || cId !== convIdRef.current) return;

    setMessages(prev => {
      // Keep only optimistic entries whose INSERT is still pending (sending === true
      // would be ideal, but using the presence of the opt- key is sufficient here —
      // sendMessage replaces them with DB data synchronously on INSERT completion).
      const inFlight = prev.filter(m => m.id.startsWith('opt-'));
      return [...data, ...inFlight] as ChatMessage[];
    });
  }

  async function sendMessage(content: string) {
    if (!convId || !user || !content.trim() || sending || isBlocked) return;
    setSending(true);
    setFailedContent(null);

    // Optimistic — user sees their own message immediately
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      conversation_id: convId,
      sender_id: user.id,
      sender_role: 'user',
      content: content.trim(),
      is_filtered: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');

    // Direct INSERT — preserves the user's JWT so Supabase Realtime correctly
    // filters and delivers the event to the admin's subscription.
    // NOTE: do NOT chain .select().single() — PostgREST's RETURNING + SELECT RLS
    // can return 0 rows even on a successful insert, which would cause .single()
    // to throw PGRST116 and falsely report a send failure.
    // The optimistic entry will be confirmed and replaced by the 4-second poll.
    const { error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: convId,
        sender_id: user.id,
        sender_role: 'user',
        content: content.trim(),
        is_filtered: false,
      });

    if (error) {
      console.error('[ChatView] sendMessage failed:', error.code, error.message, error.details);
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setInput(content.trim());
      setFailedContent(content.trim());
    } else {
      // INSERT succeeded — fetch real messages immediately to replace the optimistic
      // entry (which carries an opt- id and shows "Sending...") with the DB record.
      const { data: fresh } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      if (fresh && convId === convIdRef.current) {
        setMessages(fresh as ChatMessage[]);
      }
    }
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  const statusDot: Record<string, string> = {
    online:  'bg-emerald-400',
    busy:    'bg-amber-400',
    offline: 'bg-gray-400',
  };
  const statusLabel = adminStatus === 'online' ? tx('online', isEn)
    : adminStatus === 'busy' ? tx('busy', isEn) : tx('offline', isEn);

  // ─── Guards ────────────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="flex-1 flex flex-col">
        {onBack && <ChatHeader onBack={onBack} isEn={isEn} adminStatus={adminStatus} statusDot={statusDot} statusLabel={statusLabel} />}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
          <LogIn size={32} className="text-gray-300" />
          <p className="text-sm text-gray-400 text-center">{tx('login_tip', isEn)}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col">
        {onBack && <ChatHeader onBack={onBack} isEn={isEn} adminStatus={adminStatus} statusDot={statusDot} statusLabel={statusLabel} />}
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400">{tx('loading', isEn)}</p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header — always shown; includes back button when onBack is provided */}
      <div className="px-4 py-3 flex items-center gap-3 bg-sky-500 flex-shrink-0">
        {onBack && (
          <button onClick={onBack} className="p-1 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
            <ArrowLeft size={18} className="text-white" />
          </button>
        )}
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <MessageCircle size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{tx('title', isEn)}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`w-2 h-2 rounded-full ${statusDot[adminStatus]}`} />
            <span className="text-xs text-sky-100">{statusLabel}</span>
          </div>
        </div>
      </div>

      {/* Message list — grows to fill available space and scrolls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="text-center py-10">
            <MessageCircle size={32} className="mx-auto text-gray-200 mb-3" />
            <p className="text-xs text-gray-400">{tx('empty', isEn)}</p>
          </div>
        )}
        {messages.map(msg => {
          const isUser = msg.sender_role === 'user';
          const isPending = msg.id.startsWith('opt-');
          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                isUser ? 'bg-sky-500 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              } ${isPending ? 'opacity-60' : ''}`}>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                <p className={`text-[9px] mt-0.5 text-right ${isUser ? 'text-sky-200' : 'text-gray-400'}`}>
                  {new Date(msg.created_at).toLocaleTimeString(isEn ? 'en' : 'zh', { hour: '2-digit', minute: '2-digit' })}
                  {isPending && ` · ${tx('sending', isEn)}`}
                </p>
              </div>
            </div>
          );
        })}

        {/* Retry row for failed sends */}
        {failedContent && (
          <div className="flex justify-end">
            <button
              onClick={() => { setFailedContent(null); sendMessage(failedContent); }}
              className="flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm bg-red-50 text-red-600 border border-red-200 rounded-br-sm max-w-[78%]"
            >
              <RefreshCcw size={12} className="flex-shrink-0" />
              <span className="truncate">{tx('send_failed', isEn)}</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Blocked banner */}
      {isBlocked && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 text-center flex-shrink-0">
          {tx('blocked', isEn)}
        </div>
      )}

      {/* Input area — pinned at bottom, never scrolls */}
      {!isBlocked && (
        <div className="border-t border-gray-100 p-3 flex gap-2 flex-shrink-0 bg-white">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tx('placeholder', isEn)}
            rows={2}
            disabled={sending}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={sending || !input.trim()}
            className="flex-shrink-0 w-10 h-10 self-end flex items-center justify-center bg-sky-500 hover:bg-sky-400 text-white rounded-xl transition-colors disabled:opacity-60"
          >
            <Send size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Internal helper: header for guard screens ────────────────────────────────
function ChatHeader({ onBack, isEn, adminStatus, statusDot, statusLabel }: {
  onBack: () => void;
  isEn: boolean;
  adminStatus: string;
  statusDot: Record<string, string>;
  statusLabel: string;
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-3 bg-sky-500 flex-shrink-0">
      <button onClick={onBack} className="p-1 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
        <ArrowLeft size={18} className="text-white" />
      </button>
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
        <MessageCircle size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{isEn ? 'Live Support' : '在线客服'}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`w-2 h-2 rounded-full ${statusDot[adminStatus]}`} />
          <span className="text-xs text-sky-100">{statusLabel}</span>
        </div>
      </div>
    </div>
  );
}
