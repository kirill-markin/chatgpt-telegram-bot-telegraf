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

const createTableQuery = `
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    role VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    chat_id INT NOT NULL
  );
`;

pool.query(createTableQuery, (err, res) => {
  if (err) {
    console.error('Error executing query', err.stack);
  } else {
    console.log('Table messages checked/created successfully');
  }
});


// Database functions

const selectMessagesByChatIdGPTformat = async (chatId) => {
  const res = await pool.query('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY id', [chatId]);
  return res.rows;
}

const insertMessage = async (role, content, chat_id) => {
  const res = await pool.query('INSERT INTO messages (role, content, chat_id) VALUES ($1, $2, $3)', [role, content, chat_id]);
  return res;
}

const deleteMessagesByChatId = async (chat_id) => {
  const res = await pool.query('DELETE FROM messages WHERE chat_id = $1', [chat_id]);
  return res;
}

// default prompt message to add to the GPT-4 model
const defaultPromptMessage = (
`Act as assistant
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

const timeoutMsDefault = 2*60*1000;

async function createChatCompletionWithRetry(messages, retries = 5, timeoutMs = timeoutMsDefault) {
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

async function createChatCompletionWithRetryAndReduceHistory(messages, retries = 5, timeoutMs = timeoutMsDefault) {
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


// BOT

const configuration = new Configuration({
	apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {handlerTimeout: 12*60*1000});

bot.use(async (ctx, next) => {
  const start = new Date()
  await next()
  const ms = new Date() - start
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: message processed. Response time: ${ms/1000} seconds.`)
})

const helpString = `Бот GPT Кирилла Маркина - голосовой помощник, который понимает аудиосообщения на русском языке 😊`
const errorString = `Произошла ошибка во время обработки сообщения. Скажите Кириллу — пусть починит. Telegram Кирилла: @kirmark`

bot.start((ctx) => {
  ctx.reply(helpString)
});
bot.help((ctx) => {
  ctx.reply(helpString)
});

bot.command('reset', (ctx) => {
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: /reset command received`);
  deleteMessagesByChatId(ctx.chat.id);
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: messages deleted from database`);
  ctx.reply('Старые сообщения удалены из памяти бота в этом чате.')
});


bot.on(message('photo'), (ctx) => {
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: photo received`);
  ctx.reply('Робот пока что не умеет работать с фото и проигнорирует это сообщение.');
});
bot.on(message('video'), (ctx) => {
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: video received`);
  ctx.reply('Робот пока что не умеет работать с видео и проигнорирует это сообщение.');
});
bot.on(message('sticker'), (ctx) => {
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: sticker received`);
  ctx.reply('👍')
});
bot.on(message('voice'), async (ctx) => {
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: voice received`);

  // whait for 1-3 seconds and sendChatAction typing
  const delay = Math.floor(Math.random() * 3) + 1;
  setTimeout(() => {
    ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
  }
  , delay * 1000);

  try {
    const fileId = ctx.message.voice.file_id;

    // download the file
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({url, responseType: 'stream'});

    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(`./${fileId}.oga`))
        .on('error', reject)
        .on('finish', resolve);
    });
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: voice file downloaded`);

    await new Promise((resolve, reject) => {
      ffmpeg(`./${fileId}.oga`)
        .toFormat('mp3')
        .on('error', reject)
        .on('end', resolve)
        .saveToFile(`./${fileId}.mp3`);
    });
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: voice file converted`);

    // send the file to the OpenAI API for transcription
    const transcription = await createTranscriptionWithRetry(fs.createReadStream(`./${fileId}.mp3`));
    const transcriptionText = transcription.data.text;
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: transcription received.`);

    // download all related messages from the database
    let messages = await selectMessagesByChatIdGPTformat(ctx.chat.id);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: messages received from the database: ${messages.length}`);

    // Union the user message with messages
    messages = messages.concat({
      role: "user",
      content: transcriptionText,
    });

    // save the transcription to the database
    await insertMessage("user", transcriptionText, ctx.chat.id);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: new transcription saved to the database`);

    // Send this text to OpenAI's Chat GPT-4 model with retry logic
    const chatResponse = await createChatCompletionWithRetryAndReduceHistory(messages);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: chatGPT response received`);

    // save the answer to the database
    const answer = chatResponse.data.choices[0].message.content;
    await insertMessage("assistant", answer, ctx.chat.id);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: answer saved to the database`);

    // send the answer to the user
    ctx.reply(answer);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: answer sent to the user`);

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
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: voice files deleted`);
  } catch (e) {
    console.error(`[ERROR]: User: ${ctx.from.username}, Chat: ${ctx.chat.id}: error occurred: ${e}`, );
    ctx.reply(errorString);
  }
});

bot.on(message('text'), async (ctx) => {
  console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: text received.`);

  // whait for 1-3 seconds and sendChatAction typing
  const delay = Math.floor(Math.random() * 3) + 1;
  setTimeout(() => {
    ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
  }
  , delay * 1000);

  try {
    const userText = ctx.message.text;

    // download all related messages from the database
    let messages = await selectMessagesByChatIdGPTformat(ctx.chat.id);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: messages received from the database: ${messages.length}`);

    // save the message to the database
    await insertMessage("user", userText, ctx.chat.id);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: new message saved to the database`);

    // Union the user message with messages
    messages = messages.concat({
      role: "user",
      content: userText,
    });

    // Send this text to OpenAI's Chat GPT-4 model with retry logic
    let response = await createChatCompletionWithRetryAndReduceHistory(messages);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: chatGPT response received`);
  
    // save the answer to the database
    const answer = response.data.choices[0].message.content;
    await insertMessage("assistant", answer, ctx.chat.id);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: answer saved to the database`);

    // send the the answer to the user
    ctx.reply(answer);
    console.log(`User: ${ctx.from.username}, Chat: ${ctx.chat.id}: answer sent to the user`);
  } catch(e) {
    console.error(`[ERROR]: User: ${ctx.from.username}, Chat: ${ctx.chat.id}: error occurred: ${e}`, );
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
