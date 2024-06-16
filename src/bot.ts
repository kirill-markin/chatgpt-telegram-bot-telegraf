import fs from "fs";
import axios from 'axios';
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import { sendLongMessage, toLogFormat, getMessageBufferKey } from './utils';
import { MyContext, MyMessage, User, Event, UserData } from './types';
import { 
  selectMessagesByChatIdGPTformat, 
  insertMessage, 
  insertUserOrUpdate, 
  insertEvent, 
  deactivateMessagesByChatId,
  insertEventSimple,
  insertEventViaMessageType,
  insertModelTranscriptionEvent,
  saveCommandToDB,
  saveAnswerToDB,
} from './database';
import {
  RESET_MESSAGE,
  TRIAL_ENDED_ERROR,
  NO_PHOTO_ERROR,
  NO_VIDEO_ERROR,
  NO_ANSWER_ERROR,
  helpString,
  errorString,
  timeoutMsDefaultchatGPT,
  TELEGRAM_BOT_TOKEN,
} from './config';
import { 
  ensureUserSettingsAndRetrieveOpenAi, 
  createChatCompletionWithRetryReduceHistoryLongtermMemory, 
  createTranscriptionWithRetry 
} from './openAIFunctions';
import { initializeDatabase } from './databaseInit';

// Connect to databases
import { pool } from './database';
import { pineconeIndex } from './vectorDatabase';

let bot: Telegraf | undefined;

// Create a map to store the message buffers

const messageBuffers = new Map();


// Function to handle the response sending logic
async function handleResponseSending(ctx: MyContext, chatResponse: any) {
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

async function getUserDataOrReplyWithError(ctx: MyContext): Promise<UserData | null> {
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

async function processUserMessageAndRespond(
  ctx: MyContext, 
  messageContent: string, 
  userData: UserData, 
  pineconeIndex: any // Replace 'any' with the actual type if you have one
) {
  // Save the transcription to the database
  if (ctx.chat && ctx.chat.id) {
    await insertMessage({
      role: "user",
      content: messageContent,
      chat_id: ctx.chat.id,
      user_id: ctx.from?.id || null,
    });
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }

  // Download all related messages from the database
  let messages: MyMessage[] = await selectMessagesByChatIdGPTformat(ctx);

  // DEBUG: messages to console in a pretty format JSON with newlines
  // console.log(JSON.stringify(messages, null, 2));

  // Send this text to OpenAI's Chat GPT model with retry logic
  const chatResponse: any = await createChatCompletionWithRetryReduceHistoryLongtermMemory(
    ctx,
    messages,
    userData.openai,
    pineconeIndex,
  );
  console.log(toLogFormat(ctx, `chatGPT response received`));

  // Save the answer to the database
  saveAnswerToDB(chatResponse, ctx, userData);

  // Handle response sending
  await handleResponseSending(ctx, chatResponse);

  return chatResponse;
}

async function convertOgaToMp3(fileId: string) {
  const inputFilePath = `./${fileId}.oga`;
  const outputFilePath = `./${fileId}.mp3`;

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-i', inputFilePath, outputFilePath], (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(outputFilePath);
      }
    });
  });
}

async function processMessage(ctx: MyContext, messageContent: string, eventType: string, messageType: string, pineconeIndex: any) {
  console.log(toLogFormat(ctx, `new ${messageType} message received`));
  
  try {
    const userData = await getUserDataOrReplyWithError(ctx);
    if (!userData) return;
    insertEventViaMessageType(ctx, eventType, messageType, messageContent);
    console.log(toLogFormat(ctx, `new ${messageType} message saved to the events table`));

    await processUserMessageAndRespond(ctx, messageContent, userData, pineconeIndex);

  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

async function processVoiceMessage(ctx: MyContext, pineconeIndex: any) {
  try {
    const userData = await getUserDataOrReplyWithError(ctx);
    if (!userData) return;

    const fileId = ctx.message?.voice?.file_id || null;
    if (!fileId) {
      throw new Error("ctx.message.voice.file_id is undefined");
    }

    // Download the file
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({ url: url.toString(), responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(`./${fileId}.oga`))
        .on('error', reject)
        .on('finish', resolve);
    });
    console.log(toLogFormat(ctx, "voice file downloaded"));

    // Convert the file to mp3
    await convertOgaToMp3(fileId);
    console.log(toLogFormat(ctx, "voice file converted"));

    // Send the file to the OpenAI API for transcription
    const transcription = await createTranscriptionWithRetry(fs.createReadStream(`./${fileId}.mp3`), userData.openai);
    const transcriptionText = transcription.text;
    console.log(toLogFormat(ctx, "voice transcription received"));

    // Save the transcription event to the database
    insertModelTranscriptionEvent(ctx, transcriptionText, userData);
    console.log(toLogFormat(ctx, `new voice transcription saved to the database`));

    // Delete both audio files
    fs.unlink(`./${fileId}.oga`, (err) => { if (err) console.error(err); });
    fs.unlink(`./${fileId}.mp3`, (err) => { if (err) console.error(err); });
    console.log(toLogFormat(ctx, "voice processing finished"));

    // Process the transcribed message
    await processMessage(ctx, transcriptionText, 'user_message', 'voice', pineconeIndex);

  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}


// Telegram bot

bot = new Telegraf(TELEGRAM_BOT_TOKEN, {handlerTimeout: timeoutMsDefaultchatGPT*6});

bot.telegram.getMe().then((botInfo) => {
  bot.options.username = botInfo.username;
})

const waitAndLog = async (stopSignal: any, func: any) => {
  while (!stopSignal()) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      func();
    } catch (error) {
      console.error(error);
    }
  }
};

bot.use(async (ctx: MyContext, next) => {
  const start = new Date();

  let isNextDone = false;
  const stopSignal = () => isNextDone;

  // Start waiting and logging in parallel
  let sendChatActionTyping = async () => {};
  let chatId: number = -1;
  if (ctx.chat && ctx.chat.id) {
    chatId = ctx.chat.id;
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }

  if (chatId !== -1) {
    sendChatActionTyping = async () => {
      try {
        await ctx.telegram.sendChatAction(chatId, 'typing');
      } catch (error) {
        if (error.response && error.response.error_code === 403) {
          console.log(`User ${chatId} has blocked the bot.`);
        } else {
          console.error('Unexpected error:', error);
        }
      }
    };
  }

  const waitPromise = waitAndLog(stopSignal, sendChatActionTyping);

  // Wait for next() to complete
  await next();
  isNextDone = true;

  // Wait for waitAndLog to finish
  await waitPromise;

  const ms = new Date().getTime() - start.getTime();
  console.log(toLogFormat(ctx, `message processed. Response time: ${ms / 1000} seconds.`));
});

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
  ctx.reply(helpString)
});

bot.command('reset', (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `/reset command received`));
  if (ctx.chat && ctx.chat.id) {
    deactivateMessagesByChatId(ctx.chat.id);
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }
  console.log(toLogFormat(ctx, `messages deleted from database`));
  ctx.reply(RESET_MESSAGE)
  saveCommandToDB(ctx, 'reset');
});

// TODO: update user settings and openAIKey
// bot.command('settings', (ctx: MyContext) => {
//   ctx.state.command = { raw: '/settings' };
//   console.log(ctx)
//   console.log(toLogFormat(ctx, `/settings command received`));
  
//   saveCommandToDB(ctx, 'settings');
// });

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


const startBot = async () => {
  await initializeDatabase();
  console.log('Database initialization complete. Starting bot...');

  bot.launch();
  console.log('Bot started');
};

startBot().catch(err => {
  console.error('Failed to start the bot', err);
});

export default bot;
