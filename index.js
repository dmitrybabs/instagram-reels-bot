require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = 706357294;
const app = express();

app.use(express.json());

console.log('🚀 Быстрый Instagram бот запущен');

const bot = new TelegramBot(token);
let users = [];

// Простая функция для проверки ссылки
function isInstagramUrl(text) {
  return text.includes('instagram.com/reel/') || 
         text.includes('instagram.com/p/') || 
         text.includes('instagram.com/tv/');
}

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'друг';
  
  if (!users.includes(chatId)) {
    users.push(chatId);
  }
  
  bot.sendMessage(chatId, 
    `👋 Привет, ${userName}!\n\n` +
    `📹 Я помогу скачать видео из Instagram.\n\n` +
    `Просто пришли мне ссылку на Reels, и я дам инструкции.\n\n` +
    `🚀 Работает моментально!`
  ).catch(e => console.log('Ошибка:', e.message));
});

// Обработка ссылок
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  
  if (isInstagramUrl(text)) {
    try {
      // Извлекаем короткий код из ссылки
      const shortcode = text.match(/instagram\.com\/(reel|p|tv)\/([^\/?]+)/)?.[2];
      
      if (!shortcode) {
        throw new Error('Неверная ссылка');
      }
      
      // Быстрый ответ с вариантами скачивания
      await bot.sendMessage(chatId, 
        `✅ Ссылка получена: ${shortcode}\n\n` +
        `📥 Варианты скачивания:\n\n` +
        `1. 🌐 **InstaDownloader**\n` +
        `   https://instadownloader.co/instagram-reel-downloader\n\n` +
        `2. 🚀 **SaveFromNet**\n` +
        `   https://savefromnet.com/instagram-reels-downloader\n\n` +
        `3. 📱 **SnapInsta**\n` +
        `   https://snapinsta.app/\n\n` +
        `💡 Просто вставьте вашу ссылку на эти сайты.\n\n` +
        `🔗 Ваша ссылка:\n\`${text}\``,
        { parse_mode: 'Markdown' }
      );
      
      // Отправляем быструю кнопку для перехода
      await bot.sendMessage(chatId, 
        'Быстрый переход:',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🌐 InstaDownloader', url: 'https://instadownloader.co/instagram-reel-downloader' },
                { text: '🚀 SaveFromNet', url: 'https://savefromnet.com/instagram-reels-downloader' }
              ],
              [
                { text: '📱 SnapInsta', url: 'https://snapinsta.app/' },
                { text: '💾 Savetik', url: 'https://savetik.co/' }
              ]
            ]
          }
        }
      );
      
    } catch (error) {
      await bot.sendMessage(chatId, 
        `❌ Ошибка обработки ссылки.\n\n` +
        `Проверьте правильность ссылки и попробуйте снова.`
      );
    }
  }
});

// Админ команды
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (parseInt(msg.chat.id) !== ADMIN_ID) return;
  
  const text = match[1];
  let sent = 0;
  
  for (const userId of users) {
    try {
      await bot.sendMessage(userId, `📢 ${text}`);
      sent++;
    } catch (e) {
      console.log('Ошибка рассылки:', e.message);
    }
  }
  
  bot.sendMessage(ADMIN_ID, `✅ Рассылка: ${sent}/${users.length}`);
});

bot.onText(/\/stats/, (msg) => {
  if (parseInt(msg.chat.id) !== ADMIN_ID) return;
  
  bot.sendMessage(ADMIN_ID, 
    `📊 Статистика:\n` +
    `👥 Пользователей: ${users.length}\n` +
    `🆔 Ваш ID: ${msg.chat.id}`
  );
});

// Простая команда помощи
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `❓ Помощь:\n\n` +
    `/start - Начать работу\n` +
    `/help - Эта справка\n` +
    `\n` +
    `📹 Просто отправьте ссылку на Instagram Reels!\n` +
    `Примеры:\n` +
    `• https://www.instagram.com/reel/ABC123/\n` +
    `• https://www.instagram.com/p/XYZ456/`
  );
});

// Webhook
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Статус страница
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Instagram Reels Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          .stats { background: #f5f5f5; padding: 20px; border-radius: 10px; }
          .btn { display: inline-block; background: #0088cc; color: white; padding: 10px 20px; 
                 border-radius: 5px; text-decoration: none; margin: 5px; }
        </style>
      </head>
      <body>
        <h1>🤖 Instagram Reels Bot</h1>
        <div class="stats">
          <p><strong>Статус:</strong> ✅ Работает</p>
          <p><strong>Пользователей:</strong> ${users.length}</p>
          <p><strong>Скорость:</strong> ⚡ Мгновенная</p>
        </div>
        <p>
          <a href="https://t.me/TgInstaReelsBot" class="btn">💬 Открыть бота</a>
          <a href="https://github.com" class="btn">📁 Исходный код</a>
        </p>
      </body>
    </html>
  `);
});

module.exports = app;
