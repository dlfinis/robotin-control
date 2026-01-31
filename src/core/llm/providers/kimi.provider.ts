import type { LLMProvider, Message, LLMOptions, LLMResponse } from '../llm.service';
import { getLogger } from '../../../utils/logger';

const logger = getLogger().child({ module: 'KimiProvider' });

/**
 * Kimi (Moonshot AI) API Provider
 * OpenAI-compatible API with exceptional long-context capabilities
 * 
 * Pricing (Jan 2025):
 * - Kimi K2.5: ~$0.50 / 1M input, ~$1.50 / 1M output
 * 
 * Key Features:
 * - 256K context window (2x GPT-4)
 * - Trillion-parameter model
 * - Excellent for long documents
 * - Native tool calling
 */
export class KimiProvider implements LLMProvider {
  readonly name = 'kimi';
  readonly baseURL = 'https://api.moonshot.cn/v1';
  readonly defaultModel = 'kimi-k2.5';
  readonly maxContext = 256000;

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Kimi API error');
      throw new Error(`Kimi error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      model: string;
      usage?: { total_tokens: number };
      choices: Array<{ message?: { content?: string } }>;
    };

    logger.debug({
      model: data.model,
      tokens: data.usage?.total_tokens,
    }, 'Kimi response');

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model,
      provider: 'kimi',
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
    // ~$0.50 per 1M input, ~$1.50 per 1M output
    // Assuming 70% input, 30% output
    const avgPricePer1M = 0.50 * 0.7 + 1.50 * 0.3; // ~$0.80 per 1M
    return (tokens / 1_000_000) * avgPricePer1M;
  }
}
