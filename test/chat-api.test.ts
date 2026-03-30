import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { ReadonlyToolClient } from "../src/clients/tool-client";
import { buildApiDocs } from "../src/runtime/api-docs";
import { CHAT_MESSAGES_PATH, CHAT_ROOMS_PATH, appendChatMessage, createChatRoom } from "../src/runtime/chat-store";
import { CHAT_SUMMARIES_PATH, upsertChatRoomSummary } from "../src/runtime/chat-summary-store";
import { PROJECTS_PATH, saveProjectStore } from "../src/runtime/project-store";
import { TASK_ROOM_BRIDGE_EVENTS_PATH, publishTaskRoomBridgeEvent } from "../src/runtime/task-room-bridge";
import { TASKS_PATH, saveTaskStore } from "../src/runtime/task-store";
import { startUiServer } from "../src/ui/server";

test("room API docs and GET routes are exposed for the task room MVP", async () => {
  const roomsBefore = await readOptionalFile(CHAT_ROOMS_PATH);
  const messagesBefore = await readOptionalFile(CHAT_MESSAGES_PATH);
  const summariesBefore = await readOptionalFile(CHAT_SUMMARIES_PATH);
  const bridgeBefore = await readOptionalFile(TASK_ROOM_BRIDGE_EVENTS_PATH);
  const projectsBefore = await readOptionalFile(PROJECTS_PATH);
  const tasksBefore = await readOptionalFile(TASKS_PATH);
  const suffix = `${process.pid}-${Date.now()}`;
  const projectId = `api-project-${suffix}`;
  const taskId = `api-task-${suffix}`;

  try {
    const docs = buildApiDocs();
    for (const route of [
      "/api/rooms",
      "/api/rooms/:roomId",
      "/api/rooms/:roomId/events",
      "/api/rooms/:roomId/messages",
      "/api/rooms/:roomId/bridge-events",
      "/api/rooms/:roomId/handoffs",
      "/api/rooms/:roomId/assign",
      "/api/rooms/:roomId/review",
      "/api/rooms/:roomId/stage",
    ]) {
      assert(docs.routes.some((item) => item.path === route), `Expected API docs for ${route}`);
    }

    await saveProjectStore({
      projects: [
        {
          projectId,
          title: "API Project",
          status: "active",
          owner: "operator",
          budget: {},
          updatedAt: "2026-03-19T12:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-19T12:00:00.000Z",
    });
    await saveTaskStore({
      tasks: [
        {
          projectId,
          taskId,
          title: "API Task",
          status: "todo",
          owner: "operator",
          definitionOfDone: [],
          artifacts: [],
          rollback: { strategy: "manual", steps: [] },
          sessionKeys: [],
          budget: {},
          updatedAt: "2026-03-19T12:00:00.000Z",
        },
      ],
      agentBudgets: [],
      updatedAt: "2026-03-19T12:00:00.000Z",
    });
    const room = await createChatRoom({
      projectId,
      taskId,
      title: "API Task Room",
    });
    const message = await appendChatMessage({
      roomId: room.room.roomId,
      authorRole: "human",
      content: "Hello room API",
    });
    await publishTaskRoomBridgeEvent({
      type: "message_posted",
      room: room.room,
      message: message.message,
      requestId: "chat-api-test",
    });
    await upsertChatRoomSummary(room.room, [message.message]);

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

      const roomsResponse = await fetch(`${baseUrl}/api/rooms`);
      assert.equal(roomsResponse.status, 200);
      const roomsPayload = await roomsResponse.json() as { count: number; rooms: Array<{ roomId: string }> };
      assert(roomsPayload.count >= 1);
      assert(roomsPayload.rooms.some((item) => item.roomId === room.room.roomId));

      const messagesResponse = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(room.room.roomId)}/messages`);
      assert.equal(messagesResponse.status, 200);
      const messagesPayload = await messagesResponse.json() as { messages: Array<{ content: string }> };
      assert(messagesPayload.messages.some((item) => item.content.includes("Hello room API")));

      const bridgeResponse = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(room.room.roomId)}/bridge-events`);
      assert.equal(bridgeResponse.status, 200);
      const bridgePayload = await bridgeResponse.json() as { events: unknown[] };
      assert(Array.isArray(bridgePayload.events));
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }
  } finally {
    await restoreOptionalFile(CHAT_ROOMS_PATH, roomsBefore);
    await restoreOptionalFile(CHAT_MESSAGES_PATH, messagesBefore);
    await restoreOptionalFile(CHAT_SUMMARIES_PATH, summariesBefore);
    await restoreOptionalFile(TASK_ROOM_BRIDGE_EVENTS_PATH, bridgeBefore);
    await restoreOptionalFile(PROJECTS_PATH, projectsBefore);
    await restoreOptionalFile(TASKS_PATH, tasksBefore);
  }
});

test("room mutation routes require local token when the gate is enabled", async () => {
  const roomsBefore = await readOptionalFile(CHAT_ROOMS_PATH);
  const messagesBefore = await readOptionalFile(CHAT_MESSAGES_PATH);
  const summariesBefore = await readOptionalFile(CHAT_SUMMARIES_PATH);
  const bridgeBefore = await readOptionalFile(TASK_ROOM_BRIDGE_EVENTS_PATH);
  const projectsBefore = await readOptionalFile(PROJECTS_PATH);
  const tasksBefore = await readOptionalFile(TASKS_PATH);
  const suffix = `${process.pid}-${Date.now()}`;
  const projectId = `api-project-${suffix}`;
  const taskId = `api-task-${suffix}`;
  const localToken = "test-local-token";

  try {
    await saveProjectStore({
      projects: [
        {
          projectId,
          title: "API Project",
          status: "active",
          owner: "operator",
          budget: {},
          updatedAt: "2026-03-19T12:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-19T12:00:00.000Z",
    });
    await saveTaskStore({
      tasks: [
        {
          projectId,
          taskId,
          title: "API Task",
          status: "todo",
          owner: "operator",
          definitionOfDone: [],
          artifacts: [],
          rollback: { strategy: "manual", steps: [] },
          sessionKeys: [],
          budget: {},
          updatedAt: "2026-03-19T12:00:00.000Z",
        },
      ],
      agentBudgets: [],
      updatedAt: "2026-03-19T12:00:00.000Z",
    });
    const room = await createChatRoom({
      projectId,
      taskId,
      title: "API Task Room",
    });

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

      const blockedResponse = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(room.room.roomId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorRole: "human", content: "tokenless room message" }),
      });
      assert.equal(blockedResponse.status, 401);

      const allowedResponse = await fetch(`${baseUrl}/api/rooms/${encodeURIComponent(room.room.roomId)}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-token": localToken,
        },
        body: JSON.stringify({ authorRole: "human", content: "tokened room message" }),
      });
      assert.equal(allowedResponse.status, 201);
      const allowedPayload = await allowedResponse.json() as { ok: boolean; message?: { content?: string } };
      assert.equal(allowedPayload.ok, true);
      assert.equal(allowedPayload.message?.content, "tokened room message");
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }
  } finally {
    await restoreOptionalFile(CHAT_ROOMS_PATH, roomsBefore);
    await restoreOptionalFile(CHAT_MESSAGES_PATH, messagesBefore);
    await restoreOptionalFile(CHAT_SUMMARIES_PATH, summariesBefore);
    await restoreOptionalFile(TASK_ROOM_BRIDGE_EVENTS_PATH, bridgeBefore);
    await restoreOptionalFile(PROJECTS_PATH, projectsBefore);
    await restoreOptionalFile(TASKS_PATH, tasksBefore);
  }
});

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function restoreOptionalFile(path: string, content: string | undefined): Promise<void> {
  if (content === undefined) {
    await rm(path, { force: true });
    return;
  }
  await writeFile(path, content, "utf8");
}
