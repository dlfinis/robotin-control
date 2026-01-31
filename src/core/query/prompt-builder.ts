import { getLogger } from '../../utils/logger';
import type { RetrievedChunk } from './retrieval.service';
import type { AnalyzedQuery, QueryIntent } from './query-analyzer';

const logger = getLogger().child({ module: 'PromptBuilder' });

/**
 * Response format type
 */
export type ResponseFormat = 'markdown' | 'json';

/**
 * Built prompt with metadata
 */
export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  contextChunks: RetrievedChunk[];
  estimatedTokens: number;
}

/**
 * Builds deterministic prompts for LLM queries
 * Ensures responses are grounded in provided context
 */
export class PromptBuilder {
  private readonly MAX_CONTEXT_TOKENS = 4000;
  private readonly TOKEN_ESTIMATE_RATIO = 4; // chars per token (rough estimate)

  /**
   * Build a complete prompt for the query
   */
  build(
    query: AnalyzedQuery,
    chunks: RetrievedChunk[],
    format: ResponseFormat = 'markdown'
  ): BuiltPrompt {
    // Select chunks that fit in context window
    const selectedChunks = this.selectChunks(chunks);

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(query.intent, format);

    // Build user prompt with context
    const userPrompt = this.buildUserPrompt(query, selectedChunks, format);

    const estimatedTokens = this.estimateTokens(systemPrompt + userPrompt);

    logger.debug({ 
      query: query.normalized,
      chunksUsed: selectedChunks.length,
      estimatedTokens,
      format 
    }, 'Prompt built');

    return {
      systemPrompt,
      userPrompt,
      contextChunks: selectedChunks,
      estimatedTokens,
    };
  }

  /**
   * Build the system prompt with strict anti-hallucination instructions
   */
  private buildSystemPrompt(intent: QueryIntent, format: ResponseFormat): string {
    const baseInstructions = `You are a technical documentation assistant. Your responses must be:

1. **GROUNDED IN FACTS**: Only use information from the provided context. Do not use external knowledge.
2. **CITATION REQUIRED**: Cite sources for every significant claim using [source:N] format.
3. **HONEST ABOUT LIMITATIONS**: If the context doesn't contain the answer, say "I don't have enough information to answer that."
4. **PRECISE**: Be specific and technical. Avoid vague generalizations.
5. **STRUCTURED**: Organize information clearly with headers, lists, and code blocks as appropriate.`;

    const antiHallucination = `\n\n**CRITICAL - ANTI-HALLUCINATION RULES**:
- NEVER invent API endpoints, parameters, or return values not in the context
- NEVER make up code examples
- NEVER assume functionality not explicitly documented
- If information seems incomplete, state what is missing
- When uncertain, express confidence level (high/medium/low)`;

    const formatInstructions = format === 'json' 
      ? `\n\n**OUTPUT FORMAT - JSON**:
Respond with a JSON object containing:
{
  "answer": "Your detailed answer with citations",
  "confidence": "high|medium|low",
  "sources": [1, 2, 3],
  "missingInfo": "Any information that would be needed for a complete answer"
}`
      : `\n\n**OUTPUT FORMAT - MARKDOWN**:
Use markdown formatting:
- Headers (##) for sections
- Code blocks (\`\`\`language) for code
- Bullet points for lists
- **Bold** for important terms
- [source:N] citations inline`;

    const intentSpecific = this.getIntentSpecificInstructions(intent);

    return baseInstructions + antiHallucination + formatInstructions + intentSpecific;
  }

  /**
   * Get intent-specific instructions
   */
  private getIntentSpecificInstructions(intent: QueryIntent): string {
    const instructions: Record<QueryIntent, string> = {
      definition: '\n\n**TASK - DEFINITION**: Provide a clear, technical definition. Include purpose, key characteristics, and relationships to other concepts.',
      how_to: '\n\n**TASK - HOW-TO**: Provide step-by-step instructions. Number each step. Include prerequisites and expected outcomes.',
      comparison: '\n\n**TASK - COMPARISON**: Create a structured comparison. Use a table if comparing multiple items. Highlight key differences clearly.',
      troubleshoot: '\n\n**TASK - TROUBLESHOOTING**: Identify the issue, provide diagnostic steps, and offer solutions. Include common causes.',
      architecture: '\n\n**TASK - ARCHITECTURE**: Describe components, their relationships, and data flow. Reference diagrams if available.',
      api_reference: '\n\n**TASK - API REFERENCE**: Document endpoints, methods, parameters, and responses. Include example requests/responses.',
      example: '\n\n**TASK - EXAMPLE**: Provide concrete, runnable examples. Explain what the code does and when to use it.',
      general: '',
    };

    return instructions[intent] || '';
  }

  /**
   * Build the user prompt with context
   */
  private buildUserPrompt(
    query: AnalyzedQuery,
    chunks: RetrievedChunk[],
    format: ResponseFormat
  ): string {
    // Build context section
    const contextSection = this.buildContextSection(chunks);

    // Build query section
    const querySection = `## Question\n\n${query.original}`;

    // Build constraints
    const constraints = `\n\n## Constraints\n- Answer based ONLY on the provided context\n- Cite sources using [source:N] format\n- Be concise but complete\n- If information is insufficient, say so explicitly`;

    return contextSection + '\n\n' + querySection + constraints;
  }

  /**
   * Build the context section from chunks
   */
  private buildContextSection(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) {
      return '## Context\n\nNo relevant context found.';
    }

    const sections = chunks.map((chunk, index) => {
      const sourceNum = index + 1;
      const metadata = [
        `Type: ${chunk.metadata.documentType}`,
        chunk.metadata.section ? `Section: ${chunk.metadata.section}` : null,
        `Relevance: ${(chunk.score * 100).toFixed(1)}%`,
      ].filter(Boolean).join(' | ');

      return `### Source ${sourceNum}\n**Metadata**: ${metadata}\n\n${chunk.content}`;
    });

    return '## Context\n\n' + sections.join('\n\n---\n\n');
  }

  /**
   * Select chunks that fit within token limit
   */
  private selectChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const selected: RetrievedChunk[] = [];
    let estimatedTokens = 0;
    const maxTokens = this.MAX_CONTEXT_TOKENS;

    // Always include at least the top result
    for (const chunk of chunks) {
      const chunkTokens = Math.ceil(chunk.content.length / this.TOKEN_ESTIMATE_RATIO);
      
      if (estimatedTokens + chunkTokens > maxTokens && selected.length > 0) {
        break;
      }

      selected.push(chunk);
      estimatedTokens += chunkTokens;
    }

    logger.debug({ 
      totalChunks: chunks.length,
      selectedChunks: selected.length,
      estimatedTokens 
    }, 'Chunks selected for context');

    return selected;
  }

  /**
   * Estimate token count for text
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / this.TOKEN_ESTIMATE_RATIO);
  }

  /**
   * Build a "no information" response prompt
   */
  buildNoInfoPrompt(query: AnalyzedQuery): BuiltPrompt {
    const systemPrompt = `You are a technical documentation assistant. The user asked a question, but no relevant information was found in the documentation.

Your task: Politely explain that you don't have information about this topic in the current documentation. Suggest that they:
1. Check if the topic is covered under a different name
2. Add relevant documentation using \`robotin add <file>\`
3. Rephrase their question`;

    const userPrompt = `The user asked: "${query.original}"

No relevant context was found in the indexed documentation.

Please provide a helpful response explaining this limitation.`;

    return {
      systemPrompt,
      userPrompt,
      contextChunks: [],
      estimatedTokens: this.estimateTokens(systemPrompt + userPrompt),
    };
  }
}

// Singleton instance
let promptBuilderInstance: PromptBuilder | null = null;

/**
 * Get the PromptBuilder singleton
 */
export function getPromptBuilder(): PromptBuilder {
  if (!promptBuilderInstance) {
    promptBuilderInstance = new PromptBuilder();
  }
  return promptBuilderInstance;
}
