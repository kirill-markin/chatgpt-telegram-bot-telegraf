import { MyContext } from '../types';
import { 
  TRIAL_ENDED_ERROR,
 } from '../config';
import { 
  ensureUserSettingsAndRetrieveOpenAi,
} from '../openAIFunctions';
import { UserData } from '../types';

class NoOpenAiApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoOpenAiApiKeyError';
  }
}

export const toLogFormat = (ctx: MyContext, logMessage: string) => {
  const chat_id = ctx.chat?.id;
  const username = ctx.from?.username || ctx.from?.id;
  return `Chat: ${chat_id}, User: ${username}: ${logMessage}`;
}

export async function getUserDataOrReplyWithError(ctx: MyContext): Promise<UserData | null> {
  try {
    const userData = await ensureUserSettingsAndRetrieveOpenAi(ctx);
    return userData;
  } catch (e) {
    if (e instanceof NoOpenAiApiKeyError) {
      await ctx.reply(TRIAL_ENDED_ERROR);
      return null;
    } else {
      throw e;
    }
  }
}
