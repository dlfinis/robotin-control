import { getLogger } from '../../utils/logger';
import { getMetadataStore } from '../storage/metadata.store';
import type { Session, Message, ProjectId, SessionId } from '../../models/types';
import { randomUUID } from 'crypto';

const logger = getLogger().child({ module: 'SessionManager' });

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
  name?: string;
  initialContext?: Message[];
}

/**
 * Options for adding messages
 */
export interface AddMessageOptions {
  sources?: Array<{
    chunkId: string;
    documentId: string;
    relevance: number;
    content: string;
  }>;
}

/**
 * Manages conversation sessions with persistence
 * Maintains context window and handles implicit references
 */
export class SessionManager {
  private metadataStore = getMetadataStore();
  private activeSessions = new Map<SessionId, Session>();

  /**
   * Create a new session
   */
  async createSession(projectId: ProjectId, options: CreateSessionOptions = {}): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      projectId,
      name: options.name || this.generateSessionName(),
      context: options.initialContext || [],
      messageCount: 0,
      lastActivity: new Date(),
      createdAt: new Date(),
    };

    // Persist to database
    await this.metadataStore.saveSession(session);
    this.activeSessions.set(session.id, session);

    logger.info({ sessionId: session.id, projectId }, 'Session created');
    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: SessionId): Promise<Session | null> {
    // Check cache first
    const cached = this.activeSessions.get(sessionId);
    if (cached) {
      return cached;
    }

    // Load from database
    const session = await this.metadataStore.getSession(sessionId);
    if (session) {
      this.activeSessions.set(sessionId, session);
    }

    return session;
  }

  /**
   * Get or create a session for a project
   */
  async getOrCreateSession(projectId: ProjectId, sessionId?: SessionId): Promise<Session> {
    if (sessionId) {
      const session = await this.getSession(sessionId);
      if (session && session.projectId === projectId) {
        return session;
      }
    }

    // Create new session
    return this.createSession(projectId);
  }

  /**
   * Add a message to the session
   */
  async addMessage(
    sessionId: SessionId,
    role: 'user' | 'assistant',
    content: string,
    options: AddMessageOptions = {}
  ): Promise<Session> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const message: Message = {
      role,
      content,
      timestamp: new Date(),
      sources: options.sources,
    };

    session.context.push(message);
    session.messageCount = session.context.length;
    session.lastActivity = new Date();

    // Trim context if needed (keep last 20 messages)
    const MAX_CONTEXT_MESSAGES = 20;
    if (session.context.length > MAX_CONTEXT_MESSAGES) {
      // Keep system messages and trim from the beginning
      const systemMessages = session.context.filter(m => m.role === 'system');
      const otherMessages = session.context.filter(m => m.role !== 'system');
      const trimmed = otherMessages.slice(-(MAX_CONTEXT_MESSAGES - systemMessages.length));
      session.context = [...systemMessages, ...trimmed];
    }

    // Persist
    await this.metadataStore.saveSession(session);
    this.activeSessions.set(sessionId, session);

    logger.debug({ sessionId, role, messageCount: session.messageCount }, 'Message added');
    return session;
  }

  /**
   * Get recent context for LLM
   */
  async getContextForLLM(sessionId: SessionId, maxMessages: number = 10): Promise<Message[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return [];
    }

    // Get last N messages
    return session.context.slice(-maxMessages);
  }

  /**
   * List sessions for a project
   */
  async listSessions(projectId: ProjectId, limit: number = 10): Promise<Session[]> {
    return this.metadataStore.listSessions(projectId, limit);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: SessionId): Promise<void> {
    await this.metadataStore.deleteSession(sessionId);
    this.activeSessions.delete(sessionId);
    logger.info({ sessionId }, 'Session deleted');
  }

  /**
   * Clean up old sessions
   */
  async cleanupOldSessions(maxAgeDays: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    const allSessions = await this.metadataStore.listAllSessions();
    const oldSessions = allSessions.filter(s => s.lastActivity < cutoff);

    for (const session of oldSessions) {
      await this.deleteSession(session.id);
    }

    logger.info({ deleted: oldSessions.length, maxAgeDays }, 'Old sessions cleaned up');
    return oldSessions.length;
  }

  /**
   * Detect if query has implicit references to previous context
   */
  detectImplicitReference(query: string): boolean {
    const implicitPatterns = [
      /\b(eso|eso mismo|lo anterior|lo que dijiste|tu respuesta)\b/i,
      /\b(the previous|that|what you said|your answer)\b/i,
      /\b(y|entonces|además|pero)\b/i, // Continuation words
      /\b(and|also|but|however|moreover)\b/i,
      /^\s*(y|and|pero|but)\s+/i, // Starting with conjunction
    ];

    return implicitPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Expand query with context if it has implicit references
   */
  async expandQueryWithContext(sessionId: SessionId, query: string): Promise<string> {
    if (!this.detectImplicitReference(query)) {
      return query;
    }

    const session = await this.getSession(sessionId);
    if (!session || session.context.length === 0) {
      return query;
    }

    // Get last assistant message for context
    const lastAssistantMsg = [...session.context]
      .reverse()
      .find(m => m.role === 'assistant');

    if (!lastAssistantMsg) {
      return query;
    }

    // Expand the query
    const expanded = `Context from previous response: "${lastAssistantMsg.content.slice(0, 200)}..."

User follow-up: ${query}`;

    logger.debug({ sessionId, original: query, expanded }, 'Query expanded with context');
    return expanded;
  }

  /**
   * Generate a default session name
   */
  private generateSessionName(): string {
    const now = new Date();
    return `Session ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  }

  /**
   * Update session name
   */
  async renameSession(sessionId: SessionId, name: string): Promise<Session> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.name = name;
    await this.metadataStore.saveSession(session);
    this.activeSessions.set(sessionId, session);

    return session;
  }
}

// Singleton instance
let sessionManagerInstance: SessionManager | null = null;

/**
 * Get the SessionManager singleton
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}
