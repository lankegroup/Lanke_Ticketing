import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

export default function LangToggle() {
  const { i18n: i18nInstance } = useTranslation();

  function toggle() {
    const next = i18nInstance.language === 'zh' ? 'en' : 'zh';
    i18nInstance.changeLanguage(next);
    localStorage.setItem('lang', next);
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white text-sm font-medium"
    >
      <Globe size={15} />
      <span>{i18nInstance.language === 'zh' ? 'EN' : '中'}</span>
    </button>
  );
}
