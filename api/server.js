const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; 
const CHANNEL_ID = process.env.CHANNEL_ID;         
const BOT_USERNAME = process.env.BOT_USERNAME;    

const bot = new TelegramBot(TOKEN);

const WEBHOOK_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/server`;
if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    bot.setWebHook(WEBHOOK_URL);
}

// Хранилище в оперативной памяти для ников кассиров и ответственных админов по серверам (1-9)
const serverCashiers = {}; 
const serverAdmins = {};   

const categoryTags = {
  auto: "Авторынок",
  realty: "Недвижимость",
  business: "Бизнес",
  skins: "Скины_Аксессуары",
  numbers: "Номер_Сим",
  other: "Прочее"
};

// ================= АДМИН-КОМАНДЫ ДЛЯ НАСТРОЙКИ СЕРВЕРОВ =================

// Установка ника для платежей: /setpay <сервер> <ник>
bot.onText(/\/setpay (\d+) (.+)/, (msg, match) => {
  const serverNum = match[1];
  const nick = match[2].trim();

  if (serverNum < 1 || serverNum > 9) {
    return bot.sendMessage(msg.chat.id, '❌ Номер сервера должен быть от 1 до 9.');
  }

  serverCashiers[serverNum] = nick;
  bot.sendMessage(msg.chat.id, `✅ Ник кассира для <b>Сервера #${serverNum}</b> успешно установлен: <code>${nick}</code>`, { parse_mode: 'HTML' });
});

// Назначение ответственного админа: /setadmin <сервер> <tg_id>
bot.onText(/\/setadmin (\d+) (\d+)/, (msg, match) => {
  const serverNum = match[1];
  const adminId = match[2].trim();

  if (serverNum < 1 || serverNum > 9) {
    return bot.sendMessage(msg.chat.id, '❌ Номер сервера должен быть от 1 до 9.');
  }

  serverAdmins[serverNum] = adminId;
  bot.sendMessage(msg.chat.id, `✅ Ответственный админ для <b>Сервера #${serverNum}</b> назначен (Telegram ID: <code>${adminId}</code>)`, { parse_mode: 'HTML' });
});

// Посмотреть текущие настройки серверов
bot.onText(/\/settings_info/, (msg) => {
  let text = "⚙️ <b>Статус по серверам (1-9):</b>\n\n<b>Ники кассиров:</b>\n";
  for (let s = 1; s <= 9; s++) {
    text += `Сервер #${s}: <code>${serverCashiers[s] || 'не задан'}</code>\n`;
  }
  text += "\n<b>Ответственные админы (ID):</b>\n";
  for (let s = 1; s <= 9; s++) {
    text += `Сервер #${s}: <code>${serverAdmins[s] || 'общий чат'}</code>\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

// ================= ОБРАБОТКА ВЕБХУКОВ TELEGRAM =================

app.post('/api/server', async (req, res) => {
  try {
    const update = req.body;

    if (update.callback_query) {
      const query = update.callback_query;
      const data = query.data;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;

      // 1. Удаление скам-объявления
      if (data.startsWith('delete_scam_')) {
        const productId = data.replace('delete_scam_', '');

        await bot.editMessageText(`❌ <b>Объявление отклонено / удалено как Скам!</b> (ID: ${productId})`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });

        await bot.answerCallbackQuery(query.id, { text: '✅ Лот успешно удален!' });
      }

      // 2. Одобрение пополнения
      if (data.startsWith('approve_topup_')) {
        const parts = data.split('_');
        const userId = Number(parts[2]);
        const coins = Number(parts[3]);
        const serverNum = parts[4] || '1';

        const cashierNick = serverCashiers[serverNum] || 'уточните у администратора';

        await bot.editMessageText(`✅ Пополнение для ID <code>${userId}</code> на <b>${coins} AR</b> (Сервер #${serverNum}) одобрено. Кассир: <code>${cashierNick}</code>`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });

        // Отправка игроку реквизитов (ника кассира)
        await bot.sendMessage(userId, 
          `🎉 Администратор подтвердил вашу заявку!\n\n` +
          `📍 Сервер: <b>#${serverNum}</b>\n` +
          `💳 Переведите указанную сумму в игре на ник кассира: <b>${cashierNick}</b>\n` +
          `💎 После проверки вам будет зачислено <b>${coins} AR Coins</b>.`, 
          { parse_mode: 'HTML' }
        );

        await bot.answerCallbackQuery(query.id, { text: 'Пополнение одобрено!' });
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

// Публикация нового объявления
app.post('/api/products', async (req, res) => {
  try {
    const { title, category, server, price, desc, seller } = req.body;
    const productId = Date.now();
    const catTag = categoryTags[category] || "Прочее";

    // 1. Пост в публичный канал для подписчиков
    const channelMessageText = 
      `🔥 <b>Новое объявление!</b>\n\n` +
      `🚗 <b>${title}</b>\n` +
      `💰 Цена: <b>${price}</b>\n\n` +
      `#${catTag} #Сервер${server} #РусьАвито\n` +
      (desc ? `📝 <i>${desc.substring(0, 80)}...</i>` : '');

    await bot.sendMessage(CHANNEL_ID, channelMessageText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Посмотреть объявление', url: `https://t.me/${BOT_USERNAME}/app?startapp=prod_${productId}` }]
        ]
      }
    });

    // 2. Карточка модерации в админ-чат
    const adminMessageText = 
      `🛡️ <b>Новый лот на модерации</b>\n\n` +
      `📌 <b>Категория:</b> #${catTag}\n` +
      `🚗 <b>Название:</b> ${title}\n` +
      `💰 <b>Цена:</b> ${price}\n` +
      `📍 <b>Сервер:</b> #${server}\n` +
      `👤 <b>Продавец:</b> ${seller.siteNick} (Игровой: <code>${seller.nick}</code>)\n` +
      `🆔 <b>Sell_ID:</b> <code>${productId}</code>`;

    await bot.sendMessage(ADMIN_CHAT_ID, adminMessageText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Посмотреть лот', url: `https://t.me/${BOT_USERNAME}/app?startapp=prod_${productId}` }],
          [{ text: '❌ Удалить (Скам)', callback_data: `delete_scam_${productId}` }]
        ]
      }
    });

    res.json({ success: true, productId });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to publish product' });
  }
});

// Запрос на пополнение в админ-чат
app.post('/api/topup/request', async (req, res) => {
  try {
    const { tgId, coins, rubles, userNick, server } = req.body;
    const serverNum = server || '1';
    const responsibleAdminId = serverAdmins[serverNum];

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

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Бот управления РусьАвито запущен!');
});

module.exports = app;
