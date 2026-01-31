import { getLogger } from '../../utils/logger';
import { getMetadataStore } from '../storage/metadata.store';
import type {
  ProjectId,
  ProjectState,
  StateSnapshot,
  Decision,
  Constraint,
  Blocker,
  ProjectPhase,
} from '../../models/types';
import { randomUUID } from 'crypto';

const logger = getLogger().child({ module: 'ProjectStateManager' });

/**
 * Options for updating project state
 */
export interface UpdateStateOptions {
  changeReason?: string;
  author?: string;
}

/**
 * Manages project state with versioning and persistence
 * Tracks decisions, constraints, blockers, and project evolution
 */
export class ProjectStateManager {
  private metadataStore = getMetadataStore();

  /**
   * Get current state for a project
   */
  async getCurrentState(projectId: ProjectId): Promise<StateSnapshot | null> {
    const state = await this.metadataStore.getLatestProjectState(projectId);
    return state?.state || null;
  }

  /**
   * Initialize project state if not exists
   */
  async initializeState(
    projectId: ProjectId,
    initialState: Partial<StateSnapshot> = {},
    author?: string
  ): Promise<ProjectState> {
    const existing = await this.getCurrentState(projectId);
    if (existing) {
      throw new Error(`Project ${projectId} already has state initialized`);
    }

    const snapshot: StateSnapshot = {
      phase: initialState.phase || 'design',
      objectives: initialState.objectives || [],
      assumptions: initialState.assumptions || [],
      constraints: initialState.constraints || [],
      decisions: initialState.decisions || [],
      blockers: initialState.blockers || [],
    };

    return this.saveState(projectId, snapshot, 1, {
      changeReason: 'Initial state',
      author,
    });
  }

  /**
   * Update project state (creates new version)
   */
  async updateState(
    projectId: ProjectId,
    updates: Partial<StateSnapshot>,
    options: UpdateStateOptions = {}
  ): Promise<ProjectState> {
    const current = await this.getCurrentState(projectId);
    
    // Merge with current state
    const newSnapshot: StateSnapshot = {
      phase: updates.phase || current?.phase || 'design',
      objectives: updates.objectives || current?.objectives || [],
      assumptions: updates.assumptions || current?.assumptions || [],
      constraints: updates.constraints || current?.constraints || [],
      decisions: updates.decisions || current?.decisions || [],
      blockers: updates.blockers || current?.blockers || [],
    };

    // Get next version number
    const latest = await this.metadataStore.getLatestProjectState(projectId);
    const version = (latest?.version || 0) + 1;

    return this.saveState(projectId, newSnapshot, version, options);
  }

  /**
   * Add a decision to the project
   */
  async addDecision(
    projectId: ProjectId,
    description: string,
    author: string,
    status: Decision['status'] = 'accepted'
  ): Promise<ProjectState> {
    const current = await this.getCurrentState(projectId);
    if (!current) {
      throw new Error(`Project ${projectId} has no state. Initialize first.`);
    }

    const decision: Decision = {
      id: randomUUID(),
      description,
      date: new Date(),
      author,
      status,
    };

    const decisions = [...current.decisions, decision];
    
    return this.updateState(
      projectId,
      { ...current, decisions },
      { changeReason: `Added decision: ${description.slice(0, 50)}...`, author }
    );
  }

  /**
   * Add a constraint to the project
   */
  async addConstraint(
    projectId: ProjectId,
    type: Constraint['type'],
    description: string,
    author?: string
  ): Promise<ProjectState> {
    const current = await this.getCurrentState(projectId);
    if (!current) {
      throw new Error(`Project ${projectId} has no state. Initialize first.`);
    }

    const constraint: Constraint = {
      id: randomUUID(),
      type,
      description,
    };

    const constraints = [...current.constraints, constraint];
    
    return this.updateState(
      projectId,
      { ...current, constraints },
      { changeReason: `Added constraint: ${description.slice(0, 50)}...`, author }
    );
  }

  /**
   * Add a blocker to the project
   */
  async addBlocker(
    projectId: ProjectId,
    description: string,
    severity: Blocker['severity'],
    author?: string
  ): Promise<ProjectState> {
    const current = await this.getCurrentState(projectId);
    if (!current) {
      throw new Error(`Project ${projectId} has no state. Initialize first.`);
    }

    const blocker: Blocker = {
      id: randomUUID(),
      description,
      severity,
      dateIdentified: new Date(),
    };

    const blockers = [...current.blockers, blocker];
    
    return this.updateState(
      projectId,
      { ...current, blockers },
      { changeReason: `Added blocker: ${description.slice(0, 50)}...`, author }
    );
  }

  /**
   * Resolve a blocker
   */
  async resolveBlocker(
    projectId: ProjectId,
    blockerId: string,
    author?: string
  ): Promise<ProjectState> {
    const current = await this.getCurrentState(projectId);
    if (!current) {
      throw new Error(`Project ${projectId} has no state.`);
    }

    const blockers = current.blockers.map(b =>
      b.id === blockerId ? { ...b, resolvedAt: new Date() } : b
    );

    return this.updateState(
      projectId,
      { ...current, blockers },
      { changeReason: `Resolved blocker: ${blockerId}`, author }
    );
  }

  /**
   * Update project phase
   */
  async updatePhase(
    projectId: ProjectId,
    phase: ProjectPhase,
    author?: string
  ): Promise<ProjectState> {
    return this.updateState(
      projectId,
      { phase },
      { changeReason: `Phase changed to ${phase}`, author }
    );
  }

  /**
   * Get state history
   */
  async getStateHistory(projectId: ProjectId, limit: number = 10): Promise<ProjectState[]> {
    return this.metadataStore.getProjectStateHistory(projectId, limit);
  }

  /**
   * Get state at specific version
   */
  async getStateAtVersion(projectId: ProjectId, version: number): Promise<ProjectState | null> {
    return this.metadataStore.getProjectStateAtVersion(projectId, version);
  }

  /**
   * Format state for display
   */
  formatStateForDisplay(state: StateSnapshot): string {
    const lines: string[] = [];

    lines.push(`📊 Project Phase: ${state.phase.toUpperCase()}`);
    lines.push('');

    if (state.objectives.length > 0) {
      lines.push('🎯 Objectives:');
      state.objectives.forEach((obj, i) => lines.push(`  ${i + 1}. ${obj}`));
      lines.push('');
    }

    if (state.decisions.length > 0) {
      lines.push('📋 Recent Decisions:');
      state.decisions.slice(-5).forEach(d => {
        const status = d.status === 'accepted' ? '✓' : d.status === 'rejected' ? '✗' : '?';
        lines.push(`  ${status} ${d.description.slice(0, 60)}...`);
      });
      lines.push('');
    }

    if (state.constraints.length > 0) {
      lines.push('⚠️  Constraints:');
      state.constraints.forEach(c => lines.push(`  • [${c.type}] ${c.description.slice(0, 50)}...`));
      lines.push('');
    }

    const activeBlockers = state.blockers.filter(b => !b.resolvedAt);
    if (activeBlockers.length > 0) {
      lines.push('🚧 Active Blockers:');
      activeBlockers.forEach(b => {
        const emoji = b.severity === 'critical' ? '🔴' : b.severity === 'high' ? '🟠' : '🟡';
        lines.push(`  ${emoji} ${b.description.slice(0, 50)}...`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Save state to database
   */
  private async saveState(
    projectId: ProjectId,
    snapshot: StateSnapshot,
    version: number,
    options: UpdateStateOptions
  ): Promise<ProjectState> {
    const state: ProjectState = {
      id: randomUUID(),
      projectId,
      version,
      state: snapshot,
      changeReason: options.changeReason,
      author: options.author,
      createdAt: new Date(),
    };

    await this.metadataStore.saveProjectState(state);
    logger.debug({ projectId, version }, 'Project state saved');

    return state;
  }
}

// Singleton instance
let projectStateManagerInstance: ProjectStateManager | null = null;

/**
 * Get the ProjectStateManager singleton
 */
export function getProjectStateManager(): ProjectStateManager {
  if (!projectStateManagerInstance) {
    projectStateManagerInstance = new ProjectStateManager();
  }
  return projectStateManagerInstance;
}
