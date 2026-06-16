import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Ticket, Lock, User, RefreshCw } from 'lucide-react';

export default function AdminLogin() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionLimitHit, setSessionLimitHit] = useState(false);

  async function doLogin(forceClean = false) {
    setError('');
    setSessionLimitHit(false);
    setLoading(true);

    if (forceClean) {
      // Wipe all local auth state and custom session records
      await supabase.auth.signOut({ scope: 'local' });
      localStorage.removeItem('session_key');
      // Small delay to let signOut propagate
      await new Promise(r => setTimeout(r, 300));
    }

    const { error: err } = await signIn(username, password);

    if (err) {
      const msg = err.toLowerCase();
      if (msg.includes('session') && (msg.includes('limit') || msg.includes('exceeded'))) {
        setSessionLimitHit(true);
        setError(t('session_limit_exceeded') || '当前已达到登录设备上限，请点击下方按钮强制重新登录。');
      } else {
        setError(t('login_failed'));
      }
    }

    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(false);
  }

  async function handleForceLogin() {
    await doLogin(true);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-sky-500 rounded-2xl flex items-center justify-center shadow-lg mb-4">
            <Ticket size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('admin_login')}</h1>
          <p className="text-slate-400 text-sm mt-1">Ticket Management System</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('username')}</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t('username')}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('password')}</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('password')}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent text-sm"
                required
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm mt-2"
          >
            {loading ? t('loading') : t('login')}
          </button>

          {sessionLimitHit && (
            <button
              type="button"
              onClick={handleForceLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              <RefreshCw size={15} />
              {loading ? t('loading') : '清除旧会话并重新登录'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
