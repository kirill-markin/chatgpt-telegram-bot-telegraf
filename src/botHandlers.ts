import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { MyContext, User } from './types';
import { 
  upsertUserIfNotExists, 
  disableMessagesByChatId,
  storeCommand,
} from './database/database';
import {
  RESET_MESSAGE,
  HELP_MESSAGE,
} from './config';
import { handleAnyMessage } from './messageHandlers';
import { formatLogMessage } from './utils/utils';
import { reply } from './utils/responseUtils';

export function initializeBotHandlers(bot: Telegraf<MyContext>) {

  bot.start(async (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, 'start command received'));
    if (ctx.from && ctx.from.id) {
      await upsertUserIfNotExists({
        user_id: ctx.from.id,
        username: ctx.from?.username || null,
        default_language_code: ctx.from.language_code,
        language_code: ctx.from.language_code,
      } as User);
      console.log(formatLogMessage(ctx, 'user saved to the database'));
    } else {
      throw new Error('ctx.from.id is undefined');
    }
    reply(ctx, HELP_MESSAGE, 'help message');
  });

  bot.help((ctx: MyContext) => {
    reply(ctx, HELP_MESSAGE, 'help message');
  });

  bot.command('reset', (ctx: MyContext) => {
    console.log(formatLogMessage(ctx, `/reset command received`));
    if (ctx.chat && ctx.chat.id) {
      disableMessagesByChatId(ctx.chat.id);
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }
    console.log(formatLogMessage(ctx, `messages deleted from database`));
    reply(ctx, RESET_MESSAGE, 'reset message');
    storeCommand(ctx, 'reset');
  });

  bot.on(message('photo'), async (ctx: MyContext) => {
    await handleAnyMessage(ctx, 'photo');
  });

  bot.on(message('video'), async (ctx: MyContext) => {
    await handleAnyMessage(ctx, 'video');
  });

  bot.on(message('sticker'), async (ctx: MyContext) => {
    await handleAnyMessage(ctx, 'sticker');
  });

  bot.on(message('voice'), async (ctx: MyContext) => {
    await handleAnyMessage(ctx, 'voice');
  });

  bot.on(message('text'), async (ctx: MyContext) => {
    await handleAnyMessage(ctx, 'text');
  });

  bot.on(message('document'), async (ctx: MyContext) => {
    await handleAnyMessage(ctx, 'document');
  });

  bot.on(message('audio'), async (ctx: MyContext) => {
    await handleAnyMessage(ctx, 'audio');
  });

}
