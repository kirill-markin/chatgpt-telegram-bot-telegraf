import OpenAI from 'openai';
import { MyContext, MyMessage, UserData } from './types';
import { AxiosResponse } from 'axios';
import pTimeout from 'p-timeout';
import { toLogFormat, encodeText, decodeTokens } from './utils';
import { timeoutMsDefaultchatGPT, GPT_MODEL, maxTokensThresholdToReduceHistory, defaultPromptMessage } from './config';
import { usedTokensForUser, insertUserOrUpdate, selectUserByUserId } from './database';
import { maxTrialsTokens, OPENAI_API_KEY } from './config';

class NoOpenAiApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoOpenAiApiKeyError';
  }
}

// default prompt message to add to the GPT model

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

export async function ensureUserSettingsAndRetrieveOpenAi(ctx: MyContext): Promise<UserData> {
  if (ctx.from && ctx.from.id) {
    const user_id = ctx.from.id;
    let userSettings = await selectUserByUserId(user_id);
    if (!userSettings) {
      // If the user is not found, create new settings
      userSettings = {
        user_id: user_id,
        username: ctx.from?.username || null,
        default_language_code: ctx.from?.language_code || null,
        language_code: ctx.from?.language_code || null,
      };
      await insertUserOrUpdate(userSettings); // Insert the new user
      console.log(toLogFormat(ctx, "User created in the database"));
    } else {
      // If the user is found, update their data
      userSettings.username = ctx.from?.username || userSettings.username;
      userSettings.default_language_code = ctx.from?.language_code || userSettings.default_language_code;
      userSettings.language_code = ctx.from?.language_code || userSettings.language_code;
      await insertUserOrUpdate(userSettings); // Update the user's data
      console.log(toLogFormat(ctx, "User data updated in the database"));
    }

    // Check if user has openai_api_key or is premium
    if (userSettings.openai_api_key) { // custom api key
      console.log(toLogFormat(ctx, `[ACCESS GRANTED] user has custom openai_api_key.`));
    } else if (userSettings.usage_type === 'premium') { // premium user
      userSettings.openai_api_key = OPENAI_API_KEY;
      console.log(toLogFormat(ctx, `[ACCESS GRANTED] user is premium but has no custom openai_api_key. openai_api_key set from environment variable.`));
    } else { // no access or trial
      const usedTokens = await usedTokensForUser(user_id);
      if (usedTokens < maxTrialsTokens) {
        userSettings.usage_type = 'trial_active';
        await insertUserOrUpdate(userSettings);
        userSettings.openai_api_key = OPENAI_API_KEY;
        console.log(toLogFormat(ctx, `[ACCESS GRANTED] user is trial and user did not exceed the message limit. User used tokens: ${usedTokens} out of ${maxTrialsTokens}. openai_api_key set from environment variable.`));
      } else {
        userSettings.usage_type = 'trial_ended';
        await insertUserOrUpdate(userSettings);
        console.log(toLogFormat(ctx, `[ACCESS DENIED] user is not premium and has no custom openai_api_key and exceeded the message limit. User used tokens: ${usedTokens} out of ${maxTrialsTokens}.`));
        throw new NoOpenAiApiKeyError(`User with user_id ${user_id} has no openai_api_key`);
      }
    }

    
    const openai = new OpenAI({
      apiKey: userSettings.openai_api_key,
    });
    return {settings: userSettings, openai: openai}
  } else {
    throw new Error('ctx.from.id is undefined');
  }
}

async function createChatCompletionWithRetry(messages: MyMessage[], openai: OpenAI, retries = 5, timeoutMs = timeoutMsDefaultchatGPT) {
  for (let i = 0; i < retries; i++) {
    try {
      const chatGPTAnswer = await pTimeout(
        openai.chat.completions.create({
          model: GPT_MODEL,
          messages: messages,
          temperature: 0.7,
          // max_tokens: 1000,
        }),
        timeoutMs,
      );

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

export function reduceHistoryWithTokenLimit(
  messages: MyMessage[],
  maxTokens: number,
): MyMessage[] {
  let totalTokenCount = 0;

  const messagesCleaned = messages.reduceRight<MyMessage[]>((acc, message) => {
    const tokens = encodeText(message.content);
    if (totalTokenCount + tokens.length <= maxTokens) {
      acc.unshift(message); // Prepend to keep the original order
      totalTokenCount += tokens.length;
    } else {
      const tokensAvailable = maxTokens - totalTokenCount;
      if (tokensAvailable > 0) {
        const partialTokens = tokens.slice(-tokensAvailable);
        const partialContent = decodeTokens(partialTokens);
        acc.unshift({ ...message, content: partialContent });
        totalTokenCount += tokensAvailable;
      }
      return acc;
    }
    return acc;
  }, []);

  return messagesCleaned;
}

export async function createChatCompletionWithRetryReduceHistoryLongtermMemory(
  ctx: MyContext,
  messages: MyMessage[],
  openai: OpenAI,
  pineconeIndex: any,
  retries = 5,
  timeoutMs = timeoutMsDefaultchatGPT
): Promise<AxiosResponse<OpenAI.Chat.Completions.ChatCompletion, any> | undefined> {
  try {
    // Add long-term memory to the messages based on pineconeIndex
    let referenceMessageObj: MyMessage | undefined = undefined;
    if (pineconeIndex) {
      const userMessages = messages.filter((message) => message.role === "user");
      const maxContentLength: number = 8192 - userMessages.length; // to add '\n' between messages
      // Make the embedding request and return the result
      const userMessagesCleaned = reduceHistoryWithTokenLimit(
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

      const referenceText = 
        "Related to this conversation document parts:\n" + 
        queryResponse.matches.map((match: any) => match.metadata.text).join('\n');

      referenceMessageObj = {
        role: "assistant",
        content: referenceText,
      } as MyMessage;

      console.log(toLogFormat(ctx, `referenceMessage added to the messages with ${queryResponse.matches.length} matches and ${referenceText.length} characters.`));
    }

    // Tokenize and account for default prompt and reference message
    const defaultPromptTokens = defaultPromptMessageObj ? encodeText(defaultPromptMessageObj.content) : new Uint32Array();
    const referenceMessageTokens = referenceMessageObj ? encodeText(referenceMessageObj.content) : new Uint32Array();

    const adjustedTokenThreshold = maxTokensThresholdToReduceHistory - defaultPromptTokens.length - referenceMessageTokens.length;
    if (adjustedTokenThreshold <= 0) {
      throw new Error('Token threshold exceeded by default prompt and reference message.');
    }
    console.log(toLogFormat(ctx, `adjustedTokenThreshold: ${adjustedTokenThreshold}`));

    // Reduce history using tokens
    const messagesCleaned = reduceHistoryWithTokenLimit(
      messages,
      adjustedTokenThreshold,
    );

    // DEBUG: Uncomment to see hidden and user messages in logs
    // console.log(`messagesCleaned: ${JSON.stringify(messagesCleaned, null, 2)}`);

    let finalMessages = [defaultPromptMessageObj].filter(Boolean); // Ensure we don't include undefined
    if (referenceMessageObj) {
      finalMessages.push(referenceMessageObj);
    }
    finalMessages = finalMessages.concat(messagesCleaned);

    // Calculate the total length of tokens for messagesCleaned
    const messagesCleanedTokens = messagesCleaned.map((message) => encodeText(message.content));
    const messagesCleanedTokensTotalLength = messagesCleanedTokens.reduce((sum, tokens) => sum + tokens.length, 0);
    
    console.log(toLogFormat(ctx, `defaultPromptTokens: ${defaultPromptTokens.length}, referenceMessageTokens: ${referenceMessageTokens.length}, messagesCleanedTokens: ${messagesCleanedTokensTotalLength}, total: ${defaultPromptTokens.length + referenceMessageTokens.length + messagesCleanedTokensTotalLength} tokens.`));

    // DEBUG: Uncomment to see hidden and user messages in logs
    // console.log(`finalMessages: ${JSON.stringify(finalMessages, null, 2)}`);

    const chatGPTAnswer = await createChatCompletionWithRetry(
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
export function createTranscriptionWithRetry(fileStream: File, openai: OpenAI, retries = 3): Promise<any> {
  return openai.audio.transcriptions.create({ model: "whisper-1", file: fileStream })
    .catch((error) => {
      if (retries === 0) {
        throw error;
      }
      console.error(`openai.createTranscription failed. Retries left: ${retries}`);
      return createTranscriptionWithRetry(fileStream, openai, retries - 1);
    });
}
