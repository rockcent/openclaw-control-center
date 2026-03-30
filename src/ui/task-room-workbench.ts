import type { UiLanguage } from "../runtime/ui-preferences";
import type { ChatMessage, ChatRoom, ChatRoomSummary, ProjectTask, RoomParticipantRole } from "../types";

interface TaskRoomViewModel {
  room: ChatRoom;
  summary?: ChatRoomSummary;
  task?: ProjectTask;
}

export interface RenderTaskRoomWorkbenchInput {
  language: UiLanguage;
  rooms: TaskRoomViewModel[];
  selectedRoom?: ChatRoom;
  selectedMessages?: ChatMessage[];
  selectedSummary?: ChatRoomSummary;
  selectedTask?: ProjectTask;
}

export function renderTaskRoomWorkbench(input: RenderTaskRoomWorkbenchInput): string {
  const t = (en: string, zh: string) => pickUiText(input.language, en, zh);
  const selectedRoom = input.selectedRoom;
  const selectedSummary = input.selectedSummary;
  const selectedTask = input.selectedTask;
  const selectedMessages = input.selectedMessages ?? [];
  const bootstrap = {
    selectedRoomId: selectedRoom?.roomId,
    rooms: input.rooms.map((item) => ({
      roomId: item.room.roomId,
      title: item.room.title,
      stage: item.room.stage,
      ownerRole: item.room.ownerRole,
      assignedExecutor: item.room.assignedExecutor,
      updatedAt: item.room.updatedAt,
      summary: item.summary?.headline,
      taskId: item.room.taskId,
    })),
    labels: {
      emptyRooms: t("No task rooms yet.", "还没有任务房间。"),
      noMessages: t("No room messages yet.", "当前还没有房间消息。"),
      send: t("Send", "发送"),
      assign: t("Assign executor", "指定执行者"),
      approve: t("Approve", "通过"),
      reject: t("Request changes", "打回修改"),
      loading: t("Loading room…", "正在加载房间…"),
      stage: t("Stage", "阶段"),
      owner: t("Owner", "当前负责"),
      executor: t("Executor", "执行者"),
      task: t("Task", "任务"),
      summary: t("Summary", "摘要"),
      participants: t("Participants", "参与者"),
      openQuestions: t("Open questions", "未决问题"),
      roomThread: t("Room timeline", "房间时间线"),
      runtimeEvidence: t("Runtime evidence is merged into this timeline when session links exist.", "只要房间里挂了会话，运行证据会自动并到这条时间线上。"),
      needToken: t("This action requires LOCAL_API_TOKEN.", "这个动作需要 LOCAL_API_TOKEN。"),
      tokenPrompt: t("Enter LOCAL_API_TOKEN to continue.", "请输入 LOCAL_API_TOKEN 以继续。"),
      tokenRetryPrompt: t("The local token was rejected. Enter LOCAL_API_TOKEN again to retry.", "本地令牌验证失败，请重新输入 LOCAL_API_TOKEN 以重试。"),
      assignNote: t("Optional handoff note", "可选交接备注"),
      rejectNote: t("Why should it change?", "为什么要打回？"),
      approveNote: t("Optional review note", "可选审核备注"),
      composerLabel: t("Post as operator", "以操作员身份发言"),
      inputPlaceholder: t("Describe the task, ask for a plan, or post execution feedback…", "描述任务、请求方案，或者补充执行反馈…"),
    },
    language: input.language,
  };

  return `
    <section class="card task-room-hub" id="task-room-hub" data-task-room-root>
      <style>
        .task-room-hub { overflow: hidden; }
        .task-room-layout { display: grid; grid-template-columns: minmax(220px, 0.95fr) minmax(0, 1.7fr) minmax(240px, 1fr); gap: 14px; margin-top: 14px; }
        .task-room-pane { border: 1px solid rgba(22, 86, 116, 0.12); border-radius: 18px; padding: 14px; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,250,255,0.95)); min-height: 420px; }
        .task-room-sidebar { display: grid; gap: 10px; align-content: start; }
        .task-room-list { display: grid; gap: 8px; max-height: 620px; overflow: auto; }
        .task-room-item { width: 100%; border: 1px solid rgba(15, 82, 120, 0.12); border-radius: 14px; background: rgba(255,255,255,0.92); padding: 10px 12px; text-align: left; cursor: pointer; color: #11354b; }
        .task-room-item.is-selected { border-color: rgba(15, 109, 179, 0.35); box-shadow: 0 8px 18px rgba(15, 109, 179, 0.12); background: linear-gradient(180deg, rgba(244,250,255,0.98), rgba(255,255,255,0.98)); }
        .task-room-item strong { display: block; font-size: 13px; }
        .task-room-item .meta { margin-top: 4px; font-size: 11px; }
        .task-room-stage-chip { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; font-size: 11px; border: 1px solid rgba(15,82,120,0.14); background: rgba(244,249,255,0.9); color: #1c5471; }
        .task-room-thread { display: grid; gap: 10px; max-height: 560px; overflow: auto; padding-right: 4px; }
        .task-room-message { border: 1px solid rgba(22, 86, 116, 0.1); border-radius: 16px; padding: 10px 12px; background: rgba(255,255,255,0.96); }
        .task-room-message[data-kind="decision"] { border-color: rgba(22, 128, 95, 0.22); background: rgba(240, 252, 247, 0.96); }
        .task-room-message[data-kind="handoff"] { border-color: rgba(180, 124, 15, 0.22); background: rgba(255, 249, 235, 0.96); }
        .task-room-message[data-kind="result"] { border-color: rgba(15, 109, 179, 0.22); background: rgba(241, 248, 255, 0.97); }
        .task-room-message-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; margin-bottom: 6px; }
        .task-room-message-head strong { font-size: 13px; color: #12344a; }
        .task-room-message-copy { white-space: pre-wrap; line-height: 1.5; color: #16364a; font-size: 13px; }
        .task-room-payload { margin-top: 8px; display: grid; gap: 5px; font-size: 12px; color: #496173; }
        .task-room-compose { display: grid; gap: 10px; margin-top: 14px; }
        .task-room-compose textarea { width: 100%; min-height: 92px; resize: vertical; border-radius: 14px; border: 1px solid rgba(22, 86, 116, 0.16); padding: 10px 12px; font: inherit; background: rgba(255,255,255,0.97); }
        .task-room-compose-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .task-room-compose-actions button, .task-room-compose-actions .task-room-secondary { border-radius: 999px; padding: 8px 12px; border: 1px solid rgba(15, 82, 120, 0.14); background: rgba(255,255,255,0.96); cursor: pointer; font: inherit; color: #124a68; }
        .task-room-compose-actions button[type="submit"] { background: linear-gradient(180deg, rgba(14, 111, 173, 0.95), rgba(11, 96, 150, 0.98)); color: #fff; border-color: rgba(11, 96, 150, 0.6); }
        .task-room-detail-list, .task-room-question-list { display: grid; gap: 8px; margin: 0; padding-left: 18px; }
        .task-room-stat-grid { display: grid; gap: 8px; margin-bottom: 12px; }
        .task-room-stat { border: 1px solid rgba(22, 86, 116, 0.1); border-radius: 14px; padding: 10px; background: rgba(255,255,255,0.94); }
        .task-room-flash { min-height: 18px; font-size: 12px; color: #496173; }
        .task-room-empty { border: 1px dashed rgba(22, 86, 116, 0.18); border-radius: 16px; padding: 18px; color: #5b6974; background: rgba(251, 253, 255, 0.95); }
        @media (max-width: 1080px) { .task-room-layout { grid-template-columns: 1fr; } .task-room-pane { min-height: 0; } }
      </style>
      <div class="overview-command-head">
        <div>
          <h2>${escapeHtml(t("Task room workbench", "任务房间工作台"))}</h2>
          <div class="meta">${escapeHtml(t("Run the MVP collaboration loop here: operator request, structured discussion, assignment, execution, and review.", "在这里跑通 MVP 协作闭环：操作员提需求、结构化讨论、指定执行、执行和审核。"))}</div>
        </div>
        <div class="task-room-stage-chip">${escapeHtml(selectedRoom ? stageLabel(selectedRoom.stage, input.language) : t("No room", "暂无房间"))}</div>
      </div>
      <div class="task-room-layout">
        <aside class="task-room-pane task-room-sidebar">
          <div class="meta">${escapeHtml(t("One task per room. Pick a room to inspect the full timeline.", "一个任务一个房间。点左边房间，就能看完整时间线。"))}</div>
          <div class="task-room-list" data-task-room-list>${renderRoomList(input.rooms, selectedRoom?.roomId, input.language)}</div>
        </aside>
        <section class="task-room-pane">
          <div class="overview-command-head">
            <div>
              <h3 style="margin:0;">${escapeHtml(t("Room timeline", "房间时间线"))}</h3>
              <div class="meta">${escapeHtml(t("Runtime evidence is merged into this timeline when session links exist.", "只要房间里挂了会话，运行证据会自动并到这条时间线上。"))}</div>
            </div>
          </div>
          <div class="task-room-thread" data-task-room-thread>${renderMessageThread(selectedMessages, input.language)}</div>
          <form class="task-room-compose" data-task-room-compose>
            <label for="task-room-input">${escapeHtml(t("Post as operator", "以操作员身份发言"))}</label>
            <textarea id="task-room-input" name="content" placeholder="${escapeHtml(t("Describe the task, ask for a plan, or post execution feedback…", "描述任务、请求方案，或者补充执行反馈…"))}" ${selectedRoom ? "" : "disabled"}></textarea>
            <div class="task-room-compose-actions">
              <button type="submit" ${selectedRoom ? "" : "disabled"}>${escapeHtml(t("Send", "发送"))}</button>
              <button type="button" class="task-room-secondary" data-task-room-assign ${selectedRoom ? "" : "disabled"}>${escapeHtml(t("Assign executor", "指定执行者"))}</button>
              <button type="button" class="task-room-secondary" data-task-room-approve ${selectedRoom ? "" : "disabled"}>${escapeHtml(t("Approve", "通过"))}</button>
              <button type="button" class="task-room-secondary" data-task-room-reject ${selectedRoom ? "" : "disabled"}>${escapeHtml(t("Request changes", "打回修改"))}</button>
            </div>
            <div class="task-room-flash" data-task-room-flash></div>
          </form>
        </section>
        <aside class="task-room-pane" data-task-room-detail>${renderRoomDetail(selectedRoom, selectedSummary, selectedTask, input.language)}</aside>
      </div>
      <script type="application/json" id="task-room-bootstrap">${safeJsonForScript(bootstrap)}</script>
    </section>
  `;
}

export function renderTaskRoomClientScript(language: UiLanguage): string {
  const labels = {
    loading: pickUiText(language, "Loading room…", "正在加载房间…"),
    emptyRooms: pickUiText(language, "No task rooms yet.", "还没有任务房间。"),
    noMessages: pickUiText(language, "No room messages yet.", "当前还没有房间消息。"),
    error: pickUiText(language, "Room action failed.", "房间操作失败。"),
    assignNote: pickUiText(language, "Optional handoff note", "可选交接备注"),
    rejectNote: pickUiText(language, "Why should it change?", "为什么要打回？"),
    approveNote: pickUiText(language, "Optional review note", "可选审核备注"),
    needToken: pickUiText(language, "This action requires LOCAL_API_TOKEN.", "这个动作需要 LOCAL_API_TOKEN。"),
    tokenPrompt: pickUiText(language, "Enter LOCAL_API_TOKEN to continue.", "请输入 LOCAL_API_TOKEN 以继续。"),
    tokenRetryPrompt: pickUiText(language, "The local token was rejected. Enter LOCAL_API_TOKEN again to retry.", "本地令牌验证失败，请重新输入 LOCAL_API_TOKEN 以重试。"),
    stage: pickUiText(language, "Stage", "阶段"),
    owner: pickUiText(language, "Owner", "当前负责"),
    executor: pickUiText(language, "Executor", "执行者"),
    task: pickUiText(language, "Task", "任务"),
    summary: pickUiText(language, "Summary", "摘要"),
    participants: pickUiText(language, "Participants", "参与者"),
    openQuestions: pickUiText(language, "Open questions", "未决问题"),
  };

  return `<script>
(() => {
  const root = document.querySelector('[data-task-room-root]');
  if (!root) return;
  const bootstrapNode = document.getElementById('task-room-bootstrap');
  if (!(bootstrapNode instanceof HTMLScriptElement)) return;

  let bootstrap = { rooms: [], selectedRoomId: '', labels: {}, language: 'en' };
  try {
    bootstrap = JSON.parse(bootstrapNode.textContent || '{}');
  } catch {
    return;
  }

  const labels = Object.assign(${JSON.stringify(labels)}, bootstrap.labels || {});
  const roomList = root.querySelector('[data-task-room-list]');
  const thread = root.querySelector('[data-task-room-thread]');
  const detail = root.querySelector('[data-task-room-detail]');
  const compose = root.querySelector('[data-task-room-compose]');
  const flash = root.querySelector('[data-task-room-flash]');
  const input = root.querySelector('#task-room-input');
  const assignBtn = root.querySelector('[data-task-room-assign]');
  const approveBtn = root.querySelector('[data-task-room-approve]');
  const rejectBtn = root.querySelector('[data-task-room-reject]');
  const tokenKey = 'openclaw:local-api-token';
  const tokenHeader = ((document.body?.dataset?.localTokenHeader || 'x-local-token').trim() || 'x-local-token');
  const tokenGateRequired = (document.body?.dataset?.tokenRequired || '') === '1';
  let selectedRoomId = String(bootstrap.selectedRoomId || '');
  let roomMessages = [];
  let roomDrafts = new Map();
  let eventSource = null;
  let reloadTimer = 0;

  const esc = (value) => String(value || '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;' }[ch]));
  const stageLabel = (stage) => ({
    intake: ${JSON.stringify(pickUiText(language, "Intake", "收件"))},
    discussion: ${JSON.stringify(pickUiText(language, "Discussion", "讨论中"))},
    assigned: ${JSON.stringify(pickUiText(language, "Assigned", "已指派"))},
    executing: ${JSON.stringify(pickUiText(language, "Executing", "执行中"))},
    review: ${JSON.stringify(pickUiText(language, "Review", "审核中"))},
    completed: ${JSON.stringify(pickUiText(language, "Completed", "已完成"))},
  }[stage] || stage || '');
  const roleLabel = (role) => ({
    human: ${JSON.stringify(pickUiText(language, "Operator", "操作员"))},
    planner: 'Planner',
    coder: 'Coder',
    reviewer: 'Reviewer',
    manager: 'Manager',
  }[role] || role || '');
  const readToken = () => {
    try {
      return (window.localStorage.getItem(tokenKey) || '').trim();
    } catch {}
    return '';
  };
  const writeToken = (token) => {
    try { window.localStorage.setItem(tokenKey, token || ''); } catch {}
  };
  const clearToken = () => {
    try { window.localStorage.removeItem(tokenKey); } catch {}
  };
  const requestToken = (message) => {
    const next = typeof window.prompt === 'function'
      ? String(window.prompt(message || labels.needToken, '') || '').trim()
      : '';
    if (next) writeToken(next);
    return next;
  };
  const syncRoomUrl = (roomId) => {
    try {
      const url = new URL(window.location.href);
      if (roomId) url.searchParams.set('roomId', roomId);
      else url.searchParams.delete('roomId');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  };
  const ensureToken = (message) => {
    const stored = readToken();
    if (stored) return stored;
    return requestToken(message || labels.tokenPrompt || labels.needToken);
  };
  const setFlash = (message, tone = 'info') => {
    if (!flash) return;
    flash.textContent = message || '';
    flash.dataset.tone = tone;
  };

  const renderRoomList = (rooms) => {
    if (!roomList) return;
    if (!Array.isArray(rooms) || rooms.length === 0) {
      roomList.innerHTML = '<div class="task-room-empty">' + esc(labels.emptyRooms) + '</div>';
      return;
    }
    roomList.innerHTML = rooms.map((item) => {
      const selected = String(item.roomId || '') === selectedRoomId;
      return '<button type="button" class="task-room-item' + (selected ? ' is-selected' : '') + '" data-room-id="' + esc(item.roomId) + '">' +
        '<strong>' + esc(item.title || item.taskId || item.roomId) + '</strong>' +
        '<div class="meta"><span class="task-room-stage-chip">' + esc(stageLabel(item.stage)) + '</span></div>' +
        '<div class="meta">' + esc(item.summary || item.roomId || '') + '</div>' +
        '</button>';
    }).join('');
    roomList.querySelectorAll('[data-room-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const roomId = button.getAttribute('data-room-id') || '';
        if (!roomId) return;
        void loadRoom(roomId, true);
      });
    });
  };

  const renderMessages = (messages) => {
    if (!thread) return;
    if (!Array.isArray(messages) || messages.length === 0) {
      thread.innerHTML = '<div class="task-room-empty">' + esc(labels.noMessages) + '</div>';
      return;
    }
    thread.innerHTML = messages.map((message) => {
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : null;
      const payloadRows = [];
      if (payload && payload.decision) payloadRows.push('<div><strong>Decision:</strong> ' + esc(payload.decision) + '</div>');
      if (payload && payload.executor) payloadRows.push('<div><strong>Executor:</strong> ' + esc(roleLabel(payload.executor)) + '</div>');
      if (payload && payload.doneWhen) payloadRows.push('<div><strong>Done when:</strong> ' + esc(payload.doneWhen) + '</div>');
      if (payload && payload.reviewOutcome) payloadRows.push('<div><strong>Review:</strong> ' + esc(payload.reviewOutcome) + '</div>');
      if (message.isDraft) payloadRows.push('<div><strong>${escapeHtml(pickUiText(language, "Stream", "流式"))}:</strong> ${escapeHtml(pickUiText(language, "in progress", "进行中"))}</div>');
      return '<article class="task-room-message" data-kind="' + esc(message.kind || 'chat') + '">' +
        '<div class="task-room-message-head"><strong>' + esc(message.authorLabel || roleLabel(message.authorRole)) + ' · ' + esc(roleLabel(message.authorRole)) + '</strong>' +
        '<span class="meta">' + esc(message.createdAt || '') + '</span></div>' +
        '<div class="task-room-message-copy">' + esc(message.content || '') + '</div>' +
        (payloadRows.length ? '<div class="task-room-payload">' + payloadRows.join('') + '</div>' : '') +
        '</article>';
    }).join('');
    thread.scrollTop = thread.scrollHeight;
  };

  const draftMessages = () => Array.from(roomDrafts.values()).map((draft) => ({
    kind: draft.messageKind || 'chat',
    authorRole: draft.authorRole || 'manager',
    authorLabel: draft.authorLabel || roleLabel(draft.authorRole),
    content: draft.content || '',
    createdAt: draft.createdAt || '',
    payload: null,
    isDraft: true,
  }));

  const renderVisibleMessages = () => {
    const merged = [...roomMessages, ...draftMessages()]
      .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
    renderMessages(merged);
  };

  const renderDetail = (roomPayload, summaryPayload, taskPayload) => {
    if (!detail) return;
    if (!roomPayload) {
      detail.innerHTML = '<div class="task-room-empty">' + esc(labels.emptyRooms) + '</div>';
      return;
    }
    const participants = Array.isArray(roomPayload.participants) ? roomPayload.participants : [];
    const questions = Array.isArray(summaryPayload && summaryPayload.openQuestions) ? summaryPayload.openQuestions : [];
    detail.innerHTML =
      '<div class="task-room-stat-grid">' +
        '<div class="task-room-stat"><div class="meta">' + esc(labels.stage) + '</div><strong>' + esc(stageLabel(roomPayload.stage)) + '</strong></div>' +
        '<div class="task-room-stat"><div class="meta">' + esc(labels.owner) + '</div><strong>' + esc(roleLabel(roomPayload.ownerRole)) + '</strong></div>' +
        '<div class="task-room-stat"><div class="meta">' + esc(labels.executor) + '</div><strong>' + esc(roleLabel(roomPayload.assignedExecutor || '')) + '</strong></div>' +
      '</div>' +
      '<div class="meta">' + esc(labels.task) + '</div>' +
      '<div style="margin:4px 0 12px;"><strong>' + esc(taskPayload && taskPayload.title ? taskPayload.title : roomPayload.title || roomPayload.taskId) + '</strong><div class="meta">' + esc((taskPayload && taskPayload.taskId ? taskPayload.taskId : roomPayload.taskId) || '') + '</div></div>' +
      '<div class="meta">' + esc(labels.summary) + '</div>' +
      '<div style="margin:4px 0 12px;"><strong>' + esc(summaryPayload && summaryPayload.headline ? summaryPayload.headline : roomPayload.decision || roomPayload.proposal || roomPayload.title) + '</strong><div class="meta">' + esc(summaryPayload && summaryPayload.nextAction ? summaryPayload.nextAction : '') + '</div></div>' +
      '<div class="meta">' + esc(labels.participants) + '</div>' +
      '<ul class="task-room-detail-list">' + participants.map((participant) => '<li>' + esc(participant.label || roleLabel(participant.role)) + ' · ' + esc(roleLabel(participant.role)) + '</li>').join('') + '</ul>' +
      '<div class="meta" style="margin-top:12px;">' + esc(labels.openQuestions) + '</div>' +
      (questions.length
        ? '<ul class="task-room-question-list">' + questions.map((question) => '<li>' + esc(question) + '</li>').join('') + '</ul>'
        : '<div class="meta">-</div>');
  };

  const extractErrorMessage = (data) => {
    if (data && data.error && typeof data.error === 'object' && data.error.message) {
      return data.error.message;
    }
    return data && data.error && typeof data.error === 'string' ? data.error : labels.error;
  };
  const fetchJson = async (url, options = {}) => {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMessage = extractErrorMessage(data);
      throw new Error(errorMessage);
    }
    return data;
  };

  const reloadRooms = async () => {
    const data = await fetchJson('/api/rooms');
    bootstrap.rooms = Array.isArray(data.rooms)
      ? data.rooms.map((item) => ({
          roomId: item.roomId,
          title: item.title,
          stage: item.stage,
          ownerRole: item.ownerRole,
          assignedExecutor: item.assignedExecutor,
          updatedAt: item.updatedAt,
          summary: item.summary && item.summary.headline ? item.summary.headline : '',
          taskId: item.taskId,
        }))
      : [];
    renderRoomList(bootstrap.rooms);
  };

  const loadRoom = async (roomId, quiet = false) => {
    selectedRoomId = roomId;
    roomDrafts.clear();
    connectRoomStream(roomId);
    syncRoomUrl(roomId);
    renderRoomList(bootstrap.rooms);
    if (!quiet) setFlash(labels.loading);
    const [detailData, messageData] = await Promise.all([
      fetchJson('/api/rooms/' + encodeURIComponent(roomId)),
      fetchJson('/api/rooms/' + encodeURIComponent(roomId) + '/messages?limit=200&historyLimit=25'),
    ]);
    roomMessages = Array.isArray(messageData.messages) ? messageData.messages : [];
    renderVisibleMessages();
    renderDetail(detailData.room, detailData.summary, detailData.task);
    setFlash('');
  };

  const scheduleRoomReload = () => {
    if (!selectedRoomId) return;
    if (reloadTimer) window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      if (!selectedRoomId) return;
      void loadRoom(selectedRoomId, true).catch(() => {});
    }, 90);
  };

  const connectRoomStream = (roomId) => {
    if (!window.EventSource || !roomId) return;
    eventSource?.close?.();
    const source = new EventSource('/api/rooms/' + encodeURIComponent(roomId) + '/events');
    eventSource = source;
    source.addEventListener('collaboration', (rawEvent) => {
      let event;
      try {
        event = JSON.parse(rawEvent.data || '{}');
      } catch {
        return;
      }
      if (!event || event.scope !== 'room' || event.roomId !== roomId) return;
      if (event.type === 'draft_start' && event.draftId) {
        roomDrafts.set(event.draftId, {
          draftId: event.draftId,
          createdAt: event.createdAt || new Date().toISOString(),
          authorRole: event.authorRole || 'manager',
          authorLabel: event.authorLabel || roleLabel(event.authorRole || 'manager'),
          messageKind: event.messageKind || 'chat',
          content: '',
        });
        renderVisibleMessages();
        return;
      }
      if (event.type === 'draft_delta' && event.draftId) {
        const draft = roomDrafts.get(event.draftId);
        if (!draft) return;
        draft.content = (draft.content || '') + String(event.delta || '');
        roomDrafts.set(event.draftId, draft);
        renderVisibleMessages();
        return;
      }
      if (event.type === 'draft_complete' && event.draftId) {
        roomDrafts.delete(event.draftId);
        renderVisibleMessages();
        scheduleRoomReload();
        return;
      }
      if (event.type === 'invalidate') {
        scheduleRoomReload();
      }
    });
  };

  const mutateRoom = async (url, body) => {
    const requestOnce = async (token) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers[tokenHeader] = token;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
      });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    };
    if (!tokenGateRequired) {
      const { response, data } = await requestOnce('');
      if (!response.ok) throw new Error(extractErrorMessage(data));
      return data;
    }
    let token = ensureToken(labels.tokenPrompt);
    if (!token) throw new Error(labels.needToken);
    let { response, data } = await requestOnce(token);
    if (response.status === 401) {
      clearToken();
      token = requestToken(labels.tokenRetryPrompt || labels.tokenPrompt || labels.needToken);
      if (!token) throw new Error(labels.needToken);
      ({ response, data } = await requestOnce(token));
    }
    if (!response.ok) throw new Error(extractErrorMessage(data));
    return data;
  };

  if (compose instanceof HTMLFormElement && input instanceof HTMLTextAreaElement) {
    compose.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!selectedRoomId) return;
      const content = input.value.trim();
      if (!content) return;
      try {
        setFlash(labels.loading);
        await mutateRoom('/api/rooms/' + encodeURIComponent(selectedRoomId) + '/messages', {
          authorRole: 'human',
          content,
        });
        input.value = '';
        await reloadRooms();
        scheduleRoomReload();
        setFlash('');
      } catch (error) {
        setFlash(error instanceof Error ? error.message : labels.error, 'warn');
      }
    });
  }

  if (assignBtn instanceof HTMLButtonElement) {
    assignBtn.addEventListener('click', async () => {
      if (!selectedRoomId) return;
      try {
        const note = '';
        setFlash(labels.loading);
        await mutateRoom('/api/rooms/' + encodeURIComponent(selectedRoomId) + '/assign', { note });
        await reloadRooms();
        scheduleRoomReload();
        setFlash('');
      } catch (error) {
        setFlash(error instanceof Error ? error.message : labels.error, 'warn');
      }
    });
  }

  if (approveBtn instanceof HTMLButtonElement) {
    approveBtn.addEventListener('click', async () => {
      if (!selectedRoomId) return;
      try {
        const note = '';
        setFlash(labels.loading);
        await mutateRoom('/api/rooms/' + encodeURIComponent(selectedRoomId) + '/review', {
          outcome: 'approved',
          note,
        });
        await reloadRooms();
        scheduleRoomReload();
        setFlash('');
      } catch (error) {
        setFlash(error instanceof Error ? error.message : labels.error, 'warn');
      }
    });
  }

  if (rejectBtn instanceof HTMLButtonElement) {
    rejectBtn.addEventListener('click', async () => {
      if (!selectedRoomId) return;
      try {
        const note = '';
        setFlash(labels.loading);
        await mutateRoom('/api/rooms/' + encodeURIComponent(selectedRoomId) + '/review', {
          outcome: 'rejected',
          note,
        });
        await reloadRooms();
        scheduleRoomReload();
        setFlash('');
      } catch (error) {
        setFlash(error instanceof Error ? error.message : labels.error, 'warn');
      }
    });
  }

  renderRoomList(bootstrap.rooms);
  if (selectedRoomId) {
    void loadRoom(selectedRoomId, true).catch((error) => {
      setFlash(error instanceof Error ? error.message : labels.error, 'warn');
    });
    connectRoomStream(selectedRoomId);
    window.addEventListener('beforeunload', () => {
      if (reloadTimer) window.clearTimeout(reloadTimer);
      eventSource?.close?.();
    }, { once: true });
  } else {
    renderMessages([]);
    renderDetail(null, null, null);
  }
})();
</script>`;
}

export function renderTaskRoomWorkbenchForSmoke(language: UiLanguage = "zh"): string {
  const sampleRoom: ChatRoom = {
    roomId: "project-a:task-room",
    projectId: "project-a",
    taskId: "task-room",
    title: "Task room MVP",
    stage: "discussion",
    ownerRole: "planner",
    assignedExecutor: "coder",
    participants: [
      { participantId: "human", role: "human", label: "Operator", active: true },
      { participantId: "planner", role: "planner", label: "Planner", active: true },
      { participantId: "coder", role: "coder", label: "Coder", active: true },
      { participantId: "reviewer", role: "reviewer", label: "Reviewer", active: true },
      { participantId: "manager", role: "manager", label: "Manager", active: true },
    ],
    handoffs: [],
    sessionKeys: [],
    proposal: "Plan the room workflow.",
    decision: "Assign the coder after the manager decision.",
    doneWhen: "The room API, UI, and review flow all work.",
    createdAt: "2026-03-19T10:00:00.000Z",
    updatedAt: "2026-03-19T10:05:00.000Z",
    lastMessageAt: "2026-03-19T10:05:00.000Z",
  };

  return renderTaskRoomWorkbench({
    language,
    rooms: [
      {
        room: sampleRoom,
        summary: {
          roomId: sampleRoom.roomId,
          headline: "Manager is collecting the final decision.",
          currentOwner: "planner",
          nextAction: "Let the manager choose the executor.",
          openQuestions: ["Who should execute first?"],
          messageCount: 4,
          updatedAt: sampleRoom.updatedAt,
        },
        task: {
          projectId: "project-a",
          taskId: "task-room",
          title: "Task room MVP",
          status: "todo",
          owner: "operator",
          roomId: sampleRoom.roomId,
          definitionOfDone: ["Room API works", "UI timeline works"],
          artifacts: [],
          rollback: { strategy: "manual", steps: [] },
          sessionKeys: [],
          budget: {},
          updatedAt: sampleRoom.updatedAt,
        },
      },
    ],
    selectedRoom: sampleRoom,
    selectedMessages: [
      {
        roomId: sampleRoom.roomId,
        messageId: "m1",
        kind: "chat",
        authorRole: "human",
        authorLabel: "Operator",
        content: "Build the task room MVP in control-center.",
        mentions: [],
        createdAt: "2026-03-19T10:01:00.000Z",
      },
      {
        roomId: sampleRoom.roomId,
        messageId: "m2",
        kind: "decision",
        authorRole: "manager",
        authorLabel: "Manager",
        content: "Use the room-first plan and move execution to Coder.",
        mentions: [],
        payload: {
          decision: "Use the room-first plan.",
          executor: "coder",
          doneWhen: "API and UI both work.",
        },
        createdAt: "2026-03-19T10:05:00.000Z",
      },
    ],
    selectedSummary: {
      roomId: sampleRoom.roomId,
      headline: "Manager is collecting the final decision.",
      currentOwner: "planner",
      nextAction: "Let the manager choose the executor.",
      openQuestions: ["Who should execute first?"],
      messageCount: 4,
      updatedAt: sampleRoom.updatedAt,
    },
    selectedTask: {
      projectId: "project-a",
      taskId: "task-room",
      title: "Task room MVP",
      status: "todo",
      owner: "operator",
      roomId: sampleRoom.roomId,
      definitionOfDone: ["Room API works", "UI timeline works"],
      artifacts: [],
      rollback: { strategy: "manual", steps: [] },
      sessionKeys: [],
      budget: {},
      updatedAt: sampleRoom.updatedAt,
    },
  });
}

function renderRoomList(
  rooms: TaskRoomViewModel[],
  selectedRoomId: string | undefined,
  language: UiLanguage,
): string {
  if (rooms.length === 0) {
    return `<div class="task-room-empty">${escapeHtml(pickUiText(language, "No task rooms yet.", "还没有任务房间。"))}</div>`;
  }

  return rooms
    .map(({ room, summary }) => {
      const selected = room.roomId === selectedRoomId;
      return `<button type="button" class="task-room-item${selected ? " is-selected" : ""}" data-room-id="${escapeHtml(room.roomId)}">
        <strong>${escapeHtml(room.title)}</strong>
        <div class="meta"><span class="task-room-stage-chip">${escapeHtml(stageLabel(room.stage, language))}</span></div>
        <div class="meta">${escapeHtml(summary?.headline ?? room.roomId)}</div>
      </button>`;
    })
    .join("");
}

function renderMessageThread(messages: ChatMessage[], language: UiLanguage): string {
  if (messages.length === 0) {
    return `<div class="task-room-empty">${escapeHtml(pickUiText(language, "No room messages yet.", "当前还没有房间消息。"))}</div>`;
  }

  return messages
    .map((message) => {
      const payloadRows: string[] = [];
      if (message.payload?.decision) {
        payloadRows.push(`<div><strong>Decision:</strong> ${escapeHtml(message.payload.decision)}</div>`);
      }
      if (message.payload?.executor) {
        payloadRows.push(`<div><strong>Executor:</strong> ${escapeHtml(roleLabel(message.payload.executor, language))}</div>`);
      }
      if (message.payload?.doneWhen) {
        payloadRows.push(`<div><strong>Done when:</strong> ${escapeHtml(message.payload.doneWhen)}</div>`);
      }
      return `<article class="task-room-message" data-kind="${escapeHtml(message.kind)}">
        <div class="task-room-message-head">
          <strong>${escapeHtml(message.authorLabel)} · ${escapeHtml(roleLabel(message.authorRole, language))}</strong>
          <span class="meta">${escapeHtml(message.createdAt)}</span>
        </div>
        <div class="task-room-message-copy">${escapeHtml(message.content)}</div>
        ${payloadRows.length > 0 ? `<div class="task-room-payload">${payloadRows.join("")}</div>` : ""}
      </article>`;
    })
    .join("");
}

function renderRoomDetail(
  room: ChatRoom | undefined,
  summary: ChatRoomSummary | undefined,
  task: ProjectTask | undefined,
  language: UiLanguage,
): string {
  if (!room) {
    return `<div class="task-room-empty">${escapeHtml(pickUiText(language, "Pick a room to inspect the task timeline.", "点一个房间，就能查看任务时间线。"))}</div>`;
  }

  const questions = summary?.openQuestions ?? [];
  return `
    <div class="task-room-stat-grid">
      <div class="task-room-stat"><div class="meta">${escapeHtml(pickUiText(language, "Stage", "阶段"))}</div><strong>${escapeHtml(stageLabel(room.stage, language))}</strong></div>
      <div class="task-room-stat"><div class="meta">${escapeHtml(pickUiText(language, "Owner", "当前负责"))}</div><strong>${escapeHtml(roleLabel(room.ownerRole, language))}</strong></div>
      <div class="task-room-stat"><div class="meta">${escapeHtml(pickUiText(language, "Executor", "执行者"))}</div><strong>${escapeHtml(roleLabel(room.assignedExecutor, language))}</strong></div>
    </div>
    <div class="meta">${escapeHtml(pickUiText(language, "Task", "任务"))}</div>
    <div style="margin:4px 0 12px;">
      <strong>${escapeHtml(task?.title ?? room.title)}</strong>
      <div class="meta">${escapeHtml(task?.taskId ?? room.taskId)}</div>
    </div>
    <div class="meta">${escapeHtml(pickUiText(language, "Summary", "摘要"))}</div>
    <div style="margin:4px 0 12px;">
      <strong>${escapeHtml(summary?.headline ?? room.decision ?? room.proposal ?? room.title)}</strong>
      <div class="meta">${escapeHtml(summary?.nextAction ?? "-")}</div>
    </div>
    <div class="meta">${escapeHtml(pickUiText(language, "Participants", "参与者"))}</div>
    <ul class="task-room-detail-list">${room.participants
      .map((participant) => `<li>${escapeHtml(participant.label)} · ${escapeHtml(roleLabel(participant.role, language))}</li>`)
      .join("")}</ul>
    <div class="meta" style="margin-top:12px;">${escapeHtml(pickUiText(language, "Open questions", "未决问题"))}</div>
    ${
      questions.length > 0
        ? `<ul class="task-room-question-list">${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul>`
        : `<div class="meta">-</div>`
    }
  `;
}

function stageLabel(stage: ChatRoom["stage"], language: UiLanguage): string {
  const labels: Record<ChatRoom["stage"], string> = {
    intake: pickUiText(language, "Intake", "收件"),
    discussion: pickUiText(language, "Discussion", "讨论中"),
    assigned: pickUiText(language, "Assigned", "已指派"),
    executing: pickUiText(language, "Executing", "执行中"),
    review: pickUiText(language, "Review", "审核中"),
    completed: pickUiText(language, "Completed", "已完成"),
  };
  return labels[stage] ?? stage;
}

function roleLabel(role: RoomParticipantRole | undefined, language: UiLanguage): string {
  if (!role) return "-";
  const labels: Record<RoomParticipantRole, string> = {
    human: pickUiText(language, "Operator", "操作员"),
    planner: "Planner",
    coder: "Coder",
    reviewer: "Reviewer",
    manager: "Manager",
  };
  return labels[role];
}

function pickUiText(language: UiLanguage, en: string, zh: string): string {
  return language === "zh" ? zh : en;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
}
