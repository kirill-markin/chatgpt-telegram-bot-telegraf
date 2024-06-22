import { encoding_for_model, TiktokenModel } from 'tiktoken';

export function tokenizeText(text: string, model: TiktokenModel = 'gpt-3.5-turbo'): Uint32Array {
  // Ensure text is a string
  if (typeof text !== 'string') {
    throw new TypeError('Expected text to be a string');
  }
  const encoder = encoding_for_model(model);
  const tokens = encoder.encode(text);
  encoder.free(); // Free the encoder when done
  return tokens;
}

export function convertTokensToText(tokens: Uint32Array, model: TiktokenModel = 'gpt-3.5-turbo'): string {
  const encoder = encoding_for_model(model);
  const text = encoder.decode(tokens);
  encoder.free(); // Free the encoder when done
  return new TextDecoder().decode(text);
}

export function truncateText(str: string, threshold: number): string {
  if (str.length <= threshold) return str;
  const start = str.slice(0, threshold / 2);
  const end = str.slice(-threshold / 2);
  return `${start}... [truncated] ...${end}`;
}
