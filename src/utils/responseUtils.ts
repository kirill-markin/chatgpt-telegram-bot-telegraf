import { MyContext } from '../types';
import { formatLogMessage } from './utils';
import { NO_ANSWER_ERROR } from '../config';
import { ParseMode } from 'telegraf/types';

const MAX_MESSAGE_LENGTH_TELEGRAM = 4096;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export async function reply(ctx: MyContext, message: string, logTitle: string, logProblemLevel: string = 'error', parse_mode: ParseMode='Markdown'): Promise<void> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt === 1) {
        await ctx.reply(message, {parse_mode});
      } else {
        await ctx.reply(message);
      }
      console.log(formatLogMessage(ctx, `${logTitle} - message sent to user (attempt ${attempt})`));
      return; // Success, exit the function
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.log(formatLogMessage(ctx, `Attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`));
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  // If we get here, all retries failed
  if (logProblemLevel === 'error') {
    console.error(formatLogMessage(ctx, `[ERROR] ${logTitle} - error in sending the message to user after ${MAX_RETRIES} attempts: ${lastError}`));
  } else if (logProblemLevel === 'warn') {
    console.warn(formatLogMessage(ctx, `[WARN] ${logTitle} - error in sending the message to user after ${MAX_RETRIES} attempts: ${lastError}`));
  } else {
    throw new Error(`Invalid logProblemLevel: ${logProblemLevel}`);
  }
}

export async function sendSplitMessage(ctx: MyContext, message: string) {
  if (message.length > MAX_MESSAGE_LENGTH_TELEGRAM) {
    for (let i = 0; i < message.length; i += MAX_MESSAGE_LENGTH_TELEGRAM) {
      const messagePart = message.substring(i, i + MAX_MESSAGE_LENGTH_TELEGRAM);
      await reply(ctx, messagePart, 'long message split');
    }
  } else {
    await reply(ctx, message, 'short message');
  }
}

// Function to handle the response sending logic
export async function sendResponse(ctx: MyContext, chatResponse: any) {
  try {
    let answer = chatResponse?.choices?.[0]?.message?.content ?? NO_ANSWER_ERROR;
    
    // Use the utility function to send the answer, whether it's long or short
    await sendSplitMessage(ctx, answer);
  
    console.log(formatLogMessage(ctx, 'answer sent to the user'));
  } catch (e) {
    console.error(formatLogMessage(ctx, `[ERROR] error in sending the answer to the user: ${e}`));
    // Use the utility function to inform the user of an error in a standardized way
    await sendSplitMessage(ctx, "An error occurred while processing your request. Please try again later.");
  }
}

export async function sendTypingActionPeriodically(ctx: MyContext, intervalMs: number): Promise<() => void> {
  let isTyping = true;

  const sendTyping = async () => {
    while (isTyping) {
      try {
        // @ts-ignore
        await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      } catch (e) {
        console.warn(formatLogMessage(ctx, `[WARN] error in sending the typing action to the user: ${e}`));
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  };

  sendTyping();

  return () => {
    isTyping = false;
  };
}
