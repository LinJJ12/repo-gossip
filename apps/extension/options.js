const fields = [
  "apiBaseUrl",
  "githubToken",
  "llmApiKey",
  "llmBaseUrl",
  "llmModel",
  "days",
  "offline",
];

async function load() {
  const data = await chrome.storage.local.get({
    apiBaseUrl: "http://localhost:5173",
    githubToken: "",
    llmApiKey: "",
    llmBaseUrl: "",
    llmModel: "",
    days: 14,
    offline: false,
  });
  for (const key of fields) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === "checkbox") {
      el.checked = Boolean(data[key]);
    } else {
      el.value = data[key] ?? "";
    }
  }
}

async function save() {
  /** @type {Record<string, string | number | boolean>} */
  const payload = {};
  for (const key of fields) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === "checkbox") {
      payload[key] = el.checked;
    } else if (key === "days") {
      payload[key] = Number(el.value) || 14;
    } else {
      payload[key] = el.value.trim();
    }
  }
  await chrome.storage.local.set(payload);
  const status = document.getElementById("status");
  if (status) {
    status.hidden = false;
    setTimeout(() => {
      status.hidden = true;
    }, 1500);
  }
}

document.getElementById("save")?.addEventListener("click", () => {
  void save();
});
void load();
