import fs from "fs";
import axios from "axios";
import { MyContext, MyMessage, UserData, NoOpenAiApiKeyError } from "./types";
import { ERROR_MESSAGE, MAX_TRIAL_TOKENS, NO_VIDEO_ERROR } from './config';
import { 
  formatLogMessage, 
} from "./utils/utils";
import { 
  getUserSettingsAndOpenAi,
} from './openAIFunctions';
import { truncateMessages } from "./utils/messageUtils";
import { 
  sendResponse,
  sendSplitMessage,
  sendTypingActionPeriodically,
  reply,
} from "./utils/responseUtils";
import { 
  storeAnswer, 
  getAndConvertMessagesByChatId, 
  // addSimpleEvent,
  addMessagesBatch,
} from "./database/database";
import { 
  createCompletionWithRetriesAndMemory, 
  transcribeAudioWithRetries 
} from './openAIFunctions';
import { convertAudioToMp3, convertImageToBase64, resizeImageFile } from './utils/fileUtils';
import { generateMessageBufferKey } from './utils/messageUtils';
import { pineconeIndex } from './vectorDatabase';
import { TRIAL_ENDED_ERROR, TRIAL_NOT_ENABLED_ERROR } from './config';
import { Message } from 'telegraf/types';


// Temporary message buffer
const messageBuffers = new Map<string, { messages: MyMessage[], timer: NodeJS.Timeout | null }>();

export async function saveMessagesToDatabase(ctx: MyContext, messages: MyMessage[]) {
  console.log(formatLogMessage(ctx, `Saving ${messages.length} messages to the database`));

  try {
    await addMessagesBatch(messages);
    console.log(formatLogMessage(ctx, `Messages saved to the database`));
  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error in saving messages to the database: ${error}`));
    throw error;
  }
}

export async function handleErrorMessage(ctx: MyContext, e: Error | any) {
  if (e instanceof NoOpenAiApiKeyError) {
    console.warn(formatLogMessage(ctx, `[WARN] error occurred: ${e}`));
    let messageToUser = TRIAL_NOT_ENABLED_ERROR;
    if (MAX_TRIAL_TOKENS > 0) {
      messageToUser = TRIAL_ENDED_ERROR
    }
    await reply(ctx, messageToUser, 'error occurred');
  } else {
    console.error(formatLogMessage(ctx, `[ERROR] error occurred: ${e}`));
    await reply(ctx, ERROR_MESSAGE, 'error occurred');
  }
  return;
}

export async function handleAnyMessage(ctx: MyContext, messageType: string) {
  console.log(formatLogMessage(ctx, `[NEW] ${messageType} received`));

  try {
    const key = generateMessageBufferKey(ctx);
    const messageData = messageBuffers.get(key) || { messages: [], timer: null };

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (userId === undefined || userId === null || chatId === undefined || chatId === null) {
      throw new Error('userId or chatId is undefined');
    }

    if (messageType === 'voice') {
      const transcriptionText = await handleVoiceMessage(ctx);
      messageData.messages.push({ role: 'user', content: transcriptionText, chat_id: chatId, user_id: userId });
    } else if (messageType === 'audio') {
      // @ts-ignore
      const fileId = ctx.message?.audio?.file_id;
      // @ts-ignore
      const mimeType = ctx.message?.audio?.mime_type;

      if (fileId && mimeType) {
        const transcriptionText = await handleAudioFile(ctx, fileId, mimeType);
        messageData.messages.push({ role: 'user', content: transcriptionText, chat_id: chatId, user_id: userId });
      } else {
        throw new Error('fileId or mimeType is undefined');
      }
    } else if (messageType === 'photo') {
      const base64Content = await handlePhotoMessage(ctx);
      messageData.messages.push({ role: 'user', content: base64Content, chat_id: chatId, user_id: userId });
      // @ts-ignore
      const caption = ctx.message?.caption;
      if (caption) {
        messageData.messages.push({ role: 'user', content: caption, chat_id: chatId, user_id: userId });
      }
    } else if (messageType === 'text') {
      // @ts-ignore
      const text = ctx.message?.text;
      if (!text) {
        throw new Error('ctx.message.text is undefined');
      }
      messageData.messages.push({ role: 'user', content: text, chat_id: chatId, user_id: userId });
    } else if (messageType === 'document') {
      // @ts-ignore
      const fileId = ctx.message?.document?.file_id;
      // @ts-ignore
      const fileName = ctx.message?.document?.file_name;
      // @ts-ignore
      const mimeType = ctx.message?.document?.mime_type;

      if (fileId && mimeType) {
        if (mimeType.startsWith('audio/')) {
          const transcriptionText = await handleAudioFile(ctx, fileId, mimeType);
          messageData.messages.push({ role: 'user', content: transcriptionText, chat_id: chatId, user_id: userId });
        } else {
          console.log(formatLogMessage(ctx, `File received: ${fileName} (${mimeType})`));
          reply(ctx, 'I can only process audio files and compressed photos for now.', 'unsupported file type');
        }
      } else {
        console.error(formatLogMessage(ctx, 'Received file, but file_id or mimeType is undefined'));
      }
    } else if (messageType === 'video') {
      console.log(formatLogMessage(ctx, `video received`));
      reply(ctx, NO_VIDEO_ERROR, 'video received');
      // addSimpleEvent(ctx, 'user_message', 'user', 'video');
    } else if (messageType === 'sticker') {
      console.log(formatLogMessage(ctx, `sticker received`));
      reply(ctx, '👍', 'sticker received');
      // addSimpleEvent(ctx, 'user_message', 'user', 'sticker');
    } else {
      throw new Error(`Unsupported message type: ${messageType}`);
    }

    // Clear the old timer
    if (messageData.timer) {
      clearTimeout(messageData.timer);
    }

    // Set a new timer
    messageData.timer = setTimeout(async () => {
      try {
        const messagesToSave = messageData.messages;
        messageData.messages = []; // Clear the messages array

        // Save all messages to the database at once
        await saveMessagesToDatabase(ctx, messagesToSave);

        // Process the messages and send a reply
        const userData: UserData = await getUserSettingsAndOpenAi(ctx);
        if (!userData.openai) {
          throw new NoOpenAiApiKeyError("OpenAI API key is not set");
        }
        await replyToUser(ctx, userData, pineconeIndex);
      } catch (e: Error | any) {
        await handleErrorMessage(ctx, e);
      }
    }, 4000);

    // Save the message buffer
    messageBuffers.set(key, messageData);
  } catch (e: Error | any) {
    await handleErrorMessage(ctx, e);
  }
}

export async function replyToUser(ctx: MyContext, userData: UserData, pineconeIndex: any) {
  const stopTyping = await sendTypingActionPeriodically(ctx, 5000); // Start the typing action
  try {
    let messages: MyMessage[] = await getAndConvertMessagesByChatId(ctx);

    // DEBUG: messages to console in a pretty format JSON with newlines
    // console.log(`messages: ${JSON.stringify(truncateMessages(messages), null, 2)}`);

    if (!userData.openai) {
      throw new NoOpenAiApiKeyError("OpenAI API key is not set");
    }
    const chatResponse: any = await createCompletionWithRetriesAndMemory(
      ctx,
      messages,
      userData.openai,
      pineconeIndex,
    );

    storeAnswer(chatResponse, ctx, userData);
    await sendResponse(ctx, chatResponse);

    return chatResponse;
  } catch (e) {
    throw e;
  } finally {
    stopTyping(); // Stop the typing action
  }
}

async function handleAudioFileCore(ctx: MyContext, fileId: string, mimeType: string | null) : Promise<string> {
  try {
    // Determine file extension
    const extension = mimeType ? mimeType.split('/')[1].replace('x-', '') : 'oga'; // Default to 'oga' if mimeType is null
    
    if (!fs.existsSync('./temp')) {
      fs.mkdirSync('./temp');
    }
    const inputFilePath = `./temp/${fileId}.${extension}`;

    // Download the file
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({ url: url.toString(), responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(inputFilePath))
        .on('error', reject)
        .on('finish', resolve);
    });
    console.log(formatLogMessage(ctx, `audio file downloaded as ${inputFilePath}`));

    // Check if file exists
    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`File ${inputFilePath} does not exist`);
    }

    // Convert the file to mp3 if necessary
    let mp3FilePath = inputFilePath;
    if (mimeType !== 'audio/mp3') {
      mp3FilePath = `./temp/${fileId}.mp3`;
      await convertAudioToMp3(inputFilePath, mp3FilePath);
      console.log(formatLogMessage(ctx, `audio file converted to mp3 as ${mp3FilePath}`));
    }

    // Check if mp3 file exists
    if (!fs.existsSync(mp3FilePath)) {
      throw new Error(`File ${mp3FilePath} does not exist`);
    }

    // Send the file to the OpenAI API for transcription
    const userData: UserData = await getUserSettingsAndOpenAi(ctx);
    if (!userData.openai) {
      throw new NoOpenAiApiKeyError("OpenAI API key is not set");
    }
    // @ts-ignore
    const transcription = await transcribeAudioWithRetries(fs.createReadStream(mp3FilePath), userData.openai);
    const transcriptionText = transcription.text;
    console.log(formatLogMessage(ctx, "audio transcription received"));

    // Clean up files
    fs.unlink(inputFilePath, (err) => { if (err) console.error(err); });
    if (inputFilePath !== mp3FilePath) {
      fs.unlink(mp3FilePath, (err) => { if (err) console.error(err); });
    }
    console.log(formatLogMessage(ctx, "audio processing finished"));

    return transcriptionText;
  } catch (e) {
    throw e;
  }
}

export async function handleVoiceMessage(ctx: MyContext): Promise<string> {
  // @ts-ignore
  const fileId = ctx.message?.voice?.file_id || null;
  if (!fileId) {
    throw new Error("ctx.message.voice.file_id is undefined");
  }
  const transcriptionText = await handleAudioFileCore(ctx, fileId, null);
  // mimeType is null for voice messages
  if (!transcriptionText) return "";

  // Save the transcription event to the database
  // TODO: This is not working, why do we nee userData here?
  // addTranscriptionEvent(ctx, transcriptionText, userData);
  console.log(formatLogMessage(ctx, `new voice transcription saved to the database`));

  const formattedTranscriptionText = `User sent a voice message. Transcription of this voice message:\n\n${transcriptionText}\n`;
  
  return formattedTranscriptionText;
}

export async function handleAudioFile(ctx: MyContext, fileId: string, mimeType: string): Promise<string> {
  const transcriptionText = await handleAudioFileCore(ctx, fileId, mimeType);
  if (!transcriptionText) return "";

  // Formatted transcription text
  const formattedTranscriptionText = `You sent an audio file. Transcription of this audio file:\n\n${transcriptionText}\n`;

  // Save the transcription event to the database
  // TODO: This is not working, why do we nee userData here?
  // addTranscriptionEvent(ctx, transcriptionText, userData);
  console.log(formatLogMessage(ctx, `new audio transcription saved to the database`));

  // Reply with the formatted transcription text
  await sendSplitMessage(ctx, formattedTranscriptionText);

  return formattedTranscriptionText;
}

export async function handlePhotoMessage(ctx: MyContext): Promise<string> {
  try {
    // Log start of processing
    console.log(formatLogMessage(ctx, 'Processing photo'));

    // Input validation
    const message = ctx.message as Message.PhotoMessage;
    if (!message?.photo || message.photo.length === 0) {
      throw new Error('No photo found in message');
    }

    // Get the highest resolution photo
    const photo = message.photo[message.photo.length - 1];
    
    // Validate photo object
    if (!photo.file_id || !photo.width || !photo.height) {
      throw new Error('Invalid photo data');
    }

    const fileId = photo.file_id;
    
    // Generate unique file paths
    const timestamp = Date.now();
    const uniqueId = `${fileId}-${timestamp}`;
    const inputFilePath = `./temp/${uniqueId}.jpg`;
    const resizedFilePath = `./temp/${uniqueId}_resized.jpg`;

    try {
      // Ensure temp directory exists
      if (!fs.existsSync('./temp')) {
        fs.mkdirSync('./temp');
      }

      // Get file URL and download
      const url = await ctx.telegram.getFileLink(fileId);
      const response = await axios({ url: url.toString(), responseType: 'stream' });

      // Save the file
      await new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(inputFilePath))
          .on('error', reject)
          .on('finish', resolve);
      });

      // Resize the image
      await resizeImageFile(inputFilePath, resizedFilePath, 1024, 1024);
      console.log(formatLogMessage(ctx, `Photo resized to 1024x1024 max as ${resizedFilePath}`));

      // Encode the image to base64
      const base64Image = await convertImageToBase64(resizedFilePath);
      const base64Content: string = `data:image/jpeg;base64,${base64Image}`;

      // Log success
      console.log(formatLogMessage(ctx, 'Photo processed successfully'));

      return base64Content;
    } finally {
      // Cleanup temporary files
      try {
        if (fs.existsSync(inputFilePath)) {
          await new Promise<void>((resolve, reject) => {
            fs.unlink(inputFilePath, (err) => err ? reject(err) : resolve());
          });
        }
      } catch (cleanupError: unknown) {
        const error = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
        console.error(formatLogMessage(ctx, `Error cleaning up input file: ${error.message}`));
      }

      try {
        if (fs.existsSync(resizedFilePath)) {
          await new Promise<void>((resolve, reject) => {
            fs.unlink(resizedFilePath, (err) => err ? reject(err) : resolve());
          });
        }
      } catch (cleanupError: unknown) {
        const error = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
        console.error(formatLogMessage(ctx, `Error cleaning up resized file: ${error.message}`));
      }
    }
  } catch (processError: unknown) {
    const error = processError instanceof Error ? processError : new Error(String(processError));
    console.error(formatLogMessage(ctx, `Error processing photo: ${error.message}`));
    throw error;
  }
}
