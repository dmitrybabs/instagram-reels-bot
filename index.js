require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const app = express();

app.use(express.json());

// Логируем все входящие запросы
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  if (req.body) {
    console.log('📦 Body:', JSON.stringify(req.body).substring(0, 200));
  }
  next();
});

// Webhook URL
const webhookUrl = `https://instagram-reels-bot-pink.vercel.app/bot${token}`;
console.log('🚀 Webhook URL:', webhookUrl);

// Создаем бота
const bot = new TelegramBot(token);

// Устанавливаем webhook
bot.setWebHook(webhookUrl)
  .then(() => console.log('✅ Webhook установлен'))
  .catch(err => console.log('❌ Ошибка webhook:', err.message));

// Команда /start
bot.onText(/\/start/, (msg) => {
  console.log('🎯 Получен /start от:', msg.chat.id);
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, '✅ Бот работает! Привет!')
    .then(() => console.log('✅ Ответ отправлен'))
    .catch(err => console.log('❌ Ошибка отправки:', err.message));
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  console.log('🔄 Обрабатываю update...');
  
  try {
    bot.processUpdate(req.body);
    console.log('✅ Update обработан');
  } catch (error) {
    console.log('❌ Ошибка processUpdate:', error.message);
  }
  
  res.sendStatus(200);
});

// Статус страница
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Бот работает</h1>
    <p>Webhook: ${webhookUrl}</p>
    <p>Отправьте /start боту в Telegram</p>
  `);
});

module.exports = app;
