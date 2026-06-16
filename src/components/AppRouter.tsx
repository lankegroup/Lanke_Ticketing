import { useEffect, useState } from 'react';
import '../lib/i18n';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import AdminLogin from './admin/AdminLogin';
import AdminLayout from './admin/AdminLayout';
import ClientLayout from './client/ClientLayout';
import KioskMode from './admin/KioskMode';

const KIOSK_SS_KEY = 'kiosk_mode_active';
export const KIOSK_PASSWORD_KEY = 'kiosk_exit_password';
export const DEFAULT_KIOSK_PASSWORD = '88888888';

export function getKioskPassword() {
  try { return localStorage.getItem(KIOSK_PASSWORD_KEY) || DEFAULT_KIOSK_PASSWORD; } catch { return DEFAULT_KIOSK_PASSWORD; }
}

export function enterKioskMode() {
  sessionStorage.setItem(KIOSK_SS_KEY, '1');
  window.dispatchEvent(new CustomEvent('kiosk_mode_changed', { detail: { active: true } }));
}

export function exitKioskMode() {
  sessionStorage.removeItem(KIOSK_SS_KEY);
  window.dispatchEvent(new CustomEvent('kiosk_mode_changed', { detail: { active: false } }));
}

// Route based on URL path: /admin -> admin side, else -> client side
function Router() {
  const isAdminPath = window.location.pathname.startsWith('/admin');
  const { user, isAdmin, loading } = useAuth();
  const [seeded, setSeeded] = useState(false);
  const [kioskActive, setKioskActive] = useState(() => sessionStorage.getItem(KIOSK_SS_KEY) === '1');

  useEffect(() => {
    function onKioskChange(e: Event) {
      setKioskActive((e as CustomEvent<{ active: boolean }>).detail.active);
    }
    window.addEventListener('kiosk_mode_changed', onKioskChange);
    return () => window.removeEventListener('kiosk_mode_changed', onKioskChange);
  }, []);

  useEffect(() => {
    // Seed admin user on first app load
    const key = 'admin_seeded_v1';
    if (!localStorage.getItem(key)) {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/setup-admin`;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      }).then(() => {
        localStorage.setItem(key, '1');
        setSeeded(true);
      }).catch(() => setSeeded(true));
    } else {
      setSeeded(true);
    }
  }, []);

  if (!seeded && !isAdminPath) return null;
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (isAdminPath) {
    // Kiosk mode intercepts the admin route — page refresh cannot bypass it
    if (kioskActive && user && isAdmin) {
      return (
        <KioskMode
          exitPassword={getKioskPassword()}
          onExit={() => exitKioskMode()}
        />
      );
    }
    // Only users with an admin profile may enter AdminLayout
    if (!user || !isAdmin) return <AdminLogin />;
    return <AdminLayout />;
  }

  return <ClientLayout />;
}

export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
