require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// Конфигурация
const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const PROXY = process.env.PROXY;

// Для Vercel
const app = express();
app.use(express.json());

// Парсинг прокси
const [proxyHost, proxyPort, proxyUser, proxyPass] = PROXY.split(':');

// Webhook URL для Vercel
const VERCEL_URL = process.env.VERCEL_URL || 'https://instagram-reels-58dvegvsg-marvins-projects-5e6b2b18.vercel.app';
const webhookUrl = `${VERCEL_URL}/bot${token}`;

// Создаем бота с webhook
const bot = new TelegramBot(token);
bot.setWebHook(webhookUrl);

// Прокси для axios
const proxyConfig = {
  host: proxyHost,
  port: parseInt(proxyPort),
  auth: {
    username: proxyUser,
    password: proxyPass
  },
  protocol: 'http'
};

const axiosInstance = axios.create({
  proxy: proxyConfig,
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

// Хранилище
let users = new Set();

// Простая функция для скачивания (используем рабочий API)
async function downloadInstagramReels(url) {
  try {
    console.log('Скачиваем:', url);
    
    // Используем рабочий сервис snaptik
    const snaptikUrl = `https://www.snaptik.app/`;
    
    // Сначала получаем HTML страницы snaptik
    const response = await axiosInstance.post(snaptikUrl, `url=${encodeURIComponent(url)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.snaptik.app',
        'Referer': 'https://www.snaptik.app/'
      }
    });
    
    const html = response.data;
    
    // Ищем download ссылку
    const downloadRegex = /<a[^>]*href="([^"]*download[^"]*)"[^>]*>/i;
    const match = html.match(downloadRegex);
    
    if (match && match[1]) {
      return match[1].startsWith('http') ? match[1] : `https://www.snaptik.app${match[1]}`;
    }
    
    // Альтернативный поиск
    const videoRegex = /<video[^>]*src="([^"]+\.mp4[^"]*)"[^>]*>/i;
    const videoMatch = html.match(videoRegex);
    
    if (videoMatch && videoMatch[1]) {
      return videoMatch[1];
    }
    
    throw new Error('Видео не найдено');
    
  } catch (error) {
    console.error('Ошибка snaptik:', error.message);
    
    // Запасной вариант: savetik.co
    try {
      const saveTikUrl = `https://savetik.co/api/ajaxSearch`;
      const saveResponse = await axiosInstance.post(saveTikUrl, {
        q: url,
        lang: 'en'
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://savetik.co',
          'Referer': 'https://savetik.co/'
        }
      });
      
      if (saveResponse.data && saveResponse.data.data) {
        const videoData = saveResponse.data.data;
        if (videoData.links && videoData.links[0] && videoData.links[0].url) {
          return videoData.links[0].url;
        }
      }
    } catch (altError) {
      console.error('Ошибка savetik:', altError.message);
    }
    
    throw error;
  }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  users.add(chatId);
  
  await bot.sendMessage(chatId, 
    `👋 Привет! Я бот для скачивания Reels из Instagram.\n\n` +
    `Просто пришли мне ссылку на Reels, и я скачаю видео для тебя!\n\n` +
    `Пример: https://www.instagram.com/reel/C4lH6aDrQvL/`
  );
});

// Обработка ссылок
bot.onText(/instagram\.com\/reel\/|instagram\.com\/p\//, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[0];
  
  try {
    await bot.sendMessage(chatId, '⏳ Скачиваю видео...');
    
    const videoUrl = await downloadInstagramReels(url);
    
    // Скачиваем видео
    const videoResponse = await axiosInstance.get(videoUrl, {
      responseType: 'arraybuffer'
    });
    
    // Отправляем видео
    await bot.sendVideo(chatId, Buffer.from(videoResponse.data), {
      caption: '✅ Видео успешно скачано!'
    });
    
  } catch (error) {
    console.error('Ошибка:', error);
    await bot.sendMessage(chatId, 
      '❌ Не удалось скачать видео.\n\n' +
      'Попробуйте другую ссылку или сервисы:\n' +
      '• snaptik.app\n' +
      '• savetik.co\n' +
      '• instagramvideodownloader.com'
    );
  }
});

// Команда /broadcast
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (chatId !== ADMIN_ID) {
    await bot.sendMessage(chatId, '⛔ Нет прав');
    return;
  }
  
  const text = match[1];
  let success = 0;
  
  for (const userId of users) {
    try {
      await bot.sendMessage(userId, text);
      success++;
    } catch (error) {
      console.error('Ошибка рассылки:', error);
    }
  }
  
  await bot.sendMessage(chatId, `✅ Отправлено: ${success}`);
});

// Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Корневой маршрут
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Instagram Reels Bot</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          .status { background: #f0f0f0; padding: 20px; border-radius: 10px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h1>🤖 Instagram Reels Bot</h1>
        <div class="status">
          <p><strong>Статус:</strong> ✅ Работает</p>
          <p><strong>Пользователей:</strong> ${users.size}</p>
          <p><strong>Webhook:</strong> ${webhookUrl}</p>
        </div>
        <p>Используйте бота в Telegram: @TgInstaReelsBot</p>
      </body>
    </html>
  `);
});

// Экспортируем для Vercel
module.exports = app;
