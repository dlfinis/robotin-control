#!/usr/bin/env bun

/**
 * Robotin Control CLI
 * Command-line interface for the cognitive project management system
 */

import { getStorageService } from '../core/storage';
import { getLogger } from '../utils/logger';
import type { Project } from '../models/types';
import { randomUUID } from 'crypto';

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
      case 'project':
        await handleProjectCommand(args.slice(1));
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
      llmModel: 'llama2:7b',
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
