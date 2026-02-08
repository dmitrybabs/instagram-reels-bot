import { useState } from 'react';

export function App() {
  const [setupUrl, setSetupUrl] = useState('');
  const [setupResult, setSetupResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSetup = async () => {
    if (!setupUrl.trim()) return;
    setLoading(true);
    setSetupResult(null);
    try {
      const url = setupUrl.replace(/\/$/, '') + '/api/setup';
      const res = await fetch(url);
      const data = await res.json();
      setSetupResult(JSON.stringify(data, null, 2));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setSetupResult('Ошибка: ' + msg);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 shadow-lg shadow-pink-500/20 mx-auto">
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold">Instagram Reels Bot</h1>
          <p className="text-gray-400">Telegram бот для скачивания Reels</p>
          <div className="flex items-center justify-center gap-2 text-sm text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Бот активен
          </div>
        </div>

        {/* What is this */}
        <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 space-y-4">
          <h2 className="font-semibold text-lg">🤖 Что это?</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Это <b className="text-white">Telegram бот</b>, а не сайт. Эта страница — просто информационная панель. 
            Весь функционал работает <b className="text-white">внутри Telegram</b>.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-gray-800/50 text-center">
              <div className="text-2xl mb-1">🎬</div>
              <div className="text-xs text-gray-400">Скачивание Reels</div>
            </div>
            <div className="p-3 rounded-xl bg-gray-800/50 text-center">
              <div className="text-2xl mb-1">📢</div>
              <div className="text-xs text-gray-400">Рассылка</div>
            </div>
            <div className="p-3 rounded-xl bg-gray-800/50 text-center">
              <div className="text-2xl mb-1">📊</div>
              <div className="text-xs text-gray-400">Статистика</div>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 space-y-4">
          <h2 className="font-semibold text-lg">📱 Как пользоваться</h2>
          <div className="space-y-3">
            {[
              { n: '1', text: 'Откройте бота в Telegram' },
              { n: '2', text: 'Отправьте /start' },
              { n: '3', text: 'Скопируйте ссылку на Instagram Reels' },
              { n: '4', text: 'Отправьте ссылку боту — получите видео!' },
            ].map((s) => (
              <div key={s.n} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold shrink-0">
                  {s.n}
                </div>
                <span className="text-gray-300 text-sm">{s.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Admin commands */}
        <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 space-y-4">
          <h2 className="font-semibold text-lg">🔧 Команды (в Telegram)</h2>
          <div className="space-y-2">
            {[
              { cmd: '/start', desc: 'Начать работу' },
              { cmd: '/help', desc: 'Справка' },
              { cmd: '/broadcast', desc: 'Рассылка (админ)' },
              { cmd: '/cancel', desc: 'Отмена рассылки (админ)' },
              { cmd: '/stats', desc: 'Статистика (админ)' },
            ].map((c) => (
              <div key={c.cmd} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-800/50">
                <code className="text-blue-400 text-sm font-medium">{c.cmd}</code>
                <span className="text-gray-500 text-sm">{c.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Setup section */}
        <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 space-y-4">
          <h2 className="font-semibold text-lg">⚙️ Первоначальная настройка Webhook</h2>
          <p className="text-gray-400 text-sm">
            После деплоя на Vercel введите URL вашего проекта и нажмите «Настроить»:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={setupUrl}
              onChange={(e) => setSetupUrl(e.target.value)}
              placeholder="https://your-project.vercel.app"
              className="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSetup}
              disabled={loading}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              {loading ? '⏳' : '🔗 Настроить'}
            </button>
          </div>
          {setupResult && (
            <pre className="p-3 bg-gray-800 rounded-lg text-xs text-green-400 overflow-x-auto max-h-64 overflow-y-auto">
              {setupResult}
            </pre>
          )}
        </div>

        {/* Deployment checklist */}
        <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 space-y-4">
          <h2 className="font-semibold text-lg">📋 Чек-лист деплоя</h2>
          <div className="space-y-2 text-sm">
            {[
              { env: 'BOT_TOKEN', desc: 'Токен Telegram бота', required: true },
              { env: 'UPSTASH_REDIS_REST_URL', desc: 'URL базы Upstash Redis', required: true },
              { env: 'UPSTASH_REDIS_REST_TOKEN', desc: 'Токен Upstash Redis', required: true },
              { env: 'PROXY_URL', desc: 'HTTP прокси (уже встроен)', required: false },
            ].map((e) => (
              <div key={e.env} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-800/50">
                <span className={`w-2 h-2 rounded-full ${e.required ? 'bg-red-400' : 'bg-gray-600'}`} />
                <code className="text-yellow-400 font-mono text-xs">{e.env}</code>
                <span className="text-gray-500 text-xs ml-auto">{e.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            🔴 = обязательно • ⚫ = опционально (есть значение по умолчанию)
          </p>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-600 pb-8">
          Telegram Bot API • Vercel Serverless • Upstash Redis
        </div>
      </div>
    </div>
  );
}
