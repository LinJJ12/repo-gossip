(() => {
  const HistoryLogic =
    typeof globalThis !== "undefined"
      ? globalThis.RepoGossipHistoryLogic
      : null;
  if (!HistoryLogic) {
    console.error("[repo-gossip] history-logic.js missing; load before app.js");
  }

  const HISTORY_KEY = "repoGossipHistory";

  const DEFAULTS = {
    apiBaseUrl: "http://localhost:5173",
    githubToken: "",
    llmApiKey: "",
    llmBaseUrl: "",
    llmModel: "",
    days: 14,
    offline: false,
  };

  const SETTINGS_FIELDS = [
    "apiBaseUrl",
    "githubToken",
    "llmApiKey",
    "llmBaseUrl",
    "llmModel",
    "days",
    "offline",
  ];

  const MODE_LABEL = {
    llm: "LLM 八卦模式",
    offline: "本地土味模式（未调 LLM）",
    fallback: "LLM 失败，已回退本地模板",
  };

  const viewCompose = document.getElementById("view-compose");
  const viewSettings = document.getElementById("view-settings");
  const navSettings = document.getElementById("nav-settings");
  const navCompose = document.getElementById("nav-compose");
  const configBanner = document.getElementById("config-banner");
  const repoInput = /** @type {HTMLInputElement} */ (
    document.getElementById("repo")
  );
  const composeDays = /** @type {HTMLSelectElement} */ (
    document.getElementById("compose-days")
  );
  const composeLlm = /** @type {HTMLInputElement} */ (
    document.getElementById("compose-llm")
  );
  const goBtn = /** @type {HTMLButtonElement} */ (document.getElementById("go"));
  const composeError = document.getElementById("compose-error");
  const stage = document.getElementById("stage");
  const recentBtn = /** @type {HTMLButtonElement | null} */ (
    document.getElementById("nav-recent")
  );
  const recentPanel = document.getElementById("recent-history");

  /** @type {boolean} */
  let loading = false;
  /** @type {boolean} */
  let historyOpen = false;

  function currentView() {
    const h = (location.hash || "#compose").replace(/^#/, "");
    return h === "settings" ? "settings" : "compose";
  }

  function showView(view) {
    const isSettings = view === "settings";
    viewCompose.hidden = isSettings;
    viewSettings.hidden = !isSettings;
    navSettings.hidden = isSettings;
    navCompose.hidden = !isSettings;
    document.body.classList.toggle("view-settings", isSettings);
    document.title = isSettings ? "repo/gossip 设置" : "repo/gossip";
  }

  function applyHash() {
    showView(currentView());
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** @param {string} name */
  function isGithubLogin(name) {
    return /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(name);
  }

  /** @param {string} name */
  function isGithubFullName(name) {
    const parts = String(name).split("/");
    if (parts.length !== 2) return false;
    return parts.every(
      (p) =>
        p.length > 0 &&
        p.length <= 100 &&
        /^[A-Za-z0-9._-]+$/.test(p) &&
        !p.startsWith(".") &&
        !p.endsWith("."),
    );
  }

  /** @param {string} s */
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** @param {string} token */
  function tokenRegExp(token) {
    return new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(token)})(?![A-Za-z0-9])`, "g");
  }

  /** @param {string} login */
  function userHref(login) {
    return `https://github.com/${encodeURIComponent(login)}`;
  }

  /** @param {string} fullName */
  function repoHref(fullName) {
    const [owner, repo] = fullName.split("/");
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  /** @param {string} login */
  function userLink(login) {
    const safe = escapeHtml(login);
    return `<a class="gh-link" href="${userHref(login)}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  }

  /** @param {string} fullName */
  function repoLink(fullName) {
    const safe = escapeHtml(fullName);
    return `<a class="gh-link" href="${repoHref(fullName)}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  }

  /**
   * @param {any} analyzed
   * @param {any[]} translations
   * @returns {string[]}
   */
  function collectLogins(analyzed, translations) {
    /** @type {Set<string>} */
    const set = new Set();
    for (const a of analyzed?.awards || []) {
      if (a?.winner) set.add(String(a.winner));
    }
    for (const a of analyzed?.topAuthors || []) {
      if (a?.name) set.add(String(a.name));
    }
    for (const c of analyzed?.snapshot?.commits || []) {
      if (c?.authorLogin) set.add(String(c.authorLogin));
      else if (c?.author) set.add(String(c.author));
    }
    for (const e of analyzed?.easterEggs || []) {
      if (e?.author) set.add(String(e.author));
    }
    for (const t of translations || []) {
      if (t?.author) set.add(String(t.author));
    }
    return [...set].filter(isGithubLogin).sort((a, b) => b.length - a.length);
  }

  /**
   * Mirror of packages/core github-links: placeholder claim order avoids nested <a>.
   * @param {string} text
   * @param {{ fullName?: string, logins?: string[], className?: string, minProseLoginLength?: number }} opts
   */
  function linkifyGithubHtml(text, opts = {}) {
    const className = opts.className || "gh-link";
    const minLen = opts.minProseLoginLength ?? 2;
    /** @type {{ kind: "repo" | "user", value: string }[]} */
    const slots = [];
    const mark = (/** @type {"repo" | "user"} */ kind, value) => {
      const id = slots.length;
      slots.push({ kind, value });
      return `\uE000${id}\uE001`;
    };

    let work = String(text);
    const fullName =
      opts.fullName && isGithubFullName(opts.fullName) ? opts.fullName : undefined;
    if (fullName) {
      work = work.replace(tokenRegExp(fullName), (_m, pre) => `${pre}${mark("repo", fullName)}`);
    }

    const logins = [...new Set(opts.logins || [])]
      .filter(isGithubLogin)
      .filter((l) => l.length >= minLen)
      .filter((l) => l !== fullName)
      .sort((a, b) => b.length - a.length);

    for (const login of logins) {
      work = work.replace(tokenRegExp(login), (_m, pre) => `${pre}${mark("user", login)}`);
    }

    const escaped = escapeHtml(work);
    return escaped.replace(/\uE000(\d+)\uE001/g, (_m, id) => {
      const slot = slots[Number(id)];
      if (!slot) return "";
      if (slot.kind === "repo") {
        return `<a class="${className}" href="${repoHref(slot.value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(slot.value)}</a>`;
      }
      return `<a class="${className}" href="${userHref(slot.value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(slot.value)}</a>`;
    });
  }

  /**
   * @param {string} text
   * @param {string[]} logins
   * @param {string} [fullName]
   */
  function linkifyLoginsHtml(text, logins, fullName) {
    return linkifyGithubHtml(text, { fullName, logins, className: "gh-link" });
  }

  async function loadStorage() {
    return chrome.storage.local.get(DEFAULTS);
  }

  async function refreshConfigBanner() {
    const data = await loadStorage();
    const missing = !String(data.apiBaseUrl || "").trim();
    configBanner.hidden = !missing;
  }

  function ensureSelectValue(select, value) {
    const v = String(value);
    if (![...select.options].some((o) => o.value === v)) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = `${v} 天`;
      select.appendChild(opt);
    }
    select.value = v;
  }

  async function fillSettingsForm() {
    const data = await loadStorage();
    for (const key of SETTINGS_FIELDS) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === "checkbox") {
        el.checked = Boolean(data[key]);
      } else if (key === "days") {
        ensureSelectValue(/** @type {HTMLSelectElement} */ (el), data.days ?? 14);
      } else {
        el.value = data[key] ?? "";
      }
    }
  }

  async function fillComposeControls() {
    const data = await loadStorage();
    ensureSelectValue(composeDays, data.days ?? 14);
    composeLlm.checked = !Boolean(data.offline);
  }

  async function persistComposeControls() {
    await chrome.storage.local.set({
      days: Number(composeDays.value) || 14,
      offline: !composeLlm.checked,
    });
  }

  async function saveSettings(event) {
    event.preventDefault();
    /** @type {Record<string, string | number | boolean>} */
    const payload = {};
    for (const key of SETTINGS_FIELDS) {
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
    const status = document.getElementById("settings-status");
    if (status) {
      status.hidden = false;
      setTimeout(() => {
        status.hidden = true;
      }, 1200);
    }
    await fillComposeControls();
    await refreshConfigBanner();
    location.hash = "compose";
  }

  function setError(msg) {
    if (!msg) {
      composeError.hidden = true;
      composeError.textContent = "";
      return;
    }
    composeError.hidden = false;
    composeError.textContent = msg;
  }

  function setLoading(on) {
    loading = on;
    goBtn.disabled = on;
    goBtn.textContent = on
      ? composeLlm.checked
        ? "主编正在写稿…"
        : "正在翻提交簿…"
      : "出报";
    document.querySelectorAll(".chip[data-repo]").forEach((btn) => {
      /** @type {HTMLButtonElement} */ (btn).disabled = on;
    });
    if (recentBtn) recentBtn.disabled = on;
  }

  /**
   * @param {number} ts
   */
  function formatSavedAt(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** @returns {Promise<any[]>} */
  async function loadHistory() {
    const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
    return HistoryLogic
      ? HistoryLogic.normalizeHistoryList(stored[HISTORY_KEY])
      : Array.isArray(stored[HISTORY_KEY])
        ? stored[HISTORY_KEY]
        : [];
  }

  /**
   * @param {string} repo
   * @param {any} data
   */
  async function upsertHistoryFromData(repo, data) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "HISTORY_UPSERT",
        repo,
        data,
      });
      if (!response?.ok) {
        console.warn(
          "[repo-gossip] history upsert failed",
          response?.error || "unknown",
        );
      }
    } catch (err) {
      console.warn(
        "[repo-gossip] history upsert failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  function setHistoryOpen(open) {
    historyOpen = open;
    if (recentBtn) {
      recentBtn.classList.toggle("is-active", open);
      recentBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (recentPanel) recentPanel.hidden = !open;
  }

  async function renderHistoryList() {
    if (!recentPanel) return;
    const list = await loadHistory();
    const usable = list.filter((e) => e && typeof e.repo === "string" && e.data);
    if (!usable.length) {
      recentPanel.innerHTML =
        `<p class="recent-history-empty">还没有缓存的小报</p>`;
      return;
    }
    recentPanel.innerHTML = usable
      .map((e) => {
        const title =
          typeof e.epicTitle === "string" && e.epicTitle ? e.epicTitle : e.repo;
        const time = formatSavedAt(Number(e.savedAt));
        return `<button type="button" class="recent-history-item" data-repo="${escapeHtml(e.repo)}">
          <span class="recent-history-item__repo">${escapeHtml(e.repo)}</span>
          <span class="recent-history-item__title">${escapeHtml(title)}</span>
          ${time ? `<span class="recent-history-item__time">${escapeHtml(time)}</span>` : ""}
        </button>`;
      })
      .join("");
    recentPanel.querySelectorAll(".recent-history-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const repo = btn.getAttribute("data-repo");
        if (!repo || loading) return;
        void (async () => {
          const entry = HistoryLogic
            ? HistoryLogic.findHistoryEntry(await loadHistory(), repo)
            : (await loadHistory()).find((e) => e?.repo === repo);
          if (!entry?.data) {
            setError("这条缓存已损坏或丢失");
            return;
          }
          setError("");
          setHistoryOpen(false);
          repoInput.value = entry.repo;
          renderTabloid(entry.data);
        })();
      });
    });
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setError("");
    setHistoryOpen(true);
    await renderHistoryList();
  }

  function renderLoading() {
    const copy = composeLlm.checked
      ? "编辑室连线 LLM，正在把提交写成八卦…"
      : "编辑正在连夜翻 commit history…";
    stage.innerHTML = `
      <div class="loading-panel" role="status">
        <div class="spinner"></div>
        <p>${escapeHtml(copy)}</p>
      </div>
    `;
  }

  /**
   * @param {any} data
   */
  function renderTabloid(data) {
    const tabloid = data?.tabloid;
    if (!tabloid?.analyzed) {
      const plain = data?.message?.plain || JSON.stringify(data, null, 2);
      stage.innerHTML = `<pre class="plain-fallback">${escapeHtml(plain)}</pre>`;
      return;
    }

    const analyzed = tabloid.analyzed;
    const snap = analyzed.snapshot || {};
    const temp = analyzed.temperature || {};
    const level = temp.level || "cool";
    const mode = data.mode;
    const banners = [];
    if (mode && MODE_LABEL[mode]) {
      const warn = mode !== "llm" ? " warn-banner" : "";
      const extra = data.llmError ? ` · ${escapeHtml(String(data.llmError))}` : "";
      banners.push(
        `<p class="sample-banner${warn}">${escapeHtml(MODE_LABEL[mode])}${extra}</p>`,
      );
    }
    if (Array.isArray(data.warnings) && data.warnings.length) {
      banners.push(
        `<p class="sample-banner warn-banner">${escapeHtml(data.warnings.join(" · "))}</p>`,
      );
    }

    const awardsNarrative = Array.isArray(tabloid.awardsNarrative)
      ? tabloid.awardsNarrative
      : [];
    const awards = Array.isArray(analyzed.awards) ? analyzed.awards : [];
    const translations = Array.isArray(tabloid.translations)
      ? tabloid.translations.filter(
          (t) => String(t.original || "").trim() || String(t.drama || "").trim(),
        )
      : [];
    const logins = collectLogins(analyzed, tabloid.translations || []);
    const fullName = String(snap.fullName || "");

    let awardsHtml = "";
    if (awardsNarrative.length || awards.length) {
      const items = awardsNarrative.length
        ? awardsNarrative
            .map(
              (line) =>
                `<li><div><p class="award-title">${linkifyLoginsHtml(String(line), logins, fullName)}</p></div></li>`,
            )
            .join("")
        : awards
            .map(
              (a) => `
            <li>
              <span class="award-emoji">${escapeHtml(a.emoji || "")}</span>
              <div>
                <p class="award-title">「${escapeHtml(a.title || "")}」——${
                  a.winner && isGithubLogin(String(a.winner))
                    ? userLink(String(a.winner))
                    : escapeHtml(a.winner || "")
                }</p>
                <p class="award-reason">${escapeHtml(a.reason || "")}</p>
              </div>
            </li>`,
            )
            .join("");
      awardsHtml = `<section class="block"><h3>颁奖典礼</h3><ul class="award-list">${items}</ul></section>`;
    }

    let transHtml = "";
    if (translations.length) {
      const items = translations
        .map((t) => {
          const code = t.original
            ? `<code>${escapeHtml(String(t.original))}</code>`
            : "";
          const author =
            t.author && isGithubLogin(String(t.author))
              ? `<cite> ——${userLink(String(t.author))}</cite>`
              : t.author
                ? `<cite> ——${escapeHtml(String(t.author))}</cite>`
                : "";
          return `<li>${code}<p><span class="arrow">→</span> ${escapeHtml(String(t.drama || "（暂无翻译）"))}${author}</p></li>`;
        })
        .join("");
      transHtml = `<section class="block"><h3>提交信翻译</h3><ul class="trans-list">${items}</ul></section>`;
    }

    const eggs = Array.isArray(tabloid.easterEggLines)
      ? tabloid.easterEggLines
      : [];
    const eggsHtml = eggs.length
      ? `<section class="block eggs"><h3>彩蛋侦探</h3><ul>${eggs
          .map((line) => `<li>${linkifyLoginsHtml(String(line), logins, fullName)}</li>`)
          .join("")}</ul></section>`
      : "";

    const authors = Array.isArray(analyzed.topAuthors)
      ? analyzed.topAuthors.slice(0, 6)
      : [];
    const authorsHtml = authors.length
      ? `<section class="block authors"><h3>出镜名单</h3><div class="author-row">${authors
          .map((a) => {
            const name = String(a.name || "");
            const label = isGithubLogin(name)
              ? userLink(name)
              : escapeHtml(name);
            return `<span>${label}<em>${escapeHtml(String(a.commits ?? ""))}</em></span>`;
          })
          .join("")}</div></section>`
      : "";

    const stars =
      typeof snap.stars === "number" ? snap.stars.toLocaleString() : "—";
    const commitCount = Array.isArray(snap.commits) ? snap.commits.length : 0;
    const fullNameHtml = isGithubFullName(fullName)
      ? repoLink(fullName)
      : escapeHtml(fullName);

    stage.innerHTML = `
      ${banners.join("")}
      <article class="tabloid temp-${escapeHtml(level)}">
        <div class="tabloid-stamp">${escapeHtml(temp.emoji || "")} ${escapeHtml(temp.label || "")}</div>
        <header class="tabloid-head">
          <p class="issue">项目八卦小报 · ${fullNameHtml}</p>
          <h2 class="epic">${escapeHtml(tabloid.epicTitle || "八卦小报")}</h2>
          <p class="meta">
            <span>★ ${escapeHtml(stars)}</span>
            <span>${escapeHtml(snap.language ?? "未知语言")}</span>
            <span>近窗 ${commitCount} 次提交</span>
            <span>近 3 天 ${escapeHtml(String(temp.commitsLast3Days ?? "—"))} 次</span>
          </p>
          ${
            snap.description
              ? `<p class="desc">${escapeHtml(String(snap.description))}</p>`
              : ""
          }
        </header>
        <section class="block temp-block">
          <h3>项目体温</h3>
          <p class="lead">${escapeHtml(tabloid.temperatureLine || "")}</p>
        </section>
        ${awardsHtml}
        ${transHtml}
        ${eggsHtml}
        ${authorsHtml}
        <p class="closing">${escapeHtml(tabloid.closing || "")}</p>
      </article>
    `;
  }

  async function generate(target) {
    const trimmed = String(target ?? repoInput.value).trim();
    if (!trimmed) {
      setError("先丢一个仓库链接过来");
      return;
    }

    const data = await loadStorage();
    if (!String(data.apiBaseUrl || "").trim()) {
      setError("请先配置 API Base URL");
      configBanner.hidden = false;
      return;
    }

    setError("");
    setLoading(true);
    setHistoryOpen(false);
    renderLoading();
    repoInput.value = trimmed;

    try {
      await persistComposeControls();
      const response = await chrome.runtime.sendMessage({
        type: "GOSSIP_FETCH",
        repo: trimmed,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "未知错误");
      }
      renderTabloid(response.data);
      await upsertHistoryFromData(trimmed, response.data);
    } catch (err) {
      stage.innerHTML = "";
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  navSettings?.addEventListener("click", () => {
    location.hash = "settings";
  });
  navCompose?.addEventListener("click", () => {
    location.hash = "compose";
  });

  document.getElementById("open-full")?.addEventListener("click", () => {
    const view = currentView();
    void chrome.runtime.sendMessage({ type: "OPEN_APP", view });
  });

  document.getElementById("compose-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void generate();
  });

  document.querySelectorAll(".chip[data-repo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const repo = btn.getAttribute("data-repo");
      if (repo) void generate(repo);
    });
  });

  recentBtn?.addEventListener("click", () => {
    void toggleHistory();
  });

  composeDays.addEventListener("change", () => {
    void persistComposeControls();
  });
  composeLlm.addEventListener("change", () => {
    void persistComposeControls();
  });

  document.getElementById("settings-form")?.addEventListener("submit", (e) => {
    void saveSettings(e);
  });

  window.addEventListener("hashchange", () => {
    applyHash();
    if (currentView() === "settings") void fillSettingsForm();
    if (currentView() === "compose") {
      void fillComposeControls();
      void refreshConfigBanner();
    }
  });

  applyHash();
  void (async () => {
    await fillSettingsForm();
    await fillComposeControls();
    await refreshConfigBanner();
  })();
})();
