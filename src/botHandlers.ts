import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { MyContext, User } from './types';
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
} from './config';
import { processMessage, processVoiceMessage } from './messageHandlers';
import { toLogFormat, getMessageBufferKey } from './utils';
import { pineconeIndex } from './vectorDatabase';

// Create a map to store the message buffers
const messageBuffers = new Map();

export function setupBotHandlers(bot: Telegraf<MyContext>) {
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
    ctx.reply(helpString);
  });

  bot.command('reset', (ctx: MyContext) => {
    console.log(toLogFormat(ctx, `/reset command received`));
    if (ctx.chat && ctx.chat.id) {
      deactivateMessagesByChatId(ctx.chat.id);
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }
    console.log(toLogFormat(ctx, `messages deleted from database`));
    ctx.reply(RESET_MESSAGE);
    saveCommandToDB(ctx, 'reset');
  });

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
}
