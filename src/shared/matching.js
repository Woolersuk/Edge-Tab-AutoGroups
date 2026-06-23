import { MATCH_TYPES } from "./constants.js";

function normalisePatternValue(value) {
  return String(value || "").trim();
}

export function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function hostnameMatches(hostname, pattern) {
  const cleanPattern = normalisePatternValue(pattern).replace(/^\*\./, "");
  if (!cleanPattern) {
    return false;
  }

  return hostname === cleanPattern || hostname.endsWith(`.${cleanPattern}`);
}

export function patternMatches(url, pattern) {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return false;
  }

  const matchType = pattern?.type || MATCH_TYPES.HOSTNAME;
  const value = normalisePatternValue(pattern?.value ?? pattern);
  if (!value) {
    return false;
  }

  if (matchType === MATCH_TYPES.HOSTNAME) {
    return hostnameMatches(parsedUrl.hostname, value);
  }

  if (matchType === MATCH_TYPES.URL) {
    return url === value;
  }

  if (matchType === MATCH_TYPES.CONTAINS) {
    return url.toLowerCase().includes(value.toLowerCase());
  }

  return false;
}

export function findMatchingGroup(url, groups) {
  return groups.find((group) =>
    (group.patterns || []).some((pattern) => patternMatches(url, pattern))
  );
}
