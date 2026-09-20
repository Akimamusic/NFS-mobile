const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// Ключи подтягиваются из защищенных настроек Vercel, а не хранятся в открытом виде
const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const STEAM_API_KEY = process.env.STEAM_API_KEY; // Для парсинга инвентаря или трейд-ботов

const bot = new TelegramBot(TOKEN);

// Указываем Telegram, куда отправлять обновления
// VERCEL_PROJECT_PRODUCTION_URL создается платформой автоматически
const WEBHOOK_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/server`;
bot.setWebHook(WEBHOOK_URL);

// Обработчик Webhook — Vercel будет дергать этот роут при каждом сообщении
app.post('/api/server', (req, res) => {
  bot.processUpdate(req.body);
  res.status(200).send('OK');
});

// Пример простой команды
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Бот успешно запущен на Vercel!');
});

// Обязательный экспорт приложения для того, чтобы Vercel смог его запустить
module.exports = app;
