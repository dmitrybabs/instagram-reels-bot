require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN;
const app = express();

// Webhook URL
const webhookUrl = `https://instagram-reels-bot-pink.vercel.app/bot${token}`;

// Создаем бота с webhook
const bot = new TelegramBot(token);
bot.setWebHook(webhookUrl);

// Простое хранилище
let users = [];

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!users.includes(chatId)) users.push(chatId);
  
  bot.sendMessage(chatId, 
    '👋 Привет! Отправь мне ссылку на Instagram Reels.'
  ).catch(e => console.log('Ошибка отправки:', e.message));
});

// Обработка ссылок
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  
  if (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/')) {
    bot.sendMessage(chatId, 
      '⏳ Пробую скачать видео...\n\n' +
      'Сейчас использую временную версию. Скоро добавлю скачивание!'
    ).catch(e => console.log('Ошибка:', e.message));
  }
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Статус страница
app.get('/', (req, res) => {
  res.send(`
    <h1>✅ Бот работает</h1>
    <p>Пользователей: ${users.length}</p>
    <p>Webhook установлен</p>
  `);
});

module.exports = app;
