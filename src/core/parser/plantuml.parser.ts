import type { DocumentParser, ParsedDocument } from './parser.interface';
import type { PlantUMLMetadata } from '../../models/types';

/**
 * Parser for PlantUML diagram files
 * Extracts components, relationships, and diagram type
 */
export class PlantUMLParser implements DocumentParser {
  /**
   * Check if content appears to be a PlantUML diagram
   */
  canParse(input: Buffer | string, fileName?: string): boolean {
    // Check file extension
    if (fileName && fileName.toLowerCase().endsWith('.puml')) {
      return true;
    }
    
    // Check for PlantUML markers
    const content = this.bufferToString(input).slice(0, 500);
    return content.includes('@startuml') && content.includes('@enduml');
  }

  /**
   * Parse PlantUML content and extract metadata
   */
  async parse(input: Buffer | string): Promise<ParsedDocument> {
    const content = this.bufferToString(input);
    
    // Validate PlantUML format
    if (!content.includes('@startuml') || !content.includes('@enduml')) {
      throw new Error('Invalid PlantUML: missing @startuml or @enduml markers');
    }

    // Extract diagram type
    const diagramType = this.detectDiagramType(content);
    
    // Extract components (classes, actors, components, etc.)
    const components = this.extractComponents(content);
    
    // Extract relationships
    const relations = this.extractRelations(content);

    const metadata: PlantUMLMetadata = {
      diagramType,
      elementCount: components.length,
      relationCount: relations.length,
    };

    // Format content for indexing
    const formattedContent = this.formatContent(content, components, relations);

    return {
      content: formattedContent,
      metadata,
      title: this.extractTitle(content),
    };
  }

  /**
   * Convert input to string
   */
  private bufferToString(input: Buffer | string): string {
    if (Buffer.isBuffer(input)) {
      return input.toString('utf-8');
    }
    return input;
  }

  /**
   * Detect the type of diagram
   */
  private detectDiagramType(content: string): string {
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      
      // Check for diagram type declarations
      if (trimmed.startsWith('class ')) return 'class';
      if (trimmed.startsWith('actor ')) return 'usecase';
      if (trimmed.startsWith('usecase ')) return 'usecase';
      if (trimmed.startsWith('component ')) return 'component';
      if (trimmed.startsWith('package ')) return 'package';
      if (trimmed.startsWith('node ')) return 'deployment';
      if (trimmed.startsWith('cloud ')) return 'deployment';
      if (trimmed.startsWith('database ')) return 'er';
      if (trimmed.startsWith('entity ')) return 'er';
      if (trimmed.startsWith('state ')) return 'state';
      if (trimmed.startsWith('sequence ')) return 'sequence';
      if (trimmed.startsWith('activity ')) return 'activity';
      if (trimmed.includes('->') || trimmed.includes('-->')) return 'sequence';
    }
    
    return 'unknown';
  }

  /**
   * Extract components (classes, actors, components, etc.)
   */
  private extractComponents(content: string): string[] {
    const components: string[] = [];
    const lines = content.split('\n');
    
    // Patterns for different component types
    const patterns = [
      /^(?:class|interface|enum|abstract)\s+(\w+)/i,
      /^actor\s+"?([^"\n]+)"?/i,
      /^component\s+"?([^"\n]+)"?/i,
      /^usecase\s+"?([^"\n]+)"?/i,
      /^package\s+"?([^"\n]+)"?/i,
      /^node\s+"?([^"\n]+)"?/i,
      /^cloud\s+"?([^"\n]+)"?/i,
      /^database\s+"?([^"\n]+)"?/i,
      /^entity\s+"?([^"\n]+)"?/i,
      /^state\s+"?([^"\n]+)"?/i,
    ];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
          const name = match[1].trim().replace(/"/g, '');
          if (name && !components.includes(name)) {
            components.push(name);
          }
          break;
        }
      }
    }
    
    return components;
  }

  /**
   * Extract relationships between components
   */
  private extractRelations(content: string): Array<{
    from: string;
    to: string;
    type: string;
  }> {
    const relations: Array<{ from: string; to: string; type: string }> = [];
    const lines = content.split('\n');
    
    // Relationship patterns
    const relationPatterns = [
      { pattern: /(\w+)\s*(--?>\s*[*o]?\s*|--\s*|<\.\.|\.\.>\s*|--\*\s*|--o\s*)+(\w+)/, type: 'association' },
      { pattern: /(\w+)\s*(:?\s*uses\s*|:?\s*depends\s*on\s*)(\w+)/i, type: 'dependency' },
      { pattern: /(\w+)\s*(:?\s*extends\s*|:?\s*inherit\s*)(\w+)/i, type: 'inheritance' },
      { pattern: /(\w+)\s*(:?\s*implements\s*)(\w+)/i, type: 'implementation' },
      { pattern: /(\w+)\s*(:?\s*includes\s*|:?\s*include\s*)(\w+)/i, type: 'include' },
    ];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      for (const { pattern, type } of relationPatterns) {
        const match = trimmed.match(pattern);
        if (match && match[1] && match[2]) {
          relations.push({
            from: match[1].trim(),
            to: match[2].trim(),
            type,
          });
          break;
        }
      }
    }
    
    return relations;
  }

  /**
   * Extract title from diagram
   */
  private extractTitle(content: string): string | undefined {
    // Look for title directive
    const titleMatch = content.match(/title\s+(.+)/i);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    
    // Look for first component as fallback
    const components = this.extractComponents(content);
    if (components.length > 0) {
      return `${components[0]} Diagram`;
    }
    
    return undefined;
  }

  /**
   * Format PlantUML as readable text for indexing
   */
  private formatContent(
    content: string,
    components: string[],
    relations: Array<{ from: string; to: string; type: string }>
  ): string {
    const lines: string[] = [];
    
    // Add diagram type
    const diagramType = this.detectDiagramType(content);
    lines.push(`# ${diagramType.charAt(0).toUpperCase() + diagramType.slice(1)} Diagram`);
    lines.push('');
    
    // Add components section
    if (components.length > 0) {
      lines.push('## Components');
      lines.push('');
      for (const component of components) {
        lines.push(`- ${component}`);
      }
      lines.push('');
    }
    
    // Add relationships section
    if (relations.length > 0) {
      lines.push('## Relationships');
      lines.push('');
      for (const rel of relations) {
        lines.push(`- ${rel.from} ${rel.type} ${rel.to}`);
      }
      lines.push('');
    }
    
    // Add original content
    lines.push('## Source');
    lines.push('```plantuml');
    lines.push(content);
    lines.push('```');
    
    return lines.join('\n');
  }
}
