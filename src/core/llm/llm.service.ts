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
  provider: 'lmstudio' | 'deepseek' | 'kimi' | 'openai';
}

/**
 * LLM Provider interface
 * All providers must implement this interface
 */
export interface LLMProvider {
  readonly name: string;
  readonly baseURL: string;
  readonly defaultModel: string;
  readonly maxContext: number;
  
  chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
  estimateCost(tokens: number): number;
}

/**
 * LM Studio Local Provider
 */
class LMStudioProvider implements LLMProvider {
  readonly name = 'lmstudio';
  readonly baseURL: string;
  readonly defaultModel: string;
  readonly maxContext = 128000;

  constructor(baseURL: string, model: string) {
    this.baseURL = baseURL;
    this.defaultModel = model;
  }

  async chat(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    const opts = {
      temperature: 0,
      maxTokens: 1024,
      model: this.defaultModel,
      ...options,
    };

    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio error: ${response.status}`);
    }

    const data = await response.json() as {
      model: string;
      usage?: { total_tokens: number };
      choices: Array<{ message?: { content?: string } }>;
    };

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model || opts.model,
      provider: 'lmstudio',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/v1/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  estimateCost(): number {
    return 0; // Local model, no cost
  }
}

/**
 * OpenAI Provider
 */
class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly baseURL = 'https://api.openai.com/v1';
  readonly defaultModel: string;
  readonly maxContext = 128000;
  
  private apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.defaultModel = model;
  }

  async chat(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    const opts = {
      temperature: 0,
      maxTokens: 1024,
      model: this.defaultModel,
      ...options,
    };

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const data = await response.json() as {
      model: string;
      usage?: { total_tokens: number };
      choices: Array<{ message?: { content?: string } }>;
    };

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model,
      provider: 'openai',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  estimateCost(tokens: number): number {
    // GPT-4o: $2.50 / 1M input, $10.00 / 1M output
    const avgPricePer1M = 2.50 * 0.7 + 10.00 * 0.3;
    return (tokens / 1_000_000) * avgPricePer1M;
  }
}

/**
 * LLM Service with multi-provider support and fallback chain
 * 
 * Priority chain:
 * 1. LM Studio (local, free)
 * 2. DeepSeek (cheapest, high quality)
 * 3. Kimi (best long context)
 * 4. OpenAI (fallback)
 */
export class LLMService {
  private config = getConfig();
  private providers: LLMProvider[] = [];
  private isInitialized = false;

  /**
   * Initialize all configured providers
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // 1. LM Studio (local)
    this.providers.push(new LMStudioProvider(
      this.config.lmStudioHost,
      this.config.lmStudioModel
    ));

    // 2. DeepSeek (if API key configured)
    if (this.config.deepseekApiKey) {
      const { DeepSeekProvider } = await import('./providers/deepseek.provider');
      this.providers.push(new DeepSeekProvider(this.config.deepseekApiKey));
    }

    // 3. Kimi (if API key configured)
    if (this.config.kimiApiKey) {
      const { KimiProvider } = await import('./providers/kimi.provider');
      this.providers.push(new KimiProvider(this.config.kimiApiKey));
    }

    // 4. OpenAI (if API key configured)
    if (this.config.openaiApiKey) {
      this.providers.push(new OpenAIProvider(
        this.config.openaiApiKey,
        this.config.openaiModel
      ));
    }

    this.isInitialized = true;
    logger.info({ providers: this.providers.map(p => p.name) }, 'LLM providers initialized');
  }

  /**
   * Send chat request with automatic fallback
   */
  async chat(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    await this.initialize();

    const errors: Array<{ provider: string; error: string }> = [];

    for (const provider of this.providers) {
      try {
        // Check if provider is available
        const available = await provider.isAvailable();
        if (!available) {
          logger.debug({ provider: provider.name }, 'Provider not available, skipping');
          continue;
        }

        // Try to get response
        const response = await provider.chat(messages, options);
        
        logger.info({
          provider: response.provider,
          model: response.model,
          tokens: response.tokensUsed,
          cost: provider.estimateCost(response.tokensUsed || 0),
        }, 'LLM response received');

        return response;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn({ provider: provider.name, error: errorMessage }, 'Provider failed');
        errors.push({ provider: provider.name, error: errorMessage });
      }
    }

    // All providers failed
    throw new Error(
      `All LLM providers failed: ${errors.map(e => `${e.provider} (${e.error})`).join(', ')}`
    );
  }

  /**
   * Get available providers
   */
  async getAvailableProviders(): Promise<string[]> {
    await this.initialize();
    
    const available: string[] = [];
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        available.push(provider.name);
      }
    }
    
    return available;
  }

  /**
   * Estimate cost for given tokens across all providers
   */
  async estimateCosts(tokens: number): Promise<Array<{ provider: string; cost: number }>> {
    await this.initialize();
    
    return this.providers.map(p => ({
      provider: p.name,
      cost: p.estimateCost(tokens),
    }));
  }
}

// Singleton instance
let llmServiceInstance: LLMService | null = null;

/**
 * Get the LLMService singleton
 */
export async function getLLMService(): Promise<LLMService> {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService();
    await llmServiceInstance.initialize();
  }
  return llmServiceInstance;
}

/**
 * Reset the LLMService singleton
 */
export function resetLLMService(): void {
  llmServiceInstance = null;
}

// LLMProvider interface is already exported above
