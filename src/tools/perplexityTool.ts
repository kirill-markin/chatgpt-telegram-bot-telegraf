import axios from 'axios';
import { formatLogMessage } from '../utils/utils';
import { MyContext } from '../types';
import { PERPLEXITY_API_KEY } from '../config';

export interface PerplexityResponse {
  answer: string;
  sources?: string[];
  query: string;
  timestamp: string;
}

export interface PerplexityConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class PerplexityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerplexityError';
  }
}

export async function callPerplexity(
  query: string, 
  config?: Partial<PerplexityConfig>,
  ctx?: MyContext
): Promise<PerplexityResponse> {
  const MAX_RETRIES = 3;
  const TIMEOUT = 60000; // Increase timeout to 60 seconds
  const BACKOFF_DELAY = 1000; // 1 second delay between retries

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Get API key from config or environment
      const apiKey = config?.apiKey || PERPLEXITY_API_KEY;
      if (!apiKey) {
        throw new PerplexityError('PERPLEXITY_API_KEY is not defined in environment variables or config');
      }

      if (ctx && attempt > 1) {
        console.log(formatLogMessage(ctx, `Retrying Perplexity API call (attempt ${attempt}/${MAX_RETRIES})`));
      }

      // Make request to Perplexity API
      const response = await axios({
        method: 'post',
        url: 'https://api.perplexity.ai/chat/completions',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        data: {
          model: config?.model || 'sonar-pro',
          messages: [{
            role: 'user',
            content: query + 
              "\n\nAnswer with long text and a lot of details and examples." + 
              "\n\nTry to add all related full urls next to the answer if possible."
          }],
          max_tokens: config?.maxTokens || 1024
        },
        timeout: TIMEOUT
      });

      if (ctx) {
        console.log(formatLogMessage(ctx, 'Perplexity API response received'));
      }

      // Format the response
      const perplexityResponse: PerplexityResponse = {
        answer: response.data.choices[0].message.content,
        // Perplexity API returns empty sources all the time :-(
        sources: response.data.choices[0].message.metadata?.sources?.split(',') || [],
        query: query,
        timestamp: new Date().toISOString()
      };

      // Log formatted response
      console.log('Formatted Perplexity Response:', JSON.stringify(perplexityResponse, null, 2));

      return perplexityResponse;

    } catch (error) {
      const isTimeout = axios.isAxiosError(error) && 
        (error.code === 'ECONNABORTED' || error.message.includes('timeout'));

      // If it's the last attempt or not a timeout error, throw
      if (attempt === MAX_RETRIES || !isTimeout) {
        if (ctx) {
          console.error(formatLogMessage(ctx, `[ERROR] Perplexity API Error: ${error}`));
        }
        
        if (axios.isAxiosError(error)) {
          // Enhanced error logging with more details
          const errorDetails = {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers,
            config: {
              url: error.config?.url,
              method: error.config?.method,
              headers: error.config?.headers,
              data: error.config?.data,
            },
            code: error.code,
            message: error.message,
            isNetworkError: error.isAxiosError && !error.response,
            timeout: error.config?.timeout,
            timestamp: new Date().toISOString()
          };

          console.error('Perplexity API Detailed Error:', JSON.stringify(errorDetails, null, 2));

          // Improved error message with more context
          const errorMessage = error.response?.data?.error?.message || 
                             error.response?.data || 
                             error.message;

          throw new PerplexityError(
            `Perplexity API Error (${error.response?.status || 'Network Error'}): ${errorMessage}`
          );
        }
        
        // Enhanced non-Axios error logging
        const unexpectedErrorDetails = {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
          errorObject: error instanceof Error ? 
            JSON.stringify(error, Object.getOwnPropertyNames(error)) : 
            String(error),
          context: {
            query,
            configUsed: config,
            apiEndpoint: 'https://api.perplexity.ai/chat/completions'
          }
        };

        console.error('Unexpected Perplexity Error Details:', JSON.stringify(unexpectedErrorDetails, null, 2));

        throw new PerplexityError(
          `Unexpected Perplexity error: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, BACKOFF_DELAY * attempt));
      continue;
    }
  }
  
  // Add default return or throw at the end
  throw new PerplexityError('Maximum retries exceeded');
}

export function createPerplexityTool() {
  return {
    type: "function",
    function: {
      name: "perplexity",
      description: "Search the internet for current information using Perplexity AI",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to send to Perplexity"
          }
        },
        required: ["query"]
      }
    }
  };
}
