import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/i18n';
import './index.css';
import { envConfig } from './lib/supabase';

function ConfigError() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">配置错误</h1>
        <p className="text-gray-600 mb-6">请配置正确的环境变量：</p>
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
          <div className="text-sm font-mono text-gray-700 mb-2">VITE_SUPABASE_URL</div>
          <div className="text-sm font-mono text-gray-700">VITE_SUPABASE_ANON_KEY</div>
        </div>
        <p className="text-gray-500 text-sm">
          在 Netlify/Vercel 控制台的环境变量中添加以上配置
        </p>
      </div>
    </div>
  );
}

async function loadApp() {
  const { default: App } = await import('./App');
  
  const root = createRoot(document.getElementById('root')!);
  
  if (!envConfig.hasValidConfig) {
    root.render(<ConfigError />);
    return;
  }
  
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

loadApp();
