async function sendAction(action) {
  const status = document.getElementById("status");
  status.textContent = "Running...";
  await chrome.runtime.sendMessage({ action });
  status.textContent = "Done";
}

document.getElementById("current").addEventListener("click", () => sendAction("organiseCurrent"));
document.getElementById("all").addEventListener("click", () => sendAction("organiseAll"));
document.getElementById("rules").addEventListener("click", () => chrome.runtime.openOptionsPage());
