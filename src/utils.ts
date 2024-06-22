import { MyContext, MyMessage } from './types';
import { 
  TRIAL_ENDED_ERROR,
 } from './config';
import { 
  ensureUserSettingsAndRetrieveOpenAi,
} from './openAIFunctions';
import { UserData } from './types';
import { truncateString } from './encodingUtils';

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

class NoOpenAiApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoOpenAiApiKeyError';
  }
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

const THRESHOLD_TO_TRUNK_MESSGES_FOR_CONSOLE = 100; // Length threshold for strings

export function processAndTruncateMessages(messages: MyMessage[], threshold: number = THRESHOLD_TO_TRUNK_MESSGES_FOR_CONSOLE): MyMessage[] {
  return messages.map((message) => {
    // Deep clone the message object to avoid mutating the original
    const newMessage = JSON.parse(JSON.stringify(message));
  
    if (typeof newMessage.content === 'string') {
      // Truncate the content if it's a string
      newMessage.content = truncateString(newMessage.content, threshold);
    } else if (Array.isArray(newMessage.content)) {
      // Iterate through content array and truncate strings
      // @ts-ignore
      newMessage.content = newMessage.content.map((item) => {
        if (item.type === 'text' && item.text) {
          // Truncate text content
          item.text = truncateString(item.text, threshold);
        } else if (item.type === 'image_url' && item.image_url && item.image_url.url) {
          // Truncate image URL
          item.image_url.url = truncateString(item.image_url.url, threshold);
        }
        return item;
      });
    }
    return newMessage;
  });
}
