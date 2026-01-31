// Context management exports
export { SessionManager, getSessionManager } from './session.manager';
export type { CreateSessionOptions, AddMessageOptions } from './session.manager';

export { ProjectStateManager, getProjectStateManager } from './project-state.manager';
export type { UpdateStateOptions } from './project-state.manager';

export { NavigationService, getNavigationService } from './navigation.service';
export type { NavigationLevel, NavigationOptions, NavigationResult } from './navigation.service';

export { GapDetector, getGapDetector } from './gap-detector';
export type { Gap, GapType, CoverageReport, TopicCoverage } from './gap-detector';
