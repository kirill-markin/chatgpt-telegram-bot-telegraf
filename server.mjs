import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import axios from 'axios';

import pkg_t from 'telegraf';
const { Telegraf } = pkg_t;
import { message, editedMessage, channelPost, editedChannelPost, callbackQuery } from "telegraf/filters";

import ffmpeg from 'fluent-ffmpeg';
import { Configuration, OpenAIApi } from 'openai';

if (fs.existsSync(".env")) {
  dotenv.config();
}

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.OPENAI_API_KEY) {
  throw new Error(
    "Please set the TELEGRAM_BOT_TOKEN and OPENAI_API_KEY environment variables"
  );
}

// Connect to the postgress database
import pkg_pg from 'pg';
const { Client } = pkg_pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
client.connect();

// FIXME: This is a temporary solution to the problem of the database not being created
// Select all the messages from the database
const selectAllMessages = async () => {
  const res = await client.query('SELECT * FROM messages');
  console.log(res.rows);
  return res.rows;
}
selectAllMessages();

const selectMessagesBuChatId = async (chatId) => {
  const res = await client.query('SELECT * FROM messages WHERE chat_id = $1', [chatId]);
  console.log(res.rows);
  return res.rows;
}

const insertMessage = async (role, content, chat_id) => {
  const res = await client.query('INSERT INTO messages (role, content, chat_id) VALUES ($1, $2, $3)', [role, content, chat_id]);
  console.log(res);
  return res;
}


// BOT

const configuration = new Configuration({
	apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.use(async (ctx, next) => {
  const start = new Date()
  await next()
  const ms = new Date() - start
  console.log(`New message from user ${ctx.from.username}. Response time - ${ms}`)
})

const helpString = 'Бот GPT Кирилла Маркина - голосовой помощник, который понимает аудиосообщения на русском языке 😊'
bot.start((ctx) => {
  ctx.reply(helpString)
});
bot.help((ctx) => {
  ctx.reply(helpString)
});

bot.command('reset', (ctx) => {
  ctx.reply('Старые сообщения удалены из памяти.')
});


bot.on(message('photo'), (ctx) => {
  ctx.reply('Робот пока что не умеет работать с фото и проигнорирует это сообщение.');
});
bot.on(message('video'), (ctx) => {
  ctx.reply('Робот пока что не умеет работать с видео и проигнорирует это сообщение.');
});
bot.on(message('sticker'), (ctx) => ctx.reply('👍'));

bot.on(message('voice'), (ctx) => {
  const fileId = ctx.message.voice.file_id;

  // download the file
  ctx.telegram.getFileLink(fileId)
    .then(url => {
      return axios({url, responseType: 'stream'});
    })
    .then(response => {
      return new Promise((resolve, reject) => {
        // console.log(`Attempting to write to: ./${fileId}.oga`);
        response.data.pipe(fs.createWriteStream(`./${fileId}.oga`))
          .on('error', e => {
            console.error("An error has occurred:", e);
            reject(e); // Reject promise on error
          })
          .on('finish', () => {
            // console.log("File is saved.");
            resolve(); // Resolve promise when download is finished
          });
      });
    })
    .catch(e => {
      console.error("An error has occurred during the file download process:", e);
    })
    
    .then(() => {
      return new Promise((resolve, reject) => {
        ffmpeg(`./${fileId}.oga`)
          .toFormat('mp3')
          .on('error', (err) => {
            console.error('An error occurred: ' + err.message);
            reject(err);
          })
          .on('end', () => {
            // console.log('Processing finished !');
            resolve();
          })
          .saveToFile(`./${fileId}.mp3`);
          return;
      });
    })
    .catch(e => {
      console.error("An error has occurred during the file conversion process:", e);
    })

    // send the file to the OpenAI API fot transcription
    .then((response) => {
      const transcription = openai.createTranscription(
        fs.createReadStream(`./${fileId}.mp3`),
        "whisper-1"
      );
      return transcription;
    })
    .catch(e => {
      console.error("An error has occurred during the transcription process:", e);
    })

    // save the transcription to the database
    .then((response) => {
      const transcription = response.data.text;
      insertMessage("user", transcription, ctx.chat.id);
      return transcription;
    })

    // send text to chatGPT-4 for completion
    .then((transcription) => {
      return openai.createChatCompletion({
        model: "gpt-4",
        messages: [
          {
            role: "user", 
            content: transcription,
          },
        ],
        temperature: 0.7,
      });
    })
    .catch(e => {
      console.error("An error has occurred during the chatGPT completion process:", e);
    })

    // save the answer to the database
    .then((response) => {
      const answer = response.data.choices[0].message.content;
      insertMessage("assistant", answer, ctx.chat.id);
      return answer;
    })
    
    // send the the answer to the user
    .then((answer) => {
      ctx.reply(answer);
    })

    // Delete both files
    .then(() => {
      fs.unlink(`./${fileId}.oga`, (err) => {
        if (err) {
          console.error(err)
          return
        }
      })
      fs.unlink(`./${fileId}.mp3`, (err) => {
        if (err) {
          console.error(err)
          return
        }
      })
    })
    .catch(e => {
      console.error("An error has occurred during the file deletion process:", e);
    })

});

bot.on(message('text'), (ctx) => {
  const userText = ctx.message.text;
  
  // Send this text to OpenAI's Chat GPT-4 model
  openai.createChatCompletion({
    model: "gpt-4",
    messages: [
      {
        role: "user", 
        content: userText,
      },
    ],
    temperature: 0.7,
  })
  .catch(e => {
    console.error("An error has occurred during the chatGPT completion process:", e);
  })
  
  // send the the answer to the user
  .then((response) => {
    ctx.reply(response.data.choices[0].message.content);
  })

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
