import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';

const logger = getLogger().child({ module: 'LLMService' });

/**
 * Message format for chat completions
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for LLM requests
 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * Response from LLM
 */
export interface LLMResponse {
  content: string;
  tokensUsed?: number;
  model: string;
  provider: 'lmstudio' | 'openai';
}

/**
 * LLM Service that uses LM Studio as primary provider
 * Falls back to OpenAI if LM Studio is unavailable
 */
export class LLMService {
  private config = getConfig();

  /**
   * Send a chat completion request to LM Studio
   */
  async chat(
    messages: Message[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const opts = {
      temperature: 0, // Deterministic by default
      maxTokens: 1024,
      model: this.config.lmStudioModel,
      ...options,
    };

    try {
      // Try LM Studio first
      return await this.callLMStudio(messages, opts);
    } catch (error) {
      logger.warn({ error }, 'LM Studio failed, trying OpenAI fallback');
      
      // Fallback to OpenAI if configured
      if (this.config.openaiApiKey) {
        return await this.callOpenAI(messages, opts);
      }
      
      throw new Error('LM Studio unavailable and no OpenAI fallback configured');
    }
  }

  /**
   * Call LM Studio local API
   */
  private async callLMStudio(
    messages: Message[],
    options: Required<LLMOptions>
  ): Promise<LLMResponse> {
    const url = `${this.config.lmStudioHost}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      model: string;
      usage?: { total_tokens: number };
      choices: Array<{ message?: { content?: string } }>;
    };

    logger.debug({ 
      model: data.model,
      tokens: data.usage?.total_tokens 
    }, 'LM Studio response received');

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model || options.model,
      provider: 'lmstudio',
    };
  }

  /**
   * Call OpenAI API as fallback
   */
  private async callOpenAI(
    messages: Message[],
    options: Required<LLMOptions>
  ): Promise<LLMResponse> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.openaiModel,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      model: string;
      usage?: { total_tokens: number };
      choices: Array<{ message?: { content?: string } }>;
    };

    logger.debug({ 
      model: data.model,
      tokens: data.usage?.total_tokens 
    }, 'OpenAI fallback response received');

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model,
      provider: 'openai',
    };
  }

  /**
   * Check if LM Studio is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.lmStudioHost}/v1/models`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let llmServiceInstance: LLMService | null = null;

/**
 * Get the LLMService singleton
 */
export function getLLMService(): LLMService {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService();
  }
  return llmServiceInstance;
}

/**
 * Reset the LLMService singleton
 */
export function resetLLMService(): void {
  llmServiceInstance = null;
}
