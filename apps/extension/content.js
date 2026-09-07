(() => {
  const BTN_ID = "repo-gossip-btn";
  const PANEL_ID = "repo-gossip-panel";
  const POS_KEY = "repoGossipBtnPos";
  const DRAG_THRESHOLD = 5;

  /** @type {string | null} */
  let boundRepo = null;
  let resizeBound = false;
  /** Prevents duplicate floats while async ensureButton is in flight. */
  let ensuring = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let moTimer = null;

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
      void runGossip(repo);
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
    if (ensuring) return;

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
      btn.title = "拖动可换位置；点击生成项目八卦小报";

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

  function panelEl() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = PANEL_ID;
    el.className = "repo-gossip-panel";
    el.innerHTML = `
      <div class="repo-gossip-panel__head">
        <strong>repo/gossip</strong>
        <button type="button" class="repo-gossip-panel__close" aria-label="关闭">×</button>
      </div>
      <div class="repo-gossip-panel__body"></div>
    `;
    el
      .querySelector(".repo-gossip-panel__close")
      ?.addEventListener("click", () => el.remove());
    document.body.appendChild(el);
    return el;
  }

  function showPanel(html) {
    const el = panelEl();
    const body = el.querySelector(".repo-gossip-panel__body");
    if (body) body.innerHTML = html;
  }

  async function runGossip(repo) {
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
      showPanel(
        `<p class="repo-gossip-error">${escapeHtml(
          err instanceof Error ? err.message : String(err),
        )}</p>`,
      );
      return;
    }
    if (!response?.ok) {
      showPanel(
        `<p class="repo-gossip-error">${escapeHtml(response?.error || "未知错误")}</p>
         <p class="repo-gossip-muted">可在扩展选项里配置 API Base URL / BYOK。本地可先 <code>npm run web</code>。</p>`,
      );
      return;
    }
    const data = response.data;
    const title = data?.tabloid?.epicTitle || "八卦小报";
    const plain = data?.message?.plain || JSON.stringify(data, null, 2);
    const meta = [
      data?.mode ? `mode=${data.mode}` : null,
      data?.llmError,
      ...(data?.warnings || []),
    ]
      .filter(Boolean)
      .map((s) => escapeHtml(String(s)))
      .join("<br/>");

    showPanel(`
      <h2>${escapeHtml(title)}</h2>
      ${meta ? `<p class="repo-gossip-muted">${meta}</p>` : ""}
      <pre class="repo-gossip-pre">${linkifyPlainHtml(plain, data)}</pre>
    `);
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
