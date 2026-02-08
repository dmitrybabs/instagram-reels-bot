// Telegram Bot Webhook Handler — Instagram Reels Downloader
import nodeFetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = 706357294;
const PROXY_URL = process.env.PROXY_URL || 'http://HVWd6E:5Wdb7D@176.124.45.94:9391';
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============ Proxy Setup ============
let proxyAgent = null;
try {
  if (PROXY_URL) {
    proxyAgent = new HttpsProxyAgent(PROXY_URL);
    console.log('[proxy] Agent created for:', PROXY_URL.replace(/:[^:]+@/, ':***@'));
  }
} catch (e) {
  console.error('[proxy] Failed to create agent:', e.message);
}

function proxyFetch(url, options = {}) {
  const opts = { ...options };
  if (proxyAgent) opts.agent = proxyAgent;
  return nodeFetch(url, opts);
}

// ============ Redis Helpers ============
const REDIS_PREFIX = 'reels:';

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
    console.error('[redis] Error:', e.message);
    return null;
  }
}

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

// ============ Telegram API ============
async function tgApi(method, body) {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`[tg] ${method} error:`, e.message);
    return null;
  }
}

async function sendMessage(chatId, text, options = {}) {
  return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...options });
}

async function sendChatAction(chatId, action = 'upload_video') {
  return tgApi('sendChatAction', { chat_id: chatId, action });
}

async function copyMessage(chatId, fromChatId, messageId) {
  return tgApi('copyMessage', { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId });
}

// ============ Instagram URL Helpers ============
function extractInstagramUrl(text) {
  const m = text.match(/https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(reel|p|reels|tv)\/[\w\-]+\/?(\?[^\s]*)?/i);
  return m ? m[0] : null;
}

function extractShortcode(url) {
  const m = url.match(/\/(reel|reels|p|tv)\/([\w\-]+)/);
  return m ? m[2] : null;
}

// ============ Download Methods ============

// Method 1: Instagram Embed Page (via proxy)
async function methodEmbed(shortcode) {
  console.log('[1-embed] Trying shortcode:', shortcode);

  const url = `https://www.instagram.com/reel/${shortcode}/embed/captioned/`;

  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    console.log('[1-embed] HTTP', res.status);
    return null;
  }

  const html = await res.text();
  console.log('[1-embed] HTML length:', html.length);

  // Try multiple patterns
  const patterns = [
    /"video_url":"([^"]+)"/,
    /"contentUrl":"([^"]+)"/,
    /property="og:video"[^>]+content="([^"]+)"/i,
    /content="([^"]+)"[^>]+property="og:video"/i,
    /"video_versions":\[.*?"url":"([^"]+)"/,
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const videoUrl = m[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');
      console.log('[1-embed] ✅ Found video URL');
      return videoUrl;
    }
  }

  console.log('[1-embed] No video URL found in HTML');
  return null;
}

// Method 2: Instagram Embed (type /p/) via proxy
async function methodEmbedP(shortcode) {
  console.log('[2-embed-p] Trying shortcode:', shortcode);

  const url = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;

  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(7000),
  });

  if (!res.ok) {
    console.log('[2-embed-p] HTTP', res.status);
    return null;
  }

  const html = await res.text();
  console.log('[2-embed-p] HTML length:', html.length);

  const patterns = [
    /"video_url":"([^"]+)"/,
    /"contentUrl":"([^"]+)"/,
    /property="og:video"[^>]+content="([^"]+)"/i,
    /"video_versions":\[.*?"url":"([^"]+)"/,
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const videoUrl = m[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');
      console.log('[2-embed-p] ✅ Found video URL');
      return videoUrl;
    }
  }

  return null;
}

// Method 3: Cobalt API
async function methodCobalt(url) {
  console.log('[3-cobalt] Trying...');

  const instances = [
    'https://api.cobalt.tools',
  ];

  for (const instance of instances) {
    try {
      const res = await nodeFetch(`${instance}/`, {
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
        signal: AbortSignal.timeout(8000),
      });

      const data = await res.json();
      console.log('[3-cobalt] Response:', JSON.stringify(data).substring(0, 300));

      if (data.url) return data.url;
      if (data.status === 'picker' && data.picker?.length > 0) {
        const video = data.picker.find(i => i.type === 'video');
        return video?.url || data.picker[0].url;
      }
    } catch (e) {
      console.log(`[3-cobalt] ${instance} error:`, e.message);
    }
  }
  return null;
}

// Method 4: Direct Instagram page scrape (via proxy, mobile UA)
async function methodPageScrape(url) {
  console.log('[4-scrape] Trying:', url);

  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    console.log('[4-scrape] HTTP', res.status);
    return null;
  }

  const html = await res.text();
  console.log('[4-scrape] HTML length:', html.length);

  const patterns = [
    /"video_url":"([^"]+)"/,
    /"contentUrl":"([^"]+)"/,
    /property="og:video"[^>]+content="([^"]+)"/i,
    /content="([^"]+)"[^>]+property="og:video"/i,
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const videoUrl = m[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');
      console.log('[4-scrape] ✅ Found video URL');
      return videoUrl;
    }
  }

  return null;
}

// Main download function
async function downloadInstagramReel(url) {
  const shortcode = extractShortcode(url);
  console.log('=== DOWNLOAD START ===', { url, shortcode });

  if (!shortcode) {
    console.log('No shortcode found');
    return null;
  }

  // Method 1: Embed /reel/
  try {
    const v = await methodEmbed(shortcode);
    if (v) return v;
  } catch (e) {
    console.log('[1-embed] Error:', e.message);
  }

  // Method 2: Embed /p/
  try {
    const v = await methodEmbedP(shortcode);
    if (v) return v;
  } catch (e) {
    console.log('[2-embed-p] Error:', e.message);
  }

  // Method 3: Cobalt API
  try {
    const v = await methodCobalt(url);
    if (v) return v;
  } catch (e) {
    console.log('[3-cobalt] Error:', e.message);
  }

  // Method 4: Page scrape
  try {
    const v = await methodPageScrape(url);
    if (v) return v;
  } catch (e) {
    console.log('[4-scrape] Error:', e.message);
  }

  console.log('=== ALL METHODS FAILED ===');
  return null;
}

// ============ Send Video to User ============
async function sendVideoToUser(chatId, videoUrl) {
  // Step 1: Try sending video URL directly to Telegram
  // (Telegram servers will fetch the video — they're not in Russia, so Instagram is accessible)
  console.log('[send] Trying sendVideo by URL...');
  const result = await tgApi('sendVideo', {
    chat_id: chatId,
    video: videoUrl,
    caption: '🎬 <b>Ваше видео из Instagram Reels</b>',
    parse_mode: 'HTML',
    supports_streaming: true,
  });

  if (result?.ok) {
    console.log('[send] ✅ Sent by URL');
    return true;
  }
  console.log('[send] sendVideo by URL failed:', result?.description);

  // Step 2: Try sending as document
  console.log('[send] Trying sendDocument by URL...');
  const docResult = await tgApi('sendDocument', {
    chat_id: chatId,
    document: videoUrl,
    caption: '🎬 <b>Ваше видео из Instagram Reels</b>',
    parse_mode: 'HTML',
  });

  if (docResult?.ok) {
    console.log('[send] ✅ Sent as document');
    return true;
  }
  console.log('[send] sendDocument by URL failed:', docResult?.description);

  // Step 3: Download via proxy and upload to Telegram
  console.log('[send] Trying download via proxy + upload...');
  try {
    const videoRes = await proxyFetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.instagram.com/',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!videoRes.ok) {
      console.log('[send] Download failed, HTTP', videoRes.status);
      throw new Error('Download failed');
    }

    const arrayBuffer = await videoRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('[send] Downloaded:', (buffer.length / 1024 / 1024).toFixed(2), 'MB');

    if (buffer.length < 1000) {
      console.log('[send] Buffer too small, likely not a video');
      throw new Error('Buffer too small');
    }

    if (buffer.length > 50 * 1024 * 1024) {
      console.log('[send] Video too large for Telegram (>50MB)');
      throw new Error('Video too large');
    }

    // Upload to Telegram using FormData
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('video', new Blob([buffer], { type: 'video/mp4' }), 'video.mp4');
    form.append('caption', '🎬 Ваше видео из Instagram Reels');
    form.append('parse_mode', 'HTML');
    form.append('supports_streaming', 'true');

    const uploadRes = await fetch(`${TELEGRAM_API}/sendVideo`, {
      method: 'POST',
      body: form,
    });

    const uploadData = await uploadRes.json();
    if (uploadData.ok) {
      console.log('[send] ✅ Uploaded successfully');
      return true;
    }
    console.log('[send] Upload failed:', uploadData.description);
  } catch (e) {
    console.log('[send] Download+upload error:', e.message);
  }

  // Step 4: Last resort — send the link
  console.log('[send] Sending link as last resort');
  await sendMessage(chatId,
    `🎬 <b>Видео найдено!</b>\n\n` +
    `К сожалению, не удалось отправить видео напрямую.\n` +
    `📎 <a href="${videoUrl}">Скачать видео по ссылке</a>`
  );
  return true;
}

// ============ Main Webhook Handler ============
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'Instagram Reels Bot is running',
      proxy: proxyAgent ? 'configured' : 'not configured',
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!BOT_TOKEN) {
    console.error('BOT_TOKEN not configured');
    return res.status(200).json({ ok: true });
  }

  try {
    const update = req.body;

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text || msg.caption || '';
      const username = msg.from?.username || '';
      const firstName = msg.from?.first_name || '';

      // Save user
      await saveUser(chatId, username, firstName);

      // --- Admin broadcast mode ---
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
              const r = await copyMessage(Number(userId), chatId, msg.message_id);
              if (r?.ok) sent++;
              else failed++;
            } catch {
              failed++;
            }
            await new Promise(r => setTimeout(r, 50));
          }

          await sendMessage(chatId,
            `✅ <b>Рассылка завершена!</b>\n\n` +
            `📨 Отправлено: ${sent}\n` +
            `❌ Ошибки: ${failed}\n` +
            `👥 Всего: ${users.length}`
          );
          return res.status(200).json({ ok: true });
        }
      }

      // --- /start ---
      if (text === '/start') {
        await sendMessage(chatId,
          `👋 <b>Привет${firstName ? ', ' + firstName : ''}!</b>\n\n` +
          `🎬 Я помогу скачать <b>Reels из Instagram</b>!\n\n` +
          `📎 Просто отправь мне ссылку на Reels.\n\n` +
          `💡 <b>Поддерживаемые ссылки:</b>\n` +
          `• instagram.com/reel/...\n` +
          `• instagram.com/p/...\n` +
          `• instagram.com/reels/...\n\n` +
          `📖 /help — список команд`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: '📖 Помощь', callback_data: 'help' }]]
            }
          }
        );

        if (chatId !== ADMIN_ID) {
          await sendMessage(ADMIN_ID,
            `🆕 <b>Новый пользователь!</b>\n` +
            `👤 ${firstName} ${username ? '(@' + username + ')' : ''}\n` +
            `🆔 <code>${chatId}</code>`
          );
        }
        return res.status(200).json({ ok: true });
      }

      // --- /broadcast ---
      if (text === '/broadcast' && chatId === ADMIN_ID) {
        if (!UPSTASH_URL) {
          await sendMessage(chatId, '❌ Upstash Redis не настроен!');
          return res.status(200).json({ ok: true });
        }
        await setBroadcastState('waiting');
        await sendMessage(chatId,
          '📢 <b>Режим рассылки!</b>\n\n' +
          '📝 Отправьте контент для рассылки:\n' +
          '• Текст\n• Фото с подписью\n• Видео с подписью\n• Любой контент\n\n' +
          '⏱ Автоотключение через 5 мин.\n' +
          '❌ /cancel — отмена'
        );
        return res.status(200).json({ ok: true });
      }

      // --- /cancel ---
      if (text === '/cancel' && chatId === ADMIN_ID) {
        await deleteBroadcastState();
        await sendMessage(chatId, '❌ Рассылка отменена.');
        return res.status(200).json({ ok: true });
      }

      // --- /stats ---
      if (text === '/stats' && chatId === ADMIN_ID) {
        const userCount = UPSTASH_URL ? await getUserCount() : 'N/A';
        const downloads = await getStat('downloads');
        const failedDl = await getStat('failed_downloads');

        await sendMessage(chatId,
          `📊 <b>Статистика</b>\n\n` +
          `👥 Пользователей: <b>${userCount}</b>\n` +
          `✅ Загрузок: <b>${downloads}</b>\n` +
          `❌ Неудач: <b>${failedDl}</b>\n` +
          `🔌 Прокси: <b>${proxyAgent ? '✅' : '❌'}</b>\n` +
          `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
        );
        return res.status(200).json({ ok: true });
      }

      // --- /help ---
      if (text === '/help') {
        let helpText =
          '📖 <b>Справка</b>\n\n' +
          '🎬 Отправьте ссылку на Instagram Reels — получите видео.\n\n' +
          '<b>Команды:</b>\n' +
          '/start — Начать\n' +
          '/help — Справка\n';

        if (chatId === ADMIN_ID) {
          helpText +=
            '\n<b>🔧 Админ:</b>\n' +
            '/broadcast — Рассылка\n' +
            '/cancel — Отмена\n' +
            '/stats — Статистика\n';
        }

        await sendMessage(chatId, helpText);
        return res.status(200).json({ ok: true });
      }

      // --- Instagram link ---
      const igUrl = extractInstagramUrl(text);

      if (igUrl) {
        await sendChatAction(chatId, 'upload_video');
        await sendMessage(chatId, '⏳ <b>Скачиваю видео...</b>\n\nЭто может занять несколько секунд.');

        const videoUrl = await downloadInstagramReel(igUrl);

        if (videoUrl) {
          await sendChatAction(chatId, 'upload_video');
          await sendVideoToUser(chatId, videoUrl);
          await incrementStat('downloads');
        } else {
          await incrementStat('failed_downloads');
          await sendMessage(chatId,
            '❌ <b>Не удалось скачать видео.</b>\n\n' +
            'Возможные причины:\n' +
            '• 🔒 Приватный аккаунт\n' +
            '• 🔗 Неверная ссылка\n' +
            '• ⏱ Ограничения Instagram\n' +
            '• 🗑 Видео удалено\n\n' +
            '💡 Попробуйте позже.'
          );
        }
        return res.status(200).json({ ok: true });
      }

      // --- Unknown ---
      if (text && !text.startsWith('/')) {
        await sendMessage(chatId,
          '🔗 Отправьте ссылку на <b>Instagram Reels</b>.\n\n' +
          '💡 Пример: <code>https://www.instagram.com/reel/ABC123/</code>'
        );
      } else if (text.startsWith('/')) {
        await sendMessage(chatId, '❓ Неизвестная команда. /help');
      }
    }

    // Handle callback queries
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id;

      if (cb.data === 'help') {
        await sendMessage(chatId,
          '📖 <b>Справка</b>\n\n' +
          '🎬 Отправьте ссылку на Instagram Reels.\n\n' +
          '/start — Начать\n/help — Справка'
        );
        await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[webhook] Error:', error);
    return res.status(200).json({ ok: true });
  }
}
