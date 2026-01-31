import { createHash } from 'crypto';

/**
 * Generate a SHA-256 hash for a string
 * Used for document deduplication and cache keys
 */
export function hashString(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Generate a SHA-256 hash for a buffer
 */
export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generate a short hash (16 chars) for display purposes
 */
export function shortHash(content: string): string {
  return hashString(content).slice(0, 16);
}

/**
 * Compare two hashes in constant time to prevent timing attacks
 */
export function compareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}
