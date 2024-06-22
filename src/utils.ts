import { MyContext, MyMessage } from './types';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { 
  NO_ANSWER_ERROR,
  TRIAL_ENDED_ERROR,
 } from './config';
import { 
  ensureUserSettingsAndRetrieveOpenAi,
} from './openAIFunctions';
import { UserData } from './types';

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

export function encodeText(text: string, model: TiktokenModel = 'gpt-3.5-turbo'): Uint32Array {
  // Ensure text is a string
  if (typeof text !== 'string') {
    throw new TypeError('Expected text to be a string');
  }
  const encoder = encoding_for_model(model);
  const tokens = encoder.encode(text);
  encoder.free(); // Free the encoder when done
  return tokens;
}

export function decodeTokens(tokens: Uint32Array, model: TiktokenModel = 'gpt-3.5-turbo'): string {
  const encoder = encoding_for_model(model);
  const text = encoder.decode(tokens);
  encoder.free(); // Free the encoder when done
  return new TextDecoder().decode(text);
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

function truncateString(str: string, threshold: number): string {
  if (str.length <= threshold) return str;
  const start = str.slice(0, threshold / 2);
  const end = str.slice(-threshold / 2);
  return `${start}... [truncated] ...${end}`;
}

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
