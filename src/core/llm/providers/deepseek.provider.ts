import type { LLMProvider, Message, LLMOptions, LLMResponse } from '../llm.service';
import { getLogger } from '../../../utils/logger';

const logger = getLogger().child({ module: 'DeepSeekProvider' });

/**
 * DeepSeek API Provider
 * OpenAI-compatible API with significantly lower costs
 * 
 * Pricing (Jan 2025):
 * - Input: $0.28 / 1M tokens
 * - Output: $0.42 / 1M tokens
 * - Cache hit: $0.07 / 1M tokens
 * 
 * ~90% cheaper than OpenAI GPT-4o
 */
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  readonly baseURL = 'https://api.deepseek.com';
  readonly defaultModel = 'deepseek-chat';
  readonly maxContext = 64000;

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

    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
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
      logger.error({ status: response.status, error }, 'DeepSeek API error');
      throw new Error(`DeepSeek error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      model: string;
      usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
      choices: Array<{ message?: { content?: string } }>;
    };

    logger.debug({
      model: data.model,
      tokens: data.usage?.total_tokens,
      cost: this.estimateCost(data.usage?.total_tokens || 0),
    }, 'DeepSeek response');

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model,
      provider: 'deepseek',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  estimateCost(tokens: number): number {
    // $0.28 per 1M input tokens, $0.42 per 1M output tokens
    // Assuming 70% input, 30% output on average
    const avgPricePer1M = 0.28 * 0.7 + 0.42 * 0.3; // ~$0.322 per 1M
    return (tokens / 1_000_000) * avgPricePer1M;
  }
}
