import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LangToggle from '../LangToggle';
import ClientHome from './ClientHome';
import MyPage from './MyPage';
import { Home, User, Ticket } from 'lucide-react';

type Tab = 'home' | 'my';

export default function ClientLayout() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('home');

  const isEn = i18n.language === 'en';

  return (
    <div
      className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto relative"
      style={{ fontFamily: isEn ? "'Inter', 'Helvetica Neue', sans-serif" : undefined }}
    >
      {/* Header */}
      <header className="bg-gradient-to-r from-sky-600 to-cyan-500 text-white px-5 pt-5 pb-3 flex items-center justify-between sticky top-0 z-30 shadow-md gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Ticket size={18} className="flex-shrink-0" />
          <div className="min-w-0">
            {isEn ? (
              <span className="font-bold text-sm tracking-wide leading-tight">{t('app_name')}</span>
            ) : (
              <>
                <div className="font-bold text-sm leading-tight whitespace-nowrap">兰克集团</div>
                <div className="text-[10px] text-sky-100 leading-tight whitespace-nowrap">数智一体化票务运营平台</div>
              </>
            )}
          </div>
        </div>
        <LangToggle />
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-24">
        {tab === 'home' && <ClientHome />}
        {tab === 'my' && <MyPage />}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200 flex z-30 pb-safe-bottom">
        {([
          { id: 'home' as Tab, label: t('home'), icon: Home },
          { id: 'my' as Tab, label: t('my'), icon: User },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
              tab === id ? 'text-sky-500' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Icon size={22} />
            <span className={`font-medium ${isEn ? 'text-[9px] tracking-tight' : 'text-[10px]'}`}>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
