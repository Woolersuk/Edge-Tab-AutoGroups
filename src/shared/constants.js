export const GROUPS_STORAGE_KEY = "groups";
export const SETTINGS_STORAGE_KEY = "settings";
export const STATS_STORAGE_KEY = "stats";

export const DEFAULT_GROUP_COLOUR = "blue";
export const DEFAULT_AUTO_ORGANISE_DELAY_MS = 2000;
export const MIN_AUTO_ORGANISE_DELAY_MS = 0;
export const MAX_AUTO_ORGANISE_DELAY_MS = 30000;

export const DEFAULT_SETTINGS = {
  autoOrganise: false,
  autoOrganiseDelayMs: DEFAULT_AUTO_ORGANISE_DELAY_MS,
  darkMode: "system"
};

export const MATCH_TYPES = {
  HOSTNAME: "hostname",
  URL: "url",
  CONTAINS: "contains"
};

export const GROUP_COLOURS = [
  "blue",
  "green",
  "red",
  "yellow",
  "pink",
  "purple",
  "cyan",
  "orange",
  "grey"
];
