require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = 706357294;
const app = express();

app.use(express.json());

console.log('🚀 Бот запущен. Токен присутствует:', !!token);

const bot = new TelegramBot(token);
let users = [];

// Команда /start с полной обработкой ошибок
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'пользователь';
  
  console.log(`🎯 Получен /start от ${chatId} (${userName})`);
  
  if (!users.includes(chatId)) {
    users.push(chatId);
    console.log(`✅ Добавлен пользователь ${chatId}`);
  }
  
  try {
    console.log(`📤 Пытаюсь отправить сообщение ${chatId}...`);
    
    // Пробуем отправить простое сообщение
    const result = await bot.sendMessage(chatId, `✅ Тестовое сообщение!`);
    
    console.log(`✅ Сообщение отправлено! ID: ${result.message_id}`);
    
    // Если первое сообщение отправлено, отправляем второе
    await bot.sendMessage(chatId, 
      `👋 Привет, ${userName}!\n` +
      `Я бот для скачивания Instagram Reels.\n\n` +
      `Отправь мне ссылку на Reels.`
    );
    
    console.log(`✅ Второе сообщение отправлено`);
    
  } catch (error) {
    console.log(`❌ КРИТИЧЕСКАЯ ОШИБКА отправки ${chatId}:`);
    console.log(`   Сообщение: ${error.message}`);
    console.log(`   Код: ${error.code}`);
    console.log(`   Response body:`, error.response?.body);
    
    // Пробуем отправить через другой метод
    try {
      console.log(`🔄 Пробую альтернативный метод отправки...`);
      
      // Используем прямое обращение к Telegram API
      const axios = require('axios');
      const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chatId,
          text: `⚠️ Альтернативное сообщение для ${userName}`
        }
      );
      
      console.log(`✅ Альтернативный метод сработал:`, response.data.ok);
    } catch (altError) {
      console.log(`❌ Альтернативный метод тоже не сработал:`, altError.message);
    }
  }
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  console.log('📨 Webhook запрос получен');
  
  try {
    bot.processUpdate(req.body);
    console.log('✅ Update обработан');
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
    <p><strong>Лог:</strong> Смотрите логи в Vercel</p>
  `);
});

module.exports = app;
