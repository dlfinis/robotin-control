import type { DocumentParser } from './parser.interface';
import type { DocumentType } from '../../models/types';
import { TxtParser } from './txt.parser';
import { OpenAPIParser } from './openapi.parser';
import { PlantUMLParser } from './plantuml.parser';

/**
 * Factory for creating document parsers
 * Provides parser selection by type and auto-detection
 */
export class ParserFactory {
  private static txtParser = new TxtParser();
  private static openAPIParser = new OpenAPIParser();
  private static plantUMLParser = new PlantUMLParser();

  /**
   * Get a parser for a specific document type
   * @param type - The document type
   * @returns The appropriate parser
   * @throws Error if type is not supported
   */
  static getParser(type: DocumentType): DocumentParser {
    switch (type) {
      case 'txt' as DocumentType:
        return this.txtParser;
      case 'openapi' as DocumentType:
        return this.openAPIParser;
      case 'plantuml' as DocumentType:
        return this.plantUMLParser;
      default:
        throw new Error(`Unsupported document type: ${type}`);
    }
  }

  /**
   * Auto-detect the document type and return appropriate parser
   * @param input - Raw document content
   * @param fileName - Optional filename for additional hints
   * @returns The detected parser and type
   * @throws Error if type cannot be detected
   */
  static detectParser(
    input: Buffer | string,
    fileName?: string
  ): { parser: DocumentParser; type: DocumentType } {
    // Try each parser
    if (this.txtParser.canParse(input, fileName)) {
      return { parser: this.txtParser, type: 'txt' as DocumentType };
    }
    if (this.openAPIParser.canParse(input, fileName)) {
      return { parser: this.openAPIParser, type: 'openapi' as DocumentType };
    }
    if (this.plantUMLParser.canParse(input, fileName)) {
      return { parser: this.plantUMLParser, type: 'plantuml' as DocumentType };
    }

    // Default to txt if nothing else matches
    if (fileName) {
      const ext = fileName.toLowerCase().split('.').pop();
      if (ext === 'txt' || ext === 'md') {
        return { parser: this.txtParser, type: 'txt' as DocumentType };
      }
    }

    throw new Error(
      `Cannot detect document type${fileName ? ` for file: ${fileName}` : ''}`
    );
  }

  /**
   * Get all supported document types
   */
  static getSupportedTypes(): DocumentType[] {
    return ['txt', 'openapi', 'plantuml'] as DocumentType[];
  }

  /**
   * Check if a document type is supported
   */
  static isSupported(type: string): boolean {
    return ['txt', 'openapi', 'plantuml'].includes(type);
  }
}
