import fs from "fs";
import axios from "axios";
import { MyContext, MyMessage } from "./types";
import { UserData } from "./types";
import { ERROR_MESSAGE } from './config';
import { 
  formatLogMessage, 
  fetchUserDataOrReplyWithError,
} from "./utils/utils";
import {
  truncateMessages,
} from "./utils/messageUtils";
import { 
  handleResponseSending,
  sendLongMessage,
} from "./utils/responseUtils";
import { 
  storeAnswer, 
  addTranscriptionEvent, 
  addEventByMessageType, 
  getAndConvertMessagesByChatId, 
  addMessage 
} from "./database/database";
import { 
  createCompletionWithRetriesAndMemory, 
  transcribeAudioWithRetries 
} from './openAIFunctions';
import { convertAudioToMp3, convertImageToBase64, resizeImageFile } from './utils/fileUtils';

async function handleUserMessageAndReply(
  ctx: MyContext, 
  messageContent: string, 
  userData: UserData, 
  pineconeIndex: any 
) {
  // Save the user message to the database
  if (ctx.chat && ctx.chat.id) {
    await addMessage({
      role: "user",
      content: messageContent,
      chat_id: ctx.chat.id,
      user_id: ctx.from?.id || null,
    });
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }

  // Load all related messages from the database
  let messages: MyMessage[] = await getAndConvertMessagesByChatId(ctx);

  const truncatedMessages = truncateMessages(messages);
  // DEBUG: messages to console in a pretty format JSON with newlines
  // console.log(JSON.stringify(truncatedMessages, null, 2));

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
  await handleResponseSending(ctx, chatResponse);

  return chatResponse;
}

export async function handleMessage(ctx: MyContext, messageContent: string, eventType: string, messageType: string, pineconeIndex: any) {
  console.log(formatLogMessage(ctx, `new ${messageType} message received`));
  
  try {
    const userData = await fetchUserDataOrReplyWithError(ctx);
    if (!userData) return;
    addEventByMessageType(ctx, eventType, messageType, messageContent);
    console.log(formatLogMessage(ctx, `new ${messageType} message saved to the events table`));

    await handleUserMessageAndReply(ctx, messageContent, userData, pineconeIndex);

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

    // Process the transcribed message
    await handleMessage(ctx, transcriptionText, 'user_message', 'voice', pineconeIndex);

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
    await sendLongMessage(ctx, formattedTranscriptionText);

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

    // Send the message to OpenAI
    const userData = await fetchUserDataOrReplyWithError(ctx);
    if (!userData) return;
    await handleMessage(ctx, base64Content, 'user_message', 'photo', pineconeIndex);

  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error occurred: ${error}`));
    ctx.reply(ERROR_MESSAGE);
  }
}
