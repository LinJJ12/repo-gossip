(() => {
  const BTN_ID = "repo-gossip-btn";
  const PANEL_ID = "repo-gossip-panel";
  const POS_KEY = "repoGossipBtnPos";
  const HISTORY_KEY = "repoGossipHistory";
  const DRAG_THRESHOLD = 5;
  const HistoryLogic = globalThis.RepoGossipHistoryLogic;
  if (!HistoryLogic) {
    console.error("[repo-gossip] history-logic.js missing; load order broken");
  }

  /** @type {string | null} */
  let boundRepo = null;
  let resizeBound = false;
  /** Prevents duplicate floats while async ensureButton is in flight. */
  let ensuring = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let moTimer = null;
  /** Monotonic id so stale GOSSIP_FETCH responses cannot overwrite newer UI. */
  let gossipFetchSeq = 0;
  /** @type {"report" | "history"} */
  let panelView = "report";
  /** @type {{ repo: string, data: any } | null} */
  let lastReport = null;

  function parseRepoFromPath() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!owner || !repo) return null;
    if (
      [
        "settings",
        "notifications",
        "marketplace",
        "explore",
        "topics",
        "pulls",
        "issues",
        "new",
        "organizations",
        "account",
      ].includes(owner)
    ) {
      return null;
    }
    if (
      ["settings", "pulls", "issues", "actions", "projects", "security", "pulse"].includes(
        repo,
      )
    ) {
      return null;
    }
    const cleanRepo = repo.replace(/\.git$/i, "");
    return `${owner}/${cleanRepo}`;
  }

  /**
   * @param {number} n
   * @param {number} min
   * @param {number} max
   */
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /**
   * @param {HTMLElement} wrap
   * @param {{ left?: number, top?: number } | null} pos
   */
  function applyPos(wrap, pos) {
    if (
      pos &&
      typeof pos.left === "number" &&
      typeof pos.top === "number" &&
      Number.isFinite(pos.left) &&
      Number.isFinite(pos.top)
    ) {
      const maxLeft = Math.max(0, window.innerWidth - wrap.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - wrap.offsetHeight);
      wrap.style.left = `${clamp(pos.left, 0, maxLeft)}px`;
      wrap.style.top = `${clamp(pos.top, 0, maxTop)}px`;
      wrap.style.right = "auto";
      wrap.style.bottom = "auto";
      return;
    }
    wrap.style.top = "72px";
    wrap.style.right = "16px";
    wrap.style.left = "auto";
    wrap.style.bottom = "auto";
  }

  /**
   * @param {HTMLElement} wrap
   * @param {HTMLButtonElement} btn
   * @param {string} repo
   */
  function bindDragAndClick(wrap, btn, repo) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      const rect = wrap.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      wrap.style.right = "auto";
      wrap.style.bottom = "auto";
      wrap.style.left = `${origLeft}px`;
      wrap.style.top = `${origTop}px`;
      wrap.classList.add("is-dragging");
      btn.setPointerCapture(e.pointerId);
    });

    btn.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
      const maxLeft = Math.max(0, window.innerWidth - wrap.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - wrap.offsetHeight);
      wrap.style.left = `${clamp(origLeft + dx, 0, maxLeft)}px`;
      wrap.style.top = `${clamp(origTop + dy, 0, maxTop)}px`;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove("is-dragging");
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (!moved) return;
      const rect = wrap.getBoundingClientRect();
      void chrome.storage.local.set({
        [POS_KEY]: { left: rect.left, top: rect.top },
      });
    };

    btn.addEventListener("pointerup", endDrag);
    btn.addEventListener("pointercancel", endDrag);

    btn.addEventListener("click", (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
        return;
      }
      void openGossipOrCache(repo);
    });
  }

  function removeButton() {
    const existing = document.getElementById(BTN_ID);
    existing?.closest(".repo-gossip-float")?.remove();
    existing?.closest("li")?.remove();
    existing?.remove();
  }

  async function ensureButton() {
    const repo = parseRepoFromPath();
    const existing = document.getElementById(BTN_ID);

    if (!repo) {
      removeButton();
      boundRepo = null;
      return;
    }

    if (existing && boundRepo === repo) return;
    if (ensuring) {
      // SPA navigated while a prior ensure is in flight — retry shortly.
      scheduleEnsure();
      return;
    }

    ensuring = true;
    mo.disconnect();
    try {
      removeButton();
      boundRepo = repo;

      const wrap = document.createElement("div");
      wrap.className = "repo-gossip-float";

      const btn = document.createElement("button");
      btn.id = BTN_ID;
      btn.type = "button";
      btn.className = "repo-gossip-trigger";
      btn.textContent = "八卦小报";
      btn.title = "拖动可换位置；点击打开缓存或生成八卦小报";

      wrap.appendChild(btn);
      document.body.appendChild(wrap);

      const stored = await chrome.storage.local.get({ [POS_KEY]: null });
      // Drop if SPA navigated away while we awaited storage.
      if (boundRepo !== repo || parseRepoFromPath() !== repo) {
        wrap.remove();
        return;
      }
      applyPos(wrap, stored[POS_KEY]);
      bindDragAndClick(wrap, btn, repo);

      if (!resizeBound) {
        resizeBound = true;
        window.addEventListener(
          "resize",
          () => {
            const float = document.querySelector(".repo-gossip-float");
            if (!(float instanceof HTMLElement)) return;
            const rect = float.getBoundingClientRect();
            applyPos(float, { left: rect.left, top: rect.top });
          },
          { passive: true },
        );
      }
    } finally {
      ensuring = false;
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function scheduleEnsure() {
    if (moTimer != null) clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      moTimer = null;
      void ensureButton();
    }, 80);
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
   * @returns {Promise<any | null>}
   */
  async function findHistory(repo) {
    const list = await loadHistory();
    return HistoryLogic
      ? HistoryLogic.findHistoryEntry(list, repo)
      : list.find((e) => e && e.repo === repo) || null;
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

  /** @param {number} ts */
  function formatSavedAt(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function panelEl() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = PANEL_ID;
    el.className = "repo-gossip-panel";
    el.innerHTML = `
      <div class="repo-gossip-panel__head">
        <strong>repo/gossip</strong>
        <div class="repo-gossip-panel__actions">
          <button type="button" class="repo-gossip-panel__recent">最近</button>
          <button type="button" class="repo-gossip-panel__close" aria-label="关闭">×</button>
        </div>
      </div>
      <div class="repo-gossip-panel__body"></div>
    `;
    el
      .querySelector(".repo-gossip-panel__close")
      ?.addEventListener("click", () => hidePanel());
    el
      .querySelector(".repo-gossip-panel__recent")
      ?.addEventListener("click", () => void onHeaderNavClick());
    document.body.appendChild(el);
    return el;
  }

  function headerNavButton() {
    return document.querySelector(`#${PANEL_ID} .repo-gossip-panel__recent`);
  }

  /** Sync header toggle label with panelView. */
  function syncHeaderNav() {
    const btn = headerNavButton();
    if (!(btn instanceof HTMLButtonElement)) return;
    if (panelView === "history") {
      btn.textContent = "当前";
      btn.setAttribute("aria-label", "返回当前小报");
      btn.title = "返回当前小报";
    } else {
      btn.textContent = "最近";
      btn.setAttribute("aria-label", "查看最近出报");
      btn.title = "查看最近出报";
    }
  }

  async function onHeaderNavClick() {
    if (panelView === "history") {
      await restoreCurrentReport();
      return;
    }
    await showHistoryList();
  }

  async function restoreCurrentReport() {
    bumpGossipSeq();
    if (lastReport?.data) {
      await showReport(lastReport.repo, lastReport.data, { persist: false });
      return;
    }
    panelView = "report";
    syncHeaderNav();
    showPanel(
      `<p class="repo-gossip-muted">暂无当前小报。点页面上的「八卦小报」生成一份。</p>`,
    );
  }

  /**
   * Cancel in-flight GOSSIP_FETCH UI application (history/cache/hide win).
   */
  function bumpGossipSeq() {
    gossipFetchSeq += 1;
  }

  function hidePanel() {
    bumpGossipSeq();
    const el = document.getElementById(PANEL_ID);
    if (el) el.classList.add("is-hidden");
  }

  function ensurePanelVisible() {
    const el = panelEl();
    el.classList.remove("is-hidden");
    return el;
  }

  /** @param {string} html */
  function showPanel(html) {
    const el = ensurePanelVisible();
    const body = el.querySelector(".repo-gossip-panel__body");
    if (body) body.innerHTML = html;
  }

  /**
   * @param {string} repo
   * @param {any} data
   */
  function buildReportHtml(repo, data) {
    const structured = buildStructuredTabloidHtml(data);
    return `${structured}
      <button type="button" class="repo-gossip-refetch" data-repo="${escapeHtml(repo)}">重新出报</button>`;
  }

  const MODE_LABEL = {
    llm: "LLM 八卦模式",
    offline: "本地土味模式（未调 LLM）",
    fallback: "LLM 失败，已回退本地模板",
  };

  /**
   * Mirror extension app.js / web TabloidView section layout (narrow panel).
   * @param {any} data
   */
  function buildStructuredTabloidHtml(data) {
    const tabloid = data?.tabloid;
    if (!tabloid?.analyzed) {
      const plain = data?.message?.plain || JSON.stringify(data, null, 2);
      return `<pre class="repo-gossip-pre">${linkifyPlainHtml(plain, data)}</pre>`;
    }

    const analyzed = tabloid.analyzed;
    const snap = analyzed.snapshot || {};
    const temp = analyzed.temperature || {};
    const level = HistoryLogic
      ? HistoryLogic.sanitizeTempLevel(temp.level)
      : ["blazing", "warm", "cool", "frozen"].includes(String(temp.level))
        ? String(temp.level)
        : "cool";
    const fullName = String(snap.fullName || "");
    const warningList = Array.isArray(data?.warnings) ? data.warnings : [];

    /** @type {string[]} */
    const banners = [];
    const mode = data?.mode;
    if (mode && MODE_LABEL[mode]) {
      const warn = mode !== "llm" ? " is-warn" : "";
      const extra = data.llmError ? ` · ${escapeHtml(String(data.llmError))}` : "";
      banners.push(
        `<p class="repo-gossip-banner${warn}">${escapeHtml(MODE_LABEL[mode])}${extra}</p>`,
      );
    }
    if (warningList.length) {
      banners.push(
        `<p class="repo-gossip-banner is-warn">${escapeHtml(warningList.map(String).join(" · "))}</p>`,
      );
    }

    const awardsNarrative = Array.isArray(tabloid.awardsNarrative)
      ? tabloid.awardsNarrative
          .map((line) => String(line || "").trim())
          .filter(Boolean)
      : [];
    const awards = Array.isArray(analyzed.awards) ? analyzed.awards : [];
    const translations = Array.isArray(tabloid.translations)
      ? tabloid.translations.filter(
          (t) =>
            String(t?.original || "").trim() || String(t?.drama || "").trim(),
        )
      : [];

    let awardsHtml = "";
    if (awardsNarrative.length || awards.length) {
      const items = awardsNarrative.length
        ? awardsNarrative
            .map(
              (line) =>
                `<li><div><p class="rg-award-title">${linkifyPlainHtml(line, data)}</p></div></li>`,
            )
            .join("")
        : awards
            .map(
              (a) => `
            <li>
              <span class="rg-award-emoji">${escapeHtml(a.emoji || "")}</span>
              <div>
                <p class="rg-award-title">「${escapeHtml(a.title || "")}」——${
                  a.winner && isGithubLogin(String(a.winner))
                    ? `<a class="repo-gossip-link" href="${userHref(String(a.winner))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(a.winner))}</a>`
                    : escapeHtml(a.winner || "")
                }</p>
                <p class="rg-award-reason">${escapeHtml(a.reason || "")}</p>
              </div>
            </li>`,
            )
            .join("");
      awardsHtml = `<section class="rg-block"><h3>颁奖典礼</h3><ul class="rg-award-list">${items}</ul></section>`;
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
              ? `<cite> ——<a class="repo-gossip-link" href="${userHref(String(t.author))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(t.author))}</a></cite>`
              : t.author
                ? `<cite> ——${escapeHtml(String(t.author))}</cite>`
                : "";
          return `<li>${code}<p><span class="rg-arrow">→</span> ${escapeHtml(String(t.drama || "（暂无翻译）"))}${author}</p></li>`;
        })
        .join("");
      transHtml = `<section class="rg-block"><h3>提交信翻译</h3><ul class="rg-trans-list">${items}</ul></section>`;
    }

    const eggs = Array.isArray(tabloid.easterEggLines)
      ? tabloid.easterEggLines
          .map((line) => String(line || "").trim())
          .filter(Boolean)
      : [];
    const eggsHtml = eggs.length
      ? `<section class="rg-block rg-eggs"><h3>彩蛋侦探</h3><ul>${eggs
          .map((line) => `<li>${linkifyPlainHtml(line, data)}</li>`)
          .join("")}</ul></section>`
      : "";

    const authors = Array.isArray(analyzed.topAuthors)
      ? analyzed.topAuthors.slice(0, 6)
      : [];
    const authorsHtml = authors.length
      ? `<section class="rg-block rg-authors"><h3>出镜名单</h3><div class="rg-author-row">${authors
          .map((a) => {
            const name = String(a.name || "");
            const label = isGithubLogin(name)
              ? `<a class="repo-gossip-link" href="${userHref(name)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`
              : escapeHtml(name);
            return `<span>${label}<em>${escapeHtml(String(a.commits ?? ""))}</em></span>`;
          })
          .join("")}</div></section>`
      : "";

    const stars =
      typeof snap.stars === "number" ? snap.stars.toLocaleString() : "—";
    const commitCount =
      typeof snap.commitCount === "number"
        ? snap.commitCount
        : Array.isArray(snap.commits)
          ? snap.commits.length
          : 0;
    const fullNameHtml = isGithubFullName(fullName)
      ? `<a class="repo-gossip-link" href="${repoHref(fullName)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fullName)}</a>`
      : escapeHtml(fullName);

    const tempLine = String(tabloid.temperatureLine || "").trim();
    const tempBlock = tempLine
      ? `<section class="rg-block">
          <h3>项目体温</h3>
          <p class="rg-lead">${escapeHtml(tempLine)}</p>
        </section>`
      : "";

    return `
      ${banners.join("")}
      <article class="rg-tabloid rg-temp-${level}">
        <div class="rg-stamp">${escapeHtml(temp.emoji || "")} ${escapeHtml(temp.label || "")}</div>
        <header class="rg-head">
          <p class="rg-issue">项目八卦小报 · ${fullNameHtml}</p>
          <h2 class="rg-epic">${escapeHtml(tabloid.epicTitle || "八卦小报")}</h2>
          <p class="rg-meta">
            <span>★ ${escapeHtml(stars)}</span>
            <span>${escapeHtml(snap.language ?? "未知语言")}</span>
            <span>近窗 ${commitCount} 次</span>
            <span>近 3 天 ${escapeHtml(String(temp.commitsLast3Days ?? "—"))} 次</span>
          </p>
          ${
            snap.description
              ? `<p class="rg-desc">${escapeHtml(String(snap.description))}</p>`
              : ""
          }
        </header>
        ${tempBlock}
        ${awardsHtml}
        ${transHtml}
        ${eggsHtml}
        ${authorsHtml}
        ${
          tabloid.closing
            ? `<p class="rg-closing">${escapeHtml(String(tabloid.closing))}</p>`
            : ""
        }
      </article>
    `;
  }

  /**
   * @param {string} repo
   * @param {any} data
   * @param {{ persist?: boolean }} [opts]
   */
  async function showReport(repo, data, opts = {}) {
    lastReport = { repo, data };
    panelView = "report";
    syncHeaderNav();
    showPanel(buildReportHtml(repo, data));
    const refetch = document.querySelector(`#${PANEL_ID} .repo-gossip-refetch`);
    refetch?.addEventListener("click", () => void runGossip(repo));
    if (opts.persist) {
      await upsertHistoryFromData(repo, data);
    }
  }

  async function showHistoryList() {
    bumpGossipSeq();
    panelView = "history";
    syncHeaderNav();
    const list = await loadHistory();
    const usable = list.filter((e) => e && typeof e.repo === "string" && e.data);
    if (!usable.length) {
      const backHint = lastReport
        ? `点右上角「当前」可返回上一份小报。`
        : `点页面上的「八卦小报」生成后会出现在这里。`;
      showPanel(
        `<p class="repo-gossip-muted">暂无缓存小报</p>
         <p class="repo-gossip-muted">${escapeHtml(backHint)}</p>`,
      );
      return;
    }
    const rows = usable
      .map((e) => {
        const title =
          typeof e.epicTitle === "string" && e.epicTitle
            ? e.epicTitle
            : e.repo;
        const time = formatSavedAt(Number(e.savedAt));
        return `<button type="button" class="repo-gossip-history-item" data-repo="${escapeHtml(e.repo)}">
          <span class="repo-gossip-history-item__repo">${escapeHtml(e.repo)}</span>
          <span class="repo-gossip-history-item__title">${escapeHtml(title)}</span>
          ${time ? `<span class="repo-gossip-history-item__time">${escapeHtml(time)}</span>` : ""}
        </button>`;
      })
      .join("");
    showPanel(`<div class="repo-gossip-history">${rows}</div>`);
    const body = document.querySelector(`#${PANEL_ID} .repo-gossip-panel__body`);
    body?.querySelectorAll(".repo-gossip-history-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const repo = btn.getAttribute("data-repo");
        if (!repo) return;
        void (async () => {
          bumpGossipSeq();
          const entry = await findHistory(repo);
          if (entry?.data) {
            await showReport(repo, entry.data, { persist: false });
            return;
          }
          panelView = "history";
          syncHeaderNav();
          showPanel(
            `<p class="repo-gossip-error">这条缓存已损坏或丢失</p>
             <p class="repo-gossip-muted">可点「当前」返回，或回到仓库页重新出报。</p>`,
          );
        })();
      });
    });
  }

  /**
   * Same-repo float click: reopen cache if present, else fetch.
   * @param {string} repo
   */
  async function openGossipOrCache(repo) {
    const entry = await findHistory(repo);
    if (entry?.data) {
      bumpGossipSeq();
      await showReport(repo, entry.data, { persist: false });
      return;
    }
    await runGossip(repo);
  }

  async function runGossip(repo) {
    const seq = ++gossipFetchSeq;
    panelView = "report";
    syncHeaderNav();
    showPanel(
      `<p class="repo-gossip-muted">正在偷看 ${escapeHtml(repo)}…</p>`,
    );
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "GOSSIP_FETCH",
        repo,
      });
    } catch (err) {
      if (seq !== gossipFetchSeq) return;
      showPanel(
        `<p class="repo-gossip-error">${escapeHtml(
          err instanceof Error ? err.message : String(err),
        )}</p>`,
      );
      return;
    }
    const data = response?.ok ? response.data : null;
    // Still cache successful payloads even if UI was superseded (hide / 最近 / 复开).
    if (data) {
      await upsertHistoryFromData(repo, data);
    }
    if (seq !== gossipFetchSeq) return;
    if (!response?.ok) {
      showPanel(
        `<p class="repo-gossip-error">${escapeHtml(response?.error || "未知错误")}</p>
         <p class="repo-gossip-muted">可在扩展选项里配置 API Base URL / BYOK。本地可先 <code>npm run web</code>。</p>`,
      );
      return;
    }
    if (!data) {
      showPanel(
        `<p class="repo-gossip-error">响应缺少可渲染数据</p>`,
      );
      return;
    }
    await showReport(repo, data, { persist: false });
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

  /**
   * @param {any} data
   * @returns {string[]}
   */
  function collectLogins(data) {
    /** @type {Set<string>} */
    const set = new Set();
    const analyzed = data?.tabloid?.analyzed;
    if (!analyzed) return [];
    for (const a of analyzed.awards || []) {
      if (a?.winner) set.add(String(a.winner));
    }
    for (const a of analyzed.topAuthors || []) {
      if (a?.name) set.add(String(a.name));
    }
    for (const c of analyzed.snapshot?.commits || []) {
      if (c?.authorLogin) set.add(String(c.authorLogin));
      else if (c?.author) set.add(String(c.author));
    }
    for (const e of analyzed.easterEggs || []) {
      if (e?.author) set.add(String(e.author));
    }
    for (const t of data?.tabloid?.translations || []) {
      if (t?.author) set.add(String(t.author));
    }
    return [...set].filter(isGithubLogin).sort((a, b) => b.length - a.length);
  }

  /**
   * @param {string} plain
   * @param {any} data
   */
  function linkifyPlainHtml(plain, data) {
    const fullName = data?.tabloid?.analyzed?.snapshot?.fullName;
    const className = "repo-gossip-link";
    const minLen = 2;
    /** @type {{ kind: "repo" | "user", value: string }[]} */
    const slots = [];
    const mark = (/** @type {"repo" | "user"} */ kind, value) => {
      const id = slots.length;
      slots.push({ kind, value });
      return `\uE000${id}\uE001`;
    };

    let work = String(plain);
    const repo =
      typeof fullName === "string" && isGithubFullName(fullName)
        ? fullName
        : undefined;
    if (repo) {
      work = work.replace(tokenRegExp(repo), (_m, pre) => `${pre}${mark("repo", repo)}`);
    }

    const logins = collectLogins(data)
      .filter((l) => l.length >= minLen)
      .filter((l) => l !== repo);

    for (const login of logins) {
      work = work.replace(tokenRegExp(login), (_m, pre) => `${pre}${mark("user", login)}`);
    }

    return escapeHtml(work).replace(/\uE000(\d+)\uE001/g, (_m, id) => {
      const slot = slots[Number(id)];
      if (!slot) return "";
      if (slot.kind === "repo") {
        return `<a class="${className}" href="${repoHref(slot.value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(slot.value)}</a>`;
      }
      return `<a class="${className}" href="${userHref(slot.value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(slot.value)}</a>`;
    });
  }

  const mo = new MutationObserver(() => scheduleEnsure());

  void ensureButton();
  document.addEventListener("turbo:load", () => void ensureButton());
  document.addEventListener("pjax:end", () => void ensureButton());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
