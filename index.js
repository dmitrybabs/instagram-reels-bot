require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const app = express();

// Критически важно: парсим raw body правильно
app.use(express.json({
  verify: function(req, res, buf) {
    req.rawBody = buf.toString();
  }
}));

console.log('🚀 Бот запускается...');

// Создаем бота
const bot = new TelegramBot(token, {
  // Добавляем опции для избежания 429 ошибок
  polling: false
});

// Webhook URL
const webhookUrl = `https://instagram-reels-bot-pink.vercel.app/bot${token}`;

// Устанавливаем webhook
bot.setWebHook(webhookUrl)
  .then(() => console.log('✅ Webhook установлен на:', webhookUrl))
  .catch(err => console.log('❌ Ошибка webhook:', err.message));

// Команда /start
bot.onText(/\/start/, (msg) => {
  console.log('🎯 Получен /start от:', msg.chat.id);
  
  bot.sendMessage(msg.chat.id, 
    `✅ Бот работает! Привет!\n\n` +
    `Отправь мне ссылку на Instagram Reels.\n` +
    `Пример: https://www.instagram.com/reel/C4lH6aDrQvL/`
  ).catch(err => console.log('❌ Ошибка отправки:', err.message));
});

// Обработка ссылок
bot.on('message', (msg) => {
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  
  console.log('📨 Сообщение:', text.substring(0, 50));
  
  if (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/')) {
    bot.sendMessage(msg.chat.id, 
      '⏳ Скачиваю видео...\n' +
      'Функция скачивания скоро будет добавлена!'
    ).catch(err => console.log('❌ Ошибка:', err.message));
  }
});

// Webhook endpoint - ВАЖНО: обрабатываем raw body
app.post(`/bot${token}`, (req, res) => {
  console.log('📨 POST запрос получен');
  
  // Логируем заголовки
  console.log('📋 Content-Type:', req.headers['content-type']);
  console.log('📦 Raw body длина:', req.rawBody?.length || 0);
  
  try {
    // Пробуем парсить тело
    let update;
    if (req.rawBody) {
      update = JSON.parse(req.rawBody);
    } else if (req.body && Object.keys(req.body).length > 0) {
      update = req.body;
    } else {
      console.log('⚠️ Нет данных для парсинга');
      return res.status(400).send('No data');
    }
    
    console.log('🔄 Обрабатываю update ID:', update.update_id);
    bot.processUpdate(update);
    console.log('✅ Update обработан');
    
    res.sendStatus(200);
  } catch (error) {
    console.log('❌ Ошибка парсинга/обработки:', error.message);
    console.log('📦 Тело запроса:', req.rawBody?.substring(0, 200) || 'Нет тела');
    res.status(500).send('Error: ' + error.message);
  }
});

// Статус
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Instagram Reels Bot</h1>
    <p><strong>Статус:</strong> ✅ Работает</p>
    <p><a href="https://t.me/TgInstaReelsBot">Открыть бота в Telegram</a></p>
  `);
});

module.exports = app;
