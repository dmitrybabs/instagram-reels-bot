require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = 706357294;
const app = express();

app.use(express.json());

console.log('🚀 Бот запущен');

// Создаем бота БЕЗ автоматической установки webhook
const bot = new TelegramBot(token);

// Хранилище пользователей
let users = [];

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'пользователь';
  
  if (!users.includes(chatId)) {
    users.push(chatId);
  }
  
  console.log(`👤 Новый пользователь: ${chatId} (${userName})`);
  
  bot.sendMessage(chatId, 
    `👋 Привет, ${userName}! Я бот для скачивания Instagram Reels.\n\n` +
    `Просто пришли мне ссылку на Reels.\n` +
    `Пример: https://www.instagram.com/reel/C4lH6aDrQvL/`
  ).catch(err => {
    console.log('❌ Ошибка отправки:', err.message);
  });
});

// Обработка ссылок
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  
  console.log(`📨 Сообщение от ${chatId}: ${text.substring(0, 50)}...`);
  
  if (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/')) {
    bot.sendMessage(chatId, 
      '⏳ Скачиваю видео...\n' +
      'Сейчас функция в разработке. Скоро будет доступно!'
    ).catch(err => console.log('❌ Ошибка:', err.message));
  }
});

// Админ команды
bot.onText(/\/stats/, (msg) => {
  if (msg.chat.id === ADMIN_ID) {
    bot.sendMessage(ADMIN_ID, `📊 Пользователей: ${users.length}`);
  }
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.log('❌ Ошибка:', error.message);
    res.status(500).send('Error');
  }
});

// Статус
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Instagram Reels Bot</h1>
    <p><strong>Статус:</strong> ✅ Работает</p>
    <p><strong>Пользователей:</strong> ${users.length}</p>
    <p><a href="https://t.me/TgInstaReelsBot">Открыть бота</a></p>
  `);
});

module.exports = app;
