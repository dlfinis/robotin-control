import * as lancedb from '@lancedb/lancedb';
import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';
import type { Embedding, ProjectId, DocumentType } from '../../models/types';

const logger = getLogger().child({ module: 'VectorStore' });

/**
 * Search result from vector store
 */
export interface SearchResult {
  chunkId: string;
  documentId: string;
  projectId: string;
  content: string;
  relevance: number;
  metadata: {
    documentType: DocumentType;
    section?: string;
    weight: number;
  };
}

/**
 * Options for vector search
 */
export interface SearchOptions {
  projectId?: ProjectId;
  documentTypes?: DocumentType[];
  limit?: number;
  threshold?: number;
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  limit: 10,
  threshold: 0.0, // Return all results, filtering done by caller
};

/**
 * VectorStore manages embeddings in LanceDB
 * Provides semantic search capabilities
 */
export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private config = getConfig();
  private isInitialized = false;

  /**
   * Initialize the vector store connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Connect to LanceDB
      this.db = await lancedb.connect(this.config.lanceDbPath);
      
      // Get or create embeddings table
      const tableNames = await this.db.tableNames();
      
      if (tableNames.includes('embeddings')) {
        this.table = await this.db.openTable('embeddings');
        logger.info('Opened existing embeddings table');
      } else {
        this.table = await this.createEmbeddingsTable();
        logger.info('Created new embeddings table');
      }

      this.isInitialized = true;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize VectorStore');
      throw error;
    }
  }

  /**
   * Create the embeddings table with schema
   */
  private async createEmbeddingsTable(): Promise<lancedb.Table> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create table with dummy record to define schema
    // LanceDB requires at least one record or explicit schema
    const dummyRecord = {
      id: 'dummy',
      chunkId: 'dummy',
      documentId: 'dummy',
      projectId: 'dummy',
      vector: Array(384).fill(0) as number[], // Match embedding dimensions
      content: '',
      contentLength: 0,
      documentType: 'txt',
      section: '',  // Use empty string instead of null
      weight: 1.0,
      createdAt: new Date().toISOString(),
    };

    const table = await this.db.createTable('embeddings', [dummyRecord]);
    
    // Delete the dummy record immediately
    await table.delete("id = 'dummy'");

    logger.info('Created embeddings table');
    return table;
  }

  /**
   * Add a single embedding to the store
   */
  async addEmbedding(embedding: Embedding): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.table) {
      throw new Error('Table not initialized');
    }

    const record = {
      id: embedding.id,
      chunkId: embedding.chunkId,
      documentId: embedding.documentId,
      projectId: embedding.projectId,
      vector: Array.from(embedding.vector) as number[],
      content: embedding.content,
      contentLength: embedding.contentLength,
      documentType: embedding.documentType,
      section: embedding.section,
      weight: embedding.weight,
      createdAt: embedding.createdAt,
    };

    await this.table.add([record]);
    logger.debug({ embeddingId: embedding.id }, 'Embedding added');
  }

  /**
   * Add multiple embeddings in batch
   */
  async addEmbeddings(embeddings: Embedding[]): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.table) {
      throw new Error('Table not initialized');
    }

    if (embeddings.length === 0) {
      return;
    }

    const records = embeddings.map(embedding => ({
      id: embedding.id,
      chunkId: embedding.chunkId,
      documentId: embedding.documentId,
      projectId: embedding.projectId,
      vector: Array.from(embedding.vector) as number[],
      content: embedding.content,
      contentLength: embedding.contentLength,
      documentType: embedding.documentType,
      section: embedding.section,
      weight: embedding.weight,
      createdAt: embedding.createdAt,
    }));

    // Add in batches of 100
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await this.table.add(batch);
    }

    logger.debug({ count: embeddings.length }, 'Embeddings added in batches');
  }

  /**
   * Search for similar vectors
   */
  async search(
    queryVector: Float32Array,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    
    if (!this.table) {
      throw new Error('Table not initialized');
    }

    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    // Build query
    const query = this.table.search(Array.from(queryVector));

    // Apply filters
    // NOTE: LanceDB has issues with string comparisons in WHERE clauses
    // We do post-filtering in JavaScript for reliability
    const filters: string[] = [];
    // Skip LanceDB WHERE filters for string fields - do post-filtering instead

    // Execute search
    const results = await query.limit(opts.limit!).toArray();

    // Map results - convert L2 distance to similarity score
    // L2 distance is unbounded, so we use a sigmoid-like transformation
    // Typical useful range is 0-10, with < 3 being good matches
    const distanceToSimilarity = (dist: number): number => {
      return Math.max(0, 1 - (dist / 5)); // Normalize: dist 0 = 1.0, dist 5 = 0.0
    };

    let mapped = results.map((row: Record<string, unknown>) => ({
      chunkId: row.chunkId as string,
      documentId: row.documentId as string,
      projectId: row.projectId as string,
      content: row.content as string,
      relevance: distanceToSimilarity((row._distance as number) || 0),
      metadata: {
        documentType: row.documentType as DocumentType,
        section: row.section as string | undefined,
        weight: row.weight as number,
      },
    }));

    // Post-filter by projectId and documentTypes (LanceDB has issues with string WHERE clauses)
    if (opts.projectId) {
      mapped = mapped.filter(r => r.projectId === opts.projectId);
    }
    
    if (opts.documentTypes && opts.documentTypes.length > 0) {
      mapped = mapped.filter(r => opts.documentTypes!.includes(r.metadata.documentType));
    }

    return mapped.filter(result => result.relevance >= (opts.threshold || 0));
  }

  /**
   * Delete all embeddings for a document
   */
  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.table) {
      throw new Error('Table not initialized');
    }

    await this.table.delete(`documentId = '${documentId}'`);
    logger.debug({ documentId }, 'Embeddings deleted for document');
  }

  /**
   * Delete all embeddings for a project
   */
  async deleteByProjectId(projectId: ProjectId): Promise<void> {
    await this.ensureInitialized();
    
    if (!this.table) {
      throw new Error('Table not initialized');
    }

    await this.table.delete(`projectId = '${projectId}'`);
    logger.debug({ projectId }, 'Embeddings deleted for project');
  }

  /**
   * Close the vector store connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db = null;
    }
    this.table = null;
    this.isInitialized = false;
    logger.info('VectorStore closed');
  }

  /**
   * Ensure the store is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
}

// Singleton instance
let vectorStoreInstance: VectorStore | null = null;

/**
 * Get the VectorStore singleton
 */
export async function getVectorStore(): Promise<VectorStore> {
  if (!vectorStoreInstance) {
    vectorStoreInstance = new VectorStore();
    await vectorStoreInstance.initialize();
  }
  return vectorStoreInstance;
}

/**
 * Reset the VectorStore singleton
 */
export async function resetVectorStore(): Promise<void> {
  if (vectorStoreInstance) {
    await vectorStoreInstance.close();
    vectorStoreInstance = null;
  }
}
