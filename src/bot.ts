import fs from "fs";
import axios from 'axios';
import pTimeout from 'p-timeout';
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import OpenAI from 'openai';
import { encoding_for_model } from 'tiktoken';
import { Pinecone } from '@pinecone-database/pinecone';
import { usedTokensForUser, selectMessagesByChatIdGPTformat, selectUserByUserId, insertMessage, insertUserOrUpdate, insertEvent, deleteMessagesByChatId, deactivateMessagesByChatId } from './database';
import { sendLongMessage, toLogFormat, getMessageBufferKey } from './utils';
import { MyContext, MyMessage, User, Event, UserData } from './types';
import {
  GPT_MODEL,
  maxTokensThreshold,
  averageAnswerTokens,
  maxTokensThresholdToReduceHistory,
  RESET_MESSAGE,
  NO_OPENAI_KEY_ERROR,
  TRIAL_ENDED_ERROR,
  NO_PHOTO_ERROR,
  NO_VIDEO_ERROR,
  NO_ANSWER_ERROR,
  maxTrialsTokens,
  helpString,
  errorString,
  botSettings,
  defaultPrompt,
  defaultPromptMessage,
  timeoutMsDefaultchatGPT,
} from './config';
import { 
  ensureUserSettingsAndRetrieveOpenAi, 
  createChatCompletionWithRetryReduceHistoryLongtermMemory, 
  createTranscriptionWithRetry 
} from './openAIFunctions';

// Connect to the postgress database
import { pool } from './database';


if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) {
  throw new Error(
    "Please set the TELEGRAM_BOT_TOKEN and OPENAI_API_KEY and DATABASE_URL environment variables"
  );
}


// Connect to the Pinecone database

let pineconeIndex: any = null;

// Check if process.env.PINECONE_API_KEY is a string 
// and process.env.PINECONE_INDEX_NAME is a string and they are not empty
if (
  typeof process.env.PINECONE_API_KEY == 'string' 
  && typeof process.env.PINECONE_INDEX_NAME == 'string' 
  && process.env.PINECONE_API_KEY 
  && process.env.PINECONE_INDEX_NAME
) {
  (async () => {
    try {
      // Initialize the Pinecone client
      const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY as string,
      });

      // Connect to the Pinecone index
      pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME) as string;

      console.log('Pinecone database connected');
    } catch (error) {
      console.error('Error connecting to Pinecone:', error);
    }
  })();
} else {
  console.log('Pinecone database not connected');
}

// Create needed tables if not exists

const createTableQueries = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id bigint UNIQUE NOT NULL,
    username VARCHAR(255),
    default_language_code VARCHAR(255),
    language_code VARCHAR(255),
    openai_api_key VARCHAR(255),
    usage_type VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    role VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    chat_id bigint NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    user_id bigint REFERENCES users(id),
    time TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    time TIMESTAMP NOT NULL,
    type VARCHAR(255) NOT NULL,
  
    user_id bigint,
    user_is_bot BOOLEAN,
    user_language_code VARCHAR(255),
    user_username VARCHAR(255),
  
    chat_id bigint,
    chat_type VARCHAR(255),
  
    message_role VARCHAR(255),
    messages_type VARCHAR(255),
    message_voice_duration INT,
    message_command VARCHAR(255),
    content_length INT,
    
    usage_model VARCHAR(255),
    usage_object VARCHAR(255),
    usage_completion_tokens INT,
    usage_prompt_tokens INT,
    usage_total_tokens INT,
    api_key VARCHAR(255)
  );
  `
]

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

for (const createTableQuery of createTableQueries) {
  pool.query(createTableQuery, (err: Error, res: QueryResult) => {
    if (err) {
      console.error('Error with checking/creating tables', err.stack);
      throw err;
    }
  });
}
console.log('Related tables checked/created successfully');

class NoOpenAiApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoOpenAiApiKeyError';
  }
}


// Save answer to the database to all tables
async function saveAnswerToDB(chatResponse: any, ctx: MyContext, userData: UserData) {
  try {
    // save the answer to the database
    const answer = chatResponse.choices?.[0]?.message?.content || NO_ANSWER_ERROR;
    if (ctx.chat && ctx.chat.id) {
      insertMessage({
        role: "assistant",
        content: answer,
        chat_id: ctx.chat.id,
        user_id: null,
        });
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }
    insertEvent({
      type: 'assistant_message',

      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,

      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,

      message_role: "assistant",
      messages_type: "text",
      message_voice_duration: null,
      message_command: null,
      content_length: answer.length,

      usage_model: chatResponse.model || null,
      usage_object: chatResponse.object || null,
      usage_completion_tokens: chatResponse.usage?.completion_tokens || null,
      usage_prompt_tokens: chatResponse.usage?.prompt_tokens || null,
      usage_total_tokens: chatResponse.usage?.total_tokens || null,
      api_key: userData.openai.apiKey || null,
    } as Event);
    console.log(toLogFormat(ctx, `answer saved to the database. total_tokens: ${chatResponse.usage?.total_tokens || null}`));
  } catch (error) {
    console.log(toLogFormat(ctx, `[ERROR] error in saving the answer to the database: ${error}`));
  }
}

async function saveCommandToDB(ctx: MyContext, command: string) {
  try {
    insertEvent({
      type: 'user_command',

      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,

      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,

      message_role: "user",
      messages_type: "text",
      message_voice_duration: null,
      message_command: command,
      content_length: null,

      usage_model: null,
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: null,
    } as Event);
    console.log(toLogFormat(ctx, `command saved to the database`));
  } catch (error) {
    console.log(toLogFormat(ctx, `[ERROR] error in saving the command to the database: ${error}`));
  }
}


// BOT

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {handlerTimeout: timeoutMsDefaultchatGPT*6});

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

bot.start((ctx: MyContext) => {
  console.log(toLogFormat(ctx, `/start command received`));
  if (ctx.from && ctx.from.id) {
    insertUserOrUpdate({
      user_id: ctx.from.id,
      username: ctx.from?.username || null,
      default_language_code: ctx.from.language_code,
      language_code: ctx.from.language_code,
    } as User);
    console.log(toLogFormat(ctx, `user saved to the database`));
  } else {
    throw new Error(`ctx.from.id is undefined`);
  }
  ctx.reply(helpString)
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

async function processVoiceMessage(ctx: MyContext, pineconeIndex: any) {
  try {
    const userData = await getUserDataOrReplyWithError(ctx);
    if (!userData) return;

    insertEvent({
      type: 'user_message',

      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,

      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,

      message_role: "user",
      messages_type: "voice",
      message_voice_duration: ctx.message?.voice?.duration || null,
      message_command: null,
      content_length: null,

      usage_model: null,
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: null,
    } as Event);

    const fileId = ctx.message?.voice?.file_id || null;
    if (!fileId) {
      throw new Error(`ctx.message.voice.file_id is undefined`);
    }

    // Download the file
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({ url: url.toString(), responseType: 'stream' });

    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(`./${fileId}.oga`))
        .on('error', reject)
        .on('finish', resolve);
    });
    console.log(toLogFormat(ctx, `voice file downloaded`));

    // Convert the file to mp3
    await convertOgaToMp3(fileId);
    console.log(toLogFormat(ctx, `voice file converted`));

    // Send the file to the OpenAI API for transcription
    const transcription = await createTranscriptionWithRetry(fs.createReadStream(`./${fileId}.mp3`), userData.openai);
    const transcriptionText = transcription.text;
    console.log(toLogFormat(ctx, `voice transcription received`));

    // Save the transcription event to the database
    insertEvent({
      type: 'model_transcription',

      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,

      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,

      message_role: null,
      messages_type: null,
      message_voice_duration: null,
      message_command: null,
      content_length: transcriptionText.length,

      usage_model: "whisper-1",
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: userData.openai.apiKey || null,
    } as Event);
    console.log(toLogFormat(ctx, `new voice transcription saved to the database`));

    // Delete both audio files
    fs.unlink(`./${fileId}.oga`, (err) => {
      if (err) {
        console.error(err);
      }
    });
    fs.unlink(`./${fileId}.mp3`, (err) => {
      if (err) {
        console.error(err);
      }
    });
    console.log(toLogFormat(ctx, `voice processing finished`));

    await processUserMessageAndRespond(ctx, transcriptionText, userData, pineconeIndex);
  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

async function processFullTextMessage(ctx: MyContext, fullMessage: string) {
  console.log(toLogFormat(ctx, `new message saved to the database`));
  
  try {
    const userData = await getUserDataOrReplyWithError(ctx);
    if (!userData) return;

    insertEvent({
      type: 'user_message',
  
      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,
  
      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,
  
      message_role: "user",
      messages_type: "text",
      message_voice_duration: null,
      message_command: null,
      content_length: null,
  
      usage_model: null,
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: null,
    } as Event);

    await processUserMessageAndRespond(ctx, fullMessage, userData, pineconeIndex);

  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

bot.on(message('photo'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `photo received`));
  ctx.reply(NO_PHOTO_ERROR);
  insertEvent({
    type: 'user_message',

    user_id: ctx.from?.id || null,
    user_is_bot: ctx.from?.is_bot || null,
    user_language_code: ctx.from?.language_code || null,
    user_username: ctx.from?.username || null,

    chat_id: ctx.chat?.id || null,
    chat_type: ctx.chat?.type || null,

    message_role: "user",
    messages_type: "photo",
    message_voice_duration: null,
    message_command: null,
    content_length: null,

    usage_model: null,
    usage_object: null,
    usage_completion_tokens: null,
    usage_prompt_tokens: null,
    usage_total_tokens: null,
    api_key: null,
  } as Event);
});

bot.on(message('video'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `video received`));
  ctx.reply(NO_VIDEO_ERROR);
  insertEvent({
    type: 'user_message',

    user_id: ctx.from?.id || null,
    user_is_bot: ctx.from?.is_bot || null,
    user_language_code: ctx.from?.language_code || null,
    user_username: ctx.from?.username || null,

    chat_id: ctx.chat?.id || null,
    chat_type: ctx.chat?.type || null,

    message_role: "user",
    messages_type: "video",
    message_voice_duration: null,
    message_command: null,
    content_length: null,

    usage_model: null,
    usage_object: null,
    usage_completion_tokens: null,
    usage_prompt_tokens: null,
    usage_total_tokens: null,
    api_key: null,
  } as Event);
});

bot.on(message('sticker'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `sticker received`));
  ctx.reply('👍');
  insertEvent({
    type: 'user_message',

    user_id: ctx.from?.id || null,
    user_is_bot: ctx.from?.is_bot || null,
    user_language_code: ctx.from?.language_code || null,
    user_username: ctx.from?.username || null,

    chat_id: ctx.chat?.id || null,
    chat_type: ctx.chat?.type || null,

    message_role: "user",
    messages_type: "sticker",
    message_voice_duration: null,
    message_command: null,
    content_length: null,

    usage_model: null,
    usage_object: null,
    usage_completion_tokens: null,
    usage_prompt_tokens: null,
    usage_total_tokens: null,
    api_key: null,
  } as Event);
});

bot.on(message('voice'), async (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `[NEW] voice received`));
  processVoiceMessage(ctx, pineconeIndex);
});

bot.on(message('text'), async (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `[NEW] text received`));
  const key = getMessageBufferKey(ctx);
  const messageData = messageBuffers.get(key) || { messages: [], timer: null };

  messageData.messages.push(ctx.message?.text || '');

  // Clear the old timer
  if (messageData.timer) {
    clearTimeout(messageData.timer);
  }

  // Set a new timer
  messageData.timer = setTimeout(() => {
    const fullMessage = messageData.messages?.join('\n') || '';
    console.log(toLogFormat(ctx, `full message collected. length: ${fullMessage.length}`));
    messageData.messages = []; // Clear the messages array
    processFullTextMessage(ctx, fullMessage);
  }, 4000);

  // Save the message buffer
  messageBuffers.set(key, messageData);
});

bot.launch();
console.log('Bot started');

export default bot;
