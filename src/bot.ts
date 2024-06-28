import { Telegraf } from "telegraf";
import { MyContext } from './types';
import { TELEGRAM_BOT_TOKEN, CHAT_GPT_DEFAULT_TIMEOUT_MS } from './config';
import { setupDatabase } from './database/databaseInit';
import { initializeBotHandlers } from './botHandlers';
import express from "express";
import axios from 'axios';

let bot: Telegraf<MyContext> | undefined;

// Telegram bot
bot = new Telegraf<MyContext>(TELEGRAM_BOT_TOKEN, { handlerTimeout: CHAT_GPT_DEFAULT_TIMEOUT_MS * 6 });

bot.telegram.getMe().then((botInfo) => {
  bot!.context.botUsername = botInfo.username; // Store the bot username in context
});

async function clearPendingUpdates() {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`);
    const updateIds = response.data.result.map((update: any) => update.update_id);
    if (updateIds.length > 0) {
      const lastUpdateId = Math.max(...updateIds);
      await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`);
      console.log(`Cleared ${updateIds.length} pending updates.`);
    } else {
      console.log('No pending updates to clear.');
    }
  } catch (error) {
    console.error('Failed to clear pending updates:', error);
  }
}

bot.use(async (ctx: MyContext, next) => {
  const start = new Date();
  let isNextDone = false;
  const stopSignal = () => isNextDone;

  await next();
  isNextDone = true;

  const ms = new Date().getTime() - start.getTime();
  console.log(`message processed. Response time: ${ms / 1000} seconds.`);
});

// Attach handlers
initializeBotHandlers(bot);

const startBot = async () => {
  await setupDatabase();
  console.log('Database initialization complete. Starting bot...');

  // DEBUG: Needed in case the bot was stopped while there were pending updates
  // await clearPendingUpdates();

  bot!.launch();
  console.log('Bot started');

  // Create an Express server for health check
  const app = express();

  app.get("/health", (req, res) => {
    res.send("OK");
  });

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
  });
};

startBot().catch(err => {
  console.error('Failed to start the bot', err);
});

export default bot;
