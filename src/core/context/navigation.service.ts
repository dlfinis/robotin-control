import { getLogger } from '../../utils/logger';
import { getRetrievalService } from '../query/retrieval.service';
import { getPromptBuilder } from '../query/prompt-builder';
import type { RetrievedChunk } from '../query/retrieval.service';
import type { ProjectId } from '../../models/types';

const logger = getLogger().child({ module: 'NavigationService' });

/**
 * Navigation level
 */
export type NavigationLevel = 'macro' | 'micro' | 'auto';

/**
 * Navigation options
 */
export interface NavigationOptions {
  level: NavigationLevel;
  topic?: string;
  maxChunks?: number;
}

/**
 * Navigation result with structured content
 */
export interface NavigationResult {
  level: NavigationLevel;
  overview: string;
  sections: NavigationSection[];
  relatedTopics: string[];
  chunks: RetrievedChunk[];
}

/**
 * Navigation section
 */
export interface NavigationSection {
  title: string;
  content: string;
  level: number;
  chunks: RetrievedChunk[];
}

/**
 * Service for navigating between macro and micro levels of detail
 */
export class NavigationService {
  private retrieval = getRetrievalService();
  private promptBuilder = getPromptBuilder();

  /**
   * Navigate to get information at the requested level
   */
  async navigate(
    query: string,
    projectId: ProjectId,
    options: NavigationOptions
  ): Promise<NavigationResult> {
    const level = options.level === 'auto' 
      ? this.detectLevelFromQuery(query) 
      : options.level;

    logger.debug({ query, level }, 'Navigation started');

    // Retrieve chunks based on level
    const chunks = await this.retrieveForLevel(query, projectId, level, options.maxChunks);

    // Build structured result
    const result: NavigationResult = {
      level,
      overview: this.generateOverview(chunks, level),
      sections: this.organizeIntoSections(chunks, level),
      relatedTopics: this.extractRelatedTopics(chunks),
      chunks,
    };

    return result;
  }

  /**
   * Detect navigation level from query
   */
  detectLevelFromQuery(query: string): NavigationLevel {
    const macroPatterns = [
      /\b(overview|summary|big picture|architecture|high.level|general|about)\b/i,
      /\b(what is|describe|explain) .* (system|project|architecture)\b/i,
      /\b(main|key|major) (components?|parts?|modules?)\b/i,
      /\b(how does .* work|how is .* organized)\b/i,
    ];

    const microPatterns = [
      /\b(detailed?|specific|implementation|code|configuration|exact)\b/i,
      /\b(how (do|can) I|steps? to|guide to)\b/i,
      /\b(parameter|argument|option|field|property)\b/i,
      /\b(example|sample|snippet)\b/i,
      /\b(error|debug|fix|troubleshoot)\b/i,
    ];

    const query_lower = query.toLowerCase();

    const macroScore = macroPatterns.filter(p => p.test(query_lower)).length;
    const microScore = microPatterns.filter(p => p.test(query_lower)).length;

    if (microScore > macroScore) return 'micro';
    if (macroScore > 0) return 'macro';
    return 'macro'; // Default to macro for general queries
  }

  /**
   * Retrieve chunks appropriate for the level
   */
  private async retrieveForLevel(
    query: string,
    projectId: ProjectId,
    level: NavigationLevel,
    maxChunks: number = 10
  ): Promise<RetrievedChunk[]> {
    // Adjust retrieval parameters based on level
    const limit = level === 'macro' ? Math.min(maxChunks, 5) : Math.min(maxChunks, 15);
    const threshold = level === 'macro' ? 0.5 : 0.7; // Lower threshold for macro to get broader context

    return this.retrieval.retrieveSimple(query, projectId, limit);
  }

  /**
   * Generate overview text from chunks
   */
  private generateOverview(chunks: RetrievedChunk[], level: NavigationLevel): string {
    if (chunks.length === 0) {
      return 'No information found for this topic.';
    }

    if (level === 'macro') {
      // For macro, create a high-level summary
      const documentTypes = new Set(chunks.map(c => c.metadata.documentType));
      const sections = new Set(chunks.map(c => c.metadata.section).filter(Boolean));
      
      return `Found information across ${chunks.length} sections from ${documentTypes.size} document types. ` +
             `Key areas: ${Array.from(sections).slice(0, 5).join(', ')}${sections.size > 5 ? '...' : ''}.`;
    } else {
      // For micro, be more specific about what was found
      const topChunk = chunks[0];
      return `Detailed information available from ${chunks.length} sources. ` +
             `Most relevant: ${topChunk.metadata.section || 'General'} ` +
             `(${Math.round(topChunk.score * 100)}% match).`;
    }
  }

  /**
   * Organize chunks into logical sections
   */
  private organizeIntoSections(chunks: RetrievedChunk[], level: NavigationLevel): NavigationSection[] {
    // Group by section/document
    const groups = new Map<string, RetrievedChunk[]>();
    
    for (const chunk of chunks) {
      const key = chunk.metadata.section || chunk.metadata.documentType;
      const existing = groups.get(key) || [];
      existing.push(chunk);
      groups.set(key, existing);
    }

    // Convert to sections
    const sections: NavigationSection[] = [];
    let sectionNum = 1;

    for (const [title, sectionChunks] of groups) {
      // Sort by relevance
      sectionChunks.sort((a, b) => b.score - a.score);

      // Combine content
      const content = sectionChunks
        .map(c => c.content)
        .join('\n\n');

      // Truncate based on level
      const maxLength = level === 'macro' ? 500 : 2000;
      const truncated = content.length > maxLength 
        ? content.slice(0, maxLength) + '...' 
        : content;

      sections.push({
        title: title.charAt(0).toUpperCase() + title.slice(1),
        content: truncated,
        level: level === 'macro' ? 1 : 2,
        chunks: sectionChunks,
      });

      sectionNum++;
      if (level === 'macro' && sectionNum > 3) break; // Limit sections for macro
    }

    return sections;
  }

  /**
   * Extract related topics from chunks
   */
  private extractRelatedTopics(chunks: RetrievedChunk[]): string[] {
    const topics = new Set<string>();
    
    for (const chunk of chunks) {
      // Extract potential topic words (capitalized phrases, technical terms)
      const words = chunk.content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
      words.forEach(w => {
        if (w.length > 3 && w.length < 30) {
          topics.add(w);
        }
      });
    }

    return Array.from(topics).slice(0, 5);
  }

  /**
   * Build prompt for navigation level
   */
  buildNavigationPrompt(
    query: string,
    result: NavigationResult,
    level: NavigationLevel
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = level === 'macro'
      ? `You are a technical architect providing high-level overviews. 
Focus on:
- System architecture and main components
- Relationships between parts
- High-level concepts and patterns
- Avoid implementation details unless specifically asked
Be concise and structured.`
      : `You are a technical expert providing detailed implementation guidance.
Focus on:
- Specific code examples and configurations
- Step-by-step instructions
- Parameters, options, and their meanings
- Common pitfalls and solutions
Be thorough and precise.`;

    const contextSection = result.sections
      .map(s => `## ${s.title}\n${s.content}`)
      .join('\n\n---\n\n');

    const userPrompt = `## Question (${level === 'macro' ? 'Overview' : 'Detailed'} level)
${query}

## Context
${contextSection}

## Instructions
${level === 'macro' 
  ? 'Provide a high-level overview. Focus on architecture, main concepts, and relationships. Be concise.' 
  : 'Provide detailed technical information. Include specific examples, parameters, and implementation details.'}`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Format navigation result for display
   */
  formatForDisplay(result: NavigationResult): string {
    const lines: string[] = [];

    // Header
    const levelEmoji = result.level === 'macro' ? '🗺️' : '🔬';
    lines.push(`${levelEmoji} ${result.level.toUpperCase()} VIEW`);
    lines.push('');

    // Overview
    lines.push(result.overview);
    lines.push('');

    // Sections
    for (const section of result.sections) {
      const indent = '  '.repeat(section.level - 1);
      lines.push(`${indent}### ${section.title}`);
      lines.push(`${indent}${section.content.slice(0, 200)}...`);
      lines.push('');
    }

    // Related topics
    if (result.relatedTopics.length > 0) {
      lines.push('🔗 Related: ' + result.relatedTopics.join(', '));
    }

    // Sources
    lines.push('');
    lines.push(`📚 ${result.chunks.length} sources`);

    return lines.join('\n');
  }

  /**
   * Switch level for the same query
   */
  async switchLevel(
    query: string,
    projectId: ProjectId,
    currentLevel: NavigationLevel
  ): Promise<NavigationResult> {
    const newLevel = currentLevel === 'macro' ? 'micro' : 'macro';
    return this.navigate(query, projectId, { level: newLevel });
  }
}

// Singleton instance
let navigationServiceInstance: NavigationService | null = null;

/**
 * Get the NavigationService singleton
 */
export function getNavigationService(): NavigationService {
  if (!navigationServiceInstance) {
    navigationServiceInstance = new NavigationService();
  }
  return navigationServiceInstance;
}
