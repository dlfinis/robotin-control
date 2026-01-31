import type { DocumentParser, ParsedDocument } from './parser.interface';
import type { TxtMetadata } from '../../models/types';

/**
 * Parser for plain text files
 * Handles .txt files and extracts basic metadata
 */
export class TxtParser implements DocumentParser {
  /**
   * Check if content appears to be plain text
   */
  canParse(input: Buffer | string, fileName?: string): boolean {
    // Check file extension
    if (fileName && fileName.toLowerCase().endsWith('.txt')) {
      return true;
    }
    
    // Check if content is valid UTF-8 text
    const content = this.bufferToString(input);
    
    // Simple heuristic: if it contains mostly printable characters, it's likely text
    const printableRatio = this.calculatePrintableRatio(content);
    return printableRatio > 0.9;
  }

  /**
   * Parse text content and extract metadata
   */
  async parse(input: Buffer | string): Promise<ParsedDocument> {
    const content = this.bufferToString(input);
    
    // Detect encoding (simplified - assumes UTF-8)
    const encoding = 'utf-8';
    
    // Count lines
    const lines = content.split('\n');
    const lineCount = lines.length;
    
    // Check for frontmatter (YAML between --- markers)
    const frontmatterResult = this.extractFrontmatter(content);
    const hasFrontmatter = frontmatterResult.hasFrontmatter;
    const cleanContent = frontmatterResult.content;
    const frontmatter = frontmatterResult.frontmatter;
    
    // Extract title from first heading or first line
    const title = this.extractTitle(cleanContent);

    const metadata: TxtMetadata = {
      encoding,
      lineCount,
      hasFrontmatter,
      frontmatter: hasFrontmatter ? frontmatter : undefined,
    };

    return {
      content: cleanContent,
      metadata,
      title,
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
   * Calculate ratio of printable characters
   */
  private calculatePrintableRatio(content: string): number {
    if (content.length === 0) return 1;
    
    let printable = 0;
    for (const char of content) {
      const code = char.charCodeAt(0);
      // Allow printable ASCII, newlines, tabs, and extended Unicode
      if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13 || code > 127) {
        printable++;
      }
    }
    
    return printable / content.length;
  }

  /**
   * Extract YAML frontmatter from content
   */
  private extractFrontmatter(content: string): {
    hasFrontmatter: boolean;
    content: string;
    frontmatter: Record<string, unknown>;
  } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(frontmatterRegex);
    
    if (!match) {
      return {
        hasFrontmatter: false,
        content,
        frontmatter: {},
      };
    }

    // Simple YAML parsing (for MVP)
    const frontmatterText = match[1];
    const frontmatter: Record<string, unknown> = {};
    
    for (const line of frontmatterText.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        frontmatter[key] = this.parseYamlValue(value);
      }
    }

    return {
      hasFrontmatter: true,
      content: content.slice(match[0].length),
      frontmatter,
    };
  }

  /**
   * Parse a YAML value (simplified)
   */
  private parseYamlValue(value: string): unknown {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    // Try to parse as number
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    
    // Try to parse as boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    return value;
  }

  /**
   * Extract title from content
   */
  private extractTitle(content: string): string | undefined {
    // Try to find first markdown heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    
    // Fallback to first non-empty line
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.length < 100) {
        return trimmed;
      }
    }
    
    return undefined;
  }
}
