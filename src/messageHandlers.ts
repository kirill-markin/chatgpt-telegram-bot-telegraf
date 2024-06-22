import fs from "fs";
import axios from "axios";
import { MyContext, MyMessage } from "./types";
import { ERROR_MESSAGE, NO_VIDEO_ERROR } from './config';
import { 
  formatLogMessage, 
  fetchUserDataOrReplyWithError,
} from "./utils/utils";
import { truncateMessages } from "./utils/messageUtils";
import { 
  sendResponse,
  sendSplitMessage,
} from "./utils/responseUtils";
import { 
  storeAnswer, 
  addTranscriptionEvent, 
  addEventByMessageType, 
  getAndConvertMessagesByChatId, 
  addMessage,
  addSimpleEvent,
} from "./database/database";
import { 
  createCompletionWithRetriesAndMemory, 
  transcribeAudioWithRetries 
} from './openAIFunctions';
import { convertAudioToMp3, convertImageToBase64, resizeImageFile } from './utils/fileUtils';
import { generateMessageBufferKey } from './utils/messageUtils';
import { pineconeIndex } from './vectorDatabase';

// Create a map to store the message buffers
const messageBuffers = new Map();

export async function handleAnyMessage(ctx: MyContext, messageType: string) {
  console.log(formatLogMessage(ctx, `[NEW] ${messageType} received`));
  const key = generateMessageBufferKey(ctx);
  const messageData = messageBuffers.get(key) || { messages: [], timer: null };

  if (messageType === 'voice') {
    await handleVoiceMessage(ctx, pineconeIndex);
  } else if (messageType === 'audio') {
    // @ts-ignore
    const fileId = ctx.message.audio?.file_id;
    // @ts-ignore
    const mimeType = ctx.message.audio?.mime_type;

    if (fileId && mimeType) {
      await saveMessageToDatabase(ctx, fileId, 'audio');
      await handleAudioFile(ctx, fileId, mimeType, pineconeIndex);
    } else {
      console.error(formatLogMessage(ctx, 'Received audio file, but file_id or mimeType is undefined'));
    }
  } else if (messageType === 'photo') {
    await handlePhotoMessage(ctx, pineconeIndex);
  } else if (messageType === 'text') {
    // @ts-ignore
    await saveMessageToDatabase(ctx, ctx.message?.text, 'text');
  } else if (messageType === 'document') {
    // @ts-ignore
    const fileId = ctx.message.document?.file_id;
    // @ts-ignore
    const fileName = ctx.message.document?.file_name;
    // @ts-ignore
    const mimeType = ctx.message.document?.mime_type;

    if (fileId && mimeType) {
      if (mimeType.startsWith('audio/')) {
        await handleAudioFile(ctx, fileId, mimeType, pineconeIndex);
      } else {
        console.log(formatLogMessage(ctx, `File received: ${fileName} (${mimeType})`));
        ctx.reply('I can only process audio files and compressed photos for now.');
      }
    } else {
      console.error(formatLogMessage(ctx, 'Received file, but file_id or mimeType is undefined'));
    }
  } else if (messageType === 'video') {
    console.log(formatLogMessage(ctx, `video received`));
    ctx.reply(NO_VIDEO_ERROR);
    addSimpleEvent(ctx, 'user_message', 'user', 'video');
  } else if (messageType === 'sticker') {
    console.log(formatLogMessage(ctx, `sticker received`));
    ctx.reply('👍');
    addSimpleEvent(ctx, 'user_message', 'user', 'sticker');
  } else {
    throw new Error(`Unsupported message type: ${messageType}`);
  }

  // Clear the old timer
  if (messageData.timer) {
    clearTimeout(messageData.timer);
  }

  // Set a new timer
  messageData.timer = setTimeout(async () => {
    const messages = await getAndConvertMessagesByChatId(ctx);
    const fullMessage = messages.map(msg => msg.content).join('\n');
    console.log(formatLogMessage(ctx, `full message collected. length: ${fullMessage.length}`));
    messageData.messages = []; // Clear the messages array

    await replyToUser(ctx, pineconeIndex);
  }, 4000);

  // Save the message buffer
  messageBuffers.set(key, messageData);
}

export async function replyToUser(
  ctx: MyContext,
  pineconeIndex: any 
) {
  try {
    const userData = await fetchUserDataOrReplyWithError(ctx);
    if (!userData) return null;

    // Load all related messages from the database
    let messages: MyMessage[] = await getAndConvertMessagesByChatId(ctx);

    // DEBUG: messages to console in a pretty format JSON with newlines
    // console.log(`messages: ${JSON.stringify(truncateMessages(messages), null, 2)}`);

    // Send these messages to OpenAI's Chat GPT model
    const chatResponse: any = await createCompletionWithRetriesAndMemory(
      ctx,
      messages,
      userData.openai,
      pineconeIndex,
    );
    console.log(formatLogMessage(ctx, `chatGPT response received`));

    // Save the response tothe database
    storeAnswer(chatResponse, ctx, userData);

    // Send the response to the user
    await sendResponse(ctx, chatResponse);

    return chatResponse;
  } catch (e) {
    console.error(formatLogMessage(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(ERROR_MESSAGE);
  }
}

async function handleAudioFileCore(ctx: MyContext, fileId: string, mimeType: string | null) {
  const userData = await fetchUserDataOrReplyWithError(ctx);
  if (!userData) return null;

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

  return { transcriptionText, userData };
}
  
export async function handleVoiceMessage(ctx: MyContext, pineconeIndex: any) {
  try {
    // @ts-ignore
    const fileId = ctx.message?.voice?.file_id || null;
    if (!fileId) {
      throw new Error("ctx.message.voice.file_id is undefined");
    }

    const result = await handleAudioFileCore(ctx, fileId, null);
    // mimeType is null for voice messages
    if (!result) return;

    const { transcriptionText, userData } = result;

    // Save the transcription event to the database
    addTranscriptionEvent(ctx, transcriptionText, userData);
    console.log(formatLogMessage(ctx, `new voice transcription saved to the database`));

    // Save the transcription text to the messages table
    await saveMessageToDatabase(ctx, transcriptionText, 'text');

  } catch (e) {
    console.error(formatLogMessage(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(ERROR_MESSAGE);
  }
}

export async function handleAudioFile(ctx: MyContext, fileId: string, mimeType: string, pineconeIndex: any) {
  try {
    const result = await handleAudioFileCore(ctx, fileId, mimeType);
    if (!result) return;

    const { transcriptionText, userData } = result;

    // Formatted transcription text
    const formattedTranscriptionText = `You sent an audio file. Transcription of this audio file:\n\n\`\`\`\n${transcriptionText}\n\`\`\`\n`;

    // Save the transcription event to the database
    addTranscriptionEvent(ctx, transcriptionText, userData);
    console.log(formatLogMessage(ctx, `new audio transcription saved to the database`));

    // Save the formatted transcription text to the messages table
    if (ctx.chat && ctx.chat.id) {
      await addMessage({
        role: "assistant",
        content: formattedTranscriptionText,
        chat_id: ctx.chat.id,
        user_id: null,
      });
      console.log(formatLogMessage(ctx, "formatted transcription text saved to the messages table"));
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }

    // Reply with the formatted transcription text
    await sendSplitMessage(ctx, formattedTranscriptionText);

  } catch (e) {
    console.error(formatLogMessage(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(ERROR_MESSAGE);
  }
}

export async function handlePhotoMessage(ctx: MyContext, pineconeIndex: any) {
  // @ts-ignore
  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get the highest resolution photo
  const fileId = photo.file_id;

  try {
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({ url: url.toString(), responseType: 'stream' });
    if (!fs.existsSync('./temp')) {
      fs.mkdirSync('./temp');
    }
    const inputFilePath = `./temp/${fileId}.jpg`;
    const resizedFilePath = `./temp/${fileId}_resized.jpg`;
    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(inputFilePath))
        .on('error', reject)
        .on('finish', resolve);
    });

    // Resize the image
    await resizeImageFile(inputFilePath, resizedFilePath, 1024, 1024);
    console.log(formatLogMessage(ctx, `photo resized to 1024x1024 max as ${resizedFilePath}`));

    // Encode the image to base64
    const base64Image = await convertImageToBase64(resizedFilePath);
    const base64Content = `data:image/jpeg;base64,${base64Image}`;

    // Delete the temporary files
    fs.unlink(inputFilePath, (err) => {
      if (err) console.error(err);
    });
    fs.unlink(resizedFilePath, (err) => {
      if (err) console.error(err);
    });

    // Save the photo to the database
    await saveMessageToDatabase(ctx, base64Content, 'photo');

    // Save caption text to the database if it exists
    // @ts-ignore
    if (ctx.message?.caption) {
      // @ts-ignore
      await saveMessageToDatabase(ctx, ctx.message.caption, 'text');
    }

  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error occurred: ${error}`));
    ctx.reply(ERROR_MESSAGE);
  }
}

export async function saveMessageToDatabase(ctx: MyContext, messageContent: string, messageType: string) {
  console.log(formatLogMessage(ctx, `new ${messageType} message received`));

  // Get the user data
  const userData = await fetchUserDataOrReplyWithError(ctx);
  if (!userData) return;

  // Save the message to the events table
  addEventByMessageType(ctx, 'user_message', messageType, messageContent);
  console.log(formatLogMessage(ctx, `new ${messageType} message saved to the events table`));

  // Save the message to the messages table
  if (ctx.chat && ctx.chat.id) {
    await addMessage({
      role: 'user',
      content: messageContent,
      chat_id: ctx.chat.id,
      user_id: ctx.from?.id || null,
    });
    console.log(formatLogMessage(ctx, `${messageType} message saved to the messages table`));
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }
}
