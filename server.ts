import dotenv from "dotenv";
import fs from "fs";
import axios, { AxiosResponse } from 'axios';
import pTimeout from 'p-timeout';
import yaml from 'js-yaml';

import { Context, session, Telegraf } from "telegraf";
import { message, editedMessage, channelPost, editedChannelPost, callbackQuery } from "telegraf/filters";

import ffmpeg from 'fluent-ffmpeg';
import { Configuration, OpenAIApi, ChatCompletionRequestMessage, CreateChatCompletionResponse } from 'openai';

import { PineconeClient } from "@pinecone-database/pinecone";

interface SessionData {
	messageCount: number;
}

interface MyContext extends Context {
	session?: SessionData;
}

interface MyMessage extends ChatCompletionRequestMessage{
  chat_id: number;
}

interface Prompt {
  name: string;
  text: string;
}

interface User {
  user_id: number;
  username: string;
  default_language_code: string;
  language_code?: string | null;
  openai_api_key?: string | null;
}

interface Event {
  time: Date;
  type: string;

  user_id?: number | null;
  user_is_bot?: boolean | null;
  user_language_code?: string | null;
  user_username?: string | null;

  chat_id?: number | null;
  chat_type?: string | null;

  message_role?: string | null;
  messages_type?: string | null;
  message_voice_duration?: number | null;
  message_command?: string | null;
  content_length?: number | null;

  usage_model?: string | null;
  usage_object?: string | null;
  usage_completion_tokens?: number | null;
  usage_prompt_tokens?: number | null;
  usage_total_tokens?: number | null;
}

if (fs.existsSync(".env")) {
  dotenv.config();
}

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) {
  throw new Error(
    "Please set the TELEGRAM_BOT_TOKEN and OPENAI_API_KEY and DATABASE_URL environment variables"
  );
}

// Connect to the postgress database

import { Pool, QueryResult } from 'pg';
// import pkg_pg from 'pg';
// const { Pool } = pkg_pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Connect to the Pinecone database

let pineconeIndex: any = null;
if (
  process.env.PINECONE_ENVIRONMENT 
  && process.env.PINECONE_API_KEY
  && process.env.PINECONE_INDEX_NAME
) {
  (async () => {
    const pinecone = new PineconeClient();
    pinecone.projectName = process.env.PINECONE_PROJECT_NAME || null;
    await pinecone.init({
      environment: process.env.PINECONE_ENVIRONMENT,
      apiKey: process.env.PINECONE_API_KEY,
    });
    pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);
    console.log('Pinecone database connected');
  })();
} else {
  console.log('Pinecone database not connected');
}

const prompts_path = process.env.SETTINGS_PATH || './settings/private_en.yaml';
const fileContents = fs.readFileSync(prompts_path, 'utf8');
const bot_settings = yaml.load(fileContents);

const GPT_MODEL = bot_settings.gpt_model;
const maxTokensThreshold = 128000;
const maxLettersThreshold = maxTokensThreshold*1.5;
const RESET_MESSAGE = bot_settings.strings.reset_message || 'Old messages deleted';
const NO_OPENAI_KEY_ERROR = bot_settings.strings.no_openai_key_error || 'No OpenAI key provided. Please contact the bot owner.';
const NO_PHOTO_ERROR = bot_settings.strings.no_photo_error || 'Bot can not process photos.';
const NO_VIDEO_ERROR = bot_settings.strings.no_video_error || 'Bot can not process videos.';
const NO_ANSWER_ERROR = bot_settings.strings.no_answer_error || 'Bot can not answer to this message.';

// Create needed tables if not exists

const createTableQueries = [
  `
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    role VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    chat_id bigint NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id bigint UNIQUE NOT NULL,
    username VARCHAR(255),
    default_language_code VARCHAR(255),
    language_code VARCHAR(255),
    openai_api_key VARCHAR(255),
    usage_type VARCHAR(255) DEFAULT NULL
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
    usage_total_tokens INT
  );
  `
]

// utils

const toLogFormat = (ctx: MyContext, logMessage: string) => {
  const chat_id = ctx.chat?.id;
  const username = ctx.from?.username || ctx.from?.id;
  return `Chat: ${chat_id}, User: ${username}: ${logMessage}`;
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


// Database functions

const selectMessagesByChatIdGPTformat = async (ctx: MyContext) => {
  if (ctx.chat && ctx.chat.id && ctx.from && ctx.from.username) {
    const res = await pool.query('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY id', [ctx.chat.id]);
    console.log(toLogFormat(ctx, `messages received from the database: ${res.rows.length}`));
    return res.rows as MyMessage[];
  } else {
    throw new Error('ctx.chat.id or ctx.from.username is undefined');
  }
}

const selectUserByUserId = async (user_id: number) => {
  const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [user_id]);
  return res.rows[0];
}

const insertMessage = async ({role, content, chat_id}: MyMessage) => {
  const res = await pool.query(`
    INSERT INTO messages (role, content, chat_id)
    VALUES ($1, $2, $3)
    RETURNING *;
  `, [role, content, chat_id]);
  return res.rows[0];
}

const insertUser = async ({user_id, username, default_language_code, language_code=default_language_code, openai_api_key=null}: User) => {
  try {
    const res = await pool.query(`
    INSERT INTO users (user_id, username, default_language_code, language_code, openai_api_key)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id) DO UPDATE SET
      username = $2,
      default_language_code = $3,
      language_code = $4,
      openai_api_key = $5
    RETURNING *;
  `, [user_id, username, default_language_code, language_code, openai_api_key]);
  return res.rows[0];
  } catch (error) {
    throw error;
  }
}

const insertEvent = async (event: Event) => {
  event.time = new Date();
  try {
    const res = await pool.query(`
      INSERT INTO events (
        time,
        type,
  
        user_id,
        user_is_bot,
        user_language_code,
        user_username,
  
        chat_id,
        chat_type,
  
        message_role,
        messages_type,
        message_voice_duration,
        message_command,
        content_length,
  
        usage_model,
        usage_object,
        usage_completion_tokens,
        usage_prompt_tokens,
        usage_total_tokens
      )
      VALUES (
        $1, $2,
        $3, $4, $5, $6,
        $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18
      )
      RETURNING *;
    `, [
      event.time,
      event.type,
  
      event.user_id,
      event.user_is_bot,
      event.user_language_code,
      event.user_username,
  
      event.chat_id,
      event.chat_type,
  
      event.message_role,
      event.messages_type,
      event.message_voice_duration,
      event.message_command,
      event.content_length,
  
      event.usage_model,
      event.usage_object,
      event.usage_completion_tokens,
      event.usage_prompt_tokens,
      event.usage_total_tokens
    ]);
    return res.rows[0];
  } catch (error) {
    throw error;
  }
}


const deleteMessagesByChatId = async (chat_id: number) => {
  const res = await pool.query('DELETE FROM messages WHERE chat_id = $1', [chat_id]);
  return res;
}


// default prompt message to add to the GPT model

const defaultPrompt: Prompt | undefined = bot_settings.prompts.find((prompt: Prompt) => prompt.name === 'default');
const defaultPromptMessage = defaultPrompt ? defaultPrompt.text : '';

let defaultPromptMessageObj = {} as MyMessage;
if (defaultPromptMessage) {
  defaultPromptMessageObj = {
    "role": "assistant",
    "content": defaultPromptMessage.toString(),
  } as MyMessage;
} else {
  console.log('Default prompt message not found');
}

// OpenAI functions

async function getUserSettingsAndOpenAiOrCreate(ctx: MyContext) {
  if (ctx.from && ctx.from.id) {
    const user_id = ctx.from.id;
    let userSettings = await selectUserByUserId(user_id);
    if (!userSettings) {
      userSettings = {
        user_id: user_id,
        username: ctx.from.username,
        default_language_code: ctx.from.language_code,
        language_code: ctx.from.language_code,
      }
      insertUser(userSettings);
      console.log(toLogFormat(ctx, `user created in the database`));
    }

    // Check if user is premium
    if (userSettings.usage_type === "premium") {
      userSettings.openai_api_key = process.env.OPENAI_API_KEY;
      console.log(toLogFormat(ctx, `user is premium, openai_api_key set from .env.`));
    } else {
      console.log(toLogFormat(ctx, `[ACCESS DENIED] user is not premium, openai_api_key not set.`));
    }

    if (!userSettings.openai_api_key) {
      throw new NoOpenAiApiKeyError(`User with user_id ${user_id} has no openai_api_key`);
    }
    const configuration = new Configuration({
      apiKey: userSettings.openai_api_key,
    });
    const openai = new OpenAIApi(configuration);
    return {settings: userSettings, openai: openai}
  } else {
    throw new Error('ctx.from.id is undefined');
  }
}

async function createChatCompletionWithRetry(messages: MyMessage[], openai: OpenAIApi, retries = 5, timeoutMs = timeoutMsDefaultchatGPT) {
  for(let i = 0; i < retries; i++) {
    try {
      const chatGPTAnswer = await pTimeout(
        openai.createChatCompletion({
          model: GPT_MODEL,
          messages: messages,
          temperature: 0.7,
          // max_tokens: 1000,
        }),
        timeoutMs,
      )
        .catch((error) => {
            throw error;
        });

      if (chatGPTAnswer.status !== 200) {
          throw new Error(`openai.createChatCompletion failed with status ${chatGPTAnswer.status}`);
      }
        
      return chatGPTAnswer;
    } catch (error) {
      if (error instanceof pTimeout.TimeoutError) {
          console.error(`openai.createChatCompletion timed out. Retries left: ${retries - i - 1}`);
      } else {
          console.error(`openai.createChatCompletion failed. Retries left: ${retries - i - 1}`);
      }
      
      if(i === retries - 1) throw error;
    }
  }
}

async function createChatCompletionWithRetryReduceHistoryLongtermMemory(ctx: MyContext, messages: MyMessage[], openai: OpenAIApi, pineconeIndex: any, retries = 5, timeoutMs = timeoutMsDefaultchatGPT): Promise<AxiosResponse<CreateChatCompletionResponse, any> | undefined> {
  try {
    // Add longterm memory to the messages based on pineconeIndex

    let referenceMessageObj: any = undefined;
    if (pineconeIndex) {
      // Get embeddings for last user messages
      const lastMessagesThreshold = 4;
      const userMessagesText = messages
        .filter((message) => message.role === 'user')
        .slice(-lastMessagesThreshold)
        .map((message) => message.content)
        .join('\n');
      // Make the embedding request and return the result
      const resp = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: userMessagesText,
      })
      const embedding = resp?.data.data[0].embedding;

      const queryRequest = {
        vector: embedding,
        topK: 8,
        includeValues: false,
        includeMetadata: true,
      };
      const queryResponse = await pineconeIndex.query({ queryRequest });

      // TODO: add wiki URLs to the referenceMessage from metadata.source

      const referenceText =
        "Related to this conversation document parts:\n" 
        + queryResponse.matches.map(
            (match: any) => match.metadata.text
          ).join('\n');
      
      referenceMessageObj = {
        "role": "assistant",
        "content": referenceText,
      } as MyMessage;
    }


    // Reduce history

    // lettersThreshold is the approximate limit of tokens for GPT-4 in letters
    const lettersThreshold = 
      maxLettersThreshold
      - defaultPromptMessageObj.content.length 
      - (referenceMessageObj ? referenceMessageObj.content.length : 0);

    // Calculate total length of messages and prompt
    let totalLength = messages.reduce((acc, message) => acc + message.content.length, 0) + defaultPromptMessage.length;
    let messagesCleanned;
    if (totalLength <= lettersThreshold) {
        messagesCleanned = [...messages]; // create a copy of messages if totalLength is within limit
    } else {
        // If totalLength exceeds the limit, create a subset of messages
        const messagesCopy = [...messages].reverse(); // create a reversed copy of messages
        messagesCleanned = [];
    
        while (totalLength > lettersThreshold) {
            const message = messagesCopy.pop() as MyMessage; // remove the last message from the copy
            totalLength -= message.content.length; // recalculate the totalLength
        }
    
        messagesCleanned = messagesCopy.reverse(); // reverse the messages back to the original order
        
        console.log(toLogFormat(ctx, `messages reduced from ${messages.length} to ${messagesCleanned.length}`));
    }

    let finalMessages = [defaultPromptMessageObj]
    if (referenceMessageObj) {
      finalMessages.push(referenceMessageObj);
    }
    finalMessages = finalMessages.concat(messagesCleanned);

    // TODO: Uncomment to see hidden and user messages in logs
    // console.log(JSON.stringify(finalMessages, null, 2));

    const chatGPTAnswer = await createChatCompletionWithRetry(
      messages = finalMessages,
      openai,
      retries,
      timeoutMs,
    );
    return chatGPTAnswer as AxiosResponse<CreateChatCompletionResponse, any> | undefined;
  } catch (error) {
    throw error;
  }
}

function createTranscriptionWithRetry(fileStream: File, openai: OpenAIApi, retries = 3): Promise<any> {
  return openai.createTranscription(fileStream, "whisper-1")
    .catch((error) => {
      if (retries === 0) {
        throw error;
      }
      console.error(`openai.createTranscription failed. Retries left: ${retries}`);
      return createTranscriptionWithRetry(fileStream, openai, retries - 1);
    });
}

// Save answer to the database to all tables
async function saveAnswerToDB(chatResponse: any, ctx: MyContext) {
  try {
    // save the answer to the database
    const answer = chatResponse.data.choices[0].message.content;
    if (ctx.chat && ctx.chat.id) {
      insertMessage({
        role: "assistant",
        content: answer,
        chat_id: ctx.chat.id,
        });
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }
    if (ctx.from && ctx.from.id) {
      insertEvent({
        type: 'assistant_message',

        user_id: ctx.from.id,
        user_is_bot: ctx.from.is_bot,
        user_language_code: ctx.from.language_code,
        user_username: ctx.from.username,

        chat_id: ctx.chat.id,
        chat_type: ctx.chat.type,

        message_role: "assistant",
        messages_type: "text",
        message_voice_duration: null,
        message_command: null,
        content_length: answer.length,

        usage_model: chatResponse.data.model,
        usage_object: chatResponse.data.object,
        usage_completion_tokens: chatResponse.data.usage.completion_tokens,
        usage_prompt_tokens: chatResponse.data.usage.prompt_tokens,
        usage_total_tokens: chatResponse.data.usage.total_tokens,
      } as Event);
      console.log(toLogFormat(ctx, `answer saved to the database. total_tokens: ${chatResponse.data.usage.total_tokens}`));
    } else {
      throw new Error(`ctx.from.id is undefined`);
    }
  } catch (error) {
    throw error;
  }
}

async function saveCommandToDB(ctx: MyContext, command: string) {
  try {
    if (ctx.chat && ctx.chat.id && ctx.from && ctx.from.id) {
      insertEvent({
        type: 'user_command',

        user_id: ctx.from.id,
        user_is_bot: ctx.from.is_bot,
        user_language_code: ctx.from.language_code,
        user_username: ctx.from.username,

        chat_id: ctx.chat.id,
        chat_type: ctx.chat.type,

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
      } as Event);
      console.log(toLogFormat(ctx, `command saved to the database`));
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }
  } catch (error) {
    throw error;
  }
}



// BOT

const timeoutMsDefaultchatGPT = 6*60*1000;
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
  let sendChatActionTyping = () => {};
  let chatId: number = -1;
  if (ctx.chat && ctx.chat.id) {
    chatId = ctx.chat.id;
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }
  if (chatId !== -1) {
    sendChatActionTyping = () => ctx.telegram.sendChatAction(chatId, 'typing');
  }
  const waitPromise = waitAndLog(stopSignal, sendChatActionTyping);

  // Wait for next() to complete
  await next();
  isNextDone = true;

  // Wait for waitAndLog to finish
  await waitPromise;

  const ms = new Date().getTime() - start.getTime() ;
  console.log(toLogFormat(ctx, `message processed. Response time: ${ms / 1000} seconds.`));
});

const helpString = bot_settings.strings.help_string;
const errorString = bot_settings.strings.error_string;

bot.start((ctx: MyContext) => {
  console.log(toLogFormat(ctx, `/start command received`));
  if (ctx.from && ctx.from.id) {
    insertUser({
      user_id: ctx.from.id,
      username: ctx.from.username,
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
    deleteMessagesByChatId(ctx.chat.id);
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

async function processVoiceMessage(ctx: MyContext) {
  if (
    ctx.from && ctx.from.id && ctx.chat && ctx.chat.id && ctx.message 
    && ctx.message.voice && ctx.message.voice.duration
  ) {
    insertEvent({
      type: 'user_message',

      user_id: ctx.from.id,
      user_is_bot: ctx.from.is_bot,
      user_language_code: ctx.from.language_code,
      user_username: ctx.from.username,

      chat_id: ctx.chat.id,
      chat_type: ctx.chat.type,

      message_role: "user",
      messages_type: "voice",
      message_voice_duration: ctx.message.voice.duration,
      message_command: null,
      content_length: null,

      usage_model: null,
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
    } as Event);
  } else {
    throw new Error(`ctx.from.id or ctx.chat.id is undefined`);
  }
  
  try {
    let userData = null;
    try {
      userData = await getUserSettingsAndOpenAiOrCreate(ctx);
    } catch (e) {
      if (e instanceof NoOpenAiApiKeyError) {
        ctx.reply(NO_OPENAI_KEY_ERROR);
        return;
      } else {
        throw e;
      }
    }
    const fileId = ctx.message.voice.file_id;

    // download the file
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({ url: url.toString(), responseType: 'stream' });

    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(`./${fileId}.oga`))
        .on('error', reject)
        .on('finish', resolve);
    });
    console.log(toLogFormat(ctx, `voice file downloaded`));

    await new Promise((resolve, reject) => {
      ffmpeg(`./${fileId}.oga`)
        .toFormat('mp3')
        .on('error', reject)
        .on('end', resolve)
        .saveToFile(`./${fileId}.mp3`);
    });
    console.log(toLogFormat(ctx, `voice file converted`));

    // send the file to the OpenAI API for transcription
    const transcription = await createTranscriptionWithRetry(fs.createReadStream(`./${fileId}.mp3`), userData.openai);
    const transcriptionText = transcription.data.text;
    console.log(toLogFormat(ctx, `voice transcription received`));

    // download all related messages from the database
    let messages = await selectMessagesByChatIdGPTformat(ctx);

    // Union the user message with messages
    messages = messages.concat({
      role: "user",
      content: transcriptionText as string,
    } as MyMessage);

    // save the transcription to the database
    insertMessage({
      role: "user",
      content: transcriptionText,
      chat_id: ctx.chat.id,
    });
    insertEvent({
      type: 'model_transcription',

      user_id: ctx.from.id,
      user_is_bot: ctx.from.is_bot,
      user_language_code: ctx.from.language_code,
      user_username: ctx.from.username,

      chat_id: ctx.chat.id,
      chat_type: ctx.chat.type,

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
    } as Event);
    console.log(toLogFormat(ctx, `new voice transcription saved to the database`));

    // Send this text to OpenAI's Chat GPT model with retry logic
    const chatResponse = await createChatCompletionWithRetryReduceHistoryLongtermMemory(
      ctx,
      messages, 
      userData.openai,
      pineconeIndex,
    );
    console.log(toLogFormat(ctx, `chatGPT response received`));

    // save the answer to the database
    saveAnswerToDB(chatResponse, ctx);

    // send the answer to the user
    let answer = chatResponse?.data?.choices?.[0]?.message?.content ?? NO_ANSWER_ERROR;
    
    ctx.reply(answer);
    console.log(toLogFormat(ctx, `answer sent to the user`));

    // Delete both files
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
  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

async function processTextMessage(ctx: MyContext) {
  try {
    let userData = null;
    try {
      if (ctx.from && ctx.from.id) {
        userData = await getUserSettingsAndOpenAiOrCreate(ctx);
      } else {
        throw new Error(`ctx.from.id is undefined`);
      }
    } catch (e) {
      if (e instanceof NoOpenAiApiKeyError) {
        ctx.reply(NO_OPENAI_KEY_ERROR);
        return;
      } else {
        throw e;
      }
    }
    let userText = null;
    if (ctx.message && ctx.message.text) {
      userText = ctx.message.text;
    } else {
      throw new Error(`ctx.message.text is undefined`);
    }

    // download all related messages from the database
    let messages = await selectMessagesByChatIdGPTformat(ctx);

    // Union the user message with messages
    messages = messages.concat({
      role: "user",
      content: userText,
    } as MyMessage);

    // save the message to the database
    if (ctx.chat && ctx.chat.id && ctx.from && ctx.from.id) {
      insertMessage({
        role: "user",
        content: userText,
        chat_id: ctx.chat.id,
      });
      insertEvent({
        type: 'user_message',

        user_id: ctx.from.id,
        user_is_bot: ctx.from.is_bot,
        user_language_code: ctx.from.language_code,
        user_username: ctx.from.username,

        chat_id: ctx.chat.id,
        chat_type: ctx.chat.type,

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
      } as Event);
      console.log(toLogFormat(ctx, `new message saved to the database`));
    } else {
      throw new Error(`ctx.chat.id or ctx.from.id is undefined`);
    }

    // Send this text to OpenAI's Chat GPT model with retry logic
    let chatResponse = await createChatCompletionWithRetryReduceHistoryLongtermMemory(
      ctx,
      messages, 
      userData.openai,
      pineconeIndex,
    );
    console.log(toLogFormat(ctx, `chatGPT response received`));
  
    // save the answer to the database
    saveAnswerToDB(chatResponse, ctx);

    // send the answer to the user
    let answer = chatResponse?.data?.choices?.[0]?.message?.content ?? NO_ANSWER_ERROR;
    
    ctx.reply(answer);
    console.log(toLogFormat(ctx, `answer sent to the user`));
  } catch(e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

bot.on(message('photo'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `photo received`));
  ctx.reply(NO_PHOTO_ERROR);
  if (ctx.from && ctx.from.id && ctx.chat && ctx.chat.id) {
    insertEvent({
      type: 'user_message',

      user_id: ctx.from.id,
      user_is_bot: ctx.from.is_bot,
      user_language_code: ctx.from.language_code,
      user_username: ctx.from.username,

      chat_id: ctx.chat.id,
      chat_type: ctx.chat.type,

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
    } as Event);
  } else {
    throw new Error(`ctx.from.id or ctx.chat.id is undefined`);
  }
});

bot.on(message('video'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `video received`));
  ctx.reply(NO_VIDEO_ERROR);
  if (ctx.from && ctx.from.id && ctx.chat && ctx.chat.id) {
    insertEvent({
      type: 'user_message',

      user_id: ctx.from.id,
      user_is_bot: ctx.from.is_bot,
      user_language_code: ctx.from.language_code,
      user_username: ctx.from.username,

      chat_id: ctx.chat.id,
      chat_type: ctx.chat.type,

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
    } as Event);
  } else {
    throw new Error(`ctx.from.id or ctx.chat.id is undefined`);
  }
});

bot.on(message('sticker'), (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `sticker received`));
  ctx.reply('👍');
  if (ctx.from && ctx.from.id && ctx.chat && ctx.chat.id) {
    insertEvent({
      type: 'user_message',

      user_id: ctx.from.id,
      user_is_bot: ctx.from.is_bot,
      user_language_code: ctx.from.language_code,
      user_username: ctx.from.username,

      chat_id: ctx.chat.id,
      chat_type: ctx.chat.type,

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
    } as Event);
  } else {
    throw new Error(`ctx.from.id or ctx.chat.id is undefined`);
  }
});

bot.on(message('voice'), async (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `[NEW] voice received`));
  processVoiceMessage(ctx);
});

bot.on(message('text'), async (ctx: MyContext) => {
  console.log(toLogFormat(ctx, `[NEW] text received`));
  processTextMessage(ctx);
});

bot.launch()


// import express from "express";
// import bodyParser from "body-parser";

// Web APP

// const app = express();
// const PORT = process.env.PORT || 5000;
// app.use(bodyParser.urlencoded({ extended: false }));
// app.use(bodyParser.json());

// const router = express.Router();

// app.get("/", (req, res) => {
//   res
//     .status(405)
//     .send(
//       "405 Method Not Allowed."
//     );
// });

// app.get("/webhook", (req, res) => {
//   res
//     .status(405)
//     .send(
//       "405 Method Not Allowed."
//     );
// });

// app.use("/", router);

// app.listen(PORT, (err) => {
//   if (err) {
//     console.error(err);
//   }
//   console.log(`Server listening on port ${PORT}`);
// });
