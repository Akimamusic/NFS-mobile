const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Redis } = require('@upstash/redis');

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; 
const CHANNEL_ID = process.env.CHANNEL_ID;         
const BOT_USERNAME = process.env.BOT_USERNAME;    

const bot = new TelegramBot(TOKEN);
const redis = Redis.fromEnv(); // Автоматическое подключение к Upstash Redis через переменные Vercel

const WEBHOOK_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/server`;
if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    bot.setWebHook(WEBHOOK_URL);
}

const categoryTags = {
  auto: "Авторынок",
  realty: "Недвижимость",
  business: "Бизнес",
  skins: "Скины_Аксессуары",
  numbers: "Номер_Сим",
  other: "Прочее"
};

// ================= АДМИН-КОМАНДЫ ДЛЯ НАСТРОЙКИ СЕРВЕРОВ (1-9) =================

bot.onText(/\/setpay (\d+) (.+)/, async (msg, match) => {
  const serverNum = match[1];
  const nick = match[2].trim();

  if (serverNum < 1 || serverNum > 9) {
    return bot.sendMessage(msg.chat.id, '❌ Номер сервера должен быть от 1 до 9.');
  }

  await redis.hset('server_cashiers', { [serverNum]: nick });
  bot.sendMessage(msg.chat.id, `✅ Ник кассира для <b>Сервера #${serverNum}</b> успешно установлен: <code>${nick}</code>`, { parse_mode: 'HTML' });
});

bot.onText(/\/setadmin (\d+) (\d+)/, async (msg, match) => {
  const serverNum = match[1];
  const adminId = match[2].trim();

  if (serverNum < 1 || serverNum > 9) {
    return bot.sendMessage(msg.chat.id, '❌ Номер сервера должен быть от 1 до 9.');
  }

  await redis.hset('server_admins', { [serverNum]: adminId });
  bot.sendMessage(msg.chat.id, `✅ Ответственный админ для <b>Сервера #${serverNum}</b> назначен (Telegram ID: <code>${adminId}</code>)`, { parse_mode: 'HTML' });
});

bot.onText(/\/settings_info/, async (msg) => {
  const cashiers = await redis.hgetall('server_cashiers') || {};
  const admins = await redis.hgetall('server_admins') || {};

  let text = "⚙️ <b>Статус по серверам (1-9):</b>\n\n<b>Ники кассиров:</b>\n";
  for (let s = 1; s <= 9; s++) {
    text += `Сервер #${s}: <code>${cashiers[s] || 'не задан'}</code>\n`;
  }
  text += "\n<b>Ответственные админы (ID):</b>\n";
  for (let s = 1; s <= 9; s++) {
    text += `Сервер #${s}: <code>${admins[s] || 'общий чат'}</code>\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

// ================= API ДЛЯ ФРОНТЕНДА =================

// Получение списка всех товаров
app.get('/api/products', async (req, res) => {
  try {
    const products = await redis.get('products') || [];
    res.json(products);
  } catch (err) {
    console.error('Fetch products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Получение профиля пользователя
app.get('/api/profile/:tgId', async (req, res) => {
  try {
    const tgId = req.params.tgId;
    const defaultName = req.query.defaultName || 'Игрок';
    let profile = await redis.get(`profile:${tgId}`);
    
    if (!profile) {
      profile = { tgId, site_nick: defaultName, game_nick: '', game_phone: '', ar_coins: 0 };
      await redis.set(`profile:${tgId}`, profile);
    }
    res.json(profile);
  } catch (err) {
    console.error('Fetch profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Сохранение профиля
app.post('/api/profile', async (req, res) => {
  try {
    const { tgId, siteNick, gameNick, gamePhone, arCoins, hasTg, tgLink, hasVk, vkLink, discord } = req.body;
    let profile = await redis.get(`profile:${tgId}`) || { tgId };

    if (siteNick !== undefined) profile.site_nick = siteNick;
    if (gameNick !== undefined) profile.game_nick = gameNick;
    if (gamePhone !== undefined) profile.game_phone = gamePhone;
    if (arCoins !== undefined) profile.ar_coins = arCoins;
    if (hasTg !== undefined) profile.has_tg = hasTg;
    if (tgLink !== undefined) profile.tg_link = tgLink;
    if (hasVk !== undefined) profile.has_vk = hasVk;
    if (vkLink !== undefined) profile.vk_link = vkLink;
    if (discord !== undefined) profile.discord = discord;

    await redis.set(`profile:${tgId}`, profile);
    res.json({ success: true, profile });
  } catch (err) {
    console.error('Save profile error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// Публикация нового товара (с поддержкой VIP и отправкой в канал/админ-чат)
app.post('/api/products', async (req, res) => {
  try {
    const product = req.body;
    if (!product.id) {
        product.id = Date.now();
    }
    
    const catTag = categoryTags[product.category] || "Прочее";
    const isVip = product.isVip;
    const isUrgent = product.isUrgent;

    let badgeText = `#${catTag} #Сервер${product.server} #РусьАвито`;
    if (isVip) badgeText = `👑 <b>VIP ОБЪЯВЛЕНИЕ</b>\n` + badgeText;
    else if (isUrgent) badgeText = `🔥 <b>СРОЧНО</b>\n` + badgeText;

    // 1. Пост в публичный канал
    const channelMessageText = 
      `${isVip ? '👑 <b>VIP-ОБЪЯВЛЕНИЕ!</b>' : '🔥 <b>Новое объявление!</b>'}\n\n` +
      `🚗 <b>${product.title}</b>\n` +
      `💰 Цена: <b>${product.price}</b>\n\n` +
      badgeText + '\n' +
      (product.desc ? `📝 <i>${product.desc.substring(0, 80)}...</i>` : '');

    await bot.sendMessage(CHANNEL_ID, channelMessageText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Посмотреть объявление', url: `https://t.me/${BOT_USERNAME}/app?startapp=prod_${product.id}` }]
        ]
      }
    });

    // 2. Карточка модерации в админ-чат
    const adminMessageText = 
      `🛡️ <b>Новый лот на модерации</b> ${isVip ? '(👑 VIP)' : ''}\n\n` +
      `📌 <b>Категория:</b> #${catTag}\n` +
      `🚗 <b>Название:</b> ${product.title}\n` +
      `💰 <b>Цена:</b> ${product.price}\n` +
      `📍 <b>Сервер:</b> #${product.server}\n` +
      `👤 <b>Продавец:</b> ${product.seller.siteNick} (Игровой: <code>${product.seller.nick}</code>)\n` +
      `🆔 <b>Sell_ID:</b> <code>${product.id}</code>`;

    await bot.sendMessage(ADMIN_CHAT_ID, adminMessageText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Посмотреть лот', url: `https://t.me/${BOT_USERNAME}/app?startapp=prod_${product.id}` }],
          [{ text: '❌ Удалить (Скам)', callback_data: `delete_scam_${product.id}` }]
        ]
      }
    });

    // Сохранение в базу Redis
    let products = await redis.get('products') || [];
    products.unshift(product);
    await redis.set('products', products);

    res.json({ success: true, productId: product.id });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to publish product' });
  }
});

// Удаление объявления автором
app.delete('/api/products/:id', async (req, res) => {
  try {
    const productId = Number(req.params.id);
    let products = await redis.get('products') || [];
    products = products.filter(p => p.id !== productId);
    await redis.set('products', products);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Запрос на пополнение в админ-чат
app.post('/api/topup/request', async (req, res) => {
  try {
    const { tgId, coins, rubles, userNick, server } = req.body;
    const serverNum = server || '1';
    const admins = await redis.hgetall('server_admins') || {};
    const responsibleAdminId = admins[serverNum];

    let adminMessageText = 
      `🔔 <b>Новая заявка на пополнение!</b>\n\n` +
      `📍 Сервер: <b>#${serverNum}</b>\n` +
      `👤 Пользователь ID: <code>${tgId}</code>\n` +
      `🎮 Игровой ник: <b>${userNick}</b>\n` +
      `💎 Сумма: <b>${coins} AR</b> (${rubles.toLocaleString('ru-RU')} ₽)`;

    if (responsibleAdminId) {
      adminMessageText += `\n🎯 Ответственный: <a href="tg://user?id=${responsibleAdminId}">Админ #${serverNum}</a>`;
    }

    await bot.sendMessage(ADMIN_CHAT_ID, adminMessageText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Разрешить оплату', callback_data: `approve_topup_${tgId}_${coins}_${serverNum}` }],
          [{ text: '❌ Отклонить', callback_data: `reject_topup_${tgId}` }]
        ]
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Topup error:', err);
    res.status(500).json({ error: 'Failed to send topup request' });
  }
});

// Обработка нажатий кнопок в админ-чате
app.post('/api/server', async (req, res) => {
  try {
    const update = req.body;

    if (update.callback_query) {
      const query = update.callback_query;
      const data = query.data;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;

      // 1. Удаление скама
      if (data.startsWith('delete_scam_')) {
        const productId = Number(data.replace('delete_scam_', ''));
        
        let products = await redis.get('products') || [];
        products = products.filter(p => p.id !== productId);
        await redis.set('products', products);

        await bot.editMessageText(`❌ <b>Объявление отклонено / удалено как Скам!</b> (ID: ${productId})`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });

        await bot.answerCallbackQuery(query.id, { text: '✅ Лот успешно удален!' });
      }

      // 2. Одобрение пополнения AR Coins
      if (data.startsWith('approve_topup_')) {
        const parts = data.split('_');
        const userId = Number(parts[2]);
        const coins = Number(parts[3]);
        const serverNum = parts[4] || '1';

        const cashiers = await redis.hgetall('server_cashiers') || {};
        const cashierNick = cashiers[serverNum] || 'уточните у администратора';

        let profile = await redis.get(`profile:${userId}`) || { tgId: userId, ar_coins: 0 };
        profile.ar_coins = (profile.ar_coins || 0) + coins;
        await redis.set(`profile:${userId}`, profile);

        await bot.editMessageText(`✅ Пополнение для ID <code>${userId}</code> на <b>${coins} AR</b> (Сервер #${serverNum}) одобрено. Зачислено на баланс!`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });

        await bot.sendMessage(userId, 
          `🎉 Администратор подтвердил вашу заявку!\n\n` +
          `📍 Сервер: <b>#${serverNum}</b>\n` +
          `💳 Переведите указанную сумму в игре на ник кассира: <b>${cashierNick}</b>\n` +
          `💎 Вам зачислено <b>${coins} AR Coins</b> в кошелек!`, 
          { parse_mode: 'HTML' }
        );

        await bot.answerCallbackQuery(query.id, { text: 'Пополнение одобрено и монеты зачислены!' });
      }

      // 3. Отклонение пополнения
      if (data.startsWith('reject_topup_')) {
        const userId = Number(data.replace('reject_topup_', ''));

        await bot.editMessageText(`❌ Заявка на пополнение для ID <code>${userId}</code> отклонена.`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });

        await bot.sendMessage(userId, '❌ Администратор отклонил вашу заявку на пополнение.');
        await bot.answerCallbackQuery(query.id, { text: 'Заявка отклонена' });
      }
    }

    bot.processUpdate(update);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error');
  }
});

module.exports = app;
