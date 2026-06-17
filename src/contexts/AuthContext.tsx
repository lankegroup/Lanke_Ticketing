import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase, AdminProfile, UserProfile } from '../lib/supabase';
import type { User, RealtimeChannel } from '@supabase/supabase-js';

type AuthContextType = {
  user: User | null;
  profile: AdminProfile | null;
  userProfile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signInClient: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

const MAX_SESSIONS = 10;

function generateSessionKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2)}`;
}

function usernameToEmail(username: string) {
  return `${username.toLowerCase()}@admin.ticketing.local`;
}

function usernameToClientEmail(phone: string) {
  return `${phone.replace(/\D/g, '')}@user.ticketing.local`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const sessionChannelRef = useRef<RealtimeChannel | null>(null);

  async function fetchProfile(uid: string) {
    const { data: adminData } = await supabase.from('admin_profiles').select('*').eq('id', uid).maybeSingle();
    if (adminData) {
      setProfile(adminData);
      setIsAdmin(true);
      return;
    }
    setProfile(null);
    setIsAdmin(false);
  }

  async function fetchUserProfile(uid: string) {
    const { data } = await supabase.from('user_profiles').select('*').eq('id', uid).maybeSingle();
    setUserProfile(data);
  }

  function subscribeToSessionKick(userId: string, sessionKey: string) {
    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
    }
    const channel = supabase
      .channel(`session-kick:${sessionKey}`)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'user_sessions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const deletedKey = (payload.old as Record<string, unknown>).session_key;
          const myKey = localStorage.getItem('session_key');
          if (deletedKey === myKey) {
            localStorage.removeItem('session_key');
            supabase.auth.signOut();
          }
        }
      )
      .subscribe();
    sessionChannelRef.current = channel;
  }

  async function registerSession(userId: string) {
    const key = generateSessionKey();
    localStorage.setItem('session_key', key);

    await supabase.from('user_sessions').insert({ user_id: userId, session_key: key });

    // Enforce device limit: delete oldest sessions beyond MAX_SESSIONS
    const { data: allSessions } = await supabase
      .from('user_sessions')
      .select('id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (allSessions && allSessions.length > MAX_SESSIONS) {
      const idsToDelete = allSessions
        .slice(0, allSessions.length - MAX_SESSIONS)
        .map((s: { id: string }) => s.id);
      await supabase.from('user_sessions').delete().in('id', idsToDelete);
    }

    subscribeToSessionKick(userId, key);
  }

  async function cleanupSession() {
    const key = localStorage.getItem('session_key');
    if (key) {
      await supabase.from('user_sessions').delete().eq('session_key', key);
      localStorage.removeItem('session_key');
    }
    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
      sessionChannelRef.current = null;
    }
  }

  useEffect(() => {
    let ignore = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (ignore) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        Promise.all([fetchProfile(u.id), fetchUserProfile(u.id)]).finally(() => setLoading(false));
        // Re-subscribe on page refresh for existing session
        const key = localStorage.getItem('session_key');
        if (key) subscribeToSessionKick(u.id, key);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchProfile(u.id);
        fetchUserProfile(u.id);
        if (_event === 'SIGNED_IN') {
          registerSession(u.id);
        }
      } else {
        setProfile(null);
        setUserProfile(null);
        setIsAdmin(false);
        cleanupSession();
      }
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(username: string, password: string) {
    const email = usernameToEmail(username);
    await supabase.auth.signOut({ scope: 'local' });
    
    try {
      const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      
      if (!supabaseUrl) {
        return { error: '系统配置错误：未配置 Supabase URL' };
      }
      
      const prepareRes = await fetch(`${supabaseUrl}/functions/v1/setup-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });

      const prepareData = await prepareRes.json();
      if (!prepareRes.ok || !prepareData.ok) {
        return { error: prepareData.error || '登录准备失败，请联系管理员' };
      }
      
      await new Promise(r => setTimeout(r, 300));
      
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) return { error: null };
      
      if (error.message?.includes('Invalid login credentials')) {
        return { error: '用户名或密码错误，请使用 LANKE / 88888888' };
      }
      
      if (error.message?.includes('Session limit exceeded')) {
        return { error: '登录设备已达上限，请清除旧会话后重试' };
      }
      
      return { error: `登录失败: ${error.message}` };
    } catch (e: any) {
      console.error('[signIn admin] API error:', e.message);
      
      if (e.message?.includes('Failed to fetch')) {
        return { error: '网络连接失败，请检查网络' };
      }
      
      return { error: `登录失败: ${e.message}` };
    }
  }

  async function signInClient(username: string, password: string) {
    const email = usernameToClientEmail(username);
    await supabase.auth.signOut({ scope: 'local' });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message?.toLowerCase().includes('session') && error.message?.toLowerCase().includes('limit')) {
        await supabase.auth.signOut({ scope: 'local' });
        const retry = await supabase.auth.signInWithPassword({ email, password });
        if (retry.error) return { error: retry.error.message };
        return { error: null };
      }
      console.error('[signInClient] error:', error.message, error);
      return { error: error.message };
    }
    return { error: null };
  }

  async function signOut() {
    await cleanupSession();
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id);
  }

  async function refreshUserProfile() {
    if (user) await fetchUserProfile(user.id);
  }

  return (
    <AuthContext.Provider value={{ user, profile, userProfile, isAdmin, loading, signIn, signInClient, signOut, refreshProfile, refreshUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { usernameToEmail, usernameToClientEmail };
