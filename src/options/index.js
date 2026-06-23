import {
  DEFAULT_AUTO_ORGANISE_DELAY_MS,
  MATCH_TYPES
} from "../shared/constants.js";
import { patternMatches } from "../shared/matching.js";
import { getGroups, getSettings, saveGroups, saveSettings } from "../shared/storage.js";
import { createGroupId, downloadJson } from "../shared/utils.js";

const state = {
  groups: [],
  settings: null
};

const elements = {
  groups: document.getElementById("groups"),
  addGroup: document.getElementById("addGroup"),
  saveGroups: document.getElementById("saveGroups"),
  organiseCurrent: document.getElementById("organiseCurrent"),
  organiseAll: document.getElementById("organiseAll"),
  exportJson: document.getElementById("exportJson"),
  importJson: document.getElementById("importJson"),
  importFile: document.getElementById("importFile"),
  inspectColours: document.getElementById("inspectColours"),
  diagnosticsOutput: document.getElementById("diagnosticsOutput"),
  autoOrganise: document.getElementById("autoOrganise"),
  autoRefreshDelayMs: document.getElementById("autoRefreshDelayMs"),
  autoRefreshDelayValue: document.getElementById("autoRefreshDelayValue"),
  darkMode: document.getElementById("darkMode"),
  savePreferences: document.getElementById("savePreferences"),
  testerUrl: document.getElementById("testerUrl"),
  testerResults: document.getElementById("testerResults"),
  runTester: document.getElementById("runTester"),
  saveStatus: document.getElementById("saveStatus")
};

const EDGE_GROUP_COLOURS = {
  grey: { light: "#5F6368", dark: "#DADCE0" },
  blue: { light: "#1A73E8", dark: "#8AB4F8" },
  red: { light: "#D93025", dark: "#F28B82" },
  yellow: { light: "#E37400", dark: "#FDD663" },
  green: { light: "#1E8E3E", dark: "#81C784" },
  pink: { light: "#D01716", dark: "#EF8BCB" },
  purple: { light: "#9333EA", dark: "#D7AEFB" },
  cyan: { light: "#018786", dark: "#4EE2D6" },
  orange: { light: "#FA7B17", dark: "#FFB04C" }
};

const EDGE_COLOUR_OPTIONS = [
  { value: "blue", label: "Blue" },
  { value: "pink", label: "Pink" },
  { value: "purple", label: "Purple" },
  { value: "red", label: "Violet" },
  { value: "green", label: "Royal Blue" },
  { value: "cyan", label: "Teal" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "grey", label: "Grey" }
];

function getDefaultEdgeLabel(colour) {
  return EDGE_COLOUR_OPTIONS.find((option) => option.value === colour)?.label || colour;
}

function getThemeMode() {
  const theme = document.documentElement.dataset.theme || "system";
  if (theme === "dark") {
    return "dark";
  }
  if (theme === "light") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getEdgeColourHex(colour) {
  const palette = EDGE_GROUP_COLOURS[colour] || EDGE_GROUP_COLOURS.blue;
  return palette[getThemeMode()];
}

function closeAllColourMenus() {
  document.querySelectorAll(".colour-picker.open").forEach((picker) => {
    picker.classList.remove("open");
    picker.querySelector(".colour-menu-button")?.setAttribute("aria-expanded", "false");
    picker.closest(".group-card")?.classList.remove("menu-open");
  });
}

function createColourPicker(selectedColour = "blue", selectedLabel = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "colour-picker";
  wrapper.innerHTML = `
    <input class="group-color-value" type="hidden" value="${selectedColour}">
    <input class="group-color-label" type="hidden" value="${selectedLabel}">
    <button type="button" class="colour-menu-button" aria-haspopup="listbox" aria-expanded="false">
      <span class="colour-chip" aria-hidden="true"></span>
      <span class="colour-label"></span>
    </button>
    <div class="colour-menu" role="listbox"></div>
  `;

  const hiddenInput = wrapper.querySelector(".group-color-value");
  const hiddenLabelInput = wrapper.querySelector(".group-color-label");
  const menuButton = wrapper.querySelector(".colour-menu-button");
  const selectedChip = wrapper.querySelector(".colour-chip");
  const label = wrapper.querySelector(".colour-label");
  const menu = wrapper.querySelector(".colour-menu");

  function renderSelected() {
    const colour = hiddenInput.value || "blue";
    selectedChip.style.background = getEdgeColourHex(colour);
    label.textContent = hiddenLabelInput.value || getDefaultEdgeLabel(colour);
  }

  function selectColour(colour, optionLabel) {
    hiddenInput.value = colour;
    hiddenLabelInput.value = optionLabel;
    renderSelected();
    closeAllColourMenus();
  }

  EDGE_COLOUR_OPTIONS.forEach(({ value, label: optionLabel }) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "colour-option";
    option.setAttribute("role", "option");
    option.innerHTML = `
      <span class="colour-chip" aria-hidden="true"></span>
      <span>${optionLabel}</span>
    `;
    option.querySelector(".colour-chip").style.background = getEdgeColourHex(value);
    option.addEventListener("click", () => selectColour(value, optionLabel));
    menu.appendChild(option);
  });

  menuButton.addEventListener("click", () => {
    const isOpen = wrapper.classList.contains("open");
    closeAllColourMenus();
    if (!isOpen) {
      wrapper.classList.add("open");
      menuButton.setAttribute("aria-expanded", "true");
      wrapper.closest(".group-card")?.classList.add("menu-open");
    }
  });

  renderSelected();
  return wrapper;
}

function createPattern(pattern = { type: MATCH_TYPES.HOSTNAME, value: "" }) {
  const item = document.createElement("div");
  item.className = "pattern-card";
  item.innerHTML = `
    <select class="pattern-type">
      <option value="hostname">Hostname</option>
      <option value="url">Exact URL</option>
      <option value="contains">Contains</option>
    </select>
    <input class="pattern-value" value="${pattern.value || ""}" placeholder="Enter match value">
    <button type="button" class="ghost danger remove-pattern">Remove</button>
  `;

  item.querySelector(".pattern-type").value = pattern.type || MATCH_TYPES.HOSTNAME;
  item.querySelector(".remove-pattern").addEventListener("click", () => item.remove());
  return item;
}

function createDraftGroupId() {
  const randomPart =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  return `group-${randomPart}`;
}

function syncOrderInputs() {
  [...elements.groups.querySelectorAll(".group-card")].forEach((card, index) => {
    card.querySelector(".group-order").value = String(index + 1);
  });
}

function createGroupCard(group = {}) {
  const card = document.createElement("article");
  card.className = "group-card";
  card.draggable = true;
  card.dataset.groupId = group.id || createGroupId(group.name) || createDraftGroupId();
  card.innerHTML = `
    <div class="group-card-header">
      <div>
        <p class="eyebrow">Tab Group</p>
        <input class="group-name" value="${group.name || ""}" placeholder="Group name">
      </div>
      <div class="group-card-actions">
        <label>
          Colour
          <div class="colour-select"></div>
        </label>
        <label>
          Order
          <input class="group-order" type="number" min="1" value="${group.order || state.groups.length + 1}">
        </label>
        <button type="button" class="ghost danger delete-group">Delete</button>
      </div>
    </div>
    <div class="patterns"></div>
    <div class="group-footer">
      <button type="button" class="ghost add-pattern">Add Pattern</button>
      <span class="drag-hint">Drag to reorder</span>
    </div>
  `;

  card.querySelector(".colour-select").appendChild(
    createColourPicker(group.color || "blue", group.colorLabel || "")
  );

  const patterns = card.querySelector(".patterns");

  (group.patterns?.length ? group.patterns : [{ type: MATCH_TYPES.HOSTNAME, value: "" }]).forEach(
    (pattern) => patterns.appendChild(createPattern(pattern))
  );

  card.querySelector(".add-pattern").addEventListener("click", () => {
    patterns.appendChild(createPattern());
  });
  card.querySelector(".delete-group").addEventListener("click", () => {
    card.remove();
    syncOrderInputs();
  });

  card.addEventListener("dragstart", () => card.classList.add("dragging"));
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    syncOrderInputs();
  });
  card.addEventListener("dragover", (event) => {
    event.preventDefault();
    const dragging = elements.groups.querySelector(".dragging");
    if (!dragging || dragging === card) {
      return;
    }

    const bounds = card.getBoundingClientRect();
    const shouldInsertBefore = event.clientY < bounds.top + bounds.height / 2;
    elements.groups.insertBefore(dragging, shouldInsertBefore ? card : card.nextSibling);
  });

  return card;
}

function formatDelayLabel(value) {
  const seconds = Number(value) / 1000;
  return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)} seconds`;
}

function collectGroupsFromDom() {
  return [...elements.groups.querySelectorAll(".group-card")].map((card, index) => ({
    id: card.dataset.groupId,
    name: card.querySelector(".group-name").value.trim(),
    color: card.querySelector(".group-color-value").value,
    colorLabel: card.querySelector(".group-color-label").value,
    order: index + 1,
    patterns: [...card.querySelectorAll(".pattern-card")].map((patternCard, patternIndex) => ({
      id: `${card.dataset.groupId}-pattern-${patternIndex + 1}`,
      type: patternCard.querySelector(".pattern-type").value,
      value: patternCard.querySelector(".pattern-value").value.trim()
    }))
      .filter((pattern) => pattern.value)
  })).filter((group) => group.name);
}

function renderGroups(groups) {
  elements.groups.innerHTML = "";
  groups.forEach((group) => elements.groups.appendChild(createGroupCard(group)));
  syncOrderInputs();
}

function renderTesterResults(url) {
  const results = state.groups
    .map((group) => {
      const matches = group.patterns.filter((pattern) => patternMatches(url, pattern));
      return { group, matches };
    })
    .filter((entry) => entry.matches.length > 0);

  if (!url.trim()) {
    elements.testerResults.innerHTML = "<p>Enter a URL to test your rules.</p>";
    return;
  }

  if (results.length === 0) {
    elements.testerResults.innerHTML = "<p>No groups matched this URL.</p>";
    return;
  }

  elements.testerResults.innerHTML = results
    .map(
      (entry) => `
        <article class="test-result">
          <strong>${entry.group.name}</strong>
          <p>${entry.matches.map((pattern) => `${pattern.type}: ${pattern.value}`).join(", ")}</p>
        </article>
      `
    )
    .join("");
}

async function load() {
  const [groups, settings] = await Promise.all([getGroups(), getSettings()]);
  state.groups = groups;
  state.settings = settings;

  renderGroups(groups);

  elements.autoOrganise.checked = settings.autoOrganise;
  elements.autoRefreshDelayMs.value = String(
    settings.autoOrganiseDelayMs || DEFAULT_AUTO_ORGANISE_DELAY_MS
  );
  elements.autoRefreshDelayValue.textContent = formatDelayLabel(elements.autoRefreshDelayMs.value);
  elements.darkMode.value = settings.darkMode || "system";
  document.documentElement.dataset.theme = settings.darkMode || "system";
}

async function handleSaveGroups() {
  state.groups = await saveGroups(collectGroupsFromDom());
  renderGroups(state.groups);
  elements.saveStatus.textContent = "Groups saved";
}

async function handleSavePreferences() {
  state.settings = await saveSettings({
    autoOrganise: elements.autoOrganise.checked,
    autoOrganiseDelayMs: Number(elements.autoRefreshDelayMs.value),
    darkMode: elements.darkMode.value
  });
  document.documentElement.dataset.theme = state.settings.darkMode;
  renderGroups(state.groups);
  elements.autoRefreshDelayValue.textContent = formatDelayLabel(state.settings.autoOrganiseDelayMs);
  elements.saveStatus.textContent = "Preferences saved";
}

function handleExport() {
  downloadJson("auto-tab-grouper-groups.json", {
    version: 1,
    groups: collectGroupsFromDom()
  });
}

async function inspectTabGroupColours() {
  elements.diagnosticsOutput.textContent = "Reading live tab group colours...";
  const response = await chrome.runtime.sendMessage({ action: "getTabGroupDiagnostics" });

  if (!response?.ok) {
    elements.diagnosticsOutput.textContent = "Unable to read tab group diagnostics.";
    return;
  }

  if (!response.groups.length) {
    elements.diagnosticsOutput.textContent = "No tab groups found in the current window.";
    return;
  }

  elements.diagnosticsOutput.textContent = response.groups
    .map((group) => `${group.title || "(untitled)"} -> ${group.color} [id ${group.id}]`)
    .join("\n");
}

async function runOrganiser(action, label) {
  elements.saveStatus.textContent = `${label}...`;
  await chrome.runtime.sendMessage({ action });
  elements.saveStatus.textContent = `${label} complete`;
}

async function handleImport(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const groups = Array.isArray(payload) ? payload : payload.groups;
    state.groups = await saveGroups(groups || []);
    renderGroups(state.groups);
    elements.saveStatus.textContent = "Import complete";
  } catch {
    elements.saveStatus.textContent = "Import failed: invalid JSON";
  }

  event.target.value = "";
}

elements.addGroup.addEventListener("click", () => {
  elements.groups.appendChild(createGroupCard({ order: elements.groups.children.length + 1 }));
  syncOrderInputs();
});
elements.saveGroups.addEventListener("click", handleSaveGroups);
elements.organiseCurrent.addEventListener("click", () =>
  runOrganiser("organiseCurrent", "Organising current window")
);
elements.organiseAll.addEventListener("click", () =>
  runOrganiser("organiseAll", "Organising all windows")
);
elements.savePreferences.addEventListener("click", handleSavePreferences);
elements.exportJson.addEventListener("click", handleExport);
elements.importJson.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", handleImport);
elements.inspectColours.addEventListener("click", inspectTabGroupColours);
elements.runTester.addEventListener("click", () => renderTesterResults(elements.testerUrl.value));
elements.autoRefreshDelayMs.addEventListener("input", () => {
  elements.autoRefreshDelayValue.textContent = formatDelayLabel(elements.autoRefreshDelayMs.value);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".colour-picker")) {
    closeAllColourMenus();
  }
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if ((document.documentElement.dataset.theme || "system") === "system") {
    renderGroups(state.groups);
  }
});

load();
