// Core type definitions for Robotin Control
// All entities use UUID v4 for identifiers

// Identifier types for type safety
export type ProjectId = string;
export type DocumentId = string;
export type ChunkId = string;
export type SessionId = string;
export type QueryId = string;

// Document types supported by the system
export enum DocumentType {
  TXT = 'txt',
  OPENAPI = 'openapi',
  PLANTUML = 'plantuml',
}

// Document processing status
export enum DocumentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  INDEXED = 'indexed',
  ERROR = 'error',
}

// Project lifecycle phases
export enum ProjectPhase {
  DESIGN = 'design',
  DEVELOPMENT = 'development',
  TESTING = 'testing',
  PRODUCTION = 'production',
}

// Types of queries the system can handle
export enum QueryType {
  FACTUAL = 'factual',
  EXPLORATORY = 'exploratory',
  DIAGNOSTIC = 'diagnostic',
  COMPARATIVE = 'comparative',
}

// ============================================================================
// Project Entity
// ============================================================================

export interface Project {
  id: ProjectId;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  config: ProjectConfig;
}

export interface ProjectConfig {
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  lmStudioHost: string;
  lmStudioModel: string;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  chunkSize: 512,
  chunkOverlap: 50,
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  lmStudioHost: 'http://localhost:1234',
  lmStudioModel: 'local-model',
};

// ============================================================================
// Document Entity
// ============================================================================

export interface Document {
  id: DocumentId;
  projectId: ProjectId;
  hash: string;  // SHA-256 hash of content for deduplication
  type: DocumentType;
  fileName: string;
  filePath?: string;
  fileSize?: number;
  metadata: DocumentMetadata;
  status: DocumentStatus;
  errorMessage?: string;
  chunkCount: number;
  tokenCount: number;
  processingTimeMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentMetadata = 
  | TxtMetadata
  | OpenAPIMetadata
  | PlantUMLMetadata;

export interface TxtMetadata {
  encoding: string;
  lineCount: number;
  hasFrontmatter: boolean;
  frontmatter?: Record<string, unknown>;
}

export interface OpenAPIMetadata {
  version: string;
  title: string;
  endpointCount: number;
  schemaCount: number;
  serverUrls: string[];
}

export interface PlantUMLMetadata {
  diagramType: string;
  elementCount: number;
  relationCount: number;
}

// ============================================================================
// Chunk Entity
// ============================================================================

export interface Chunk {
  id: ChunkId;
  documentId: DocumentId;
  projectId: ProjectId;
  content: string;
  positionStart: number;
  positionEnd: number;
  metadata: ChunkMetadata;
  createdAt: Date;
}

export interface ChunkMetadata {
  section?: string;
  type: 'paragraph' | 'code' | 'list' | 'header';
  weight: number;  // Importance weight for ranking
  apiContext?: APIContext;
  diagramContext?: DiagramContext;
}

export interface APIContext {
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  schema?: string;
  operationId?: string;
}

export interface DiagramContext {
  component?: string;
  relation?: string;
  actors?: string[];
  diagramType?: string;
}

// ============================================================================
// Embedding Entity (for LanceDB)
// ============================================================================

export interface Embedding {
  id: string;
  chunkId: ChunkId;
  documentId: DocumentId;
  projectId: ProjectId;
  vector: Float32Array;
  content: string;
  contentLength: number;
  documentType: DocumentType;
  section?: string;
  weight: number;
  createdAt: Date;
}

// ============================================================================
// Session Entity
// ============================================================================

export interface Session {
  id: SessionId;
  projectId: ProjectId;
  name?: string;
  context: Message[];
  messageCount: number;
  lastActivity: Date;
  createdAt: Date;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sources?: Source[];
}

export interface Source {
  chunkId: ChunkId;
  documentId: DocumentId;
  relevance: number;
  content: string;
}

// ============================================================================
// Query Log Entity
// ============================================================================

export interface QueryLog {
  id: QueryId;
  projectId: ProjectId;
  sessionId?: SessionId;
  query: string;
  response: string;
  sources: Source[];
  confidence: number;
  latencyMs: number;
  tokensUsed?: number;
  queryType?: QueryType;
  isCached: boolean;
  createdAt: Date;
}

// ============================================================================
// Project State Entity
// ============================================================================

export interface ProjectState {
  id: string;
  projectId: ProjectId;
  version: number;
  state: StateSnapshot;
  changeReason?: string;
  author?: string;
  createdAt: Date;
}

export interface StateSnapshot {
  phase: ProjectPhase;
  objectives: string[];
  assumptions: string[];
  constraints: Constraint[];
  decisions: Decision[];
  blockers: Blocker[];
}

export interface Constraint {
  id: string;
  type: 'technical' | 'budget' | 'regulatory' | 'timeline';
  description: string;
}

export interface Decision {
  id: string;
  description: string;
  date: Date;
  author: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  supersedes?: string;
}

export interface Blocker {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  dateIdentified: Date;
  resolvedAt?: Date;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta: {
    timestamp: string;
    requestId: string;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}

// ============================================================================
// Pagination Types
// ============================================================================

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
