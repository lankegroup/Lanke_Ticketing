import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, FeedbackTicket } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { MessageSquare, Reply, ChevronDown } from 'lucide-react';
import Toast from '../Toast';

export default function FeedbackManagement() {
  const { t } = useTranslation();

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">{t('feedback')}</h2>
      <FeedbackList />
    </div>
  );
}

function FeedbackList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [feedbacks, setFeedbacks] = useState<FeedbackTicket[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [statusUpdate, setStatusUpdate] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchFeedbacks(); }, []);

  async function fetchFeedbacks() {
    const { data } = await supabase.from('feedback_tickets').select('*').order('created_at', { ascending: false });
    setFeedbacks(data ?? []);
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleReply(id: string) {
    if (!replyText.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('feedback_tickets').update({
      admin_reply: replyText.trim(),
      replied_at: new Date().toISOString(),
      replied_by: user?.id,
    }).eq('id', id);
    if (error) {
      showToast(t('operation_failed'), 'error');
    } else {
      showToast(t('save_success'));
      setReplyText('');
      setExpanded(null);
      fetchFeedbacks();
    }
    setSaving(false);
  }

  async function handleStatusChange(id: string, newStatus: string) {
    const { error } = await supabase.from('feedback_tickets').update({ status: newStatus }).eq('id', id);
    if (error) {
      showToast(t('operation_failed'), 'error');
    } else {
      showToast(t('save_success'));
      setStatusUpdate(null);
      fetchFeedbacks();
    }
  }

  const statusLabels: Record<string, string> = {
    pending: t('status_pending'),
    in_progress: t('status_in_progress'),
    resolved: t('status_resolved'),
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    in_progress: 'bg-sky-100 text-sky-700',
    resolved: 'bg-emerald-100 text-emerald-700',
  };

  if (feedbacks.length === 0) {
    return (
      <div className="text-center py-16">
        <MessageSquare size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-sm text-gray-400">{t('no_data')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {feedbacks.map(fb => (
        <div key={fb.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === fb.id ? null : fb.id)}
            className="w-full p-4 text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{fb.subject}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fb.ticket_number} · {new Date(fb.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[fb.status]}`}>
                  {statusLabels[fb.status]}
                </span>
                <ChevronDown size={14} className={`text-gray-300 transition-transform ${expanded === fb.id ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </button>

          {expanded === fb.id && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
              {fb.description && (
                <p className="text-sm text-gray-600">{fb.description}</p>
              )}

              {fb.admin_reply && (
                <div className="bg-sky-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-sky-700 mb-1">{t('feedback_reply')}</p>
                  <p className="text-sm text-gray-700">{fb.admin_reply}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{new Date(fb.replied_at!).toLocaleString()}</p>
                </div>
              )}

              {/* Status change */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{t('change_status')}:</span>
                {(['pending', 'in_progress', 'resolved'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(fb.id, s)}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                      fb.status === s
                        ? 'bg-sky-500 text-white border-sky-500'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {statusLabels[s]}
                  </button>
                ))}
              </div>

              {/* Reply input */}
              <div className="flex gap-2">
                <input
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder={t('reply')}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                <button
                  onClick={() => handleReply(fb.id)}
                  disabled={saving || !replyText.trim()}
                  className="flex items-center gap-1 bg-sky-500 hover:bg-sky-400 text-white px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                >
                  <Reply size={14} /> {t('reply')}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
