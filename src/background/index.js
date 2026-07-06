import { DEFAULT_GROUP_COLOUR } from "../shared/constants.js";
import { findMatchingGroup } from "../shared/matching.js";
import {
  getGroups,
  getSettings,
  migrateStorage,
  recordStats
} from "../shared/storage.js";

const AUTO_ORGANISE_ALARM_PREFIX = "auto-organise-window-";
const TAB_SYNC_RETRY_DELAYS_MS = [0, 150, 400, 900];

function getAutoOrganiseAlarmName(windowId) {
  return `${AUTO_ORGANISE_ALARM_PREFIX}${windowId}`;
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

function scheduleTabGroupSync(tabId, delays = TAB_SYNC_RETRY_DELAYS_MS) {
  if (tabId == null) {
    return;
  }

  for (const delayMs of delays) {
    setTimeout(() => {
      syncTabGroupForTab(tabId).catch(() => {});
    }, delayMs);
  }
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
    if (!tab.id || !tab.url || tab.pinned) {
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
  let tabsGrouped = 0;

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

    tabsGrouped += entry.tabIds.length;
  }

  await recordStats({
    mode,
    scope,
    tabsGrouped,
    duplicateGroupsResolved
  });
}

async function organiseAllWindows(mode = "manual") {
  const windows = await chrome.windows.getAll({});
  for (const windowInfo of windows) {
    await organiseWindow(windowInfo.id, mode, "all");
  }
}

async function scheduleAutoOrganise(windowId) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const settings = await getSettings();
  if (!settings.autoOrganise) {
    return;
  }

  const alarmName = getAutoOrganiseAlarmName(windowId);
  await chrome.alarms.clear(alarmName);
  if (settings.autoOrganiseDelayMs <= 0) {
    organiseWindow(windowId, "auto", "current").catch(() => {});
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

async function refreshAutoOrganiseSchedules() {
  const settings = await getSettings();

  if (!settings.autoOrganise) {
    await clearAutoOrganiseAlarms();
    return;
  }

  const windows = await chrome.windows.getAll({});
  await Promise.all(windows.map((windowInfo) => scheduleAutoOrganise(windowInfo.id)));
}

function addAutoListeners() {
  chrome.tabs.onCreated.addListener((tab) => {
    scheduleAutoOrganise(tab.windowId);
    scheduleTabGroupSync(tab.id);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      scheduleTabGroupSync(tabId);
      scheduleAutoOrganise(tab.windowId);
    }
  });
  chrome.tabs.onMoved.addListener((tabId, moveInfo) => scheduleAutoOrganise(moveInfo.windowId));
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!removeInfo.isWindowClosing) {
      scheduleAutoOrganise(removeInfo.windowId);
    }
  });
  chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    scheduleTabGroupSync(tabId);
    scheduleAutoOrganise(attachInfo.newWindowId);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(AUTO_ORGANISE_ALARM_PREFIX)) {
      return;
    }

    const windowId = Number(alarm.name.slice(AUTO_ORGANISE_ALARM_PREFIX.length));
    if (Number.isNaN(windowId)) {
      return;
    }

    organiseWindow(windowId, "auto", "current").catch(() => {});
  });
}

chrome.runtime.onInstalled.addListener(() => {
  migrateStorage();
});

chrome.runtime.onStartup.addListener(() => {
  migrateStorage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) {
    return;
  }

  refreshAutoOrganiseSchedules().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "organiseCurrent") {
    chrome.windows.getCurrent({}, async (windowInfo) => {
      await organiseWindow(windowInfo.id, "manual", "current");
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
