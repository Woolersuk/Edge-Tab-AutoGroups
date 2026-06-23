import {
  DEFAULT_AUTO_ORGANISE_DELAY_MS,
  DEFAULT_GROUP_COLOUR,
  MAX_AUTO_ORGANISE_DELAY_MS,
  MIN_AUTO_ORGANISE_DELAY_MS,
  DEFAULT_SETTINGS,
  GROUP_COLOURS,
  GROUPS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  STATS_STORAGE_KEY
} from "./constants.js";
import { createGroupId, createPatternId } from "./utils.js";

function ensureUniqueId(baseId, usedIds) {
  let candidate = baseId;
  let counter = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${counter}`;
    counter += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function normalisePattern(pattern, groupId, index) {
  if (typeof pattern === "string") {
    return {
      id: createPatternId(groupId, index),
      type: "hostname",
      value: pattern.trim()
    };
  }

  return {
    id: pattern?.id || createPatternId(groupId, index),
    type: pattern?.type || "hostname",
    value: String(pattern?.value || "").trim()
  };
}

function normaliseGroup(group, index, usedIds) {
  const name = String(group?.name || group?.groupName || "").trim();
  const baseId = createGroupId(group?.id || name, index);
  const id = ensureUniqueId(baseId, usedIds);

  return {
    id,
    name,
    color: normaliseGroupColor(group?.color || group?.colour || DEFAULT_GROUP_COLOUR),
    colorLabel: group?.colorLabel ? String(group.colorLabel).trim() : "",
    order: Number.isFinite(group?.order)
      ? group.order
      : Number.isFinite(group?.priority)
        ? group.priority
        : index + 1,
    patterns: (group?.patterns || [])
      .map((pattern, patternIndex) => normalisePattern(pattern, id, patternIndex))
      .filter((pattern) => pattern.value)
  };
}

function normaliseStats(stats = {}) {
  return {
    totalRuns: Number(stats.totalRuns || 0),
    autoRuns: Number(stats.autoRuns || 0),
    manualRuns: Number(stats.manualRuns || 0),
    tabsGrouped: Number(stats.tabsGrouped || 0),
    duplicateGroupsResolved: Number(stats.duplicateGroupsResolved || 0),
    lastRunAt: stats.lastRunAt || null,
    lastRunScope: stats.lastRunScope || null
  };
}

function normaliseDelay(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_AUTO_ORGANISE_DELAY_MS;
  }

  return Math.min(
    MAX_AUTO_ORGANISE_DELAY_MS,
    Math.max(MIN_AUTO_ORGANISE_DELAY_MS, Math.round(numericValue))
  );
}

function normaliseGroupColor(value) {
  return GROUP_COLOURS.includes(value) ? value : DEFAULT_GROUP_COLOUR;
}

export async function getGroups() {
  const result = await chrome.storage.sync.get(GROUPS_STORAGE_KEY);
  const rawGroups = result[GROUPS_STORAGE_KEY] || [];
  const usedIds = new Set();
  const groups = rawGroups.map((group, index) => normaliseGroup(group, index, usedIds));
  groups.sort((left, right) => left.order - right.order);
  return groups;
}

export async function saveGroups(groups) {
  const usedIds = new Set();
  const normalised = groups.map((group, index) => normaliseGroup(group, index, usedIds));
  normalised.sort((left, right) => left.order - right.order);
  await chrome.storage.sync.set({ [GROUPS_STORAGE_KEY]: normalised });
  return normalised;
}

export async function getSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
  const rawSettings = {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_STORAGE_KEY] || {})
  };

  return {
    ...rawSettings,
    autoOrganiseDelayMs: normaliseDelay(rawSettings.autoOrganiseDelayMs)
  };
}

export async function saveSettings(settings) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(settings || {})
  };

  const normalised = {
    ...merged,
    autoOrganiseDelayMs: normaliseDelay(merged.autoOrganiseDelayMs)
  };

  await chrome.storage.sync.set({
    [SETTINGS_STORAGE_KEY]: normalised
  });

  return normalised;
}

export async function getStats() {
  const result = await chrome.storage.local.get(STATS_STORAGE_KEY);
  return normaliseStats(result[STATS_STORAGE_KEY]);
}

export async function recordStats(update) {
  const current = await getStats();
  const next = normaliseStats({
    ...current,
    ...update,
    totalRuns: current.totalRuns + 1,
    autoRuns: current.autoRuns + (update.mode === "auto" ? 1 : 0),
    manualRuns: current.manualRuns + (update.mode === "manual" ? 1 : 0),
    tabsGrouped: current.tabsGrouped + Number(update.tabsGrouped || 0),
    duplicateGroupsResolved:
      current.duplicateGroupsResolved + Number(update.duplicateGroupsResolved || 0),
    lastRunAt: new Date().toISOString(),
    lastRunScope: update.scope || current.lastRunScope
  });

  await chrome.storage.local.set({
    [STATS_STORAGE_KEY]: next
  });

  return next;
}

export async function migrateStorage() {
  const [groups, settings] = await Promise.all([getGroups(), getSettings()]);
  await Promise.all([saveGroups(groups), saveSettings(settings)]);
}
