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
const redis = Redis.fromEnv();

const categoryTags = {
  auto: "Авторынок",
  realty: "Недвижимость",
  business: "Бизнес",
  skins: "Скины_Аксессуары",
  numbers: "Номер_Сим",
  other: "Прочее"
};

// ОБРАБОТЧИК ВЕБХУКА TELEGRAM
app.post('/api/server', async (req, res) => {
  try {
    const update = req.body;

    // 1. Текстовые команды
    if (update.message && update.message.text) {
      const text = update.message.text.trim();
      const chatId = update.message.chat.id;
      const lowerText = text.toLowerCase();

      if (lowerText.startsWith('/start')) {
        await bot.sendMessage(chatId, '👋 Бот управления РусьАвито работает!');
      }

      if (lowerText.startsWith('/setpay')) {
        const parts = text.split(/\s+/);
        const serverStr = parts[1] ? parts[1].replace('#', '') : '';
        const nick = parts[2];

        if (!serverStr || !nick || isNaN(serverStr) || Number(serverStr) < 1 || Number(serverStr) > 9) {
          await bot.sendMessage(chatId, '❌ <b>Ошибка!</b> Формат: <code>/setpay 5 VIP_BUY</code>', { parse_mode: 'HTML' });
        } else {
          await redis.hset('server_cashiers', { [serverStr]: nick });
          await bot.sendMessage(chatId, `✅ Ник кассира для <b>Сервера #${serverStr}</b> установлен: <code>${nick}</code>`, { parse_mode: 'HTML' });
        }
      }

      if (lowerText.startsWith('/setadmin')) {
        const parts = text.split(/\s+/);
        const serverStr = parts[1] ? parts[1].replace('#', '') : '';
        const adminId = parts[2];

        if (!serverStr || !adminId || isNaN(serverStr) || Number(serverStr) < 1 || Number(serverStr) > 9) {
          await bot.sendMessage(chatId, '❌ <b>Ошибка!</b> Формат: <code>/setadmin 5 123456789</code>', { parse_mode: 'HTML' });
        } else {
          await redis.hset('server_admins', { [serverStr]: adminId });
          await bot.sendMessage(chatId, `✅ Ответственный админ для <b>Сервера #${serverStr}</b> назначен: <code>${adminId}</code>`, { parse_mode: 'HTML' });
        }
      }

      if (lowerText.startsWith('/settings_info')) {
        const cashiers = await redis.hgetall('server_cashiers') || {};
        const admins = await redis.hgetall('server_admins') || {};

        let infoText = "⚙️ <b>Настройки серверов (1-9):</b>\n\n<b>Кассиры:</b>\n";
        for (let s = 1; s <= 9; s++) {
          infoText += `Сервер #${s}: <code>${cashiers[s] || 'не задан'}</code>\n`;
        }
        infoText += "\n<b>Ответственные админы (ID):</b>\n";
        for (let s = 1; s <= 9; s++) {
          infoText += `Сервер #${s}: <code>${admins[s] || 'общий чат'}</code>\n`;
        }
        await bot.sendMessage(chatId, infoText, { parse_mode: 'HTML' });
      }
    }

    // 2. Инлайн-кнопки
    if (update.callback_query) {
      const query = update.callback_query;
      const data = query.data;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;

      if (data.startsWith('delete_scam_')) {
        const productId = Number(data.replace('delete_scam_', ''));
        let products = await redis.get('products') || [];
        products = products.filter(p => p.id !== productId);
        await redis.set('products', products);

        await bot.editMessageText(`❌ <b>Объявление удалено как Скам!</b> (ID: ${productId})`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });
        await bot.answerCallbackQuery(query.id, { text: 'Удалено!' });
      }

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

        await bot.editMessageText(`✅ Пополнение для ID <code>${userId}</code> на <b>${coins} AR</b> (Сервер #${serverNum}) одобрено!`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });

        await bot.sendMessage(userId, 
          `🎉 Заявка подтверждена!\n\n` +
          `📍 Сервер: <b>#${serverNum}</b>\n` +
          `💳 Переведите сумму в игре на ник кассира: <b>${cashierNick}</b>\n` +
          `💎 Зачислено <b>${coins} AR Coins</b>!`, 
          { parse_mode: 'HTML' }
        );

        await bot.answerCallbackQuery(query.id, { text: 'Одобрено!' });
      }

      if (data.startsWith('reject_topup_')) {
        const userId = Number(data.replace('reject_topup_', ''));
        await bot.editMessageText(`❌ Заявка на пополнение для ID <code>${userId}</code> отклонена.`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });
        await bot.sendMessage(userId, '❌ Администратор отклонил вашу заявку на пополнение.');
        await bot.answerCallbackQuery(query.id, { text: 'Отклонено' });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).send('Error');
  }
});

// REST API ДЛЯ ВЕБ-САЙТА
app.get('/api/products', async (req, res) => {
  try {
    const products = await redis.get('products') || [];
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/profile/:tgId', async (req, res) => {
  try {
    const tgId = req.params.tgId;
    let profile = await redis.get(`profile:${tgId}`);
    if (!profile) {
      profile = { tgId, site_nick: 'Игрок', game_nick: '', game_phone: '', ar_coins: 0 };
      await redis.set(`profile:${tgId}`, profile);
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

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
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const product = req.body;
    if (!product.id) product.id = Date.now();
    
    const catTag = categoryTags[product.category] || "Прочее";
    const isVip = product.isVip;

    let badgeText = `#${catTag} #Сервер${product.server} #РусьАвито`;
    if (isVip) badgeText = `👑 <b>VIP ОБЪЯВЛЕНИЕ</b>\n` + badgeText;

    await bot.sendMessage(CHANNEL_ID, 
      `${isVip ? '👑 <b>VIP-ОБЪЯВЛЕНИЕ!</b>' : '🔥 <b>Новое объявление!</b>'}\n\n` +
      `🚗 <b>${product.title}</b>\n` +
      `💰 Цена: <b>${product.price}</b>\n\n` +
      badgeText + '\n' +
      (product.desc ? `📝 <i>${product.desc.substring(0, 80)}...</i>` : ''),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔍 Посмотреть объявление', url: `https://t.me/${BOT_USERNAME}/app?startapp=prod_${product.id}` }]
          ]
        }
      }
    );

    await bot.sendMessage(ADMIN_CHAT_ID, 
      `🛡️ <b>Новый лот на модерации</b> ${isVip ? '(👑 VIP)' : ''}\n\n` +
      `📌 <b>Категория:</b> #${catTag}\n` +
      `🚗 <b>Название:</b> ${product.title}\n` +
      `💰 <b>Цена:</b> ${product.price}\n` +
      `📍 <b>Сервер:</b> #${product.server}\n` +
      `👤 <b>Продавец:</b> ${product.seller.siteNick} (Игровой: <code>${product.seller.nick}</code>)\n` +
      `🆔 <b>Sell_ID:</b> <code>${product.id}</code>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔍 Посмотреть лот', url: `https://t.me/${BOT_USERNAME}/app?startapp=prod_${product.id}` }],
            [{ text: '❌ Удалить (Скам)', callback_data: `delete_scam_${product.id}` }]
          ]
        }
      }
    );

    let products = await redis.get('products') || [];
    products.unshift(product);
    await redis.set('products', products);

    res.json({ success: true, productId: product.id });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to publish product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const productId = Number(req.params.id);
    let products = await redis.get('products') || [];
    products = products.filter(p => p.id !== productId);
    await redis.set('products', products);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

app.post('/api/topup/request', async (req, res) => {
  try {
    const { tgId, coins, rubles, userNick, server } = req.body;
    const serverNum = server || '1';
    const admins = await redis.hgetall('server_admins') || {};
    const responsibleAdminId = admins[serverNum];

    let adminMessageText = 
      `🔔 <b>Заявка на пополнение!</b>\n\n` +
      `📍 Сервер: <b>#${serverNum}</b>\n` +
      `👤 ID: <code>${tgId}</code>\n` +
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
    res.status(500).json({ error: 'Failed to send topup request' });
  }
});

module.exports = app;
