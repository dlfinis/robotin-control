import type { LLMProvider, Message, LLMOptions, LLMResponse } from '../llm.service';
import { getLogger } from '../../../utils/logger';

const logger = getLogger().child({ module: 'MistralProvider' });

/**
 * Mistral AI API Provider
 * OpenAI-compatible API with strong European models
 * 
 * Pricing (Jan 2025):
 * - Mistral Small: $0.10 / 1M input, $0.30 / 1M output
 * - Mistral Medium: $0.60 / 1M input, $1.80 / 1M output  
 * - Mistral Large: $2.00 / 1M input, $6.00 / 1M output
 * 
 * Key Features:
 * - Fast inference (Small model)
 * - Good code generation
 * - European data sovereignty
 * - JSON mode support
 */
export class MistralProvider implements LLMProvider {
  readonly name = 'mistral';
  readonly baseURL = 'https://api.mistral.ai/v1';
  readonly defaultModel = 'mistral-small-latest';
  readonly maxContext = 32000;

  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || this.defaultModel;
  }

  async chat(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    const opts = {
      temperature: 0,
      maxTokens: 1024,
      model: this.model,
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
      logger.error({ status: response.status, error }, 'Mistral API error');
      throw new Error(`Mistral error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      model: string;
      usage?: { total_tokens: number };
      choices: Array<{ message?: { content?: string } }>;
    };

    logger.debug({
      model: data.model,
      tokens: data.usage?.total_tokens,
    }, 'Mistral response');

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model,
      provider: 'mistral',
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
    // Pricing varies by model, using Small as default
    // ~$0.10 per 1M input, ~$0.30 per 1M output
    // Assuming 70% input, 30% output
    const avgPricePer1M = 0.10 * 0.7 + 0.30 * 0.3; // ~$0.16 per 1M
    return (tokens / 1_000_000) * avgPricePer1M;
  }
}
