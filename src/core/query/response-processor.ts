import { getLogger } from '../../utils/logger';
import type { RetrievedChunk } from './retrieval.service';
import type { LLMResponse } from '../llm/llm.service';

const logger = getLogger().child({ module: 'ResponseProcessor' });

/**
 * Processed response with metadata
 */
export interface ProcessedResponse {
  answer: string;
  sources: SourceCitation[];
  confidence: ConfidenceLevel;
  metadata: ResponseMetadata;
}

/**
 * Source citation with chunk reference
 */
export interface SourceCitation {
  number: number;
  chunkId: string;
  documentId: string;
  content: string;
  relevance: number;
}

/**
 * Confidence level of the response
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'insufficient';

/**
 * Response metadata
 */
export interface ResponseMetadata {
  processingTimeMs: number;
  chunksUsed: number;
  tokensUsed?: number;
  modelUsed?: string;
  hasCitations: boolean;
  isGrounded: boolean;
}

/**
 * Processes LLM responses to extract citations and validate grounding
 */
export class ResponseProcessor {
  /**
   * Process a raw LLM response
   */
  process(
    llmResponse: LLMResponse,
    contextChunks: RetrievedChunk[],
    processingTimeMs: number
  ): ProcessedResponse {
    const content = llmResponse.content;

    // Extract citations from the response
    const citations = this.extractCitations(content, contextChunks);

    // Determine confidence level
    const confidence = this.determineConfidence(content, citations, contextChunks);

    // Check if response is grounded in sources
    const isGrounded = this.checkGrounding(content, citations);

    // Clean the answer (remove citation markers for display if needed)
    const answer = this.cleanAnswer(content);

    logger.debug({
      citationsFound: citations.length,
      confidence,
      isGrounded,
      processingTimeMs,
    }, 'Response processed');

    return {
      answer,
      sources: citations,
      confidence,
      metadata: {
        processingTimeMs,
        chunksUsed: contextChunks.length,
        tokensUsed: llmResponse.tokensUsed,
        modelUsed: llmResponse.model,
        hasCitations: citations.length > 0,
        isGrounded,
      },
    };
  }

  /**
   * Extract citations in [source:N] format
   */
  private extractCitations(
    content: string,
    chunks: RetrievedChunk[]
  ): SourceCitation[] {
    const citationRegex = /\[source:(\d+)\]/g;
    const citedNumbers = new Set<number>();
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      citedNumbers.add(parseInt(match[1], 10));
    }

    // Map citation numbers to chunks
    const citations: SourceCitation[] = [];
    for (const num of citedNumbers) {
      const chunk = chunks[num - 1]; // 1-indexed to 0-indexed
      if (chunk) {
        citations.push({
          number: num,
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          content: chunk.content.slice(0, 200) + (chunk.content.length > 200 ? '...' : ''),
          relevance: chunk.score,
        });
      }
    }

    return citations.sort((a, b) => a.number - b.number);
  }

  /**
   * Determine confidence level based on multiple signals
   */
  private determineConfidence(
    content: string,
    citations: SourceCitation[],
    chunks: RetrievedChunk[]
  ): ConfidenceLevel {
    // Check for explicit confidence statements
    if (content.toLowerCase().includes('i don\'t have enough information') ||
        content.toLowerCase().includes('no relevant information') ||
        content.toLowerCase().includes('not found in the documentation')) {
      return 'insufficient';
    }

    // Score based on citations
    let score = 0;

    // Has citations
    if (citations.length > 0) score += 0.3;

    // Citations are from high-relevance chunks
    const avgRelevance = citations.reduce((sum, c) => sum + c.relevance, 0) / citations.length;
    if (avgRelevance > 0.8) score += 0.3;
    else if (avgRelevance > 0.6) score += 0.2;

    // Multiple sources support the answer
    if (citations.length >= 3) score += 0.2;
    else if (citations.length >= 2) score += 0.1;

    // Content doesn't contain uncertainty markers
    const uncertaintyMarkers = [
      'might be', 'could be', 'possibly', 'perhaps', 'maybe',
      'i\'m not sure', 'unclear', 'ambiguous', 'appears to',
    ];
    const hasUncertainty = uncertaintyMarkers.some(m => 
      content.toLowerCase().includes(m)
    );
    if (!hasUncertainty) score += 0.2;

    // Map score to confidence level
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    if (score >= 0.3) return 'low';
    return 'insufficient';
  }

  /**
   * Check if response is grounded in provided sources
   */
  private checkGrounding(content: string, citations: SourceCitation[]): boolean {
    // Must have at least one citation
    if (citations.length === 0) return false;

    // Check for hallucination markers
    const hallucinationMarkers = [
      'according to my knowledge',
      'as an ai',
      'i believe',
      'in my opinion',
      'typically',
      'usually',
      'generally',
    ];

    const hasHallucinationMarker = hallucinationMarkers.some(m =>
      content.toLowerCase().includes(m)
    );

    return !hasHallucinationMarker;
  }

  /**
   * Clean answer for display (optional citation removal)
   */
  private cleanAnswer(content: string): string {
    // Keep citations in the text for now - they're useful for users
    // Could add option to remove them if needed
    return content.trim();
  }

  /**
   * Process a "no information" response
   */
  processNoInfoResponse(processingTimeMs: number): ProcessedResponse {
    return {
      answer: 'I don\'t have enough information in the indexed documentation to answer that question.\n\nYou can:\n1. Try rephrasing your question\n2. Add relevant documentation with `robotin add <file>`\n3. Check if the topic exists under a different name',
      sources: [],
      confidence: 'insufficient',
      metadata: {
        processingTimeMs,
        chunksUsed: 0,
        hasCitations: false,
        isGrounded: true,
      },
    };
  }

  /**
   * Format response for CLI display
   */
  formatForDisplay(response: ProcessedResponse): string {
    const lines: string[] = [];

    // Answer
    lines.push(response.answer);
    lines.push('');

    // Sources section
    if (response.sources.length > 0) {
      lines.push('─'.repeat(60));
      lines.push('📚 Sources:');
      for (const source of response.sources) {
        const confidence = source.relevance > 0.8 ? '🟢' : source.relevance > 0.6 ? '🟡' : '🔴';
        lines.push(`  ${confidence} [${source.number}] ${source.content.slice(0, 80)}...`);
      }
      lines.push('');
    }

    // Confidence indicator
    const confidenceEmoji = {
      high: '✅',
      medium: '⚠️',
      low: '❓',
      insufficient: '❌',
    };
    lines.push(`${confidenceEmoji[response.confidence]} Confidence: ${response.confidence.toUpperCase()}`);

    // Processing info
    lines.push(`⏱️  ${response.metadata.processingTimeMs}ms | ${response.metadata.chunksUsed} chunks`);

    return lines.join('\n');
  }

  /**
   * Format response as JSON
   */
  formatAsJson(response: ProcessedResponse): string {
    return JSON.stringify({
      answer: response.answer,
      sources: response.sources.map(s => ({
        number: s.number,
        documentId: s.documentId,
        excerpt: s.content.slice(0, 100),
        relevance: Math.round(s.relevance * 100) / 100,
      })),
      confidence: response.confidence,
      metadata: {
        ...response.metadata,
        isGrounded: undefined, // Internal field
      },
    }, null, 2);
  }
}

// Singleton instance
let responseProcessorInstance: ResponseProcessor | null = null;

/**
 * Get the ResponseProcessor singleton
 */
export function getResponseProcessor(): ResponseProcessor {
  if (!responseProcessorInstance) {
    responseProcessorInstance = new ResponseProcessor();
  }
  return responseProcessorInstance;
}
