require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Конфигурация
const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const PROXY = process.env.PROXY;

// Парсинг прокси
const [proxyHost, proxyPort, proxyUser, proxyPass] = PROXY.split(':');

// Создаем бота
const bot = new TelegramBot(token, { polling: true });

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

// Создаем axios инстанс с прокси
const axiosInstance = axios.create({
  proxy: proxyConfig,
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

// Хранилище пользователей (временное)
let users = new Set();

// Функция для извлечения видео из Instagram
async function downloadInstagramReels(url) {
  try {
    console.log('Скачивание видео с URL:', url);
    
    // Получаем HTML страницы
    const response = await axiosInstance.get(url);
    const html = response.data;
    
    // Ищем видео URL в HTML
    const videoRegex = /"video_url":"([^"]+\.mp4[^"]*)"/g;
    const matches = [...html.matchAll(videoRegex)];
    
    if (matches.length > 0) {
      // Берем первую найденную ссылку
      const videoUrl = matches[0][1].replace(/\\u0026/g, '&');
      console.log('Найдено видео URL:', videoUrl);
      return videoUrl;
    }
    
    // Альтернативный поиск
    const alternativeRegex = /"contentUrl":"([^"]+\.mp4[^"]*)"/g;
    const altMatches = [...html.matchAll(alternativeRegex)];
    
    if (altMatches.length > 0) {
      const videoUrl = altMatches[0][1];
      console.log('Найдено видео URL (альтернативный):', videoUrl);
      return videoUrl;
    }
    
    // Еще один вариант поиска
    const jsonRegex = /window\.__additionalDataLoaded\('extra',(.+?)\);/g;
    const jsonMatches = [...html.matchAll(jsonRegex)];
    
    if (jsonMatches.length > 0) {
      try {
        const jsonData = JSON.parse(jsonMatches[0][1]);
        if (jsonData.shortcode_media && jsonData.shortcode_media.video_url) {
          return jsonData.shortcode_media.video_url;
        }
      } catch (e) {
        console.log('Ошибка парсинга JSON:', e.message);
      }
    }
    
    throw new Error('Видео не найдено на странице');
    
  } catch (error) {
    console.error('Ошибка при скачивании:', error.message);
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
    `Пример ссылки: https://www.instagram.com/reel/Cxample123/`
  );
});

// Обработка ссылок на Reels
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text) return;
  if (text.startsWith('/')) return;
  
  // Проверяем Instagram ссылку
  if (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/')) {
    try {
      await bot.sendMessage(chatId, '⏳ Скачиваю видео...');
      
      // Получаем прямую ссылку на видео
      const videoUrl = await downloadInstagramReels(text);
      
      if (videoUrl) {
        // Скачиваем видео
        const videoResponse = await axiosInstance.get(videoUrl, {
          responseType: 'arraybuffer'
        });
        
        // Отправляем видео пользователю
        await bot.sendVideo(chatId, Buffer.from(videoResponse.data), {
          caption: '✅ Видео успешно скачано!'
        });
      }
    } catch (error) {
      console.error('Ошибка:', error);
      
      // Пробуем альтернативный метод
      try {
        await bot.sendMessage(chatId, '🔄 Пробую альтернативный метод...');
        
        // Используем внешний сервис как запасной вариант
        const externalServiceUrl = `https://instagram-downloader-download-instagram-videos-stories.p.rapidapi.com/index?url=${encodeURIComponent(text)}`;
        
        const externalResponse = await axiosInstance.get(externalServiceUrl);
        if (externalResponse.data && externalResponse.data.media) {
          const externalVideoUrl = externalResponse.data.media;
          const videoResponse = await axiosInstance.get(externalVideoUrl, {
            responseType: 'arraybuffer'
          });
          
          await bot.sendVideo(chatId, Buffer.from(videoResponse.data), {
            caption: '✅ Видео скачано через альтернативный метод!'
          });
        } else {
          throw new Error('Видео не найдено');
        }
      } catch (altError) {
        console.error('Альтернативный метод тоже не сработал:', altError);
        
        await bot.sendMessage(chatId, 
          '❌ Не удалось скачать видео.\n\n' +
          'Попробуйте:\n' +
          '1. Другую ссылку\n' +
          '2. Убедитесь, что видео публичное\n' +
          '3. Подождите и попробуйте позже\n\n' +
          'Или используйте другие сервисы для скачивания Reels.'
        );
      }
    }
  } else if (text.includes('instagram.com/')) {
    await bot.sendMessage(chatId, 
      '📹 Я умею скачивать только Reels и посты с видео.\n' +
      'Пожалуйста, отправьте ссылку на Reels.\n\n' +
      'Пример: https://www.instagram.com/reel/Cxample123/'
    );
  }
});

// Команда для админа - рассылка
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (chatId !== ADMIN_ID) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав для этой команды.');
    return;
  }
  
  try {
    const text = match[1];
    await bot.sendMessage(chatId, `📢 Начинаю рассылку: "${text}"`);
    
    let success = 0;
    let failed = 0;
    
    for (const userId of users) {
      try {
        await bot.sendMessage(userId, text);
        success++;
      } catch (error) {
        console.error(`Ошибка отправки ${userId}:`, error);
        failed++;
      }
    }
    
    await bot.sendMessage(chatId, 
      `✅ Рассылка завершена!\n` +
      `Успешно: ${success}\n` +
      `Не удалось: ${failed}`
    );
  } catch (error) {
    console.error('Ошибка рассылки:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при рассылке.');
  }
});

// Команда для статистики
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (chatId !== ADMIN_ID) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав для этой команды.');
    return;
  }
  
  await bot.sendMessage(chatId, 
    `📊 Статистика:\n` +
    `Пользователей: ${users.size}\n\n` +
    `Команды:\n` +
    `/broadcast текст - рассылка\n` +
    `/stats - статистика`
  );
});

console.log('🤖 Бот запущен!');
