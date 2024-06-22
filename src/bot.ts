import { Telegraf } from "telegraf";
import { MyContext } from './types';
import { TELEGRAM_BOT_TOKEN, CHAT_GPT_DEFAULT_TIMEOUT_MS } from './config';
import { initializeDatabase } from './database/databaseInit';
import { setupBotHandlers } from './botHandlers';

let bot: Telegraf<MyContext> | undefined;

// Telegram bot
bot = new Telegraf<MyContext>(TELEGRAM_BOT_TOKEN, { handlerTimeout: CHAT_GPT_DEFAULT_TIMEOUT_MS * 6 });

bot.telegram.getMe().then((botInfo) => {
  bot!.context.botUsername = botInfo.username; // Store the bot username in context
});

const waitForAndLog = async (stopSignal: any, func: any) => {
  while (!stopSignal()) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      func();
    } catch (error) {
        console.error(error);
    }
  }
};

bot.use(async (ctx: MyContext, next) => {
  const start = new Date();

  let isNextDone = false;
  const stopSignal = () => isNextDone;

  // Start waiting and logging in parallel
  let sendChatActionTyping = async () => {};
  let chatId: number = -1;
  if (ctx.chat && ctx.chat.id) {
    chatId = ctx.chat.id;
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }

  if (chatId !== -1) {
    sendChatActionTyping = async () => {
      try {
        await ctx.telegram.sendChatAction(chatId, 'typing');
      } catch (error: Error | any) {
        if (error.response && error.response.error_code === 403) {
          console.log(`User ${chatId} has blocked the bot.`);
        } else {
          console.error('Unexpected error:', error);
        }
      }
    };
  }

  const waitPromise = waitForAndLog(stopSignal, sendChatActionTyping);

  // Wait for next() to complete
  await next();
  isNextDone = true;

  // Wait for waitForAndLog to finish
  await waitPromise;

  const ms = new Date().getTime() - start.getTime();
  console.log(`message processed. Response time: ${ms / 1000} seconds.`);
});

// Attach handlers
setupBotHandlers(bot);

const startBot = async () => {
  await initializeDatabase();
  console.log('Database initialization complete. Starting bot...');

  bot!.launch();
  console.log('Bot started');
};

startBot().catch(err => {
  console.error('Failed to start the bot', err);
});

export default bot;
