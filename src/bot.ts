import fs from "fs";
import axios from 'axios';
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { 
  toLogFormat, 
  getMessageBufferKey,
 } from './utils';
import { MyContext, MyMessage, User, UserData } from './types';
import { 
  insertUserOrUpdate, 
  deactivateMessagesByChatId,
  insertEventSimple,
  saveCommandToDB,
} from './database';
import {
  RESET_MESSAGE,
  NO_PHOTO_ERROR,
  NO_VIDEO_ERROR,
  helpString,
  timeoutMsDefaultchatGPT,
  TELEGRAM_BOT_TOKEN,
} from './config';
import { initializeDatabase } from './databaseInit';
import { processMessage, processVoiceMessage } from './messageHandlers';

// Connect to databases
import { pool } from './database';
import { pineconeIndex } from './vectorDatabase';

let bot: Telegraf | undefined;

// Create a map to store the message buffers

const messageBuffers = new Map();



// Telegram bot

bot = new Telegraf(TELEGRAM_BOT_TOKEN, {handlerTimeout: timeoutMsDefaultchatGPT*6});

bot.telegram.getMe().then((botInfo) => {
  bot.options.username = botInfo.username;
})

const waitAndLog = async (stopSignal: any, func: any) => {
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
      } catch (error) {
        if (error.response && error.response.error_code === 403) {
          console.log(`User ${chatId} has blocked the bot.`);
        } else {
          console.error('Unexpected error:', error);
        }
      }
    };
  }

  const waitPromise = waitAndLog(stopSignal, sendChatActionTyping);

  // Wait for next() to complete
  await next();
  isNextDone = true;

  // Wait for waitAndLog to finish
  await waitPromise;

  const ms = new Date().getTime() - start.getTime();
  console.log(toLogFormat(ctx, `message processed. Response time: ${ms / 1000} seconds.`));
});

bot.start(async (ctx: MyContext) => {
  console.log(toLogFormat(ctx, 'start command received'));
  if (ctx.from && ctx.from.id) {
    await insertUserOrUpdate({
      user_id: ctx.from.id,
      username: ctx.from?.username || null,
      default_language_code: ctx.from.language_code,
      language_code: ctx.from.language_code,
    } as User);
    console.log(toLogFormat(ctx, 'user saved to the database'));
  } else {
    throw new Error('ctx.from.id is undefined');
  }
  ctx.reply(helpString);
});

bot.help((ctx: MyContext) => {
  ctx.reply(helpString)
});

bot.command('reset', (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `/reset command received`));
  if (ctx.chat && ctx.chat.id) {
    deactivateMessagesByChatId(ctx.chat.id);
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }
  console.log(toLogFormat(ctx, `messages deleted from database`));
  ctx.reply(RESET_MESSAGE)
  saveCommandToDB(ctx, 'reset');
});

// TODO: update user settings and openAIKey
// bot.command('settings', (ctx: MyContext) => {
//   ctx.state.command = { raw: '/settings' };
//   console.log(ctx)
//   console.log(toLogFormat(ctx, `/settings command received`));
  
//   saveCommandToDB(ctx, 'settings');
// });

bot.on(message('photo'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `photo received`));
  ctx.reply(NO_PHOTO_ERROR);
  insertEventSimple(ctx, 'user_message', 'user', 'photo');
});

bot.on(message('video'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `video received`));
  ctx.reply(NO_VIDEO_ERROR);
  insertEventSimple(ctx, 'user_message', 'user', 'video');
});

bot.on(message('sticker'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `sticker received`));
  ctx.reply('👍');
  insertEventSimple(ctx, 'user_message', 'user', 'sticker');
});

bot.on(message('voice'), async (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `[NEW] voice received`));
  processVoiceMessage(ctx, pineconeIndex);
});

bot.on(message('text'), async (ctx: MyContext) => {
  console.log(toLogFormat(ctx, '[NEW] text received'));
  const key = getMessageBufferKey(ctx);
  const messageData = messageBuffers.get(key) || { messages: [], timer: null };

  messageData.messages.push(ctx.message?.text || '');

  // Clear the old timer
  if (messageData.timer) {
    clearTimeout(messageData.timer);
  }

  // Set a new timer
  messageData.timer = setTimeout(async () => {
    const fullMessage = messageData.messages?.join('\n') || '';
    console.log(toLogFormat(ctx, `full message collected. length: ${fullMessage.length}`));
    messageData.messages = []; // Clear the messages array

    await processMessage(ctx, fullMessage, 'user_message', 'text', pineconeIndex);
  }, 4000);

  // Save the message buffer
  messageBuffers.set(key, messageData);
});


const startBot = async () => {
  await initializeDatabase();
  console.log('Database initialization complete. Starting bot...');

  bot.launch();
  console.log('Bot started');
};

startBot().catch(err => {
  console.error('Failed to start the bot', err);
});

export default bot;
