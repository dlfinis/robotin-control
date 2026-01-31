import { z } from 'zod';
import { DEFAULT_PROJECT_CONFIG } from '../models/types';

/**
 * Environment configuration schema using Zod for validation
 * All configuration values have sensible defaults
 */
const configSchema = z.object({
  // Data directories
  dataDir: z.string().default('./data'),
  projectsDir: z.string().default('./data/projects'),
  lanceDbPath: z.string().default('./data/lance'),
  cachePath: z.string().default('./data/cache'),
  
  // Database
  databasePath: z.string().default('./data/robotin.db'),
  
  // Logging
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  
  // LM Studio (local LLM)
  lmStudioHost: z.string().default('http://localhost:1234'),
  lmStudioModel: z.string().default('local-model'),
  
  // DeepSeek API (cheapest option, ~90% cheaper than OpenAI)
  deepseekApiKey: z.string().optional(),
  deepseekModel: z.string().default('deepseek-chat'),
  
  // Kimi API (best long context, 256K)
  kimiApiKey: z.string().optional(),
  kimiModel: z.string().default('kimi-k2.5'),
  
  // Mistral API (European, fast)
  mistralApiKey: z.string().optional(),
  mistralModel: z.string().default('mistral-small-latest'),
  
  // OpenAI API (fallback)
  openaiApiKey: z.string().optional(),
  openaiModel: z.string().default('gpt-3.5-turbo'),
  
  // Embeddings
  embeddingModel: z.string().default('Xenova/all-MiniLM-L6-v2'),
  embeddingDimensions: z.number().default(384),
  
  // API
  apiPort: z.number().default(3000),
  apiHost: z.string().default('localhost'),
  
  // Processing
  chunkSize: z.number().default(DEFAULT_PROJECT_CONFIG.chunkSize),
  chunkOverlap: z.number().default(DEFAULT_PROJECT_CONFIG.chunkOverlap),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load configuration from environment variables
 * Falls back to defaults for missing values
 */
function loadConfig(): Config {
  const env = process.env;
  
  return configSchema.parse({
    dataDir: env.ROBOTIN_DATA_DIR,
    projectsDir: env.ROBOTIN_PROJECTS_DIR,
    lanceDbPath: env.ROBOTIN_LANCEDB_PATH,
    cachePath: env.ROBOTIN_CACHE_PATH,
    databasePath: env.DATABASE_PATH,
    logLevel: env.ROBOTIN_LOG_LEVEL,
    lmStudioHost: env.LM_STUDIO_HOST,
    lmStudioModel: env.LM_STUDIO_MODEL,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekModel: env.DEEPSEEK_MODEL,
    kimiApiKey: env.KIMI_API_KEY,
    kimiModel: env.KIMI_MODEL,
    mistralApiKey: env.MISTRAL_API_KEY,
    mistralModel: env.MISTRAL_MODEL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    embeddingModel: env.EMBEDDING_MODEL,
    embeddingDimensions: env.EMBEDDING_DIMENSIONS ? parseInt(env.EMBEDDING_DIMENSIONS, 10) : undefined,
    apiPort: env.API_PORT ? parseInt(env.API_PORT, 10) : undefined,
    apiHost: env.API_HOST,
    chunkSize: env.CHUNK_SIZE ? parseInt(env.CHUNK_SIZE, 10) : undefined,
    chunkOverlap: env.CHUNK_OVERLAP ? parseInt(env.CHUNK_OVERLAP, 10) : undefined,
  });
}

// Singleton config instance
let configInstance: Config | null = null;

/**
 * Get the configuration singleton
 * Loads from environment on first call
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset the configuration singleton
 * Useful for testing
 */
export function resetConfig(): void {
  configInstance = null;
}

/**
 * Reload configuration from environment
 */
export function reloadConfig(): Config {
  configInstance = loadConfig();
  return configInstance;
}

export { DEFAULT_PROJECT_CONFIG };
