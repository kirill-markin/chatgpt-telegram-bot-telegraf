import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import axios from 'axios';
import pTimeout from 'p-timeout';

import pkg_t from 'telegraf';
const { Telegraf } = pkg_t;
import { message, editedMessage, channelPost, editedChannelPost, callbackQuery } from "telegraf/filters";

import ffmpeg from 'fluent-ffmpeg';
import { Configuration, OpenAIApi } from 'openai';

if (fs.existsSync(".env")) {
  dotenv.config();
}

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) {
  throw new Error(
    "Please set the TELEGRAM_BOT_TOKEN and OPENAI_API_KEY and DATABASE_URL environment variables"
  );
}

// Connect to the postgress database

import pkg_pg from 'pg';
const { Pool } = pkg_pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


// Create needed tables if not exists

const createTableQueries = [
  `
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    role VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    chat_id INT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    username VARCHAR(255),
    default_language_code VARCHAR(255),
    language_code VARCHAR(255),
    openai_api_key VARCHAR(255)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    time TIMESTAMP NOT NULL,
    type VARCHAR(255) NOT NULL,

    user_id INT,
    user_is_bot BOOLEAN,
    user_language_code VARCHAR(255),
    user_username VARCHAR(255),

    chat_id INT,
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

const toLogFormat = (chat_id, username, logMessage) => {
  return `Chat: ${chat_id}, User: ${username}: ${logMessage}`;
}

for (const createTableQuery of createTableQueries) {
  await pool.query(createTableQuery, (err, res) => {
    if (err) {
      console.error('Error with checking/creating tables', err.stack);
      throw err;
    }
  });
}
console.log('Related tables checked/created successfully');

class NoOpenAiApiKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoOpenAiApiKeyError';
  }
}


// Database functions

const selectMessagesByChatIdGPTformat = async (ctx) => {
  const res = await pool.query('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY id', [ctx.chat.id]);
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `messages received from the database: ${res.rows.length}`));
  return res.rows;
}

const selectUserByUserId = async (user_id) => {
  const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [user_id]);
  return res.rows[0];
}

const insertMessage = async ({role, content, chat_id}) => {
  const res = await pool.query(`
    INSERT INTO messages (role, content, chat_id)
    VALUES ($1, $2, $3)
    RETURNING *;
  `, [role, content, chat_id]);
  return res.rows[0];
}

const insertUser = async ({user_id, username, default_language_code, language_code=default_language_code, openai_api_key=null}) => {
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

const insertEvent = async (event) => {
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


const deleteMessagesByChatId = async (chat_id) => {
  const res = await pool.query('DELETE FROM messages WHERE chat_id = $1', [chat_id]);
  return res;
}


// default prompt message to add to the GPT-4 model

const defaultPromptMessage = (`
Act as assistant
Your name is Donna
You are female
You should be friendly
You should not use official tone
Your answers should be simple, and laconic but informative
Before providing an answer check information above one more time
Try to solve tasks step by step
I will send you questions or topics to discuss and you will answer me
You interface right now is a telegram messenger
Some of messages you will receive from user was transcribed from voice messages
`)
const defaultPromptMessageObj = {
  "role": "assistant",
  "content": defaultPromptMessage,
};

// OpenAI functions

async function getUserSettingsAndOpenAi(user_id) {
  const userSettings = await selectUserByUserId(user_id);
  if (!userSettings) {
    throw new Error(`User with user_id ${user_id} not found`);
  }

  const primaryUsers = process.env.PRIMARY_USERS_LIST.split(',');
  if (
    primaryUsers
    && Array.isArray(primaryUsers)
    && primaryUsers.includes(userSettings.username)
  ) {
    userSettings.openai_api_key = process.env.OPENAI_API_KEY;
  }
  if (!userSettings.openai_api_key) {
    throw new NoOpenAiApiKeyError(`User with user_id ${user_id} has no openai_api_key`);
  }
  const configuration = new Configuration({
    apiKey: userSettings.openai_api_key,
  });
  const openai = new OpenAIApi(configuration);
  return {settings: userSettings, openai: openai}
}

const timeoutMsDefault = 2*60*1000;

async function createChatCompletionWithRetry(messages, openai, retries = 5, timeoutMs = timeoutMsDefault) {
  for(let i = 0; i < retries; i++) {
    try {
      const chatGPTAnswer = await pTimeout(
        openai.createChatCompletion({
          model: "gpt-4",
          messages: messages,
          temperature: 0.7,
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

async function createChatCompletionWithRetryAndReduceHistory(messages, openai, retries = 5, timeoutMs = timeoutMsDefault) {
  try {
    // Calculate total length of messages and prompt
    let totalLength = messages.reduce((acc, message) => acc + message.content.length, 0) + defaultPromptMessage.length;
    
    // lettersThreshold is the approximate limit of tokens for GPT-4 in letters
    let messagesCleanned;

    const lettersThreshold = 15000;
    
    if (totalLength <= lettersThreshold) {
        messagesCleanned = [...messages]; // create a copy of messages if totalLength is within limit
    } else {
        // If totalLength exceeds the limit, create a subset of messages
        const messagesCopy = [...messages].reverse(); // create a reversed copy of messages
        messagesCleanned = [];
    
        while (totalLength > lettersThreshold) {
            const message = messagesCopy.pop(); // remove the last message from the copy
            totalLength -= message.content.length; // recalculate the totalLength
        }
    
        messagesCleanned = messagesCopy.reverse(); // reverse the messages back to the original order
    }
    const chatGPTAnswer = await createChatCompletionWithRetry(
      messages = [defaultPromptMessageObj, ...messagesCleanned],
      openai,
      retries,
      timeoutMs,
    )
    return chatGPTAnswer;
  } catch (error) {
    throw error;
  }
}

function createTranscriptionWithRetry(fileStream, retries = 3) {
  return openai.createTranscription(fileStream, "whisper-1")
    .catch((error) => {
      if (retries === 0) {
        throw error;
      }
      console.error(`openai.createTranscription failed. Retries left: ${retries}`);
      return createTranscriptionWithRetry(fileStream, retries - 1);
    });
}

// Save answer to the database to all tables
function saveAnswerToDB(chatResponse, ctx) {
  try {
    // save the answer to the database
    const answer = chatResponse.data.choices[0].message.content;
    insertMessage({
      role: "assistant",
      content: answer,
      chat_id: ctx.chat.id,
    });
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
    });
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `answer saved to the database`));
  } catch (error) {
    throw error;
  }
}



// BOT

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {handlerTimeout: 12*60*1000});
const waitAndLog = async (stopSignal, func) => {
  while (!stopSignal()) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      func();
    } catch (error) {
      console.error(error);
    }
  }
};

bot.use(async (ctx, next) => {
  const start = new Date();

  let isNextDone = false;
  const stopSignal = () => isNextDone;

  // Start waiting and logging in parallel
  const waitPromise = waitAndLog(stopSignal, () => ctx.telegram.sendChatAction(ctx.chat.id, 'typing'));

  // Wait for next() to complete
  await next();
  isNextDone = true;

  // Wait for waitAndLog to finish
  await waitPromise;

  const ms = new Date() - start;
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `message processed. Response time: ${ms / 1000} seconds.`));
});
const helpString = `Бот GPT Кирилла Маркина - голосовой помощник, который понимает аудиосообщения на русском языке 😊`
const errorString = `Произошла ошибка во время обработки сообщения. Скажите Кириллу — пусть починит. Telegram Кирилла: @kirmark`

bot.start((ctx) => {
  insertUser({
    user_id: ctx.from.id,
    username: ctx.from.username,
    default_language_code: ctx.from.language_code,
    language_code: ctx.from.language_code,
  });
  ctx.reply(helpString)
});

bot.help((ctx) => {
  ctx.reply(helpString)
});

bot.command('reset', (ctx) => {
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `/reset command received`));
  deleteMessagesByChatId(ctx.chat.id);
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `messages deleted from database`));
  ctx.reply('Старые сообщения удалены из памяти бота в этом чате.')
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
    message_command: "/reset",
    content_length: null,

    usage_model: null,
    usage_object: null,
    usage_completion_tokens: null,
    usage_prompt_tokens: null,
    usage_total_tokens: null,
  });
});


bot.on(message('photo'), (ctx) => {
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `photo received`));
  ctx.reply('Робот пока что не умеет работать с фото и проигнорирует это сообщение.');
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
  });
});
bot.on(message('video'), (ctx) => {
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `video received`));
  ctx.reply('Робот пока что не умеет работать с видео и проигнорирует это сообщение.');
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
  });
});
bot.on(message('sticker'), (ctx) => {
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `sticker received`));
  ctx.reply('👍');
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
  });
});
bot.on(message('voice'), async (ctx) => {
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `[NEW] voice received`));
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
  });
  
  try {
    let userData = null;
    try {
      userData = await getUserSettingsAndOpenAi(ctx.from.id);
    } catch (e) {
      if (e instanceof NoOpenAiApiKeyError) {
        ctx.reply('У вас не настроен OpenAI API ключ. Напишите /settings чтобы настроить его.');
        return;
      } else {
        throw e;
      }
    }
    const fileId = ctx.message.voice.file_id;

    // download the file
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({url, responseType: 'stream'});

    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(`./${fileId}.oga`))
        .on('error', reject)
        .on('finish', resolve);
    });
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `voice file downloaded`));

    await new Promise((resolve, reject) => {
      ffmpeg(`./${fileId}.oga`)
        .toFormat('mp3')
        .on('error', reject)
        .on('end', resolve)
        .saveToFile(`./${fileId}.mp3`);
    });
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `voice file converted`));

    // send the file to the OpenAI API for transcription
    const transcription = await createTranscriptionWithRetry(fs.createReadStream(`./${fileId}.mp3`));
    const transcriptionText = transcription.data.text;
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `voice transcription received`));

    // download all related messages from the database
    let messages = await selectMessagesByChatIdGPTformat(ctx);

    // Union the user message with messages
    messages = messages.concat({
      role: "user",
      content: transcriptionText,
    });

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
    });
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `new voice transcription saved to the database`));

    // Send this text to OpenAI's Chat GPT-4 model with retry logic
    const chatResponse = await createChatCompletionWithRetryAndReduceHistory(messages, userData.openai);
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `chatGPT response received`));

    // save the answer to the database
    saveAnswerToDB(chatResponse, ctx);

    // send the answer to the user
    const answer = chatResponse.data.choices[0].message.content;
    ctx.reply(answer);
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `answer sent to the user`));

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
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `voice processing finished`));
  } catch (e) {
    console.error(toLogFormat(ctx.chat.id, ctx.from.username, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
});

bot.on(message('text'), async (ctx) => {
  console.log(toLogFormat(ctx.chat.id, ctx.from.username, `[NEW] text received`));

  try {
    let userData = null;
    try {
      userData = await getUserSettingsAndOpenAi(ctx.from.id);
    } catch (e) {
      if (e instanceof NoOpenAiApiKeyError) {
        ctx.reply('У вас не настроен OpenAI API ключ. Напишите /settings чтобы настроить его.');
        return;
      } else {
        throw e;
      }
    }
    const userText = ctx.message.text;

    // save the message to the database
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
    });
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `new message saved to the database`));

    // download all related messages from the database
    let messages = await selectMessagesByChatIdGPTformat(ctx);

    // Union the user message with messages
    messages = messages.concat({
      role: "user",
      content: userText,
    });

    // Send this text to OpenAI's Chat GPT-4 model with retry logic
    let chatResponse = await createChatCompletionWithRetryAndReduceHistory(
      messages, 
      userData.openai,
    );
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `chatGPT response received`));
  
    // save the answer to the database
    saveAnswerToDB(chatResponse, ctx);

    // send the the answer to the user
    const answer = chatResponse.data.choices[0].message.content;
    ctx.reply(answer);
    console.log(toLogFormat(ctx.chat.id, ctx.from.username, `answer sent to the user`));
  } catch(e) {
    console.error(toLogFormat(ctx.chat.id, ctx.from.username, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
});
bot.launch()


// Web APP

const app = express();
const PORT = process.env.PORT || 5000;
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const router = express.Router();

app.get("/", (req, res) => {
  res
    .status(405)
    .send(
      "405 Method Not Allowed."
    );
});

app.get("/webhook", (req, res) => {
  res
    .status(405)
    .send(
      "405 Method Not Allowed."
    );
});

app.use("/", router);

app.listen(PORT, (err) => {
  if (err) {
    console.error(err);
  }
  console.log(`Server listening on port ${PORT}`);
});
