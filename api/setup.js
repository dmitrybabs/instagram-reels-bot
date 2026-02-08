// Setup webhook URL for the Telegram bot
// Visit: https://your-domain.vercel.app/api/setup to configure

const BOT_TOKEN = process.env.BOT_TOKEN || '';

export default async function handler(req, res) {
  if (!BOT_TOKEN) {
    return res.status(400).json({
      ok: false,
      error: 'BOT_TOKEN environment variable is not set',
      instructions: [
        '1. Go to your Vercel project settings',
        '2. Navigate to Environment Variables',
        '3. Add BOT_TOKEN with your Telegram bot token',
        '4. Redeploy the project',
        '5. Visit this URL again'
      ]
    });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = `${protocol}://${host}/api/webhook`;

  try {
    // Set webhook
    const setResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      }),
    });

    const setResult = await setResponse.json();

    // Get webhook info
    const infoResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const infoResult = await infoResponse.json();

    // Set bot commands
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: 'Начать работу с ботом' },
          { command: 'help', description: 'Справка' },
        ]
      }),
    });

    // Set admin commands
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: 'Начать работу с ботом' },
          { command: 'help', description: 'Справка' },
          { command: 'broadcast', description: 'Рассылка сообщений' },
          { command: 'cancel', description: 'Отменить рассылку' },
          { command: 'stats', description: 'Статистика бота' },
        ],
        scope: { type: 'chat', chat_id: 706357294 }
      }),
    });

    return res.status(200).json({
      ok: true,
      message: 'Webhook configured successfully!',
      webhookUrl: webhookUrl,
      setWebhookResult: setResult,
      webhookInfo: infoResult,
      botCommands: 'Commands set successfully',
      nextSteps: [
        '1. Open your Telegram bot',
        '2. Send /start to test',
        '3. Send an Instagram Reels link to download',
      ]
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
