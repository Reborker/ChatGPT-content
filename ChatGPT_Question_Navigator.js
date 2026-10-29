// ==UserScript==
// @name         ChatGPT 问题目录（长对话导航）
// @namespace    https://chatgpt.com/
// @version      1.0.0
// @description  为 ChatGPT 长对话生成可搜索、可折叠的问题目录，点击跳转到对应提问。
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    width: 340,
    maxLabelLength: 160,
    apiPageSize: 100,
    scrollAttempts: 17,
  };

  const KEY_COLLAPSED = 'cgpt-question-navigator-collapsed';
  const PANEL_ID = 'cgpt-question-navigator-host';
  let conversationId = '';
  let generation = 0;
  let items = [];
  let indexById = new Map();
  let source = 'loading';
  let activeIndex = -1;
  let query = '';
  let loading = false;
  let lastFetch = 0;
  let navigationToken = 0;
  let refreshTimer;
  let scrollFrame = 0;
  let collapsed = localStorage.getItem(KEY_COLLAPSED) === '1';

  const host = document.createElement('div');
  host.id = PANEL_ID;
  host.style.display = 'none';

    function keepPanelMounted() {
        // 如果 ChatGPT 重新加载页面导致导航消失，就重新挂载
        if (document.body && host.parentNode !== document.body) {
            document.body.appendChild(host);
            console.log('[ChatGPT 问题目录] 导航已挂载或恢复');
        }
    }

    function startPanel() {
        // 等待 ChatGPT 完成页面初始化
        setTimeout(keepPanelMounted, 1000);
    }

    if (document.readyState === 'complete') {
        startPanel();
    } else {
        window.addEventListener('load', startPanel, { once: true });
    }

    // 每秒检查，防止 ChatGPT 动态重建页面时移除导航
    setInterval(keepPanelMounted, 1000);

  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      #frame { position: fixed; z-index: 2147483000; right: 18px; top: 92px;
        width: ${CONFIG.width}px; max-width: calc(100vw - 36px);
        color: #222; font: 13px/1.45 system-ui, -apple-system, "Microsoft YaHei", sans-serif; }
      #panel { border: 1px solid #dedede; border-radius: 15px; overflow: hidden;
        background: #fff; box-shadow: 0 8px 30px #0002; }
      #head { display: flex; align-items: center; gap: 7px; padding: 12px 13px 8px; }
      #head strong { font-size: 15px; flex: 1; }
      #count { font-size: 12px; color: #777; }
      button { font: inherit; cursor: pointer; }
      .icon { border: none; background: #f1f2f4; width: 27px; height: 27px;
        border-radius: 8px; color: #444; font-size: 16px; }
      .icon:hover { background: #e2e5e8; }
      #search-wrap { padding: 0 12px 8px; }
      #search { width: 100%; border: 1px solid #ddd; border-radius: 9px; outline: none;
        padding: 8px 10px; background: #fafafa; color: #222; font: inherit; }
      #search:focus { border-color: #10a37f; background: #fff; }
      #status { color: #888; font-size: 11px; padding: 0 13px 8px; }
      #list { max-height: min(62vh, 660px); overflow-y: auto; overscroll-behavior: contain;
        border-top: 1px solid #f0f0f0; padding: 5px 0; }
      .entry { width: 100%; display: flex; gap: 9px; text-align: left; border: 0;
        background: transparent; padding: 10px 12px; color: #333; }
      .entry:hover { background: #f2f5f4; }
      .entry.active { background: #e7f6f0; }
      .num { flex: 0 0 25px; font-size: 12px; color: #888; padding-top: 1px; }
      .label { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
        overflow: hidden; overflow-wrap: anywhere; }
      .entry.active .num, .entry.active .label { color: #087e5d; }
      #empty { padding: 25px 12px; text-align: center; color: #888; }
      #toggle { display: none; margin-left: auto; border: 1px solid #ddd; border-radius: 12px;
        background: #fff; color: #17896d; width: 50px; height: 46px; font-size: 22px;
        box-shadow: 0 7px 20px #0002; }
      #toast { display: none; position: absolute; right: 0; top: 100%; margin-top: 7px;
        width: 100%; background: #242424; color: #fff; padding: 9px 11px;
        border-radius: 8px; box-shadow: 0 5px 18px #0003; }
      #frame.collapsed { width: 50px; }
      #frame.collapsed #panel { display: none; }
      #frame.collapsed #toggle { display: block; }
      @media (max-width: 620px) { #frame { right: 8px; top: 70px; } }
      @media (prefers-color-scheme: dark) {
        #panel, #toggle { background: #292929; border-color: #454545; color: #e7e7e7; }
        #head strong, .entry { color: #e7e7e7; }
        .icon { background: #414141; color: #ddd; }
        .icon:hover { background: #555; }
        #search { background: #333; color: #eee; border-color: #505050; }
        #search:focus { background: #383838; }
        .entry:hover { background: #383e3c; }
        .entry.active { background: #1b4034; }
        .entry.active .num, .entry.active .label { color: #7ed5b5; }
        #list { border-color: #3b3b3b; }
      }
    </style>
    <div id="frame">
      <div id="panel">
        <div id="head"><strong>问题目录</strong><span id="count">0 条</span>
          <button id="refresh" class="icon" title="刷新目录">↻</button>
          <button id="close" class="icon" title="折叠目录">−</button>
        </div>
        <div id="search-wrap"><input id="search" placeholder="搜索之前提过的问题…" type="search"></div>
        <div id="status">读取对话中…</div>
        <div id="list"></div>
      </div>
      <button id="toggle" title="展开问题目录">☷</button>
      <div id="toast" role="status"></div>
    </div>`;

  const $ = (id) => shadow.getElementById(id);
  const frame = $('frame');
  const list = $('list');

  function setCollapsed(value) {
    collapsed = value;
    frame.classList.toggle('collapsed', value);
    localStorage.setItem(KEY_COLLAPSED, value ? '1' : '0');
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function routeId() {
    return location.pathname.match(/\/c\/([\w-]{8,})/i)?.[1] || '';
  }

  function textFromMessage(message) {
    const parts = message?.content?.parts;
    const raw = Array.isArray(parts)
      ? parts.map((p) => typeof p === 'string' ? p : (p?.text || '')).filter(Boolean).join(' ')
      : (message?.content?.text || '');
    const text = String(raw).replace(/\s+/g, ' ').trim();
    if (text) return text;
    const filenames = message?.metadata?.attachments?.map((a) => a.name).filter(Boolean);
    return filenames?.length ? `[附件] ${filenames.join('、')}` : '[图片或其他内容]';
  }

  function normalizeMessages(messages) {
    return messages.filter((m) => m?.author?.role === 'user' &&
      !m.metadata?.is_visually_hidden_from_conversation)
      .map((m, i) => ({ id: String(m.id || `api-${i}`), text: textFromMessage(m) }));
  }

  async function getAuthHeader() {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    if (!response.ok) throw new Error(`登录状态读取失败：${response.status}`);
    const session = await response.json();
    if (!session?.accessToken) throw new Error('未获得当前网页登录状态');
    return { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' };
  }

  async function fetchJson(url, headers) {
    const response = await fetch(url, { headers, credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return response.json();
  }

  async function loadServerMessages(id) {
    const headers = await getAuthHeader();
    try {
      let before = '';
      let all = [];
      const cursors = new Set();
      for (let page = 0; page < 100; page++) {
        const url = `/backend-api/conversations/${encodeURIComponent(id)}?num_turns=${CONFIG.apiPageSize}` +
          (before ? `&before=${encodeURIComponent(before)}` : '');
        const data = await fetchJson(url, headers);
        if (!Array.isArray(data.messages) || typeof data.page_info?.has_previous_page !== 'boolean') {
          throw new Error('当前接口返回格式已变化');
        }
        all = data.messages.concat(all);
        if (!data.page_info.has_previous_page) {
          const unique = new Map();
          for (const message of all) if (message?.id) unique.set(message.id, message);
          return normalizeMessages([...unique.values()]);
        }
        before = data.page_info.start_cursor;
        if (!before || cursors.has(before)) throw new Error('目录分页未能继续');
        cursors.add(before);
      }
      throw new Error('对话分页超过安全上限');
    } catch (pluralError) {
      // Legacy endpoint: a parent-linked tree; only the currently selected branch counts.
      const data = await fetchJson(`/backend-api/conversation/${encodeURIComponent(id)}`, headers);
      if (!data?.mapping || !data?.current_node) throw pluralError;
      const path = [];
      const seen = new Set();
      let nodeId = data.current_node;
      while (nodeId) {
        if (seen.has(nodeId) || !data.mapping[nodeId]) throw new Error('旧接口对话树不完整');
        seen.add(nodeId);
        const node = data.mapping[nodeId];
        if (node.message) path.push({ ...node.message, id: node.id || nodeId });
        nodeId = node.parent;
      }
      return normalizeMessages(path.reverse());
    }
  }

  function scroller() {
    return document.querySelector('[data-app-action-timeline-scroll][role="region"]') ||
      document.querySelector('[data-app-action-timeline-scroll]') ||
      document.scrollingElement;
  }

  function contentRoot() {
    return document.querySelector('[data-app-action-timeline-scroll][role="region"]') || document;
  }

  function mountedPrompts() {
    const root = contentRoot();
    const nodes = root.querySelectorAll(
      '[data-user-message-bubble="true"], [data-content-search-unit-key$=":user"], [data-message-author-role="user"]'
    );
    const found = new Map();
    for (const node of nodes) {
      const wrapper = node.closest('[data-turn-key], article[data-turn="user"], article[data-testid^="conversation-turn-"]') || node;
      const id = wrapper.getAttribute('data-turn-key') ||
        node.closest('[data-message-id]')?.getAttribute('data-message-id') ||
        wrapper.getAttribute('data-turn-id') || wrapper.getAttribute('data-testid') || '';
      const bubble = wrapper.querySelector('[data-user-message-bubble="true"]') ||
        wrapper.querySelector('.whitespace-pre-wrap') || node;
      const value = bubble.textContent?.replace(/\s+/g, ' ').trim();
      if (!value) continue;
      const key = id || `dom-${found.size}`;
      if (!found.has(key)) found.set(key, { id: key, text: value, element: wrapper });
    }
    return [...found.values()];
  }

  function useItems(nextItems, nextSource) {
    items = nextItems;
    source = nextSource;
    indexById = new Map(items.map((m, i) => [m.id, i]));
    activeIndex = -1;
    render();
    updateActive();
  }

  function render() {
    $('count').textContent = `${items.length} 条`;
    $('status').textContent = loading ? '正在读取完整对话…'
      : source === 'api' ? '已索引完整对话 · 点击问题跳转'
      : source === 'dom' ? '仅显示当前已加载的问题 · 可尝试刷新'
      : '等待对话加载…';
    list.replaceChildren();
    const lower = query.trim().toLocaleLowerCase();
    const matches = items.map((item, i) => ({ item, i }))
      .filter(({ item }) => item.text.toLocaleLowerCase().includes(lower));
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.id = 'empty';
      empty.textContent = items.length ? '没有找到匹配的问题' : '暂时没有可显示的问题';
      list.append(empty);
      return;
    }
    for (const { item, i } of matches) {
      const button = document.createElement('button');
      button.className = `entry${i === activeIndex ? ' active' : ''}`;
      button.dataset.index = String(i);
      button.title = item.text;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1) + '.';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = item.text.slice(0, CONFIG.maxLabelLength);
      button.append(num, label);
      button.addEventListener('click', () => jumpTo(i));
      list.append(button);
    }
  }

  function findTurn(item) {
    if (item.element?.isConnected) return item.element;
    const root = contentRoot();
    const escaped = CSS.escape(item.id);
    return root.querySelector(`[data-turn-key="${escaped}"]`) ||
      root.querySelector(`[data-message-id="${escaped}"]`) ||
      root.querySelector(`[data-turn-id="${escaped}"]`) ||
      root.querySelector(`[data-testid="${escaped}"]`);
  }

  function placeAtTurn(element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.style.setProperty('outline', '2px solid #10a37f', 'important');
    element.style.setProperty('outline-offset', '5px', 'important');
    setTimeout(() => {
      element.style.removeProperty('outline');
      element.style.removeProperty('outline-offset');
    }, 1700);
  }

  function visibleAnchor(container) {
    const baseTop = container === document.scrollingElement ? 0 : container.getBoundingClientRect().top;
    const height = container === document.scrollingElement ? innerHeight : container.clientHeight;
    let best = null;
    for (const entry of mountedPrompts()) {
      const idx = indexById.get(entry.id);
      if (idx === undefined) continue;
      const rect = entry.element.getBoundingClientRect();
      const rel = rect.top - baseTop;
      if (rect.height === 0 || rel < -height * 0.25 || rel > height * 1.25) continue;
      const dist = Math.abs(rel - height * 0.35);
      if (!best || dist < best.dist) best = { idx, dist };
    }
    return best;
  }

  async function jumpTo(i) {
    const item = items[i];
    if (!item) return;
    activeIndex = i;
    render();
    const token = ++navigationToken;
    let node = findTurn(item);
    if (node) { placeAtTurn(node); return; }

    const container = scroller();
    if (!container || items.length < 2 || source !== 'api') {
      toast('这条消息尚未加载到页面，请先向上滚动后重试');
      return;
    }

    // Modern ChatGPT virtualizes old turns. Seek by position and refine against
    // the IDs of mounted turns, without scanning or downloading private content.
    let low = 0;
    let high = Math.max(0, container.scrollHeight - container.clientHeight);
    let guess = high * i / (items.length - 1);
    for (let attempt = 0; attempt < CONFIG.scrollAttempts; attempt++) {
      if (navigationToken !== token || conversationId !== routeId()) return;
      container.scrollTop = guess;
      await new Promise((resolve) => setTimeout(resolve, 210));
      node = findTurn(item);
      if (node) { placeAtTurn(node); updateActive(); return; }
      const anchor = visibleAnchor(container);
      if (!anchor) continue;
      if (anchor.idx < i) low = Math.max(low, container.scrollTop);
      else if (anchor.idx > i) high = Math.min(high, container.scrollTop);
      else continue;
      if (high - low < 8) break;
      guess = (low + high) / 2;
    }
    toast('已尝试定位附近位置；如果未显示目标，请滚动一下滚轮以触发加载');
  }

  function updateActive() {
    if (!items.length) return;
    const anchor = visibleAnchor(scroller());
    if (!anchor || anchor.idx === activeIndex) return;
    activeIndex = anchor.idx;
    for (const entry of list.querySelectorAll('.entry')) {
      entry.classList.toggle('active', Number(entry.dataset.index) === activeIndex);
    }
  }

  async function refresh(force = false) {
    if (!conversationId || loading || (!force && Date.now() - lastFetch < 6000)) return;
    const currentGeneration = generation;
    loading = true;
    lastFetch = Date.now();
    render();
    try {
      const fullItems = await loadServerMessages(conversationId);
      if (currentGeneration !== generation) return;
      useItems(fullItems, 'api');
    } catch (error) {
      if (currentGeneration !== generation) return;
      const domItems = mountedPrompts();
      if (source !== 'api') useItems(domItems, 'dom');
      if (force) toast('完整索引暂不可用，已尝试读取页面：' + error.message);
    } finally {
      if (currentGeneration === generation) {
        loading = false;
        render();
      }
    }
  }

  function checkRoute() {
    const nextId = routeId();
    if (nextId === conversationId) return;
    conversationId = nextId;
    generation++;
    navigationToken++;
    clearTimeout(refreshTimer);
    loading = false;
    items = [];
    indexById.clear();
    source = 'loading';
    activeIndex = -1;
    host.style.display = nextId ? 'block' : 'none';
    render();
    if (nextId) refresh(true);
  }

  function maybeNewPrompt() {
    if (!conversationId) return;
    if (source === 'dom') {
      const domItems = mountedPrompts();
      const changed = domItems.length !== items.length ||
        domItems.some((item, i) => item.id !== items[i]?.id || item.text !== items[i]?.text);
      if (changed) useItems(domItems, 'dom');
      return;
    }
    if (loading || source !== 'api') return;
    const container = scroller();
    const nearBottom = container && container.scrollHeight - container.scrollTop - container.clientHeight < container.clientHeight * 1.5;
    if (!nearBottom) return;
    const hasNew = mountedPrompts().some(({ id }) => !indexById.has(id));
    if (hasNew) refresh();
  }

  $('close').addEventListener('click', () => setCollapsed(true));
  $('toggle').addEventListener('click', () => setCollapsed(false));
  $('refresh').addEventListener('click', () => refresh(true));
  $('search').addEventListener('input', (event) => {
    query = event.target.value;
    render();
  });
  setCollapsed(collapsed);

  const observer = new MutationObserver(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(maybeNewPrompt, 800);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  document.addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      updateActive();
    });
  }, true);

  // ChatGPT switches conversations without a full page refresh.
  setInterval(() => { checkRoute(); }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkRoute();
  });
  checkRoute();
})();
