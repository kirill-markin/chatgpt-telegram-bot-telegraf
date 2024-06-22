import { MyContext } from '../types';

import { 
  getUserSettingsAndOpenAi,
} from '../openAIFunctions';
import { UserData } from '../types';


export const formatLogMessage = (ctx: MyContext, logMessage: string) => {
  const chat_id = ctx.chat?.id;
  const username = ctx.from?.username || ctx.from?.id;
  return `Chat: ${chat_id}, User: ${username}: ${logMessage}`;
}

export async function fetchUserDataOrReplyWithError(ctx: MyContext): Promise<UserData> {
  try {
    const userData = await getUserSettingsAndOpenAi(ctx);
    return userData;
  } catch (e) {
    throw e;
  }
}
