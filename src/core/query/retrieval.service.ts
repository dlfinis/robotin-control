import { getLogger } from '../../utils/logger';
import { getVectorStore, type SearchResult, type SearchOptions } from '../storage/vector.store';
import { getEmbedderService } from '../embedder/embedder.service';
import type { AnalyzedQuery } from './query-analyzer';
import type { ProjectId, DocumentType } from '../../models/types';

const logger = getLogger().child({ module: 'RetrievalService' });

/**
 * Retrieved chunk with relevance and ranking info
 */
export interface RetrievedChunk extends SearchResult {
  rank: number;
  score: number; // Combined score (relevance + weight adjustments)
  duplicateOf?: string; // If this is a duplicate of another chunk
}

/**
 * Options for retrieval
 */
export interface RetrievalOptions {
  projectId?: ProjectId;
  documentTypes?: DocumentType[];
  limit?: number;
  threshold?: number;
  rerank?: boolean;
  deduplicate?: boolean;
}

const DEFAULT_RETRIEVAL_OPTIONS: RetrievalOptions = {
  limit: 10,
  threshold: 0.3, // Lower threshold to catch more results with L2 distance
  rerank: true,
  deduplicate: true,
};

/**
 * Service for retrieving relevant chunks from the vector store
 * Combines vector search with ranking and deduplication
 */
export class RetrievalService {
  private vectorStorePromise = getVectorStore();
  private embedderPromise = getEmbedderService();

  /**
   * Retrieve relevant chunks for an analyzed query
   */
  async retrieve(
    analyzedQuery: AnalyzedQuery,
    options: RetrievalOptions = {}
  ): Promise<RetrievedChunk[]> {
    const opts = { ...DEFAULT_RETRIEVAL_OPTIONS, ...options };
    const startTime = Date.now();

    try {
      // Get initialized services
      const [vectorStore, embedder] = await Promise.all([
        this.vectorStorePromise,
        this.embedderPromise,
      ]);

      // Generate embedding for the query
      const queryEmbedding = await embedder.embed(analyzedQuery.normalized);

      // Build search options
      const searchOptions: SearchOptions = {
        projectId: opts.projectId,
        documentTypes: opts.documentTypes || analyzedQuery.documentTypes,
        limit: opts.limit! * 2, // Get more for reranking/deduplication
        threshold: opts.threshold,
      };

      // Perform vector search
      const results = await vectorStore.search(queryEmbedding, searchOptions);

      logger.debug({ 
        query: analyzedQuery.normalized,
        resultsFound: results.length 
      }, 'Vector search completed');

      // Convert to retrieved chunks
      let chunks: RetrievedChunk[] = results.map((r, i) => ({
        ...r,
        rank: i + 1,
        score: this.calculateScore(r, analyzedQuery),
      }));

      // Apply reranking if enabled
      if (opts.rerank) {
        chunks = this.rerank(chunks, analyzedQuery);
      }

      // Apply deduplication if enabled
      if (opts.deduplicate) {
        chunks = this.deduplicate(chunks);
      }

      // Limit to requested number
      chunks = chunks.slice(0, opts.limit);

      const duration = Date.now() - startTime;
      logger.info({ 
        query: analyzedQuery.normalized,
        chunksRetrieved: chunks.length,
        durationMs: duration 
      }, 'Retrieval completed');

      return chunks;
    } catch (error) {
      logger.error({ error, query: analyzedQuery.normalized }, 'Retrieval failed');
      throw error;
    }
  }

  /**
   * Simple retrieval without analysis (for direct queries)
   */
  async retrieveSimple(
    query: string,
    projectId?: ProjectId,
    options: Partial<RetrievalOptions> = {}
  ): Promise<RetrievedChunk[]> {
    const { getQueryAnalyzer } = await import('./query-analyzer');
    const analyzer = getQueryAnalyzer();
    const analyzed = analyzer.analyze(query);
    
    return this.retrieve(analyzed, { ...options, projectId });
  }

  /**
   * Calculate combined score for a result
   */
  private calculateScore(result: SearchResult, query: AnalyzedQuery): number {
    // Base score from vector similarity
    let score = result.relevance;

    // Boost by document weight
    score *= (1 + result.metadata.weight * 0.2);

    // Boost by intent match
    if (query.intent === 'api_reference' && result.metadata.documentType === 'openapi') {
      score *= 1.1;
    }
    if (query.intent === 'architecture' && result.metadata.documentType === 'plantuml') {
      score *= 1.1;
    }

    return Math.min(1, score);
  }

  /**
   * Rerank results based on query intent and quality signals
   */
  private rerank(chunks: RetrievedChunk[], query: AnalyzedQuery): RetrievedChunk[] {
    // Sort by combined score
    const sorted = [...chunks].sort((a, b) => b.score - a.score);

    // Reassign ranks
    return sorted.map((chunk, i) => ({
      ...chunk,
      rank: i + 1,
    }));
  }

  /**
   * Remove duplicate or near-duplicate chunks
   */
  private deduplicate(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const seen = new Map<string, RetrievedChunk>();
    const duplicates: string[] = [];

    for (const chunk of chunks) {
      // Create a fingerprint from normalized content
      const fingerprint = this.createFingerprint(chunk.content);
      
      const existing = seen.get(fingerprint);
      if (existing) {
        // Mark as duplicate of the first occurrence
        duplicates.push(chunk.chunkId);
        
        // Keep the one with higher score
        if (chunk.score > existing.score) {
          seen.set(fingerprint, { ...chunk, duplicateOf: existing.chunkId });
        }
      } else {
        seen.set(fingerprint, chunk);
      }
    }

    logger.debug({ duplicatesFound: duplicates.length }, 'Deduplication completed');

    return Array.from(seen.values());
  }

  /**
   * Create a content fingerprint for deduplication
   */
  private createFingerprint(content: string): string {
    // Normalize: lowercase, remove extra whitespace, take first 100 chars
    const normalized = content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);

    // Simple hash
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return hash.toString(16);
  }

  /**
   * Get related chunks from the same document
   */
  async getRelatedChunks(
    chunkId: string,
    documentId: string,
    limit: number = 3
  ): Promise<RetrievedChunk[]> {
    // This would require additional metadata storage
    // For now, return empty array as placeholder
    logger.debug({ chunkId, documentId }, 'Related chunks requested (not implemented)');
    return [];
  }
}

// Singleton instance
let retrievalServiceInstance: RetrievalService | null = null;

/**
 * Get the RetrievalService singleton
 */
export function getRetrievalService(): RetrievalService {
  if (!retrievalServiceInstance) {
    retrievalServiceInstance = new RetrievalService();
  }
  return retrievalServiceInstance;
}
