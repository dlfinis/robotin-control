import { getLogger } from '../../utils/logger';
import { getQueryAnalyzer, type AnalyzedQuery } from './query-analyzer';
import { getRetrievalService, type RetrievedChunk } from './retrieval.service';
import { getPromptBuilder, type ResponseFormat } from './prompt-builder';
import { getResponseProcessor, type ProcessedResponse } from './response-processor';
import { getLLMService, type LLMOptions } from '../llm/llm.service';
import type { ProjectId } from '../../models/types';

const logger = getLogger().child({ module: 'QueryEngine' });

/**
 * Query options
 */
export interface QueryOptions {
  projectId?: ProjectId;
  format?: ResponseFormat;
  temperature?: number;
  maxTokens?: number;
  includeSources?: boolean;
}

const DEFAULT_QUERY_OPTIONS: QueryOptions = {
  format: 'markdown',
  temperature: 0,
  maxTokens: 1024,
  includeSources: true,
};

/**
 * Query result
 */
export interface QueryResult {
  success: boolean;
  answer: string;
  sources: RetrievedChunk[];
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  metadata: {
    queryTimeMs: number;
    retrievalTimeMs: number;
    generationTimeMs: number;
    chunksRetrieved: number;
    tokensUsed?: number;
    modelUsed?: string;
  };
  error?: string;
}

/**
 * Main query engine that orchestrates the entire query pipeline:
 * 1. Analyze query intent
 * 2. Retrieve relevant chunks
 * 3. Build prompt with context
 * 4. Generate response via LLM
 * 5. Process and validate response
 */
export class QueryEngine {
  private analyzer = getQueryAnalyzer();
  private retrieval = getRetrievalService();
  private promptBuilder = getPromptBuilder();
  private responseProcessor = getResponseProcessor();
  private llmPromise = getLLMService();

  /**
   * Execute a query and return the result
   */
  async query(question: string, options: QueryOptions = {}): Promise<QueryResult> {
    const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
    const startTime = Date.now();

    try {
      logger.info({ query: question, projectId: opts.projectId }, 'Query started');

      // Step 1: Analyze query
      const analyzed = this.analyzer.analyze(question);

      // Step 2: Retrieve relevant chunks
      const retrievalStart = Date.now();
      const chunks = await this.retrieval.retrieve(analyzed, {
        projectId: opts.projectId,
        limit: 10,
        threshold: 0.6,
      });
      const retrievalTimeMs = Date.now() - retrievalStart;

      // Step 3: Check if we have any relevant information
      if (chunks.length === 0) {
        logger.warn({ query: question }, 'No relevant chunks found');
        const processed = this.responseProcessor.processNoInfoResponse(
          Date.now() - startTime
        );

        return {
          success: true,
          answer: processed.answer,
          sources: [],
          confidence: 'insufficient',
          metadata: {
            queryTimeMs: Date.now() - startTime,
            retrievalTimeMs,
            generationTimeMs: 0,
            chunksRetrieved: 0,
          },
        };
      }

      // Step 4: Build prompt
      const prompt = this.promptBuilder.build(analyzed, chunks, opts.format);

      // Step 5: Generate response via LLM
      const generationStart = Date.now();
      const llmOptions: LLMOptions = {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      };

      const llm = await this.llmPromise;
      const llmResponse = await llm.generate(prompt.userPrompt, llmOptions);
      const generationTimeMs = Date.now() - generationStart;

      // Step 6: Process response
      const processed = this.responseProcessor.process(
        llmResponse,
        prompt.contextChunks,
        Date.now() - startTime
      );

      const totalTime = Date.now() - startTime;

      logger.info({
        query: question,
        chunksRetrieved: chunks.length,
        confidence: processed.confidence,
        queryTimeMs: totalTime,
      }, 'Query completed');

      return {
        success: true,
        answer: processed.answer,
        sources: opts.includeSources ? chunks : [],
        confidence: processed.confidence,
        metadata: {
          queryTimeMs: totalTime,
          retrievalTimeMs,
          generationTimeMs,
          chunksRetrieved: chunks.length,
          tokensUsed: llmResponse.tokensUsed,
          modelUsed: llmResponse.model,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, query: question }, 'Query failed');

      return {
        success: false,
        answer: '',
        sources: [],
        confidence: 'insufficient',
        metadata: {
          queryTimeMs: Date.now() - startTime,
          retrievalTimeMs: 0,
          generationTimeMs: 0,
          chunksRetrieved: 0,
        },
        error: errorMessage,
      };
    }
  }

  /**
   * Quick search without LLM generation
   * Returns raw chunks for programmatic use
   */
  async search(question: string, projectId?: ProjectId, limit: number = 5): Promise<RetrievedChunk[]> {
    const analyzed = this.analyzer.analyze(question);
    return this.retrieval.retrieve(analyzed, { projectId, limit });
  }

  /**
   * Check if the query engine is ready
   */
  async isReady(): Promise<boolean> {
    try {
      // Check if LLM service is available
      const llm = await this.llmPromise;
      const llmAvailable = await llm.isAvailable();
      return llmAvailable;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let queryEngineInstance: QueryEngine | null = null;

/**
 * Get the QueryEngine singleton
 */
export function getQueryEngine(): QueryEngine {
  if (!queryEngineInstance) {
    queryEngineInstance = new QueryEngine();
  }
  return queryEngineInstance;
}
