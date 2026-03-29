import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  COLLABORATION_HALL_MESSAGES_PATH,
  COLLABORATION_HALLS_PATH,
  COLLABORATION_TASK_CARDS_PATH,
  appendHallMessage,
  createHallTaskCard,
  ensureDefaultCollaborationHall,
  loadCollaborationHallMessageStore,
  loadCollaborationHallStore,
  loadCollaborationTaskCardStore,
} from "../src/runtime/collaboration-hall-store";

test("collaboration hall store persists the default hall, task cards, and messages", async () => {
  const hallsBefore = await readOptionalFile(COLLABORATION_HALLS_PATH);
  const messagesBefore = await readOptionalFile(COLLABORATION_HALL_MESSAGES_PATH);
  const taskCardsBefore = await readOptionalFile(COLLABORATION_TASK_CARDS_PATH);

  try {
    const hall = await ensureDefaultCollaborationHall([
      {
        participantId: "main",
        agentId: "main",
        displayName: "Main",
        semanticRole: "manager",
        active: true,
        aliases: ["Main", "main"],
      },
      {
        participantId: "pandas",
        agentId: "pandas",
        displayName: "Pandas",
        semanticRole: "coder",
        active: true,
        aliases: ["Pandas", "pandas"],
      },
    ]);
    const taskCard = await createHallTaskCard({
      hallId: hall.hallId,
      projectId: "collaboration-hall",
      taskId: "store-test",
      roomId: "collaboration-hall:store-test",
      title: "Store test",
      description: "Persist one hall task card.",
      createdByParticipantId: "operator",
    });
    await appendHallMessage({
      hallId: hall.hallId,
      taskCardId: taskCard.taskCard.taskCardId,
      projectId: "collaboration-hall",
      taskId: "store-test",
      roomId: "collaboration-hall:store-test",
      authorParticipantId: "operator",
      authorLabel: "Operator",
      kind: "task",
      content: "Build the hall store MVP.",
    });

    const hallStore = await loadCollaborationHallStore();
    const messageStore = await loadCollaborationHallMessageStore();
    const taskCardStore = await loadCollaborationTaskCardStore();

    assert(hallStore.halls.some((item) => item.hallId === hall.hallId));
    assert(taskCardStore.taskCards.some((item) => item.taskId === "store-test" && item.projectId === "collaboration-hall"));
    assert(messageStore.messages.some((item) => item.taskId === "store-test" && item.projectId === "collaboration-hall"));
  } finally {
    await restoreOptionalFile(COLLABORATION_HALLS_PATH, hallsBefore);
    await restoreOptionalFile(COLLABORATION_HALL_MESSAGES_PATH, messagesBefore);
    await restoreOptionalFile(COLLABORATION_TASK_CARDS_PATH, taskCardsBefore);
  }
});

test("collaboration hall store accepts long hall replies without rejecting them as invalid payloads", async () => {
  const hallsBefore = await readOptionalFile(COLLABORATION_HALLS_PATH);
  const messagesBefore = await readOptionalFile(COLLABORATION_HALL_MESSAGES_PATH);
  const taskCardsBefore = await readOptionalFile(COLLABORATION_TASK_CARDS_PATH);

  try {
    const hall = await ensureDefaultCollaborationHall([
      {
        participantId: "coq",
        agentId: "coq",
        displayName: "Coq-每日新闻",
        semanticRole: "planner",
        active: true,
        aliases: ["Coq-每日新闻", "coq"],
      },
    ]);
    const taskCard = await createHallTaskCard({
      hallId: hall.hallId,
      projectId: "collaboration-hall",
      taskId: "long-message-test",
      roomId: "collaboration-hall:long-message-test",
      title: "Long message test",
      description: "Persist a long hall reply.",
      createdByParticipantId: "operator",
    });
    const longReply = [
      "三个版本我都重写了一轮，先把第一版里字太多的问题压下去。",
      "开头 1：任务被接住了，不用再靠你自己在群里来回催。",
      "开头 2：中间协调被系统吃掉了，你只做最后确认。",
      "开头 3：群聊不是停在共识，而是继续往下执行。",
      "补充说明：".repeat(900),
    ].join("\n\n");

    const appended = await appendHallMessage({
      hallId: hall.hallId,
      taskCardId: taskCard.taskCard.taskCardId,
      projectId: "collaboration-hall",
      taskId: "long-message-test",
      roomId: "collaboration-hall:long-message-test",
      authorParticipantId: "coq",
      authorLabel: "Coq-每日新闻",
      kind: "proposal",
      content: longReply,
    });

    assert.equal(appended.message.content, longReply);
    assert(appended.message.content.length > 4_000);

    const messageStore = await loadCollaborationHallMessageStore();
    assert(
      messageStore.messages.some((item) =>
        item.taskId === "long-message-test"
        && item.authorParticipantId === "coq"
        && item.content === longReply,
      ),
    );
  } finally {
    await restoreOptionalFile(COLLABORATION_HALLS_PATH, hallsBefore);
    await restoreOptionalFile(COLLABORATION_HALL_MESSAGES_PATH, messagesBefore);
    await restoreOptionalFile(COLLABORATION_TASK_CARDS_PATH, taskCardsBefore);
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
