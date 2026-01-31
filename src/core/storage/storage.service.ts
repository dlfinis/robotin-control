import { getMetadataStore, resetMetadataStore } from './metadata.store';
import { getVectorStore, resetVectorStore } from './vector.store';
import { getLogger } from '../../utils/logger';
import type {
  Project,
  ProjectId,
  Document,
  DocumentId,
  Chunk,
  Embedding,
} from '../../models/types';

const logger = getLogger().child({ module: 'StorageService' });

/**
 * Statistics about the storage
 */
export interface StorageStats {
  projects: number;
  documents: number;
  chunks: number;
  embeddings: number;
}

/**
 * Unified storage service that coordinates MetadataStore and VectorStore
 * 
 * This service provides a single interface for all storage operations,
 * handling the coordination between SQLite (metadata) and LanceDB (vectors).
 */
export class StorageService {
  private metadataStore = getMetadataStore();
  private vectorStorePromise = getVectorStore();

  // ==========================================================================
  // Project Operations
  // ==========================================================================

  /**
   * Create a new project
   */
  async createProject(project: Project): Promise<void> {
    this.metadataStore.createProject(project);
    logger.info({ projectId: project.id, name: project.name }, 'Project created');
  }

  /**
   * Get a project by ID
   */
  getProject(id: ProjectId): Project | undefined {
    return this.metadataStore.getProjectById(id);
  }

  /**
   * Get a project by name
   */
  getProjectByName(name: string): Project | undefined {
    return this.metadataStore.getProjectByName(name);
  }

  /**
   * List all projects
   */
  listProjects(): Project[] {
    return this.metadataStore.listProjects();
  }

  /**
   * Update a project
   */
  updateProject(project: Project): void {
    this.metadataStore.updateProject(project);
    logger.info({ projectId: project.id }, 'Project updated');
  }

  /**
   * Delete a project and all its data
   */
  async deleteProject(id: ProjectId): Promise<void> {
    // Delete metadata in transaction
    this.metadataStore.transaction(() => {
      this.metadataStore.deleteProject(id);
    });

    // Delete embeddings from vector store
    const vectorStore = await this.vectorStorePromise;
    await vectorStore.deleteByProjectId(id);

    logger.info({ projectId: id }, 'Project deleted');
  }

  // ==========================================================================
  // Document Operations
  // ==========================================================================

  /**
   * Create a new document
   */
  createDocument(document: Document): void {
    this.metadataStore.createDocument(document);
    logger.debug({ documentId: document.id }, 'Document created in metadata store');
  }

  /**
   * Get a document by ID
   */
  getDocument(id: DocumentId): Document | undefined {
    return this.metadataStore.getDocumentById(id);
  }

  /**
   * List all documents in a project
   */
  listDocuments(projectId: ProjectId): Document[] {
    return this.metadataStore.listDocumentsByProject(projectId);
  }

  /**
   * Update document status
   */
  updateDocumentStatus(
    id: DocumentId,
    status: Document['status'],
    updates: Partial<Document>
  ): void {
    this.metadataStore.updateDocumentStatus(id, status, updates);
  }

  /**
   * Delete a document and all its chunks/embeddings
   */
  async deleteDocument(id: DocumentId): Promise<void> {
    const document = this.getDocument(id);
    if (!document) {
      logger.warn({ documentId: id }, 'Document not found for deletion');
      return;
    }

    // Delete metadata in transaction
    this.metadataStore.transaction(() => {
      // Chunks will be deleted via CASCADE
      this.metadataStore.deleteDocument(id);
    });

    // Delete embeddings from vector store
    const vectorStore = await this.vectorStorePromise;
    await vectorStore.deleteByDocumentId(id);

    logger.info({ documentId: id }, 'Document deleted');
  }

  // ==========================================================================
  // Chunk Operations
  // ==========================================================================

  /**
   * Create a single chunk
   */
  createChunk(chunk: Chunk): void {
    this.metadataStore.createChunk(chunk);
  }

  /**
   * Get all chunks for a document
   */
  getChunks(documentId: DocumentId): Chunk[] {
    return this.metadataStore.getChunksByDocument(documentId);
  }

  /**
   * Create chunks with their embeddings in both stores
   */
  async createChunksWithEmbeddings(
    chunks: Chunk[],
    embeddings: Embedding[]
  ): Promise<void> {
    // Insert chunks in metadata store
    this.metadataStore.transaction(() => {
      for (const chunk of chunks) {
        this.metadataStore.createChunk(chunk);
      }
    });

    // Insert embeddings in vector store
    const vectorStore = await this.vectorStorePromise;
    await vectorStore.addEmbeddings(embeddings);

    logger.debug(
      { chunkCount: chunks.length, embeddingCount: embeddings.length },
      'Chunks and embeddings created'
    );
  }

  // ==========================================================================
  // Embedding Operations
  // ==========================================================================

  /**
   * Add a single embedding
   */
  async addEmbedding(embedding: Embedding): Promise<void> {
    const vectorStore = await this.vectorStorePromise;
    await vectorStore.addEmbedding(embedding);
  }

  /**
   * Add multiple embeddings
   */
  async addEmbeddings(embeddings: Embedding[]): Promise<void> {
    const vectorStore = await this.vectorStorePromise;
    await vectorStore.addEmbeddings(embeddings);
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    const projects = this.listProjects().length;
    
    let documents = 0;
    let chunks = 0;
    
    for (const project of this.listProjects()) {
      const docs = this.listDocuments(project.id);
      documents += docs.length;
      for (const doc of docs) {
        chunks += doc.chunkCount;
      }
    }

    return {
      projects,
      documents,
      chunks,
      embeddings: chunks, // 1:1 relationship in MVP
    };
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Close all storage connections
   */
  async close(): Promise<void> {
    resetMetadataStore();
    await resetVectorStore();
    logger.info('StorageService closed');
  }
}

// Singleton instance
let storageServiceInstance: StorageService | null = null;

/**
 * Get the StorageService singleton
 */
export function getStorageService(): StorageService {
  if (!storageServiceInstance) {
    storageServiceInstance = new StorageService();
  }
  return storageServiceInstance;
}

/**
 * Reset the StorageService singleton
 * Useful for testing
 */
export function resetStorageService(): void {
  storageServiceInstance = null;
}
