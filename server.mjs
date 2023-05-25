import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import pkg from 'telegraf';
const { Telegraf } = pkg;
import { message, editedMessage, channelPost, editedChannelPost, callbackQuery } from "telegraf/filters";


if (fs.existsSync(".env")) {
  dotenv.config();
}

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error(
    "Please set the TELEGRAM_BOT_TOKEN environment variables"
  );
}


// BOT

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.use(async (ctx, next) => {
  const start = new Date()
  await next()
  const ms = new Date() - start
  console.log('New message. Response time: %sms', ms)
})

bot.start((ctx) => {
  ctx.reply('Бот GPT Кирилла Маркина - голосовой помощник, который понимает аудиосообщения на русском языке 😊')
});
bot.help((ctx) => {
  ctx.reply('Бот GPT Кирилла Маркина - голосовой помощник, который понимает аудиосообщения на русском языке 😊')
});
bot.command('reset', (ctx) => {
  ctx.reply('Старые сообщения удалены из памяти.')
});
bot.on('message', (ctx) => {
  ctx.reply('Робот на обслуживании. Кирилл его дописывает. Обратитесь попозже.');
});

bot.launch()


// APP

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
    console.log(err);
  }
  console.log(`Server listening on port ${PORT}`);
});