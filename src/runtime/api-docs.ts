export interface ApiRouteDoc {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  summary: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
  response: Record<string, string>;
}

export interface ApiDocsPayload {
  generatedAt: string;
  version: string;
  safetyDefaults: Record<string, string | boolean | number>;
  routes: ApiRouteDoc[];
}

export function buildApiDocs(): ApiDocsPayload {
  return {
    generatedAt: new Date().toISOString(),
        version: "phase-25",
    safetyDefaults: {
      READONLY_MODE: true,
      APPROVAL_ACTIONS_ENABLED: false,
      APPROVAL_ACTIONS_DRY_RUN: true,
      IMPORT_MUTATION_ENABLED: false,
      IMPORT_MUTATION_DRY_RUN: false,
      LOCAL_TOKEN_AUTH_REQUIRED: true,
      HALL_RUNTIME_DISPATCH_ENABLED: true,
      HALL_RUNTIME_DIRECT_STREAM_ENABLED: true,
      HALL_RUNTIME_THINKING_LEVEL: "minimal",
      HALL_RUNTIME_EXECUTION_CHAIN_ENABLED: true,
      HALL_RUNTIME_EXECUTION_MAX_TURNS: 3,
      TASK_HEARTBEAT_ENABLED: true,
      TASK_HEARTBEAT_DRY_RUN: true,
      TASK_HEARTBEAT_MAX_TASKS_PER_RUN: 3,
      LOCAL_API_TOKEN:
        "Set explicitly to allow import/export and state-changing routes; present token via x-local-token or Authorization Bearer",
      approvalExecutionGuard:
        "Live approve/reject requires READONLY_MODE=false + APPROVAL_ACTIONS_ENABLED=true + APPROVAL_ACTIONS_DRY_RUN=false",
      importMutationExecutionGuard:
        "Live import apply requires LOCAL_API_TOKEN auth + IMPORT_MUTATION_ENABLED=true + READONLY_MODE=false; optional per-request dryRun=true keeps it non-mutating",
      taskHeartbeatExecutionGuard:
        "Live task heartbeat execution requires LOCAL_API_TOKEN when LOCAL_TOKEN_AUTH_REQUIRED=true; default mode is dry-run",
      hallRuntimeDispatchNotes:
        "Hall discussion / assign / handoff use the real openclaw agent runtime when HALL_RUNTIME_DISPATCH_ENABLED=true and a live ToolClient is available; hall prefers direct stdout streaming when available, falls back to session deltas when needed, and can auto-chain bounded execution turns after assign",
    },
    routes: [
      {
        method: "GET",
        path: "/api/docs",
        summary: "API reference summary for Mission Control",
        response: {
          ok: "boolean",
          docs: "ApiDocsPayload",
        },
      },
      {
        method: "GET",
        path: "/api/done-checklist",
        summary: "Final integration checklist + readiness scoring snapshot",
        response: {
          ok: "boolean",
          checklist: "{ basedOn, items[], counts, readiness{overall,categories[]} }",
        },
      },
      {
        method: "GET",
        path: "/api/diagnostics",
        summary: "Operator-friendly diagnostics bundle for startup and connection triage",
        query: {
          format: "optional: text",
        },
        response: {
          ok: "boolean (JSON mode only)",
          diagnostics:
            "{ app, runtime, gateway, openclaw, tokens(redacted presence only), recentIssues[] } (JSON mode)",
          text: "plain-text diagnostics report when format=text",
        },
      },
      {
        method: "GET",
        path: "/api/ui/preferences",
        summary: "Read persisted dashboard UI preferences",
        response: {
          ok: "boolean",
          preferences: "{ compactStatusStrip, quickFilter, taskFilters, updatedAt }",
          path: "string",
          issues: "string[]",
        },
      },
      {
        method: "PATCH",
        path: "/api/ui/preferences",
        summary:
          "Update dashboard UI preferences persisted to runtime/ui-preferences.json (requires local token gate)",
        body: {
          compactStatusStrip: "boolean (optional)",
          quickFilter: "all|attention|todo|in_progress|blocked|done (optional)",
          taskFilters: "{ status?, owner?, project? } (optional)",
        },
        response: {
          ok: "boolean",
          preferences: "{ compactStatusStrip, quickFilter, taskFilters, updatedAt }",
        },
      },
      {
        method: "GET",
        path: "/api/files",
        summary: "List editable files for memory or workspace scope",
        query: {
          scope: "required: memory|workspace",
        },
        response: {
          ok: "boolean",
          scope: "memory|workspace",
          count: "number",
          files: "EditableFileEntry[]",
        },
      },
      {
        method: "GET",
        path: "/api/files/content",
        summary: "Read one editable file from the allowed memory/workspace scope",
        query: {
          scope: "required: memory|workspace",
          path: "required absolute source path from /api/files list",
        },
        response: {
          ok: "boolean",
          scope: "memory|workspace",
          entry: "EditableFileEntry",
          content: "string",
        },
      },
      {
        method: "PUT",
        path: "/api/files/content",
        summary: "Write one editable file back to disk (requires local token gate if enabled)",
        body: {
          scope: "required: memory|workspace",
          path: "required absolute source path from /api/files list",
          content: "full file text",
        },
        response: {
          ok: "boolean",
          scope: "memory|workspace",
          entry: "EditableFileEntry",
          content: "string",
        },
      },
      {
        method: "GET",
        path: "/api/search/tasks",
        summary: "Substring search over tasks",
        query: {
          q: "required search term",
          limit: "optional 1..200 (default 20)",
        },
        response: {
          ok: "boolean",
          scope: "tasks",
          query: "{ q, limit }",
          count: "number (total matches before limit)",
          returned: "number (items returned in this response)",
          items: "TaskListItem[]",
        },
      },
      {
        method: "GET",
        path: "/api/search/projects",
        summary: "Substring search over projects",
        query: {
          q: "required search term",
          limit: "optional 1..200 (default 20)",
        },
        response: {
          ok: "boolean",
          scope: "projects",
          query: "{ q, limit }",
          count: "number (total matches before limit)",
          returned: "number (items returned in this response)",
          items: "ProjectRecord[]",
        },
      },
      {
        method: "GET",
        path: "/api/search/sessions",
        summary: "Substring search over session summaries",
        query: {
          q: "required search term",
          limit: "optional 1..200 (default 20)",
        },
        response: {
          ok: "boolean",
          scope: "sessions",
          query: "{ q, limit }",
          count: "number (total matches before limit, including live-merged sessions)",
          returned: "number (items returned in this response)",
          items: "SessionSummary[]",
        },
      },
      {
        method: "GET",
        path: "/api/search/exceptions",
        summary: "Substring search over routed exception feed items",
        query: {
          q: "required search term",
          limit: "optional 1..200 (default 20)",
        },
        response: {
          ok: "boolean",
          scope: "exceptions",
          query: "{ q, limit }",
          count: "number (total matches before limit)",
          returned: "number (items returned in this response)",
          items: "ExceptionFeedItem[]",
        },
      },
      {
        method: "GET",
        path: "/api/hall",
        summary: "Read the public collaboration hall with participants, task cards, summary, and recent messages",
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          summary: "CollaborationHallSummary",
          participants: "HallParticipant[]",
          count: "number",
          taskCards: "HallTaskCard[] with summary",
          messages: "HallMessage[]",
        },
      },
      {
        method: "GET",
        path: "/api/hall/events",
        summary: "Open an SSE stream for hall invalidations and streamed agent reply drafts, including runtime-backed hall dispatch when enabled",
        query: {
          hallId: "optional hall id (default main)",
        },
        response: {
          ok: "SSE stream",
          events: "connected | invalidate | draft_start | draft_delta | draft_complete | draft_abort",
        },
      },
      {
        method: "GET",
        path: "/api/hall/messages",
        summary: "Read hall messages with optional task filters",
        query: {
          taskCardId: "optional task card id",
          taskId: "optional task id",
          projectId: "optional project id",
          limit: "optional 1..500 (default 120)",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          count: "number",
          messages: "HallMessage[]",
        },
      },
      {
        method: "POST",
        path: "/api/hall/messages",
        summary: "Post a reply into the collaboration hall (requires local token gate)",
        body: {
          hallId: "optional hall id",
          taskCardId: "optional task card id",
          projectId: "optional project id",
          taskId: "optional task id",
          content: "required message text",
          authorParticipantId: "optional participant id (defaults to operator)",
          authorLabel: "optional author label",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          hallSummary: "CollaborationHallSummary",
          taskCard: "HallTaskCard | undefined",
          taskSummary: "HallTaskSummary | undefined",
          message: "HallMessage",
          generatedMessages: "HallMessage[]",
        },
      },
      {
        method: "GET",
        path: "/api/hall/tasks",
        summary: "List collaboration hall task cards",
        query: {
          stage: "optional: discussion|execution|review|blocked|completed",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          count: "number",
          taskCards: "HallTaskCard[] with summary",
        },
      },
      {
        method: "POST",
        path: "/api/hall/tasks",
        summary: "Create a new hall task card from an operator request (requires local token gate)",
        body: {
          hallId: "optional hall id",
          projectId: "optional project id",
          taskId: "optional task id",
          title: "optional task title",
          content: "required task request",
          authorParticipantId: "optional participant id",
          authorLabel: "optional author label",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          hallSummary: "CollaborationHallSummary",
          taskCard: "HallTaskCard",
          taskSummary: "HallTaskSummary",
          task: "ProjectTask",
          roomId: "string | undefined",
          generatedMessages: "HallMessage[]",
        },
      },
      {
        method: "GET",
        path: "/api/hall/tasks/:taskId",
        summary: "Read one hall task card and its scoped timeline",
        query: {
          projectId: "required project id",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          hallSummary: "CollaborationHallSummary",
          taskCard: "HallTaskCard",
          taskSummary: "HallTaskSummary",
          task: "ProjectTask | undefined",
          messages: "HallMessage[]",
        },
      },
      {
        method: "POST",
        path: "/api/hall/tasks/:taskId/assign",
        summary: "Assign one execution owner to a hall task card (requires local token gate)",
        body: {
          projectId: "required project id",
          participantId: "optional participant id",
          note: "optional assignment note",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          hallSummary: "CollaborationHallSummary",
          taskCard: "HallTaskCard",
          taskSummary: "HallTaskSummary",
          task: "ProjectTask",
          generatedMessages: "HallMessage[]",
        },
      },
      {
        method: "POST",
        path: "/api/hall/tasks/:taskId/execution-order",
        summary: "Set the planned execution order for one hall task card (requires local token gate)",
        body: {
          projectId: "optional project id",
          taskCardId: "optional task card id",
          participantIds: "required ordered participant id array",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          hallSummary: "CollaborationHallSummary",
          taskCard: "HallTaskCard",
          taskSummary: "HallTaskSummary",
          task: "ProjectTask | undefined",
          generatedMessages: "HallMessage[]",
        },
      },
      {
        method: "POST",
        path: "/api/hall/tasks/:taskId/review",
        summary: "Approve or reject a hall task card (requires local token gate)",
        body: {
          projectId: "required project id",
          outcome: "required: approved|rejected",
          note: "optional review note",
          blockTask: "optional boolean",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          hallSummary: "CollaborationHallSummary",
          taskCard: "HallTaskCard",
          taskSummary: "HallTaskSummary",
          task: "ProjectTask",
          generatedMessages: "HallMessage[]",
        },
      },
      {
        method: "POST",
        path: "/api/hall/tasks/:taskId/handoff",
        summary: "Record a structured handoff inside the hall (requires local token gate)",
        body: {
          projectId: "required project id",
          fromParticipantId: "optional current owner id",
          toParticipantId: "required next owner id",
          handoff: "{ goal, currentResult, doneWhen, blockers[], nextOwner, requiresInputFrom[] }",
        },
        response: {
          ok: "boolean",
          hall: "CollaborationHall",
          hallSummary: "CollaborationHallSummary",
          taskCard: "HallTaskCard",
          taskSummary: "HallTaskSummary",
          task: "ProjectTask",
          generatedMessages: "HallMessage[]",
        },
      },
      {
        method: "GET",
        path: "/api/hall/tasks/:taskId/evidence",
        summary: "Read the linked detail thread and runtime evidence for one hall task card",
        query: {
          projectId: "required project id",
          historyLimit: "optional 1..200 (default 25)",
        },
        response: {
          ok: "boolean",
          taskCard: "HallTaskCard",
          room: "ChatRoom | null",
          summary: "ChatRoomSummary | null",
          storedMessages: "ChatMessage[]",
          evidenceMessages: "ChatMessage[]",
        },
      },
      {
        method: "GET",
        path: "/api/rooms",
        summary: "List task collaboration rooms with optional project/task/stage filters",
        query: {
          projectId: "optional project id",
          taskId: "optional task id",
          stage: "optional: intake|discussion|assigned|executing|review|completed",
          q: "optional substring search",
        },
        response: {
          ok: "boolean",
          updatedAt: "ISO timestamp",
          count: "number",
          rooms: "ChatRoom[] with summary",
        },
      },
      {
        method: "POST",
        path: "/api/rooms",
        summary: "Create a task collaboration room and bind it to the task (requires local token gate)",
        body: {
          projectId: "required project id",
          taskId: "required task id",
          roomId: "optional room id",
          title: "optional room title",
          stage: "optional room stage",
        },
        response: {
          ok: "boolean",
          path: "runtime/chat-rooms.json",
          room: "ChatRoom",
          task: "ProjectTask",
          summary: "ChatRoomSummary",
        },
      },
      {
        method: "GET",
        path: "/api/rooms/:roomId",
        summary: "Get one room with stored messages and session-derived evidence",
        query: {
          historyLimit: "optional 1..200 (default 25)",
        },
        response: {
          ok: "boolean",
          room: "ChatRoom",
          task: "ProjectTask | undefined",
          summary: "ChatRoomSummary",
          storedMessages: "ChatMessage[]",
          evidenceMessages: "ChatMessage[]",
        },
      },
      {
        method: "GET",
        path: "/api/rooms/:roomId/messages",
        summary: "Get merged stored messages and session-derived evidence for a room",
        query: {
          limit: "optional 1..1000 (default 200)",
          historyLimit: "optional 1..200 (default 25)",
        },
        response: {
          ok: "boolean",
          room: "ChatRoom",
          summary: "ChatRoomSummary",
          count: "number",
          storedCount: "number",
          evidenceCount: "number",
          messages: "ChatMessage[]",
        },
      },
      {
        method: "GET",
        path: "/api/rooms/:roomId/events",
        summary: "Open an SSE stream for room invalidations and streamed agent reply drafts",
        response: {
          ok: "SSE stream",
          events: "connected | invalidate | draft_start | draft_delta | draft_complete | draft_abort",
        },
      },
      {
        method: "GET",
        path: "/api/rooms/:roomId/bridge-events",
        summary: "Get recent outbound bridge events for one room",
        query: {
          limit: "optional 1..200 (default 20)",
        },
        response: {
          ok: "boolean",
          updatedAt: "ISO timestamp",
          count: "number",
          events: "TaskRoomBridgeEvent[]",
        },
      },
      {
        method: "POST",
        path: "/api/rooms/:roomId/messages",
        summary: "Append a room message; human messages trigger the deterministic discussion orchestrator",
        body: {
          authorRole: "optional human|planner|coder|reviewer|manager (default human)",
          authorLabel: "optional display label",
          participantId: "optional participant id",
          kind: "optional chat|proposal|decision|handoff|status|result",
          content: "required message text",
          mentions: "optional RoomParticipantRole[]",
          sessionKey: "optional linked session key",
          payload: "optional structured message payload",
        },
        response: {
          ok: "boolean",
          room: "ChatRoom",
          message: "ChatMessage",
          generatedMessages: "ChatMessage[]",
          summary: "ChatRoomSummary",
        },
      },
      {
        method: "POST",
        path: "/api/rooms/:roomId/handoffs",
        summary: "Record an explicit room handoff between roles (requires local token gate)",
        body: {
          fromRole: "required RoomParticipantRole",
          toRole: "required RoomParticipantRole",
          note: "optional string <= 320",
        },
        response: {
          ok: "boolean",
          room: "ChatRoom",
          generatedMessages: "ChatMessage[]",
          summary: "ChatRoomSummary",
        },
      },
      {
        method: "POST",
        path: "/api/rooms/:roomId/assign",
        summary: "Assign execution to one role, sync the task to in_progress, and optionally start execution",
        body: {
          executorRole: "optional RoomParticipantRole (default room.assignedExecutor or coder)",
          note: "optional string <= 320",
          autoStartExecution: "optional boolean (default true)",
        },
        response: {
          ok: "boolean",
          room: "ChatRoom",
          task: "ProjectTask",
          generatedMessages: "ChatMessage[]",
          summary: "ChatRoomSummary",
        },
      },
      {
        method: "POST",
        path: "/api/rooms/:roomId/review",
        summary: "Approve or reject execution and sync the task status",
        body: {
          outcome: "required approved|rejected",
          note: "optional string <= 320",
          blockTask: "optional boolean; when rejected, prefer blocked over in_progress",
        },
        response: {
          ok: "boolean",
          room: "ChatRoom",
          task: "ProjectTask",
          generatedMessages: "ChatMessage[]",
          summary: "ChatRoomSummary",
        },
      },
      {
        method: "PATCH",
        path: "/api/rooms/:roomId/stage",
        summary: "Manually update the room stage and optional owner role (requires local token gate)",
        body: {
          stage: "required intake|discussion|assigned|executing|review|completed",
          ownerRole: "optional RoomParticipantRole",
        },
        response: {
          ok: "boolean",
          room: "ChatRoom",
          summary: "ChatRoomSummary",
        },
      },
      {
        method: "GET",
        path: "/api/usage-cost",
        summary:
          "Usage/cost observability snapshot with context-window, period totals, burn-rate status, and connector TODOs",
        response: {
          ok: "boolean",
          usage:
            "{ periods(today/7d/30d), contextWindows[], breakdown(byAgent/byProject/byModel/byProvider), budget, connectors }",
        },
      },
      {
        method: "GET",
        path: "/api/replay/index",
        summary: "Debug replay index from timeline, digests, export snapshots, and export bundles",
        query: {
          timelineLimit: "optional 1..400 (default 80)",
          digestLimit: "optional 1..200 (default 30)",
          exportLimit: "optional 1..200 (default 30)",
          from: "optional ISO date-time lower bound",
          to: "optional ISO date-time upper bound",
        },
        response: {
          ok: "boolean",
          replay:
            "{ timeline, digests, exportSnapshots, exportBundles, stats:{timeline,digests,exportSnapshots,exportBundles,total} with per-source latencyMs/latencyBucketsMs(p50,p95)/totalSizeBytes/returnedSizeBytes }",
        },
      },
      {
        method: "GET",
        path: "/api/commander/exceptions",
        summary: "Exceptions-only summary for blocked/error/pending approval/over-budget/tasks due",
        response: {
          ok: "boolean",
          exceptions: "CommanderExceptionsSummary",
        },
      },
      {
        method: "GET",
        path: "/api/action-queue",
        summary: "Action-required queue derived from exception feed with ack state",
        response: {
          ok: "boolean",
          center: "{ generatedAt, queue[], total, acknowledged }",
        },
      },
      {
        method: "POST",
        path: "/api/action-queue/:itemId/ack",
        summary: "Acknowledge action queue item with optional snooze window (requires local token gate)",
        body: {
          note: "optional string <= 300",
          ttlMinutes: "optional integer 1..10080 (ack expires after N minutes)",
          snoozeUntil: "optional ISO date-time (future); mutually exclusive with ttlMinutes",
        },
        response: {
          ok: "boolean",
          path: "runtime/acks.json",
          ack: "{ itemId, ackedAt, note?, expiresAt? }",
        },
      },
      {
        method: "GET",
        path: "/api/action-queue/acks/prune-preview",
        summary:
          "Preview stale acknowledgement prune counts (no write, requires local token gate)",
        response: {
          ok: "boolean",
          preview: "{ path, dryRun:true, before, removed, after, updatedAt }",
        },
      },
      {
        method: "GET",
        path: "/api/tasks/heartbeat",
        summary: "Read recent heartbeat runs for assigned backlog automation",
        query: {
          limit: "optional 1..200 (default 20)",
        },
        response: {
          ok: "boolean",
          path: "runtime/task-heartbeat.log",
          count: "number",
          runs: "TaskHeartbeatResult[] newest-first",
        },
      },
      {
        method: "POST",
        path: "/api/tasks/heartbeat",
        summary:
          "Execute heartbeat task pickup (requires local token gate; defaults to dry-run unless explicitly set live)",
        body: {
          dryRun: "optional boolean",
          maxTasksPerRun: "optional integer 1..200",
        },
        response: {
          ok: "boolean",
          mode: "blocked|dry_run|live",
          message: "string",
          checked: "number",
          eligible: "number",
          selected: "number",
          executed: "number",
          selections: "TaskHeartbeatSelection[]",
        },
      },
      {
        method: "GET",
        path: "/api/export/state.json",
        summary:
          "Export state bundle and persist timestamped debug + backup snapshots (requires local token gate)",
        response: {
          ok: "boolean",
          schemaVersion: "phase-9",
          source: "api|command",
          requestId: "string",
          exportedAt: "ISO timestamp",
          snapshotGeneratedAt: "ISO timestamp",
          projects: "ProjectStoreSnapshot",
          tasks: "TaskStoreSnapshot",
          sessions: "SessionSummary[]",
          budgets: "{ policy, issues, summary }",
          exceptions: "CommanderExceptionsSummary",
          exceptionsFeed: "CommanderExceptionsFeed",
          exportSnapshot: "{ fileName, path, sizeBytes }",
          backupExport: "{ fileName, path, sizeBytes }",
        },
      },
      {
        method: "POST",
        path: "/api/import/dry-run",
        summary:
          "Validate exported bundle shape in dry-run mode (no state mutation, requires local token gate)",
        body: {
          fileName: "optional runtime/exports/*.json name or path",
          bundle: "optional export bundle object; if omitted payload is validated directly",
        },
        response: {
          ok: "boolean",
          validation: "{ valid, issues[], warnings[], summary }",
        },
      },
      {
        method: "POST",
        path: "/api/import/live",
        summary:
          "Optional local import mutation endpoint (HIGH RISK): requires local token + IMPORT_MUTATION_ENABLED=true; blocked in readonly unless dryRun=true",
        body: {
          fileName: "optional runtime/exports/*.json name or path",
          bundle: "optional export bundle object; if omitted payload is treated as the bundle",
          dryRun: "optional boolean; if true validates only and skips mutation",
        },
        response: {
          ok: "boolean",
          mode: "blocked|dry_run|live",
          message: "string",
          guard: "{ readonlyMode, localTokenAuthRequired, localTokenConfigured, mutationEnabled, mutationDryRunDefault, defaultMode, defaultMessage }",
          validation: "{ valid, issues[], warnings[], summary }",
          applied: "{ projectsPath, tasksPath, budgetsPath, projects, tasks, sessions, exceptions }",
        },
      },
      {
        method: "POST",
        path: "/api/approvals/:approvalId/approve",
        summary: "Approval action route (requires local token + existing approval env gates)",
        body: {
          reason: "string <= 220 (optional)",
        },
        response: {
          ok: "boolean",
          mode: "blocked|dry_run|live",
          message: "string",
        },
      },
      {
        method: "POST",
        path: "/api/approvals/:approvalId/reject",
        summary: "Rejection action route (requires local token + existing approval env gates)",
        body: {
          reason: "string <= 220 (required)",
        },
        response: {
          ok: "boolean",
          mode: "blocked|dry_run|live",
          message: "string",
        },
      },
    ],
  };
}
