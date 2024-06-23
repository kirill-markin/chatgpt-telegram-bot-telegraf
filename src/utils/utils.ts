import { MyContext } from '../types';

export const formatLogMessage = (ctx: MyContext, logMessage: string) => {
  const chat_id = ctx.chat?.id;
  const username = ctx.from?.username || "";
  return `chat_id: ${chat_id}, user_id: ${ctx.from?.id}, username: ${username}: ${logMessage}`;
}
