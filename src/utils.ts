import { MyContext } from './types';

const MAX_MESSAGE_LENGTH = 4096;

export async function sendLongMessage(ctx: MyContext, message: string) {
  if (message.length > MAX_MESSAGE_LENGTH) {
    for (let i = 0; i < message.length; i += MAX_MESSAGE_LENGTH) {
      const messagePart = message.substring(i, i + MAX_MESSAGE_LENGTH);
      await ctx.reply(messagePart);
    }
  } else {
    await ctx.reply(message);
  }
}

export const toLogFormat = (ctx: MyContext, logMessage: string) => {
  const chat_id = ctx.chat?.id;
  const username = ctx.from?.username || ctx.from?.id;
  return `Chat: ${chat_id}, User: ${username}: ${logMessage}`;
}

export const getMessageBufferKey = (ctx: MyContext) => {
  if (ctx.chat && ctx.from) {
    return `${ctx.chat.id}:${ctx.from.id}`;
  } else {
    throw new Error('ctx.chat.id or ctx.from.id is undefined');
  }
}
