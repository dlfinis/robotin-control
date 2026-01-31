#!/usr/bin/env bun

/**
 * Robotin Control CLI
 * Command-line interface for the cognitive project management system
 */

import { getStorageService } from '../core/storage';
import { getIngestionService } from '../core/ingestion.service';
import { getQueryEngine, type QueryResult } from '../core/query';
import { getResponseProcessor } from '../core/query/response-processor';
import { getSessionManager } from '../core/context/session.manager';
import { getProjectStateManager } from '../core/context/project-state.manager';
import { getGapDetector } from '../core/context/gap-detector';
import { getNavigationService } from '../core/context/navigation.service';
import { getLogger } from '../utils/logger';
import type { Project } from '../models/types';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';

const logger = getLogger();

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  logger.info({ command }, 'CLI started');

  try {
    switch (command) {
      case 'init':
        await initProject(args[1]);
        break;
      case 'add':
        await addDocument(args[1]);
        break;
      case 'project':
        await handleProjectCommand(args.slice(1));
        break;
      case 'query':
        await queryCommand(args.slice(1));
        break;
      case 'chat':
        await chatCommand();
        break;
      case 'session':
        await handleSessionCommand(args.slice(1));
        break;
      case 'state':
        await handleStateCommand(args.slice(1));
        break;
      case 'gaps':
        await analyzeGaps();
        break;
      case 'status':
        await showStatus();
        break;
      case 'version':
      case '-v':
      case '--version':
        console.log('robotin-control v0.1.0');
        break;
      case 'help':
      case '-h':
      case '--help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    logger.error({ error }, 'Command failed');
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Initialize a new project
 */
async function initProject(name?: string) {
  if (!name) {
    console.error('Usage: robotin init <project-name>');
    process.exit(1);
  }

  const storage = getStorageService();
  
  // Check if project already exists
  const existing = storage.getProjectByName(name);
  if (existing) {
    console.error(`Project "${name}" already exists`);
    process.exit(1);
  }

  const project: Project = {
    id: randomUUID(),
    name,
    description: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    config: {
      chunkSize: 512,
      chunkOverlap: 50,
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      lmStudioHost: 'http://localhost:1234',
      lmStudioModel: 'local-model',
    },
  };

  await storage.createProject(project);

  console.log(`✓ Project "${name}" created`);
  console.log(`  ID: ${project.id}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add documents: robotin add <file>');
  console.log('  2. Query: robotin query "What do I need to know?"');
}

/**
 * Add a document to the current project
 */
async function addDocument(filePath?: string) {
  if (!filePath) {
    console.error('Usage: robotin add <file-path>');
    process.exit(1);
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const storage = getStorageService();
  const ingestion = getIngestionService();

  // Get current project (for now, use the first one or require explicit project)
  const projects = storage.listProjects();
  if (projects.length === 0) {
    console.error('No projects found. Create one first with: robotin init <name>');
    process.exit(1);
  }

  // Use first project or TODO: implement project selection
  const project = projects[0];

  console.log(`📄 Ingesting: ${filePath}`);
  console.log(`   Project: ${project.name}`);
  console.log('');

  try {
    const result = await ingestion.ingestFile(project.id, filePath);

    console.log(`✓ Document indexed successfully`);
    console.log(`  ID: ${result.documentId}`);
    console.log(`  Chunks: ${result.chunkCount}`);
    console.log(`  Tokens: ${result.tokenCount}`);
    console.log(`  Time: ${result.processingTimeMs}ms`);
  } catch (error) {
    console.error('✗ Failed to ingest document');
    throw error;
  }
}

/**
 * Handle project-related commands
 */
async function handleProjectCommand(args: string[]) {
  const subCommand = args[0];
  const storage = getStorageService();

  switch (subCommand) {
    case 'list':
    case 'ls': {
      const projects = storage.listProjects();
      if (projects.length === 0) {
        console.log('No projects found');
        return;
      }

      console.log('PROJECTS');
      console.log('');
      console.log('  Name                Documents  Created');
      console.log('  ─────────────────────────────────────────');
      
      for (const project of projects) {
        const docs = storage.listDocuments(project.id);
        const date = project.createdAt.toISOString().split('T')[0];
        console.log(`  ${project.name.padEnd(18)} ${String(docs.length).padStart(5)}    ${date}`);
      }
      break;
    }

    case 'info': {
      const name = args[1];
      if (!name) {
        console.error('Usage: robotin project info <name>');
        process.exit(1);
      }

      const project = storage.getProjectByName(name);
      if (!project) {
        console.error(`Project "${name}" not found`);
        process.exit(1);
      }

      const docs = storage.listDocuments(project.id);

      console.log(`📁 ${project.name}`);
      console.log(`   ID: ${project.id}`);
      console.log(`   Description: ${project.description || '(none)'}`);
      console.log(`   Documents: ${docs.length}`);
      console.log(`   Created: ${project.createdAt.toISOString()}`);
      console.log(`   Updated: ${project.updatedAt.toISOString()}`);
      break;
    }

    default:
      console.log('Usage: robotin project <list|info>');
      break;
  }
}

/**
 * Query the knowledge base
 */
async function queryCommand(args: string[]) {
  const question = args.join(' ').trim();
  
  if (!question) {
    console.error('Usage: robotin query "<question>"');
    console.error('Example: robotin query "What is the authentication flow?"');
    process.exit(1);
  }

  // Remove surrounding quotes if present
  const cleanQuestion = question.replace(/^["']|["']$/g, '');

  const storage = getStorageService();
  const queryEngine = getQueryEngine();

  // Get current project
  const projects = storage.listProjects();
  if (projects.length === 0) {
    console.error('No projects found. Create one first with: robotin init <name>');
    process.exit(1);
  }

  const project = projects[0];

  console.log(`🔍 Query: ${cleanQuestion}`);
  console.log(`   Project: ${project.name}`);
  console.log('');

  try {
    const result = await queryEngine.query(cleanQuestion, {
      projectId: project.id,
    });

    if (!result.success) {
      console.error('✗ Query failed:', result.error);
      process.exit(1);
    }

    // Format and display response
    const processor = getResponseProcessor();
    const display = processor.formatForDisplay({
      answer: result.answer,
      sources: result.sources.map((s, i) => ({
        number: i + 1,
        chunkId: s.chunkId,
        documentId: s.documentId,
        content: s.content,
        relevance: s.score,
      })),
      confidence: result.confidence,
      metadata: {
        processingTimeMs: result.metadata.queryTimeMs,
        chunksUsed: result.metadata.chunksRetrieved,
        tokensUsed: result.metadata.tokensUsed,
        modelUsed: result.metadata.modelUsed,
        hasCitations: result.sources.length > 0,
        isGrounded: result.confidence !== 'insufficient',
      },
    });

    console.log(display);
  } catch (error) {
    console.error('✗ Query failed');
    throw error;
  }
}

/**
 * Interactive chat session
 */
async function chatCommand() {
  const storage = getStorageService();
  const queryEngine = getQueryEngine();

  // Get current project
  const projects = storage.listProjects();
  if (projects.length === 0) {
    console.error('No projects found. Create one first with: robotin init <name>');
    process.exit(1);
  }

  const project = projects[0];

  console.log('🤖 Robotin Chat');
  console.log(`   Project: ${project.name}`);
  console.log('   Type "exit" or press Ctrl+C to quit');
  console.log('');

  // Simple readline implementation
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question('You: ', async (input) => {
      const question = input.trim();
      
      if (question.toLowerCase() === 'exit' || question.toLowerCase() === 'quit') {
        console.log('\n👋 Goodbye!');
        rl.close();
        return;
      }

      if (!question) {
        askQuestion();
        return;
      }

      try {
        const result = await queryEngine.query(question, {
          projectId: project.id,
        });

        if (result.success) {
          console.log('\n🤖 Robotin:');
          console.log(result.answer);
          console.log('');
        } else {
          console.log('\n🤖 Robotin: Sorry, I encountered an error.');
        }
      } catch (error) {
        console.log('\n🤖 Robotin: Sorry, something went wrong.');
      }

      console.log('');
      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Handle session commands
 */
async function handleSessionCommand(args: string[]) {
  const subCommand = args[0];
  const storage = getStorageService();
  const sessionManager = getSessionManager();

  const projects = storage.listProjects();
  if (projects.length === 0) {
    console.error('No projects found');
    process.exit(1);
  }
  const project = projects[0];

  switch (subCommand) {
    case 'list':
    case 'ls': {
      const sessions = await sessionManager.listSessions(project.id, 10);
      if (sessions.length === 0) {
        console.log('No sessions found');
        return;
      }

      console.log('SESSIONS');
      console.log('');
      console.log('  Name                           Messages  Last Activity');
      console.log('  ──────────────────────────────────────────────────────');
      
      for (const session of sessions) {
        const name = (session.name || 'Unnamed').padEnd(30);
        const messages = String(session.messageCount).padStart(5);
        const date = session.lastActivity.toLocaleDateString();
        console.log(`  ${name} ${messages}    ${date}`);
      }
      break;
    }

    default:
      console.log('Usage: robotin session <list>');
      break;
  }
}

/**
 * Handle state commands
 */
async function handleStateCommand(args: string[]) {
  const storage = getStorageService();
  const stateManager = getProjectStateManager();

  const projects = storage.listProjects();
  if (projects.length === 0) {
    console.error('No projects found');
    process.exit(1);
  }
  const project = projects[0];

  const state = await stateManager.getCurrentState(project.id);
  if (!state) {
    console.log('No state initialized for this project');
    console.log('State will be created automatically as you interact with the project.');
    return;
  }

  console.log(stateManager.formatStateForDisplay(state));
}

/**
 * Analyze documentation gaps
 */
async function analyzeGaps() {
  const storage = getStorageService();
  const gapDetector = getGapDetector();

  const projects = storage.listProjects();
  if (projects.length === 0) {
    console.error('No projects found');
    process.exit(1);
  }
  const project = projects[0];

  console.log('🔍 Analyzing documentation gaps...');
  console.log('');

  const report = await gapDetector.analyzeProject(project.id);
  console.log(gapDetector.formatReportForDisplay(report));
}

/**
 * Show storage status
 */
async function showStatus() {
  const storage = getStorageService();
  const stats = await storage.getStats();

  console.log('📊 STORAGE STATUS');
  console.log('');
  console.log(`  Projects:   ${stats.projects}`);
  console.log(`  Documents:  ${stats.documents}`);
  console.log(`  Chunks:     ${stats.chunks}`);
  console.log(`  Embeddings: ${stats.embeddings}`);
}

/**
 * Show help message
 */
function showHelp() {
  console.log('Robotin Control - Cognitive system for project knowledge management');
  console.log('');
  console.log('Usage: robotin <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  init <name>           Initialize a new project');
  console.log('  add <file>            Add a document to the project');
  console.log('  query "<question>"    Ask a question about your documents');
  console.log('  chat                  Start interactive chat session');
  console.log('  session list          List conversation sessions');
  console.log('  state                 Show project state');
  console.log('  gaps                  Analyze documentation gaps');
  console.log('  project list          List all projects');
  console.log('  project info <name>   Show project details');
  console.log('  status                Show storage status');
  console.log('  version               Show version');
  console.log('  help                  Show this help');
  console.log('');
}

// Run main
main().catch((error) => {
  logger.fatal({ error }, 'Unhandled error');
  process.exit(1);
});
