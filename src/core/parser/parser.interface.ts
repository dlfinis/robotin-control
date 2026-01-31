import type { DocumentMetadata } from '../../models/types';

/**
 * Represents a parsed document with extracted content and metadata
 */
export interface ParsedDocument {
  /** Raw text content of the document */
  content: string;
  /** Structured metadata extracted from the document */
  metadata: DocumentMetadata;
  /** Optional title extracted from the document */
  title?: string;
}

/**
 * Interface for document parsers
 * Each parser implementation handles a specific document type
 */
export interface DocumentParser {
  /**
   * Parse a document from buffer or string
   * @param input - Raw document content as Buffer or string
   * @returns Parsed document with content and metadata
   */
  parse(input: Buffer | string): Promise<ParsedDocument>;
  
  /**
   * Check if this parser can handle the given content
   * @param input - Raw content to check
   * @param fileName - Optional filename for additional hints
   */
  canParse(input: Buffer | string, fileName?: string): boolean;
}
