(() => {
  const BTN_ID = "repo-gossip-btn";
  const PANEL_ID = "repo-gossip-panel";
  /** @type {string | null} */
  let boundRepo = null;

  function parseRepoFromPath() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!owner || !repo) return null;
    // skip non-repo paths like settings, orgs-only
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
    // skip blob/tree-only weirdness when second segment is reserved
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

  function ensureButton() {
    const repo = parseRepoFromPath();
    const existing = document.getElementById(BTN_ID);

    if (!repo) {
      if (existing?.parentElement?.classList.contains("repo-gossip-float")) {
        existing.parentElement.remove();
      } else {
        existing?.closest("li")?.remove();
        existing?.remove();
      }
      boundRepo = null;
      return;
    }

    if (existing && boundRepo === repo) return;

    // GitHub SPA navigated to another repo — rebuild click binding
    if (existing?.parentElement?.classList.contains("repo-gossip-float")) {
      existing.parentElement.remove();
    } else {
      existing?.closest("li")?.remove();
      existing?.remove();
    }
    boundRepo = repo;

    const actions =
      document.querySelector(".pagehead-actions") ||
      document.querySelector('[data-selector="repo-header"]') ||
      document.querySelector("main");
    if (!actions) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "repo-gossip-trigger";
    btn.textContent = "八卦小报";
    btn.title = "用 repo-gossip 生成项目八卦小报";
    btn.addEventListener("click", () => {
      void runGossip(repo);
    });

    if (actions.matches?.(".pagehead-actions") || actions.tagName === "UL") {
      const li = document.createElement("li");
      li.appendChild(btn);
      actions.prepend(li);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "repo-gossip-float";
      wrap.appendChild(btn);
      document.body.appendChild(wrap);
    }
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
      <pre class="repo-gossip-pre">${escapeHtml(plain)}</pre>
    `);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  ensureButton();
  // GitHub soft navigations
  document.addEventListener("turbo:load", ensureButton);
  document.addEventListener("pjax:end", ensureButton);
  const mo = new MutationObserver(() => ensureButton());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
