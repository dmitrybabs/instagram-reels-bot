require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = 706357294;
const app = express();

app.use(express.json());

console.log('🚀 Бот запущен');

const bot = new TelegramBot(token);
let users = [];

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'пользователь';
  
  console.log(`👤 /start от ${chatId} (${userName})`);
  
  if (!users.includes(chatId)) {
    users.push(chatId);
  }
  
  bot.sendMessage(chatId, 
    `👋 Привет, ${userName}!\nОтправь ссылку на Instagram Reels.`
  ).catch(err => {
    console.log(`❌ Ошибка отправки: ${err.message}`);
  });
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Статус
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Бот работает</h1>
    <p>Пользователей: ${users.length}</p>
  `);
});

module.exports = app;
