# Debug Guide: Matching System Freeze

Ce document explique comment diagnostiquer et résoudre les blocages du système de matching.

## Symptômes courants

### 1. "Maintenance already running, skipping" en boucle

**Cause:** La maintenance précédente n'a pas terminé et `isMaintenanceRunning` est resté à `true`.

**Diagnostic:**
```bash
# Chercher les logs de maintenance
grep "maintenance_start\|step_start\|step_end\|step_timeout" logs/app.log

# Format attendu:
# {"event":"maintenance_start","runId":"maint-xxx","instanceId":"..."}
# {"event":"step_start","runId":"maint-xxx","step":"releaseStaleTasks"}
# {"event":"step_end","runId":"maint-xxx","step":"releaseStaleTasks","durationMs":5}
```

Si vous voyez `step_start` sans `step_end` correspondant, cette étape est bloquée.

### 2. Workers en boucle d'erreur

**Symptôme:** Logs `Loop error` répétés

**Causes possibles:**
- Erreur de type dans la requête SQL (ex: LIMIT reçoit une string au lieu de bigint)
- Connexion DB perdue
- Table/colonne manquante

## Commandes de diagnostic PostgreSQL

### Voir les requêtes en cours

```sql
-- Requêtes actives depuis plus de 5 secondes
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
  AND state != 'idle'
ORDER BY duration DESC;
```

### Voir les locks

```sql
-- Verrous bloquants
SELECT blocked_locks.pid     AS blocked_pid,
       blocked_activity.usename  AS blocked_user,
       blocking_locks.pid     AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query    AS blocked_statement,
       blocking_activity.query   AS current_statement_in_blocking_process
FROM  pg_catalog.pg_locks         blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity  ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks         blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

### Tuer une requête bloquée

```sql
-- Annuler une requête (soft)
SELECT pg_cancel_backend(<pid>);

-- Terminer la connexion (hard)
SELECT pg_terminate_backend(<pid>);
```

### Voir l'état des tables matching

```sql
-- Nombre de tâches par status
SELECT status, COUNT(*)
FROM "MatchingTask"
GROUP BY status;

-- Tâches RUNNING depuis trop longtemps
SELECT id, "intentId", "lockedAt", "lockedBy", attempts
FROM "MatchingTask"
WHERE status = 'RUNNING'
  AND "lockedAt" < NOW() - INTERVAL '11 minutes';

-- Intents avec lock expiré
SELECT id, "matchingProcessingUntil", "matchingProcessingBy"
FROM "Intent"
WHERE "matchingProcessingUntil" IS NOT NULL
  AND "matchingProcessingUntil" < NOW();
```

## Configuration de debug

### Variables d'environnement

```bash
# Activer les logs détaillés de maintenance
MATCHING_DEBUG=true

# Activer les logs de requêtes Prisma
PRISMA_LOG_QUERIES=true

# Réduire le timeout des étapes de maintenance (pour tests)
MATCHING_MAINTENANCE_STEP_TIMEOUT_MS=5000

# Tracer une paire d'utilisateurs spécifique
MATCHING_TRACE_USER_A=123
MATCHING_TRACE_USER_B=456
```

### Logs attendus avec MATCHING_DEBUG=true

```
[MatchingCronService] {"event":"maintenance_start","runId":"maint-xxx","instanceId":"host-123","config":{"sweepLimit":200,"taskClaimBatchSize":50,...}}
[MatchingCronService] {"event":"step_start","runId":"maint-xxx","step":"releaseStaleTasks"}
[MatchingCronService] {"event":"step_end","runId":"maint-xxx","step":"releaseStaleTasks","durationMs":3,"count":0}
[MatchingCronService] {"event":"step_start","runId":"maint-xxx","step":"releaseStaleIntents"}
[MatchingCronService] {"event":"step_end","runId":"maint-xxx","step":"releaseStaleIntents","durationMs":2,"count":0}
[MatchingCronService] {"event":"step_start","runId":"maint-xxx","step":"sweepEligibleIntents"}
[MatchingCronService] {"event":"step_end","runId":"maint-xxx","step":"sweepEligibleIntents","durationMs":5,"count":0}
[MatchingCronService] {"event":"step_start","runId":"maint-xxx","step":"cleanupOldTasks"}
[MatchingCronService] {"event":"step_end","runId":"maint-xxx","step":"cleanupOldTasks","durationMs":2,"count":0}
[MatchingCronService] {"event":"maintenance_end","runId":"maint-xxx","durationMs":15}
```

## Résolution manuelle

### Forcer la libération du flag maintenance

Si la maintenance est bloquée et que vous devez la débloquer manuellement, redémarrez simplement le backend. Le flag `isMaintenanceRunning` est en mémoire et sera réinitialisé.

### Nettoyer les tâches orphelines

```sql
-- Remettre les tâches RUNNING en PENDING (forcé)
UPDATE "MatchingTask"
SET status = 'PENDING',
    "lockedAt" = NULL,
    "lockedBy" = NULL,
    "runId" = NULL,
    "lastError" = 'Manual reset by admin',
    "updatedAt" = NOW()
WHERE status = 'RUNNING';

-- Libérer les locks d'intents
UPDATE "Intent"
SET "matchingProcessingUntil" = NULL,
    "matchingProcessingBy" = NULL
WHERE "matchingProcessingUntil" IS NOT NULL;
```

### Vider la queue (reset complet)

```sql
-- Supprimer toutes les tâches de matching
DELETE FROM "MatchingTask";

-- Réinitialiser les timestamps des intents
UPDATE "Intent"
SET "lastMatchingEnqueuedAt" = NULL,
    "lastMatchingProcessedAt" = NULL,
    "matchingProcessingUntil" = NULL,
    "matchingProcessingBy" = NULL;
```

## Architecture de référence

```
┌─────────────────────────────────────────────────────────────────┐
│                     Matching System                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────┐     ┌────────────────────┐              │
│  │  MatchingCronService│     │ MatchingWorkerService│            │
│  │  (1 instance)       │     │ (N workers × M VMs)  │            │
│  │                     │     │                      │            │
│  │  • releaseStaleTasks│     │  • claimBatch()      │            │
│  │  • releaseStaleIntents│   │    (SKIP LOCKED)     │            │
│  │  • sweepEligibleIntents│  │  • processTask()     │            │
│  │  • cleanupOldTasks  │     │  • handleTaskError() │            │
│  └──────────┬──────────┘     └──────────┬───────────┘            │
│             │                           │                        │
│             │      ┌────────────────────┘                        │
│             │      │                                             │
│             ▼      ▼                                             │
│  ┌─────────────────────────────────────────┐                    │
│  │           MatchingTask (Postgres)        │                    │
│  │                                          │                    │
│  │  status: PENDING | RUNNING | DONE | FAILED                   │
│  │  lockedAt, lockedBy, runId              │                    │
│  │  availableAt, attempts, maxAttempts      │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration recommandée

| Variable | Dev | Prod | Description |
|----------|-----|------|-------------|
| MATCHING_SWEEP_LIMIT | 200 | 200 | Intents à enqueue par sweep |
| MATCHING_TASK_CLAIM_BATCH_SIZE | 50 | 50-150 | Tasks par claim worker |
| MATCHING_CANDIDATE_LIMIT | 200 | 200 | Candidats par intent |
| MATCHING_WORKER_CONCURRENCY | 4 | 4-8 | Workers par VM |
| MATCHING_CRON_LOCK_TTL_MS | 660000 | 660000 | 11 min timeout |
| MATCHING_MAINTENANCE_STEP_TIMEOUT_MS | 15000 | 30000 | Timeout par étape |
| MATCHING_DEBUG | true | false | Logs verbeux |
