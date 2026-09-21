import { DEFAULT_GROUP_COLOUR } from "../shared/constants.js";
import { findMatchingGroup } from "../shared/matching.js";
import {
  getGroups,
  getSettings,
  migrateStorage,
  recordStats
} from "../shared/storage.js";

const AUTO_ORGANISE_ALARM_PREFIX = "auto-organise-window-";
const ORGANISE_HEARTBEAT_ALARM = "organise-heartbeat";
const ORGANISE_HEARTBEAT_PERIOD_MINUTES = 1;
const SESSION_STATE_STORAGE_KEY = "sessionState";
const DIRTY_WINDOWS_STORAGE_KEY = "dirtyWindows";
const MAX_DIRTY_WINDOWS = 32;
const MAX_ORGANISE_WINDOWS_PER_HEARTBEAT = 5;

const organisingWindows = new Set();
let mutatingTabs = false;

function isTabInSplitView(tab) {
  const splitViewNoneId = Number.isInteger(chrome.tabs?.SPLIT_VIEW_ID_NONE)
    ? chrome.tabs.SPLIT_VIEW_ID_NONE
    : -1;

  return Number.isInteger(tab?.splitViewId) && tab.splitViewId !== splitViewNoneId;
}

function getAutoOrganiseAlarmName(windowId) {
  return `${AUTO_ORGANISE_ALARM_PREFIX}${windowId}`;
}

function shouldResyncTabOnUpdate(changeInfo) {
  return (
    changeInfo.url != null ||
    changeInfo.status === "complete" ||
    changeInfo.splitViewId != null
  );
}

async function findOrCreateNamedGroup(windowId, groupName, colour, tabId) {
  const existingGroups = await chrome.tabGroups.query({ windowId });
  const matchedGroup = existingGroups.find((group) => group.title === groupName) || null;

  if (matchedGroup?.id != null) {
    await chrome.tabGroups.update(matchedGroup.id, {
      title: groupName,
      color: colour || DEFAULT_GROUP_COLOUR
    });
    return matchedGroup.id;
  }

  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, {
    title: groupName,
    color: colour || DEFAULT_GROUP_COLOUR
  });
  return groupId;
}

async function syncTabGroupForTab(tabId) {
  if (tabId == null) {
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  if (!tab?.id || !tab.url || tab.pinned || tab.windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  if (isTabInSplitView(tab)) {
    return;
  }

  const groups = await getGroups();
  const matchedRuleGroup = findMatchingGroup(tab.url, groups);

  if (!matchedRuleGroup) {
    if (tab.groupId != null && tab.groupId >= 0) {
      await chrome.tabs.ungroup(tab.id);
    }
    return;
  }

  const targetGroupId = await findOrCreateNamedGroup(
    tab.windowId,
    matchedRuleGroup.name,
    matchedRuleGroup.color,
    tab.id
  );

  if (tab.groupId !== targetGroupId) {
    await chrome.tabs.group({
      groupId: targetGroupId,
      tabIds: [tab.id]
    });
  }

  await chrome.tabGroups.update(targetGroupId, {
    title: matchedRuleGroup.name,
    color: matchedRuleGroup.color || DEFAULT_GROUP_COLOUR
  });
}

async function getDirtyWindows() {
  const result = await chrome.storage.session.get(DIRTY_WINDOWS_STORAGE_KEY);
  const windows = result[DIRTY_WINDOWS_STORAGE_KEY];
  return Array.isArray(windows) ? windows : [];
}

async function markWindowDirty(windowId) {
  if (mutatingTabs || windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const dirtyWindows = await getDirtyWindows();
  if (dirtyWindows.includes(windowId)) {
    return;
  }

  dirtyWindows.push(windowId);
  if (dirtyWindows.length > MAX_DIRTY_WINDOWS) {
    dirtyWindows.splice(0, dirtyWindows.length - MAX_DIRTY_WINDOWS);
  }
  await chrome.storage.session.set({ [DIRTY_WINDOWS_STORAGE_KEY]: dirtyWindows });
}

async function clearDirtyWindow(windowId) {
  const dirtyWindows = await getDirtyWindows();
  const next = dirtyWindows.filter((id) => id !== windowId);
  if (next.length !== dirtyWindows.length) {
    await chrome.storage.session.set({ [DIRTY_WINDOWS_STORAGE_KEY]: next });
  }
}

async function clearAllDirtyWindows() {
  await chrome.storage.session.remove(DIRTY_WINDOWS_STORAGE_KEY);
}

async function mergeDuplicateGroups(windowId, groupsByName) {
  const existingGroups = await chrome.tabGroups.query({ windowId });
  let duplicateGroupsResolved = 0;

  for (const [name, desiredGroup] of groupsByName.entries()) {
    const namedGroups = existingGroups
      .filter((group) => group.title === name)
      .sort((left, right) => left.id - right.id);

    if (namedGroups.length === 0) {
      continue;
    }

    const primary = namedGroups[0];
    const duplicates = namedGroups.slice(1);
    const duplicateIds = duplicates.map((group) => group.id);

    for (const duplicate of duplicates) {
      const tabs = await chrome.tabs.query({
        windowId,
        groupId: duplicate.id
      });

      if (tabs.length > 0) {
        await chrome.tabs.group({
          groupId: primary.id,
          tabIds: tabs.map((tab) => tab.id)
        });
      }
    }

    await chrome.tabGroups.update(primary.id, {
      title: name,
      color: desiredGroup.group?.color || DEFAULT_GROUP_COLOUR
    });

    if (duplicateIds.length > 0) {
      duplicateGroupsResolved += duplicateIds.length;
    }
  }

  return duplicateGroupsResolved;
}

async function organiseWindow(windowId, mode = "manual", scope = "current") {
  const groups = await getGroups();
  const tabs = await chrome.tabs.query({ windowId });
  const groupedTabs = new Map();
  const unmatchedGroupedTabIds = [];
  const tabIndexById = new Map(
    tabs
      .filter((tab) => tab.id != null)
      .map((tab) => [tab.id, tab.index])
  );

  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.pinned || isTabInSplitView(tab)) {
      continue;
    }

    const group = findMatchingGroup(tab.url, groups);
    if (!group) {
      if (tab.groupId != null && tab.groupId >= 0) {
        unmatchedGroupedTabIds.push(tab.id);
      }
      continue;
    }

    if (!groupedTabs.has(group.name)) {
      groupedTabs.set(group.name, {
        group,
        tabIds: []
      });
    }

    groupedTabs.get(group.name).tabIds.push(tab.id);
  }

  mutatingTabs = true;
  try {
    if (unmatchedGroupedTabIds.length > 0) {
      await chrome.tabs.ungroup(unmatchedGroupedTabIds);
    }

    const duplicateGroupsResolved = await mergeDuplicateGroups(windowId, groupedTabs);
    const orderedEntries = [...groupedTabs.entries()].sort((left, right) => {
      const orderDifference = (left[1].group.order || 0) - (right[1].group.order || 0);
      if (orderDifference !== 0) {
        return orderDifference;
      }

      return left[1].group.name.localeCompare(right[1].group.name);
    });

    const orderedTabIds = orderedEntries.flatMap(([, entry]) => entry.tabIds);
    if (orderedTabIds.length > 0) {
      const anchorIndex = Math.min(
        ...orderedTabIds
          .map((tabId) => tabIndexById.get(tabId))
          .filter((index) => Number.isInteger(index))
      );

      if (Number.isInteger(anchorIndex)) {
        let targetIndex = anchorIndex;
        for (const [, entry] of orderedEntries) {
          await chrome.tabs.move(entry.tabIds, {
            windowId,
            index: targetIndex
          });
          targetIndex += entry.tabIds.length;
        }
      }
    }

    const existingGroups = await chrome.tabGroups.query({ windowId });

    for (const [name, entry] of orderedEntries) {
      const matchedGroup =
        existingGroups.find((tabGroup) => tabGroup.title === name) || null;

      let groupId = matchedGroup?.id;
      if (groupId == null) {
        groupId = await chrome.tabs.group({
          tabIds: [entry.tabIds[0]]
        });
      }

      await chrome.tabGroups.update(groupId, {
        title: name,
        color: entry.group.color || DEFAULT_GROUP_COLOUR
      });

      await chrome.tabs.group({
        groupId,
        tabIds: entry.tabIds
      });

      await chrome.tabGroups.update(groupId, {
        title: name,
        color: entry.group.color || DEFAULT_GROUP_COLOUR
      });
    }

    await recordStats({
      mode,
      scope,
      tabsGrouped: orderedTabIds.length,
      duplicateGroupsResolved
    });
  } finally {
    mutatingTabs = false;
  }
}

async function runOrganiseWindow(windowId, mode = "manual", scope = "current") {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  if (organisingWindows.has(windowId)) {
    return;
  }

  organisingWindows.add(windowId);
  try {
    await organiseWindow(windowId, mode, scope);
  } catch {
    // Ignore: a window may close mid-organise.
  } finally {
    organisingWindows.delete(windowId);
  }
}

async function organiseAllWindows(mode = "manual") {
  const windows = await chrome.windows.getAll({});
  await Promise.allSettled(
    windows.map((windowInfo) => runOrganiseWindow(windowInfo.id, mode, "all"))
  );
}

async function processDirtyWindows() {
  const settings = await getSettings();
  if (!settings.autoOrganise) {
    await clearAllDirtyWindows();
    return;
  }

  const dirtyWindows = await getDirtyWindows();
  if (dirtyWindows.length === 0) {
    return;
  }

  const toOrganise = dirtyWindows.slice(0, MAX_ORGANISE_WINDOWS_PER_HEARTBEAT);
  const remaining = dirtyWindows.slice(toOrganise.length);
  await chrome.storage.session.set({ [DIRTY_WINDOWS_STORAGE_KEY]: remaining });

  await Promise.allSettled(
    toOrganise.map((windowId) => runOrganiseWindow(windowId, "auto", "current"))
  );
}

async function scheduleAutoOrganise(windowId) {
  if (mutatingTabs || windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const settings = await getSettings();
  if (!settings.autoOrganise) {
    return;
  }

  const alarmName = getAutoOrganiseAlarmName(windowId);
  await chrome.alarms.clear(alarmName);
  if (settings.autoOrganiseDelayMs <= 0) {
    await runOrganiseWindow(windowId, "auto", "current");
    return;
  }

  chrome.alarms.create(alarmName, {
    when: Date.now() + settings.autoOrganiseDelayMs
  });
}

async function clearAutoOrganiseAlarms() {
  const alarms = await chrome.alarms.getAll();
  await Promise.all(
    alarms
      .filter((alarm) => alarm.name.startsWith(AUTO_ORGANISE_ALARM_PREFIX))
      .map((alarm) => chrome.alarms.clear(alarm.name))
  );
}

function ensureOrganiseHeartbeat() {
  chrome.alarms.create(ORGANISE_HEARTBEAT_ALARM, {
    delayInMinutes: ORGANISE_HEARTBEAT_PERIOD_MINUTES,
    periodInMinutes: ORGANISE_HEARTBEAT_PERIOD_MINUTES
  });
}

async function refreshAutoOrganiseSchedules() {
  const settings = await getSettings();

  if (!settings.autoOrganise) {
    await clearAutoOrganiseAlarms();
    await clearAllDirtyWindows();
    return;
  }

  ensureOrganiseHeartbeat();
  const windows = await chrome.windows.getAll({});
  await Promise.all(windows.map((windowInfo) => scheduleAutoOrganise(windowInfo.id)));
}

function addAutoListeners() {
  chrome.tabs.onCreated.addListener((tab) => {
    scheduleAutoOrganise(tab.windowId).catch(() => {});
    markWindowDirty(tab.windowId).catch(() => {});
    syncTabGroupForTab(tab.id).catch(() => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (shouldResyncTabOnUpdate(changeInfo)) {
      syncTabGroupForTab(tabId).catch(() => {});
      scheduleAutoOrganise(tab.windowId).catch(() => {});
      markWindowDirty(tab.windowId).catch(() => {});
    }
  });
  chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    scheduleAutoOrganise(moveInfo.windowId).catch(() => {});
    markWindowDirty(moveInfo.windowId).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!removeInfo.isWindowClosing) {
      scheduleAutoOrganise(removeInfo.windowId).catch(() => {});
      markWindowDirty(removeInfo.windowId).catch(() => {});
    }
  });
  chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    syncTabGroupForTab(tabId).catch(() => {});
    scheduleAutoOrganise(attachInfo.newWindowId).catch(() => {});
    markWindowDirty(attachInfo.newWindowId).catch(() => {});
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ORGANISE_HEARTBEAT_ALARM) {
      processDirtyWindows().catch(() => {});
      return;
    }

    if (!alarm.name.startsWith(AUTO_ORGANISE_ALARM_PREFIX)) {
      return;
    }

    const windowId = Number(alarm.name.slice(AUTO_ORGANISE_ALARM_PREFIX.length));
    if (Number.isNaN(windowId)) {
      return;
    }

    runOrganiseWindow(windowId, "auto", "current").then(
      () => clearDirtyWindow(windowId),
      () => {}
    );
  });
}

function initialiseFreshStart() {
  migrateStorage()
    .then(() => refreshAutoOrganiseSchedules())
    .catch(() => {});
}

async function initialiseOnWake() {
  try {
    await migrateStorage();

    const sessionState = await chrome.storage.session.get(SESSION_STATE_STORAGE_KEY);
    if (sessionState[SESSION_STATE_STORAGE_KEY]) {
      await processDirtyWindows();
      return;
    }

    await chrome.storage.session.set({ [SESSION_STATE_STORAGE_KEY]: true });
    await refreshAutoOrganiseSchedules();
    await processDirtyWindows();
  } catch {
    // Best-effort initialisation; events and the heartbeat will retry.
  }
}

chrome.runtime.onInstalled.addListener(initialiseFreshStart);
chrome.runtime.onStartup.addListener(initialiseFreshStart);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) {
    return;
  }

  refreshAutoOrganiseSchedules().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "organiseCurrent") {
    chrome.windows.getCurrent({}, async (windowInfo) => {
      await runOrganiseWindow(windowInfo.id, "manual", "current");
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.action === "organiseAll") {
    organiseAllWindows("manual").then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === "getTabGroupDiagnostics") {
    chrome.windows.getCurrent({}, async (windowInfo) => {
      const tabGroups = await chrome.tabGroups.query({ windowId: windowInfo.id });
      const diagnostics = tabGroups
        .sort((left, right) => left.id - right.id)
        .map((group) => ({
          id: group.id,
          title: group.title || "",
          color: group.color,
          collapsed: Boolean(group.collapsed)
        }));

      sendResponse({ ok: true, windowId: windowInfo.id, groups: diagnostics });
    });
    return true;
  }

  if (message.action === "refreshAutoOrganise") {
    refreshAutoOrganiseSchedules().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

addAutoListeners();
initialiseOnWake();