import fs from "fs";
import axios from "axios";
import { MyContext, MyMessage } from "./types";
import { UserData } from "./types";
import { errorString } from './config';
import { 
  toLogFormat, 
  getUserDataOrReplyWithError,
} from "./utils/utils";
import {
  processAndTruncateMessages,
} from "./utils/messageUtils";
import { 
  handleResponseSending,
  sendLongMessage,
} from "./utils/responseUtils";
import { 
  saveAnswerToDB, 
  insertModelTranscriptionEvent, 
  insertEventViaMessageType, 
  selectAndTransformMessagesByChatId, 
  insertMessage 
} from "./database/database";
import { 
  createChatCompletionWithRetryReduceHistoryLongtermMemory, 
  createTranscriptionWithRetry 
} from './openAIFunctions';
import { convertToMp3, encodeImageToBase64, resizeImage } from './utils/fileUtils';

async function processUserMessageAndRespond(
  ctx: MyContext, 
  messageContent: string, 
  userData: UserData, 
  pineconeIndex: any 
) {
  // Save the user message to the database
  if (ctx.chat && ctx.chat.id) {
    await insertMessage({
      role: "user",
      content: messageContent,
      chat_id: ctx.chat.id,
      user_id: ctx.from?.id || null,
    });
  } else {
    throw new Error(`ctx.chat.id is undefined`);
  }

  // Load all related messages from the database
  let messages: MyMessage[] = await selectAndTransformMessagesByChatId(ctx);

  const truncatedMessages = processAndTruncateMessages(messages);
  // DEBUG: messages to console in a pretty format JSON with newlines
  // console.log(JSON.stringify(truncatedMessages, null, 2));

  // Send these messages to OpenAI's Chat GPT model
  const chatResponse: any = await createChatCompletionWithRetryReduceHistoryLongtermMemory(
    ctx,
    messages,
    userData.openai,
    pineconeIndex,
  );
  console.log(toLogFormat(ctx, `chatGPT response received`));

  // Save the response tothe database
  saveAnswerToDB(chatResponse, ctx, userData);

  // Send the response to the user
  await handleResponseSending(ctx, chatResponse);

  return chatResponse;
}

export async function processMessage(ctx: MyContext, messageContent: string, eventType: string, messageType: string, pineconeIndex: any) {
  console.log(toLogFormat(ctx, `new ${messageType} message received`));
  
  try {
    const userData = await getUserDataOrReplyWithError(ctx);
    if (!userData) return;
    insertEventViaMessageType(ctx, eventType, messageType, messageContent);
    console.log(toLogFormat(ctx, `new ${messageType} message saved to the events table`));

    await processUserMessageAndRespond(ctx, messageContent, userData, pineconeIndex);

  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

async function processAudioCore(ctx: MyContext, fileId: string, mimeType: string | null) {
  const userData = await getUserDataOrReplyWithError(ctx);
  if (!userData) return null;

  // Determine file extension
  const extension = mimeType ? mimeType.split('/')[1].replace('x-', '') : 'oga'; // Default to 'oga' if mimeType is null
  const inputFilePath = `./${fileId}.${extension}`;

  // Download the file
  const url = await ctx.telegram.getFileLink(fileId);
  const response = await axios({ url: url.toString(), responseType: 'stream' });
  await new Promise((resolve, reject) => {
    response.data.pipe(fs.createWriteStream(inputFilePath))
      .on('error', reject)
      .on('finish', resolve);
  });
  console.log(toLogFormat(ctx, `audio file downloaded as ${inputFilePath}`));

  // Check if file exists
  if (!fs.existsSync(inputFilePath)) {
    throw new Error(`File ${inputFilePath} does not exist`);
  }

  // Convert the file to mp3 if necessary
  let mp3FilePath = inputFilePath;
  if (mimeType !== 'audio/mp3') {
    mp3FilePath = `./${fileId}.mp3`;
    await convertToMp3(inputFilePath, mp3FilePath);
    console.log(toLogFormat(ctx, `audio file converted to mp3 as ${mp3FilePath}`));
  }

  // Check if mp3 file exists
  if (!fs.existsSync(mp3FilePath)) {
    throw new Error(`File ${mp3FilePath} does not exist`);
  }

  // Send the file to the OpenAI API for transcription
  // @ts-ignore
  const transcription = await createTranscriptionWithRetry(fs.createReadStream(mp3FilePath), userData.openai);
  const transcriptionText = transcription.text;
  console.log(toLogFormat(ctx, "audio transcription received"));

  // Clean up files
  fs.unlink(inputFilePath, (err) => { if (err) console.error(err); });
  if (inputFilePath !== mp3FilePath) {
    fs.unlink(mp3FilePath, (err) => { if (err) console.error(err); });
  }
  console.log(toLogFormat(ctx, "audio processing finished"));

  return { transcriptionText, userData };
}
  
export async function processVoiceMessage(ctx: MyContext, pineconeIndex: any) {
  try {
    // @ts-ignore
    const fileId = ctx.message?.voice?.file_id || null;
    if (!fileId) {
      throw new Error("ctx.message.voice.file_id is undefined");
    }

    const result = await processAudioCore(ctx, fileId, null);
    // mimeType is null for voice messages
    if (!result) return;

    const { transcriptionText, userData } = result;

    // Save the transcription event to the database
    insertModelTranscriptionEvent(ctx, transcriptionText, userData);
    console.log(toLogFormat(ctx, `new voice transcription saved to the database`));

    // Process the transcribed message
    await processMessage(ctx, transcriptionText, 'user_message', 'voice', pineconeIndex);

  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

export async function processAudioFile(ctx: MyContext, fileId: string, mimeType: string, pineconeIndex: any) {
  try {
    const result = await processAudioCore(ctx, fileId, mimeType);
    if (!result) return;

    const { transcriptionText, userData } = result;

    // Formatted transcription text
    const formattedTranscriptionText = `You sent an audio file. Transcription of this audio file:\n\n\`\`\`\n${transcriptionText}\n\`\`\`\n`;

    // Save the transcription event to the database
    insertModelTranscriptionEvent(ctx, transcriptionText, userData);
    console.log(toLogFormat(ctx, `new audio transcription saved to the database`));

    // Save the formatted transcription text to the messages table
    if (ctx.chat && ctx.chat.id) {
      await insertMessage({
        role: "assistant",
        content: formattedTranscriptionText,
        chat_id: ctx.chat.id,
        user_id: null,
      });
      console.log(toLogFormat(ctx, "formatted transcription text saved to the messages table"));
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }

    // Reply with the formatted transcription text
    await sendLongMessage(ctx, formattedTranscriptionText);

  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}

export async function processPhotoMessage(ctx: MyContext, pineconeIndex: any) {
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
    await resizeImage(inputFilePath, resizedFilePath, 1024, 1024);
    console.log(toLogFormat(ctx, `photo resized to 1024x1024 max as ${resizedFilePath}`));

    // Encode the image to base64
    const base64Image = await encodeImageToBase64(resizedFilePath);
    const base64Content = `data:image/jpeg;base64,${base64Image}`;

    // Delete the temporary files
    fs.unlink(inputFilePath, (err) => {
      if (err) console.error(err);
    });
    fs.unlink(resizedFilePath, (err) => {
      if (err) console.error(err);
    });

    // Send the message to OpenAI
    const userData = await getUserDataOrReplyWithError(ctx);
    if (!userData) return;
    await processMessage(ctx, base64Content, 'user_message', 'photo', pineconeIndex);

  } catch (error) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${error}`));
    ctx.reply(errorString);
  }
}
