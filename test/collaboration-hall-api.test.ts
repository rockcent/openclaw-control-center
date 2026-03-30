import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { ReadonlyToolClient } from "../src/clients/tool-client";
import {
  COLLABORATION_HALL_MESSAGES_PATH,
  COLLABORATION_HALLS_PATH,
  COLLABORATION_TASK_CARDS_PATH,
} from "../src/runtime/collaboration-hall-store";
import { COLLABORATION_HALL_SUMMARIES_PATH } from "../src/runtime/collaboration-hall-summary-store";
import { createHallTaskFromOperatorRequest } from "../src/runtime/collaboration-hall-orchestrator";
import { PROJECTS_PATH } from "../src/runtime/project-store";
import { CHAT_MESSAGES_PATH, CHAT_ROOMS_PATH } from "../src/runtime/chat-store";
import { TASKS_PATH } from "../src/runtime/task-store";
import { buildApiDocs } from "../src/runtime/api-docs";
import { startUiServer } from "../src/ui/server";

test("hall API docs and routes are exposed", async () => {
  const backups = await backupFiles([
    COLLABORATION_HALLS_PATH,
    COLLABORATION_HALL_MESSAGES_PATH,
    COLLABORATION_TASK_CARDS_PATH,
    COLLABORATION_HALL_SUMMARIES_PATH,
    PROJECTS_PATH,
    TASKS_PATH,
    CHAT_ROOMS_PATH,
    CHAT_MESSAGES_PATH,
  ]);

  try {
    const docs = buildApiDocs();
    for (const route of [
      "/api/hall",
      "/api/hall/events",
      "/api/hall/messages",
      "/api/hall/tasks",
      "/api/hall/tasks/:taskId",
      "/api/hall/tasks/:taskId/assign",
      "/api/hall/tasks/:taskId/execution-order",
      "/api/hall/tasks/:taskId/review",
      "/api/hall/tasks/:taskId/handoff",
      "/api/hall/tasks/:taskId/evidence",
    ]) {
      assert(docs.routes.some((item) => item.path === route), `Expected API docs for ${route}`);
    }

    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create one hall API task.",
      },
      { skipDiscussion: true },
    );

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

      const hallResponse = await fetch(`${baseUrl}/api/hall`);
      assert.equal(hallResponse.status, 200);
      const hallPayload = await hallResponse.json() as { taskCards: Array<{ taskId: string }> };
      assert(hallPayload.taskCards.some((item) => item.taskId === created.task?.taskId));

      const taskResponse = await fetch(
        `${baseUrl}/api/hall/tasks/${encodeURIComponent(created.task!.taskId)}?projectId=${encodeURIComponent(created.task!.projectId)}`,
      );
      assert.equal(taskResponse.status, 200);

      const taskByCardResponse = await fetch(
        `${baseUrl}/api/hall/tasks/${encodeURIComponent(created.task!.taskId)}?taskCardId=${encodeURIComponent(created.taskCard!.taskCardId)}`,
      );
      assert.equal(taskByCardResponse.status, 200);

      const evidenceResponse = await fetch(
        `${baseUrl}/api/hall/tasks/${encodeURIComponent(created.task!.taskId)}/evidence?projectId=${encodeURIComponent(created.task!.projectId)}`,
      );
      assert.equal(evidenceResponse.status, 200);

      const evidenceByCardResponse = await fetch(
        `${baseUrl}/api/hall/tasks/${encodeURIComponent(created.task!.taskId)}/evidence?taskCardId=${encodeURIComponent(created.taskCard!.taskCardId)}`,
      );
      assert.equal(evidenceByCardResponse.status, 200);
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }

    const serverSource = await readFile("src/ui/server.ts", "utf8");
    assert(serverSource.includes('path.endsWith("/execution-order")'));
    assert(serverSource.includes('assertCollaborationMutationAuthorized(req, "/api/hall/tasks/:taskId/execution-order")'));
  } finally {
    await restoreFiles(backups);
  }
});

test("hall mutation routes require local token when the gate is enabled", async () => {
  const backups = await backupFiles([
    COLLABORATION_HALLS_PATH,
    COLLABORATION_HALL_MESSAGES_PATH,
    COLLABORATION_TASK_CARDS_PATH,
    COLLABORATION_HALL_SUMMARIES_PATH,
    PROJECTS_PATH,
    TASKS_PATH,
    CHAT_ROOMS_PATH,
    CHAT_MESSAGES_PATH,
  ]);
  const localToken = "test-local-token";

  try {
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create one token-gated hall task.",
      },
      { skipDiscussion: true },
    );

    const server = startUiServer(0, new ReadonlyToolClient(), {
      localTokenAuthRequired: true,
      localApiToken: localToken,
    });
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

      const blockedResponse = await fetch(`${baseUrl}/api/hall/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskCardId: created.taskCard!.taskCardId,
          content: "tokenless hall reply",
        }),
      });
      assert.equal(blockedResponse.status, 401);

      const allowedResponse = await fetch(`${baseUrl}/api/hall/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-token": localToken,
        },
        body: JSON.stringify({
          taskCardId: created.taskCard!.taskCardId,
          content: "tokened hall reply",
        }),
      });
      assert.equal(allowedResponse.status, 201);
      const allowedPayload = await allowedResponse.json() as { ok: boolean; message?: { content?: string } };
      assert.equal(allowedPayload.ok, true);
      assert.equal(allowedPayload.message?.content, "tokened hall reply");
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }
  } finally {
    await restoreFiles(backups);
  }
});

async function backupFiles(paths: string[]): Promise<Map<string, string | undefined>> {
  const backups = new Map<string, string | undefined>();
  for (const path of paths) backups.set(path, await readOptionalFile(path));
  return backups;
}

async function restoreFiles(backups: Map<string, string | undefined>): Promise<void> {
  for (const [path, content] of backups.entries()) {
    if (content === undefined) await rm(path, { force: true });
    else await writeFile(path, content, "utf8");
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
