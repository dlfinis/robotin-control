import { getLogger } from '../../utils/logger';
import type { DocumentType } from '../../models/types';

const logger = getLogger().child({ module: 'QueryAnalyzer' });

/**
 * Types of user intent in queries
 */
export type QueryIntent = 
  | 'definition'      // "What is X?", "Define Y"
  | 'how_to'          // "How do I...?", "Steps to..."
  | 'comparison'      // "Compare X and Y", "Difference between"
  | 'troubleshoot'    // "Error", "Not working", "Fix"
  | 'architecture'    // "Architecture", "Components", "Structure"
  | 'api_reference'   // "API", "Endpoint", "Method"
  | 'example'         // "Example", "Sample", "Show me"
  | 'general';        // Everything else

/**
 * Analyzed query with metadata
 */
export interface AnalyzedQuery {
  original: string;
  normalized: string;
  intent: QueryIntent;
  keywords: string[];
  documentTypes: DocumentType[];
  requiresCode: boolean;
  requiresDiagram: boolean;
  confidence: number;
}

/**
 * Analyzes user queries to extract intent and metadata
 * Helps optimize retrieval strategy
 */
export class QueryAnalyzer {
  /**
   * Analyze a query and return structured metadata
   */
  analyze(query: string): AnalyzedQuery {
    const normalized = this.normalize(query);
    const intent = this.detectIntent(normalized);
    const keywords = this.extractKeywords(normalized);
    const documentTypes = this.inferDocumentTypes(intent, normalized);
    
    logger.debug({ 
      query: normalized, 
      intent, 
      keywords,
      documentTypes 
    }, 'Query analyzed');

    return {
      original: query,
      normalized,
      intent,
      keywords,
      documentTypes,
      requiresCode: this.detectCodeRequirement(normalized),
      requiresDiagram: this.detectDiagramRequirement(normalized),
      confidence: this.calculateConfidence(normalized, intent),
    };
  }

  /**
   * Normalize query text
   */
  private normalize(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[?.,!;:]$/, '');
  }

  /**
   * Detect user intent from query patterns
   */
  private detectIntent(query: string): QueryIntent {
    const patterns: Record<QueryIntent, RegExp[]> = {
      definition: [
        /^(what is|what's|define|explain|describe|meaning of)/,
        /\b(definition|meaning|concept)\b/,
      ],
      how_to: [
        /^(how (do|can|to)|steps? (to|for)|guide (to|for)|tutorial)/,
        /\b(install|setup|configure|implement|use)\b/,
      ],
      comparison: [
        /\b(compare|versus|vs|difference between|similarities|pros? and cons?)\b/,
        /\b(better than|worse than|advantages?)\b/,
      ],
      troubleshoot: [
        /\b(error|bug|issue|problem|fail|crash|broken|not working|doesn't work)\b/,
        /\b(fix|solve|debug|troubleshoot|resolve)\b/,
      ],
      architecture: [
        /\b(architecture|structure|design|components?|modules?|system)\b/,
        /\b(how (is|does) .* (work|organized|structured))\b/,
        /\b(data flow|interaction|relationship)\b/,
      ],
      api_reference: [
        /\b(api|endpoint|method|function|class|interface|parameter|return)\b/,
        /\b(request|response|json|schema|type)\b/,
      ],
      example: [
        /\b(example|sample|demo|show me|snippet|code)\b/,
        /\b(how to (write|create|make))\b/,
      ],
      general: [
        /.*/, // Matches everything as fallback
      ],
    };

    for (const [intent, regexes] of Object.entries(patterns)) {
      for (const regex of regexes) {
        if (regex.test(query)) {
          return intent as QueryIntent;
        }
      }
    }

    return 'general';
  }

  /**
   * Extract key terms from query
   */
  private extractKeywords(query: string): string[] {
    // Remove common stop words
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'shall',
      'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
      'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'and', 'but', 'or', 'yet', 'so',
    ]);

    return query
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .map(word => word.replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
  }

  /**
   * Infer which document types are most relevant
   */
  private inferDocumentTypes(intent: QueryIntent, query: string): DocumentType[] {
    const typeMap: Record<string, DocumentType[]> = {
      api_reference: ['openapi', 'txt'],
      architecture: ['plantuml', 'txt'],
      troubleshoot: ['txt', 'openapi'],
      how_to: ['txt', 'openapi'],
      definition: ['txt', 'openapi'],
      comparison: ['txt', 'plantuml'],
      example: ['openapi', 'txt'],
      general: ['txt', 'openapi', 'plantuml'],
    };

    return typeMap[intent] || ['txt', 'openapi', 'plantuml'];
  }

  /**
   * Detect if query requires code examples
   */
  private detectCodeRequirement(query: string): boolean {
    const codePatterns = [
      /\b(code|snippet|example|implementation|function|method|class)\b/,
      /\b(javascript|typescript|python|java|go|rust|cpp|c\+\+)\b/,
      /[{}[\];=()]|\b(const|let|var|function|class|interface|type)\b/,
    ];

    return codePatterns.some(p => p.test(query));
  }

  /**
   * Detect if query requires diagrams
   */
  private detectDiagramRequirement(query: string): boolean {
    const diagramPatterns = [
      /\b(diagram|chart|flow|sequence|class|component|deployment)\b/,
      /\b(plantuml|mermaid|graphviz)\b/,
      /\b(visualization|visual|picture|show|draw)\b/,
    ];

    return diagramPatterns.some(p => p.test(query));
  }

  /**
   * Calculate confidence score for the analysis
   */
  private calculateConfidence(query: string, intent: QueryIntent): number {
    let confidence = 0.5;

    // Longer queries with more context = higher confidence
    if (query.length > 20) confidence += 0.1;
    if (query.length > 50) confidence += 0.1;

    // Specific intents increase confidence
    if (intent !== 'general') confidence += 0.2;

    // Very short queries decrease confidence
    if (query.length < 10) confidence -= 0.2;

    return Math.min(1, Math.max(0, confidence));
  }
}

// Singleton instance
let analyzerInstance: QueryAnalyzer | null = null;

/**
 * Get the QueryAnalyzer singleton
 */
export function getQueryAnalyzer(): QueryAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new QueryAnalyzer();
  }
  return analyzerInstance;
}
