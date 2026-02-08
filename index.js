require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = 706357294;
const PROXY = process.env.PROXY || '176.124.45.94:9391:HVWd6E:5Wdb7D';
const app = express();

app.use(express.json());

console.log('🚀 Бот запущен. Админ ID:', ADMIN_ID);

// Парсинг прокси
const [proxyHost, proxyPort, proxyUser, proxyPass] = PROXY.split(':');

// Создаем бота
const bot = new TelegramBot(token);

// Прокси для axios
const axiosInstance = axios.create({
  proxy: {
    host: proxyHost,
    port: parseInt(proxyPort),
    auth: {
      username: proxyUser,
      password: proxyPass
    },
    protocol: 'http'
  },
  timeout: 15000
});

// Хранилище пользователей
let users = [];

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'пользователь';
  
  // Добавляем пользователя
  if (!users.includes(chatId)) {
    users.push(chatId);
    console.log(`👤 Добавлен пользователь: ${chatId} (${userName})`);
  }
  
  bot.sendMessage(chatId, 
    `👋 Привет, ${userName}! Я бот для скачивания Instagram Reels.\n\n` +
    `Просто пришли мне ссылку на Reels, и я скачаю видео для тебя!\n\n` +
    `Пример: https://www.instagram.com/reel/C4lH6aDrQvL/`
  ).catch(err => console.log('Ошибка отправки:', err.message));
});

// Обработка ссылок на Instagram
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  
  console.log(`Получена ссылка от ${chatId}: ${text}`);
  
  // Проверяем Instagram ссылку
  if (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/')) {
    try {
      await bot.sendMessage(chatId, '⏳ Скачиваю видео...');
      
      // Простой метод через сервис
      const serviceUrl = 'https://instasave.ig';
      
      const response = await axiosInstance.post(
        `${serviceUrl}/api/ig`,
        { url: text },
        {
          headers: {
            'Content-Type': 'application/json',
            'Origin': serviceUrl,
            'Referer': `${serviceUrl}/`
          }
        }
      );
      
      if (response.data && response.data.data) {
        const videoData = response.data.data;
        
        // Ищем видео URL
        let videoUrl = null;
        if (videoData.video_url) {
          videoUrl = videoData.video_url;
        } else if (videoData.links && videoData.links[0] && videoData.links[0].url) {
          videoUrl = videoData.links[0].url;
        }
        
        if (videoUrl) {
          console.log(`Найдено видео: ${videoUrl}`);
          
          // Скачиваем видео
          const videoResponse = await axiosInstance.get(videoUrl, {
            responseType: 'arraybuffer'
          });
          
          // Отправляем видео
          await bot.sendVideo(chatId, Buffer.from(videoResponse.data), {
            caption: '✅ Видео успешно скачано!'
          });
          
          return;
        }
      }
      
      throw new Error('Видео не найдено в ответе');
      
    } catch (error) {
      console.log('Ошибка скачивания:', error.message);
      
      // Запасной вариант - отправляем инструкцию
      await bot.sendMessage(chatId, 
        `❌ Не удалось скачать видео автоматически.\n\n` +
        `Вы можете скачать вручную через:\n` +
        `• https://snaptik.app/\n` +
        `• https://savetik.co/\n` +
        `• https://instasave.ig/\n\n` +
        `Просто вставьте туда ссылку и скачайте видео.`
      );
    }
  } else if (text.includes('instagram.com/')) {
    await bot.sendMessage(chatId, 
      '📹 Отправьте ссылку на Reels или пост с видео.\n' +
      'Формат: https://www.instagram.com/reel/...'
    );
  }
});

// Админ команды
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (parseInt(msg.chat.id) !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ Нет прав');
  }
  
  const text = match[1];
  let sent = 0;
  let failed = 0;
  
  // Рассылаем всем пользователям, включая админа если он в списке
  for (const userId of users) {
    try {
      await bot.sendMessage(userId, `📢 ${text}`);
      sent++;
    } catch (error) {
      console.log(`Ошибка рассылки ${userId}:`, error.message);
      failed++;
    }
  }
  
  await bot.sendMessage(ADMIN_ID, 
    `✅ Рассылка завершена:\n` +
    `✓ Отправлено: ${sent}\n` +
    `✗ Ошибок: ${failed}\n` +
    `👥 Всего пользователей: ${users.length}`
  );
});

bot.onText(/\/stats/, (msg) => {
  if (parseInt(msg.chat.id) !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ Нет прав');
  }
  
  bot.sendMessage(ADMIN_ID, 
    `📊 Статистика бота:\n` +
    `👥 Пользователей: ${users.length}\n` +
    `🆔 Ваш ID: ${msg.chat.id}\n` +
    `👑 Админ ID: ${ADMIN_ID}`
  );
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Статус
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Instagram Reels Bot</h1>
    <p><strong>Статус:</strong> ✅ Работает</p>
    <p><strong>Пользователей:</strong> ${users.length}</p>
    <p><strong>Админ:</strong> ${ADMIN_ID}</p>
    <p><a href="https://t.me/TgInstaReelsBot">@TgInstaReelsBot</a></p>
  `);
});

module.exports = app;
