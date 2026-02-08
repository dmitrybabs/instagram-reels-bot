require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const app = express();

// Важно: парсим raw body
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

console.log('🚀 Бот запускается...');

// Создаем бота
const bot = new TelegramBot(token);

// Webhook URL
const webhookUrl = `https://instagram-reels-bot-pink.vercel.app/bot${token}`;
console.log('🌐 Webhook URL:', webhookUrl);

// Устанавливаем webhook
bot.setWebHook(webhookUrl)
  .then(() => console.log('✅ Webhook установлен'))
  .catch(err => console.log('❌ Ошибка webhook:', err.message));

// Команда /start
bot.onText(/\/start/, (msg) => {
  console.log('🎯 Получен /start от:', msg.chat.id, 'имя:', msg.from?.first_name);
  
  bot.sendMessage(msg.chat.id, 
    `✅ Привет, ${msg.from.first_name || 'друг'}! Бот работает!\n\n` +
    `Отправь мне ссылку на Instagram Reels.`
  ).catch(err => console.log('❌ Ошибка отправки:', err.message));
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  console.log('📨 Получен POST запрос');
  console.log('📦 Raw body:', req.rawBody ? req.rawBody.substring(0, 200) : 'Нет тела');
  console.log('📦 Parsed body:', req.body);
  
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log('⚠️ Пустое тело, отправляем 400');
      return res.status(400).send('Empty body');
    }
    
    bot.processUpdate(req.body);
    console.log('✅ Update обработан успешно');
    res.sendStatus(200);
  } catch (error) {
    console.log('❌ Ошибка processUpdate:', error.message);
    res.status(500).send('Error');
  }
});

// Тестовый endpoint для проверки
app.get('/test-webhook', (req, res) => {
  const testUpdate = {
    update_id: 123456789,
    message: {
      message_id: 1,
      from: {
        id: 706357294,
        first_name: "Test",
        is_bot: false
      },
      chat: {
        id: 706357294,
        first_name: "Test",
        type: "private"
      },
      date: Date.now(),
      text: "/start"
    }
  };
  
  bot.processUpdate(testUpdate);
  res.send('Тестовый update отправлен');
});

// Статус страница
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Instagram Reels Bot</h1>
    <p><strong>Статус:</strong> ✅ Работает</p>
    <p><strong>Webhook:</strong> ${webhookUrl}</p>
    <p><a href="/test-webhook">Тест webhook</a></p>
  `);
});

module.exports = app;
