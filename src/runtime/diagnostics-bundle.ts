import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { arch, cpus, freemem, platform, release, totalmem, uptime } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  GATEWAY_URL,
  LOCAL_API_TOKEN,
  LOCAL_TOKEN_AUTH_REQUIRED,
  OPENCLAW_CONTROL_UI_URL,
  TASK_ROOM_BRIDGE_DISCORD_WEBHOOK_URL,
  TASK_ROOM_BRIDGE_TELEGRAM_BOT_TOKEN,
  TASK_ROOM_BRIDGE_TELEGRAM_CHAT_ID,
} from "../config";
import {
  loadCachedOpenClawConnectionSummary,
  loadCachedOpenClawUpdateSummary,
  type OpenClawConnectionSummary,
  type OpenClawInsightStatus,
  type OpenClawUpdateSummary,
} from "./openclaw-cli-insights";
import { OPERATION_AUDIT_LOG_PATH } from "./operation-audit";

const execFileAsync = promisify(execFile);

export interface DiagnosticsTokenPresence {
  key: string;
  present: boolean;
  note: string;
}

export interface DiagnosticsIssueEntry {
  timestamp: string;
  severity: "warn" | "error";
  action: string;
  source: string;
  detail: string;
  requestId?: string;
}

export interface DiagnosticsConnectionItem {
  status: OpenClawInsightStatus;
  value: string;
  detail: string;
}

export interface DiagnosticsBundle {
  generatedAt: string;
  app: {
    name: string;
    version?: string;
    gitCommit?: string;
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    release: string;
    arch: string;
    uptimeSeconds: number;
    cpuCount: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
  };
  gateway: {
    configuredUrl: string;
    controlUiUrl?: string;
    overallStatus: OpenClawInsightStatus;
    generatedAt: string;
    items: {
      gateway?: DiagnosticsConnectionItem;
      config?: DiagnosticsConnectionItem;
      runtime?: DiagnosticsConnectionItem;
    };
  };
  openclaw: {
    status: OpenClawInsightStatus;
    currentVersion?: string;
    latestVersion?: string;
    channelLabel?: string;
    updateAvailable: boolean;
  };
  tokens: {
    redacted: true;
    localTokenAuthRequired: boolean;
    entries: DiagnosticsTokenPresence[];
  };
  recentIssues: DiagnosticsIssueEntry[];
}

export interface CollectDiagnosticsBundleOptions {
  now?: string;
  cwd?: string;
  packageJsonPath?: string;
  operationAuditPath?: string;
  gitCommit?: string;
  connectionSummary?: OpenClawConnectionSummary;
  updateSummary?: OpenClawUpdateSummary;
}

export async function collectDiagnosticsBundle(
  options: CollectDiagnosticsBundleOptions = {},
): Promise<DiagnosticsBundle> {
  const cwd = options.cwd ?? process.cwd();
  const generatedAt = options.now ?? new Date().toISOString();
  const packageJsonPath = options.packageJsonPath ?? join(cwd, "package.json");
  const operationAuditPath = options.operationAuditPath ?? OPERATION_AUDIT_LOG_PATH;

  const [packageMeta, gitCommit, connectionSummary, updateSummary, recentIssues] = await Promise.all([
    readPackageMeta(packageJsonPath),
    options.gitCommit !== undefined ? Promise.resolve(options.gitCommit) : readGitCommit(cwd),
    options.connectionSummary ? Promise.resolve(options.connectionSummary) : loadCachedOpenClawConnectionSummary(),
    options.updateSummary ? Promise.resolve(options.updateSummary) : loadCachedOpenClawUpdateSummary(),
    readRecentOperationIssues(operationAuditPath, 8),
  ]);

  const gatewayItems = {
    gateway: mapConnectionItem(connectionSummary, "gateway"),
    config: mapConnectionItem(connectionSummary, "config"),
    runtime: mapConnectionItem(connectionSummary, "runtime"),
  };

  return {
    generatedAt,
    app: {
      name: packageMeta.name ?? "openclaw-control-center",
      version: packageMeta.version,
      gitCommit: gitCommit ?? undefined,
    },
    runtime: {
      nodeVersion: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      uptimeSeconds: Math.round(uptime()),
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
    },
    gateway: {
      configuredUrl: GATEWAY_URL,
      controlUiUrl: OPENCLAW_CONTROL_UI_URL,
      overallStatus: connectionSummary.status,
      generatedAt: connectionSummary.generatedAt,
      items: gatewayItems,
    },
    openclaw: {
      status: updateSummary.status,
      currentVersion: updateSummary.currentVersion,
      latestVersion: updateSummary.latestVersion,
      channelLabel: updateSummary.channelLabel,
      updateAvailable: updateSummary.updateAvailable,
    },
    tokens: {
      redacted: true,
      localTokenAuthRequired: LOCAL_TOKEN_AUTH_REQUIRED,
      entries: buildTokenPresenceEntries(),
    },
    recentIssues,
  };
}

export function formatDiagnosticsText(bundle: DiagnosticsBundle): string {
  const lines = [
    "OpenClaw Control Center diagnostics",
    `Generated: ${bundle.generatedAt}`,
    "",
    "App",
    `- Name: ${bundle.app.name}`,
    `- Version: ${bundle.app.version ?? "unknown"}`,
    `- Git commit: ${bundle.app.gitCommit ?? "unavailable"}`,
    "",
    "Runtime",
    `- Node.js: ${bundle.runtime.nodeVersion}`,
    `- OS: ${bundle.runtime.platform} ${bundle.runtime.release} (${bundle.runtime.arch})`,
    `- CPU count: ${String(bundle.runtime.cpuCount)}`,
    `- Uptime: ${String(bundle.runtime.uptimeSeconds)}s`,
    `- Memory: ${formatBytes(bundle.runtime.freeMemoryBytes)} free / ${formatBytes(bundle.runtime.totalMemoryBytes)} total`,
    "",
    "Gateway",
    `- Configured endpoint: ${bundle.gateway.configuredUrl}`,
    `- Control UI: ${bundle.gateway.controlUiUrl ?? "not configured"}`,
    `- Overall status: ${bundle.gateway.overallStatus}`,
    `- Direct probe: ${formatConnectionItem(bundle.gateway.items.gateway)}`,
    `- Config check: ${formatConnectionItem(bundle.gateway.items.config)}`,
    `- Runtime signal: ${formatConnectionItem(bundle.gateway.items.runtime)}`,
    "",
    "OpenClaw",
    `- Current version: ${bundle.openclaw.currentVersion ?? "unknown"}`,
    `- Latest version: ${bundle.openclaw.latestVersion ?? "unknown"}`,
    `- Update status: ${bundle.openclaw.status}`,
    `- Channel: ${bundle.openclaw.channelLabel ?? "unknown"}`,
    `- Update available: ${bundle.openclaw.updateAvailable ? "yes" : "no"}`,
    "",
    "Tokens (presence only, values redacted)",
    `- Local token gate required: ${bundle.tokens.localTokenAuthRequired ? "yes" : "no"}`,
    ...bundle.tokens.entries.map(
      (entry) => `- ${entry.key}: ${entry.present ? "present" : "missing"} (${entry.note})`,
    ),
    "",
    "Recent failed operations",
  ];

  if (bundle.recentIssues.length === 0) {
    lines.push("- No recent failed operation-audit entries.");
  } else {
    lines.push(
      ...bundle.recentIssues.map(
        (issue) =>
          `- ${issue.timestamp} | ${issue.severity} | ${issue.action} (${issue.source}) | ${issue.detail}${
            issue.requestId ? ` | requestId=${issue.requestId}` : ""
          }`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

async function readPackageMeta(
  packageJsonPath: string,
): Promise<{ name?: string; version?: string }> {
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    return {};
  }
}

async function readGitCommit(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      timeout: 1500,
    });
    const value = stdout.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function buildTokenPresenceEntries(): DiagnosticsTokenPresence[] {
  return [
    {
      key: "LOCAL_API_TOKEN",
      present: LOCAL_API_TOKEN.length > 0,
      note: "required for import/export and state-changing routes when the local token gate is enabled",
    },
    {
      key: "TASK_ROOM_BRIDGE_DISCORD_WEBHOOK_URL",
      present: Boolean(TASK_ROOM_BRIDGE_DISCORD_WEBHOOK_URL),
      note: "Discord bridge webhook for outbound task-room notifications",
    },
    {
      key: "TASK_ROOM_BRIDGE_TELEGRAM_BOT_TOKEN",
      present: Boolean(TASK_ROOM_BRIDGE_TELEGRAM_BOT_TOKEN),
      note: "Telegram bridge bot token",
    },
    {
      key: "TASK_ROOM_BRIDGE_TELEGRAM_CHAT_ID",
      present: Boolean(TASK_ROOM_BRIDGE_TELEGRAM_CHAT_ID),
      note: "Telegram bridge chat target",
    },
  ];
}

async function readRecentOperationIssues(
  operationAuditPath: string,
  limit: number,
): Promise<DiagnosticsIssueEntry[]> {
  try {
    const raw = await readFile(operationAuditPath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseOperationIssueLine)
      .filter((item): item is DiagnosticsIssueEntry => Boolean(item))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function parseOperationIssueLine(line: string): DiagnosticsIssueEntry | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.ok === true) return null;
    const timestamp =
      typeof parsed.timestamp === "string" && !Number.isNaN(Date.parse(parsed.timestamp))
        ? new Date(parsed.timestamp).toISOString()
        : new Date().toISOString();
    const action = typeof parsed.action === "string" && parsed.action.trim() ? parsed.action : "operation";
    const source = typeof parsed.source === "string" && parsed.source.trim() ? parsed.source : "unknown";
    const detail = typeof parsed.detail === "string" && parsed.detail.trim() ? parsed.detail : "operation audit failure";
    const requestId = typeof parsed.requestId === "string" && parsed.requestId.trim() ? parsed.requestId : undefined;
    return {
      timestamp,
      severity: classifyIssueSeverity(action, detail),
      action,
      source,
      detail,
      requestId,
    };
  } catch {
    return null;
  }
}

function classifyIssueSeverity(action: string, detail: string): "warn" | "error" {
  if (action === "backup_export" || action === "import_apply") return "error";
  if (/\berror\b|\bfailed\b|\bexception\b/i.test(detail)) return "error";
  return "warn";
}

function mapConnectionItem(
  summary: OpenClawConnectionSummary,
  key: "gateway" | "config" | "runtime",
): DiagnosticsConnectionItem | undefined {
  const item = summary.items.find((entry) => entry.key === key);
  if (!item) return undefined;
  return {
    status: item.status,
    value: item.value,
    detail: item.detail,
  };
}

function formatConnectionItem(item: DiagnosticsConnectionItem | undefined): string {
  if (!item) return "unavailable";
  return `${item.status} | ${item.value} | ${item.detail}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}
