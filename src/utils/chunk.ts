import type { ChunkMetadata } from '../models/types';

/**
 * Represents a text chunk with metadata
 */
export interface Chunk {
  content: string;
  positionStart: number;
  positionEnd: number;
  metadata: ChunkMetadata;
}

/**
 * Options for text chunking
 */
export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  preserveHeaders?: boolean;
}

const DEFAULT_OPTIONS: ChunkOptions = {
  chunkSize: 512,
  chunkOverlap: 50,
  preserveHeaders: true,
};

/**
 * Split text into chunks with overlap
 * Uses sentence-based chunking for better semantic preservation
 */
export function chunkText(
  text: string,
  options: Partial<ChunkOptions> = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: Chunk[] = [];
  
  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = '';
  let currentStart = 0;
  let position = 0;
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    
    // If adding this sentence exceeds chunk size, save current chunk
    if (currentChunk.length + trimmedSentence.length > opts.chunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        positionStart: currentStart,
        positionEnd: position,
        metadata: {
          type: 'paragraph',
          weight: 1.0,
        },
      });
      
      // Start new chunk with overlap
      const overlapStart = Math.max(0, currentChunk.length - opts.chunkOverlap);
      currentChunk = currentChunk.slice(overlapStart) + ' ';
      currentStart = currentStart + overlapStart;
    }
    
    currentChunk += trimmedSentence + ' ';
    position += trimmedSentence.length + 1;
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      positionStart: currentStart,
      positionEnd: position,
      metadata: {
        type: 'paragraph',
        weight: 1.0,
      },
    });
  }
  
  return chunks;
}

/**
 * Chunk text while preserving code blocks
 * Code blocks are kept intact when possible
 */
export function chunkTextWithCode(
  text: string,
  options: Partial<ChunkOptions> = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: Chunk[] = [];
  
  // Split by code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  
  let position = 0;
  
  for (const part of parts) {
    if (part.startsWith('```')) {
      // Code block - keep as single chunk if possible
      if (part.length <= opts.chunkSize) {
        chunks.push({
          content: part,
          positionStart: position,
          positionEnd: position + part.length,
          metadata: {
            type: 'code',
            weight: 1.2, // Code has higher weight for relevance
          },
        });
      } else {
        // Split long code blocks
        const codeChunks = chunkText(part, opts);
        for (const chunk of codeChunks) {
          chunk.metadata.type = 'code';
          chunk.metadata.weight = 1.2;
        }
        chunks.push(...codeChunks);
      }
    } else {
      // Regular text
      const textChunks = chunkText(part, opts);
      chunks.push(...textChunks);
    }
    
    position += part.length;
  }
  
  return chunks;
}

/**
 * Estimate token count
 * Rough approximation: 1 token ≈ 4 characters for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Merge small chunks to optimize storage
 * Chunks smaller than minChunkSize are merged with adjacent chunks
 */
export function mergeSmallChunks(
  chunks: Chunk[],
  minChunkSize: number = 100
): Chunk[] {
  const merged: Chunk[] = [];
  let currentChunk: Chunk | null = null;
  
  for (const chunk of chunks) {
    if (!currentChunk) {
      currentChunk = { ...chunk };
    } else if (currentChunk.content.length < minChunkSize) {
      // Merge with current
      currentChunk.content += ' ' + chunk.content;
      currentChunk.positionEnd = chunk.positionEnd;
      currentChunk.metadata.weight = Math.max(
        currentChunk.metadata.weight,
        chunk.metadata.weight
      );
    } else {
      // Save current and start new
      merged.push(currentChunk);
      currentChunk = { ...chunk };
    }
  }
  
  if (currentChunk) {
    merged.push(currentChunk);
  }
  
  return merged;
}
