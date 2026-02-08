require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = 706357294;
const app = express();

app.use(express.json());

console.log('🚀 Бот запущен. Токен:', token ? '✅' : '❌');

// Создаем бота с опциями
const bot = new TelegramBot(token, {
  // Добавляем обработку ошибок
  request: {
    timeout: 10000
  }
});

let users = [];

// Команда /start с детальным логированием
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'пользователь';
  
  console.log(`🎯 /start от ${chatId} (${userName})`);
  
  if (!users.includes(chatId)) {
    users.push(chatId);
    console.log(`👤 Добавлен пользователь ${chatId}`);
  }
  
  try {
    console.log(`📤 Отправляю сообщение ${chatId}...`);
    const result = await bot.sendMessage(chatId, 
      `👋 Привет, ${userName}! Я бот для скачивания Instagram Reels.\n\n` +
      `Просто пришли мне ссылку на Reels.\n` +
      `Пример: https://www.instagram.com/reel/C4lH6aDrQvL/`
    );
    console.log(`✅ Сообщение отправлено ${chatId}, ID: ${result.message_id}`);
  } catch (error) {
    console.log(`❌ Ошибка отправки ${chatId}:`, error.message);
    console.log('Код ошибки:', error.code);
    console.log('Response:', error.response?.body);
  }
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  console.log('📨 Webhook запрос, update_id:', req.body?.update_id);
  
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.log('❌ Ошибка processUpdate:', error.message);
    res.status(500).send('Error');
  }
});

// Статус
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Instagram Reels Bot</h1>
    <p><strong>Статус:</strong> ✅ Работает</p>
    <p><strong>Пользователей:</strong> ${users.length}</p>
    <p><a href="https://t.me/TgInstaReelsBot">@TgInstaReelsBot</a></p>
  `);
});

module.exports = app;
