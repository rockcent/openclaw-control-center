import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import type { ToolClient } from "../src/clients/tool-client";
import { appendChatMessage, CHAT_MESSAGES_PATH, CHAT_ROOMS_PATH } from "../src/runtime/chat-store";
import {
  COLLABORATION_HALL_MESSAGES_PATH,
  COLLABORATION_HALLS_PATH,
  COLLABORATION_TASK_CARDS_PATH,
  appendHallMessage,
  updateHallTaskCard,
} from "../src/runtime/collaboration-hall-store";
import { COLLABORATION_HALL_SUMMARIES_PATH } from "../src/runtime/collaboration-hall-summary-store";
import {
  archiveHallTaskThread,
  assignHallTaskExecution,
  createHallTaskFromOperatorRequest,
  deleteHallTaskThread,
  postHallMessage,
  readCollaborationHall,
  readCollaborationHallTaskDetail,
  recordHallTaskHandoff,
  setHallTaskExecutionOrder,
  stopHallTaskExecution,
  submitHallTaskReview,
  waitForHallBackgroundWork,
} from "../src/runtime/collaboration-hall-orchestrator";
import { readRoomDetail } from "../src/runtime/room-orchestrator";
import { PROJECTS_PATH } from "../src/runtime/project-store";
import { patchTask, TASKS_PATH } from "../src/runtime/task-store";
import type { AgentRunRequest, AgentRunResponse, SessionsHistoryRequest, SessionsHistoryResponse } from "../src/contracts/openclaw-tools";

test("collaboration hall orchestrator creates a task, runs discussion, and reviews it", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Build the public collaboration hall in control-center.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);
    assert(created.task);
    assert.equal(created.taskCard?.stage, "discussion");
    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard!.taskCardId,
      ownerParticipantId: created.taskCard?.currentOwnerParticipantId,
    });
    assert.equal(assigned.taskCard?.stage, "execution");

    const reviewed = await submitHallTaskReview({
      taskCardId: created.taskCard!.taskCardId,
      outcome: "approved",
    });
    assert.equal(reviewed.taskCard?.stage, "completed");
    assert.equal(reviewed.task?.owner, assigned.taskCard?.currentOwnerLabel);

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard!.taskCardId);
    assert(taskMessages.length >= 2);
    assert(taskMessages.some((message) => message.kind === "review"));
    assert(hall.taskCards.some((taskCard) => taskCard.taskCardId === created.taskCard!.taskCardId));
  } finally {
    await restoreFiles(backups);
  }
});

test("review rejection calls the current owner back to the active execution item", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task whose rejected review should point back to the current execution item.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-pandas",
          participantId: "pandas",
          task: "Produce the first storyboard draft and leave it in the hall.",
          handoffToParticipantId: "main",
          handoffWhen: "When the storyboard is reviewable.",
        },
      ],
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "pandas",
    });
    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "pandas");

    const reviewed = await submitHallTaskReview({
      taskCardId: created.taskCard.taskCardId,
      outcome: "changes_requested",
      note: "The visual pacing still needs to be tightened before the next handoff.",
    });

    const reviewMessage = reviewed.generatedMessages.find((message) => message.kind === "review");
    assert(reviewMessage);
    assert.match(reviewMessage.content, /@pandas/i);
    assert.match(reviewMessage.content, /storyboard/i);
    assert.match(reviewMessage.content, /tightened|修改|再改/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("hall execution order can be planned, then advances across assign and handoff", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Plan the execution order for a multi-agent hall task.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    const planned = await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      participantIds: ["pandas", "monkey", "main"],
    });
    assert.deepEqual(planned.taskCard?.plannedExecutionOrder, ["pandas", "monkey", "main"]);
    assert.equal(planned.taskCard?.currentOwnerParticipantId, undefined);
    assert.equal(planned.taskCard?.currentExecutionItem, undefined);

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
    });
    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "pandas");
    assert.deepEqual(assigned.taskCard?.plannedExecutionOrder, ["monkey", "main"]);

    const handedOff = await recordHallTaskHandoff({
      taskCardId: created.taskCard.taskCardId,
      fromParticipantId: "pandas",
      toParticipantId: "monkey",
      handoff: {
        goal: "Continue the second execution slice",
        currentResult: "The first slice is complete.",
        doneWhen: "The second slice is complete.",
        blockers: [],
        nextOwner: "monkey",
        requiresInputFrom: [],
      },
    });
    assert.equal(handedOff.taskCard?.currentOwnerParticipantId, "monkey");
    assert.deepEqual(handedOff.taskCard?.plannedExecutionOrder, ["main"]);
  } finally {
    await restoreFiles(backups);
  }
});

test("hall task detail merges linked room history when hall messages are sparse", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Verify that hall task detail can still show linked room history after a refresh.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard?.roomId);

    await appendChatMessage({
      roomId: created.taskCard.roomId,
      kind: "proposal",
      authorRole: "planner",
      authorLabel: "Coq-每日新闻",
      content: "Room-only proposal that should still appear inside the hall thread detail.",
    });
    await appendChatMessage({
      roomId: created.taskCard.roomId,
      kind: "status",
      authorRole: "coder",
      authorLabel: "pandas",
      content: "Room-only execution update that should still appear inside the hall thread detail.",
    });

    const detail = await readCollaborationHallTaskDetail(created.taskCard.taskCardId);
    const contents = detail.messages.map((message) => message.content);
    assert(contents.some((content) => content.includes("Room-only proposal")));
    assert(contents.some((content) => content.includes("Room-only execution update")));
    assert(detail.messages.length >= 3);
  } finally {
    await restoreFiles(backups);
  }
});

test("hall task detail keeps linked room discussion but filters legacy room handoff system messages", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Keep useful linked room discussion, but do not surface old room handoff templates in hall detail.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard?.roomId);

    await appendChatMessage({
      roomId: created.taskCard.roomId,
      kind: "proposal",
      authorRole: "planner",
      authorLabel: "Coq-每日新闻",
      content: "Room-only proposal that should still appear in the hall timeline.",
    });
    await appendChatMessage({
      roomId: created.taskCard.roomId,
      kind: "handoff",
      authorRole: "manager",
      authorLabel: "Manager",
      content: "Manager handed the room to Reviewer.",
    });

    const detail = await readCollaborationHallTaskDetail(created.taskCard.taskCardId);
    const contents = detail.messages.map((message) => message.content);
    assert(contents.some((content) => content.includes("Room-only proposal")));
    assert(!contents.some((content) => content.includes("handed the room to")));
  } finally {
    await restoreFiles(backups);
  }
});

test("hall task detail filters legacy handoff templates even when they were already persisted as hall messages", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Do not surface old English room handoff templates when they already exist in the hall timeline.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await appendHallMessage({
      hallId: created.taskCard.hallId,
      projectId: created.taskCard.projectId,
      taskId: created.taskCard.taskId,
      taskCardId: created.taskCard.taskCardId,
      roomId: created.taskCard.roomId,
      kind: "handoff",
      authorParticipantId: "main",
      authorLabel: "main",
      authorSemanticRole: "manager",
      content: "Manager handed the room to Reviewer.",
    });

    const detail = await readCollaborationHallTaskDetail(created.taskCard.taskCardId);
    const contents = detail.messages.map((message) => message.content);
    assert(!contents.some((content) => content.includes("Manager handed the room to Reviewer.")));
  } finally {
    await restoreFiles(backups);
  }
});

test("handoff outside the planned execution order keeps the queue and emits a warning message", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Warn when a handoff skips the planned next owner.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      participantIds: ["pandas", "main"],
    });
    await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "pandas",
    });

    const handedOff = await recordHallTaskHandoff({
      taskCardId: created.taskCard.taskCardId,
      fromParticipantId: "pandas",
      toParticipantId: "tiger",
      handoff: {
        goal: "Try a different owner",
        currentResult: "Current slice needs a different owner.",
        doneWhen: "Tiger has finished a follow-up pass.",
        blockers: [],
        nextOwner: "tiger",
        requiresInputFrom: [],
      },
    });
    assert.deepEqual(handedOff.taskCard?.plannedExecutionOrder, ["main"]);
    assert.equal(handedOff.generatedMessages[0]?.kind, "system");
    assert.match(handedOff.generatedMessages[0]?.content ?? "", /planned next owner/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime handoff still auto-dispatches when the current step handoff target and planned queue drift apart", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Keep the runtime chain moving when the current step already points to the real next owner.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-pandas",
          participantId: "pandas",
          task: "Summarize the hall feature and hand the concrete thumbnail task to monkey.",
          handoffToParticipantId: "monkey",
          handoffWhen: "When the summary is clear enough for thumbnail work.",
        },
        {
          itemId: "item-monkey",
          participantId: "monkey",
          task: "Build 3 thumbnail URLs from the summary.",
          handoffToParticipantId: "main",
          handoffWhen: "When the three URLs are ready for review.",
        },
        {
          itemId: "item-main",
          participantId: "main",
          task: "Review the URLs and decide the next step.",
        },
      ],
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "pandas",
    });
    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "pandas");

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      plannedExecutionOrder: ["main"],
      plannedExecutionItems: [
        {
          itemId: "item-monkey",
          participantId: "monkey",
          task: "Build 3 thumbnail URLs from the summary.",
          handoffToParticipantId: "main",
          handoffWhen: "When the three URLs are ready for review.",
        },
        {
          itemId: "item-main",
          participantId: "main",
          task: "Review the URLs and decide the next step.",
        },
      ],
    });

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `3 个 thumbnail URL 已经给到：1. https://example.com/thumb-1 2. https://example.com/thumb-2 3. https://example.com/thumb-3<hall-structured>${JSON.stringify({
        latestSummary: "3 个 thumbnail URL 已经准备好，等 main 继续收口。",
        nextAction: "continue",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:monkey:main",
      sessionId: "monkey-runtime-session",
    });

    const handedOff = await recordHallTaskHandoff({
      taskCardId: created.taskCard.taskCardId,
      fromParticipantId: "pandas",
      toParticipantId: "monkey",
      handoff: {
        goal: "Pass the concrete thumbnail step to monkey.",
        currentResult: "The hall feature summary is ready for concrete thumbnail work.",
        doneWhen: "Three thumbnail URLs are ready for review.",
        blockers: [],
        nextOwner: "monkey",
        requiresInputFrom: [],
      },
    }, {
      toolClient: client,
    });

    assert.equal(handedOff.taskCard?.currentOwnerParticipantId, "monkey");
    assert.equal(handedOff.taskCard?.stage, "execution");
    assert.equal(
      handedOff.generatedMessages.some((message) => /planned next owner/i.test(message.content)),
      false,
    );
    assert(handedOff.generatedMessages.some((message) => message.authorParticipantId === "monkey"));
  } finally {
    await restoreFiles(backups);
  }
});

test("hall greeting without a selected task still gets a lobby reply", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const result = await postHallMessage({
      content: "hello",
    });

    assert.equal(result.generatedMessages.length, 1);
    assert.equal(result.generatedMessages[0]?.authorParticipantId, "coq");
    assert.match(result.generatedMessages[0]?.content ?? "", /在。|收到。|is here|got it/i);

    const hall = await readCollaborationHall();
    assert.equal(hall.taskCards.length, 0);
    assert(hall.messages.length >= 2);
  } finally {
    await restoreFiles(backups);
  }
});

test("hall greeting replies in the same language as the user message", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);

    const english = await postHallMessage({
      content: "hello",
    });
    assert.equal(english.generatedMessages.length, 1);
    assert.match(english.generatedMessages[0]?.content ?? "", /is here|got it/i);
    assert.doesNotMatch(english.generatedMessages[0]?.content ?? "", /在。|收到。/);

    const chinese = await postHallMessage({
      content: "你好",
    });
    assert.equal(chinese.generatedMessages.length, 1);
    assert.match(chinese.generatedMessages[0]?.content ?? "", /在。|收到。/);
  } finally {
    await restoreFiles(backups);
  }
});

test("substantive first hall message auto-creates a task thread instead of staying silent", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const result = await postHallMessage({
      content: "请帮我实现共享群聊大厅，并保证先讨论再指派执行者。",
    });

    assert(result.taskCard);
    assert.equal(result.taskCard?.stage, "discussion");
    await waitForHallMessage(
      (message) =>
        message.taskCardId === result.taskCard!.taskCardId
        && message.authorParticipantId !== "operator"
        && (message.kind === "proposal" || message.kind === "decision"),
    );

    const hall = await readCollaborationHall();
    assert.equal(hall.taskCards.length, 1);
  } finally {
    await restoreFiles(backups);
  }
});

test("non-coding first hall message triggers multi-agent discussion instead of a single greeter reply", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const result = await postHallMessage({
      content: "我想制作数据可视化的动画，想先讨论目标受众、叙事方式和执行顺序。",
    });

    assert(result.taskCard);
    assert.equal(result.taskCard?.stage, "discussion");
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === result.taskCard?.taskCardId);

    const uniqueAuthors = [...new Set(taskMessages.map((message) => message.authorParticipantId))];
    assert(uniqueAuthors.length >= 2);
    assert(uniqueAuthors.includes("coq"));
    assert(!uniqueAuthors.includes("otter"));
    assert(!uniqueAuthors.includes("tiger"));
    const detail = await readCollaborationHallTaskDetail(result.taskCard!.taskCardId);
    assert.match(detail.taskCard.proposal ?? "", /目标|受众|第一版|具体例子|一眼看懂/i);
    assert.doesNotMatch(detail.taskCard.proposal ?? "", /brief|样片|分镜|storyboard|motion sample/i);

    assert.equal(hall.taskCards.length, 1);
    assert(hall.messages.some((message) => message.taskCardId === result.taskCard?.taskCardId));
  } finally {
    await restoreFiles(backups);
  }
});

test("research-style hall message uses the same generic discussion path instead of a domain-specialized group", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const result = await postHallMessage({
      content: "我想先做一轮用户调研，讨论研究问题、证据标准和结论结构。",
    });

    await waitForHallMessage((message) => message.taskCardId === result.taskCard?.taskCardId && message.authorParticipantId === "coq");
    const detail = await readCollaborationHallTaskDetail(result.taskCard!.taskCardId);
    const uniqueAuthors = [...new Set(detail.messages.map((message) => message.authorParticipantId).filter((participantId) => participantId !== "operator"))];
    assert.equal(uniqueAuthors.length, 2);
    assert.ok(uniqueAuthors.includes("coq"));
    assert.ok(uniqueAuthors.includes("monkey"));
    assert.deepEqual(detail.taskCard.plannedExecutionOrder, []);
    assert.equal(detail.taskCard.currentOwnerParticipantId, undefined);
    assert.equal(detail.taskCard.decision, undefined);
    assert.equal(detail.taskCard.plannedExecutionItems.length, 0);
    assert.match(detail.taskCard.proposal ?? "", /目标|第一版|具体例子|一眼看懂/i);
    assert.doesNotMatch(detail.taskCard.proposal ?? "", /brief|样片|分镜|storyboard|motion sample/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("broad video intro ask no longer defaults the first discussion reply into creative-production jargon", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const result = await postHallMessage({
      content: "我想要做一个视频 介绍我的群聊功能",
    });

    await waitForHallBackgroundWork();
    const detail = await readCollaborationHallTaskDetail(result.taskCard!.taskCardId);
    const firstAgentReply = detail.messages.find((message) => message.authorParticipantId !== "operator");

    assert(firstAgentReply);
    assert.doesNotMatch(firstAgentReply.content, /第三拍|停得更久|brief|分镜|storyboard|样片|motion sample/i);
    assert.match(firstAgentReply.content, /一眼看懂|第一版|目标|例子/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("broad opinion request gets a lead plus one complementary responder but not an automatic manager close", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const result = await postHallMessage({
      content: "我想做一个介绍 control-center 群聊功能的视频，你们有什么意见吗？",
    });

    await waitForHallBackgroundWork();
    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === result.taskCard?.taskCardId);
    const uniqueAuthors = [...new Set(taskMessages.map((message) => message.authorParticipantId).filter((participantId) => participantId !== "operator"))];
    assert.equal(uniqueAuthors.length, 2);
    assert.ok(uniqueAuthors.includes("coq"));
    assert.ok(!uniqueAuthors.includes("main"));
    assert.ok(!taskMessages.some((message) => message.kind === "decision"));
  } finally {
    await restoreFiles(backups);
  }
});

test("implicit discussion persists completed speakers so typing placeholders do not linger after replies land", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const result = await postHallMessage({
      content: "我想做一个介绍 control-center 群聊功能的视频，你们有什么意见吗？",
    });

    await waitForHallBackgroundWork();
    const detail = await readCollaborationHallTaskDetail(result.taskCard!.taskCardId);
    const completedParticipantIds = detail.taskCard.discussionCycle?.completedParticipantIds ?? [];

    assert.ok(completedParticipantIds.length >= 2);
    assert.ok(completedParticipantIds.includes("coq"));
    assert.ok(completedParticipantIds.includes("monkey"));
  } finally {
    await restoreFiles(backups);
  }
});

test("explicit follow-up asking for a decision brings in manager directly after the initial discussion context exists", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想做一个介绍 control-center 群聊功能的视频，你们有什么意见吗？",
      },
      { skipDiscussion: true },
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@coq 先从 framing 和受众角度给我一个第一反应。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "coq",
    );

    const beforeDecision = await readCollaborationHall();
    const beforeCount = beforeDecision.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId).length;

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@main 你来收一下，给个结论和第一执行者。",
    });
    await waitForHallBackgroundWork();
    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const decisionMessage = [...taskMessages].reverse().find((message) =>
      message.authorParticipantId === "main" && message.kind === "decision",
    );
    assert(decisionMessage);
    const newAuthorsAfterPrompt = [...new Set(taskMessages.slice(beforeCount).map((message) => message.authorParticipantId).filter((participantId) => participantId !== "operator"))];
    assert.deepEqual(newAuthorsAfterPrompt, ["main"]);
    assert.match(decisionMessage.content, /明确目标|最小可评审结果|第一棒|first pass|prove direction/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("explicit follow-up asking for a first draft deliverable brings in manager to continue the thread", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想做一个介绍 control-center 群聊功能的视频，你们有什么意见吗？",
      },
      { skipDiscussion: true },
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@coq 先从 framing 和受众角度给我一个第一反应。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "coq",
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@pandas 再从执行和视频节奏角度补一个具体建议。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "pandas",
    );

    const beforeDraftRequest = await readCollaborationHall();
    const beforeCount = beforeDraftRequest.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId).length;

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "行，先出一个脚本吧。",
    });
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const followupReplies = taskMessages.slice(beforeCount).filter((message) => message.authorParticipantId !== "operator" && message.kind !== "system");
    const newAuthorsAfterPrompt = [...new Set(followupReplies.map((message) => message.authorParticipantId))];
    assert(newAuthorsAfterPrompt.length >= 2);
    assert.match(followupReplies.map((message) => message.content).join("\n"), /脚本|beat sheet|第一版|first draft|first pass/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("explicit targeted deliverable follow-up replies from the named agent instead of falling back to manager close", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想要做一个视频来介绍 hall-chat 功能，你们先讨论一下怎么展开。",
      },
      { skipDiscussion: true },
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@coq 先从 framing 和受众角度给我一个第一反应。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "coq",
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@main 你来收一下，给个结论和第一执行者。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "main"
      && message.kind === "decision",
    );

    const beforeFollowup = await readCollaborationHall();
    const beforeCount = beforeFollowup.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId).length;

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@otter 给我完整的三个视频开头，而不是给我三句话。",
    });
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const newMessages = taskMessages.slice(beforeCount).filter((message) => message.authorParticipantId !== "operator" && message.kind !== "system");
    const followupAuthors = [...new Set(newMessages.map((message) => message.authorParticipantId))];

    assert.deepEqual(followupAuthors, ["otter"]);
    assert.ok(!newMessages.some((message) => message.authorParticipantId === "main" && message.kind === "decision"));
  } finally {
    await restoreFiles(backups);
  }
});

test("follow-up that explicitly keeps the thread in discussion does not jump straight back to manager close", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想要做视频来介绍我们的群聊功能，做一个视频，不知道怎么写脚本，你们讨论一下怎么展开吧，要够 hook。",
      },
      { skipDiscussion: true },
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@coq 先从 framing 和受众角度给我一个第一反应。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "coq",
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@main 你来收一下，先给一个当前结论。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "main"
      && message.kind === "decision",
    );

    const beforeFollowup = await readCollaborationHall();
    const beforeCount = beforeFollowup.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId).length;

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "我们先只讨论开头的 hook，不急着收口。",
    });
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const newMessages = taskMessages.slice(beforeCount).filter((message) => message.authorParticipantId !== "operator");
    const followupAuthors = [...new Set(newMessages.map((message) => message.authorParticipantId))];
    assert.ok(followupAuthors.length >= 2);
    assert.ok(followupAuthors.includes("coq") || followupAuthors.includes("pandas"));
    assert.ok(!newMessages.some((message) => message.authorParticipantId === "main" && message.kind === "decision"));
  } finally {
    await restoreFiles(backups);
  }
});

test("follow-up after an existing decision keeps using the operator follow-up as the discussion trigger", async () => {
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
    await resetFiles([
      COLLABORATION_HALLS_PATH,
      COLLABORATION_HALL_MESSAGES_PATH,
      COLLABORATION_TASK_CARDS_PATH,
      COLLABORATION_HALL_SUMMARIES_PATH,
      PROJECTS_PATH,
      TASKS_PATH,
      CHAT_ROOMS_PATH,
      CHAT_MESSAGES_PATH,
    ]);
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想要做视频来介绍我们的群聊功能，做一个视频，不知道怎么写脚本，你们讨论一下怎么展开吧，要够 hook。",
      },
      { skipDiscussion: true },
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@coq 先从 framing 和受众角度给我一个第一反应。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "coq",
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@main 你来收一下，先给一个当前结论。",
    });
    await waitForHallMessage((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId === "main"
      && message.kind === "decision",
    );

    const beforeFollowup = await readCollaborationHall();
    const beforeCount = beforeFollowup.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId).length;

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "我们先讨论开头吧。",
    });
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const newMessages = taskMessages.slice(beforeCount).filter((message) => message.authorParticipantId !== "operator");
    const followupAuthors = [...new Set(newMessages.map((message) => message.authorParticipantId))];
    assert.ok(followupAuthors.length >= 2);
    assert.ok(followupAuthors.includes("coq") || followupAuthors.includes("pandas"));
    assert.ok(newMessages.every((message) => message.kind !== "decision"));
    assert.ok(!newMessages.some((message) => message.authorParticipantId === "main" && message.kind === "decision"));
  } finally {
    await restoreFiles(backups);
  }
});

test("readCollaborationHall derives live summary instead of serving stale persisted hall summary", async () => {
  const backups = await backupFiles([
    COLLABORATION_HALLS_PATH,
    COLLABORATION_HALL_MESSAGES_PATH,
    COLLABORATION_TASK_CARDS_PATH,
    COLLABORATION_HALL_SUMMARIES_PATH,
  ]);

  try {
    await writeFile(COLLABORATION_HALLS_PATH, JSON.stringify({
      halls: [
        {
          hallId: "main",
          title: "Collaboration Hall",
          description: "Acceptance hall",
          participants: [],
          taskCardIds: [],
          messageIds: [],
          lastMessageId: null,
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      ],
      executionLocks: [],
      updatedAt: "2026-03-20T00:00:00.000Z",
    }, null, 2), "utf8");
    await writeFile(COLLABORATION_HALL_MESSAGES_PATH, JSON.stringify({
      messages: [],
      updatedAt: "2026-03-20T00:00:00.000Z",
    }, null, 2), "utf8");
    await writeFile(COLLABORATION_TASK_CARDS_PATH, JSON.stringify({
      taskCards: [],
      updatedAt: "2026-03-20T00:00:00.000Z",
    }, null, 2), "utf8");
    await writeFile(COLLABORATION_HALL_SUMMARIES_PATH, JSON.stringify({
      hallSummaries: [
        {
          hallId: "main",
          headline: "Old smoke summary that should not leak back into the hall.",
          activeTaskCount: 4,
          waitingReviewCount: 1,
          blockedTaskCount: 0,
          currentSpeakerLabel: "main",
          updatedAt: "2026-03-19T22:15:05.443Z",
        },
      ],
      taskSummaries: [],
      updatedAt: "2026-03-19T22:15:05.443Z",
    }, null, 2), "utf8");

    const hall = await readCollaborationHall();
    assert.equal(hall.hallSummary.activeTaskCount, 0);
    assert.equal(hall.hallSummary.waitingReviewCount, 0);
    assert.equal(hall.hallSummary.blockedTaskCount, 0);
    assert.equal(hall.hallSummary.headline, "The hall is ready for the next request.");
  } finally {
    await restoreFiles(backups);
  }
});

test("archived hall threads disappear from the active hall list without deleting their task records", async () => {
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
    const created = await createHallTaskFromOperatorRequest({
      content: "Archive this hall thread after it exists.",
    }, {
      skipDiscussion: true,
    });
    assert(created.taskCard);

    await archiveHallTaskThread({
      taskCardId: created.taskCard.taskCardId,
    });

    const hall = await readCollaborationHall();
    assert(!hall.taskCards.some((taskCard) => taskCard.taskCardId === created.taskCard?.taskCardId));

    const detail = await readCollaborationHallTaskDetail(created.taskCard.taskCardId);
    assert(detail.taskCard.archivedAt);
  } finally {
    await restoreFiles(backups);
  }
});

test("deleted hall threads remove the task card and hall messages from the active workspace", async () => {
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
    const created = await createHallTaskFromOperatorRequest({
      content: "Delete this hall thread after it exists.",
    }, {
      skipDiscussion: true,
    });
    assert(created.taskCard);

    await deleteHallTaskThread({
      taskCardId: created.taskCard.taskCardId,
    });

    const hall = await readCollaborationHall();
    assert(!hall.taskCards.some((taskCard) => taskCard.taskCardId === created.taskCard?.taskCardId));
    assert(!hall.messages.some((message) => message.taskCardId === created.taskCard?.taskCardId));
  } finally {
    await restoreFiles(backups);
  }
});

test("execution-stage hall messages default to the current owner when no explicit @mention is used", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Validate owner-first execution replies in the collaboration hall.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);
    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard!.taskCardId,
      ownerParticipantId: "pandas",
    }, {
      toolClient: client,
    });
    assert.equal(assigned.taskCard?.stage, "execution");
    assert(assigned.taskCard?.currentOwnerParticipantId);

    client.queueResponse({
      ok: true,
      status: "ok",
      text: "I am continuing the current execution item.<hall-structured>{\"latestSummary\":\"Owner posted the next execution update.\",\"nextAction\":\"continue\"}</hall-structured>",
      rawText: "ok",
      sessionKey: "agent:pandas:main",
      sessionId: "pandas-session",
    });
    const before = await readCollaborationHall();
    const replied = await postHallMessage({
      taskCardId: created.taskCard!.taskCardId,
      content: "Please post the next execution update in the hall without using an explicit mention.",
    }, {
      toolClient: client,
    });

    assert.equal(replied.generatedMessages.length, 0);

    const ownerReply = await waitForHallMessage(
      (message) =>
        message.taskCardId === created.taskCard!.taskCardId
        && message.authorParticipantId === assigned.taskCard?.currentOwnerParticipantId
        && message.kind === "status",
      before.messages.length,
    );
    assert.equal(ownerReply.authorParticipantId, assigned.taskCard?.currentOwnerParticipantId);
    assert.equal(ownerReply.kind, "status");
  } finally {
    await restoreFiles(backups);
  }
});

test("blocked task follow-up from the operator resumes execution with the current owner", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task that will be blocked and then resumed from the same timeline.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      participantIds: ["main", "pandas"],
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "main",
    });
    assert.equal(assigned.taskCard?.stage, "execution");

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      stage: "blocked",
      status: "blocked",
      currentOwnerParticipantId: "main",
      currentOwnerLabel: "main",
      currentExecutionItem: {
        itemId: "item-main",
        participantId: "main",
        task: "Continue the currently blocked execution step with the new context.",
        handoffToParticipantId: "pandas",
        handoffWhen: "When the resumed pass is reviewable.",
      },
      plannedExecutionOrder: ["pandas"],
    });
    await patchTask({
      taskId: created.taskCard.taskId,
      projectId: created.taskCard.projectId,
      status: "blocked",
      owner: "main",
      roomId: created.taskCard.roomId,
    });

    const resumed = await postHallMessage({
      taskCardId: created.taskCard.taskCardId,
      content: "补充信息已经齐了，请继续往下执行。",
    });

    assert.equal(resumed.taskCard?.stage, "execution");
    assert.equal(resumed.taskCard?.currentOwnerParticipantId, "main");
    assert.equal(resumed.taskCard?.currentExecutionItem?.task, "Continue the currently blocked execution step with the new context.");
    assert.deepEqual(resumed.taskCard?.plannedExecutionOrder, ["pandas"]);
    assert(resumed.generatedMessages.some((message) => message.authorParticipantId === "main"));
  } finally {
    await restoreFiles(backups);
  }
});

test("blocked task follow-up with an explicit @mention to the current owner still resumes execution", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task that will be blocked and resumed with an explicit @mention.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      participantIds: ["pandas", "coq"],
    });

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      stage: "blocked",
      status: "blocked",
      currentOwnerParticipantId: "pandas",
      currentOwnerLabel: "pandas",
      currentExecutionItem: {
        itemId: "item-pandas",
        participantId: "pandas",
        task: "Scan the codebase and summarize the hall chat feature set.",
        handoffToParticipantId: "coq",
        handoffWhen: "When the feature summary is ready for copywriting.",
      },
      plannedExecutionOrder: ["coq"],
    });
    await patchTask({
      taskId: created.taskCard.taskId,
      projectId: created.taskCard.projectId,
      status: "blocked",
      owner: "pandas",
      roomId: created.taskCard.roomId,
    });

    const resumed = await postHallMessage({
      taskCardId: created.taskCard.taskCardId,
      content: "@pandas repo 就是 control-center 这个仓库，继续做这一步。",
    });

    assert.equal(resumed.taskCard?.stage, "execution");
    assert.equal(resumed.taskCard?.currentOwnerParticipantId, "pandas");
    assert.equal(resumed.taskCard?.currentExecutionItem?.task, "Scan the codebase and summarize the hall chat feature set.");
    assert(resumed.generatedMessages.some((message) => message.authorParticipantId === "pandas"));
    assert.ok(!resumed.generatedMessages.some((message) => message.kind === "proposal"));
  } finally {
    await restoreFiles(backups);
  }
});

test("explicit @mention during review reopens discussion instead of returning a generic execution status", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task that should reopen discussion from review when the operator asks @main a follow-up question.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      stage: "review",
      status: "in_progress",
      currentOwnerParticipantId: "monkey",
      currentOwnerLabel: "monkey",
      currentExecutionItem: {
        itemId: "item-monkey",
        participantId: "monkey",
        task: "Turn the hook shortlist into thumbnail directions.",
      },
      plannedExecutionOrder: [],
      plannedExecutionItems: [],
      decision: "Review the first pass and decide the next iteration.",
    });

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `Main is answering the operator's follow-up question from discussion.<hall-structured>${JSON.stringify({
        latestSummary: "main answered the operator's follow-up and reopened the thread for more discussion.",
        nextAction: "continue",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:main:main",
      sessionId: "main-session",
    });

    const before = await readCollaborationHall();
    const replied = await postHallMessage({
      taskCardId: created.taskCard.taskCardId,
      content: "@main 你觉得他们怎么样？",
    }, {
      toolClient: client,
    });

    assert.equal(replied.generatedMessages.length, 0);
    await waitForHallBackgroundWork();

    const mainReply = await waitForHallMessage(
      (message) =>
        message.taskCardId === created.taskCard!.taskCardId
        && message.authorParticipantId === "main"
        && message.kind !== "status",
      before.messages.length,
    );
    assert.match(mainReply.content, /follow-up question|follow-up/i);

    const hall = await readCollaborationHall();
    const updatedTaskCard = hall.taskCards.find((taskCard) => taskCard.taskCardId === created.taskCard?.taskCardId);
    assert.equal(updatedTaskCard?.stage, "discussion");
    assert.equal(updatedTaskCard?.currentOwnerParticipantId, undefined);
  } finally {
    await restoreFiles(backups);
  }
});

test("plain operator follow-up after review reopens a fresh discussion cycle and gets replies", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想要做一个视频 介绍我的群聊功能",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      stage: "review",
      status: "in_progress",
      currentOwnerParticipantId: "otter",
      currentOwnerLabel: "otter",
      currentExecutionItem: {
        itemId: "item-otter",
        participantId: "otter",
        task: "检查上一位的结果，指出必须改的点；如果没有硬阻塞，就直接把可继续版本交给下一位。",
      },
      plannedExecutionOrder: ["otter"],
      plannedExecutionItems: [
        {
          itemId: "item-otter",
          participantId: "otter",
          task: "检查上一位的结果，指出必须改的点；如果没有硬阻塞，就直接把可继续版本交给下一位。",
        },
      ],
      discussionCycle: {
        cycleId: "old-cycle",
        openedAt: new Date(Date.now() - 60_000).toISOString(),
        openedByParticipantId: "operator",
        expectedParticipantIds: ["coq", "monkey"],
        completedParticipantIds: ["coq", "monkey"],
      },
      latestSummary: "这轮已经可评审。",
    });

    const before = await readCollaborationHall();
    const replied = await postHallMessage({
      taskCardId: created.taskCard.taskCardId,
      content: "继续讨论吧 怎么展开呢",
    });

    assert.equal(replied.generatedMessages.length, 0);
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const updatedTaskCard = hall.taskCards.find((taskCard) => taskCard.taskCardId === created.taskCard?.taskCardId);
    assert.equal(updatedTaskCard?.stage, "discussion");
    assert(updatedTaskCard?.discussionCycle);
    assert.notEqual(updatedTaskCard?.discussionCycle?.cycleId, "old-cycle");
    assert.equal(updatedTaskCard?.discussionCycle?.openedByParticipantId, "operator");
    assert.ok((updatedTaskCard?.discussionCycle?.openedAt ?? "") >= replied.message.createdAt);

    const newReplies = hall.messages.slice(before.messages.length).filter((message) =>
      message.taskCardId === created.taskCard?.taskCardId
      && message.authorParticipantId !== "operator");
    const replyAuthors = [...new Set(newReplies.map((message) => message.authorParticipantId))];
    assert.ok(replyAuthors.length >= 1);
    assert.ok(replyAuthors.includes("coq") || replyAuthors.includes("monkey"));
  } finally {
    await restoreFiles(backups);
  }
});

test("stopping execution clears the current execution item and returns the task to discussion", async () => {
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
    const created = await createHallTaskFromOperatorRequest({
      content: "Create a hall task whose current step should clear when execution is stopped.",
    });
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-main",
          participantId: "main",
          task: "Ship the current focused execution step.",
          handoffToParticipantId: "pandas",
          handoffWhen: "When the pass is ready for review.",
        },
      ],
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "main",
    });
    assert.equal(assigned.taskCard?.currentExecutionItem?.task, "Ship the current focused execution step.");

    const stopped = await stopHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      note: "Let's reopen discussion before we keep going.",
    });

    assert.equal(stopped.taskCard?.stage, "discussion");
    assert.equal(stopped.taskCard?.status, "todo");
    assert.equal(stopped.taskCard?.currentOwnerParticipantId, undefined);
    assert.equal(stopped.taskCard?.currentExecutionItem, undefined);
  } finally {
    await restoreFiles(backups);
  }
});

test("adjusting execution order during execution can update the current step without changing the current owner", async () => {
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
    const created = await createHallTaskFromOperatorRequest({
      content: "Create a hall task whose current execution step should stay editable while execution is active.",
    });
    assert(created.taskCard);

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      stage: "execution",
      status: "in_progress",
      currentOwnerParticipantId: "pandas",
      currentOwnerLabel: "pandas",
      currentExecutionItem: {
        itemId: "item-pandas",
        participantId: "pandas",
        task: "Scan the repo and summarize the hall feature set.",
        handoffToParticipantId: "coq",
        handoffWhen: "When the summary is ready for copywriting.",
      },
      plannedExecutionOrder: ["coq", "monkey"],
      plannedExecutionItems: [
        {
          itemId: "item-coq",
          participantId: "coq",
          task: "Turn the summary into three hooks.",
          handoffToParticipantId: "monkey",
          handoffWhen: "When the hooks are ready for thumbnail work.",
        },
        {
          itemId: "item-monkey",
          participantId: "monkey",
          task: "Turn the hooks into thumbnail ideas.",
        },
      ],
    });

    const updated = await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-pandas",
          participantId: "pandas",
          task: "Scan the repo, summarize the hall feature set, and pull out the strongest three proof points.",
          handoffToParticipantId: "coq",
          handoffWhen: "When the proof-point summary is ready for hook writing.",
        },
        {
          itemId: "item-coq",
          participantId: "coq",
          task: "Turn the proof-point summary into three hooks.",
          handoffToParticipantId: "monkey",
          handoffWhen: "When the hooks are ready for thumbnail work.",
        },
        {
          itemId: "item-monkey",
          participantId: "monkey",
          task: "Turn the hooks into thumbnail ideas.",
        },
      ],
    });

    assert.equal(updated.taskCard?.stage, "execution");
    assert.equal(updated.taskCard?.currentOwnerParticipantId, "pandas");
    assert.equal(updated.taskCard?.currentExecutionItem?.task, "Scan the repo, summarize the hall feature set, and pull out the strongest three proof points.");
    assert.deepEqual(updated.taskCard?.plannedExecutionOrder, ["coq", "monkey"]);
    assert.equal(updated.taskCard?.plannedExecutionItems?.[0]?.task, "Turn the proof-point summary into three hooks.");
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime-backed hall orchestration stores real session linkage", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest({
      content: "Wire the hall to the real runtime session chain.",
    }, {
      toolClient: client,
    });
    assert(created.taskCard);
    await waitForHallBackgroundWork();
    assert((client.agentRunStreamCalls.length + client.agentRunCalls.length) >= 1);
    await waitForHallMessage((message) => message.taskCardId === created.taskCard!.taskCardId && (message.payload?.sessionKey ?? "").startsWith("agent:"));

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
    }, {
      toolClient: client,
    });
    await waitForHallMessage((message) => message.taskCardId === created.taskCard!.taskCardId && (message.payload?.sessionKey ?? "").startsWith("agent:"), 0, 3_000);

    const hall = await readCollaborationHall();
    const storedTaskCard = hall.taskCards.find((card) => card.taskCardId === created.taskCard?.taskCardId);
    assert(storedTaskCard);
    assert(storedTaskCard.sessionKeys.some((sessionKey) => sessionKey.startsWith("agent:")));

    const detail = await readRoomDetail(created.roomId!);
    assert(detail.room.sessionKeys.some((sessionKey) => sessionKey.startsWith("agent:")));
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime execution stays inside the current action item and automatically hands off to the next owner", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task that should execute as pandas -> coq without skipping ahead.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-pandas",
          participantId: "pandas",
          task: "Scan the codebase and summarize what the new hall chat feature already does.",
          handoffToParticipantId: "coq",
          handoffWhen: "When the feature summary is in the hall and ready for copywriting.",
        },
        {
          itemId: "item-coq",
          participantId: "coq",
          task: "Turn the code summary into exactly three strong hook options for the video.",
          handoffToParticipantId: "monkey",
          handoffWhen: "When the three hook options are ready for script expansion.",
        },
        {
          itemId: "item-monkey",
          participantId: "monkey",
          task: "Expand the chosen hook into exactly three thumbnail directions.",
        },
      ],
    });

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `我先扫了 4 个关键文件：src/ui/collaboration-hall.ts、src/ui/collaboration-hall-theme.ts、src/runtime/collaboration-hall-orchestrator.ts、src/runtime/hall-runtime-dispatch.ts。结论先锁 3 个：1. 同线程推进；2. owner 明确；3. next action 可见。<hall-structured>${JSON.stringify({
        latestSummary: "Scanned the codebase and summarized the new hall chat feature set.",
        nextAction: "handoff",
        nextStep: "Let Coq turn the summary into exactly three hook options.",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:pandas:main",
      sessionId: "pandas-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: `3 个 hook：1. 不是多了个群聊，是任务自己开始往前走。2. 你不用再来回协调，群聊会自己收敛出 owner 和下一步。3. 聊天会结束，任务会继续往前走。<hall-structured>${JSON.stringify({
        latestSummary: "Drafted three hook options from the code summary.",
        nextAction: "handoff",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:coq:main",
      sessionId: "coq-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: `3 个 thumbnail 方向：1. owner 和 next action 作为前景结果卡；2. 消息流做背景，先看到任务被接住；3. 最后一拍明确交给下一位。<hall-structured>${JSON.stringify({
        latestSummary: "Expanded the chosen hook into thumbnail directions.",
        nextAction: "review",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:monkey:main",
      sessionId: "monkey-session",
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "pandas",
    }, {
      toolClient: client,
    });

    assert.equal(assigned.taskCard?.stage, "review");
    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "monkey");
    assert.equal(assigned.generatedMessages[0]?.authorParticipantId, "pandas");
    assert.equal(assigned.generatedMessages[1]?.authorParticipantId, "coq");
    assert.equal(assigned.generatedMessages[2]?.authorParticipantId, "monkey");
    assert.equal(assigned.generatedMessages[3]?.authorParticipantId, "system");
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /Your current execution item: Scan the codebase and summarize/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /The next owner's step after you is: Turn the code summary into exactly three strong hook options/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /Do not complete deliverables that belong to later owners/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /Repository root for this running control-center instance:/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /src\/runtime\/collaboration-hall-orchestrator\.ts/);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /Treat this as a normal workspace agent turn/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /Literal repository excerpts for grounding:/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /--- src\/ui\/collaboration-hall\.ts ---/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /Hall roster for this round:/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /pandas \(you\) — role: .*persona: .*this round: current owner on "Scan the codebase and summarize what the new hall chat feature already does\."/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /Coq-每日新闻 — role: .*persona: .*this round: "Turn the code summary into exactly three strong hook options for the video\.", then hand to monkey/i);
    assert.match(client.agentRunStreamCalls[0]?.message ?? "", /monkey — role: .*persona: .*this round: "Expand the chosen hook into exactly three thumbnail directions\."/i);
    assert.equal(client.agentRunStreamCalls[0]?.context?.surface, "control-center/hall");
    assert.equal(client.agentRunStreamCalls[0]?.context?.workspaceRoot, process.cwd());
    assert.equal(client.agentRunStreamCalls[0]?.context?.workdir, process.cwd());
    assert.deepEqual(
      client.agentRunStreamCalls[0]?.context?.entryFiles?.slice(0, 3),
      ["src/ui/collaboration-hall.ts", "src/ui/collaboration-hall-theme.ts", "src/ui/server.ts"],
    );
    assert.match(client.agentRunStreamCalls[1]?.message ?? "", /Handoff goal: Turn the code summary into exactly three strong hook options/i);
    assert.match(client.agentRunStreamCalls[1]?.message ?? "", /Hall roster for this round:/i);
    assert.match(client.agentRunStreamCalls[1]?.message ?? "", /Coq-每日新闻 \(you\).*persona:/i);
    assert.match(client.agentRunStreamCalls[1]?.message ?? "", /monkey — role: .*persona:/i);
    assert.match(client.agentRunStreamCalls[2]?.message ?? "", /Handoff goal: Expand the chosen hook into exactly three thumbnail directions/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime handoff continues to the third owner even when the middle reply omits nextAction", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task that should execute as main -> otter -> pandas without stopping at the middle step.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-main",
          participantId: "main",
          task: "Write the first crisp version of the teaser arc.",
          handoffToParticipantId: "otter",
          handoffWhen: "When the first teaser arc is concrete enough for review.",
        },
        {
          itemId: "item-otter",
          participantId: "otter",
          task: "Challenge the draft, point out must-fix issues, then pass it forward if there is no hard blocker.",
          handoffToParticipantId: "pandas",
          handoffWhen: "When the must-fix issues are clear enough for the next owner to execute.",
        },
        {
          itemId: "item-pandas",
          participantId: "pandas",
          task: "Turn the reviewed direction into the next concrete execution pass.",
        },
      ],
    });

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `第一版 teaser 骨架：1. 任务进 hall；2. 两个 agent 迅速补角度；3. owner 和 next action 单独浮出来。<hall-structured>${JSON.stringify({
        latestSummary: "The first teaser arc is ready for critique.",
        nextAction: "handoff",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:main:main",
      sessionId: "main-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: [
        "must-fix 只剩一个：把结尾改成明确交棒。",
        "改法直接定死：最后一句写成“现在交给下一位继续做”。",
        "@pandas 你按这个把第三拍改成可执行版本。",
      ].join("\n"),
      rawText: "ok",
      sessionKey: "agent:otter:main",
      sessionId: "otter-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: `下一版可执行结果：1. 开场先亮出 owner；2. 第二拍只留两句讨论；3. 第三拍把 next action 单独落卡。<hall-structured>${JSON.stringify({
        latestSummary: "The next concrete pass is ready for review.",
        nextAction: "review",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:pandas:main",
      sessionId: "pandas-session",
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "main",
    }, {
      toolClient: client,
    });

    assert.equal(assigned.taskCard?.stage, "review");
    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "pandas");
    assert(assigned.generatedMessages.some((message) => message.authorParticipantId === "main"));
    assert(assigned.generatedMessages.some((message) => message.authorParticipantId === "otter"));
    assert(assigned.generatedMessages.some((message) => message.authorParticipantId === "pandas"));
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime handoff ignores a mismatched structured executor and keeps the planned next owner", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task whose runtime handoff must stay on the planned next owner even if the visible reply @mentions someone else.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-main",
          participantId: "main",
          task: "Give three concrete hook options.",
          handoffToParticipantId: "monkey",
          handoffWhen: "When the three hook options are ready for the next owner.",
        },
        {
          itemId: "item-monkey",
          participantId: "monkey",
          task: "Turn the best hook into the next concrete thumbnail direction.",
          handoffToParticipantId: "otter",
          handoffWhen: "When the thumbnail direction is concrete enough for review.",
        },
        {
          itemId: "item-otter",
          participantId: "otter",
          task: "Review only the must-fix issues.",
        },
      ],
    });

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `3 个 hook 先给到：“不是多了个群聊，是任务自己开始往前走”、“你不用再来回协调，群聊会自己收敛出 owner 和下一步”、“聊天会结束，任务会继续往前走”。@pandas 你接着补 thumbnail。<hall-structured>${JSON.stringify({
        latestSummary: "Three concrete hook options are ready.",
        nextAction: "handoff",
        executor: "pandas",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:main:main",
      sessionId: "main-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: `我把 hook 收成了下一拍 thumbnail 方向。<hall-structured>${JSON.stringify({
        latestSummary: "The next thumbnail direction is ready for review.",
        nextAction: "handoff",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:monkey:main",
      sessionId: "monkey-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: `只剩一个 must-fix：把 owner 和 next action 的对比再拉大。<hall-structured>${JSON.stringify({
        latestSummary: "Review found one must-fix issue.",
        nextAction: "review",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:otter:main",
      sessionId: "otter-session",
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "main",
    }, {
      toolClient: client,
    });

    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "otter");
    assert.equal(assigned.taskCard?.stage, "review");
    assert.equal(
      assigned.generatedMessages.some((message) => /Handoff moved to .*planned next owner/i.test(message.content)),
      false,
    );
    assert(assigned.generatedMessages.some((message) => message.authorParticipantId === "monkey"));
    assert(assigned.generatedMessages.some((message) => message.authorParticipantId === "otter"));
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime execution persists artifact refs into the task and review message payload", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task that should leave a concrete artifact for review.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-main",
          participantId: "main",
          task: "Write a first draft script and attach the artifact link.",
        },
      ],
    });

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `第一版脚本已出。![script](https://example.com/script-v1.png)<hall-structured>${JSON.stringify({
        latestSummary: "第一版脚本已出，可以请老板评审。",
        nextAction: "review",
        artifactRefs: [
          {
            artifactId: "script-v1",
            type: "doc",
            label: "script-v1.png",
            location: "https://example.com/script-v1.png",
          },
        ],
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:main:artifact",
      sessionId: "main-artifact-session",
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "main",
    }, {
      toolClient: client,
    });

    assert.equal(assigned.taskCard?.stage, "review");
    assert.equal(assigned.task?.artifacts.length, 1);
    assert.equal(assigned.task?.artifacts[0]?.location, "https://example.com/script-v1.png");

    const hall = await readCollaborationHall();
    const reviewMessage = hall.messages
      .filter((message) => message.taskCardId === created.taskCard.taskCardId)
      .find((message) => message.kind === "system" && message.payload?.status === "execution_ready_for_review");
    assert(reviewMessage);
    assert.equal(reviewMessage.payload?.artifactRefs?.[0]?.location, "https://example.com/script-v1.png");
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime handoff defaults to the next queued owner when the middle reviewer only posts a natural-language verdict", async () => {
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

  const scriptedClient = createScriptedHallToolClient([
    {
      content: `第一版骨架先立住了：1. 任务抛进 hall；2. 两位 agent 快速补角度；3. owner 和下一步单独浮出来。<hall-structured>${JSON.stringify({
        latestSummary: "第一版骨架已经成形，可以交给 otter 做中间挑刺。",
        nextAction: "handoff",
      })}</hall-structured>`,
      sessionKey: "agent:main:runtime-main",
    },
    {
      content: [
        "硬缺口只剩一个：最后一拍还没有把“下一步是谁”写成肉眼可见的动作。",
        "改法直接定死：把结尾字幕写成“@pandas 接着出 3 个 thumbnail 方向”。",
        "@pandas 你继续把 3 个 thumbnail 方向贴出来。",
      ].join("\n"),
      sessionKey: "agent:otter:runtime-otter",
    },
    {
      content: [
        "我补 3 个 thumbnail 方向：",
        "1. 一条任务线把讨论 -> 拍板 -> 执行串起来。",
        "2. 让 viewer 第一眼看到 next action 和 owner。",
        "3. 用一个更强的“交给谁继续”镜头收尾。",
      ].join("\n"),
      sessionKey: "agent:pandas:runtime-pandas",
    },
  ]);

  try {
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task whose middle review step should still hand off to the third owner.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-main",
          participantId: "main",
          task: "产出第一版视频骨架。",
          handoffToParticipantId: "otter",
          handoffWhen: "当第一版骨架已经足够可评审。",
        },
        {
          itemId: "item-otter",
          participantId: "otter",
          task: "检查上一位结果，指出必须修改项；如果没有硬阻塞，就直接把可继续版本交给下一位。",
          handoffToParticipantId: "pandas",
          handoffWhen: "当必须改的点已经明确，下一位可以继续做 thumbnail。",
        },
        {
          itemId: "item-pandas",
          participantId: "pandas",
          task: "基于前面的结论给出 3 个 thumbnail 方向。",
        },
      ],
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "main",
    }, {
      toolClient: scriptedClient,
    });
    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "pandas");

    const detail = await readCollaborationHallTaskDetail(created.taskCard.taskCardId);
    assert.equal(detail.taskCard.currentOwnerParticipantId, "pandas");
    assert.equal(detail.taskCard.stage, "review");
    const taskMessages = detail.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    assert(taskMessages.some((message) => message.authorParticipantId === "otter"));
    assert(taskMessages.some((message) => message.authorParticipantId === "pandas"));
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime handoff keeps the planned next owner when the visible reply @mentions someone else", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Create a hall task whose current owner should hand off to an explicitly mentioned reviewer.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "item-main",
          participantId: "main",
          task: "收口这轮结果并交给 reviewer。",
          handoffToParticipantId: "pandas",
          handoffWhen: "当结果已经足够 reviewer 过一遍。",
        },
        {
          itemId: "item-pandas",
          participantId: "pandas",
          task: "按既定计划继续下一步。",
        },
      ],
    });

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `三个 hook 先给到：1. 不是多了个群聊，是第一次让 AI 团队自己把任务往前推。2. 重点不是聊天，是它会自己收口 owner 和下一步。3. 以前要我盯全程，现在这个群聊会自己把分工、协作和推进串起来。<br>@otter 你按评审口径过一遍，只抓真正会误导观众的点。<hall-structured>${JSON.stringify({
        latestSummary: "3 个 hook 已经产出，可以按既定顺序继续下一步。",
        nextAction: "handoff",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:main:mention-handoff",
      sessionId: "main-mention-handoff-session",
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "main",
    }, {
      toolClient: client,
    });

    assert.equal(assigned.taskCard?.stage, "execution");
    assert.equal(assigned.taskCard?.currentOwnerParticipantId, "pandas");
    assert.equal(assigned.taskCard?.currentOwnerLabel, "pandas");
    assert.equal(assigned.generatedMessages.some((message) => /planned next owner/i.test(message.content)), false);
  } finally {
    await restoreFiles(backups);
  }
});

function createScriptedHallToolClient(
  scriptedResponses: Array<{
    content: string;
    sessionKey?: string;
    sessionId?: string;
    status?: string;
  }>,
): FakeRuntimeToolClient {
  const client = new FakeRuntimeToolClient();
  for (const [index, response] of scriptedResponses.entries()) {
    const sessionKey = response.sessionKey?.trim() || `agent:scripted:${index + 1}`;
    client.queueResponse({
      ok: true,
      status: response.status?.trim() || "ok",
      text: response.content,
      rawText: "ok",
      sessionKey,
      sessionId: response.sessionId?.trim() || `${sessionKey.replace(/[^a-z0-9]+/gi, "-")}-session`,
    });
  }
  return client;
}

test("runtime-backed execution chain can continue automatically and move into review", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Run a multi-turn runtime execution chain and stop only when ready for review.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    client.queueResponse({
      ok: true,
      status: "ok",
      text: `First runtime slice delivered: 1. title and owner are visible above the fold; 2. discussion is reduced to two short chat turns; 3. next action lands as a separate card.<hall-structured>${JSON.stringify({
        latestSummary: "The first concrete runtime slice is in place.",
        nextAction: "continue",
        nextStep: "Run the final verification pass.",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:pandas:main",
      sessionId: "pandas-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: `Final verification pass: 1. owner remains visible; 2. next action survives refresh; 3. execution results stay in the same thread.<hall-structured>${JSON.stringify({
        latestSummary: "The concrete runtime slice is verified and ready for review.",
        nextAction: "review",
      })}</hall-structured>`,
      rawText: "ok",
      sessionKey: "agent:pandas:main",
      sessionId: "pandas-session",
    });

    const assigned = await assignHallTaskExecution({
      taskCardId: created.taskCard.taskCardId,
      ownerParticipantId: "pandas",
    }, {
      toolClient: client,
    });

    assert.equal(assigned.taskCard?.stage, "review");
    assert.equal(assigned.generatedMessages.length, 3);
    assert.equal(assigned.generatedMessages[0]?.authorParticipantId, "pandas");
    assert.equal(assigned.generatedMessages[1]?.authorParticipantId, "pandas");
    assert.equal(assigned.generatedMessages[2]?.authorParticipantId, "system");
  } finally {
    await restoreFiles(backups);
  }
});

test("reading task detail is side-effect free when a thread is sitting in review with a queued next owner", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Resume the queued next owner when a thread was pushed into review too early.",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );
    assert(created.taskCard);

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      stage: "review",
      status: "in_progress",
      currentOwnerParticipantId: "coq",
      currentOwnerLabel: "Coq-每日新闻",
      currentExecutionItem: {
        itemId: "item-coq",
        participantId: "coq",
        task: "Turn the feature summary into three hook options.",
        handoffToParticipantId: "monkey",
        handoffWhen: "Three hooks are ready for thumbnail ideation.",
      },
      plannedExecutionOrder: ["monkey"],
      plannedExecutionItems: [
        {
          itemId: "item-monkey",
          participantId: "monkey",
          task: "Turn the chosen hook into three thumbnail ideas.",
          handoffWhen: "Three thumbnail ideas are ready for review.",
        },
      ],
      latestSummary: "Coq already finished the hooks and this thread entered review too early.",
    });

    const detail = await readCollaborationHallTaskDetail(created.taskCard.taskCardId, {
      toolClient: client,
    });

    assert.equal(detail.taskCard.currentOwnerParticipantId, "coq");
    assert.equal(detail.taskCard.stage, "review");
    assert(!detail.messages.some((message) => message.authorParticipantId === "monkey"));
    assert.equal(client.agentRunCalls.length + client.agentRunStreamCalls.length, 0);
  } finally {
    await restoreFiles(backups);
  }
});

test("planning a new execution round from review keeps the next first owner startable", async () => {
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
    const created = await createHallTaskFromOperatorRequest(
      {
        content: "Finish one review pass, then plan a second execution round from the decision card.",
      },
      { skipDiscussion: true },
    );
    assert(created.taskCard);

    await updateHallTaskCard({
      taskCardId: created.taskCard.taskCardId,
      stage: "review",
      status: "in_progress",
      currentOwnerParticipantId: "monkey",
      currentOwnerLabel: "monkey",
      currentExecutionItem: {
        itemId: "done-monkey",
        participantId: "monkey",
        task: "Package the first reviewable teaser.",
        handoffWhen: "Once the teaser is posted back to the hall.",
      },
      plannedExecutionOrder: [],
      plannedExecutionItems: [],
      latestSummary: "The first pass is under review, and the operator is about to plan the next round.",
    });

    const reordered = await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      executionItems: [
        {
          itemId: "round-two-pandas",
          participantId: "pandas",
          task: "Use the reviewed teaser to build the second iteration.",
          handoffToParticipantId: "coq",
          handoffWhen: "When the second iteration is ready for hook writing.",
        },
        {
          itemId: "round-two-coq",
          participantId: "coq",
          task: "Turn the second iteration into three fresh hook options.",
          handoffWhen: "When the hooks are ready for review.",
        },
      ],
    });

    assert.equal(reordered.taskCard?.stage, "review");
    assert.equal(reordered.taskCard?.currentOwnerParticipantId ?? null, null);
    assert.equal(reordered.taskCard?.currentExecutionItem ?? null, null);
    assert.deepEqual(reordered.taskCard?.plannedExecutionOrder, ["pandas", "coq"]);
    assert.equal(reordered.taskCard?.plannedExecutionItems[0]?.participantId, "pandas");
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime-backed hall prefers direct streaming client output when available", async () => {
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
    const client = new FakeRuntimeToolClient();
    const created = await createHallTaskFromOperatorRequest({
      content: "Use the streaming runtime path for hall discussion.",
    }, {
      toolClient: client,
    });
    assert(created.taskCard);
    await waitForHallBackgroundWork();
    assert(client.agentRunStreamCalls.length >= 1);
    assert.equal(client.agentRunCalls.length, 0);
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime-backed hall filters internal thinking and tool output out of visible hall messages", async () => {
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
    const client = new FakeRuntimeToolClient();
    client.queueResponse({
      ok: true,
      status: "ok",
      text: [
        'Inspecting repo for updates I might need to inspect the repository since the user mentioned doing real work if necessary.',
        '[tool] import type { UiLanguage } from "../runtime/ui-preferences";',
        '[tool] export function renderCollaborationHallTheme(): string { return `...`; }',
        '<hall-structured>{"proposal":"先锁一句观众能复述的话。","latestSummary":"第一轮先证明这不是聊天，而是在推进任务。","nextAction":"continue"}</hall-structured>',
        '先锁一句观众能复述的话：这不是几个 AI 在聊天，而是在围绕同一个任务分工、拍板、推进。',
      ].join("\n"),
      rawText: [
        'Inspecting repo for updates I might need to inspect the repository since the user mentioned doing real work if necessary.',
        '[tool] import type { UiLanguage } from "../runtime/ui-preferences";',
        '[tool] export function renderCollaborationHallTheme(): string { return `...`; }',
        '<hall-structured>{"proposal":"先锁一句观众能复述的话。","latestSummary":"第一轮先证明这不是聊天，而是在推进任务。","nextAction":"continue"}</hall-structured>',
        '先锁一句观众能复述的话：这不是几个 AI 在聊天，而是在围绕同一个任务分工、拍板、推进。',
      ].join("\n"),
      sessionKey: "agent:coq:main",
      sessionId: "coq-session",
    });

    const created = await createHallTaskFromOperatorRequest({
      content: "我想要做一个视频 介绍我的群聊功能",
    }, {
      toolClient: client,
    });
    assert(created.taskCard);
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const combined = taskMessages.map((message) => message.content).join("\n");

    assert.match(combined, /先锁一句观众能复述的话/);
    assert.doesNotMatch(combined, /\[tool\]/i);
    assert.doesNotMatch(combined, /Inspecting repo/i);
    assert.doesNotMatch(combined, /import type \{ UiLanguage \}/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime-backed hall discussion defaults to two distinct agent replies when the operator does not @ anyone", async () => {
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
    const client = new FakeRuntimeToolClient();
    client.queueResponse({
      ok: true,
      status: "ok",
      text: "先把成功标准锁成一句能复述的话。<hall-structured>{\"proposal\":\"先锁一句观众能复述的话。\",\"nextAction\":\"continue\"}</hall-structured>",
      rawText: "ok",
      sessionKey: "agent:coq:main",
      sessionId: "coq-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: "补一个镜头角度：先亮 owner 和 next action，再回放讨论。",
      rawText: "ok",
      sessionKey: "agent:pandas:main",
      sessionId: "pandas-session",
    });

    const created = await createHallTaskFromOperatorRequest({
      content: "我想做一个视频介绍群聊功能。",
    }, {
      toolClient: client,
    });
    assert(created.taskCard);
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const agentReplies = taskMessages.filter((message) => message.authorParticipantId !== "operator" && message.kind !== "system");
    const distinctAuthors = [...new Set(agentReplies.map((message) => message.authorParticipantId))];

    assert(distinctAuthors.length >= 2);
    assert.notEqual(distinctAuthors[0], distinctAuthors[1]);
    const runtimeCalls = client.agentRunStreamCalls.length > 0 ? client.agentRunStreamCalls : client.agentRunCalls;
    assert.equal(runtimeCalls.length >= 2, true);
    assert.match(runtimeCalls[1]!.message, /Recent shared thread transcript \(oldest -> newest\):/i);
    assert.match(runtimeCalls[1]!.message, /Coq-每日新闻 \[planner\]: 先把成功标准锁成一句能复述的话。/i);
    assert.match(runtimeCalls[1]!.message, /Answer the latest human message directly\./i);
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime-backed non-manager discussion replies do not visibly @route the next executor before assignment", async () => {
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
    const client = new FakeRuntimeToolClient();
    client.queueResponse({
      ok: true,
      status: "ok",
      text: "先锁一个点：第一版先证明这不是聊天，而是在推进任务。<hall-structured>{\"proposal\":\"先锁一句观众能复述的话。\",\"nextAction\":\"continue\"}</hall-structured>",
      rawText: "ok",
      sessionKey: "agent:coq:main",
      sessionId: "coq-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: "我只补一个点：完成标准最好一句话就能复述。<br>@pandas 接着补一个“完成标准一句话讲得清”的样本。",
      rawText: "ok",
      sessionKey: "agent:monkey:main",
      sessionId: "monkey-session",
    });

    const created = await createHallTaskFromOperatorRequest({
      content: "我想做一个视频介绍群聊功能。",
    }, {
      toolClient: client,
    });
    assert(created.taskCard);
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const taskMessages = hall.messages.filter((message) => message.taskCardId === created.taskCard?.taskCardId);
    const monkeyReply = taskMessages.find((message) => message.authorParticipantId === "monkey");
    assert(monkeyReply);
    assert.doesNotMatch(monkeyReply.content, /@pandas/i);
    assert.match(monkeyReply.content, /\bpandas\b/i);

    const runtimeCalls = client.agentRunStreamCalls.length > 0 ? client.agentRunStreamCalls : client.agentRunCalls;
    assert.match(runtimeCalls[1]!.message, /This is discussion only\. Do not start execution yet\./i);
    assert.match(runtimeCalls[1]!.message, /If you mention a teammate by name, use a real hall participant name\./i);
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime-backed manager discussion sanitizes deleted executor names to the live hall roster", async () => {
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
    const client = new FakeRuntimeToolClient();
    client.setManagerDiscussionResponse({
      ok: true,
      status: "ok",
      text: `<hall-structured>${JSON.stringify({
        decision: "Decision: 建议由 dolphin 作为唯一执行人，先锁定受众和叙事线。",
        executor: "dolphin",
        doneWhen: "dolphin 产出一版简短方案，明确目标受众和动画顺序。",
        latestSummary: "由 dolphin 先做第一版方向稿。",
      })}</hall-structured>main closed the discussion and recommended dolphin.`,
      rawText: "ok",
      sessionKey: "agent:main:main",
      sessionId: "main-session",
    });

    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想制作数据可视化动画，先讨论受众、叙事方式和执行顺序。",
      },
      {
        toolClient: client,
        skipDiscussion: true,
      },
    );

    await postHallMessage({
      taskCardId: created.taskCard?.taskCardId,
      content: "@main 你来收一下，给个结论和第一执行者。",
    }, {
      toolClient: client,
    });
    await waitForHallBackgroundWork();

    const hall = await readCollaborationHall();
    const decisionMessage = [...hall.messages]
      .reverse()
      .find((message) => message.taskCardId === created.taskCard?.taskCardId && message.kind === "decision");
    assert(decisionMessage);
    assert.doesNotMatch(decisionMessage.content, /dolphin/i);
    assert.match(decisionMessage.content, /Coq-每日新闻|coq/i);
    const detail = await readCollaborationHallTaskDetail(created.taskCard!.taskCardId);
    assert.equal(detail.taskCard.currentOwnerParticipantId, undefined);
    assert.equal(detail.taskCard.currentOwnerLabel, undefined);
    assert.deepEqual(detail.taskCard.plannedExecutionOrder, ["coq"]);
    assert.doesNotMatch(detail.taskCard.decision ?? "", /dolphin/i);
    assert.doesNotMatch(detail.taskCard.doneWhen ?? "", /dolphin/i);
    assert.doesNotMatch(detail.taskCard.latestSummary ?? "", /dolphin/i);
  } finally {
    await restoreFiles(backups);
  }
});

test("runtime-backed hall prompts agents to answer in the user's language", async () => {
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
    const client = new FakeRuntimeToolClient();
    await createHallTaskFromOperatorRequest({
      content: "I want to create a data storytelling animation and discuss the audience first.",
    }, {
      toolClient: client,
    });
    await waitForHallBackgroundWork();
    assert(client.agentRunStreamCalls.some((request) => request.message.includes("Reply in English")));

    const chineseClient = new FakeRuntimeToolClient();
    await createHallTaskFromOperatorRequest({
      content: "我想做一个数据叙事动画，先讨论目标受众。",
    }, {
      toolClient: chineseClient,
    });
    await waitForHallBackgroundWork();
    assert(chineseClient.agentRunStreamCalls.some((request) => request.message.includes("Reply in Simplified Chinese")));
  } finally {
    await restoreFiles(backups);
  }
});

test("duplicate operator follow-up during discussion does not append a second identical turn", async () => {
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
    const content = "我想要做一个视频 介绍我的群聊功能";
    const created = await createHallTaskFromOperatorRequest(
      {
        content,
      },
      {
        skipDiscussion: true,
      },
    );

    const before = await readCollaborationHallTaskDetail(created.taskCard!.taskCardId);
    assert.equal(before.messages.length, 1);
    assert.equal(before.messages[0]?.kind, "task");

    const duplicate = await postHallMessage({
      taskCardId: created.taskCard!.taskCardId,
      content,
    });

    const after = await readCollaborationHallTaskDetail(created.taskCard!.taskCardId);
    assert.equal(after.messages.length, 1);
    assert.equal(after.messages[0]?.kind, "task");
    assert.equal(duplicate.generatedMessages.length, 0);
    assert.equal(duplicate.message?.messageId, before.messages[0]?.messageId);
  } finally {
    await restoreFiles(backups);
  }
});

test("manual execution order saved during an active discussion survives later discussion replies", async () => {
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
    const client = new FakeRuntimeToolClient();
    client.queueResponse({
      ok: true,
      status: "ok",
      text: "先锁一个成功标准。<hall-structured>{\"proposal\":\"先锁一句观众能复述的话。\",\"nextAction\":\"continue\"}</hall-structured>",
      rawText: "ok",
      sessionKey: "agent:coq:main",
      sessionId: "coq-session",
    });
    client.queueResponse({
      ok: true,
      status: "ok",
      text: "我补一个镜头角度：先亮结果，再回放讨论。",
      rawText: "ok",
      sessionKey: "agent:monkey:main",
      sessionId: "monkey-session",
    });

    const created = await createHallTaskFromOperatorRequest(
      {
        content: "我想做一个视频介绍群聊功能。",
      },
      {
        toolClient: client,
      },
    );
    assert(created.taskCard);

    await setHallTaskExecutionOrder({
      taskCardId: created.taskCard.taskCardId,
      participantIds: ["main", "otter", "pandas"],
      executionItems: [
        {
          itemId: "main-1",
          participantId: "main",
          task: "先锁定第一版最小闭环。",
          handoffToParticipantId: "otter",
          handoffWhen: "这版方向可评审。",
        },
        {
          itemId: "otter-1",
          participantId: "otter",
          task: "只挑 must-fix。",
          handoffToParticipantId: "pandas",
          handoffWhen: "没有硬 blocker。",
        },
        {
          itemId: "pandas-1",
          participantId: "pandas",
          task: "把可拍版本收成脚本。",
          handoffWhen: "脚本初稿回大厅。",
        },
      ],
    });

    await waitForHallBackgroundWork();

    const detail = await readCollaborationHallTaskDetail(created.taskCard.taskCardId);
    assert.deepEqual(detail.taskCard.plannedExecutionOrder, ["main", "otter", "pandas"]);
    assert.deepEqual(
      detail.taskCard.plannedExecutionItems.map((item) => item.participantId),
      ["main", "otter", "pandas"],
    );
    assert.equal(detail.taskCard.plannedExecutionItems[0]?.task, "先锁定第一版最小闭环。");
  } finally {
    await restoreFiles(backups);
  }
});

async function backupFiles(paths: string[]): Promise<Map<string, string | undefined>> {
  const backups = new Map<string, string | undefined>();
  for (const path of paths) {
    backups.set(path, await readOptionalFile(path));
  }
  return backups;
}

async function restoreFiles(backups: Map<string, string | undefined>): Promise<void> {
  await waitForHallBackgroundWork();
  for (const [path, content] of backups.entries()) {
    if (content === undefined) {
      await rm(path, { force: true });
    } else {
      await writeFile(path, content, "utf8");
    }
  }
}

async function resetFiles(paths: string[]): Promise<void> {
  await waitForHallBackgroundWork();
  for (const path of paths) {
    await rm(path, { force: true });
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function waitForHallMessage(
  predicate: Parameters<Array<typeof Array.prototype.find>[0]>[0],
  fromIndex = 0,
  timeoutMs = 2_000,
): Promise<Awaited<ReturnType<typeof readCollaborationHall>>["messages"][number]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hall = await readCollaborationHall();
    const match = hall.messages.slice(fromIndex).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for a hall message.`);
}

class FakeRuntimeToolClient implements ToolClient {
  readonly agentRunCalls: AgentRunRequest[] = [];
  readonly agentRunStreamCalls: AgentRunRequest[] = [];
  private readonly queuedResponses: AgentRunResponse[] = [];
  private managerDiscussionResponse?: AgentRunResponse;

  async sessionsList() {
    return { sessions: [] };
  }

  async sessionStatus() {
    return { rawText: "" };
  }

  async sessionsHistory(_request: SessionsHistoryRequest): Promise<SessionsHistoryResponse> {
    return { rawText: "" };
  }

  async cronList() {
    return { jobs: [] };
  }

  async approvalsGet() {
    return { rawText: "" };
  }

  async approvalsApprove() {
    return { ok: false, action: "approve" as const, approvalId: "n/a", rawText: "" };
  }

  async approvalsReject() {
    return { ok: false, action: "reject" as const, approvalId: "n/a", rawText: "" };
  }

  queueResponse(response: AgentRunResponse): void {
    this.queuedResponses.push(response);
  }

  setManagerDiscussionResponse(response: AgentRunResponse): void {
    this.managerDiscussionResponse = response;
  }

  async agentRun(request: AgentRunRequest): Promise<AgentRunResponse> {
    this.agentRunCalls.push(request);
    return this.nextResponse(request);
  }

  async agentRunStream(request: AgentRunRequest, handlers?: { onStdoutChunk?: (chunk: string) => void }): Promise<AgentRunResponse> {
    this.agentRunStreamCalls.push(request);
    const response = this.nextResponse(request);
    const content = response.rawText && response.rawText !== "ok" ? response.rawText : (response.text || "");
    const midpoint = Math.max(1, Math.floor(content.length / 2));
    handlers?.onStdoutChunk?.(content.slice(0, midpoint));
    handlers?.onStdoutChunk?.(content.slice(midpoint));
    return response;
  }

  private nextResponse(request: AgentRunRequest): AgentRunResponse {
    const queued = this.queuedResponses.shift();
    if (queued) return queued;

    const agentId = request.agentId?.trim() || "agent";
    const sessionKey = request.sessionKey?.trim() || `agent:${agentId}:main`;
    if (request.message.includes("You must close the discussion")) {
      if (this.managerDiscussionResponse) {
        const response = this.managerDiscussionResponse;
        this.managerDiscussionResponse = undefined;
        return response;
      }
      return {
        ok: true,
        status: "ok",
        text: `<hall-structured>${JSON.stringify({
          decision: "Use a single execution owner in the hall.",
          doneWhen: "discussion, execution, and review stay in one shared timeline",
        })}</hall-structured>${agentId} closed the discussion and recommended a single-owner flow.`,
        rawText: "ok",
        sessionKey,
        sessionId: `${agentId}-session`,
      };
    }

    return {
      ok: true,
      status: "ok",
      text: `${agentId} posted a real runtime update for the hall.`,
      rawText: "ok",
      sessionKey,
      sessionId: `${agentId}-session`,
    };
  }
}
