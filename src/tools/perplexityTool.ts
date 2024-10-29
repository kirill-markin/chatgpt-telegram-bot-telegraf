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
  try {
    // Get API key from config or environment
    const apiKey = config?.apiKey || PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new PerplexityError('PERPLEXITY_API_KEY is not defined in environment variables or config');
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
        model: config?.model || 'llama-3.1-sonar-large-128k-online',
        messages: [{
          role: 'user',
          content: 
            query + 
            "\n\nAnswer with long text and a lot of details and examples." + 
            "\n\nTry to add all related full urls next to the answer if possible."
        }],
        max_tokens: config?.maxTokens || 1024
      },
      timeout: 30000 // 30 second timeout
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
    if (ctx) {
      console.error(formatLogMessage(ctx, `[ERROR] Perplexity API Error: ${error}`));
    }
    
    if (axios.isAxiosError(error)) {
      // Enhanced error logging
      console.error('Perplexity API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers,
          data: error.config?.data,
        }
      });

      throw new PerplexityError(
        `Perplexity API Error: Status ${error.response?.status} - ${JSON.stringify(error.response?.data)}`
      );
    }
    
    // Log non-Axios errors in detail
    console.error('Unexpected Perplexity Error:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      error: error instanceof Error ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : String(error)
    });

    throw new PerplexityError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
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
