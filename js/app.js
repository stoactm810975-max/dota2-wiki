/**
 * DOTA 2 百科全书 (Patch 7.41f) - 前端交互逻辑
 * 支持：英雄列表/筛选/搜索、英雄立绘&属性计算器、技能天赋具体数值、
 * 物品分类/搜索/合成路线、全分段胜率走势、常见位置、出装攻略加点、7.41f改动汇总
 */

(function () {
  'use strict';

  // 1. 数据检查
  const wikiData = window.DOTA2_WIKI_DATA;
  if (!wikiData) {
    console.error('DOTA2_WIKI_DATA 未找到，请确保 data/wiki_data.js 已加载。');
    return;
  }

  const { heroes = [], items = [], patches = [] } = wikiData;

  // 映射字典，方便快速查询
  const heroMapById = new Map();
  const heroMapByName = new Map();
  heroes.forEach((h) => {
    heroMapById.set(h.id, h);
    heroMapByName.set(h.short_name, h);
    heroMapByName.set(h.name, h);
  });

  const itemMapById = new Map();
  const itemMapByName = new Map();
  items.forEach((it) => {
    itemMapById.set(it.id, it);
    itemMapByName.set(it.short_name, it);
    itemMapByName.set(it.name, it);
  });

  // 全局状态
  const state = {
    currentTab: 'heroes', // heroes | items | meta | patch
    heroFilter: {
      attr: 'all_heroes', // all_heroes | 0(str) | 1(agi) | 2(int) | 3(all)
      pos: 'all', // all | 1 | 2 | 3 | 4 | 5
      attack: 'all', // all | 1(melee) | 2(ranged)
      role: 'all',
      sort: 'id',
      search: ''
    },
    itemFilter: {
      cat: 'all',
      search: '',
      sort: 'category'
    },
    metaFilter: {
      bracket: 'overall',
      pos: 'all',
      sortKey: 'winrate',
      sortAsc: false
    },
    selectedPatch: '7.41f',
    // Modal
    modalHero: null,
    modalItem: null,
    heroCalcLevel: 1,
    portraitMode: 'png' // png | webm
  };

  // DOM 元素引用
  const dom = {
    brandHomeBtn: document.getElementById('brandHomeBtn'),
    navTabs: document.querySelectorAll('.nav-tab'),
    viewSections: document.querySelectorAll('.view-section'),
    globalSearchInput: document.getElementById('globalSearchInput'),
    quickSearchDropdown: document.getElementById('quickSearchDropdown'),
    // KPI
    kpiPatchVer: document.getElementById('kpiPatchVer'),
    kpiHeroTotal: document.getElementById('kpiHeroTotal'),
    kpiItemTotal: document.getElementById('kpiItemTotal'),
    kpiPatchChanged: document.getElementById('kpiPatchChanged'),
    // Heroes
    heroesGrid: document.getElementById('heroesGrid'),
    heroAttrFilterGroup: document.getElementById('heroAttrFilterGroup'),
    heroPosFilterGroup: document.getElementById('heroPosFilterGroup'),
    heroAttackSelect: document.getElementById('heroAttackSelect'),
    heroRoleSelect: document.getElementById('heroRoleSelect'),
    heroSortSelect: document.getElementById('heroSortSelect'),
    // Items
    itemsContainer: document.getElementById('itemsContainer'),
    itemCatFilterGroup: document.getElementById('itemCatFilterGroup'),
    itemLocalSearch: document.getElementById('itemLocalSearch'),
    itemSortSelect: document.getElementById('itemSortSelect'),
    // Meta
    metaTableBody: document.getElementById('metaTableBody'),
    metaBracketGroup: document.getElementById('metaBracketGroup'),
    metaPosFilter: document.getElementById('metaPosFilter'),
    metaTableHeaders: document.querySelectorAll('.meta-table th[data-sort]'),
    // Patch
    patchVersionGroup: document.getElementById('patchVersionGroup'),
    patchHubContainer: document.getElementById('patchHubContainer'),
    // Modal
    modalBackdrop: document.getElementById('detailModalBackdrop'),
    modalPanel: document.getElementById('detailModalPanel'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    modalContentRoot: document.getElementById('modalContentRoot')
  };

  // 初始化 KPI
  if (dom.kpiHeroTotal) dom.kpiHeroTotal.textContent = heroes.length;
  if (dom.kpiItemTotal) dom.kpiItemTotal.textContent = items.length;
  const p741f = patches.find((p) => p.version === '7.41f');
  if (p741f && dom.kpiPatchChanged) {
    dom.kpiPatchChanged.textContent = `${p741f.hero_changes_count} / ${p741f.item_changes_count}`;
  }

  // -------------------------------------------------------------
  // 工具函数
  // -------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getWinrateClass(wr) {
    if (wr >= 51.5) return 'high';
    if (wr >= 48.5) return 'mid';
    return 'low';
  }

  function formatPct(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.0%';
    return num.toFixed(1) + '%';
  }

  function formatNumber(num) {
    if (!num) return '0';
    return Number(num).toLocaleString();
  }

  function has741fChanges(heroOrItem, isHero = true) {
    if (!p741f) return false;
    if (isHero) {
      return p741f.hero_ids && p741f.hero_ids.includes(heroOrItem.id);
    }
    return p741f.item_ids && p741f.item_ids.includes(heroOrItem.id);
  }

  // -------------------------------------------------------------
  // 选项卡切换
  // -------------------------------------------------------------
  function switchTab(tabName) {
    state.currentTab = tabName;
    dom.navTabs.forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active);
    });

    dom.viewSections.forEach((sec) => {
      sec.classList.toggle('active', sec.id === `view-${tabName}`);
    });

    // 触发对应视图渲染
    if (tabName === 'heroes') renderHeroes();
    else if (tabName === 'items') renderItems();
    else if (tabName === 'meta') renderMeta();
    else if (tabName === 'patch') renderPatchHub();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  dom.navTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  if (dom.brandHomeBtn) {
    dom.brandHomeBtn.addEventListener('click', () => switchTab('heroes'));
  }

  // -------------------------------------------------------------
  // 1. 英雄列表渲染
  // -------------------------------------------------------------
  function renderHeroes() {
    if (!dom.heroesGrid) return;
    const { attr, pos, attack, role, sort, search } = state.heroFilter;

    let filtered = heroes.filter((h) => {
      // 属性过滤
      if (attr !== 'all_heroes' && String(h.primary_attr) !== String(attr)) {
        return false;
      }
      // 位置过滤
      if (pos !== 'all') {
        const pNum = parseInt(pos, 10);
        const topPos = h.trends?.positions?.[0];
        if (!topPos || topPos.pos !== pNum) return false;
      }
      // 攻击类型过滤
      if (attack !== 'all' && String(h.attack_capability) !== String(attack)) {
        return false;
      }
      // 角色定位
      if (role !== 'all') {
        const hasRole = h.roles && h.roles.some((r) => r.name === role && r.level > 0);
        if (!hasRole) return false;
      }
      // 搜索词
      if (search) {
        const q = search.toLowerCase();
        const matchName = h.name_loc && h.name_loc.toLowerCase().includes(q);
        const matchEn = h.name_en && h.name_en.toLowerCase().includes(q);
        const matchShort = h.short_name && h.short_name.toLowerCase().includes(q);
        if (!matchName && !matchEn && !matchShort) return false;
      }
      return true;
    });

    // 排序
    filtered.sort((a, b) => {
      if (sort === 'winrate_desc') {
        return (b.trends?.overall_winrate || 0) - (a.trends?.overall_winrate || 0);
      }
      if (sort === 'picks_desc') {
        return (b.trends?.pub_picks || 0) - (a.trends?.pub_picks || 0);
      }
      if (sort === 'patch_741f') {
        const pa = has741fChanges(a, true) ? 1 : 0;
        const pb = has741fChanges(b, true) ? 1 : 0;
        return pb - pa || a.id - b.id;
      }
      if (sort === 'move_speed') {
        return (b.stats?.movement_speed || 0) - (a.stats?.movement_speed || 0);
      }
      return a.id - b.id;
    });

    if (filtered.length === 0) {
      dom.heroesGrid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 60px 20px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 12px;">🛡️</div>
          <div style="font-size: 1.1rem; color: var(--text-secondary);">未找到匹配条件的英雄</div>
          <div style="font-size: 0.85rem; margin-top: 6px;">可尝试调整主属性、位置或清除搜索关键词</div>
        </div>
      `;
      return;
    }

    const html = filtered
      .map((h) => {
        const isChanged = has741fChanges(h, true);
        const wr = h.trends?.overall_winrate || 50.0;
        const wrClass = getWinrateClass(wr);
        const topPos = h.trends?.positions?.[0];
        const posText = topPos ? `${topPos.pos}号位 (${topPos.pick_share}%)` : '主选';

        // 技能小图标展示 (前4个非隐藏技能)
        const miniSkills = (h.abilities || [])
          .filter((ab) => !ab.is_innate)
          .slice(0, 4)
          .map(
            (ab) =>
              `<img src="${ab.icon}" alt="${escapeHtml(ab.name_loc)}" title="${escapeHtml(ab.name_loc)}" loading="lazy" onerror="this.style.display='none'"/>`
          )
          .join('');

        return `
        <div class="hero-card" data-hero-id="${h.id}">
          <div class="hero-card-thumb">
            <img src="${h.avatar}" alt="${escapeHtml(h.name_loc)}" loading="lazy" />
            <span class="hero-attr-badge">
              <span class="attr-dot ${h.primary_attr_key}"></span>
              ${h.primary_attr_loc}
            </span>
            ${isChanged ? `<span class="hero-patch-tag">7.41f 改动</span>` : ''}
            <div class="hero-card-title-row">
              <span class="hero-card-name">${escapeHtml(h.name_loc)}</span>
              <span class="hero-card-en">${escapeHtml(h.name_en)}</span>
            </div>
          </div>
          <div class="hero-card-body">
            <div class="hero-card-meta">
              <span class="wr-pill ${wrClass}">胜率 ${formatPct(wr)}</span>
              <span class="pos-tag">${posText}</span>
            </div>
            <div class="hero-mini-skills">
              ${miniSkills}
            </div>
          </div>
        </div>
      `;
      })
      .join('');

    dom.heroesGrid.innerHTML = html;

    // 绑定点击进入英雄详情
    dom.heroesGrid.querySelectorAll('.hero-card').forEach((card) => {
      card.addEventListener('click', () => {
        const hid = parseInt(card.dataset.heroId, 10);
        openHeroModal(hid);
      });
    });
  }

  // 英雄筛选事件绑定
  if (dom.heroAttrFilterGroup) {
    dom.heroAttrFilterGroup.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.heroAttrFilterGroup.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.heroFilter.attr = btn.dataset.attr;
        renderHeroes();
      });
    });
  }

  if (dom.heroPosFilterGroup) {
    dom.heroPosFilterGroup.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.heroPosFilterGroup.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.heroFilter.pos = btn.dataset.pos;
        renderHeroes();
      });
    });
  }

  if (dom.heroAttackSelect) {
    dom.heroAttackSelect.addEventListener('change', (e) => {
      state.heroFilter.attack = e.target.value;
      renderHeroes();
    });
  }

  if (dom.heroRoleSelect) {
    dom.heroRoleSelect.addEventListener('change', (e) => {
      state.heroFilter.role = e.target.value;
      renderHeroes();
    });
  }

  if (dom.heroSortSelect) {
    dom.heroSortSelect.addEventListener('change', (e) => {
      state.heroFilter.sort = e.target.value;
      renderHeroes();
    });
  }

  // -------------------------------------------------------------
  // 2. 物品列表渲染
  // -------------------------------------------------------------
  const ITEM_CATEGORY_ORDER = [
    { key: 'consumable', title: '🧪 消耗品 (Consumables)' },
    { key: 'component', title: '🧱 基础配件 (Attributes & Components)' },
    { key: 'common', title: '⚒️ 常用与前期合成 (Common Upgrades)' },
    { key: 'rare', title: '🔮 辅助与法杖法器 (Support & Magical)' },
    { key: 'epic', title: '⚔️ 神装与强力武器 (Weapons & Armor)' },
    { key: 'artifact', title: '👑 圣物与终极秘宝 (Artifacts & Mythical)' },
    { key: 'roshan_special', title: '🧀 肉山与特殊掉落 (Roshan Special)' },
    { key: 'neutral_1', title: '🌲 1级中立物品 (Tier 1 Neutrals)' },
    { key: 'neutral_2', title: '🌲 2级中立物品 (Tier 2 Neutrals)' },
    { key: 'neutral_3', title: '🌲 3级中立物品 (Tier 3 Neutrals)' },
    { key: 'neutral_4', title: '🌲 4级中立物品 (Tier 4 Neutrals)' },
    { key: 'neutral_5', title: '🌲 5级中立物品 (Tier 5 Neutrals)' }
  ];

  function renderItems() {
    if (!dom.itemsContainer) return;
    const { cat, search, sort } = state.itemFilter;

    let filtered = items.filter((it) => {
      // 类别筛选
      if (cat !== 'all') {
        if (cat === 'shop') {
          if (it.neutral_tier) return false;
        } else if (cat === 'neutral') {
          if (!it.neutral_tier) return false;
        } else if (it.category !== cat) {
          return false;
        }
      }
      // 搜索过滤
      if (search) {
        const q = search.toLowerCase();
        const matchName = it.name_loc && it.name_loc.toLowerCase().includes(q);
        const matchEn = it.name_en && it.name_en.toLowerCase().includes(q);
        const matchShort = it.short_name && it.short_name.toLowerCase().includes(q);
        const matchDesc = it.desc_html && it.desc_html.toLowerCase().includes(q);
        if (!matchName && !matchEn && !matchShort && !matchDesc) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      dom.itemsContainer.innerHTML = `
        <div style="padding: 60px 20px; text-align: center; color: var(--text-muted); background: var(--bg-panel); border-radius: 10px;">
          <div style="font-size: 2.2rem; margin-bottom: 12px;">🎒</div>
          <div style="font-size: 1.1rem; color: var(--text-secondary);">未找到匹配的物品</div>
          <div style="font-size: 0.85rem; margin-top: 6px;">请清除过滤词或选择“全部物品”</div>
        </div>
      `;
      return;
    }

    // 分组渲染或者扁平排序渲染
    if (sort === 'category' && cat === 'all') {
      const groups = {};
      filtered.forEach((it) => {
        const gKey = it.category || 'common';
        if (!groups[gKey]) groups[gKey] = [];
        groups[gKey].push(it);
      });

      let html = '';
      ITEM_CATEGORY_ORDER.forEach((catMeta) => {
        const groupItems = groups[catMeta.key];
        if (!groupItems || groupItems.length === 0) return;

        html += `
          <div class="item-cat-block">
            <div class="item-cat-header">
              <span class="item-cat-title">${catMeta.title}</span>
              <span style="font-size:0.75rem; color:var(--text-muted);">${groupItems.length} 件</span>
            </div>
            <div class="items-grid">
              ${groupItems.map((it) => renderItemCard(it)).join('')}
            </div>
          </div>
        `;
      });
      dom.itemsContainer.innerHTML = html;
    } else {
      // 自定义排序
      filtered.sort((a, b) => {
        if (sort === 'cost_asc') return a.cost - b.cost;
        if (sort === 'cost_desc') return b.cost - a.cost;
        if (sort === 'patch_741f') {
          const pa = has741fChanges(a, false) ? 1 : 0;
          const pb = has741fChanges(b, false) ? 1 : 0;
          return pb - pa || a.cost - b.cost;
        }
        return a.cost - b.cost;
      });

      dom.itemsContainer.innerHTML = `
        <div class="item-cat-block">
          <div class="item-cat-header">
            <span class="item-cat-title">📦 筛选结果 (${filtered.length} 件物品)</span>
          </div>
          <div class="items-grid">
            ${filtered.map((it) => renderItemCard(it)).join('')}
          </div>
        </div>
      `;
    }

    // 绑定卡片点击
    dom.itemsContainer.querySelectorAll('.item-card').forEach((card) => {
      card.addEventListener('click', () => {
        const iid = parseInt(card.dataset.itemId, 10);
        openItemModal(iid);
      });
    });
  }

  function renderItemCard(it) {
    const isChanged = has741fChanges(it, false);
    let costDisplay = '';
    if (it.neutral_tier) {
      costDisplay = `<span class="tier-pill tier-${it.neutral_tier}">T${it.neutral_tier} 中立</span>`;
    } else if (it.cost > 0) {
      costDisplay = `<span class="gold-coin"></span><span>${it.cost}</span>`;
    } else {
      costDisplay = `<span style="color:var(--text-muted);font-size:0.72rem;">特殊</span>`;
    }

    return `
      <div class="item-card" data-item-id="${it.id}">
        <div class="item-card-img-wrap">
          <img src="${it.icon}" alt="${escapeHtml(it.name_loc)}" loading="lazy" />
          ${isChanged ? `<span style="position:absolute;bottom:0;right:0;background:#ff5035;color:#fff;font-size:0.55rem;padding:0 3px;border-radius:2px;font-weight:700;">7.41f</span>` : ''}
        </div>
        <div class="item-card-info">
          <div class="item-card-name" title="${escapeHtml(it.name_loc)}">${escapeHtml(it.name_loc)}</div>
          <div class="item-card-cost">${costDisplay}</div>
        </div>
      </div>
    `;
  }

  // 物品分类筛选事件绑定
  if (dom.itemCatFilterGroup) {
    dom.itemCatFilterGroup.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.itemCatFilterGroup.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.itemFilter.cat = btn.dataset.cat;
        renderItems();
      });
    });
  }

  if (dom.itemLocalSearch) {
    dom.itemLocalSearch.addEventListener('input', (e) => {
      state.itemFilter.search = e.target.value.trim();
      renderItems();
    });
  }

  if (dom.itemSortSelect) {
    dom.itemSortSelect.addEventListener('change', (e) => {
      state.itemFilter.sort = e.target.value;
      renderItems();
    });
  }

  // -------------------------------------------------------------
  // 3. 走势榜单 (Meta Trends & Leaderboard)
  // -------------------------------------------------------------
  function renderMeta() {
    if (!dom.metaTableBody) return;
    const { bracket, pos, sortKey, sortAsc } = state.metaFilter;

    let list = heroes.map((h) => {
      let wr = h.trends?.overall_winrate || 50.0;
      let picks = h.trends?.pub_picks || 0;

      if (bracket === 'turbo') {
        wr = h.trends?.turbo_winrate || 50.0;
        picks = h.trends?.turbo_picks || 0;
      } else if (bracket !== 'overall') {
        const bIdx = parseInt(bracket, 10);
        const bData = h.trends?.brackets?.[bIdx];
        if (bData) {
          wr = bData.winrate;
          picks = bData.picks;
        }
      }

      const topPos = h.trends?.positions?.[0];
      const avg = h.trends?.avg_stats || {};

      return {
        hero: h,
        wr,
        picks,
        topPos,
        avg
      };
    });

    // 过滤常见位置
    if (pos !== 'all') {
      const pNum = parseInt(pos, 10);
      list = list.filter((item) => item.topPos && item.topPos.pos === pNum);
    }

    // 排序
    list.sort((a, b) => {
      let res = 0;
      if (sortKey === 'winrate') res = a.wr - b.wr;
      else if (sortKey === 'picks') res = a.picks - b.picks;
      else if (sortKey === 'name') res = a.hero.name_loc.localeCompare(b.hero.name_loc, 'zh');
      else if (sortKey === 'pos') res = (a.topPos?.pos || 9) - (b.topPos?.pos || 9);
      else if (sortKey === 'kda') {
        const kdaA = ((a.avg.kills || 0) + (a.avg.assists || 0)) / Math.max(1, a.avg.deaths || 1);
        const kdaB = ((b.avg.kills || 0) + (b.avg.assists || 0)) / Math.max(1, b.avg.deaths || 1);
        res = kdaA - kdaB;
      } else if (sortKey === 'gpm') {
        res = (a.avg.gpm || 0) - (b.avg.gpm || 0);
      } else {
        res = a.hero.id - b.hero.id;
      }
      return sortAsc ? res : -res;
    });

    const tbodyHtml = list
      .map((row, idx) => {
        const h = row.hero;
        const wrClass = getWinrateClass(row.wr);
        const barPct = Math.min(100, Math.max(0, (row.wr - 40) * 5)); // 40%~60% scale

        // 核心出装前4件展示
        const coreItems = (h.trends?.item_builds?.core || []).slice(0, 4);
        const itemIconsHtml = coreItems
          .map((c) => {
            const it = itemMapById.get(c.item_id);
            if (!it) return '';
            return `<img src="${it.icon}" alt="${escapeHtml(it.name_loc)}" title="${escapeHtml(it.name_loc)} (胜率 ${c.winrate}%)" data-item-id="${it.id}" />`;
          })
          .join('');

        const posLabel = row.topPos ? `${row.topPos.pos}号位 (${row.topPos.pick_share}%)` : '-';

        return `
        <tr>
          <td style="font-weight:700; color:var(--text-muted);">${idx + 1}</td>
          <td>
            <div class="meta-hero-cell" data-hero-id="${h.id}">
              <img src="${h.avatar}" alt="${escapeHtml(h.name_loc)}" loading="lazy" />
              <div>
                <div style="font-weight:700; color:#fff;">${escapeHtml(h.name_loc)}</div>
                <div style="font-size:0.72rem; color:var(--text-secondary);">${escapeHtml(h.name_en)}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="pos-tag">${posLabel}</span>
          </td>
          <td>
            <div class="wr-bar-wrap">
              <span class="wr-pill ${wrClass}">${formatPct(row.wr)}</span>
              <div class="wr-bar-track">
                <div class="wr-bar-fill" style="width:${barPct}%; background:${row.wr >= 50 ? 'var(--win-high)' : 'var(--win-low)'};"></div>
              </div>
            </div>
          </td>
          <td>
            <div style="font-weight:600;">${formatNumber(row.picks)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted);">热度基准</div>
          </td>
          <td>
            <div style="font-weight:600; color:var(--text-primary);">${row.avg.kills || 0} / <span style="color:#f87171;">${row.avg.deaths || 0}</span> / ${row.avg.assists || 0}</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">KDA: ${(((row.avg.kills || 0) + (row.avg.assists || 0)) / Math.max(1, row.avg.deaths || 1)).toFixed(2)}</div>
          </td>
          <td>
            <div style="font-weight:700; color:var(--accent-gold);">${row.avg.gpm || 0} GPM</div>
            <div style="font-size:0.72rem; color:var(--text-muted);">${row.avg.xpm || 0} XPM</div>
          </td>
          <td>
            <div class="meta-items-row">
              ${itemIconsHtml || '<span style="color:var(--text-muted);font-size:0.75rem;">暂缺</span>'}
            </div>
          </td>
        </tr>
      `;
      })
      .join('');

    dom.metaTableBody.innerHTML = tbodyHtml;

    // 绑定表格内英雄点击和物品点击
    dom.metaTableBody.querySelectorAll('.meta-hero-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        const hid = parseInt(cell.dataset.heroId, 10);
        openHeroModal(hid);
      });
    });

    dom.metaTableBody.querySelectorAll('.meta-items-row img').forEach((img) => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const iid = parseInt(img.dataset.itemId, 10);
        openItemModal(iid);
      });
    });
  }

  // 天梯分段与榜单事件绑定
  if (dom.metaBracketGroup) {
    dom.metaBracketGroup.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.metaBracketGroup.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.metaFilter.bracket = btn.dataset.bracket;
        renderMeta();
      });
    });
  }

  if (dom.metaPosFilter) {
    dom.metaPosFilter.addEventListener('change', (e) => {
      state.metaFilter.pos = e.target.value;
      renderMeta();
    });
  }

  if (dom.metaTableHeaders) {
    dom.metaTableHeaders.forEach((th) => {
      th.addEventListener('click', () => {
        const sortKey = th.dataset.sort;
        if (state.metaFilter.sortKey === sortKey) {
          state.metaFilter.sortAsc = !state.metaFilter.sortAsc;
        } else {
          state.metaFilter.sortKey = sortKey;
          state.metaFilter.sortAsc = false;
        }
        renderMeta();
      });
    });
  }

  // -------------------------------------------------------------
  // 4. 7.41f 版本日志中心 (Patch Hub)
  // -------------------------------------------------------------
  function renderPatchHub() {
    if (!dom.patchHubContainer) return;
    const pVer = state.selectedPatch;
    const pData = patches.find((p) => p.version === pVer);

    if (!pData) {
      dom.patchHubContainer.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted);">未找到 ${escapeHtml(pVer)} 版本数据</div>`;
      return;
    }

    // 通用改动
    let genHtml = '';
    if (pData.general_sections && pData.general_sections.length > 0) {
      genHtml = `
        <div class="trend-panel">
          <div class="trend-panel-title">📜 ${escapeHtml(pVer)} 通用机制与全局改动</div>
          <div style="display:flex;flex-direction:column;gap:16px;">
            ${pData.general_sections
              .map(
                (sec) => `
              <div>
                <div style="font-weight:700;color:var(--accent-gold);margin-bottom:6px;">${escapeHtml(sec.title)}</div>
                <ul class="patch-notes-ul">
                  ${sec.notes.map((n) => `<li>${n}</li>`).join('')}
                </ul>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }

    // 英雄调整列表
    const changedHeroes = (pData.hero_ids || [])
      .map((hid) => heroMapById.get(hid))
      .filter(Boolean);

    let heroesChangeHtml = '';
    if (changedHeroes.length > 0) {
      heroesChangeHtml = `
        <div class="trend-panel">
          <div class="trend-panel-title">🛡️ 涉及调整的英雄 (${changedHeroes.length} 位) - 点击查看详情</div>
          <div class="patch-history-stack">
            ${changedHeroes
              .map((h) => {
                const patchEntry = (h.patch_notes || []).find((pn) => pn.version === pVer);
                if (!patchEntry) return '';
                const hNotes = (patchEntry.hero_notes || []).map((n) => `<li>${n}</li>`).join('');
                const abNotes = (patchEntry.abilities || [])
                  .map(
                    (ab) => `
                  <li style="margin-top:4px;">
                    <strong style="color:#fff;">${escapeHtml(ab.name_loc)}:</strong>
                    ${ab.notes.join('； ')}
                  </li>
                `
                  )
                  .join('');
                const talNotes = (patchEntry.talent_notes || []).map((n) => `<li><strong>天赋：</strong>${n}</li>`).join('');

                return `
                <div class="patch-entry-card" style="cursor:pointer;" onclick="window.DotaApp.openHero(${h.id})">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    <img src="${h.avatar}" alt="${escapeHtml(h.name_loc)}" style="width:42px;height:24px;border-radius:4px;object-fit:cover;" />
                    <span style="font-weight:700;font-size:0.95rem;color:#fff;">${escapeHtml(h.name_loc)}</span>
                    <span style="font-size:0.75rem;color:var(--text-secondary);">${escapeHtml(h.name_en)}</span>
                  </div>
                  <ul class="patch-notes-ul">
                    ${hNotes}
                    ${abNotes}
                    ${talNotes}
                  </ul>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    // 物品调整列表
    const changedItems = (pData.item_ids || [])
      .map((iid) => itemMapById.get(iid))
      .filter(Boolean);

    let itemsChangeHtml = '';
    if (changedItems.length > 0) {
      itemsChangeHtml = `
        <div class="trend-panel">
          <div class="trend-panel-title">🎒 涉及调整的物品 (${changedItems.length} 件) - 点击查看图鉴</div>
          <div class="patch-history-stack">
            ${changedItems
              .map((it) => {
                const patchEntry = (it.patch_notes || []).find((pn) => pn.version === pVer);
                if (!patchEntry) return '';
                return `
                <div class="patch-entry-card" style="cursor:pointer;" onclick="window.DotaApp.openItem(${it.id})">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    <img src="${it.icon}" alt="${escapeHtml(it.name_loc)}" style="width:36px;height:26px;border-radius:4px;object-fit:cover;" />
                    <span style="font-weight:700;font-size:0.95rem;color:#fff;">${escapeHtml(it.name_loc)}</span>
                    <span style="font-size:0.75rem;color:var(--text-secondary);">${escapeHtml(it.name_en)}</span>
                  </div>
                  <ul class="patch-notes-ul">
                    ${patchEntry.notes.map((n) => `<li>${n}</li>`).join('')}
                  </ul>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    dom.patchHubContainer.innerHTML = genHtml + heroesChangeHtml + itemsChangeHtml;
  }

  if (dom.patchVersionGroup) {
    dom.patchVersionGroup.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.patchVersionGroup.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedPatch = btn.dataset.patch;
        renderPatchHub();
      });
    });
  }

  // -------------------------------------------------------------
  // 5. 英雄全模态详情弹窗 (Avatar + 立绘 + 属性计算器 + 技能具体数值 + 天赋 + 走势出装)
  // -------------------------------------------------------------
  function openHeroModal(heroId) {
    const h = heroMapById.get(heroId);
    if (!h) return;
    state.modalHero = h;
    state.heroCalcLevel = 1;
    state.portraitMode = 'png';

    renderHeroModalContent();
    dom.modalBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function renderHeroModalContent() {
    const h = state.modalHero;
    if (!h) return;

    const lvl = state.heroCalcLevel;
    const computedStats = computeHeroStats(h, lvl);
    const wr = h.trends?.overall_winrate || 50.0;
    const wrClass = getWinrateClass(wr);

    // 技能列表 HTML
    const abilitiesHtml = (h.abilities || [])
      .map((ab) => {
        const specialValsHtml = (ab.special_values || [])
          .map(
            (sv) => `
          <div class="sv-row">
            <span class="sv-heading">${escapeHtml(sv.heading)}</span>
            <span class="sv-val">${escapeHtml(sv.value)}</span>
          </div>
        `
          )
          .join('');

        let upgradeBlock = '';
        if (ab.has_scepter && ab.scepter_html) {
          upgradeBlock += `
            <div class="ability-upgrade-box scepter">
              <strong>👑 阿哈利姆神杖升级：</strong> ${ab.scepter_html}
            </div>
          `;
        }
        if (ab.has_shard && ab.shard_html) {
          upgradeBlock += `
            <div class="ability-upgrade-box shard">
              <strong>💎 阿哈利姆魔晶升级：</strong> ${ab.shard_html}
            </div>
          `;
        }

        let costBar = '';
        if (ab.cooldown || ab.mana_cost || ab.cast_range) {
          costBar = `
            <div class="ability-cost-bar">
              ${ab.cooldown ? `<span class="cost-cd">⏳ 冷却: ${ab.cooldown}秒</span>` : ''}
              ${ab.mana_cost ? `<span class="cost-mana">💧 魔法: ${ab.mana_cost}</span>` : ''}
              ${ab.cast_range ? `<span class="cost-range">🎯 距离: ${ab.cast_range}</span>` : ''}
            </div>
          `;
        }

        return `
        <div class="ability-card ${ab.is_innate ? 'is-innate' : ''} ${ab.is_ultimate ? 'is-ultimate' : ''}">
          <div class="ability-top">
            <img class="ability-icon" src="${ab.icon}" alt="${escapeHtml(ab.name_loc)}" loading="lazy" />
            <div class="ability-title-wrap">
              <div class="ability-name-row">
                <span class="ability-name">${escapeHtml(ab.name_loc)}</span>
                ${ab.is_innate ? `<span class="ab-tag innate">先天技能</span>` : ''}
                ${ab.is_ultimate ? `<span class="ab-tag ult">终极技能</span>` : ''}
                ${ab.granted_by_scepter ? `<span class="ab-tag scepter">A杖赋予</span>` : ''}
                ${ab.granted_by_shard ? `<span class="ab-tag shard">魔晶赋予</span>` : ''}
              </div>
              <div class="ability-meta-row">
                ${ab.damage_type ? `<span>伤害: <strong style="color:#f87171;">${ab.damage_type}</strong></span>` : ''}
                ${ab.pierces_bkb ? `<span>无视魔免: <strong>${ab.pierces_bkb}</strong></span>` : ''}
                ${ab.dispellable ? `<span>驱散: <strong>${ab.dispellable}</strong></span>` : ''}
              </div>
            </div>
          </div>

          <div class="ability-desc">${ab.desc_html || ''}</div>
          ${upgradeBlock}
          ${specialValsHtml ? `<div class="ability-sv-list">${specialValsHtml}</div>` : ''}
          ${costBar}
        </div>
      `;
      })
      .join('');

    // 天赋树 HTML (25, 20, 15, 10 级)
    const talentsHtml = (h.talents || [])
      .slice()
      .reverse()
      .map(
        (t) => `
      <div class="talent-row">
        <div class="talent-side left" title="${escapeHtml(t.left)}">${escapeHtml(t.left)}</div>
        <div class="talent-lvl-circle">${t.level}</div>
        <div class="talent-side right" title="${escapeHtml(t.right)}">${escapeHtml(t.right)}</div>
      </div>
    `
      )
      .join('');

    // 常见位置柱状分布
    const posListHtml = (h.trends?.positions || [])
      .map(
        (p) => `
      <div class="bar-row">
        <span style="font-weight:600;color:#fff;">${escapeHtml(p.label)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${p.pick_share}%;"></div>
        </div>
        <span style="text-align:right;">${p.pick_share}% (胜率 ${formatPct(p.winrate)})</span>
      </div>
    `
      )
      .join('');

    // 分段胜率走势
    const bracketListHtml = (h.trends?.brackets || [])
      .map((b) => {
        const bWrClass = getWinrateClass(b.winrate);
        const bPct = Math.min(100, Math.max(0, (b.winrate - 40) * 5));
        return `
        <div class="bar-row">
          <span style="color:var(--text-secondary);">${escapeHtml(b.name)}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${bPct}%;background:${b.winrate >= 50 ? 'var(--win-high)' : 'var(--win-low)'};"></div>
          </div>
          <span class="wr-pill ${bWrClass}" style="text-align:right;">${formatPct(b.winrate)}</span>
        </div>
      `;
      })
      .join('');

    // 分阶段出装
    const builds = h.trends?.item_builds || {};
    const renderBuildPills = (arr, isNeutral = false) => {
      if (!arr || arr.length === 0) return '<span style="color:var(--text-muted);font-size:0.75rem;">暂无推荐</span>';
      return arr
        .map((x) => {
          const iid = typeof x === 'object' ? x.item_id : x;
          const it = itemMapById.get(iid);
          if (!it) return '';
          const subText = typeof x === 'object' && x.winrate ? `胜率 ${x.winrate}%` : it.neutral_tier ? `T${it.neutral_tier} 中立` : `${it.cost} 金`;
          return `
          <div class="build-item-pill" data-item-id="${it.id}">
            <img src="${it.icon}" alt="${escapeHtml(it.name_loc)}" loading="lazy" />
            <div class="build-item-meta">
              <span class="build-item-name">${escapeHtml(it.name_loc)}</span>
              <span class="build-item-sub">${subText}</span>
            </div>
          </div>
        `;
        })
        .join('');
    };

    // 技能加点路线
    const skillSeqHtml = (h.trends?.skill_build || [])
      .map((abId, idx) => {
        const ab = (h.abilities || []).find((a) => a.id === abId);
        if (!ab) return '';
        return `
        <div class="skill-step" title="${escapeHtml(ab.name_loc)}">
          <span class="skill-step-lvl">Lv.${idx + 1}</span>
          <img src="${ab.icon}" alt="${escapeHtml(ab.name_loc)}" />
        </div>
      `;
      })
      .join('');

    // 历史补丁改动 (7.41 系列)
    const patchHistoryHtml = (h.patch_notes || [])
      .map((pn) => {
        const notes = (pn.hero_notes || []).map((n) => `<li>${n}</li>`).join('');
        const abNotes = (pn.abilities || [])
          .map((a) => `<li><strong>${escapeHtml(a.name_loc)}:</strong> ${a.notes.join('； ')}</li>`)
          .join('');
        const tNotes = (pn.talent_notes || []).map((n) => `<li><strong>天赋:</strong> ${n}</li>`).join('');
        return `
        <div class="patch-entry-card">
          <span class="patch-ver-badge">${pn.version} 平衡性调整</span>
          <ul class="patch-notes-ul">
            ${notes}
            ${abNotes}
            ${tNotes}
          </ul>
        </div>
      `;
      })
      .join('');

    dom.modalContentRoot.innerHTML = `
      <!-- 英雄大头照 & 立绘 & 属性计算器展示顶栏 -->
      <div class="hero-detail-header">
        <div class="hero-header-left">
          <div class="hero-identity-row">
            <img class="hero-avatar-large" src="${h.avatar}" alt="${escapeHtml(h.name_loc)}" />
            <div class="hero-title-group">
              <h1>
                <span>${escapeHtml(h.name_loc)}</span>
                <span class="hero-attr-badge">
                  <span class="attr-dot ${h.primary_attr_key}"></span>
                  ${h.primary_attr_loc}
                </span>
              </h1>
              <div class="hero-title-en">${escapeHtml(h.name_en)} · ${h.attack_type_loc} · 难度等级 ${'★'.repeat(h.complexity || 1)}</div>
            </div>
          </div>

          <div class="hero-badges-bar">
            <span class="badge-tag">全分段胜率: <strong class="wr-pill ${wrClass}">${formatPct(wr)}</strong></span>
            <span class="badge-tag">登场次数: <strong>${formatNumber(h.trends?.pub_picks)}</strong></span>
            <span class="badge-tag">加速胜率: <strong>${formatPct(h.trends?.turbo_winrate)}</strong></span>
            <span class="badge-tag">首选分路: <strong>${h.trends?.primary_position?.label || '核心/辅助'}</strong></span>
          </div>

          ${h.hype ? `<div class="hero-hype-box">${h.hype}</div>` : ''}

          <!-- 等级 1-30 实时属性计算器 -->
          <div class="lvl-calc-box">
            <div class="lvl-slider-header">
              <span class="lvl-slider-title">📊 英雄等级实时数值计算器: <span id="heroLvlDisplay" style="color:#fff;font-size:1.05rem;">Lv.${lvl}</span></span>
              <div class="lvl-quick-btns">
                <button class="lvl-qbtn ${lvl === 1 ? 'active' : ''}" data-lvl="1">Lv.1</button>
                <button class="lvl-qbtn ${lvl === 6 ? 'active' : ''}" data-lvl="6">Lv.6</button>
                <button class="lvl-qbtn ${lvl === 12 ? 'active' : ''}" data-lvl="12">Lv.12</button>
                <button class="lvl-qbtn ${lvl === 18 ? 'active' : ''}" data-lvl="18">Lv.18</button>
                <button class="lvl-qbtn ${lvl === 25 ? 'active' : ''}" data-lvl="25">Lv.25</button>
                <button class="lvl-qbtn ${lvl === 30 ? 'active' : ''}" data-lvl="30">Lv.30</button>
              </div>
            </div>
            <input type="range" id="heroLvlRange" class="lvl-range-input" min="1" max="30" value="${lvl}" />

            <div class="stats-grid-compact" id="computedStatsGrid">
              ${renderComputedStatsCells(computedStats, h)}
            </div>
          </div>
        </div>

        <!-- 英雄全身立绘展示台 (支持PNG全身立绘 / WEBM动态立绘切换) -->
        <div class="hero-header-right">
          <div class="portrait-stage">
            <img
              id="heroPortraitImg"
              class="portrait-media"
              src="${h.portrait_png}"
              alt="${escapeHtml(h.name_loc)} 全身立绘"
              loading="lazy"
              onerror="this.src='${h.avatar}'; this.style.maxHeight='240px';"
            />
            <video
              id="heroPortraitVideo"
              class="portrait-media"
              src="${h.portrait_webm}"
              autoplay
              loop
              muted
              playsinline
              style="display:none;"
            ></video>
            <div class="portrait-controls">
              <span class="portrait-label">🎨 7.41f 官方原画立绘</span>
              <button id="togglePortraitModeBtn" class="portrait-mode-btn">切换动态立绘</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 模态框主体内容 -->
      <div class="modal-body">
        <!-- 1. 英雄技能与具体数值 -->
        <div>
          <h3 class="section-heading">⚡ 技能全解与精确数值 (含阿哈利姆神杖/魔晶升级)</h3>
          <div class="abilities-grid">
            ${abilitiesHtml}
          </div>
        </div>

        <!-- 2. 天赋树 -->
        <div>
          <h3 class="section-heading">🌳 天赋树系统 (7.41f 最新数值)</h3>
          <div class="talent-tree-box">
            ${talentsHtml}
          </div>
        </div>

        <!-- 3. 走势：常见位置与分段胜率 -->
        <div>
          <h3 class="section-heading">📈 英雄大数据走势 (常见位置与各天梯分段表现)</h3>
          <div class="trends-two-col">
            <div class="trend-panel">
              <div class="trend-panel-title">🎯 1~5号位 常见位置胜率与登场占比</div>
              <div class="pos-bars-list">
                ${posListHtml}
              </div>
            </div>

            <div class="trend-panel">
              <div class="trend-panel-title">🏆 各天梯分段胜率走势 (先锋 ~ 超凡/冠绝)</div>
              <div class="bracket-bars-list">
                ${bracketListHtml}
              </div>
            </div>
          </div>
        </div>

        <!-- 4. 出装攻略与加点推荐 -->
        <div>
          <h3 class="section-heading">🛡️ 7.41f 推荐出装攻略与技能加点路线</h3>
          <div class="build-phases-grid">
            <div class="build-phase-card">
              <div class="build-phase-title"><span>出门装备 (Starting)</span></div>
              <div class="build-items-list">${renderBuildPills(builds.starting)}</div>
            </div>

            <div class="build-phase-card">
              <div class="build-phase-title"><span>前期对线 (Early Game)</span></div>
              <div class="build-items-list">${renderBuildPills(builds.early)}</div>
            </div>

            <div class="build-phase-card">
              <div class="build-phase-title"><span>核心装备 (Core Items)</span></div>
              <div class="build-items-list">${renderBuildPills(builds.core)}</div>
            </div>

            <div class="build-phase-card">
              <div class="build-phase-title"><span>后期神装与备选 (Luxury &amp; Situational)</span></div>
              <div class="build-items-list">${renderBuildPills(builds.luxury)}</div>
            </div>

            <div class="build-phase-card" style="grid-column: 1/-1;">
              <div class="build-phase-title"><span>优选契合中立物品 (Neutral Items)</span></div>
              <div class="build-items-list">${renderBuildPills(builds.neutral, true)}</div>
            </div>
          </div>

          ${
            skillSeqHtml
              ? `
            <div class="trend-panel" style="margin-top:16px;">
              <div class="trend-panel-title">🎛️ 常规技能加点顺序 (前15级升级参考)</div>
              <div class="skill-seq-row">${skillSeqHtml}</div>
            </div>
          `
              : ''
          }
        </div>

        <!-- 5. 7.41 系列补丁历史 -->
        ${
          patchHistoryHtml
            ? `
          <div>
            <h3 class="section-heading">📜 该英雄 7.41 系列更新与改动历史</h3>
            <div class="patch-history-stack">
              ${patchHistoryHtml}
            </div>
          </div>
        `
            : ''
        }

        <!-- 6. 英雄背景传记 -->
        ${
          h.bio
            ? `
          <div>
            <h3 class="section-heading">📖 英雄背景传记</h3>
            <div style="font-size:0.88rem;color:var(--text-secondary);line-height:1.7;background:var(--bg-panel);padding:18px 22px;border-radius:10px;border:1px solid var(--border-subtle);">
              ${h.bio.replace(/\n\n/g, '<br/><br/>')}
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;

    // 绑定模态框内部交互
    bindHeroModalEvents(h);
  }

  function bindHeroModalEvents(h) {
    const range = document.getElementById('heroLvlRange');
    const display = document.getElementById('heroLvlDisplay');
    const statsGrid = document.getElementById('computedStatsGrid');

    const updateStats = (newVal) => {
      state.heroCalcLevel = parseInt(newVal, 10);
      if (display) display.textContent = `Lv.${state.heroCalcLevel}`;
      const computed = computeHeroStats(h, state.heroCalcLevel);
      if (statsGrid) statsGrid.innerHTML = renderComputedStatsCells(computed, h);

      // 更新快捷按钮高亮
      document.querySelectorAll('.lvl-qbtn').forEach((btn) => {
        btn.classList.toggle('active', parseInt(btn.dataset.lvl, 10) === state.heroCalcLevel);
      });
    };

    if (range) {
      range.addEventListener('input', (e) => updateStats(e.target.value));
    }

    document.querySelectorAll('.lvl-qbtn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetLvl = parseInt(btn.dataset.lvl, 10);
        if (range) range.value = targetLvl;
        updateStats(targetLvl);
      });
    });

    // 切换动态立绘
    const toggleBtn = document.getElementById('togglePortraitModeBtn');
    const pImg = document.getElementById('heroPortraitImg');
    const pVideo = document.getElementById('heroPortraitVideo');

    if (toggleBtn && pImg && pVideo) {
      toggleBtn.addEventListener('click', () => {
        if (state.portraitMode === 'png') {
          state.portraitMode = 'webm';
          pImg.style.display = 'none';
          pVideo.style.display = 'block';
          pVideo.play().catch(() => {});
          toggleBtn.textContent = '切换静态立绘';
        } else {
          state.portraitMode = 'png';
          pVideo.style.display = 'none';
          pImg.style.display = 'block';
          toggleBtn.textContent = '切换动态立绘';
        }
      });
    }

    // 点击出装小药丸跳转对应物品详情
    dom.modalContentRoot.querySelectorAll('.build-item-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const iid = parseInt(pill.dataset.itemId, 10);
        openItemModal(iid);
      });
    });
  }

  // 1~30 级英雄属性计算引擎
  function computeHeroStats(h, lvl) {
    const s = h.stats || {};
    const lvlOffset = lvl - 1;

    const str = s.str_base + s.str_gain * lvlOffset;
    const agi = s.agi_base + s.agi_gain * lvlOffset;
    const int = s.int_base + s.int_gain * lvlOffset;

    // 生命与魔法
    const hp = Math.floor(s.max_health + (str - s.str_base) * 22);
    const hpRegen = (s.health_regen + (str - s.str_base) * 0.1).toFixed(1);
    const mana = Math.floor(s.max_mana + (int - s.int_base) * 12);
    const manaRegen = (s.mana_regen + (int - s.int_base) * 0.05).toFixed(1);

    // 护甲与攻速
    const armor = (s.armor + (agi - s.agi_base) * 0.167).toFixed(1);

    // 攻击力 (根据主属性加成)
    let bonusDmg = 0;
    if (h.primary_attr === 0) bonusDmg = str - s.str_base;
    else if (h.primary_attr === 1) bonusDmg = agi - s.agi_base;
    else if (h.primary_attr === 2) bonusDmg = int - s.int_base;
    else if (h.primary_attr === 3) bonusDmg = (str + agi + int - (s.str_base + s.agi_base + s.int_base)) * 0.7;

    const dmgMin = Math.round(s.damage_min + bonusDmg);
    const dmgMax = Math.round(s.damage_max + bonusDmg);

    return {
      lvl,
      str: Math.floor(str),
      agi: Math.floor(agi),
      int: Math.floor(int),
      hp,
      hpRegen,
      mana,
      manaRegen,
      armor,
      dmgMin,
      dmgMax,
      moveSpeed: s.movement_speed,
      attackRate: s.attack_rate,
      attackRange: s.attack_range
    };
  }

  function renderComputedStatsCells(c, h) {
    const s = h.stats || {};
    return `
      <div class="stat-cell">
        <div class="stat-cell-label" style="color:var(--attr-str);">力量 (Strength)</div>
        <div class="stat-cell-val" style="color:var(--attr-str);">${c.str}</div>
        <div class="stat-cell-sub">+${s.str_gain}/级</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label" style="color:var(--attr-agi);">敏捷 (Agility)</div>
        <div class="stat-cell-val" style="color:var(--attr-agi);">${c.agi}</div>
        <div class="stat-cell-sub">+${s.agi_gain}/级</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label" style="color:var(--attr-int);">智力 (Intelligence)</div>
        <div class="stat-cell-val" style="color:var(--attr-int);">${c.int}</div>
        <div class="stat-cell-sub">+${s.int_gain}/级</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">基础攻击力</div>
        <div class="stat-cell-val" style="color:var(--accent-gold);">${c.dmgMin} ~ ${c.dmgMax}</div>
        <div class="stat-cell-sub">${h.attack_type_loc} (${c.attackRange})</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">生命值 / 恢复</div>
        <div class="stat-cell-val" style="color:var(--win-high);">${c.hp}</div>
        <div class="stat-cell-sub">+${c.hpRegen}/秒</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">魔法值 / 恢复</div>
        <div class="stat-cell-val" style="color:var(--accent-scepter);">${c.mana}</div>
        <div class="stat-cell-sub">+${c.manaRegen}/秒</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">物理护甲</div>
        <div class="stat-cell-val">${c.armor}</div>
        <div class="stat-cell-sub">魔抗: ${s.magic_resistance}%</div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-label">移动速度</div>
        <div class="stat-cell-val">${c.moveSpeed}</div>
        <div class="stat-cell-sub">攻击间隔: ${c.attackRate}s</div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // 6. 物品模态详情弹窗 (图标 + 属性数值 + 合成配方与向上合成 + 适用热门英雄)
  // -------------------------------------------------------------
  function openItemModal(itemId) {
    const it = itemMapById.get(itemId);
    if (!it) return;
    state.modalItem = it;

    renderItemModalContent();
    dom.modalBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function renderItemModalContent() {
    const it = state.modalItem;
    if (!it) return;

    // 属性加成列表
    const attribHtml = (it.attributes || [])
      .map(
        (a) => `
      <div class="sv-row">
        <span class="sv-heading">${escapeHtml(a.heading)}</span>
        <span class="sv-val" style="color:#4ade80;">${escapeHtml(a.value)}</span>
      </div>
    `
      )
      .join('');

    // 合成配方配件列表 (components)
    let compHtml = '';
    if (it.components && it.components.length > 0) {
      const compPills = it.components
        .map((cid) => {
          const compItem = itemMapById.get(cid);
          if (!compItem) return '';
          return `
          <div class="build-item-pill" data-item-id="${compItem.id}">
            <img src="${compItem.icon}" alt="${escapeHtml(compItem.name_loc)}" />
            <div class="build-item-meta">
              <span class="build-item-name">${escapeHtml(compItem.name_loc)}</span>
              <span class="build-item-sub">${compItem.cost} 金</span>
            </div>
          </div>
        `;
        })
        .join('');

      compHtml = `
        <div class="trend-panel" style="margin-top:14px;">
          <div class="trend-panel-title">🧩 配方配件组成 (点击可查看配件详情)</div>
          <div class="build-items-list">
            ${compPills}
            ${
              it.recipe_cost > 0
                ? `
              <div class="build-item-pill" style="cursor:default;">
                <div class="build-item-meta">
                  <span class="build-item-name">📜 合成图纸</span>
                  <span class="build-item-sub">${it.recipe_cost} 金</span>
                </div>
              </div>
            `
                : ''
            }
          </div>
        </div>
      `;
    }

    // 向上合成树 (builds_into)
    let buildsIntoHtml = '';
    if (it.builds_into && it.builds_into.length > 0) {
      const buildPills = it.builds_into
        .map((bid) => {
          const targetItem = itemMapById.get(bid);
          if (!targetItem) return '';
          return `
          <div class="build-item-pill" data-item-id="${targetItem.id}">
            <img src="${targetItem.icon}" alt="${escapeHtml(targetItem.name_loc)}" />
            <div class="build-item-meta">
              <span class="build-item-name">${escapeHtml(targetItem.name_loc)}</span>
              <span class="build-item-sub">${targetItem.cost} 金</span>
            </div>
          </div>
        `;
        })
        .join('');

      buildsIntoHtml = `
        <div class="trend-panel" style="margin-top:14px;">
          <div class="trend-panel-title">⏫ 可用于向上合成的神装与进阶道具</div>
          <div class="build-items-list">${buildPills}</div>
        </div>
      `;
    }

    // 最常出这件装备的热门英雄 (top_heroes)
    let topHeroesHtml = '';
    if (it.top_heroes && it.top_heroes.length > 0) {
      const heroCardsHtml = it.top_heroes
        .map((th) => {
          const h = heroMapById.get(th.hero_id);
          if (!h) return '';
          return `
          <div class="build-item-pill" data-hero-id="${h.id}">
            <img src="${h.avatar}" alt="${escapeHtml(h.name_loc)}" />
            <div class="build-item-meta">
              <span class="build-item-name">${escapeHtml(h.name_loc)}</span>
              <span class="build-item-sub">胜率 ${th.winrate}% (${th.picks}场)</span>
            </div>
          </div>
        `;
        })
        .join('');

      topHeroesHtml = `
        <div class="trend-panel" style="margin-top:14px;">
          <div class="trend-panel-title">🛡️ 该装备核心契合英雄 (胜率榜)</div>
          <div class="build-items-list">${heroCardsHtml}</div>
        </div>
      `;
    }

    // 物品 7.41f 补丁日志
    let patchNotesHtml = '';
    if (it.patch_notes && it.patch_notes.length > 0) {
      patchNotesHtml = `
        <div class="trend-panel" style="margin-top:14px;">
          <div class="trend-panel-title">📜 7.41 系列补丁改动</div>
          <div class="patch-history-stack">
            ${it.patch_notes
              .map(
                (pn) => `
              <div class="patch-entry-card">
                <span class="patch-ver-badge">${pn.version} 平衡性调整</span>
                <ul class="patch-notes-ul">
                  ${pn.notes.map((n) => `<li>${n}</li>`).join('')}
                </ul>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }

    dom.modalContentRoot.innerHTML = `
      <div class="hero-detail-header" style="grid-template-columns: 1fr;">
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
          <div class="item-card-img-wrap" style="width:84px;height:62px;border:2px solid var(--accent-gold);border-radius:8px;">
            <img src="${it.icon}" alt="${escapeHtml(it.name_loc)}" style="width:100%;height:100%;object-fit:cover;" />
          </div>
          <div>
            <h1 style="font-size:1.8rem;color:#fff;">${escapeHtml(it.name_loc)}</h1>
            <div style="color:var(--accent-gold);font-size:0.9rem;">${escapeHtml(it.name_en)} · ${it.category_loc}</div>
            <div style="margin-top:6px;display:flex;gap:12px;align-items:center;">
              ${
                it.neutral_tier
                  ? `<span class="tier-pill tier-${it.neutral_tier}">第 ${it.neutral_tier} 级中立物品</span>`
                  : `<span style="color:#facc15;font-weight:800;display:flex;align-items:center;gap:5px;"><span class="gold-coin"></span>${it.cost} 购买金币</span>`
              }
              ${it.cooldown ? `<span style="color:#94a3b8;font-size:0.8rem;">⏳ 冷却: ${it.cooldown}秒</span>` : ''}
              ${it.mana_cost ? `<span style="color:#38bdf8;font-size:0.8rem;">💧 消耗: ${it.mana_cost}</span>` : ''}
              ${it.cast_range ? `<span style="color:#c084fc;font-size:0.8rem;">🎯 施法距离: ${it.cast_range}</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="modal-body">
        <!-- 物品效果与属性 -->
        <div class="trend-panel">
          <div class="trend-panel-title">✨ 主动/被动效果与属性数值</div>
          ${attribHtml ? `<div class="ability-sv-list" style="margin-bottom:14px;">${attribHtml}</div>` : ''}
          <div class="ability-desc" style="font-size:0.92rem;line-height:1.6;">
            ${it.desc_html || '<span style="color:var(--text-muted);">暂无额外效果说明</span>'}
          </div>
          ${
            it.notes && it.notes.length > 0
              ? `
            <div style="margin-top:12px;background:rgba(0,0,0,0.3);padding:10px 14px;border-radius:7px;border-left:3px solid var(--accent-gold);font-size:0.82rem;color:var(--text-secondary);">
              <strong>使用提示：</strong> ${it.notes.join('； ')}
            </div>
          `
              : ''
          }
        </div>

        ${compHtml}
        ${buildsIntoHtml}
        ${topHeroesHtml}
        ${patchNotesHtml}

        ${
          it.lore
            ? `
          <div style="font-size:0.82rem;color:var(--text-muted);font-style:italic;padding:8px 12px;">
            "${escapeHtml(it.lore)}"
          </div>
        `
            : ''
        }
      </div>
    `;

    // 绑定内部点击
    dom.modalContentRoot.querySelectorAll('.build-item-pill[data-item-id]').forEach((pill) => {
      pill.addEventListener('click', () => {
        const iid = parseInt(pill.dataset.itemId, 10);
        openItemModal(iid);
      });
    });

    dom.modalContentRoot.querySelectorAll('.build-item-pill[data-hero-id]').forEach((pill) => {
      pill.addEventListener('click', () => {
        const hid = parseInt(pill.dataset.heroId, 10);
        openHeroModal(hid);
      });
    });
  }

  // 关闭模态框
  function closeModal() {
    dom.modalBackdrop.classList.remove('open');
    dom.modalContentRoot.innerHTML = '';
    state.modalHero = null;
    state.modalItem = null;
    document.body.style.overflow = '';
  }

  if (dom.modalCloseBtn) dom.modalCloseBtn.addEventListener('click', closeModal);
  if (dom.modalBackdrop) {
    dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.modalBackdrop) closeModal();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.modalBackdrop.classList.contains('open')) {
      closeModal();
    }
  });

  // -------------------------------------------------------------
  // 7. 顶部全局快速搜索 (快捷键 / 或 Ctrl+K)
  // -------------------------------------------------------------
  if (dom.globalSearchInput && dom.quickSearchDropdown) {
    dom.globalSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        dom.quickSearchDropdown.classList.remove('open');
        dom.quickSearchDropdown.innerHTML = '';
        return;
      }

      // 匹配英雄
      const matchedHeroes = heroes
        .filter(
          (h) =>
            (h.name_loc && h.name_loc.toLowerCase().includes(q)) ||
            (h.name_en && h.name_en.toLowerCase().includes(q)) ||
            (h.short_name && h.short_name.toLowerCase().includes(q))
        )
        .slice(0, 6);

      // 匹配物品
      const matchedItems = items
        .filter(
          (it) =>
            (it.name_loc && it.name_loc.toLowerCase().includes(q)) ||
            (it.name_en && it.name_en.toLowerCase().includes(q)) ||
            (it.short_name && it.short_name.toLowerCase().includes(q))
        )
        .slice(0, 6);

      if (matchedHeroes.length === 0 && matchedItems.length === 0) {
        dom.quickSearchDropdown.innerHTML = `
          <div style="padding:14px;text-align:center;color:var(--text-muted);font-size:0.84rem;">
            未找到包含 "${escapeHtml(q)}" 的英雄或物品
          </div>
        `;
        dom.quickSearchDropdown.classList.add('open');
        return;
      }

      let resHtml = '';
      if (matchedHeroes.length > 0) {
        resHtml += `<div style="padding:6px 12px;font-size:0.7rem;color:var(--accent-gold);font-weight:700;text-transform:uppercase;">英雄</div>`;
        resHtml += matchedHeroes
          .map(
            (h) => `
          <div class="qs-item" data-type="hero" data-id="${h.id}">
            <img src="${h.avatar}" alt="${escapeHtml(h.name_loc)}" />
            <div class="qs-info">
              <div class="qs-title">${escapeHtml(h.name_loc)}</div>
              <div class="qs-sub">${escapeHtml(h.name_en)} · ${h.primary_attr_loc}</div>
            </div>
            <span class="qs-badge">胜率 ${formatPct(h.trends?.overall_winrate)}</span>
          </div>
        `
          )
          .join('');
      }

      if (matchedItems.length > 0) {
        resHtml += `<div style="padding:6px 12px;font-size:0.7rem;color:var(--accent-gold);font-weight:700;text-transform:uppercase;border-top:1px solid rgba(255,255,255,0.06);">物品</div>`;
        resHtml += matchedItems
          .map(
            (it) => `
          <div class="qs-item" data-type="item" data-id="${it.id}">
            <img src="${it.icon}" alt="${escapeHtml(it.name_loc)}" />
            <div class="qs-info">
              <div class="qs-title">${escapeHtml(it.name_loc)}</div>
              <div class="qs-sub">${escapeHtml(it.name_en)}</div>
            </div>
            <span class="qs-badge">${it.neutral_tier ? `T${it.neutral_tier} 中立` : `${it.cost} 金`}</span>
          </div>
        `
          )
          .join('');
      }

      dom.quickSearchDropdown.innerHTML = resHtml;
      dom.quickSearchDropdown.classList.add('open');

      dom.quickSearchDropdown.querySelectorAll('.qs-item').forEach((item) => {
        item.addEventListener('click', () => {
          const type = item.dataset.type;
          const id = parseInt(item.dataset.id, 10);
          dom.quickSearchDropdown.classList.remove('open');
          dom.globalSearchInput.value = '';
          if (type === 'hero') openHeroModal(id);
          else if (type === 'item') openItemModal(id);
        });
      });
    });

    document.addEventListener('click', (e) => {
      if (!dom.globalSearchInput.contains(e.target) && !dom.quickSearchDropdown.contains(e.target)) {
        dom.quickSearchDropdown.classList.remove('open');
      }
    });

    // 快捷键支持
    window.addEventListener('keydown', (e) => {
      if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) && document.activeElement !== dom.globalSearchInput) {
        e.preventDefault();
        dom.globalSearchInput.focus();
        dom.globalSearchInput.select();
      }
    });
  }

  // -------------------------------------------------------------
  // 全局暴露 API 供 HTML 内联事件调用
  // -------------------------------------------------------------
  window.DotaApp = {
    openHero: openHeroModal,
    openItem: openItemModal,
    switchTab
  };

  // 默认渲染首页英雄列表
  renderHeroes();
})();
