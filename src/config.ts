import dotenv from "dotenv";
import fs from "fs";
import yaml from 'yaml';
import { Prompt } from "./types";

if (fs.existsSync(".env")) {
  dotenv.config();
}

if (
  typeof process.env.OPENAI_API_KEY !== 'string' ||
  typeof process.env.DATABASE_URL !== 'string' ||
  typeof process.env.TELEGRAM_BOT_TOKEN !== 'string'
) {
  throw new Error('OPENAI_API_KEY and DATABASE_URL and TELEGRAM_BOT_TOKEN must be defined');
}

export const DATABASE_URL : string = process.env.DATABASE_URL;
export const OPENAI_API_KEY : string = process.env.OPENAI_API_KEY;
export const TELEGRAM_BOT_TOKEN : string = process.env.TELEGRAM_BOT_TOKEN;

export const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
export const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;

const prompts_path = process.env.SETTINGS_PATH || './settings/private_en.yaml';
const fileContents = fs.readFileSync(prompts_path, 'utf8');
const bot_settings = yaml.parse(fileContents);

export const GPT_MODEL = bot_settings.gpt_model;
export const maxTokensThreshold = 128_000;
export const averageAnswerTokens = 8_000;
export const maxTokensThresholdToReduceHistory = maxTokensThreshold - averageAnswerTokens;
export const RESET_MESSAGE = bot_settings.strings.reset_message || 'Old messages deleted';
export const NO_OPENAI_KEY_ERROR = bot_settings.strings.no_openai_key_error || 'No OpenAI key provided. Please contact the bot owner.';
export const TRIAL_ENDED_ERROR = bot_settings.strings.trial_ended_error || 'Trial period ended. Please contact the bot owner.';
export const NO_VIDEO_ERROR = bot_settings.strings.no_video_error || 'Bot can not process videos.';
export const NO_ANSWER_ERROR = bot_settings.strings.no_answer_error || 'Bot can not answer to this message.';
export const maxTrialsTokens = bot_settings.max_trials_tokens || 200_000;
export const helpString = bot_settings.strings.help_string;
export const errorString = bot_settings.strings.error_string;
export const botSettings = bot_settings;
export const timeoutMsDefaultchatGPT = 6*60*1000;
export const defaultPrompt: Prompt | undefined = botSettings.prompts.find((prompt: Prompt) => prompt.name === 'default');
export const defaultPromptMessage = defaultPrompt ? defaultPrompt.text : '';
