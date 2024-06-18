import { MyContext } from './types';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { 
  NO_ANSWER_ERROR,
  TRIAL_ENDED_ERROR,
 } from './config';
import { 
  ensureUserSettingsAndRetrieveOpenAi,
} from './openAIFunctions';
import { UserData } from './types';

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

export function encodeText(text: string, model: TiktokenModel = 'gpt-3.5-turbo'): Uint32Array {
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

// Function to handle the response sending logic
export async function handleResponseSending(ctx: MyContext, chatResponse: any) {
  try {
    let answer = chatResponse?.choices?.[0]?.message?.content ?? NO_ANSWER_ERROR;
    
    // Use the utility function to send the answer, whether it's long or short
    await sendLongMessage(ctx, answer);
  
    console.log(toLogFormat(ctx, 'answer sent to the user'));
  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error in sending the answer to the user: ${e}`));
    // Use the utility function to inform the user of an error in a standardized way
    await sendLongMessage(ctx, "An error occurred while processing your request. Please try again later.");
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
