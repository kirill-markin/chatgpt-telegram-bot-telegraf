import OpenAI from 'openai';
import { MyContext, MyMessage, MyMessageContent, UserData } from './types';
import { AxiosResponse } from 'axios';
import pTimeout from 'p-timeout';
import { formatLogMessage } from './utils/utils';
import { tokenizeText, convertTokensToText } from './utils/encodingUtils';
import { CHAT_GPT_DEFAULT_TIMEOUT_MS, GPT_MODEL, MAX_TOKENS_THRESHOLD_TO_REDUCE_HISTORY, DEFAULT_PROMPT_MESSAGE } from './config';
import { getUserUsedTokens, upsertUserIfNotExists, getUserByUserId } from './database/database';
import { MAX_TRIAL_TOKENS, OPENAI_API_KEY } from './config';
import { truncateMessages } from "./utils/messageUtils";

export const APPROX_IMAGE_TOKENS = 800;

// default prompt message to add to the GPT model

let defaultPromptMessageObj = {} as MyMessage;
const defaultPromptMessageString = DEFAULT_PROMPT_MESSAGE?.toString();
if (DEFAULT_PROMPT_MESSAGE) {
  defaultPromptMessageObj = {
    "role": "assistant",
    "content": defaultPromptMessageString,
  } as MyMessage;
} else {
  console.log('Default prompt message not found');
}

// OpenAI functions

export async function getUserSettingsAndOpenAi(ctx: MyContext): Promise<UserData> {
  try {
    if (ctx.from && ctx.from.id) {
      const user_id = ctx.from.id;
      let userSettings = await getUserByUserId(user_id);
      if (!userSettings) {
        // If the user is not found, create new settings
        userSettings = {
          user_id: user_id,
          username: ctx.from?.username || null,
          default_language_code: ctx.from?.language_code || null,
          language_code: ctx.from?.language_code || null,
        };
        await upsertUserIfNotExists(userSettings); // Insert the new user
        console.log(formatLogMessage(ctx, "User created in the database"));
      } else {
        // If the user is found, update their data
        userSettings.username = ctx.from?.username || userSettings.username;
        userSettings.default_language_code = ctx.from?.language_code || userSettings.default_language_code;
        userSettings.language_code = ctx.from?.language_code || userSettings.language_code;
        await upsertUserIfNotExists(userSettings); // Update the user's data
        console.log(formatLogMessage(ctx, "User data updated in the database"));
      }

      let openai: OpenAI | null = new OpenAI({
        apiKey: userSettings.openai_api_key,
      });
      
      // Check if user has openai_api_key or is premium
      if (userSettings.openai_api_key) { // custom api key
        console.log(formatLogMessage(ctx, `[ACCESS GRANTED] user has custom openai_api_key.`));
      } else if (userSettings.usage_type === 'premium') { // premium user
        userSettings.openai_api_key = OPENAI_API_KEY;
        console.log(formatLogMessage(ctx, `[ACCESS GRANTED] user is premium but has no custom openai_api_key. openai_api_key set from environment variable.`));
      } else { // no access or trial
        const usedTokens = await getUserUsedTokens(user_id);
        if (usedTokens < MAX_TRIAL_TOKENS) {
          userSettings.usage_type = 'trial_active';
          await upsertUserIfNotExists(userSettings);
          userSettings.openai_api_key = OPENAI_API_KEY;
          console.log(formatLogMessage(ctx, `[ACCESS GRANTED] user is trial and user did not exceed the message limit. User used tokens: ${usedTokens} out of ${MAX_TRIAL_TOKENS}. openai_api_key set from environment variable.`));
        } else {
          userSettings.usage_type = 'trial_ended';
          await upsertUserIfNotExists(userSettings);
          console.warn(formatLogMessage(ctx, `[ACCESS DENIED] user is not premium and has no custom openai_api_key and exceeded the message limit. User used tokens: ${usedTokens} out of ${MAX_TRIAL_TOKENS}.`));
          openai = null;
        }
      }

      return {settings: userSettings, openai: openai}
    } else {
      throw new Error('ctx.from.id is undefined');
    }
  } catch (error) {
    throw error;
  }
}

async function createChatCompletionWithRetries(messages: MyMessage[], openai: OpenAI, retries = 5, timeoutMs = CHAT_GPT_DEFAULT_TIMEOUT_MS) {
  for (let i = 0; i < retries; i++) {
    try {
      const chatGPTAnswer = await pTimeout(
        openai.chat.completions.create({
          model: GPT_MODEL,
          // @ts-ignore
          messages: messages,
          temperature: 0.7,
          // max_tokens: 1000,
        }),
        timeoutMs,
      );

      // DEBUG: Uncomment to see the response in logs
      // console.log(`chatGPTAnswer: ${JSON.stringify(truncateMessages(chatGPTAnswer), null, 2)}`);

      // Assuming the API does not use a status property in the response to indicate success
      return chatGPTAnswer;
    } catch (error) {
      if (error instanceof pTimeout.TimeoutError) {
        console.error(`openai.createChatCompletion timed out. Retries left: ${retries - i - 1}`);
      } else if (error instanceof OpenAI.APIError) {
        console.error(`openai.createChatCompletion failed. Retries left: ${retries - i - 1}`);
        console.error(error.status);  // e.g. 401
        console.error(error.message); // e.g. The authentication token you passed was invalid...
        console.error(error.code);    // e.g. 'invalid_api_key'
        console.error(error.type);    // e.g. 'invalid_request_error'
      } else {
        // Non-API and non-timeout error
        console.error(error);
      }
      
      if (i === retries - 1) throw error;
    }
  }
}

export function truncateHistoryToTokenLimit(
  ctx: MyContext,
  messages: MyMessage[],
  maxTokens: number,
): MyMessage[] {
  let initialTokenCount = 0;
  let resultTokenCount = 0;
  
  // Count the initial number of tokens
  messages.forEach(message => {
    if (Array.isArray(message.content)) {
      message.content.forEach(part => {
        if (part.type === 'text') {
          const tokens = tokenizeText(part.text!);
          initialTokenCount += tokens.length;
        } else if (part.type === 'image_url') {
          initialTokenCount += APPROX_IMAGE_TOKENS;
        }
      });
    } else {
      const tokens = tokenizeText(message.content);
      initialTokenCount += tokens.length;
    }
  });

  const messagesCleaned = messages.reduceRight<MyMessage[]>((acc, message) => {
    let messageTokenCount = 0;
    if (Array.isArray(message.content)) {
      let newContent: MyMessageContent[] = [];

      for (let i = message.content.length - 1; i >= 0; i--) {
        const part = message.content[i];
        if (part.type === 'text') {
          const tokens = tokenizeText(part.text!);
          messageTokenCount += tokens.length;

          if (resultTokenCount + messageTokenCount <= maxTokens) {
            newContent.unshift(part);
            resultTokenCount += tokens.length;
          } else {
            const tokensAvailable = maxTokens - resultTokenCount;
            if (tokensAvailable > 0) {
              const partialTokens = tokens.slice(0, tokensAvailable);
              const partialContent = convertTokensToText(partialTokens);
              newContent.unshift({ ...part, text: partialContent });
              resultTokenCount += tokensAvailable;
            }
            break;
          }
        } else if (part.type === 'image_url') {
          const imageTokenCount = APPROX_IMAGE_TOKENS;
          if (resultTokenCount + imageTokenCount <= maxTokens) {
            newContent.unshift(part);
            messageTokenCount += imageTokenCount;
            resultTokenCount += imageTokenCount;
          } else {
            break; // Skip the entire image message part if it exceeds the limit
          }
        }
      }

      if (newContent.length > 0) {
        acc.unshift({ ...message, content: newContent });
      }
    } else {
      const tokens = tokenizeText(message.content);
      if (resultTokenCount + tokens.length <= maxTokens) {
        acc.unshift(message);
        resultTokenCount += tokens.length;
      } else {
        const tokensAvailable = maxTokens - resultTokenCount;
        if (tokensAvailable > 0) {
          const partialTokens = tokens.slice(0, tokensAvailable);
          const partialContent = convertTokensToText(partialTokens);
          acc.unshift({ ...message, content: partialContent });
          resultTokenCount += tokensAvailable;
          console.log(formatLogMessage(ctx, `Partial tokens added (message.content): ${tokensAvailable}, resultTokenCount: ${resultTokenCount}`));
        }
        return acc;
      }
    }
    return acc;
  }, []);

  return messagesCleaned;
}

export function countTotalTokens(messages: MyMessage[]): number {
  return messages.reduce((total, message) => {
    if (Array.isArray(message.content)) {
      const messageTokens = message.content.reduce((msgTotal, part) => {
        if (part.type === 'text') {
          return msgTotal + tokenizeText(part.text!).length;
        } else if (part.type === 'image_url') {
          return msgTotal + APPROX_IMAGE_TOKENS;
        }
        return msgTotal;
      }, 0);
      return total + messageTokens;
    } else {
      return total + tokenizeText(message.content).length;
    }
  }, 0);
}

export async function createCompletionWithRetriesAndMemory(
  ctx: MyContext,
  messages: MyMessage[],
  openai: OpenAI,
  pineconeIndex: any,
  retries = 5,
  timeoutMs = CHAT_GPT_DEFAULT_TIMEOUT_MS
): Promise<AxiosResponse<OpenAI.Chat.Completions.ChatCompletion, any> | undefined> {
  try {
    // Add long-term memory to the messages based on pineconeIndex
    let referenceMessageObj: MyMessage | undefined = undefined;
    let referenceTextString : string = "";
    if (pineconeIndex) {
      const userMessages = messages.filter((message) => message.role === "user");
      const maxContentLength: number = 8192 - userMessages.length; // to add '\n' between messages
      // Make the embedding request and return the result
      const userMessagesCleaned = truncateHistoryToTokenLimit(
        ctx,
        userMessages,
        maxContentLength,
      )
      const userMessagesCleanedText = userMessagesCleaned.map((message) => message.content).join('\n');

      const resp = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: userMessagesCleanedText,
      });
      const embedding = resp?.data?.[0]?.embedding || null;

      const queryRequest = {
        vector: embedding,
        topK: 50,
        includeValues: false,
        includeMetadata: true,
      };
      const queryResponse = await pineconeIndex.query(queryRequest);

      referenceTextString =
        "Related to this conversation document parts:\n" + 
        queryResponse.matches.map((match: any) => match.metadata.text).join('\n');

      referenceMessageObj = {
        role: "assistant",
        content: referenceTextString,
      } as MyMessage;

      console.log(formatLogMessage(ctx, `referenceMessage added to the messages with ${queryResponse.matches.length} matches and ${referenceTextString.length} characters.`));
    }

    // Tokenize and account for default prompt and reference message
    const defaultPromptTokens = defaultPromptMessageObj ? tokenizeText(defaultPromptMessageString) : new Uint32Array();
    const referenceMessageTokens = referenceMessageObj ? tokenizeText(referenceTextString) : new Uint32Array();

    const adjustedTokenThreshold = MAX_TOKENS_THRESHOLD_TO_REDUCE_HISTORY - defaultPromptTokens.length - referenceMessageTokens.length;
    if (adjustedTokenThreshold <= 0) {
      throw new Error('Token threshold exceeded by default prompt and reference message.');
    }

    // Reduce history using tokens
    const messagesCleaned = truncateHistoryToTokenLimit(
      ctx,
      messages,
      adjustedTokenThreshold,
    );
    
    // DEBUG: Uncomment to see hidden and user messages in logs
    // console.log(`messagesCleaned: ${JSON.stringify(truncateMessages(messagesCleaned), null, 2)}`);

    let finalMessages = [defaultPromptMessageObj].filter(Boolean); // Ensure we don't include undefined
    if (referenceMessageObj) {
      finalMessages.push(referenceMessageObj);
    }
    finalMessages = finalMessages.concat(messagesCleaned);

    // Calculate total tokens
    const messagesCleanedTokensTotalLength = countTotalTokens(messagesCleaned);
    console.log(
      formatLogMessage(
        ctx, 
        `defaultPromptTokens: ${defaultPromptTokens.length}, referenceMessageTokens: ${referenceMessageTokens.length}, messagesCleanedTokens: ${messagesCleanedTokensTotalLength}, total: ${defaultPromptTokens.length + referenceMessageTokens.length + messagesCleanedTokensTotalLength} tokens out of ${MAX_TOKENS_THRESHOLD_TO_REDUCE_HISTORY}`
      )
    );
    
    // DEBUG: Uncomment to see hidden and user messages in logs
    // console.log(`finalMessages: ${JSON.stringify(truncateMessages(finalMessages), null, 2)}`);

    const chatGPTAnswer = await createChatCompletionWithRetries(
      finalMessages,
      openai,
      retries,
      timeoutMs
    );
    return chatGPTAnswer as AxiosResponse<OpenAI.Chat.Completions.ChatCompletion, any> | undefined;
  } catch (error) {
    throw error;
  }
}

export function transcribeAudioWithRetries(fileStream: File, openai: OpenAI, retries = 3): Promise<any> {
  return openai.audio.transcriptions.create({ model: "whisper-1", file: fileStream })
    .catch((error) => {
      if (retries === 0) {
        throw error;
      }
      console.error(`openai.createTranscription failed. Retries left: ${retries}`);
      return transcribeAudioWithRetries(fileStream, openai, retries - 1);
    });
}
