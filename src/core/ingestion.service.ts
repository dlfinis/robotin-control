import { getStorageService } from './storage';
import { ParserFactory } from './parser';
import { getEmbedderService } from './embedder';
import { chunkText, chunkTextWithCode, estimateTokens } from '../utils/chunk';
import { getLogger } from '../utils/logger';
import { hashString } from '../utils/hash';
import type {
  Document,
  DocumentType,
  Chunk,
  ProjectId,
} from '../models/types';
import { randomUUID } from 'crypto';

const logger = getLogger().child({ module: 'IngestionService' });

/**
 * Options for document ingestion
 */
export interface IngestOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  preserveCodeBlocks?: boolean;
}

const DEFAULT_OPTIONS: IngestOptions = {
  chunkSize: 512,
  chunkOverlap: 50,
  preserveCodeBlocks: true,
};

/**
 * Result of document ingestion
 */
export interface IngestResult {
  documentId: string;
  chunkCount: number;
  tokenCount: number;
  processingTimeMs: number;
}

/**
 * Service for ingesting documents into the system
 * Coordinates parsing, chunking, embedding, and storage
 */
export class IngestionService {
  private storage = getStorageService();
  private embedderPromise = getEmbedderService();

  /**
   * Ingest a document from buffer
   */
  async ingestDocument(
    projectId: ProjectId,
    fileName: string,
    content: Buffer | string,
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.info({ fileName, projectId }, 'Starting document ingestion');

    try {
      // Step 1: Detect and parse document
      const { parser, type } = ParserFactory.detectParser(content, fileName);
      const parsed = await parser.parse(content);

      logger.debug({ type, title: parsed.title }, 'Document parsed');

      // Step 2: Calculate hash for deduplication
      const contentString = content.toString();
      const hash = hashString(contentString);

      // Check for existing document with same hash
      const existingDocs = this.storage.listDocuments(projectId);
      const duplicate = existingDocs.find(d => d.hash === hash);
      if (duplicate) {
        logger.warn({ fileName, duplicateId: duplicate.id }, 'Duplicate document detected');
        throw new Error(`Document already exists: ${duplicate.fileName}`);
      }

      // Step 3: Create document record
      const documentId = randomUUID();
      const document: Document = {
        id: documentId,
        projectId,
        hash,
        type,
        fileName,
        filePath: undefined,
        fileSize: Buffer.isBuffer(content) ? content.length : Buffer.byteLength(contentString),
        metadata: parsed.metadata,
        status: 'processing' as Document['status'],
        chunkCount: 0,
        tokenCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.storage.createDocument(document);

      // Step 4: Chunk the content
      const chunks = this.createChunks(
        parsed.content,
        documentId,
        projectId,
        opts
      );

      // Step 5: Generate embeddings
      const embedder = await this.embedderPromise;
      const embeddings = await embedder.embedChunks(
        chunks,
        documentId,
        projectId,
        type
      );

      // Step 6: Store chunks and embeddings
      await this.storage.createChunksWithEmbeddings(chunks, embeddings);

      // Step 7: Update document status
      const tokenCount = chunks.reduce((sum, c) => sum + estimateTokens(c.content), 0);
      const processingTimeMs = Date.now() - startTime;

      this.storage.updateDocumentStatus(documentId, 'indexed' as Document['status'], {
        chunkCount: chunks.length,
        tokenCount,
        processingTimeMs,
      });

      logger.info(
        { documentId, chunkCount: chunks.length, processingTimeMs },
        'Document ingestion completed'
      );

      return {
        documentId,
        chunkCount: chunks.length,
        tokenCount,
        processingTimeMs,
      };
    } catch (error) {
      logger.error({ error, fileName }, 'Document ingestion failed');
      throw error;
    }
  }

  /**
   * Ingest a document from file path
   */
  async ingestFile(
    projectId: ProjectId,
    filePath: string,
    options?: IngestOptions
  ): Promise<IngestResult> {
    const fs = await import('fs');
    const path = await import('path');

    const content = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    return this.ingestDocument(projectId, fileName, content, options);
  }

  /**
   * Create chunks from parsed content
   */
  private createChunks(
    content: string,
    documentId: string,
    projectId: string,
    options: IngestOptions
  ): Chunk[] {
    // Choose chunking strategy based on content type
    const rawChunks = options.preserveCodeBlocks
      ? chunkTextWithCode(content, {
          chunkSize: options.chunkSize,
          chunkOverlap: options.chunkOverlap,
        })
      : chunkText(content, {
          chunkSize: options.chunkSize,
          chunkOverlap: options.chunkOverlap,
        });

    // Convert to Chunk objects with IDs
    return rawChunks.map(raw => ({
      id: randomUUID(),
      documentId,
      projectId,
      content: raw.content,
      positionStart: raw.positionStart,
      positionEnd: raw.positionEnd,
      metadata: raw.metadata,
      createdAt: new Date(),
    }));
  }

  /**
   * Get ingestion statistics for a project
   */
  async getStats(projectId: ProjectId): Promise<{
    totalDocuments: number;
    totalChunks: number;
    totalTokens: number;
    averageProcessingTime: number;
  }> {
    const documents = this.storage.listDocuments(projectId);
    
    let totalChunks = 0;
    let totalTokens = 0;
    let totalProcessingTime = 0;

    for (const doc of documents) {
      totalChunks += doc.chunkCount;
      totalTokens += doc.tokenCount;
      totalProcessingTime += doc.processingTimeMs || 0;
    }

    return {
      totalDocuments: documents.length,
      totalChunks,
      totalTokens,
      averageProcessingTime: documents.length > 0
        ? totalProcessingTime / documents.length
        : 0,
    };
  }
}

// Singleton instance
let ingestionServiceInstance: IngestionService | null = null;

/**
 * Get the IngestionService singleton
 */
export function getIngestionService(): IngestionService {
  if (!ingestionServiceInstance) {
    ingestionServiceInstance = new IngestionService();
  }
  return ingestionServiceInstance;
}

/**
 * Reset the IngestionService singleton
 */
export function resetIngestionService(): void {
  ingestionServiceInstance = null;
}
