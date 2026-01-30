/**
 * Match Debug Types & Helpers
 *
 * Provides structured logging for the matching algorithm.
 * Enable debug mode with: MATCHING_DEBUG=true
 * Trace specific pair with: MATCHING_TRACE_USER_A=<userId> MATCHING_TRACE_USER_B=<userId>
 */

export interface CheckResult {
  passed: boolean;
  reason: string;
  details: Record<string, any>;
  steps?: StepLog[];
}

export interface ZoneCheckDetail {
  zoneLabel: string | null;
  zoneLat: number;
  zoneLng: number;
  zoneRadius: number;
  homeLat: number;
  homeLng: number;
  distance: number;
  passed: boolean;
}

export interface DateOverlapDetail {
  searchAStart: string;
  searchAEnd: string;
  searchBStart: string;
  searchBEnd: string;
  toleranceA: number;
  toleranceB: number;
  expandedAStart: string;
  expandedAEnd: string;
  expandedBStart: string;
  expandedBEnd: string;
  hasIntersection: boolean;
}

export interface MatchEvaluationLog {
  runId: string;
  seekerIntentId: number;
  seekerUserId: number;
  targetIntentId: number;
  targetUserId: number;
  steps: StepLog[];
  finalResult: 'MATCH_CREATED' | 'REJECTED';
  rejectionStep?: string;
  rejectionReason?: string;
}

export interface StepLog {
  step: string;
  passed: boolean;
  reason: string;
  details: Record<string, any>;
}

export class MatchLogger {
  private runId: string;
  private debugMode: boolean;
  private traceUserA: number | null;
  private traceUserB: number | null;
  private logs: string[] = [];

  constructor() {
    this.runId = this.generateRunId();
    this.debugMode = process.env.MATCHING_DEBUG === 'true';
    this.traceUserA = process.env.MATCHING_TRACE_USER_A
      ? parseInt(process.env.MATCHING_TRACE_USER_A, 10)
      : null;
    this.traceUserB = process.env.MATCHING_TRACE_USER_B
      ? parseInt(process.env.MATCHING_TRACE_USER_B, 10)
      : null;
  }

  private generateRunId(): string {
    const now = new Date();
    return `${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
  }

  getRunId(): string {
    return this.runId;
  }

  isDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * Check if we should trace this specific pair
   */
  shouldTracePair(userA: number, userB: number): boolean {
    if (this.traceUserA === null || this.traceUserB === null) {
      return false;
    }
    return (
      (userA === this.traceUserA && userB === this.traceUserB) ||
      (userA === this.traceUserB && userB === this.traceUserA)
    );
  }

  /**
   * Log a step for a specific pair evaluation
   */
  logStep(
    seekerIntentId: number,
    targetIntentId: number,
    step: string,
    result: CheckResult,
    forceLog = false,
  ): void {
    const shouldLog = forceLog || this.debugMode;
    if (!shouldLog) return;

    const status = result.passed ? 'PASS' : 'FAIL';
    const detailsStr = Object.entries(result.details)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');

    const message = `[Matching][RunId=${this.runId}][Seeker=${seekerIntentId}][Target=${targetIntentId}] ${step}: ${status} - ${result.reason} (${detailsStr})`;

    console.log(message);
    this.logs.push(message);
  }

  /**
   * Log detailed step for traced pair
   */
  logTracedStep(
    seekerUserId: number,
    targetUserId: number,
    seekerIntentId: number,
    targetIntentId: number,
    step: string,
    result: CheckResult,
  ): void {
    if (!this.shouldTracePair(seekerUserId, targetUserId)) {
      // Still log in debug mode
      if (this.debugMode) {
        this.logStep(seekerIntentId, targetIntentId, step, result);
      }
      return;
    }

    // Force log for traced pair
    this.logStep(seekerIntentId, targetIntentId, step, result, true);
  }

  /**
   * Log transaction events
   */
  logTransaction(
    seekerIntentId: number,
    targetIntentId: number,
    event: 'START' | 'COMMIT' | 'ROLLBACK',
    details?: Record<string, any>,
  ): void {
    const detailsStr = details
      ? ' ' +
        Object.entries(details)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
      : '';

    const message = `[Matching][RunId=${this.runId}][TX] ${event} Seeker=${seekerIntentId} Target=${targetIntentId}${detailsStr}`;
    console.log(message);
  }

  /**
   * Log match creation
   */
  logMatchCreated(
    seekerIntentId: number,
    targetIntentId: number,
    targetHomeId: number,
    matchId: number,
  ): void {
    console.log(
      `[Matching][RunId=${this.runId}] MATCH CREATED: Match#${matchId} Seeker=${seekerIntentId} -> Home=${targetHomeId} (owner Intent=${targetIntentId})`,
    );
  }

  /**
   * Log summary at end of run
   */
  logSummary(stats: {
    seekersProcessed: number;
    candidatesConsidered: number;
    matchesCreated: number;
    triangleMatchesCreated?: number;
    usersRemovedFromFlow: number;
    durationMs: number;
  }): void {
    const triangleRows = stats.triangleMatchesCreated ?? 0;
    const triangleCount = triangleRows / 3;

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                 MATCHING RUN SUMMARY                       ║
║ RunId: ${this.runId.padEnd(49)}║
╠════════════════════════════════════════════════════════════╣
║ Seekers processed:        ${String(stats.seekersProcessed).padEnd(32)}║
║ Candidates considered:    ${String(stats.candidatesConsidered).padEnd(32)}║
╠──── STANDARD (A↔B) ────────────────────────────────────────╣
║ Reciprocal matches:       ${String(stats.matchesCreated / 2).padEnd(32)}║
║ Match rows created:       ${String(stats.matchesCreated).padEnd(32)}║
╠──── TRIANGLE (A→B→C→A) ────────────────────────────────────╣
║ Triangles created:        ${String(triangleCount).padEnd(32)}║
║ Triangle rows created:    ${String(triangleRows).padEnd(32)}║
╠════════════════════════════════════════════════════════════╣
║ TOTAL Match rows:         ${String(stats.matchesCreated + triangleRows).padEnd(32)}║
║ Users removed from flow:  ${String(stats.usersRemovedFromFlow).padEnd(32)}║
║ Duration:                 ${(stats.durationMs + 'ms').padEnd(32)}║
╚════════════════════════════════════════════════════════════╝
    `);
  }

  /**
   * Log info message
   */
  info(message: string): void {
    console.log(`[Matching][RunId=${this.runId}] ${message}`);
  }

  /**
   * Log debug message (only in debug mode)
   */
  debug(message: string): void {
    if (this.debugMode) {
      console.log(`[Matching][RunId=${this.runId}][DEBUG] ${message}`);
    }
  }

  /**
   * Log warning
   */
  warn(message: string): void {
    console.warn(`[Matching][RunId=${this.runId}][WARN] ${message}`);
  }

  /**
   * Log error
   */
  error(message: string, error?: Error): void {
    console.error(
      `[Matching][RunId=${this.runId}][ERROR] ${message}`,
      error?.stack || '',
    );
  }
}

/**
 * Helper functions for creating CheckResult
 */
export const CheckResults = {
  pass(reason: string, details: Record<string, any> = {}): CheckResult {
    return { passed: true, reason, details };
  },

  fail(reason: string, details: Record<string, any> = {}): CheckResult {
    return { passed: false, reason, details };
  },
};
