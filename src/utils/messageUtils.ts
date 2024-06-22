import { MyContext, MyMessage } from '../types';
import { truncateText } from './encodingUtils';

export const generateMessageBufferKey = (ctx: MyContext) => {
  if (ctx.chat && ctx.from) {
    return `${ctx.chat.id}:${ctx.from.id}`;
  } else {
    throw new Error('ctx.chat.id or ctx.from.id is undefined');
  }
}

const THRESHOLD_TO_TRUNK_MESSGES_FOR_CONSOLE = 100; // Length threshold for strings

export function truncateMessages(messages: MyMessage[], threshold: number = THRESHOLD_TO_TRUNK_MESSGES_FOR_CONSOLE): MyMessage[] {
  return messages.map((message) => {
    // Deep clone the message object to avoid mutating the original
    const newMessage = JSON.parse(JSON.stringify(message));
  
    if (typeof newMessage.content === 'string') {
      // Truncate the content if it's a string
      newMessage.content = truncateText(newMessage.content, threshold);
    } else if (Array.isArray(newMessage.content)) {
      // Iterate through content array and truncate strings
      // @ts-ignore
      newMessage.content = newMessage.content.map((item) => {
        if (item.type === 'text' && item.text) {
          // Truncate text content
          item.text = truncateText(item.text, threshold);
        } else if (item.type === 'image_url' && item.image_url && item.image_url.url) {
          // Truncate image URL
          item.image_url.url = truncateText(item.image_url.url, threshold);
        }
        return item;
      });
    }
    return newMessage;
  });
}
