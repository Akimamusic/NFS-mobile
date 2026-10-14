const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Redis } = require('@upstash/redis');

const app = express();

// Увеличиваем лимит размера JSON, чтобы картинки в формате Base64 успешно сохранялись без ошибок 413 Payload Too Large
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; 
const CHANNEL_ID = process.env.CHANNEL_ID;         
const BOT_USERNAME = process.env.BOT_USERNAME;    

const bot = new TelegramBot(TOKEN);
const redis = Redis.fromEnv();

const categoryNames = {
  auto: "🏎️ Авторынок",
  realty: "🏰 Недвижимость",
  business: "💎 Бизнес",
  skins: "👕 Скины/Аксессуары",
  numbers: "📞 Номера/Сим",
  other: "📦 Прочее"
};

// ================= ОБРАБОТКА ВЕБХУКА TELEGRAM =================

app.post('/api/server', async (req, res) => {
  try {
    const update = req.body;

    if (update.message && update.message.text) {
      const text = update.message.text.trim();
      const chatId = update.message.chat.id;

      if (text.startsWith('/start')) {
        await bot.sendMessage(chatId, '👋 Бот доски объявлений РусьАвито работает!');
      }

      // Удаление администратором через команду в админ-чате: /delete <ID>
      if (text.startsWith('/delete')) {
        const parts = text.split(/\s+/);
        const productId = Number(parts[1]);

        if (!productId) {
          await bot.sendMessage(chatId, '❌ <b>Ошибка!</b> Укажите ID объявления.\nПример: <code>/delete 171234567890</code>', { parse_mode: 'HTML' });
        } else {
          let products = await redis.get('products') || [];
          const initialLength = products.length;
          products = products.filter(p => Number(p.id) !== productId);

          if (products.length < initialLength) {
            await redis.set('products', products);
            await bot.sendMessage(chatId, `✅ <b>Объявление ID <code>${productId}</code> успешно удалено администратором!</b>`, { parse_mode: 'HTML' });
          } else {
            await bot.sendMessage(chatId, `⚠️ Объявление с ID <code>${productId}</code> не найдено в базе.`, { parse_mode: 'HTML' });
          }
        }
      }
    }

    // Удаление по инлайн-кнопке в админ-чате
    if (update.callback_query) {
      const query = update.callback_query;
      const data = query.data;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;

      if (data.startsWith('delete_prod_')) {
        const productId = Number(data.replace('delete_prod_', ''));
        let products = await redis.get('products') || [];
        products = products.filter(p => Number(p.id) !== productId);
        await redis.set('products', products);

        await bot.editMessageText(`❌ <b>Объявление (ID: <code>${productId}</code>) удалено администратором!</b>`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        });
        await bot.answerCallbackQuery(query.id, { text: 'Удалено!' });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).send('Error');
  }
});

// ================= REST API ДЛЯ ФРОНТЕНДА =================

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
      profile = { 
        tgId, 
        siteNick: req.query.defaultName || 'Игрок', 
        gameNick: '', 
        gamePhone: ''
      };
      await redis.set(`profile:${tgId}`, profile);
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/profile', async (req, res) => {
  try {
    const pData = req.body;
    let profile = await redis.get(`profile:${pData.tgId}`) || {};
    Object.assign(profile, pData);

    await redis.set(`profile:${pData.tgId}`, profile);
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const product = req.body;
    if (!product.id) product.id = Date.now();

    const catName = categoryNames[product.category] || "Прочее";

    // Отправка карточки лота в Админ-чат с кнопкой и ID для удаления
    if (ADMIN_CHAT_ID) {
      await bot.sendMessage(ADMIN_CHAT_ID, 
        `📢 <b>НОВОЕ ОБЪЯВЛЕНИЕ</b>\n\n` +
        `🆔 <b>ID объявления:</b> <code>${product.id}</code>\n` +
        `🚗 <b>Название:</b> ${product.title}\n` +
        `💰 <b>Цена:</b> ${product.price}\n` +
        `📍 <b>Сервер:</b> #${product.server}\n` +
        `📌 <b>Категория:</b> ${catName}\n` +
        `👤 <b>Продавец:</b> ${product.seller.siteNick} (Игровой: <code>${product.seller.nick}</code>, Тел: <code>${product.seller.phone}</code>)\n\n` +
        `📝 <b>Описание:</b> ${product.desc || 'Нет'}\n\n` +
        `⚠️ <i>Удалить лот: <code>/delete ${product.id}</code></i>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Открыть в приложении', url: `https://t.me/${BOT_USERNAME}/app?startapp=prod_${product.id}` }],
              [{ text: '🗑️ Удалить лот', callback_data: `delete_prod_${product.id}` }]
            ]
          }
        }
      );
    }

    // Публикация в публичный канал
    if (CHANNEL_ID) {
      await bot.sendMessage(CHANNEL_ID, 
        `🔥 <b>Новое объявление на РусьАвито!</b>\n\n` +
        `🚗 <b>${product.title}</b>\n` +
        `💰 Цена: <b>${product.price}</b>\n` +
        `📍 Сервер: <b>#${product.server}</b>\n\n` +
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
    }

    let products = await redis.get('products') || [];
    products.unshift(product);
    await redis.set('products', products);

    res.json({ success: true, productId: product.id });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to publish product' });
  }
});

// Удаление продукта через REST (если используется клиентом)
app.delete('/api/products/:id', async (req, res) => {
  try {
    const productId = Number(req.params.id);
    let products = await redis.get('products') || [];
    products = products.filter(p => Number(p.id) !== productId);
    await redis.set('products', products);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = app;
