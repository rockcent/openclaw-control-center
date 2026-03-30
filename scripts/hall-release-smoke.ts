#!/usr/bin/env node

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const ROOT = join(__dirname, "..");
const PORT = process.env.HALL_SMOKE_PORT || "4517";
const RUNTIME_DIR = mkdtempSync(join(tmpdir(), "hall-release-smoke-"));
const PAGE_TIMEOUT_MS = 30_000;
const SERVER_TIMEOUT_MS = 20_000;
const SMOKE_LOCAL_TOKEN = "hall-smoke-local-token";

type SeededTask = {
  hallId: string;
  taskCardId: string;
  projectId: string;
  taskId: string;
  roomId: string;
  title: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(baseUrl: string): Promise<void> {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
      lastError = new Error(`healthz returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw new Error(`hall smoke server did not become ready: ${String(lastError)}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function seedRuntime(): Promise<{ firstTask: SeededTask; secondTask: SeededTask; thirdTask: SeededTask; fourthTask: SeededTask; fifthTask: SeededTask; sixthTask: SeededTask; seventhTask: SeededTask; eighthTask: SeededTask }> {
  process.env.OPENCLAW_RUNTIME_DIR = RUNTIME_DIR;
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const [{ createHallTaskFromOperatorRequest }, { appendHallMessage, updateHallTaskCard }] = await Promise.all([
    import("../src/runtime/collaboration-hall-orchestrator"),
    import("../src/runtime/collaboration-hall-store"),
  ]);

  const first = await createHallTaskFromOperatorRequest(
    {
      content: "我想要做一个视频 介绍我的群聊功能",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  const second = await createHallTaskFromOperatorRequest(
    {
      content: "我想要策划一个互动数据叙事事件",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  const third = await createHallTaskFromOperatorRequest(
    {
      content: "我想把第二轮继续跑起来，确认下一位执行者还能开始。",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  const fourth = await createHallTaskFromOperatorRequest(
    {
      content: "我想从执行中切回讨论，再排第三轮顺序并重新开始。",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  const fifth = await createHallTaskFromOperatorRequest(
    {
      content: "请先扫描 control-center 代码，找出 hall-chat 的 3 个关键入口文件，并说明每个文件负责什么。",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  const sixth = await createHallTaskFromOperatorRequest(
    {
      content: "请把群聊功能收成一句能拍的总结，再交给下一位写 3 个 hook。",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  const seventh = await createHallTaskFromOperatorRequest(
    {
      content: "请排一个很长的多 agent 执行顺序，用来验证顺序编辑器可以滚动到最下面。",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  const eighth = await createHallTaskFromOperatorRequest(
    {
      content: "请打开一个空的执行顺序编辑器，用来验证没有已选执行者时的空态布局。",
      authorParticipantId: "operator",
      authorLabel: "Operator",
    },
    { skipDiscussion: true },
  );

  await appendHallMessage({
    hallId: first.hall.hallId,
    kind: "proposal",
    authorParticipantId: "coq",
    authorLabel: "Coq-每日新闻",
    content: "先把任务样本锁死：就用“做一个介绍群聊功能的视频”当片中任务。<br>这样开场 20 秒里就能自然出现讨论、拍板、owner、next action。<br>@pandas 可以直接按这个样本补一版最小台词和屏幕动作。",
    projectId: first.taskCard.projectId,
    taskId: first.taskCard.taskId,
    taskCardId: first.taskCard.taskCardId,
    roomId: first.roomId,
  });

  await updateHallTaskCard({
    taskCardId: first.taskCard.taskCardId,
    stage: "discussion",
    status: "todo",
    proposal: "先选第一位执行者，再把这条视频任务推进成可执行顺序。",
    latestSummary: "这条线程应该显示一个空的执行顺序控制台，并保持紧凑布局。",
  });

  await updateHallTaskCard({
    taskCardId: third.taskCard.taskCardId,
    stage: "review",
    status: "in_progress",
    currentOwnerParticipantId: "builder",
    currentOwnerLabel: "Builder",
    currentExecutionItem: null,
    decision: "第一轮先停在可评审状态，然后从 pandas 开第二轮。",
    doneWhen: "第二轮能从同一张卡重新开始执行。",
    plannedExecutionOrder: ["pandas"],
    plannedExecutionItems: [
      {
        itemId: "next-pandas",
        participantId: "pandas",
        task: "把第一轮评审结果收成第二轮的可执行起步稿。",
        handoffWhen: "第二轮第一棒做完后贴回大厅。",
      },
    ],
    latestSummary: "这条线程应该还能从 pandas 重新开始第二轮执行。",
  });

  await updateHallTaskCard({
    taskCardId: fourth.taskCard.taskCardId,
    stage: "execution",
    status: "in_progress",
    currentOwnerParticipantId: "main",
    currentOwnerLabel: "main",
    currentExecutionItem: {
      itemId: "active-main",
      participantId: "main",
      task: "先把上一轮结果收住。",
      handoffToParticipantId: "otter",
      handoffWhen: "收住后交给 otter。",
    },
    plannedExecutionOrder: ["otter"],
    plannedExecutionItems: [
      {
        itemId: "next-otter",
        participantId: "otter",
        task: "按新的方向开第三轮第一棒。",
        handoffWhen: "开第三轮后贴回大厅。",
      },
    ],
    latestSummary: "这条线程应该能从执行中切回讨论，再重新开始第三轮。",
  });

  await appendHallMessage({
    hallId: fifth.hall.hallId,
    kind: "proposal",
    authorParticipantId: "coq",
    authorLabel: "Coq-每日新闻",
    content: "这题里 **“关键入口”** 最好先定义成“读懂 hall-chat 主链路时最先该进的文件”，不然 UI 外壳文件和真正的协作入口会混在一起。<br>按这个标准，`collaboration-hall.ts` 看呈现，`collaboration-hall-orchestrator.ts` 看编排，`hall-runtime-dispatch.ts` 看执行落地，`server.ts` 更像外层承载入口。",
    projectId: fifth.taskCard.projectId,
    taskId: fifth.taskCard.taskId,
    taskCardId: fifth.taskCard.taskCardId,
    roomId: fifth.roomId,
  });

  await appendHallMessage({
    hallId: fifth.hall.hallId,
    kind: "proposal",
    authorParticipantId: "monkey",
    authorLabel: "monkey",
    content: "这个划分已经够稳了，再补一个判断标准：凡是**不看它就读不通 hall-chat 主链路**的，才算这轮的关键入口。<br>按这个标准，`server.ts` 更像把页面和接口托起来的壳；真正决定 hall-chat 怎么显示、怎么收敛、怎么派发执行的，还是那 3 个主链路文件。",
    projectId: fifth.taskCard.projectId,
    taskId: fifth.taskCard.taskId,
    taskCardId: fifth.taskCard.taskCardId,
    roomId: fifth.roomId,
  });

  await appendHallMessage({
    hallId: fifth.hall.hallId,
    kind: "status",
    authorParticipantId: "pandas",
    authorLabel: "pandas",
    authorSemanticRole: "builder",
    content: "- `src/ui/collaboration-hall.ts`：呈现层入口，负责把 hall-chat 的房间、消息、参与者、执行项、任务卡真正渲染成前台页面；这是“你看到的 hall 界面”本体。\n- `src/runtime/collaboration-hall-orchestrator.ts`：编排层入口，负责讨论轮转、speaker 选择、structured handoff、execution lock、角色解析和任务卡推进；这是“讨论怎么变成明确 owner 和下一步”的主逻辑。\n- `src/runtime/hall-runtime-dispatch.ts`：执行派发层入口，负责把 hall 里收口的结果转成真实 runtime 执行，并处理 stream、timeout、poll 等执行语义；这是“hall 结果怎么真正落地”的入口。\n\n`src/ui/server.ts` 要算更外层入口容器：它负责把 UI 页面和 runtime 路由接起来，但不属于 hall-chat 这条主链路的三层本体。\n@main 你只检查这个“三层 + 外层容器”的分法准不准。",
    projectId: fifth.taskCard.projectId,
    taskId: fifth.taskCard.taskId,
    taskCardId: fifth.taskCard.taskCardId,
    roomId: fifth.roomId,
    payload: { status: "runtime_execution_update" },
  });

  await appendHallMessage({
    hallId: fifth.hall.hallId,
    kind: "handoff",
    authorParticipantId: "main",
    authorLabel: "main",
    authorSemanticRole: "manager",
    content: "这版判断没偏，三层主链路和 `src/ui/server.ts` 的外层容器定位都对。@otter 你只卡 must-fix，没硬伤就直接放行。",
    projectId: fifth.taskCard.projectId,
    taskId: fifth.taskCard.taskId,
    taskCardId: fifth.taskCard.taskCardId,
    roomId: fifth.roomId,
    payload: { status: "runtime_handoff_update" },
  });

  await appendHallMessage({
    hallId: fifth.hall.hallId,
    kind: "handoff",
    authorParticipantId: "otter",
    authorLabel: "otter",
    authorSemanticRole: "reviewer",
    content: "`src/ui/collaboration-hall.ts` 对应 hall-chat 界面层，`src/runtime/collaboration-hall-orchestrator.ts` 对应编排流转层，`src/runtime/hall-runtime-dispatch.ts` 对应 agent 派发执行层；这条主链路判断准确，没有 must-fix。<br>`src/ui/server.ts` 作为外层入口容器的补充说明也成立。@main 现在请老板评审。",
    projectId: fifth.taskCard.projectId,
    taskId: fifth.taskCard.taskId,
    taskCardId: fifth.taskCard.taskCardId,
    roomId: fifth.roomId,
    payload: { status: "runtime_handoff_update" },
  });

  await appendHallMessage({
    hallId: fifth.hall.hallId,
    kind: "system",
    authorParticipantId: "system",
    authorLabel: "System",
    authorSemanticRole: "generalist",
    content: "otter 把“只挑 must-fix，别扩 scope。”做到可评审了，现在请老板评审。",
    projectId: fifth.taskCard.projectId,
    taskId: fifth.taskCard.taskId,
    taskCardId: fifth.taskCard.taskCardId,
    roomId: fifth.roomId,
    payload: { status: "execution_ready_for_review" },
  });

  await updateHallTaskCard({
    taskCardId: fifth.taskCard.taskCardId,
    stage: "review",
    status: "in_progress",
    currentOwnerParticipantId: "otter",
    currentOwnerLabel: "otter",
    currentExecutionItem: {
      itemId: "review-otter",
      participantId: "otter",
      task: "只挑 must-fix，别扩 scope。",
      handoffToParticipantId: "main",
      handoffWhen: "没硬伤就请老板评审。",
    },
    plannedExecutionOrder: ["pandas", "main", "otter"],
    plannedExecutionItems: [
      {
        itemId: "repo-pandas",
        participantId: "pandas",
        task: "扫描 control-center 代码，找出 hall-chat 的 3 个关键入口文件，并说明每个文件负责什么。",
        handoffToParticipantId: "main",
        handoffWhen: "把 3 个入口和职责贴回大厅后交给 main。",
      },
      {
        itemId: "repo-main",
        participantId: "main",
        task: "检查三层 + 外层容器的分法准不准。",
        handoffToParticipantId: "otter",
        handoffWhen: "确认定位无误后交给 otter。",
      },
      {
        itemId: "repo-otter",
        participantId: "otter",
        task: "只挑 must-fix，别扩 scope。",
        handoffToParticipantId: "main",
        handoffWhen: "没有硬伤就请老板评审。",
      },
    ],
    latestSummary: "repo-scan 线程必须把 pandas 的代码结果、main 的复核和 otter 的 review 都显示在 UI 里。",
  });

  await appendHallMessage({
    hallId: sixth.hall.hallId,
    kind: "status",
    authorParticipantId: "pandas",
    authorLabel: "pandas",
    authorSemanticRole: "builder",
    content: "新群聊功能已经收清了：它把讨论、分工、owner 收口、support-only 和 next action 串成一个可见的任务推进线程，能把本来会来回拉扯的事及时收住。<br>@main 你接着按这句写 3 个 hook。",
    projectId: sixth.taskCard.projectId,
    taskId: sixth.taskCard.taskId,
    taskCardId: sixth.taskCard.taskCardId,
    roomId: sixth.roomId,
    payload: { status: "runtime_execution_update" },
  });

  await updateHallTaskCard({
    taskCardId: sixth.taskCard.taskCardId,
    stage: "execution",
    status: "in_progress",
    currentOwnerParticipantId: "pandas",
    currentOwnerLabel: "pandas",
    currentExecutionItem: {
      itemId: "summary-pandas",
      participantId: "pandas",
      task: "把群聊功能收成一句能拍的总结，再交给下一位写 3 个 hook。",
      handoffToParticipantId: "main",
      handoffWhen: "总结贴回大厅后交给 main。",
    },
    plannedExecutionOrder: ["pandas", "main"],
    plannedExecutionItems: [
      {
        itemId: "summary-pandas",
        participantId: "pandas",
        task: "把群聊功能收成一句能拍的总结，再交给下一位写 3 个 hook。",
        handoffToParticipantId: "main",
        handoffWhen: "总结贴回大厅后交给 main。",
      },
      {
        itemId: "summary-main",
        participantId: "main",
        task: "根据这句总结写 3 个 hook。",
        handoffWhen: "把 3 个 hook 贴回大厅。",
      },
    ],
    latestSummary: "support-only 合法出现在执行结果时，UI 必须保留整句和 handoff。",
  });

  await updateHallTaskCard({
    taskCardId: seventh.taskCard.taskCardId,
    stage: "discussion",
    status: "todo",
    currentOwnerParticipantId: "pandas",
    currentOwnerLabel: "pandas",
    currentExecutionItem: null,
    decision: "这条线程专门验证执行顺序编辑器能滚到最下面。",
    latestSummary: "执行顺序编辑器必须可以滚到最下面，看到保存按钮和全部 agent。",
    plannedExecutionOrder: ["pandas", "main", "otter", "tiger", "coq", "monkey"],
    plannedExecutionItems: [
      {
        itemId: "planner-pandas",
        participantId: "pandas",
        task: "先去扫描 control-center 仓库，列出 3 个 hall-chat 关键入口文件，再把每个文件负责什么总结成一段清楚的话。",
        handoffToParticipantId: "main",
        handoffWhen: "把 3 个入口文件和职责都贴回大厅后交给 @main。",
      },
      {
        itemId: "planner-main",
        participantId: "main",
        task: "基于代码入口总结给 3 个不同风格的 20 秒开头，每版都突出 owner、next action、任务收口。",
        handoffToParticipantId: "otter",
        handoffWhen: "给出 3 版开头草稿后交给 @otter 只挑 must-fix。",
      },
      {
        itemId: "planner-otter",
        participantId: "otter",
        task: "只挑会影响普通观众即时理解的硬问题，不要扩 scope，不要重写整版结构。",
        handoffToParticipantId: "tiger",
        handoffWhen: "没有硬阻塞就把可继续版本交给 @tiger 补视觉方向。",
      },
      {
        itemId: "planner-tiger",
        participantId: "tiger",
        task: "给 3 个 thumbnail 视觉方向，每个方向都要一句可直接生成图片的提示词和一个可访问 URL 占位。",
        handoffToParticipantId: "coq",
        handoffWhen: "贴完 3 个视觉方向和 URL 占位后交给 @coq 收口。",
      },
      {
        itemId: "planner-coq",
        participantId: "coq",
        task: "把前面的结构、hook、thumbnail 方向收成最终可拍版本，确认叙事顺序不会再打架。",
        handoffToParticipantId: "monkey",
        handoffWhen: "确认可拍后交给 @monkey 做最后一轮执行整理。",
      },
      {
        itemId: "planner-monkey",
        participantId: "monkey",
        task: "把最终版本整理成这轮可执行结果，并明确下一轮是否还要继续讨论或直接开始执行。",
        handoffWhen: "整理完最终可执行结果后，这轮可以保存并开始执行。",
      },
    ],
  });

  await updateHallTaskCard({
    taskCardId: eighth.taskCard.taskCardId,
    stage: "review",
    status: "in_progress",
    currentOwnerParticipantId: "otter",
    currentOwnerLabel: "otter",
    currentExecutionItem: {
      itemId: "empty-otter",
      participantId: "otter",
      task: "确认空的执行顺序编辑器仍然保持紧凑。",
      handoffWhen: "打开空态 planner 看布局。",
    },
    decision: "这条线程专门验证没有已选执行者时的顺序编辑器空态。",
    latestSummary: "空 planner 态应该紧凑，不应该把空框、agent 芯片和按钮拉满一整页。",
    plannedExecutionOrder: [],
    plannedExecutionItems: [],
  });

  return {
    firstTask: {
      hallId: first.hall.hallId,
      taskCardId: first.taskCard.taskCardId,
      projectId: first.taskCard.projectId,
      taskId: first.taskCard.taskId,
      roomId: first.roomId,
      title: first.taskCard.title,
    },
    secondTask: {
      hallId: second.hall.hallId,
      taskCardId: second.taskCard.taskCardId,
      projectId: second.taskCard.projectId,
      taskId: second.taskCard.taskId,
      roomId: second.roomId,
      title: second.taskCard.title,
    },
    thirdTask: {
      hallId: third.hall.hallId,
      taskCardId: third.taskCard.taskCardId,
      projectId: third.taskCard.projectId,
      taskId: third.taskCard.taskId,
      roomId: third.roomId,
      title: third.taskCard.title,
    },
    fourthTask: {
      hallId: fourth.hall.hallId,
      taskCardId: fourth.taskCard.taskCardId,
      projectId: fourth.taskCard.projectId,
      taskId: fourth.taskCard.taskId,
      roomId: fourth.roomId,
      title: fourth.taskCard.title,
    },
    fifthTask: {
      hallId: fifth.hall.hallId,
      taskCardId: fifth.taskCard.taskCardId,
      projectId: fifth.taskCard.projectId,
      taskId: fifth.taskCard.taskId,
      roomId: fifth.roomId,
      title: fifth.taskCard.title,
    },
    sixthTask: {
      hallId: sixth.hall.hallId,
      taskCardId: sixth.taskCard.taskCardId,
      projectId: sixth.taskCard.projectId,
      taskId: sixth.taskCard.taskId,
      roomId: sixth.roomId,
      title: sixth.taskCard.title,
    },
    seventhTask: {
      hallId: seventh.hall.hallId,
      taskCardId: seventh.taskCard.taskCardId,
      projectId: seventh.taskCard.projectId,
      taskId: seventh.taskCard.taskId,
      roomId: seventh.roomId,
      title: seventh.taskCard.title,
    },
    eighthTask: {
      hallId: eighth.hall.hallId,
      taskCardId: eighth.taskCard.taskCardId,
      projectId: eighth.taskCard.projectId,
      taskId: eighth.taskCard.taskId,
      roomId: eighth.roomId,
      title: eighth.taskCard.title,
    },
  };
}

function startServer(): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      OPENCLAW_RUNTIME_DIR: RUNTIME_DIR,
      UI_MODE: "true",
      UI_PORT: PORT,
      LOCAL_TOKEN_AUTH_REQUIRED: "true",
      LOCAL_API_TOKEN: SMOKE_LOCAL_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runBrowserSmoke(baseUrl: string, firstTask: SeededTask, secondTask: SeededTask, thirdTask: SeededTask, fourthTask: SeededTask, fifthTask: SeededTask, sixthTask: SeededTask, seventhTask: SeededTask, eighthTask: SeededTask): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt" && dialog.message().includes("LOCAL_API_TOKEN")) {
      await dialog.accept(SMOKE_LOCAL_TOKEN);
      return;
    }
    await dialog.dismiss();
  });
  await page.addInitScript((token) => {
    try {
      window.localStorage.setItem("openclaw:local-api-token", token);
    } catch {}
  }, SMOKE_LOCAL_TOKEN);

  try {
    await page.goto(`${baseUrl}/?section=hall-chat&taskCardId=${encodeURIComponent(firstTask.taskCardId)}`, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });

    await page.waitForSelector("[data-collaboration-hall-root]", { timeout: PAGE_TIMEOUT_MS });
    await page.waitForSelector("[data-task-card-id]", { timeout: PAGE_TIMEOUT_MS });

    const headline = (await page.locator("[data-hall-headline]").textContent())?.trim();
    assert(headline === "围绕同一条线程讨论、分工、交接和评审。", `unexpected hall headline: ${headline}`);

    const threadTitle = (await page.locator("[data-hall-thread-title]").textContent())?.trim();
    assert(threadTitle === firstTask.title, `expected selected thread to be "${firstTask.title}", got "${threadTitle}"`);

    const bodyHtml = await page
      .locator(".hall-message")
      .filter({ hasText: "Coq-每日新闻" })
      .locator(".hall-message-body")
      .first()
      .innerHTML();
    assert(bodyHtml.includes("<br>"), "expected seeded hall message to render <br> tags");
    assert(bodyHtml.includes("hall-md-mention"), "expected seeded hall message to render mention highlight");

    await page.locator(`[data-task-card-id="${eighthTask.taskCardId}"]`).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector("[data-hall-thread-title]")?.textContent?.trim() === expectedTitle,
      eighthTask.title,
      { timeout: PAGE_TIMEOUT_MS },
    );
    await page.waitForSelector("[data-hall-plan-order]", { timeout: PAGE_TIMEOUT_MS });
    await page.locator("[data-hall-plan-order]").click();
    await page.waitForSelector(".hall-decision-card--planner.is-empty", { timeout: PAGE_TIMEOUT_MS });
    const emptyPlannerMetrics = await page.evaluate(() => {
      const empty = document.querySelector(".hall-order-empty") as HTMLElement | null;
      const save = document.querySelector("[data-hall-order-save]") as HTMLElement | null;
      const cancel = document.querySelector("[data-hall-order-cancel]") as HTMLElement | null;
      const chips = Array.from(document.querySelectorAll(".hall-order-chip")).slice(0, 3) as HTMLElement[];
      return {
        emptyHeight: empty?.getBoundingClientRect().height ?? 0,
        saveHeight: save?.getBoundingClientRect().height ?? 0,
        cancelHeight: cancel?.getBoundingClientRect().height ?? 0,
        chipHeights: chips.map((chip) => chip.getBoundingClientRect().height),
      };
    });
    assert(emptyPlannerMetrics.emptyHeight < 90, `expected empty planner callout to stay compact, got ${JSON.stringify(emptyPlannerMetrics)}`);
    assert(emptyPlannerMetrics.saveHeight < 48, `expected empty planner save button to stay compact, got ${JSON.stringify(emptyPlannerMetrics)}`);
    assert(emptyPlannerMetrics.cancelHeight < 48, `expected empty planner cancel button to stay compact, got ${JSON.stringify(emptyPlannerMetrics)}`);
    assert(
      emptyPlannerMetrics.chipHeights.every((height) => height < 56),
      `expected available-agent chips to stay compact in empty planner, got ${JSON.stringify(emptyPlannerMetrics)}`,
    );
    await page.locator("[data-hall-order-cancel]").click();
    await page.waitForSelector(".hall-decision-card--planner", { state: "hidden", timeout: PAGE_TIMEOUT_MS });

    await page.locator(`[data-task-card-id="${secondTask.taskCardId}"]`).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector("[data-hall-thread-title]")?.textContent?.trim() === expectedTitle,
      secondTask.title,
      { timeout: PAGE_TIMEOUT_MS },
    );

    await page.locator("[data-hall-compose-task]").click();
    await page.waitForFunction(
      () => document.querySelector("[data-hall-send-reply]")?.textContent?.trim() === "创建任务",
      undefined,
      { timeout: PAGE_TIMEOUT_MS },
    );
    const flashText = (await page.locator("[data-hall-flash]").textContent())?.trim() || "";
    assert(flashText.includes("写下新任务后直接按 Enter 创建"), `unexpected composer flash text: ${flashText}`);

    await page.locator(`[data-task-card-id="${thirdTask.taskCardId}"]`).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector("[data-hall-thread-title]")?.textContent?.trim() === expectedTitle,
      thirdTask.title,
      { timeout: PAGE_TIMEOUT_MS },
    );
    await page.waitForFunction(
      () => {
        const panel = document.querySelector("[data-hall-decision-panel]");
        return !!panel && !panel.hidden && !!panel.querySelector("[data-hall-current-console]");
      },
      undefined,
      { timeout: PAGE_TIMEOUT_MS },
    );
    const thirdTaskConsolePlacement = await page.evaluate(() => {
      const thread = document.querySelector("[data-hall-thread]");
      const panel = document.querySelector("[data-hall-decision-panel]");
      return {
        threadHasConsole: !!thread?.querySelector("[data-hall-current-console]"),
        panelHasConsole: !!panel?.querySelector("[data-hall-current-console]"),
        panelHidden: !!(panel && panel.hidden),
      };
    });
    assert(!thirdTaskConsolePlacement.threadHasConsole, "expected the current console to stay out of the message timeline");
    assert(thirdTaskConsolePlacement.panelHasConsole, "expected the current console to render in the bottom decision panel");
    assert(!thirdTaskConsolePlacement.panelHidden, "expected the bottom decision panel to stay visible for a selected task");
    const restartLabel = (await page.locator("[data-hall-start-execution]").first().textContent())?.trim() || "";
    assert(restartLabel.includes("开始执行（"), `expected a restart execution button on queued review thread, got "${restartLabel}"`);

    await page.locator(`[data-task-card-id="${fourthTask.taskCardId}"]`).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector("[data-hall-thread-title]")?.textContent?.trim() === expectedTitle,
      fourthTask.title,
      { timeout: PAGE_TIMEOUT_MS },
    );
    await page.locator("[data-hall-continue-discussion]").first().click();
    await page.waitForTimeout(1200);
    await page.locator("[data-hall-plan-order]").click();
    await page.waitForSelector("[data-hall-order-save]", { timeout: PAGE_TIMEOUT_MS });
    const taskEditor = page.locator("[data-hall-item-task='otter']").first();
    await taskEditor.focus();
    await taskEditor.fill("按新的方向开第三轮第一棒，并把结果贴回大厅。");
    await page.waitForTimeout(4500);
    const taskEditorState = await taskEditor.evaluate((node) => ({
      value: (node instanceof HTMLTextAreaElement ? node.value : ""),
      focused: document.activeElement === node,
    }));
    assert(taskEditorState.focused, "expected task editor to keep focus while background polling continues");
    assert(
      taskEditorState.value.includes("按新的方向开第三轮第一棒"),
      `expected task editor value to survive polling, got "${taskEditorState.value}"`,
    );
    await page.locator("[data-hall-order-add='pandas']").click();
    await page.locator("[data-hall-order-save]").click();
    await page.waitForTimeout(2600);
    const postSaveStartLabel = (await page.locator("[data-hall-start-execution]").first().textContent())?.trim() || "";
    assert(postSaveStartLabel.includes("开始执行（"), `expected start execution button after saving a replanned round, got "${postSaveStartLabel}"`);
    const selectedCardTextAfterSave = (await page.locator(`[data-task-card-id="${fourthTask.taskCardId}"]`).innerText())?.trim() || "";
    assert(
      !selectedCardTextAfterSave.includes("main · 执行中"),
      `expected saved replanned round to stop showing stale executing state in the selected task card, got "${selectedCardTextAfterSave}"`,
    );

    await page.locator(`[data-task-card-id="${fifthTask.taskCardId}"]`).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector("[data-hall-thread-title]")?.textContent?.trim() === expectedTitle,
      fifthTask.title,
      { timeout: PAGE_TIMEOUT_MS },
    );
    const repoThreadText = (await page.locator("[data-hall-thread]").innerText())?.trim() || "";
    assert(repoThreadText.includes("src/ui/collaboration-hall.ts"), "expected repo-scan result to keep pandas file-path output visible");
    assert(repoThreadText.includes("src/runtime/collaboration-hall-orchestrator.ts"), "expected repo-scan result to show orchestrator file path");
    assert(repoThreadText.includes("src/runtime/hall-runtime-dispatch.ts"), "expected repo-scan result to show dispatch file path");
    assert(!repoThreadText.includes("Handoff moved to pandas"), "expected repo-scan thread to avoid wrong handoff warning");
    const pandasVisibleMessage = page
      .locator(".hall-message[data-kind='status']")
      .filter({ hasText: "src/ui/collaboration-hall.ts" })
      .locator(".hall-message-body")
      .first();
    const pandasVisibleText = (await pandasVisibleMessage.innerText())?.trim() || "";
    assert(pandasVisibleText.includes("src/ui/collaboration-hall.ts"), "expected pandas repo-scan reply to keep the UI file path visible");
    assert(
      pandasVisibleText.includes("src/runtime/collaboration-hall-orchestrator.ts"),
      "expected pandas repo-scan reply to keep the orchestrator file path visible",
    );
    assert(
      pandasVisibleText.includes("src/runtime/hall-runtime-dispatch.ts"),
      "expected pandas repo-scan reply to keep the dispatch file path visible",
    );
    assert(!pandasVisibleText.includes("…"), "expected pandas repo-scan reply to stay visible instead of collapsing to an ellipsis");

    await page.locator(`[data-task-card-id="${sixthTask.taskCardId}"]`).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector("[data-hall-thread-title]")?.textContent?.trim() === expectedTitle,
      sixthTask.title,
      { timeout: PAGE_TIMEOUT_MS },
    );
    const supportOnlyThreadText = (await page.locator("[data-hall-thread]").innerText())?.trim() || "";
    assert(
      supportOnlyThreadText.includes("support-only 和 next action 串成一个可见的任务推进线程"),
      "expected support-only summary line to remain visible in the thread",
    );
    assert(
      supportOnlyThreadText.includes("@main 你接着按这句写 3 个 hook。"),
      "expected support-only execution result to keep the @main handoff line visible",
    );

    await page.locator(`[data-task-card-id="${seventhTask.taskCardId}"]`).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector("[data-hall-thread-title]")?.textContent?.trim() === expectedTitle,
      seventhTask.title,
      { timeout: PAGE_TIMEOUT_MS },
    );
    await page.locator("[data-hall-plan-order]").click();
    await page.waitForSelector(".hall-decision-card--planner", { timeout: PAGE_TIMEOUT_MS });
    const plannerLayoutState = await page.evaluate(() => {
      const composer = document.querySelector(".hall-composer-shell") as HTMLElement | null;
      const thread = document.querySelector(".hall-thread") as HTMLElement | null;
      const decisionPanel = document.querySelector("[data-hall-decision-panel]") as HTMLElement | null;
      return {
        composerDisplay: composer ? getComputedStyle(composer).display : null,
        threadDisplay: thread ? getComputedStyle(thread).display : null,
        decisionOverflow: decisionPanel ? getComputedStyle(decisionPanel).overflowY : null,
      };
    });
    assert(plannerLayoutState.composerDisplay === "none", `expected composer to be hidden while planning, got ${JSON.stringify(plannerLayoutState)}`);
    assert(plannerLayoutState.threadDisplay === "none", `expected thread timeline to be hidden while planning, got ${JSON.stringify(plannerLayoutState)}`);
    const plannerMetricsBefore = await page.evaluate(() => {
      const planner = document.querySelector(".hall-decision-card--planner") as HTMLElement | null;
      return {
        scrollTop: planner?.scrollTop ?? 0,
        clientHeight: planner?.clientHeight ?? 0,
        scrollHeight: planner?.scrollHeight ?? 0,
      };
    });
    assert(
      plannerMetricsBefore.scrollHeight > plannerMetricsBefore.clientHeight,
      `expected long execution planner to overflow vertically, got ${JSON.stringify(plannerMetricsBefore)}`,
    );
    await page.locator(".hall-decision-card--planner").hover();
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(500);
    const plannerMetricsAfter = await page.evaluate(() => {
      const planner = document.querySelector(".hall-decision-card--planner") as HTMLElement | null;
      return {
        scrollTop: planner?.scrollTop ?? 0,
        clientHeight: planner?.clientHeight ?? 0,
        scrollHeight: planner?.scrollHeight ?? 0,
      };
    });
    assert(
      plannerMetricsAfter.scrollTop > plannerMetricsBefore.scrollTop,
      `expected planner card to scroll after wheel, got before=${JSON.stringify(plannerMetricsBefore)} after=${JSON.stringify(plannerMetricsAfter)}`,
    );

    assert(pageErrors.length === 0, `pageerror(s): ${pageErrors.join(" | ")}`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const seeded = await seedRuntime();
  const child = startServer();
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const cleanup = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    rmSync(RUNTIME_DIR, { recursive: true, force: true });
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await waitForServer(baseUrl);
    await runBrowserSmoke(baseUrl, seeded.firstTask, seeded.secondTask, seeded.thirdTask, seeded.fourthTask, seeded.fifthTask, seeded.sixthTask, seeded.seventhTask, seeded.eighthTask);
    console.log(`Hall release smoke passed on ${baseUrl}`);
  } catch (error) {
    console.error("Hall release smoke failed.");
    console.error(stdout.trim());
    console.error(stderr.trim());
    throw error;
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
