import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, usernameToEmail } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, User, Lock } from 'lucide-react';
import Toast from '../Toast';

export default function AdminSettings({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const [username, setUsername] = useState(profile?.username ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSave() {
    if (newPassword && newPassword !== confirmPassword) {
      showToast(t('passwords_not_match'), 'error');
      return;
    }
    setSaving(true);
    try {
      if (username !== profile?.username) {
        const newEmail = usernameToEmail(username);
        const { error: emailErr } = await supabase.auth.updateUser({ email: newEmail });
        if (emailErr) throw emailErr;
        await supabase.from('admin_profiles').update({ username }).eq('id', user!.id);
      }
      if (newPassword) {
        const { error: pwErr } = await supabase.auth.updateUser({ password: newPassword });
        if (pwErr) throw pwErr;
      }
      await refreshProfile();
      setNewPassword('');
      setConfirmPassword('');
      showToast(t('update_success'));
    } catch (e: any) {
      showToast(e.message || t('operation_failed'), 'error');
    }
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="font-semibold text-sm">{t('settings')}</h2>
      </div>

      <div className="p-4 space-y-4 max-w-sm mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <User size={16} className="text-sky-500" /> 账号信息
          </h3>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('new_username')}</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <Lock size={16} className="text-sky-500" /> 修改密码
          </h3>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('new_password')}</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="留空则不修改"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('confirm_password')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
        >
          {saving ? t('loading') : t('update_profile')}
        </button>
      </div>
    </div>
  );
}
