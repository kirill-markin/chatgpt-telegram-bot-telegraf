import fs from "fs";
import axios from "axios";
import { MyContext, MyMessage } from "./types";
import { UserData } from "./types";
import { errorString } from './config';
import { 
  toLogFormat, 
  handleResponseSending,
  getUserDataOrReplyWithError,
} from "./utils";
import { 
  saveAnswerToDB, 
  insertModelTranscriptionEvent, 
  insertEventViaMessageType, 
  selectMessagesByChatIdGPTformat, 
  insertMessage 
} from "./database";
import { 
  createChatCompletionWithRetryReduceHistoryLongtermMemory, 
  createTranscriptionWithRetry 
} from './openAIFunctions';
import { convertOgaToMp3 } from './fileUtils';

async function processUserMessageAndRespond(
  ctx: MyContext, 
  messageContent: string, 
  userData: UserData, 
  pineconeIndex: any // Replace 'any' with the actual type if you have one
) {
  // Save the transcription to the database
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

  // Download all related messages from the database
  let messages: MyMessage[] = await selectMessagesByChatIdGPTformat(ctx);

  // DEBUG: messages to console in a pretty format JSON with newlines
  // console.log(JSON.stringify(messages, null, 2));

  // Send this text to OpenAI's Chat GPT model with retry logic
  const chatResponse: any = await createChatCompletionWithRetryReduceHistoryLongtermMemory(
    ctx,
    messages,
    userData.openai,
    pineconeIndex,
  );
  console.log(toLogFormat(ctx, `chatGPT response received`));

  // Save the answer to the database
  saveAnswerToDB(chatResponse, ctx, userData);

  // Handle response sending
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
  
export async function processVoiceMessage(ctx: MyContext, pineconeIndex: any) {
  try {
    const userData = await getUserDataOrReplyWithError(ctx);
    if (!userData) return;

    const fileId = ctx.message?.voice?.file_id || null;
    if (!fileId) {
      throw new Error("ctx.message.voice.file_id is undefined");
    }

    // Download the file
    const url = await ctx.telegram.getFileLink(fileId);
    const response = await axios({ url: url.toString(), responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.pipe(fs.createWriteStream(`./${fileId}.oga`))
        .on('error', reject)
        .on('finish', resolve);
    });
    console.log(toLogFormat(ctx, "voice file downloaded"));

    // Convert the file to mp3
    await convertOgaToMp3(fileId);
    console.log(toLogFormat(ctx, "voice file converted"));

    // Send the file to the OpenAI API for transcription
    const transcription = await createTranscriptionWithRetry(fs.createReadStream(`./${fileId}.mp3`), userData.openai);
    const transcriptionText = transcription.text;
    console.log(toLogFormat(ctx, "voice transcription received"));

    // Save the transcription event to the database
    insertModelTranscriptionEvent(ctx, transcriptionText, userData);
    console.log(toLogFormat(ctx, `new voice transcription saved to the database`));

    // Delete both audio files
    fs.unlink(`./${fileId}.oga`, (err) => { if (err) console.error(err); });
    fs.unlink(`./${fileId}.mp3`, (err) => { if (err) console.error(err); });
    console.log(toLogFormat(ctx, "voice processing finished"));

    // Process the transcribed message
    await processMessage(ctx, transcriptionText, 'user_message', 'voice', pineconeIndex);

  } catch (e) {
    console.error(toLogFormat(ctx, `[ERROR] error occurred: ${e}`));
    ctx.reply(errorString);
  }
}
