/*
 * Sent in Threads
 *
 * Thunderbird only threads the messages that live in the folder being viewed,
 * so your own replies (stored in "Sent") never show up in the Inbox threads.
 * This extension places a copy of each sent reply in the folder(s) holding the
 * message it replies to, so the thread pane shows the whole conversation.
 */

const DEFAULTS = { autoOnSend: true, backfillDays: 90 };

// Folders that must never receive copies of sent messages.
const EXCLUDED_USES = new Set(["sent", "drafts", "templates", "outbox", "trash", "junk"]);

const MENU_THREAD = "sent-in-threads-thread";
const MENU_FOLDER = "sent-in-threads-folder";
const COPY_BATCH = 50;

const t = (key, subs) => messenger.i18n.getMessage(key, subs);

let busy = false;

// ---------------------------------------------------------------- helpers ---

async function getOptions() {
  return { ...DEFAULTS, ...(await messenger.storage.local.get(Object.keys(DEFAULTS))) };
}

function notify(message) {
  return messenger.notifications.create({
    type: "basic",
    title: t("notifyTitle"),
    message,
    iconUrl: messenger.runtime.getURL("icons/icon.svg"),
  });
}

/** Collects every message of a (possibly paginated) MessageList. */
async function collect(listPromise) {
  let page = await listPromise;
  const all = [...page.messages];
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    all.push(...page.messages);
  }
  return all;
}

const queryAll = (info) => collect(messenger.messages.query(info));

/** "Re: Fwd: RE[2]: Hello" -> "hello" */
function normalizeSubject(subject) {
  return (subject || "")
    .replace(/^\s*((re|fw|fwd|rv|res|aw|wg|sv|vs|tr|enc|antw)(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Extracts the "<id@host>" tokens of a header value, without brackets. */
function parseMessageIds(values) {
  const ids = [];
  for (const v of values || []) {
    for (const m of v.matchAll(/<([^<>\s]+)>/g)) ids.push(m[1]);
  }
  return ids;
}

/**
 * Message-IDs this message replies to, closest ancestor first:
 * In-Reply-To, then References from last to first.
 */
async function getParentIds(messageId) {
  const full = await messenger.messages.getFull(messageId, {
    decodeHeaders: true,
    decodeContent: false,
  });
  const h = full.headers || {};
  const ids = [...parseMessageIds(h["in-reply-to"]), ...parseMessageIds(h["references"]).reverse()];
  return [...new Set(ids)];
}

function isEligibleFolder(folder) {
  if (!folder || folder.isVirtual || folder.isUnified || folder.isTag || folder.isRoot) return false;
  return !(folder.specialUse || []).some((u) => EXCLUDED_USES.has(u));
}

async function folderHasMessage(folderId, headerMessageId) {
  const found = await queryAll({ folderId, headerMessageId });
  return found.length > 0;
}

async function copyInBatches(ids, folderId) {
  for (let i = 0; i < ids.length; i += COPY_BATCH) {
    await messenger.messages.copy(ids.slice(i, i + COPY_BATCH), folderId);
  }
}

async function getSentFolderIds() {
  const folders = await messenger.folders.query({ specialUse: ["sent"] });
  return folders.map((f) => f.id);
}

// ------------------------------------------------- automatic, on sending ---

/**
 * Copies a just-sent message next to its closest ancestor that lives in a
 * regular folder (Inbox, project folders, archives…).
 */
async function placeSentMessage(sent) {
  const parents = await getParentIds(sent.id);
  for (const parentId of parents) {
    const hits = await queryAll({ headerMessageId: parentId });
    const targets = new Map();
    for (const m of hits) {
      if (isEligibleFolder(m.folder)) targets.set(m.folder.id, m.folder);
    }
    if (!targets.size) continue; // e.g. we replied to our own sent message: go one level up

    for (const folder of targets.values()) {
      if (!(await folderHasMessage(folder.id, sent.headerMessageId))) {
        await messenger.messages.copy([sent.id], folder.id);
      }
    }
    return;
  }
}

messenger.compose.onAfterSend.addListener(async (tab, sendInfo) => {
  try {
    if (sendInfo.error || sendInfo.mode !== "sendNow") return;
    if (!(await getOptions()).autoOnSend) return;
    // sendInfo.messages are the copies stored in the Sent folder(s); we only need one.
    const sent = (sendInfo.messages || []).find((m) => !isEligibleFolder(m.folder)) || sendInfo.messages?.[0];
    if (sent) await placeSentMessage(sent);
  } catch (e) {
    console.error("Sent in Threads: failed to place sent message", e);
  }
});

// ------------------------------------------------- manual, for old mail ---

/**
 * Copies into `folder` every sent message replying (directly, or through one
 * of your own earlier replies) to a message already in `folder`.
 *
 * @param {object} folder           Target MailFolder.
 * @param {object} opts
 * @param {Date}   [opts.fromDate]  Only consider sent messages since this date.
 * @param {Set}    [opts.subjects]  Only consider sent messages with these normalized subjects.
 * @returns {Promise<number>} number of messages copied.
 */
async function backfillFolder(folder, { fromDate, subjects } = {}) {
  const inFolder = await queryAll({ folderId: folder.id });
  const known = new Set(inFolder.map((m) => m.headerMessageId));
  const wanted = subjects || new Set(inFolder.map((m) => normalizeSubject(m.subject)));
  wanted.delete("");

  const sentFolderIds = await getSentFolderIds();
  if (!sentFolderIds.length || !wanted.size) return 0;

  let candidates;
  if (subjects) {
    // Narrow search per subject: cheap, and needs no date limit.
    const byId = new Map();
    for (const s of subjects) {
      for (const m of await queryAll({ folderId: sentFolderIds, subject: s })) byId.set(m.id, m);
    }
    candidates = [...byId.values()];
  } else {
    candidates = await queryAll({ folderId: sentFolderIds, fromDate });
  }

  // Oldest first, so a reply to one of your own replies finds its parent already added.
  candidates.sort((a, b) => new Date(a.date) - new Date(b.date));

  const toCopy = [];
  for (const sent of candidates) {
    if (known.has(sent.headerMessageId)) continue;
    if (!wanted.has(normalizeSubject(sent.subject))) continue;
    let parents;
    try {
      parents = await getParentIds(sent.id);
    } catch (e) {
      console.warn("Sent in Threads: cannot read headers of", sent.id, e);
      continue;
    }
    if (parents.some((p) => known.has(p))) {
      toCopy.push(sent.id);
      known.add(sent.headerMessageId);
    }
  }

  await copyInBatches(toCopy, folder.id);
  return toCopy.length;
}

async function runExclusive(task) {
  if (busy) {
    await notify(t("notifyBusy"));
    return;
  }
  busy = true;
  try {
    await task();
  } catch (e) {
    console.error("Sent in Threads:", e);
    await notify(t("notifyError", [String(e?.message || e)]));
  } finally {
    busy = false;
  }
}

async function reportResult(folder, count) {
  await notify(count ? t("notifyDone", [String(count), folder.name]) : t("notifyNone", [folder.name]));
}

async function onThreadMenu(info) {
  const selected = info.selectedMessages ? await collect(Promise.resolve(info.selectedMessages)) : [];
  // Group by the real folder of each message (works in unified folders too).
  const groups = new Map();
  for (const m of selected) {
    if (!isEligibleFolder(m.folder)) continue;
    const g = groups.get(m.folder.id) || { folder: m.folder, subjects: new Set() };
    g.subjects.add(normalizeSubject(m.subject));
    groups.set(m.folder.id, g);
  }
  if (!groups.size) {
    await notify(t("notifyIneligible"));
    return;
  }
  for (const { folder, subjects } of groups.values()) {
    const count = await backfillFolder(folder, { subjects });
    await reportResult(folder, count);
  }
}

async function onFolderMenu(info) {
  const folders = info.selectedFolders || [];
  const days = (await getOptions()).backfillDays;
  const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000);
  for (const folder of folders) {
    if (!isEligibleFolder(folder)) {
      await notify(t("notifyIneligible"));
      continue;
    }
    await notify(t("notifyWorking", [folder.name]));
    const count = await backfillFolder(folder, { fromDate });
    await reportResult(folder, count);
  }
}

// ------------------------------------------------------------------ menus ---

messenger.runtime.onInstalled.addListener(() => {
  messenger.menus.create({ id: MENU_THREAD, title: t("menuThread"), contexts: ["message_list"] });
  messenger.menus.create({ id: MENU_FOLDER, title: t("menuFolder"), contexts: ["folder_pane"] });
});

messenger.menus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_THREAD) return runExclusive(() => onThreadMenu(info));
  if (info.menuItemId === MENU_FOLDER) return runExclusive(() => onFolderMenu(info));
});
