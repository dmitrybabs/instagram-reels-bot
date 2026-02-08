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
let socksAgent = null;

try {
  if (PROXY_URL) {
    const socksUrl = PROXY_URL.startsWith('socks') ? PROXY_URL : PROXY_URL.replace(/^https?:\/\//, 'socks5://');
    const finalUrl = socksUrl.startsWith('socks') ? socksUrl : `socks5://${socksUrl}`;
    socksAgent = new SocksProxyAgent(finalUrl);
    console.log('[proxy] SOCKS5 ready:', finalUrl.replace(/:[^:@]+@/, ':***@'));
  }
} catch (e) {
  console.error('[proxy] Error:', e.message);
}

// ============ Redis ============
const PFX = 'reels:';

async function redis(cmd) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const r = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return await r.json();
  } catch (e) { return null; }
}

async function saveUser(id, un, fn) {
  await redis(['SADD', `${PFX}users`, String(id)]);
  if (un || fn) await redis(['HSET', `${PFX}user:${id}`, 'username', un || '', 'firstName', fn || '', 'lastSeen', new Date().toISOString()]);
}
async function getAllUsers() { const r = await redis(['SMEMBERS', `${PFX}users`]); return r?.result || []; }
async function getUserCount() { const r = await redis(['SCARD', `${PFX}users`]); return r?.result || 0; }
async function setBroadcast(s) { return redis(['SET', `${PFX}bc_${ADMIN_ID}`, s, 'EX', '300']); }
async function getBroadcast() { const r = await redis(['GET', `${PFX}bc_${ADMIN_ID}`]); return r?.result; }
async function delBroadcast() { return redis(['DEL', `${PFX}bc_${ADMIN_ID}`]); }
async function incStat(k) { return redis(['INCR', `${PFX}stat:${k}`]); }
async function getStat(k) { const r = await redis(['GET', `${PFX}stat:${k}`]); return r?.result || '0'; }

// ============ Telegram ============
async function tg(method, body) {
  try {
    const r = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) { return null; }
}
const sendMsg = (id, text, opts = {}) => tg('sendMessage', { chat_id: id, text, parse_mode: 'HTML', ...opts });
const sendAction = (id, a = 'upload_video') => tg('sendChatAction', { chat_id: id, action: a });
const copyMsg = (to, from, mid) => tg('copyMessage', { chat_id: to, from_chat_id: from, message_id: mid });

// ============ Instagram Helpers ============
function extractIgUrl(text) {
  const m = text.match(/https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(reel|p|reels|tv)\/[\w\-]+\/?[^\s]*/i);
  return m ? m[0] : null;
}

function extractShortcode(url) {
  const m = url.match(/\/(reel|reels|p|tv)\/([\w\-]+)/);
  return m ? m[2] : null;
}

function shortcodeToMediaId(sc) {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (const c of sc) { const i = alph.indexOf(c); if (i === -1) return null; id = id * 64n + BigInt(i); }
  return id.toString();
}

function fetchT(url, opts = {}, ms = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return nodeFetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
}

// ============ AGGRESSIVE URL EXTRACTION ============
function extractVideoUrls(html) {
  const urls = [];

  // 1. Find any .mp4 URL (most reliable — catches everything)
  const mp4Regex = /https?:[\\\/]{1,2}[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/gi;
  const mp4Matches = html.match(mp4Regex) || [];
  for (let u of mp4Matches) {
    u = cleanUrl(u);
    if (u && u.includes('cdninstagram.com')) urls.push(u);
  }

  // 2. Find video_url in JSON
  const vuRegex = /video_url["\s:]+["']([^"']+)["']/gi;
  let m;
  while ((m = vuRegex.exec(html)) !== null) {
    const u = cleanUrl(m[1]);
    if (u) urls.push(u);
  }

  // 3. og:video meta tag
  const ogRegex = /property=["']og:video["'][^>]+content=["']([^"']+)["']/gi;
  while ((m = ogRegex.exec(html)) !== null) {
    const u = cleanUrl(m[1]);
    if (u) urls.push(u);
  }
  const ogRegex2 = /content=["']([^"']+)["'][^>]+property=["']og:video["']/gi;
  while ((m = ogRegex2.exec(html)) !== null) {
    const u = cleanUrl(m[1]);
    if (u) urls.push(u);
  }

  // 4. contentUrl
  const cuRegex = /contentUrl["'\s:]+["']([^"']+)["']/gi;
  while ((m = cuRegex.exec(html)) !== null) {
    const u = cleanUrl(m[1]);
    if (u) urls.push(u);
  }

  // 5. video_versions array
  const vvRegex = /video_versions[^[]*\[[^\]]*?url["'\s:]+["']([^"']+)["']/gi;
  while ((m = vvRegex.exec(html)) !== null) {
    const u = cleanUrl(m[1]);
    if (u) urls.push(u);
  }

  // 6. Any scontent URL (Instagram CDN)
  const scontentRegex = /https?:[\\\/]{1,2}scontent[^\s"'<>\\]+/gi;
  const scontentMatches = html.match(scontentRegex) || [];
  for (let u of scontentMatches) {
    u = cleanUrl(u);
    if (u && (u.includes('.mp4') || u.includes('video'))) urls.push(u);
  }

  // Deduplicate
  return [...new Set(urls)];
}

function cleanUrl(u) {
  if (!u) return null;
  u = u.replace(/\\u0026/g, '&')
       .replace(/\\\//g, '/')
       .replace(/&amp;/g, '&')
       .replace(/\\x26/g, '&')
       .replace(/\\/g, '/')
       .replace(/\/\//g, '//')
       .replace(/([^:])\/+/g, '$1/');
  // Fix double-slash after protocol
  u = u.replace(/^(https?):\/([^\/])/, '$1://$2');
  try { new URL(u); return u; } catch { return null; }
}

// ============ DOWNLOAD METHODS ============

// Method A: Instagram Embed page (WORKS from Vercel — got 160KB HTML!)
async function methodEmbed(sc, agent, tag) {
  console.log(`[${tag}] Trying embed`);
  const paths = [`/reel/${sc}/embed/captioned/`, `/p/${sc}/embed/captioned/`, `/reel/${sc}/embed/`, `/p/${sc}/embed/`];

  for (const path of paths) {
    try {
      const res = await fetchT(`https://www.instagram.com${path}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'iframe',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
        },
        agent, redirect: 'follow',
      }, 25000);

      if (!res.ok) { console.log(`[${tag}] ${path} status: ${res.status}`); continue; }

      const html = await res.text();
      console.log(`[${tag}] HTML: ${html.length} chars`);

      // Log a snippet around "video" for debugging
      const vidIdx = html.indexOf('video');
      if (vidIdx > -1) {
        console.log(`[${tag}] "video" found at index ${vidIdx}, snippet: ...${html.substring(vidIdx, vidIdx + 200)}...`);
      }

      const urls = extractVideoUrls(html);
      console.log(`[${tag}] Extracted URLs: ${urls.length}`);

      if (urls.length > 0) {
        console.log(`[${tag}] ✅ Found: ${urls[0].substring(0, 100)}...`);
        return urls[0];
      }
    } catch (e) {
      console.log(`[${tag}] ${path} error: ${e.message}`);
    }
  }
  return null;
}

// Method B: Instagram Mobile API
async function methodMobile(sc, agent, tag) {
  const mid = shortcodeToMediaId(sc);
  if (!mid) return null;
  console.log(`[${tag}] Mobile API, id: ${mid}`);

  const res = await fetchT(`https://i.instagram.com/api/v1/media/${mid}/info/`, {
    headers: {
      'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 440dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 458229258)',
      'X-IG-App-ID': '936619743392459',
    },
    agent,
  }, 20000);

  console.log(`[${tag}] Status: ${res.status}`);
  if (!res.ok) return null;

  const data = await res.json();
  const url = data.items?.[0]?.video_versions?.[0]?.url;
  if (url) { console.log(`[${tag}] ✅ Found!`); return url; }
  return null;
}

// Method C: Web JSON (?__a=1&__d=dis)
async function methodWebJSON(sc, agent, tag) {
  console.log(`[${tag}] Web JSON`);
  const res = await fetchT(`https://www.instagram.com/p/${sc}/?__a=1&__d=dis`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
    },
    agent, redirect: 'follow',
  }, 20000);

  console.log(`[${tag}] Status: ${res.status}`);
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) { console.log(`[${tag}] Not JSON`); return null; }

  const data = await res.json();
  const url = data?.graphql?.shortcode_media?.video_url || data?.items?.[0]?.video_versions?.[0]?.url;
  if (url) { console.log(`[${tag}] ✅`); return url; }
  return null;
}

// Method D: GraphQL
async function methodGQL(sc, agent, tag) {
  console.log(`[${tag}] GraphQL`);
  const vars = JSON.stringify({ shortcode: sc, child_comment_count: 0, fetch_comment_count: 0, parent_comment_count: 0, has_threaded_comments: false });
  const res = await fetchT(
    `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(vars)}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' },
      agent, redirect: 'follow',
    }, 20000
  );
  if (!res.ok) return null;
  const data = await res.json();
  const url = data?.data?.shortcode_media?.video_url;
  if (url) { console.log(`[${tag}] ✅`); return url; }
  return null;
}

// Method E: Third-party service — SaveFrom-style
async function methodThirdParty1(igUrl, tag) {
  console.log(`[${tag}] Trying savefrom...`);
  try {
    const res = await fetchT('https://api.savefrom.biz/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://savefrom.biz', 'Referer': 'https://savefrom.biz/' },
      body: JSON.stringify({ url: igUrl }),
    }, 15000);
    if (!res.ok) { console.log(`[${tag}] status ${res.status}`); return null; }
    const data = await res.json();
    console.log(`[${tag}] Response keys: ${Object.keys(data).join(',')}`);
    const url = data?.url || data?.video_url || data?.urls?.[0]?.url || data?.result?.url;
    if (url) { console.log(`[${tag}] ✅`); return url; }
  } catch (e) { console.log(`[${tag}] Error: ${e.message}`); }
  return null;
}

// Method F: sssstik-style (generic IG downloader)
async function methodThirdParty2(igUrl, tag) {
  console.log(`[${tag}] Trying generic downloader...`);
  try {
    const endpoints = [
      { url: 'https://api.downloadgram.org/media?url=' + encodeURIComponent(igUrl), method: 'GET' },
    ];
    for (const ep of endpoints) {
      try {
        const res = await fetchT(ep.url, {
          method: ep.method || 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }, 15000);
        if (!res.ok) continue;
        const data = await res.json();
        const url = data?.url || data?.video_url || data?.download_url || data?.media;
        if (url) { console.log(`[${tag}] ✅`); return url; }
      } catch {}
    }
  } catch (e) { console.log(`[${tag}] Error: ${e.message}`); }
  return null;
}

// Method G: Instagram page scrape — find video in full page source
async function methodPageScrape(igUrl, agent, tag) {
  console.log(`[${tag}] Page scrape`);
  try {
    const res = await fetchT(igUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
      },
      agent, redirect: 'follow',
    }, 25000);
    if (!res.ok) { console.log(`[${tag}] status ${res.status}`); return null; }
    const html = await res.text();
    console.log(`[${tag}] HTML: ${html.length}`);

    const urls = extractVideoUrls(html);
    console.log(`[${tag}] URLs found: ${urls.length}`);
    if (urls.length > 0) {
      console.log(`[${tag}] ✅`);
      return urls[0];
    }
  } catch (e) { console.log(`[${tag}] Error: ${e.message}`); }
  return null;
}

// ============ MAIN DOWNLOAD ============
async function downloadReel(igUrl) {
  const sc = extractShortcode(igUrl);
  console.log('=== DOWNLOAD START ===', { url: igUrl, shortcode: sc });
  if (!sc) return null;

  // ALL methods run in PARALLEL — first success wins
  const attempts = [
    // Direct (Vercel → Instagram) — embed worked before!
    methodEmbed(sc, undefined, 'A-embed-direct'),
    methodMobile(sc, undefined, 'B-mobile-direct'),
    methodWebJSON(sc, undefined, 'C-json-direct'),
    methodGQL(sc, undefined, 'D-gql-direct'),
    methodPageScrape(igUrl, undefined, 'E-scrape-direct'),

    // Third-party services (no proxy needed)
    methodThirdParty1(igUrl, 'F-3rdparty1'),
    methodThirdParty2(igUrl, 'G-3rdparty2'),
  ];

  // SOCKS5 proxy methods
  if (socksAgent) {
    attempts.push(
      methodEmbed(sc, socksAgent, 'H-embed-socks'),
      methodMobile(sc, socksAgent, 'I-mobile-socks'),
      methodWebJSON(sc, socksAgent, 'J-json-socks'),
      methodPageScrape(igUrl, socksAgent, 'K-scrape-socks'),
    );
  }

  const wrapped = attempts.map((p, i) =>
    p.catch(e => { console.log(`[attempt-${i}] Error: ${e.message}`); return null; })
     .then(r => r ? r : Promise.reject('no result'))
  );

  try {
    const url = await Promise.any(wrapped);
    console.log('=== SUCCESS ===', url?.substring(0, 80));
    return url;
  } catch {
    console.log('=== ALL FAILED ===');
    return null;
  }
}

// ============ SEND VIDEO ============
async function sendVideo(chatId, videoUrl) {
  // 1: Send URL directly
  console.log('[send] sendVideo URL...');
  const r1 = await tg('sendVideo', { chat_id: chatId, video: videoUrl, caption: '🎬 <b>Ваше видео из Instagram Reels</b>', parse_mode: 'HTML', supports_streaming: true });
  if (r1?.ok) { console.log('[send] ✅ URL'); return true; }
  console.log('[send] URL fail:', r1?.description);

  // 2: Send as document
  const r2 = await tg('sendDocument', { chat_id: chatId, document: videoUrl, caption: '🎬 <b>Ваше видео</b>', parse_mode: 'HTML' });
  if (r2?.ok) { console.log('[send] ✅ doc'); return true; }

  // 3: Download + upload
  console.log('[send] download+upload...');
  try {
    const agents = [undefined, socksAgent].filter(Boolean);
    for (const agent of agents) {
      try {
        const vr = await fetchT(videoUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' },
          agent,
        }, 25000);
        if (!vr.ok) continue;
        const ab = await vr.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length < 1000 || buf.length > 50 * 1024 * 1024) continue;
        console.log('[send] Downloaded:', (buf.length / 1024 / 1024).toFixed(2), 'MB');

        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('video', new Blob([buf], { type: 'video/mp4' }), 'reels.mp4');
        form.append('caption', '🎬 Ваше видео из Instagram Reels');
        form.append('supports_streaming', 'true');

        const ur = await fetch(`${TELEGRAM_API}/sendVideo`, { method: 'POST', body: form });
        const ud = await ur.json();
        if (ud.ok) { console.log('[send] ✅ uploaded'); return true; }
      } catch (e) { console.log('[send] dl err:', e.message); }
    }
  } catch {}

  // 4: Link
  await sendMsg(chatId, `🎬 <b>Видео найдено!</b>\n\n📎 <a href="${videoUrl}">Скачать видео</a>`);
  return true;
}

// ============ HANDLER ============
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, bot: 'Instagram Reels Bot', proxy: !!socksAgent });
  }
  if (req.method !== 'POST' || !BOT_TOKEN) return res.status(200).json({ ok: true });

  try {
    const upd = req.body;

    if (upd.message) {
      const msg = upd.message;
      const cid = msg.chat.id;
      const text = msg.text || msg.caption || '';
      const un = msg.from?.username || '';
      const fn = msg.from?.first_name || '';

      await saveUser(cid, un, fn);

      // Broadcast mode
      if (cid === ADMIN_ID) {
        const bs = await getBroadcast();
        if (bs === 'waiting' && !text.startsWith('/')) {
          await delBroadcast();
          await sendMsg(cid, '📢 <b>Рассылка...</b>');
          const users = await getAllUsers();
          let ok = 0, fail = 0;
          for (const uid of users) {
            try { const r = await copyMsg(Number(uid), cid, msg.message_id); r?.ok ? ok++ : fail++; } catch { fail++; }
            await new Promise(r => setTimeout(r, 50));
          }
          await sendMsg(cid, `✅ <b>Рассылка завершена!</b>\n\n📨 Отправлено: ${ok}\n❌ Ошибки: ${fail}\n👥 Всего: ${users.length}`);
          return res.status(200).json({ ok: true });
        }
      }

      // /start
      if (text === '/start') {
        await sendMsg(cid,
          `👋 <b>Привет${fn ? ', ' + fn : ''}!</b>\n\n🎬 Я скачиваю <b>Reels из Instagram</b>!\n\n📎 Отправь ссылку на Reels.\n\n💡 <b>Примеры:</b>\n• instagram.com/reel/...\n• instagram.com/p/...\n\n📖 /help — команды`,
          { reply_markup: { inline_keyboard: [[{ text: '📖 Помощь', callback_data: 'help' }]] } }
        );
        if (cid !== ADMIN_ID) await sendMsg(ADMIN_ID, `🆕 <b>Новый пользователь!</b>\n👤 ${fn} ${un ? '(@' + un + ')' : ''}\n🆔 <code>${cid}</code>`);
        return res.status(200).json({ ok: true });
      }

      if (text === '/help') {
        let h = '📖 <b>Справка</b>\n\n🎬 Отправьте ссылку на Instagram Reels.\n\n<b>Команды:</b>\n/start — Начать\n/help — Справка\n';
        if (cid === ADMIN_ID) h += '\n<b>🔧 Админ:</b>\n/broadcast — Рассылка\n/cancel — Отмена\n/stats — Статистика\n';
        await sendMsg(cid, h);
        return res.status(200).json({ ok: true });
      }

      if (text === '/broadcast' && cid === ADMIN_ID) {
        await setBroadcast('waiting');
        await sendMsg(cid, '📢 <b>Режим рассылки!</b>\n\n📝 Отправьте контент (текст/фото/видео).\n\n⏱ 5 мин\n❌ /cancel — отмена');
        return res.status(200).json({ ok: true });
      }

      if (text === '/cancel' && cid === ADMIN_ID) {
        await delBroadcast();
        await sendMsg(cid, '❌ Отменено.');
        return res.status(200).json({ ok: true });
      }

      if (text === '/stats' && cid === ADMIN_ID) {
        const uc = await getUserCount();
        const dl = await getStat('downloads');
        const fl = await getStat('failed');
        await sendMsg(cid, `📊 <b>Статистика</b>\n\n👥 Пользователей: <b>${uc}</b>\n✅ Загрузок: <b>${dl}</b>\n❌ Неудач: <b>${fl}</b>\n🔌 SOCKS5: ${socksAgent ? '✅' : '❌'}\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
        return res.status(200).json({ ok: true });
      }

      // Instagram link
      const igUrl = extractIgUrl(text);
      if (igUrl) {
        await sendAction(cid);
        await sendMsg(cid, '⏳ <b>Скачиваю видео...</b>\n\nПробую несколько способов...');

        const videoUrl = await downloadReel(igUrl);

        if (videoUrl) {
          await sendAction(cid);
          await sendVideo(cid, videoUrl);
          await incStat('downloads');
        } else {
          await incStat('failed');
          await sendMsg(cid, '❌ <b>Не удалось скачать.</b>\n\n• 🔒 Приватный аккаунт\n• 🔗 Неверная ссылка\n• ⏱ Ограничения Instagram\n• 🗑 Удалено\n\n💡 Попробуйте позже.');
        }
        return res.status(200).json({ ok: true });
      }

      if (text && !text.startsWith('/')) await sendMsg(cid, '🔗 Отправьте ссылку на <b>Instagram Reels</b>.\n\n💡 Пример: <code>https://www.instagram.com/reel/ABC123/</code>');
      else if (text?.startsWith('/')) await sendMsg(cid, '❓ Неизвестная команда. /help');
    }

    if (upd.callback_query) {
      const cb = upd.callback_query;
      if (cb.data === 'help') {
        await sendMsg(cb.message.chat.id, '📖 <b>Справка</b>\n\n🎬 Отправьте ссылку на Instagram Reels.\n\n/start — Начать\n/help — Справка');
        await tg('answerCallbackQuery', { callback_query_id: cb.id });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[webhook]', e);
    return res.status(200).json({ ok: true });
  }
}
