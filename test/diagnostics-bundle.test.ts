import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ReadonlyToolClient } from "../src/clients/tool-client";
import { buildApiDocs } from "../src/runtime/api-docs";
import { collectDiagnosticsBundle, formatDiagnosticsText } from "../src/runtime/diagnostics-bundle";
import { startUiServer } from "../src/ui/server";

test("collectDiagnosticsBundle redacts tokens and keeps recent failed request IDs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "control-center-diagnostics-"));
  const packageJsonPath = join(tempDir, "package.json");
  const operationAuditPath = join(tempDir, "operation-audit.log");

  try {
    await writeFile(
      packageJsonPath,
      JSON.stringify(
        {
          name: "diagnostics-fixture",
          version: "9.9.9",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      operationAuditPath,
      [
        JSON.stringify({
          timestamp: "2026-03-30T09:00:00.000Z",
          action: "backup_export",
          source: "api",
          ok: false,
          requestId: "req-backup-fail",
          detail: "backup export failed",
        }),
        JSON.stringify({
          timestamp: "2026-03-30T08:00:00.000Z",
          action: "import_dry_run",
          source: "api",
          ok: true,
          requestId: "req-dry-run-ok",
          detail: "validated payload",
        }),
      ].join("\n"),
      "utf8",
    );

    const diagnostics = await collectDiagnosticsBundle({
      now: "2026-03-30T10:00:00.000Z",
      packageJsonPath,
      operationAuditPath,
      gitCommit: "abc1234",
      connectionSummary: {
        generatedAt: "2026-03-30T10:00:00.000Z",
        status: "info",
        items: [
          {
            key: "gateway",
            status: "info",
            value: "Partial",
            detail: "Runtime data is flowing, but the direct Gateway probe is unavailable on this host",
          },
          {
            key: "config",
            status: "ok",
            value: "Ready",
            detail: "Local-only by default",
          },
          {
            key: "runtime",
            status: "ok",
            value: "3",
            detail: "3 sessions visible across 1 agent",
          },
        ],
      },
      updateSummary: {
        generatedAt: "2026-03-30T10:00:00.000Z",
        status: "info",
        currentVersion: "2026.3.24",
        latestVersion: "2026.3.25",
        channelLabel: "stable (default)",
        updateAvailable: true,
      },
    });

    assert.equal(diagnostics.app.name, "diagnostics-fixture");
    assert.equal(diagnostics.app.version, "9.9.9");
    assert.equal(diagnostics.app.gitCommit, "abc1234");
    assert.equal(diagnostics.tokens.redacted, true);
    assert.equal(diagnostics.recentIssues.length, 1);
    assert.equal(diagnostics.recentIssues[0]?.requestId, "req-backup-fail");
    assert.equal(diagnostics.recentIssues[0]?.severity, "error");
    assert.equal(diagnostics.gateway.items.gateway?.value, "Partial");

    const text = formatDiagnosticsText(diagnostics);
    assert(text.includes("OpenClaw Control Center diagnostics"));
    assert(text.includes("Git commit: abc1234"));
    assert(text.includes("LOCAL_API_TOKEN"));
    assert(text.includes("req-backup-fail"));
    assert(text.includes("Current version: 2026.3.24"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("diagnostics API route and docs are exposed", async () => {
  const docs = buildApiDocs();
  assert(docs.routes.some((route) => route.path === "/api/diagnostics"));

  const server = startUiServer(0, new ReadonlyToolClient());
  try {
    if (!server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
    }
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind ephemeral UI port.");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const jsonResponse = await fetch(`${baseUrl}/api/diagnostics`);
    assert.equal(jsonResponse.status, 200);
    assert.match(jsonResponse.headers.get("content-type") ?? "", /application\/json/i);
    const jsonPayload = await jsonResponse.json() as {
      ok: boolean;
      diagnostics: {
        app: { name: string };
        tokens: { redacted: boolean };
      };
    };
    assert.equal(jsonPayload.ok, true);
    assert.equal(jsonPayload.diagnostics.tokens.redacted, true);
    assert.equal(typeof jsonPayload.diagnostics.app.name, "string");

    const textResponse = await fetch(`${baseUrl}/api/diagnostics?format=text`);
    assert.equal(textResponse.status, 200);
    assert.match(textResponse.headers.get("content-type") ?? "", /text\/plain/i);
    const textBody = await textResponse.text();
    assert(textBody.includes("OpenClaw Control Center diagnostics"));
    assert(textBody.includes("Tokens (presence only, values redacted)"));
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }
});
