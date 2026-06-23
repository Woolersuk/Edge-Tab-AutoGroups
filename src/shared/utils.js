export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function createGroupId(name, fallbackIndex = 0) {
  const slug = slugify(name) || `group-${fallbackIndex + 1}`;
  return slug;
}

export function createPatternId(groupId, index) {
  return `${groupId}-pattern-${index + 1}`;
}

export function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

export function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
