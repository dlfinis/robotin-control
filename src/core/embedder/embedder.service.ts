import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';
import type { Chunk, Embedding, DocumentType } from '../../models/types';

const logger = getLogger().child({ module: 'EmbedderService' });

/**
 * Service for generating embeddings from text chunks
 * Uses local Transformers.js by default with OpenAI fallback
 */
export class EmbedderService {
  private config = getConfig();
  private model: unknown | null = null;
  private isInitialized = false;

  /**
   * Initialize the embedding model
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Dynamic import to avoid loading if not needed
      const { pipeline } = await import('@xenova/transformers');
      this.model = await pipeline(
        'feature-extraction',
        this.config.embeddingModel,
        {
          quantized: true, // Use quantized model for faster inference
        }
      );
      
      this.isInitialized = true;
      logger.info('EmbedderService initialized with local model');
    } catch (error) {
      logger.warn({ error }, 'Failed to load local embedding model');
      throw new Error('Embedding model initialization failed');
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<Float32Array> {
    await this.ensureInitialized();

    if (!this.model) {
      throw new Error('Model not initialized');
    }

    try {
      // Call the pipeline function
      const modelFn = this.model as (text: string, options: unknown) => Promise<{ data: number[] }>;
      const output = await modelFn(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Convert to Float32Array
      const embedding = new Float32Array(output.data);
      
      logger.debug({ dimensions: embedding.length }, 'Embedding generated');
      
      return embedding;
    } catch (error) {
      logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple chunks in batch
   */
  async embedChunks(
    chunks: Chunk[],
    documentId: string,
    projectId: string,
    documentType: DocumentType
  ): Promise<Embedding[]> {
    await this.ensureInitialized();

    const embeddings: Embedding[] = [];
    const { randomUUID } = await import('crypto');

    // Process in batches to avoid memory issues
    const batchSize = 32;
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      logger.debug(
        { batchIndex: i / batchSize, batchSize: batch.length },
        'Processing embedding batch'
      );

      for (const chunk of batch) {
        const vector = await this.embed(chunk.content);
        
        const embedding: Embedding = {
          id: randomUUID(),
          chunkId: chunk.id,
          documentId,
          projectId,
          vector,
          content: chunk.content,
          contentLength: chunk.content.length,
          documentType,
          section: chunk.metadata.section,
          weight: chunk.metadata.weight,
          createdAt: new Date(),
        };

        embeddings.push(embedding);
      }
    }

    logger.info(
      { count: embeddings.length, documentId },
      'Embeddings generated for document'
    );

    return embeddings;
  }

  /**
   * Estimate tokens in text
   * Rough approximation: 1 token ≈ 4 characters
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if the service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.initialize();
      return this.isInitialized;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
}

// Singleton instance
let embedderServiceInstance: EmbedderService | null = null;

/**
 * Get the EmbedderService singleton
 */
export async function getEmbedderService(): Promise<EmbedderService> {
  if (!embedderServiceInstance) {
    embedderServiceInstance = new EmbedderService();
    await embedderServiceInstance.initialize();
  }
  return embedderServiceInstance;
}

/**
 * Reset the EmbedderService singleton
 */
export function resetEmbedderService(): void {
  embedderServiceInstance = null;
}
