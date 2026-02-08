require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { fromUrl } = require('instagram-url-direct');
const FormData = require('form-data');
const { Redis } = require('@upstash/redis');

// Конфигурация
const token = process.env.TELEGRAM_BOT_TOKEN || '8411517537:AAHUPmFUYwoMeeojTaGgqwFuC1eu4A6RqRs';
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 706357294;
const PROXY = process.env.PROXY || '176.124.45.94:9391:HVWd6E:5Wdb7D';

// Инициализация Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || 'https://present-lobster-35222.upstash.io',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || 'AYmWAAIncDEyMGFlYWVjMzEzYzg0ZTk5YjFjNGUzMDFiYzBkOTc3ZXAxMzUyMjI',
});

// Ключи для Redis
const USERS_SET_KEY = 'bot:users';
const STATS_KEY = 'bot:stats';
const DOWNLOAD_COUNTER_KEY = 'bot:downloads';

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
  timeout: 30000
});

// Функции для работы с Redis
async function addUser(userId) {
  await redis.sadd(USERS_SET_KEY, userId.toString());
  await redis.hincrby(STATS_KEY, 'total_users', 1);
}

async function getUserCount() {
  return await redis.scard(USERS_SET_KEY);
}

async function getAllUsers() {
  return await redis.smembers(USERS_SET_KEY);
}

async function incrementDownloadCount() {
  return await redis.incr(DOWNLOAD_COUNTER_KEY);
}

async function getStats() {
  const totalDownloads = await redis.get(DOWNLOAD_COUNTER_KEY) || 0;
  const totalUsers = await getUserCount();
  const stats = await redis.hgetall(STATS_KEY);
  
  return {
    totalDownloads: parseInt(totalDownloads),
    totalUsers: parseInt(totalUsers),
    ...stats
  };
}

async function addUserDownload(userId) {
  const key = `user:${userId}:downloads`;
  await redis.incr(key);
  await redis.hincrby(STATS_KEY, 'total_downloads', 1);
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  await addUser(userId.toString());
  
  await bot.sendMessage(chatId, 
    `👋 Привет, ${msg.from.first_name || 'пользователь'}! Я бот для скачивания Reels из Instagram.\n\n` +
    `📹 Просто пришли мне ссылку на Reels, и я скачаю видео для тебя!\n\n` +
    `🔗 Пример ссылки: https://www.instagram.com/reel/Cxample123/\n\n` +
    `📊 Бот уже скачал ${await redis.get(DOWNLOAD_COUNTER_KEY) || 0} видео`
  );
});

// Обработка ссылок на Reels
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (!text) return;
  
  // Если это команда - пропускаем
  if (text.startsWith('/')) return;
  
  // Проверяем, является ли сообщение ссылкой на Instagram
  if (text.includes('instagram.com/reel/') || text.includes('instagram.com/p/')) {
    try {
      await bot.sendMessage(chatId, '⏳ Скачиваю видео...');
      
      // Используем библиотеку для получения прямой ссылки
      const links = await fromUrl(text);
      
      if (links && links.url_list && links.url_list.length > 0) {
        // Получаем самую качественную ссылку
        const videoUrl = links.url_list[links.url_list.length - 1];
        
        // Скачиваем видео через прокси
        const response = await axiosInstance.get(videoUrl, {
          responseType: 'arraybuffer'
        });
        
        // Обновляем статистику
        await incrementDownloadCount();
        await addUserDownload(userId.toString());
        
        // Отправляем видео пользователю
        await bot.sendVideo(chatId, Buffer.from(response.data), {
          caption: '✅ Видео успешно скачано!\n' +
                   `📊 Всего скачано: ${await redis.get(DOWNLOAD_COUNTER_KEY)} видео`
        });
      } else {
        throw new Error('Не удалось получить видео');
      }
    } catch (error) {
      console.error('Error:', error);
      await bot.sendMessage(chatId, 
        '❌ Произошла ошибка при скачивании видео.\n' +
        'Возможные причины:\n' +
        '1. Неверная ссылка\n' +
        '2. Видео недоступно\n' +
        '3. Проблемы с подключением\n\n' +
        'Попробуйте другую ссылку.'
      );
    }
  } else if (text.includes('instagram.com/')) {
    await bot.sendMessage(chatId, 
      '📹 Я умею скачивать только Reels и посты с видео.\n' +
      'Пожалуйста, отправьте ссылку на Reels.\n\n' +
      'Пример: https://www.instagram.com/reel/Cxample123/\n\n' +
      'Поддерживаемые форматы:\n' +
      '• instagram.com/reel/*\n' +
      '• instagram.com/p/* (только видео)'
    );
  }
});

// Команда для админа - рассылка
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  // Проверяем, является ли пользователь админом
  if (parseInt(chatId) !== ADMIN_ID) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав для этой команды.');
    return;
  }
  
  try {
    const text = match[1];
    const users = await getAllUsers();
    
    await bot.sendMessage(chatId, 
      `📢 Начинаю рассылку сообщения: "${text}"\n` +
      `👥 Получателей: ${users.length}`
    );
    
    // Отправляем всем пользователям
    let success = 0;
    let failed = 0;
    const failedUsers = [];
    
    for (const userId of users) {
      try {
        await bot.sendMessage(userId, text);
        success++;
        
        // Задержка чтобы не превысить лимиты Telegram
        if (success % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to send to ${userId}:`, error);
        failed++;
        failedUsers.push(userId);
        
        // Удаляем неактивного пользователя из списка
        if (error.response && error.response.statusCode === 403) {
          await redis.srem(USERS_SET_KEY, userId);
        }
      }
    }
    
    await bot.sendMessage(chatId, 
      `✅ Рассылка завершена!\n\n` +
      `📈 Статистика:\n` +
      `✓ Успешно: ${success}\n` +
      `✗ Не удалось: ${failed}\n\n` +
      `👥 Всего пользователей: ${await getUserCount()}`
    );
    
    // Сохраняем статистику рассылки
    await redis.hset('broadcast:last', {
      date: new Date().toISOString(),
      text: text,
      success: success,
      failed: failed,
      total_users: users.length
    });
    
  } catch (error) {
    console.error('Broadcast error:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при рассылке: ' + error.message);
  }
});

// Команда для админа - рассылка с фото
bot.onText(/\/broadcastphoto/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (parseInt(chatId) !== ADMIN_ID) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав для этой команды.');
    return;
  }
  
  // Запрашиваем текст рассылки
  await bot.sendMessage(chatId, 
    '📷 Отправьте мне фото с подписью для рассылки.\n' +
    'Подпись будет текстом рассылки.\n\n' +
    `Текущее количество подписчиков: ${await getUserCount()}`
  );
});

// Обработка фото от админа для рассылки
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  
  if (parseInt(chatId) !== ADMIN_ID) return;
  
  try {
    const caption = msg.caption || '📢 Новое сообщение от администратора!';
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    const users = await getAllUsers();
    
    await bot.sendMessage(chatId, 
      `📸 Начинаю рассылку фото...\n` +
      `👥 Получателей: ${users.length}`
    );
    
    let success = 0;
    let failed = 0;
    
    for (const userId of users) {
      try {
        await bot.sendPhoto(userId, photoId, { caption });
        success++;
        
        // Задержка чтобы не превысить лимиты Telegram
        if (success % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to send photo to ${userId}:`, error);
        failed++;
        
        // Удаляем неактивного пользователя из списка
        if (error.response && error.response.statusCode === 403) {
          await redis.srem(USERS_SET_KEY, userId);
        }
      }
    }
    
    await bot.sendMessage(chatId, 
      `✅ Рассылка фото завершена!\n\n` +
      `📈 Статистика:\n` +
      `✓ Успешно: ${success}\n` +
      `✗ Не удалось: ${failed}\n\n` +
      `👥 Всего пользователей: ${await getUserCount()}`
    );
    
    // Сохраняем статистику рассылки
    await redis.hset('broadcast:last_photo', {
      date: new Date().toISOString(),
      success: success,
      failed: failed,
      total_users: users.length
    });
    
  } catch (error) {
    console.error('Photo broadcast error:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при рассылке фото: ' + error.message);
  }
});

// Команда для статистики (только для админа)
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (parseInt(chatId) !== ADMIN_ID) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав для этой команды.');
    return;
  }
  
  try {
    const stats = await getStats();
    
    // Получаем топ пользователей по скачиваниям
    const users = await getAllUsers();
    const userStats = [];
    
    for (const userId of users.slice(0, 10)) { // Берем только первых 10 для скорости
      const downloads = await redis.get(`user:${userId}:downloads`) || 0;
      if (downloads > 0) {
        userStats.push({ userId, downloads: parseInt(downloads) });
      }
    }
    
    userStats.sort((a, b) => b.downloads - a.downloads);
    
    let userStatsText = '';
    if (userStats.length > 0) {
      userStatsText = '\n\n🏆 Топ пользователей:\n';
      userStats.slice(0, 5).forEach((stat, index) => {
        userStatsText += `${index + 1}. ID ${stat.userId}: ${stat.downloads} скачиваний\n`;
      });
    }
    
    await bot.sendMessage(chatId, 
      `📊 Статистика бота:\n\n` +
      `👥 Всего пользователей: ${stats.totalUsers}\n` +
      `📥 Всего скачиваний: ${stats.totalDownloads}\n` +
      `📅 Дата запуска: ${await redis.hget(STATS_KEY, 'start_date') || 'Не установлено'}\n` +
      `🔄 Последнее обновление: ${new Date().toLocaleString('ru-RU')}` +
      userStatsText + 
      `\n\n⚙️ Команды для админа:\n` +
      `/broadcast текст - рассылка текста\n` +
      `/broadcastphoto - рассылка фото\n` +
      `/stats - статистика\n` +
      `/resetstats - сброс статистики`
    );
  } catch (error) {
    console.error('Stats error:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при получении статистики.');
  }
});

// Команда для сброса статистики (только для админа)
bot.onText(/\/resetstats/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (parseInt(chatId) !== ADMIN_ID) {
    await bot.sendMessage(chatId, '⛔ У вас нет прав для этой команды.');
    return;
  }
  
  try {
    // Сохраняем текущую дату как дату сброса
    await redis.hset(STATS_KEY, {
      'start_date': new Date().toISOString(),
      'total_users': 0,
      'total_downloads': 0
    });
    
    // Обнуляем счетчик скачиваний
    await redis.set(DOWNLOAD_COUNTER_KEY, 0);
    
    // Очищаем статистику пользователей
    const users = await getAllUsers();
    for (const userId of users) {
      await redis.del(`user:${userId}:downloads`);
    }
    
    await bot.sendMessage(chatId, '✅ Статистика сброшена!');
  } catch (error) {
    console.error('Reset stats error:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при сбросе статистики.');
  }
});

// Инициализация при запуске
async function initialize() {
  try {
    // Проверяем подключение к Redis
    await redis.ping();
    console.log('✅ Redis подключен');
    
    // Устанавливаем дату запуска, если ее нет
    const startDate = await redis.hget(STATS_KEY, 'start_date');
    if (!startDate) {
      await redis.hset(STATS_KEY, 'start_date', new Date().toISOString());
    }
    
    console.log(`🤖 Бот запущен! Админ ID: ${ADMIN_ID}`);
    console.log(`👥 Пользователей в базе: ${await getUserCount()}`);
    console.log(`📥 Всего скачиваний: ${await redis.get(DOWNLOAD_COUNTER_KEY) || 0}`);
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
  }
}

// Обработка ошибок
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Запуск инициализации
initialize();