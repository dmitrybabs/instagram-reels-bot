// Telegram Bot Webhook — Instagram Reels Downloader
import nodeFetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = 706357294;
const PROXY_URL = process.env.PROXY_URL || '';
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============ Proxy Setup ============
let socksProxyAgent = null;

try {
  if (PROXY_URL) {
    // User switched proxy to SOCKS5 on proxy6.net
    // Ensure URL starts with socks5:// regardless of what's in env
    const socksUrl = PROXY_URL.replace(/^https?:\/\//, 'socks5://').replace(/^(?!socks)/, 'socks5://');
    const finalUrl = socksUrl.startsWith('socks5://') ? socksUrl : `socks5://${socksUrl}`;
    socksProxyAgent = new SocksProxyAgent(finalUrl);
    console.log('[proxy] SOCKS5 agent created:', finalUrl.replace(/:[^:@]+@/, ':***@'));
  }
} catch (e) {
  console.error('[proxy] Setup error:', e.message);
}

// ============ Redis ============
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
    console.error('[redis]', e.message);
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
  const r = await redisCommand(['SMEMBERS', `${REDIS_PREFIX}users`]);
  return r?.result || [];
}

async function getUserCount() {
  const r = await redisCommand(['SCARD', `${REDIS_PREFIX}users`]);
  return r?.result || 0;
}

async function setBroadcastState(state) {
  return redisCommand(['SET', `${REDIS_PREFIX}broadcast_${ADMIN_ID}`, state, 'EX', '300']);
}

async function getBroadcastState() {
  const r = await redisCommand(['GET', `${REDIS_PREFIX}broadcast_${ADMIN_ID}`]);
  return r?.result;
}

async function deleteBroadcastState() {
  return redisCommand(['DEL', `${REDIS_PREFIX}broadcast_${ADMIN_ID}`]);
}

async function incrementStat(key) {
  return redisCommand(['INCR', `${REDIS_PREFIX}stat:${key}`]);
}

async function getStat(key) {
  const r = await redisCommand(['GET', `${REDIS_PREFIX}stat:${key}`]);
  return r?.result || '0';
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
    console.error(`[tg] ${method}:`, e.message);
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

// ============ Instagram Helpers ============
function extractInstagramUrl(text) {
  const m = text.match(/https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(reel|p|reels|tv)\/[\w\-]+\/?((\?|#)[^\s]*)?/i);
  return m ? m[0] : null;
}

function extractShortcode(url) {
  const m = url.match(/\/(reel|reels|p|tv)\/([\w\-]+)/);
  return m ? m[2] : null;
}

function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (const c of shortcode) {
    const idx = alphabet.indexOf(c);
    if (idx === -1) return null;
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

// Fetch with timeout helper
function fetchT(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return nodeFetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ============ Download Methods ============

// Method 1: Instagram Mobile API (i.instagram.com) — works without auth!
async function methodMobileAPI(shortcode, agent, tag) {
  const mediaId = shortcodeToMediaId(shortcode);
  if (!mediaId) return null;
  
  console.log(`[${tag}] Mobile API, mediaId: ${mediaId}`);
  
  const res = await fetchT(
    `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    {
      headers: {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 440dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 458229258)',
        'X-IG-App-ID': '936619743392459',
        'X-IG-WWW-Claim': '0',
        'X-Requested-With': 'com.instagram.android',
        'Accept': '*/*',
      },
      agent,
    },
    12000
  );
  
  console.log(`[${tag}] Status: ${res.status}`);
  
  if (!res.ok) return null;
  
  const data = await res.json();
  const item = data.items?.[0];
  const videoUrl = item?.video_versions?.[0]?.url;
  
  if (videoUrl) {
    console.log(`[${tag}] ✅ Found video!`);
    return videoUrl;
  }
  return null;
}

// Method 2: Instagram Embed page — extract video_url from HTML
async function methodEmbed(shortcode, agent, tag) {
  console.log(`[${tag}] Embed page`);
  
  // Try both /reel/ and /p/ paths
  for (const path of [`/reel/${shortcode}/embed/captioned/`, `/p/${shortcode}/embed/captioned/`]) {
    try {
      const res = await fetchT(
        `https://www.instagram.com${path}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
          },
          agent,
          redirect: 'follow',
        },
        12000
      );
      
      if (!res.ok) continue;
      
      const html = await res.text();
      console.log(`[${tag}] HTML length: ${html.length}`);
      
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
          const url = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
          console.log(`[${tag}] ✅ Found in embed!`);
          return url;
        }
      }
    } catch (e) {
      console.log(`[${tag}] ${path} error: ${e.message}`);
    }
  }
  return null;
}

// Method 3: Instagram web JSON endpoint (?__a=1&__d=dis)
async function methodWebJSON(shortcode, agent, tag) {
  console.log(`[${tag}] Web JSON`);
  
  const res = await fetchT(
    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': '*/*',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      },
      agent,
      redirect: 'follow',
    },
    12000
  );
  
  console.log(`[${tag}] Status: ${res.status}`);
  
  if (!res.ok) return null;
  
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    console.log(`[${tag}] Not JSON: ${ct}`);
    return null;
  }
  
  const data = await res.json();
  const media = data?.graphql?.shortcode_media || data?.items?.[0];
  const videoUrl = media?.video_url || media?.video_versions?.[0]?.url;
  
  if (videoUrl) {
    console.log(`[${tag}] ✅ Found!`);
    return videoUrl;
  }
  return null;
}

// Method 4: GraphQL query
async function methodGraphQL(shortcode, agent, tag) {
  console.log(`[${tag}] GraphQL`);
  
  const variables = JSON.stringify({
    shortcode: shortcode,
    child_comment_count: 0,
    fetch_comment_count: 0,
    parent_comment_count: 0,
    has_threaded_comments: false,
  });
  
  const url = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(variables)}`;
  
  const res = await fetchT(
    url,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      },
      agent,
      redirect: 'follow',
    },
    12000
  );
  
  if (!res.ok) return null;
  
  const data = await res.json();
  const media = data?.data?.shortcode_media;
  
  if (media?.video_url) {
    console.log(`[${tag}] ✅ Found!`);
    return media.video_url;
  }
  return null;
}

// ============ Main Download Function ============
async function downloadInstagramReel(url) {
  const shortcode = extractShortcode(url);
  console.log('=== DOWNLOAD START ===', { url, shortcode });
  
  if (!shortcode) {
    console.log('No shortcode found');
    return null;
  }
  
  // Build list of all attempts to run IN PARALLEL
  // Key insight: Vercel servers are in US/EU and CAN access Instagram directly!
  // So we try WITHOUT proxy first (simultaneously with proxy attempts)
  
  const attempts = [];
  
  // --- Without proxy (direct from Vercel — should work!) ---
  attempts.push(methodMobileAPI(shortcode, undefined, '1-mobile-direct'));
  attempts.push(methodEmbed(shortcode, undefined, '2-embed-direct'));
  attempts.push(methodWebJSON(shortcode, undefined, '3-json-direct'));
  attempts.push(methodGraphQL(shortcode, undefined, '4-gql-direct'));
  
  // --- With SOCKS5 proxy (proxy6.net, France) ---
  if (socksProxyAgent) {
    attempts.push(methodMobileAPI(shortcode, socksProxyAgent, '5-mobile-socks'));
    attempts.push(methodEmbed(shortcode, socksProxyAgent, '6-embed-socks'));
    attempts.push(methodWebJSON(shortcode, socksProxyAgent, '7-json-socks'));
    attempts.push(methodGraphQL(shortcode, socksProxyAgent, '8-gql-socks'));
  }
  
  // Wrap each attempt: catch errors, convert null to rejection
  const wrapped = attempts.map((promise, i) =>
    promise
      .catch(e => {
        console.log(`[attempt-${i + 1}] Error: ${e.message}`);
        return null;
      })
      .then(result => {
        if (result) return result;
        return Promise.reject(new Error('no result'));
      })
  );
  
  try {
    // Promise.any resolves with the FIRST successful result
    const videoUrl = await Promise.any(wrapped);
    console.log('=== DOWNLOAD SUCCESS ===');
    return videoUrl;
  } catch (e) {
    console.log('=== ALL METHODS FAILED ===');
    return null;
  }
}

// ============ Send Video ============
async function sendVideoToUser(chatId, videoUrl) {
  // Step 1: Try sending video URL to Telegram (Telegram servers fetch it)
  console.log('[send] Trying sendVideo with URL...');
  const r1 = await tgApi('sendVideo', {
    chat_id: chatId,
    video: videoUrl,
    caption: '🎬 <b>Ваше видео из Instagram Reels</b>',
    parse_mode: 'HTML',
    supports_streaming: true,
  });
  
  if (r1?.ok) {
    console.log('[send] ✅ Sent via URL');
    return true;
  }
  console.log('[send] URL failed:', r1?.description);
  
  // Step 2: Try as document
  console.log('[send] Trying sendDocument...');
  const r2 = await tgApi('sendDocument', {
    chat_id: chatId,
    document: videoUrl,
    caption: '🎬 <b>Ваше видео из Instagram Reels</b>',
    parse_mode: 'HTML',
  });
  
  if (r2?.ok) {
    console.log('[send] ✅ Sent as document');
    return true;
  }
  
  // Step 3: Download video ourselves and upload to Telegram
  console.log('[send] Trying download + upload...');
  try {
    // Try downloading: first direct, then with proxy agents
    let videoBuffer = null;
    const agents = [undefined, socksProxyAgent].filter(Boolean);
    
    for (const agent of [undefined, ...agents]) {
      try {
        const vRes = await fetchT(videoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.instagram.com/',
          },
          agent,
        }, 20000);
        
        if (vRes.ok) {
          const ab = await vRes.arrayBuffer();
          videoBuffer = Buffer.from(ab);
          if (videoBuffer.length > 1000) {
            console.log('[send] Downloaded:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');
            break;
          }
          videoBuffer = null;
        }
      } catch (e) {
        console.log('[send] Download attempt error:', e.message);
      }
    }
    
    if (videoBuffer && videoBuffer.length > 1000 && videoBuffer.length < 50 * 1024 * 1024) {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('video', new Blob([videoBuffer], { type: 'video/mp4' }), 'instagram_reels.mp4');
      form.append('caption', '🎬 Ваше видео из Instagram Reels');
      form.append('parse_mode', 'HTML');
      form.append('supports_streaming', 'true');
      
      const uploadRes = await fetch(`${TELEGRAM_API}/sendVideo`, {
        method: 'POST',
        body: form,
      });
      
      const uploadData = await uploadRes.json();
      if (uploadData.ok) {
        console.log('[send] ✅ Uploaded');
        return true;
      }
      console.log('[send] Upload failed:', uploadData.description);
    }
  } catch (e) {
    console.log('[send] Download+upload error:', e.message);
  }
  
  // Step 4: Send link as last resort
  console.log('[send] Sending link...');
  await sendMessage(chatId,
    `🎬 <b>Видео найдено!</b>\n\n` +
    `Не удалось отправить напрямую.\n` +
    `📎 <a href="${videoUrl}">Скачать видео по ссылке</a>`
  );
  return true;
}

// ============ Main Handler ============
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      bot: 'Instagram Reels Bot',
      proxy_socks5: !!socksProxyAgent,
      timestamp: new Date().toISOString(),
    });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  if (!BOT_TOKEN) {
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
      
      await saveUser(chatId, username, firstName);
      
      // --- Broadcast mode check ---
      if (chatId === ADMIN_ID) {
        const broadcastState = await getBroadcastState();
        if (broadcastState === 'waiting' && !text.startsWith('/')) {
          await deleteBroadcastState();
          await sendMessage(chatId, '📢 <b>Начинаю рассылку...</b>');
          
          const users = await getAllUsers();
          let sent = 0, failed = 0;
          
          for (const userId of users) {
            try {
              const r = await copyMessage(Number(userId), chatId, msg.message_id);
              if (r?.ok) sent++; else failed++;
            } catch { failed++; }
            await new Promise(r => setTimeout(r, 50));
          }
          
          await sendMessage(chatId,
            `✅ <b>Рассылка завершена!</b>\n\n📨 Отправлено: ${sent}\n❌ Ошибки: ${failed}\n👥 Всего: ${users.length}`
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
          `• instagram.com/p/...\n\n` +
          `📖 /help — список команд`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: '📖 Помощь', callback_data: 'help' }]]
            }
          }
        );
        
        if (chatId !== ADMIN_ID) {
          await sendMessage(ADMIN_ID,
            `🆕 <b>Новый пользователь!</b>\n👤 ${firstName} ${username ? '(@' + username + ')' : ''}\n🆔 <code>${chatId}</code>`
          );
        }
        return res.status(200).json({ ok: true });
      }
      
      // --- /help ---
      if (text === '/help') {
        let h = '📖 <b>Справка</b>\n\n🎬 Отправьте ссылку на Instagram Reels.\n\n<b>Команды:</b>\n/start — Начать\n/help — Справка\n';
        if (chatId === ADMIN_ID) {
          h += '\n<b>🔧 Админ:</b>\n/broadcast — Рассылка\n/cancel — Отмена\n/stats — Статистика\n';
        }
        await sendMessage(chatId, h);
        return res.status(200).json({ ok: true });
      }
      
      // --- /broadcast ---
      if (text === '/broadcast' && chatId === ADMIN_ID) {
        await setBroadcastState('waiting');
        await sendMessage(chatId,
          '📢 <b>Режим рассылки!</b>\n\n📝 Отправьте контент:\n• Текст\n• Фото с подписью\n• Видео с подписью\n\n⏱ 5 мин\n❌ /cancel — отмена'
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
        const userCount = await getUserCount();
        const downloads = await getStat('downloads');
        const failedDl = await getStat('failed_downloads');
        
        await sendMessage(chatId,
          `📊 <b>Статистика</b>\n\n` +
          `👥 Пользователей: <b>${userCount}</b>\n` +
          `✅ Загрузок: <b>${downloads}</b>\n` +
          `❌ Неудач: <b>${failedDl}</b>\n` +
          `🔌 SOCKS5 прокси: ${socksProxyAgent ? '✅' : '❌'}\n` +
          `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
        );
        return res.status(200).json({ ok: true });
      }
      
      // --- Instagram link ---
      const igUrl = extractInstagramUrl(text);
      
      if (igUrl) {
        await sendChatAction(chatId, 'upload_video');
        await sendMessage(chatId, '⏳ <b>Скачиваю видео...</b>\n\nПробую несколько способов...');
        
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
        await sendMessage(chatId, '🔗 Отправьте ссылку на <b>Instagram Reels</b>.\n\n💡 Пример: <code>https://www.instagram.com/reel/ABC123/</code>');
      } else if (text?.startsWith('/')) {
        await sendMessage(chatId, '❓ Неизвестная команда. /help');
      }
    }
    
    // Callback queries
    if (update.callback_query) {
      const cb = update.callback_query;
      if (cb.data === 'help') {
        await sendMessage(cb.message.chat.id,
          '📖 <b>Справка</b>\n\n🎬 Отправьте ссылку на Instagram Reels.\n\n/start — Начать\n/help — Справка'
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
