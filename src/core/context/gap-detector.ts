import { getLogger } from '../../utils/logger';
import { getMetadataStore } from '../storage/metadata.store';
import { getRetrievalService } from '../query/retrieval.service';
import type { ProjectId, DocumentType } from '../../models/types';

const logger = getLogger().child({ module: 'GapDetector' });

/**
 * Gap type classification
 */
export type GapType = 
  | 'missing_documentation'
  | 'outdated_information'
  | 'inconsistent_data'
  | 'incomplete_api'
  | 'missing_examples';

/**
 * Detected gap
 */
export interface Gap {
  id: string;
  type: GapType;
  topic: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestedAction: string;
  relatedDocuments?: string[];
  detectedAt: Date;
}

/**
 * Coverage report for a project
 */
export interface CoverageReport {
  projectId: ProjectId;
  overallScore: number; // 0-100
  documentTypeCoverage: Record<DocumentType, number>;
  topicCoverage: TopicCoverage[];
  gaps: Gap[];
  recommendations: string[];
  generatedAt: Date;
}

/**
 * Topic coverage info
 */
export interface TopicCoverage {
  topic: string;
  occurrences: number;
  documentTypes: DocumentType[];
  hasExamples: boolean;
  hasDetails: boolean;
  score: number;
}

/**
 * Detects gaps and inconsistencies in project documentation
 */
export class GapDetector {
  private metadataStore = getMetadataStore();
  private retrieval = getRetrievalService();

  /**
   * Analyze project for gaps
   */
  async analyzeProject(projectId: ProjectId): Promise<CoverageReport> {
    logger.info({ projectId }, 'Starting gap analysis');

    const documents = this.metadataStore.listDocumentsByProject(projectId);
    const gaps: Gap[] = [];
    const topicCoverage: TopicCoverage[] = [];

    // Check document type coverage
    const documentTypeCoverage = this.calculateDocumentTypeCoverage(documents);

    // Detect missing documentation types
    const missingTypes = this.detectMissingDocumentTypes(documentTypeCoverage);
    for (const type of missingTypes) {
      gaps.push({
        id: this.generateGapId(),
        type: 'missing_documentation',
        topic: `${type} documentation`,
        description: `No ${type} documentation found in project`,
        severity: 'medium',
        suggestedAction: `Add ${type} specification files to the project`,
        detectedAt: new Date(),
      });
    }

    // Analyze API completeness if OpenAPI docs exist
    const apiDocs = documents.filter(d => d.type === 'openapi');
    for (const doc of apiDocs) {
      const apiGaps = await this.analyzeAPICompleteness(doc.id, projectId);
      gaps.push(...apiGaps);
    }

    // Detect inconsistent information
    const inconsistencyGaps = await this.detectInconsistencies(projectId);
    gaps.push(...inconsistencyGaps);

    // Analyze topic coverage
    const topics = await this.extractTopics(projectId);
    for (const topic of topics.slice(0, 20)) { // Top 20 topics
      const coverage = await this.analyzeTopicCoverage(topic, projectId);
      topicCoverage.push(coverage);

      // Flag topics with poor coverage
      if (coverage.score < 50 && coverage.occurrences > 1) {
        gaps.push({
          id: this.generateGapId(),
          type: 'missing_documentation',
          topic: topic,
          description: `Topic "${topic}" lacks comprehensive documentation`,
          severity: coverage.occurrences > 5 ? 'high' : 'medium',
          suggestedAction: `Add detailed documentation about ${topic}`,
          detectedAt: new Date(),
        });
      }
    }

    // Calculate overall score
    const overallScore = this.calculateOverallScore(documentTypeCoverage, topicCoverage, gaps);

    // Generate recommendations
    const recommendations = this.generateRecommendations(gaps, documentTypeCoverage);

    const report: CoverageReport = {
      projectId,
      overallScore,
      documentTypeCoverage,
      topicCoverage: topicCoverage.sort((a, b) => b.score - a.score),
      gaps: gaps.sort((a, b) => this.severityWeight(b.severity) - this.severityWeight(a.severity)),
      recommendations,
      generatedAt: new Date(),
    };

    logger.info({ projectId, gapCount: gaps.length, score: overallScore }, 'Gap analysis complete');
    return report;
  }

  /**
   * Check if a query can be answered with available documentation
   */
  async canAnswerQuery(query: string, projectId: ProjectId): Promise<{
    canAnswer: boolean;
    confidence: number;
    gaps: Gap[];
  }> {
    const chunks = await this.retrieval.retrieveSimple(query, projectId, 5);
    
    if (chunks.length === 0) {
      return {
        canAnswer: false,
        confidence: 0,
        gaps: [{
          id: this.generateGapId(),
          type: 'missing_documentation',
          topic: query,
          description: `No documentation found for: "${query}"`,
          severity: 'high',
          suggestedAction: 'Add relevant documentation to the project',
          detectedAt: new Date(),
        }],
      };
    }

    // Check relevance scores
    const avgRelevance = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;
    const canAnswer = avgRelevance > 0.6 && chunks.length >= 2;

    const gaps: Gap[] = [];
    if (avgRelevance < 0.7) {
      gaps.push({
        id: this.generateGapId(),
        type: 'incomplete_api',
        topic: query,
        description: `Documentation for "${query}" exists but may be incomplete`,
        severity: 'medium',
        suggestedAction: 'Review and expand documentation for this topic',
        detectedAt: new Date(),
      });
    }

    return {
      canAnswer,
      confidence: avgRelevance,
      gaps,
    };
  }

  /**
   * Calculate coverage by document type
   */
  private calculateDocumentTypeCoverage(documents: { type: DocumentType }[]): Record<DocumentType, number> {
    const counts = {
      txt: 0,
      openapi: 0,
      plantuml: 0,
    };

    for (const doc of documents) {
      counts[doc.type]++;
    }

    // Normalize to 0-100 scale (assuming 5+ docs of each type is good coverage)
    return {
      txt: Math.min(100, (counts.txt / 5) * 100),
      openapi: Math.min(100, (counts.openapi / 2) * 100),
      plantuml: Math.min(100, (counts.plantuml / 2) * 100),
    };
  }

  /**
   * Detect which document types are missing
   */
  private detectMissingDocumentTypes(coverage: Record<DocumentType, number>): DocumentType[] {
    const missing: DocumentType[] = [];
    for (const [type, score] of Object.entries(coverage)) {
      if (score === 0) {
        missing.push(type as DocumentType);
      }
    }
    return missing;
  }

  /**
   * Analyze API documentation completeness
   */
  private async analyzeAPICompleteness(documentId: string, projectId: ProjectId): Promise<Gap[]> {
    const gaps: Gap[] = [];
    const chunks = this.metadataStore.getChunksByDocument(documentId);

    // Check for endpoints without examples
    const endpoints = chunks.filter(c => 
      c.metadata.apiContext?.endpoint && 
      c.metadata.apiContext?.method
    );

    for (const endpoint of endpoints) {
      const hasExample = chunks.some(c => 
        c.content.includes('example') || 
        c.content.includes('Example') ||
        c.content.includes('```')
      );

      if (!hasExample) {
        const ctx = endpoint.metadata.apiContext;
        gaps.push({
          id: this.generateGapId(),
          type: 'missing_examples',
          topic: `${ctx.method} ${ctx.endpoint}`,
          description: `Endpoint ${ctx.method} ${ctx.endpoint} lacks examples`,
          severity: 'medium',
          suggestedAction: 'Add request/response examples',
          detectedAt: new Date(),
        });
      }
    }

    return gaps;
  }

  /**
   * Detect inconsistencies between documents
   */
  private async detectInconsistencies(projectId: ProjectId): Promise<Gap[]> {
    // This is a simplified implementation
    // A full implementation would compare entity definitions across documents
    const gaps: Gap[] = [];
    return gaps;
  }

  /**
   * Extract topics from project documents
   */
  private async extractTopics(projectId: ProjectId): Promise<string[]> {
    const chunks = this.metadataStore.getChunksByProject?.(projectId) || [];
    const topicFreq = new Map<string, number>();

    for (const chunk of chunks) {
      // Extract capitalized terms as potential topics
      const terms = chunk.content.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
      for (const term of terms) {
        const count = topicFreq.get(term) || 0;
        topicFreq.set(term, count + 1);
      }
    }

    // Return sorted by frequency
    return Array.from(topicFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([topic]) => topic);
  }

  /**
   * Analyze coverage for a specific topic
   */
  private async analyzeTopicCoverage(topic: string, projectId: ProjectId): Promise<TopicCoverage> {
    const chunks = await this.retrieval.retrieveSimple(topic, projectId, 10);
    
    const documentTypes = new Set(chunks.map(c => c.metadata.documentType));
    const hasExamples = chunks.some(c => 
      c.content.includes('example') || 
      c.content.includes('```')
    );
    const hasDetails = chunks.some(c => c.content.length > 500);

    // Calculate score
    let score = 0;
    score += Math.min(40, chunks.length * 10); // Up to 40 points for quantity
    score += documentTypes.size * 15; // Up to 45 points for diversity
    score += hasExamples ? 10 : 0;
    score += hasDetails ? 5 : 0;

    return {
      topic,
      occurrences: chunks.length,
      documentTypes: Array.from(documentTypes),
      hasExamples,
      hasDetails,
      score: Math.min(100, score),
    };
  }

  /**
   * Calculate overall coverage score
   */
  private calculateOverallScore(
    documentTypeCoverage: Record<DocumentType, number>,
    topicCoverage: TopicCoverage[],
    gaps: Gap[]
  ): number {
    const typeAvg = Object.values(documentTypeCoverage).reduce((a, b) => a + b, 0) / 3;
    const topicAvg = topicCoverage.length > 0
      ? topicCoverage.reduce((sum, t) => sum + t.score, 0) / topicCoverage.length
      : 0;
    
    // Penalize for gaps
    const gapPenalty = gaps.filter(g => g.severity === 'critical').length * 10 +
                      gaps.filter(g => g.severity === 'high').length * 5 +
                      gaps.filter(g => g.severity === 'medium').length * 2;

    return Math.max(0, (typeAvg * 0.4 + topicAvg * 0.6) - gapPenalty);
  }

  /**
   * Generate recommendations based on gaps
   */
  private generateRecommendations(
    gaps: Gap[],
    coverage: Record<DocumentType, number>
  ): string[] {
    const recommendations: string[] = [];

    // Document type recommendations
    if (coverage.openapi < 50) {
      recommendations.push('Add OpenAPI specifications for your APIs');
    }
    if (coverage.plantuml < 50) {
      recommendations.push('Add architecture diagrams (PlantUML)');
    }
    if (coverage.txt < 50) {
      recommendations.push('Add more documentation files (README, guides)');
    }

    // Gap-based recommendations
    const missingExamples = gaps.filter(g => g.type === 'missing_examples').length;
    if (missingExamples > 3) {
      recommendations.push(`Add examples to ${missingExamples} endpoints or components`);
    }

    return recommendations;
  }

  /**
   * Convert severity to numeric weight
   */
  private severityWeight(severity: Gap['severity']): number {
    const weights = { critical: 4, high: 3, medium: 2, low: 1 };
    return weights[severity];
  }

  /**
   * Generate unique gap ID
   */
  private generateGapId(): string {
    return `gap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Format coverage report for display
   */
  formatReportForDisplay(report: CoverageReport): string {
    const lines: string[] = [];

    lines.push('📊 Documentation Coverage Report');
    lines.push('');
    lines.push(`Overall Score: ${Math.round(report.overallScore)}/100`);
    lines.push('');

    lines.push('Document Type Coverage:');
    for (const [type, score] of Object.entries(report.documentTypeCoverage)) {
      const emoji = score > 70 ? '✅' : score > 40 ? '⚠️' : '❌';
      lines.push(`  ${emoji} ${type}: ${Math.round(score)}%`);
    }
    lines.push('');

    if (report.gaps.length > 0) {
      lines.push(`🚨 Gaps Detected: ${report.gaps.length}`);
      for (const gap of report.gaps.slice(0, 5)) {
        const emoji = gap.severity === 'critical' ? '🔴' : gap.severity === 'high' ? '🟠' : '🟡';
        lines.push(`  ${emoji} ${gap.topic}: ${gap.description.slice(0, 60)}...`);
      }
      lines.push('');
    }

    if (report.recommendations.length > 0) {
      lines.push('💡 Recommendations:');
      for (const rec of report.recommendations) {
        lines.push(`  • ${rec}`);
      }
    }

    return lines.join('\n');
  }
}

// Singleton instance
let gapDetectorInstance: GapDetector | null = null;

/**
 * Get the GapDetector singleton
 */
export function getGapDetector(): GapDetector {
  if (!gapDetectorInstance) {
    gapDetectorInstance = new GapDetector();
  }
  return gapDetectorInstance;
}
