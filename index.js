require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = 706357294;
const PROXY = process.env.PROXY || '176.124.45.94:9391:HVWd6E:5Wdb7D';
const app = express();

app.use(express.json());

console.log('🚀 Instagram Reels Bot запущен');

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
  timeout: 30000
});

let users = [];

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'пользователь';
  
  if (!users.includes(chatId)) {
    users.push(chatId);
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
  
  console.log(`Получена ссылка от ${chatId}: ${text.substring(0, 50)}...`);
  
  // Проверяем Instagram ссылку
  if (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/')) {
    try {
      await bot.sendMessage(chatId, '⏳ Скачиваю видео...');
      
      // Используем простой сервис для скачивания
      // Метод 1: Через snapinsta.app
      const response = await axiosInstance.get(`https://snapinsta.app/api/ajaxSearch`, {
        params: {
          q: text,
          t: 'media',
          lang: 'en'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://snapinsta.app/'
        }
      });
      
      if (response.data && response.data.data) {
        const videoUrl = response.data.data;
        
        // Скачиваем видео
        const videoResponse = await axiosInstance.get(videoUrl, {
          responseType: 'arraybuffer'
        });
        
        // Отправляем видео
        await bot.sendVideo(chatId, Buffer.from(videoResponse.data), {
          caption: '✅ Видео успешно скачано!'
        });
        
      } else {
        throw new Error('Видео не найдено');
      }
      
    } catch (error) {
      console.log('Ошибка скачивания:', error.message);
      
      // Альтернативный метод
      try {
        await bot.sendMessage(chatId, '🔄 Пробую альтернативный метод...');
        
        // Метод 2: Через savetik.co
        const altResponse = await axiosInstance.post(
          'https://savetik.co/api/ajaxSearch',
          `q=${encodeURIComponent(text)}&lang=en`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': 'https://savetik.co/'
            }
          }
        );
        
        if (altResponse.data && altResponse.data.links && altResponse.data.links[0]) {
          const videoUrl = altResponse.data.links[0].url;
          const videoResponse = await axiosInstance.get(videoUrl, {
            responseType: 'arraybuffer'
          });
          
          await bot.sendVideo(chatId, Buffer.from(videoResponse.data), {
            caption: '✅ Видео скачано через альтернативный метод!'
          });
        } else {
          throw new Error('Видео не найдено');
        }
        
      } catch (altError) {
        console.log('Альтернативный метод не сработал:', altError.message);
        
        await bot.sendMessage(chatId, 
          '❌ Не удалось скачать видео.\n\n' +
          'Попробуйте:\n' +
          '1. Другую ссылку\n' +
          '2. Убедитесь, что видео публичное\n' +
          '3. Попробуйте позже\n\n' +
          'Или используйте: snaptik.app или savetik.co'
        );
      }
    }
  }
});

// Админ команды
bot.onText(/\/broadcast (.+)/, (msg, match) => {
  if (msg.chat.id === ADMIN_ID) {
    const text = match[1];
    let sent = 0;
    
    users.forEach(userId => {
      bot.sendMessage(userId, `📢 ${text}`)
        .then(() => sent++)
        .catch(err => console.log('Ошибка рассылки:', err.message));
    });
    
    bot.sendMessage(ADMIN_ID, `✅ Рассылка отправлена ${sent} пользователям`);
  }
});

bot.onText(/\/stats/, (msg) => {
  if (msg.chat.id === ADMIN_ID) {
    bot.sendMessage(ADMIN_ID, `📊 Пользователей: ${users.length}`);
  }
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
