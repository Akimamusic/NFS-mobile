const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Подключение к Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const bot = new TelegramBot(TOKEN);

const WEBHOOK_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/server`;
bot.setWebHook(WEBHOOK_URL);

const categoryNames = {
  auto: "🏎️ Авторынок (Транспорт)",
  realty: "🏰 Недвижимость",
  business: "💎 Бизнес",
  skins: "👕 Скины и Аксессуары",
  numbers: "📞 Сим-карты и Номера",
  other: "📦 Прочее"
};

app.post('/api/server', async (req, res) => {
  try {
    const update = req.body;

    if (update.callback_query) {
      const query = update.callback_query;
      const data = query.data;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;

      // Удаление скам-объявления администратором из канала
      if (data.startsWith('delete_scam_')) {
        const productId = data.replace('delete_scam_', '');
        await supabase.from('products').delete().eq('product_id', Number(productId));

        try {
          await bot.deleteMessage(chatId, messageId);
        } catch (e) {
          console.log('Не удалось удалить сообщение из канала');
        }

        await bot.answerCallbackQuery(query.id, { text: '✅ Объявление удалено как скам!' });
      }

      // Одобрение пополнения в админ-чате
      if (data.startsWith('approve_topup_')) {
        const userId = Number(data.replace('approve_topup_', ''));
        await bot.editMessageText(`✅ Пополнение для ID <code>${userId}</code> одобрено администратором.`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });
        await bot.sendMessage(userId, '🎉 Администратор одобрил пополнение! Переведите средства в игре на указанные реквизиты.');
        await bot.answerCallbackQuery(query.id, { text: 'Одобрено' });
      }
    }

    bot.processUpdate(update);
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

// Создание объявления и отправка в Telegram-канал
app.post('/api/products', async (req, res) => {
  try {
    const { title, category, server, price, priceNum, desc, image, seller } = req.body;
    const productId = Date.now();

    const { error } = await supabase.from('products').insert([
      {
        product_id: productId,
        title,
        category,
        server: Number(server),
        price,
        price_num: Number(priceNum),
        desc,
        image,
        seller_tg_id: seller.tgId,
        seller_site_nick: seller.siteNick,
        seller_nick: seller.nick,
        seller_phone: seller.phone
      }
    ]);

    if (error) throw error;

    const categoryName = categoryNames[category] || '📦 Прочее';
    const messageText = 
      `🔥 <b>Новое объявление!</b>\n\n` +
      `📌 <b>Вид:</b> ${categoryName}\n` +
      `🚗 <b>Название:</b> ${title}\n` +
      `💰 <b>Цена:</b> ${price}\n` +
      `📍 <b>Сервер:</b> #${server}\n\n` +
      `📝 <i>${desc ? desc.substring(0, 90) + '...' : ''}</i>`;

    await bot.sendMessage(CHANNEL_ID, messageText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Посмотреть объявление', url: `https://t.me/your_bot_username/app?startapp=prod_${productId}` }],
          [{ text: '❌ Удалить (Скам)', callback_data: `delete_scam_${productId}` }]
        ]
      }
    });

    res.json({ success: true, productId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Запрос на пополнение кошелька (связь с админ-чатом)
app.post('/api/topup/request', async (req, res) => {
  try {
    const { tgId, coins, rubles, userNick } = req.body;

    await bot.sendMessage(ADMIN_CHAT_ID,
      `🔔 <b>Новая заявка на пополнение!</b>\n\n` +
      `👤 Пользователь ID: <code>${tgId}</code>\n` +
      `🎮 Игровой ник: <b>${userNick}</b>\n` +
      `💎 Сумма: <b>${coins} AR</b> (${rubles.toLocaleString('ru-RU')} ₽)`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Разрешить оплату', callback_data: `approve_topup_${tgId}` }],
            [{ text: '❌ Отклонить', callback_data: `reject_topup_${tgId}` }]
          ]
        }
      }
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send topup request' });
  }
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Бот РусьАвито подключен к Supabase и работает! 🚀');
});

module.exports = app;
