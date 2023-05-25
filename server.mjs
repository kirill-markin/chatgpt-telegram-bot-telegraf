import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import pkg from 'telegraf';
const { Telegraf } = pkg;

if (fs.existsSync(".env")) {
  dotenv.config();
}

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  throw new Error(
    "Please set the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables"
  );
}

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 5000;
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const router = express.Router();

async function sendMessage(message, buttontext, buttonurl) {
  await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message, {
    parse_mode: "html",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: buttontext,
            url: buttonurl,
          },
        ],
      ],
    },
  });
}

// bot.start((ctx) => ctx.reply('Welcome'))
// bot.help((ctx) => ctx.reply('Send me a sticker'))
// bot.on('sticker', (ctx) => ctx.reply('👍'))
// bot.hears('hi', (ctx) => ctx.reply('Hey there'))
// bot.command('oldschool', (ctx) => ctx.reply('Hello'))
// bot.launch()

bot.use(async (ctx, next) => {
  const start = new Date()
  await next()
  const ms = new Date() - start
  console.log('Response time: %sms', ms)
})

bot.on('text', (ctx) => ctx.reply('Робот на обслуживании. Кирилл его дописывает. Обратитесь попозже.'))
bot.launch()

router.post("/webhook", (req, res) => {
  let data = req.body;
  if (data.type === "DEPLOY" && data.status === "SUCCESS") {
    sendMessage(
      `<b>Deployment: ${data.project.name}</b>\n\✅ Status: <code>${data.status}</code>\n🌳 Environment: <code>${data.environment.name}</code>\n👨‍💻 Creator: <code>${data.deployment.creator.name}</code>`,
      "View Deployment",
      `https://railway.app/project/${data.project.id}/`
    );
  } else if (data.type === "DEPLOY" && data.status === "BUILDING") {
    sendMessage(
      `<b>Deployment: ${data.project.name}</b>\n\⚒️ Status: <code>${data.status}</code>\n🌳 Environment: <code>${data.environment.name}</code>\n👨‍💻 Creator: <code>${data.deployment.creator.name}</code>`,
      "View Deployment",
      `https://railway.app/project/${data.project.id}/`
    );
  } else if (data.type === "DEPLOY" && data.status === "DEPLOYING") {
    sendMessage(
      `<b>Deployment: ${data.project.name}</b>\n\🚀 Status: <code>${data.status}</code>\n🌳 Environment: <code>${data.environment.name}</code>\n👨‍💻 Creator: <code>${data.deployment.creator.name}</code>`,
      "View Deployment",
      `https://railway.app/project/${data.project.id}/`
    );
  } else if (data.type === "DEPLOY" && data.status === "CRASHED") {
    sendMessage(
      `<b>Deployment: ${data.project.name}</b>\n\❌ Status: <code>${data.status}</code>\n🌳 Environment: <code>${data.environment.name}</code>\n👨‍💻 Creator: <code>${data.deployment.creator.name}</code>`,
      "View Deployment",
      `https://railway.app/project/${data.project.id}/`
    );
  } else {
    console.log("Unknown event: ", data);
  }
  res.sendStatus(200);
});

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