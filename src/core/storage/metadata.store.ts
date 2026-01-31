import Database from 'better-sqlite3';
import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';
import type {
  Project,
  ProjectId,
  Document,
  DocumentId,
  Chunk,
  ChunkId,
  Session,
  SessionId,
  QueryLog,
  ProjectState,
} from '../../models/types';

const logger = getLogger().child({ module: 'MetadataStore' });

export class MetadataStore {
  private db: Database.Database;
  private statements: Map<string, Database.Statement>;

  constructor(dbPath?: string) {
    const config = getConfig();
    this.db = new Database(dbPath || config.databasePath);
    this.statements = new Map();
    
    this.initialize();
  }

  private initialize(): void {
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    this.createTables();
    this.prepareStatements();
    
    logger.info('MetadataStore initialized');
  }

  private createTables(): void {
    // Migrations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Projects table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        config JSON DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Documents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('txt', 'openapi', 'plantuml')),
        file_name TEXT NOT NULL,
        file_path TEXT,
        file_size INTEGER,
        metadata JSON DEFAULT '{}',
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'indexed', 'error')),
        error_message TEXT,
        chunk_count INTEGER DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        processing_time_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, hash)
      )
    `);

    // Chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        content TEXT NOT NULL,
        position_start INTEGER,
        position_end INTEGER,
        metadata JSON DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT,
        context JSON DEFAULT '[]',
        message_count INTEGER DEFAULT 0,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Query logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT,
        query TEXT NOT NULL,
        response TEXT NOT NULL,
        sources JSON DEFAULT '[]',
        confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
        latency_ms INTEGER,
        tokens_used INTEGER,
        query_type TEXT,
        is_cached BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      )
    `);

    // Project states table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_states (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state JSON NOT NULL,
        change_reason TEXT,
        author TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, version)
      )
    `);

    // Create indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_query_logs_project ON query_logs(project_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_project_states_project ON project_states(project_id)`);

    logger.debug('Tables created');
  }

  private prepareStatements(): void {
    // Project statements
    this.statements.set('project.insert', this.db.prepare(`
      INSERT INTO projects (id, name, description, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `));

    this.statements.set('project.getById', this.db.prepare(`
      SELECT * FROM projects WHERE id = ?
    `));

    this.statements.set('project.getByName', this.db.prepare(`
      SELECT * FROM projects WHERE name = ?
    `));

    this.statements.set('project.list', this.db.prepare(`
      SELECT * FROM projects ORDER BY updated_at DESC
    `));

    this.statements.set('project.update', this.db.prepare(`
      UPDATE projects SET name = ?, description = ?, config = ?, updated_at = ?
      WHERE id = ?
    `));

    this.statements.set('project.delete', this.db.prepare(`
      DELETE FROM projects WHERE id = ?
    `));

    // Document statements
    this.statements.set('document.insert', this.db.prepare(`
      INSERT INTO documents (
        id, project_id, hash, type, file_name, file_path, file_size,
        metadata, status, chunk_count, token_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));

    this.statements.set('document.getById', this.db.prepare(`
      SELECT * FROM documents WHERE id = ?
    `));

    this.statements.set('document.listByProject', this.db.prepare(`
      SELECT * FROM documents WHERE project_id = ? ORDER BY created_at DESC
    `));

    this.statements.set('document.updateStatus', this.db.prepare(`
      UPDATE documents 
      SET status = ?, error_message = ?, chunk_count = ?, token_count = ?, 
          processing_time_ms = ?, updated_at = ?
      WHERE id = ?
    `));

    this.statements.set('document.delete', this.db.prepare(`
      DELETE FROM documents WHERE id = ?
    `));

    // Chunk statements
    this.statements.set('chunk.insert', this.db.prepare(`
      INSERT INTO chunks (id, document_id, project_id, content, position_start, position_end, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `));

    this.statements.set('chunk.getByDocument', this.db.prepare(`
      SELECT * FROM chunks WHERE document_id = ? ORDER BY position_start
    `));

    this.statements.set('chunk.deleteByDocument', this.db.prepare(`
      DELETE FROM chunks WHERE document_id = ?
    `));

    logger.debug('Statements prepared');
  }

  // Project operations
  createProject(project: Project): void {
    const stmt = this.statements.get('project.insert')!;
    stmt.run(
      project.id,
      project.name,
      project.description || null,
      JSON.stringify(project.config),
      project.createdAt.toISOString(),
      project.updatedAt.toISOString()
    );
    logger.debug({ projectId: project.id }, 'Project created');
  }

  getProjectById(id: ProjectId): Project | undefined {
    const stmt = this.statements.get('project.getById')!;
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapProject(row) : undefined;
  }

  getProjectByName(name: string): Project | undefined {
    const stmt = this.statements.get('project.getByName')!;
    const row = stmt.get(name) as Record<string, unknown> | undefined;
    return row ? this.mapProject(row) : undefined;
  }

  listProjects(): Project[] {
    const stmt = this.statements.get('project.list')!;
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => this.mapProject(row));
  }

  updateProject(project: Project): void {
    const stmt = this.statements.get('project.update')!;
    stmt.run(
      project.name,
      project.description || null,
      JSON.stringify(project.config),
      project.updatedAt.toISOString(),
      project.id
    );
    logger.debug({ projectId: project.id }, 'Project updated');
  }

  deleteProject(id: ProjectId): void {
    const stmt = this.statements.get('project.delete')!;
    stmt.run(id);
    logger.debug({ projectId: id }, 'Project deleted');
  }

  // Document operations
  createDocument(document: Document): void {
    const stmt = this.statements.get('document.insert')!;
    stmt.run(
      document.id,
      document.projectId,
      document.hash,
      document.type,
      document.fileName,
      document.filePath || null,
      document.fileSize || null,
      JSON.stringify(document.metadata),
      document.status,
      document.chunkCount,
      document.tokenCount,
      document.createdAt.toISOString(),
      document.updatedAt.toISOString()
    );
    logger.debug({ documentId: document.id }, 'Document created');
  }

  getDocumentById(id: DocumentId): Document | undefined {
    const stmt = this.statements.get('document.getById')!;
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapDocument(row) : undefined;
  }

  listDocumentsByProject(projectId: ProjectId): Document[] {
    const stmt = this.statements.get('document.listByProject')!;
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map(row => this.mapDocument(row));
  }

  updateDocumentStatus(
    id: DocumentId,
    status: Document['status'],
    updates: Partial<Document>
  ): void {
    const stmt = this.statements.get('document.updateStatus')!;
    stmt.run(
      status,
      updates.errorMessage || null,
      updates.chunkCount || 0,
      updates.tokenCount || 0,
      updates.processingTimeMs || null,
      new Date().toISOString(),
      id
    );
    logger.debug({ documentId: id, status }, 'Document status updated');
  }

  deleteDocument(id: DocumentId): void {
    const stmt = this.statements.get('document.delete')!;
    stmt.run(id);
    logger.debug({ documentId: id }, 'Document deleted');
  }

  // Chunk operations
  createChunk(chunk: Chunk): void {
    const stmt = this.statements.get('chunk.insert')!;
    stmt.run(
      chunk.id,
      chunk.documentId,
      chunk.projectId,
      chunk.content,
      chunk.positionStart,
      chunk.positionEnd,
      JSON.stringify(chunk.metadata),
      chunk.createdAt.toISOString()
    );
  }

  getChunksByDocument(documentId: DocumentId): Chunk[] {
    const stmt = this.statements.get('chunk.getByDocument')!;
    const rows = stmt.all(documentId) as Record<string, unknown>[];
    return rows.map(row => this.mapChunk(row));
  }

  deleteChunksByDocument(documentId: DocumentId): void {
    const stmt = this.statements.get('chunk.deleteByDocument')!;
    stmt.run(documentId);
  }

  // Transaction support
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Close connection
  close(): void {
    this.db.close();
    logger.info('MetadataStore closed');
  }

  // Mappers
  private mapProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? undefined,
      config: JSON.parse(row.config as string),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapDocument(row: Record<string, unknown>): Document {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      hash: row.hash as string,
      type: row.type as Document['type'],
      fileName: row.file_name as string,
      filePath: (row.file_path as string) ?? undefined,
      fileSize: (row.file_size as number) ?? undefined,
      metadata: JSON.parse(row.metadata as string),
      status: row.status as Document['status'],
      errorMessage: (row.error_message as string) ?? undefined,
      chunkCount: row.chunk_count as number,
      tokenCount: row.token_count as number,
      processingTimeMs: row.processing_time_ms as number | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapChunk(row: Record<string, unknown>): Chunk {
    return {
      id: row.id as string,
      documentId: row.document_id as string,
      projectId: row.project_id as string,
      content: row.content as string,
      positionStart: row.position_start as number,
      positionEnd: row.position_end as number,
      metadata: JSON.parse(row.metadata as string),
      createdAt: new Date(row.created_at as string),
    };
  }
}

// Singleton instance
let storeInstance: MetadataStore | null = null;

export function getMetadataStore(): MetadataStore {
  if (!storeInstance) {
    storeInstance = new MetadataStore();
  }
  return storeInstance;
}

export function resetMetadataStore(): void {
  if (storeInstance) {
    storeInstance.close();
    storeInstance = null;
  }
}
