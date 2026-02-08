// Telegram Bot Webhook Handler for Vercel Serverless Functions

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = 706357294;
const PROXY_URL = process.env.PROXY_URL || 'http://HVWd6E:5Wdb7D@176.124.45.94:9391';

// Upstash Redis REST API (for user storage & broadcast)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============ Redis Helpers ============
async function redisCommand(command) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    return await res.json();
  } catch (e) {
    console.error('Redis error:', e);
    return null;
  }
}

const REDIS_PREFIX = 'reels:';

async function saveUser(userId, username, firstName) {
  await redisCommand(['SADD', `${REDIS_PREFIX}users`, String(userId)]);
  if (username || firstName) {
    await redisCommand(['HSET', `${REDIS_PREFIX}user:${userId}`, 'username', username || '', 'firstName', firstName || '', 'lastSeen', new Date().toISOString()]);
  }
}

async function getAllUsers() {
  const result = await redisCommand(['SMEMBERS', `${REDIS_PREFIX}users`]);
  return result?.result || [];
}

async function getUserCount() {
  const result = await redisCommand(['SCARD', `${REDIS_PREFIX}users`]);
  return result?.result || 0;
}

async function setBroadcastState(state) {
  return redisCommand(['SET', `${REDIS_PREFIX}broadcast_${ADMIN_ID}`, state, 'EX', '300']);
}

async function getBroadcastState() {
  const result = await redisCommand(['GET', `${REDIS_PREFIX}broadcast_${ADMIN_ID}`]);
  return result?.result;
}

async function deleteBroadcastState() {
  return redisCommand(['DEL', `${REDIS_PREFIX}broadcast_${ADMIN_ID}`]);
}

async function incrementStat(key) {
  return redisCommand(['INCR', `${REDIS_PREFIX}stat:${key}`]);
}

async function getStat(key) {
  const result = await redisCommand(['GET', `${REDIS_PREFIX}stat:${key}`]);
  return result?.result || '0';
}

// ============ Telegram API Helpers ============
async function tgApi(method, body) {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`Telegram API error (${method}):`, e);
    return null;
  }
}

async function sendMessage(chatId, text, options = {}) {
  return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...options });
}

async function sendVideo(chatId, videoUrl, caption = '') {
  return tgApi('sendVideo', { chat_id: chatId, video: videoUrl, caption, parse_mode: 'HTML', supports_streaming: true });
}

async function sendChatAction(chatId, action = 'upload_video') {
  return tgApi('sendChatAction', { chat_id: chatId, action });
}

async function copyMessage(chatId, fromChatId, messageId) {
  return tgApi('copyMessage', { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId });
}

// ============ Instagram Download ============
function extractInstagramUrl(text) {
  const regex = /https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(reel|p|reels)\/[\w\-]+\/?(\?[^\s]*)?/i;
  const match = text.match(regex);
  return match ? match[0] : null;
}

async function getVideoViaCobalt(url) {
  try {
    const response = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        videoQuality: '720',
        filenameStyle: 'basic',
      }),
    });

    if (!response.ok) {
      console.error('Cobalt API HTTP error:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.status === 'redirect' || data.status === 'tunnel') {
      return data.url;
    }

    if (data.status === 'picker' && data.picker && data.picker.length > 0) {
      const videoItem = data.picker.find(item => item.type === 'video');
      return videoItem ? videoItem.url : data.picker[0].url;
    }

    console.error('Cobalt API unexpected response:', data);
    return null;
  } catch (e) {
    console.error('Cobalt API error:', e);
    return null;
  }
}

async function getVideoViaProxy(url) {
  try {
    const { ProxyAgent, fetch: proxyFetch } = await import('undici');
    const agent = new ProxyAgent(PROXY_URL);

    const response = await proxyFetch(url, {
      dispatcher: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const html = await response.text();

    // Try to extract video URL from meta tags
    const ogVideoMatch = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i) ||
                          html.match(/<meta\s+content="([^"]+)"\s+property="og:video"/i);
    if (ogVideoMatch) {
      return ogVideoMatch[1].replace(/&amp;/g, '&');
    }

    // Try to extract from JSON in script tags
    const videoUrlMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/);
    if (videoUrlMatch) {
      return videoUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    }

    // Try to extract from video_versions
    const videoVersionsMatch = html.match(/"video_versions"\s*:\s*\[.*?"url"\s*:\s*"([^"]+)"/);
    if (videoVersionsMatch) {
      return videoVersionsMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    }

    return null;
  } catch (e) {
    console.error('Proxy fetch error:', e);
    return null;
  }
}

async function getVideoViaAlternative(url) {
  // Try using alternative services
  try {
    // Extract shortcode from URL
    const shortcodeMatch = url.match(/\/(reel|p|reels)\/([\w\-]+)/);
    if (!shortcodeMatch) return null;

    const shortcode = shortcodeMatch[2];

    // Try fetching via ddinstagram (a known Instagram proxy)
    const ddUrl = `https://ddinstagram.com/reel/${shortcode}`;
    const response = await fetch(ddUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TelegramBot/1.0)',
      },
      redirect: 'follow',
    });

    const html = await response.text();
    const videoMatch = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i) ||
                       html.match(/href="([^"]*\.mp4[^"]*)"/i);
    if (videoMatch) {
      return videoMatch[1].replace(/&amp;/g, '&');
    }

    return null;
  } catch (e) {
    console.error('Alternative service error:', e);
    return null;
  }
}

async function downloadInstagramReel(url) {
  // Strategy 1: Cobalt API (most reliable)
  let videoUrl = await getVideoViaCobalt(url);
  if (videoUrl) return videoUrl;

  // Strategy 2: Direct fetch with proxy
  videoUrl = await getVideoViaProxy(url);
  if (videoUrl) return videoUrl;

  // Strategy 3: Alternative services
  videoUrl = await getVideoViaAlternative(url);
  if (videoUrl) return videoUrl;

  return null;
}

// ============ Main Webhook Handler ============
export default async function handler(req, res) {
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'Instagram Reels Bot webhook is active',
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate bot token is configured
  if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is not configured');
    return res.status(200).json({ ok: true });
  }

  try {
    const update = req.body;

    // Handle regular messages
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text || msg.caption || '';
      const username = msg.from?.username || '';
      const firstName = msg.from?.first_name || '';

      // Save user on any interaction
      await saveUser(chatId, username, firstName);

      // ---- Check broadcast state for admin ----
      if (chatId === ADMIN_ID) {
        const broadcastState = await getBroadcastState();
        if (broadcastState === 'waiting' && !text.startsWith('/')) {
          await deleteBroadcastState();
          await sendMessage(chatId, '📢 <b>Начинаю рассылку...</b>');

          const users = await getAllUsers();
          let sent = 0;
          let failed = 0;

          for (const userId of users) {
            try {
              const result = await copyMessage(Number(userId), chatId, msg.message_id);
              if (result && result.ok) {
                sent++;
              } else {
                failed++;
              }
            } catch (e) {
              failed++;
              console.error(`Failed to send to ${userId}:`, e);
            }
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          await sendMessage(chatId,
            `✅ <b>Рассылка завершена!</b>\n\n` +
            `📨 Отправлено: ${sent}\n` +
            `❌ Ошибки: ${failed}\n` +
            `👥 Всего пользователей: ${users.length}`
          );
          return res.status(200).json({ ok: true });
        }
      }

      // ---- /start command ----
      if (text === '/start') {
        const welcomeText =
          `👋 <b>Привет${firstName ? ', ' + firstName : ''}!</b>\n\n` +
          `🎬 Я помогу тебе скачать <b>Reels из Instagram</b>!\n\n` +
          `📎 Просто отправь мне ссылку на Reels, и я скачаю видео для тебя.\n\n` +
          `💡 <b>Поддерживаемые ссылки:</b>\n` +
          `• instagram.com/reel/...\n` +
          `• instagram.com/p/...\n` +
          `• instagram.com/reels/...\n` +
          `• instagr.am/reel/...\n\n` +
          `📖 /help — список команд`;

        await sendMessage(chatId, welcomeText, {
          reply_markup: {
            inline_keyboard: [[
              { text: '📖 Помощь', callback_data: 'help' }
            ]]
          }
        });

        // Notify admin about new user
        if (chatId !== ADMIN_ID) {
          await sendMessage(ADMIN_ID,
            `🆕 <b>Новый пользователь!</b>\n` +
            `👤 ${firstName} ${username ? '(@' + username + ')' : ''}\n` +
            `🆔 <code>${chatId}</code>`
          );
        }

        return res.status(200).json({ ok: true });
      }

      // ---- /broadcast command (admin only) ----
      if (text === '/broadcast' && chatId === ADMIN_ID) {
        if (!UPSTASH_URL) {
          await sendMessage(chatId,
            '❌ <b>Хранилище не настроено!</b>\n\n' +
            'Для рассылки необходимо настроить Upstash Redis.\n' +
            'Установите переменные окружения:\n' +
            '• <code>UPSTASH_REDIS_REST_URL</code>\n' +
            '• <code>UPSTASH_REDIS_REST_TOKEN</code>'
          );
          return res.status(200).json({ ok: true });
        }

        await setBroadcastState('waiting');
        await sendMessage(chatId,
          '📢 <b>Режим рассылки активирован!</b>\n\n' +
          '📝 Отправьте следующим сообщением контент для рассылки:\n' +
          '• Текст\n' +
          '• Фото с подписью\n' +
          '• Видео с подписью\n' +
          '• Любой другой контент\n\n' +
          '⏱ Режим автоматически отключится через 5 минут.\n' +
          '❌ Для отмены отправьте /cancel'
        );
        return res.status(200).json({ ok: true });
      }

      // ---- /cancel command (admin only) ----
      if (text === '/cancel' && chatId === ADMIN_ID) {
        await deleteBroadcastState();
        await sendMessage(chatId, '❌ Рассылка отменена.');
        return res.status(200).json({ ok: true });
      }

      // ---- /stats command (admin only) ----
      if (text === '/stats' && chatId === ADMIN_ID) {
        const userCount = UPSTASH_URL ? await getUserCount() : 'N/A';
        const downloads = await getStat('downloads');
        const failedDownloads = await getStat('failed_downloads');

        await sendMessage(chatId,
          `📊 <b>Статистика бота</b>\n\n` +
          `👥 Пользователей: <b>${userCount}</b>\n` +
          `✅ Успешных загрузок: <b>${downloads}</b>\n` +
          `❌ Неудачных загрузок: <b>${failedDownloads}</b>\n` +
          `🤖 Статус: <b>Активен</b>\n` +
          `⏰ Время сервера: <b>${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</b>`
        );
        return res.status(200).json({ ok: true });
      }

      // ---- /help command ----
      if (text === '/help') {
        let helpText =
          '📖 <b>Справка</b>\n\n' +
          '🎬 <b>Скачивание Reels:</b>\n' +
          'Просто отправьте ссылку на Instagram Reels, и бот скачает видео.\n\n' +
          '<b>Команды:</b>\n' +
          '/start — Начать работу с ботом\n' +
          '/help — Эта справка\n';

        if (chatId === ADMIN_ID) {
          helpText +=
            '\n<b>🔧 Команды администратора:</b>\n' +
            '/broadcast — Рассылка всем пользователям\n' +
            '/cancel — Отменить рассылку\n' +
            '/stats — Статистика бота\n';
        }

        await sendMessage(chatId, helpText);
        return res.status(200).json({ ok: true });
      }

      // ---- Instagram link detection ----
      const igUrl = extractInstagramUrl(text);

      if (igUrl) {
        await sendChatAction(chatId, 'upload_video');
        await sendMessage(chatId, '⏳ <b>Скачиваю видео...</b>\n\nЭто может занять несколько секунд.');

        const videoUrl = await downloadInstagramReel(igUrl);

        if (videoUrl) {
          try {
            const result = await sendVideo(chatId, videoUrl, '🎬 <b>Ваше видео из Instagram Reels</b>');

            if (result && !result.ok) {
              // If sending as video fails, try sending as document
              const docResult = await tgApi('sendDocument', {
                chat_id: chatId,
                document: videoUrl,
                caption: '🎬 <b>Ваше видео из Instagram Reels</b>',
                parse_mode: 'HTML',
              });

              if (!docResult || !docResult.ok) {
                // Last resort: send the URL directly
                await sendMessage(chatId,
                  `🎬 <b>Видео найдено!</b>\n\n` +
                  `К сожалению, не удалось отправить видео напрямую.\n` +
                  `📎 <a href="${videoUrl}">Скачать видео по ссылке</a>`
                );
              }
            }

            await incrementStat('downloads');
          } catch (e) {
            console.error('Failed to send video:', e);
            await sendMessage(chatId,
              `🎬 <b>Видео найдено!</b>\n\n` +
              `📎 <a href="${videoUrl}">Скачать видео по ссылке</a>`
            );
            await incrementStat('downloads');
          }
        } else {
          await incrementStat('failed_downloads');
          await sendMessage(chatId,
            '❌ <b>Не удалось скачать видео.</b>\n\n' +
            'Возможные причины:\n' +
            '• 🔒 Приватный аккаунт\n' +
            '• 🔗 Неверная или устаревшая ссылка\n' +
            '• ⏱ Временные ограничения Instagram\n' +
            '• 🗑 Видео было удалено\n\n' +
            '💡 Попробуйте позже или проверьте ссылку.'
          );
        }
        return res.status(200).json({ ok: true });
      }

      // ---- Unknown message ----
      if (text && !text.startsWith('/')) {
        await sendMessage(chatId,
          '🔗 Отправьте мне ссылку на <b>Instagram Reels</b> для скачивания.\n\n' +
          '💡 Пример: <code>https://www.instagram.com/reel/ABC123/</code>'
        );
      } else if (text.startsWith('/')) {
        await sendMessage(chatId, '❓ Неизвестная команда. Используйте /help для списка команд.');
      }
    }

    // Handle callback queries
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;

      if (callbackQuery.data === 'help') {
        let helpText =
          '📖 <b>Справка</b>\n\n' +
          '🎬 <b>Скачивание Reels:</b>\n' +
          'Просто отправьте ссылку на Instagram Reels.\n\n' +
          '<b>Команды:</b>\n' +
          '/start — Начать\n' +
          '/help — Справка\n';

        await sendMessage(chatId, helpText);
        await tgApi('answerCallbackQuery', { callback_query_id: callbackQuery.id });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: true });
  }
}
