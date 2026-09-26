const context = SillyTavern.getContext();
const { eventSource, event_types } = context;

const MODULE = 'affection_meter';

const AFF_RE = /\{\{AFF\|([^}]*)\}\}\s*$/;
const ITEM_RE = /^\s*(.+?)\s*:\s*([+-]?\d+)\s*$/;

const DEFAULT_SETTINGS = {
    autoEnabled: true,
    injectEnabled: true,
    manualStep: 5,
    maxValue: 100,
    charDisplay: '',
    showSideBtn: true,
    dynamicActive: true,
    activeLookback: 6,
    ignored: [],
    rulesText: '当一方对另一方好感度低于20时，态度疏离冷淡，保持距离；20-40礼貌但拘谨；40-60自然熟络，开始主动关心；60-80亲密无间，会吃醋会撒娇；80以上毫无保留，身心交付。',
    levelRanges: [
        { max: 20, label: '陌生', desc: '彼此还很生疏，客套而疏离。' },
        { max: 40, label: '冷淡', desc: '有些熟悉，但仍保持距离。' },
        { max: 60, label: '熟络', desc: '相处自然，有来有往。' },
        { max: 80, label: '亲近', desc: '关系亲密，会互相关心。' },
        { max: 100, label: '沦陷', desc: '全身心交付，无法抗拒。' },
    ],
    pairDefs: [
        { id: 'char->user', a: 'char', b: 'user', init: 0 },
        { id: 'user->char', a: 'user', b: 'char', init: 0 },
    ],
};

function getSettings() {
    if (!context.extensionSettings[MODULE]) {
        context.extensionSettings[MODULE] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = context.extensionSettings[MODULE];
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(s, k)) s[k] = structuredClone(DEFAULT_SETTINGS[k]);
    }
    return s;
}

function getChatData() {
    if (!context.chatMetadata[MODULE]) {
        const s = getSettings();
        const pairs = {};
        for (const def of s.pairDefs) {
            pairs[def.id] = { value: clamp(def.init ?? 0, 0, s.maxValue) };
        }
        context.chatMetadata[MODULE] = { version: 2, pairs };
    } else {
        const s = getSettings();
        const data = context.chatMetadata[MODULE];
        if (!data.pairs) data.pairs = {};
        for (const def of s.pairDefs) {
            if (!data.pairs[def.id]) {
                data.pairs[def.id] = { value: clamp(def.init ?? 0, 0, s.maxValue) };
            }
        }
    }
    return context.chatMetadata[MODULE];
}

function saveChat() {
    context.saveMetadata();
}

function clamp(v, min, max) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = min;
    return Math.max(min, Math.min(max, v));
}

function resolveName(type) {
    if (type === 'char') {
        const s = getSettings();
        if (s.charDisplay && s.charDisplay.trim()) return s.charDisplay.trim();
        const ch = context.characters && context.characters[context.characterId];
        return (ch && ch.name) || '角色';
    }
    if (type === 'user') {
        return context.name2 || '你';
    }
    if (typeof type === 'string' && type.startsWith('npc:')) {
        return type.slice(4);
    }
    return type || '?';
}

function typeFromName(name) {
    const s = getSettings();
    const n = String(name).trim();
    if (s.charDisplay && s.charDisplay.trim() && n === s.charDisplay.trim()) return 'char';
    const ch = context.characters && context.characters[context.characterId];
    if (ch && ch.name === n) return 'char';
    if (context.name2 && context.name2 === n) return 'user';
    return `npc:${n}`;
}

function normalizeType(t) {
    if (t === 'char' || t === 'user') return t;
    return `npc:${String(t).replace(/^npc:/, '')}`;
}

function isIgnoredName(name) {
    const s = getSettings();
    const n = String(name).trim().replace(/^npc:/, '');
    if (!n) return false;
    return (s.ignored || []).some(x => String(x).trim() === n);
}

function genPairId(existing) {
    let n = existing.length + 1;
    while (existing.some(d => d.id === `pair${n}`)) n++;
    return `pair${n}`;
}

function getLevelInfo(value) {
    const s = getSettings();
    for (const r of s.levelRanges) {
        if (value <= r.max) return r;
    }
    return s.levelRanges[s.levelRanges.length - 1] || { label: '?', desc: '' };
}

function buildPromptText() {
    const s = getSettings();
    const data = getChatData();
    const lines = [];
    lines.push('【当前角色关系好感度状态】');
    lines.push(`好感度范围 0-${s.maxValue}。请根据剧情自然表现这些数值，角色言行应贴合对应阶段的亲疏程度。`);
    for (const def of s.pairDefs) {
        const pair = data.pairs[def.id];
        if (!pair) continue;
        const aName = resolveName(def.a);
        const bName = resolveName(def.b);
        const lv = getLevelInfo(pair.value);
        lines.push(`- ${aName} → ${bName}：${pair.value}/${s.maxValue}（${lv.label}：${lv.desc}）`);
    }
    if (s.rulesText && s.rulesText.trim()) {
        lines.push('');
        lines.push('【好感度变化规则】');
        lines.push(s.rulesText.trim());
    }
    const ign = (s.ignored || []).filter(Boolean);
    if (ign.length) {
        lines.push('');
        lines.push(`以下角色/关系的好感度【不维护】，不要在标记中提及：${ign.join('、')}`);
    }
    lines.push('');
    lines.push('若某段剧情使好感度发生明显变化，请在回复【正文末尾】附加一行标记（如无变化则省略）：');
    lines.push('{{AFF|角色A→角色B:+5,角色C→角色D:-3}}');
    lines.push('数值前带 + 或 - 表示增减；不带符号表示直接设定为该值（首次建立关系时可按人设设定初始好感，如青梅竹马可直接设定较高值）。');
    lines.push('只可为【本段正文中实际互动过】的双方写标记。用角色名替换 A/B。该标记仅供系统读取，不要写进剧情正文。');
    return lines.join('\n');
}

function updateInjection() {
    const s = getSettings();
    if (!s.injectEnabled) {
        context.setExtensionPrompt(MODULE, [], 0, 0);
        return;
    }
    const text = buildPromptText();
    context.setExtensionPrompt(MODULE, [{ role: 'system', content: text }], 2, 0);
}

function findOrCreatePair(key) {
    const s = getSettings();
    const data = getChatData();
    if (data.pairs[key]) return { id: key, def: s.pairDefs.find(d => d.id === key) };
    for (const def of s.pairDefs) {
        const display = `${resolveName(def.a)}→${resolveName(def.b)}`;
        if (display === key) return { id: def.id, def };
    }
    const names = key.split('→');
    if (names.length === 2) {
        const aName = names[0].trim();
        const bName = names[1].trim();
        if (isIgnoredName(aName) || isIgnoredName(bName)) return null;
        const a = typeFromName(aName);
        const b = typeFromName(bName);
        const id = `${normalizeType(a)}->${normalizeType(b)}`;
        if (!data.pairs[id]) {
            s.pairDefs.push({ id, a, b, init: 0 });
            data.pairs[id] = { value: 0, lastRound: (context.chat || []).length };
            return { id, def: s.pairDefs[s.pairDefs.length - 1] };
        }
        return { id, def: s.pairDefs.find(d => d.id === id) };
    }
    return null;
}

function parseAndApply(mes) {
    const m = String(mes || '').match(AFF_RE);
    if (!m) return false;
    const s = getSettings();
    const data = getChatData();
    let changed = false;
    let pairDefsChanged = false;
    const curRound = (context.chat || []).length;
    for (const part of m[1].split(',')) {
        const mm = part.match(ITEM_RE);
        if (!mm) continue;
        const hit = findOrCreatePair(mm[1].trim());
        if (!hit) continue;
        const raw = mm[2];
        const isAbs = !/^[+-]/.test(raw);
        const num = parseInt(raw, 10);
        if (isNaN(num)) continue;
        const pair = data.pairs[hit.id];
        const old = pair.value;
        pair.value = isAbs ? clamp(num, 0, s.maxValue) : clamp(old + num, 0, s.maxValue);
        pair.lastRound = curRound;
        if (pair.value !== old) changed = true;
        if (!hit.def) pairDefsChanged = true;
    }
    if (pairDefsChanged) {
        context.saveSettingsDebounced();
    }
    return changed;
}

function onMessageReceived() {
    const s = getSettings();
    if (!s.autoEnabled) return;
    const chat = context.chat;
    const msg = chat && chat[chat.length - 1];
    if (!msg || msg.is_user) return;
    const mes = msg.mes || '';
    if (!AFF_RE.test(mes)) return;
    const changed = parseAndApply(mes);
    msg.mes = mes.replace(AFF_RE, '');
    if (changed) {
        saveChat();
        renderPanel();
    }
    setTimeout(renderInlineBars, 0);
}

let panelRendered = false;

function removeEntry() {
    const b = document.getElementById('aff-meter-side-btn');
    if (b) b.remove();
    const f = document.getElementById('aff-meter-fab');
    if (f) f.remove();
}

function togglePanel() {
    const panel = document.getElementById('aff-meter-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) renderPanel();
}

function buildFabAndPanel() {
    const s = getSettings();
    if (!panelRendered) {
        const panel = document.createElement('div');
        panel.id = 'aff-meter-panel';
        document.body.appendChild(panel);
        panelRendered = true;
    }
    removeEntry();
    if (!s.showSideBtn) return;
    const sideScroll = document.getElementById('side_scroll');
    if (sideScroll) {
        const sideBtn = document.createElement('div');
        sideBtn.id = 'aff-meter-side-btn';
        sideBtn.className = 'extension_icon';
        sideBtn.title = '好感度状态栏';
        sideBtn.setAttribute('data-i18n', '好感度状态栏');
        sideBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
        sideBtn.addEventListener('click', togglePanel);
        sideScroll.appendChild(sideBtn);
    } else {
        const fab = document.createElement('div');
        fab.id = 'aff-meter-fab';
        fab.title = '好感度状态栏';
        fab.textContent = '♡';
        fab.addEventListener('click', togglePanel);
        document.body.appendChild(fab);
    }
}

function heartsHtml(value, max) {
    const filled = Math.max(1, Math.round((value / max) * 5));
    const empty = 5 - filled;
    return '<i class="fa-solid fa-heart"></i>'.repeat(filled) + '<i class="fa-regular fa-heart"></i>'.repeat(empty);
}

function renderPanel() {
    const panel = document.getElementById('aff-meter-panel');
    if (!panel) return;
    const s = getSettings();
    const data = getChatData();
    const defs = s.pairDefs;

    let html = '';
    html += `<div class="aff-title"><span>好感度状态栏</span><small>自动+手动 · ${data.pairs ? Object.keys(data.pairs).length : 0} 组</small></div>`;

    if (!defs.length) {
        html += '<div class="aff-empty">还没有关系对，去 设置 → 扩展 → 好感度状态栏 添加</div>';
    } else {
        for (const def of defs) {
            const pair = data.pairs[def.id];
            if (!pair) continue;
            const aName = resolveName(def.a);
            const bName = resolveName(def.b);
            const lv = getLevelInfo(pair.value);
            html += `
            <div class="aff-row" data-pair="${def.id}">
                <div class="aff-row-head">
                    <span class="aff-names">${escapeHtml(aName)}<span class="aff-arrow">→</span>${escapeHtml(bName)}<span class="aff-level-tag">${lv.label}</span></span>
                    <span class="aff-val">${pair.value}</span>
                </div>
                <div class="aff-hearts">${heartsHtml(pair.value, s.maxValue)}</div>
                <div class="aff-desc">${escapeHtml(lv.desc)}</div>
                <div class="aff-row-ops">
                    <button class="aff-btn minus" data-act="minus" data-pair="${def.id}" title="好感度 -${s.manualStep}（步长在设置面板调）">−</button>
                    <button class="aff-btn plus" data-act="plus" data-pair="${def.id}" title="好感度 +${s.manualStep}（步长在设置面板调）">+</button>
                </div>
            </div>`;
        }
    }

    panel.innerHTML = html;

    panel.querySelectorAll('.aff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pairId = btn.getAttribute('data-pair');
            const act = btn.getAttribute('data-act');
            if (!pairId) return;
            const s2 = getSettings();
            const data2 = getChatData();
            const pair = data2.pairs[pairId];
            if (!pair) return;
            const delta = act === 'plus' ? s2.manualStep : -s2.manualStep;
            pair.value = clamp(pair.value + delta, 0, s2.maxValue);
            pair.lastRound = (context.chat || []).length;
            saveChat();
            renderPanel();
        });
    });
}

const inlineRendered = new WeakMap();

function isAlwaysActive(t) {
    return t === 'char' || t === 'user';
}

function getActivePairIds() {
    const s = getSettings();
    const data = getChatData();
    const chat = context.chat || [];
    const look = s.activeLookback || 6;
    const names = new Set();
    const recent = chat.slice(-look);
    for (const m of recent) {
        if (!m || m.is_system) continue;
        const text = String(m.mes || '');
        for (const def of s.pairDefs) {
            if (text.includes(resolveName(def.a))) names.add(def.a);
            if (text.includes(resolveName(def.b))) names.add(def.b);
        }
    }
    const activeIds = new Set();
    const total = chat.length;
    for (const def of s.pairDefs) {
        const pair = data.pairs[def.id];
        if (!pair) continue;
        const aActive = isAlwaysActive(def.a) || names.has(def.a) || (pair.lastRound != null && total - pair.lastRound <= look);
        const bActive = isAlwaysActive(def.b) || names.has(def.b) || (pair.lastRound != null && total - pair.lastRound <= look);
        if (aActive || bActive) activeIds.add(def.id);
    }
    return activeIds;
}

function renderInlineBarForMes(mesEl) {
    if (!mesEl || inlineRendered.has(mesEl)) return;
    inlineRendered.set(mesEl, true);
    if (mesEl.querySelector('.aff-inline')) return;
    const s = getSettings();
    const data = getChatData();
    let defs = s.pairDefs.filter(d => data.pairs[d.id]);
    if (s.dynamicActive) {
        const active = getActivePairIds();
        defs = defs.filter(d => active.has(d.id));
    }
    if (!defs.length) return;
    let html = '<div class="aff-inline">';
    for (const def of defs) {
        const pair = data.pairs[def.id];
        const aName = resolveName(def.a);
        const bName = resolveName(def.b);
        const lv = getLevelInfo(pair.value);
        html += `<span class="aff-inline-item">
            <span class="aff-inline-names">${escapeHtml(aName)} → ${escapeHtml(bName)}</span>
            <span class="aff-inline-hearts">${heartsHtml(pair.value, s.maxValue)}</span>
            <span class="aff-inline-val">${pair.value}</span>
            <span class="aff-inline-desc">${escapeHtml(lv.desc)}</span>
        </span>`;
    }
    html += '</div>';
    const anchor = mesEl.querySelector('.mes_text') || mesEl.querySelector('.mes_block') || mesEl;
    anchor.insertAdjacentHTML('afterend', html);
}

function renderInlineBars() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    chatEl.querySelectorAll('.mes').forEach(renderInlineBarForMes);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

let settingsDrawerOpen = true;

function renderSettings() {
    const s = getSettings();
    const container = document.getElementById('aff-meter-settings-root');
    if (!container) return;

    let html = '';
    html += `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>好感度状态栏 Affection Meter</b>
            <small class="aff-meta">v1.1.0 | by Mango & Marvis</small>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" id="aff-set-content" style="${settingsDrawerOpen ? '' : 'display:none'}">
            <label class="checkbox_label">
                <input type="checkbox" id="aff-set-auto" ${s.autoEnabled ? 'checked' : ''}>
                <span>自动判定（LLM 正文标记法）</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="aff-set-inject" ${s.injectEnabled ? 'checked' : ''}>
                <span>注入好感度状态到 prompt</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="aff-set-side" ${s.showSideBtn ? 'checked' : ''}>
                <span>入口显示在左侧栏</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="aff-set-dynamic" ${s.dynamicActive ? 'checked' : ''}>
                <span>动态显示（只显示当前在场角色）</span>
            </label>
            <div class="aff-settings-row">
                <span>手动步长：</span>
                <input type="number" id="aff-set-step" value="${s.manualStep}" min="1" max="50">
            </div>
            <div class="aff-settings-row">
                <span>上限：</span>
                <input type="number" id="aff-set-max" value="${s.maxValue}" min="10" max="1000">
            </div>
            <div class="aff-settings-row">
                <span>char 显示名：</span>
                <input type="text" id="aff-set-char" value="${escapeHtml(s.charDisplay || '')}" placeholder="留空=当前角色卡名，多人卡可填「当前角色」等">
            </div>
            <div class="aff-settings-row" style="align-items:flex-start;">
                <span>好感变化规则：</span>
                <textarea id="aff-set-rules" rows="3" style="flex:1;min-width:160px;">${escapeHtml(s.rulesText || '')}</textarea>
            </div>
            <hr>
            <div><b>关系对（A 对 B 的好感度，新 NPC 默认从 0 开始）</b></div>`;

    s.pairDefs.forEach((def, idx) => {
        html += `
            <div class="aff-settings-row">
                <select data-idx="${idx}" class="aff-set-a" title="${escapeHtml(resolveName(def.a))}">
                    ${typeOptions(def.a)}
                </select>
                <span>→</span>
                <select data-idx="${idx}" class="aff-set-b" title="${escapeHtml(resolveName(def.b))}">
                    ${typeOptions(def.b)}
                </select>
                <input type="number" data-idx="${idx}" class="aff-set-init" value="${def.init ?? 0}" min="0" max="${s.maxValue}" title="初始值">
                <button class="aff-btn minus aff-set-del" data-idx="${idx}">删</button>
            </div>`;
    });

    html += `
            <div class="aff-settings-actions">
                <button class="aff-btn plus" id="aff-set-add">+ 添加关系对</button>
                <button class="aff-btn" id="aff-set-save">保存设置</button>
            </div>
            <hr>`;

    const ign = (s.ignored || []).filter(Boolean);
    if (ign.length) {
        html += '<div class="aff-settings-row" style="flex-wrap:wrap;"><b>忽略名单：</b>';
        ign.forEach((nm, i) => {
            html += `<span class="aff-ign-item">${escapeHtml(nm)}<button class="aff-btn aff-ign-del" data-ign="${i}">解除</button></span>`;
        });
        html += '</div>';
    } else {
        html += '<div class="aff-settings-row" style="opacity:.6;">忽略名单：空。删除关系对时自动加入，AI 将不再维护该角色好感。</div>';
    }

    html += `
        </div>
    </div>`;

    container.innerHTML = html;

    const drawer = container.querySelector('.inline-drawer-toggle');
    if (drawer) {
        drawer.addEventListener('click', () => {
            settingsDrawerOpen = !settingsDrawerOpen;
            const content = container.querySelector('#aff-set-content');
            if (content) content.style.display = settingsDrawerOpen ? '' : 'none';
            const icon = drawer.querySelector('.inline-drawer-icon');
            if (icon) icon.classList.toggle('down', settingsDrawerOpen);
        });
    }

    container.querySelector('#aff-set-add').addEventListener('click', () => {
        s.pairDefs.push({ id: genPairId(s.pairDefs), a: 'char', b: 'npc:未命名', init: 0 });
        renderSettings();
    });
    container.querySelectorAll('.aff-set-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-idx'), 10);
            if (!isNaN(idx) && idx >= 0 && idx < s.pairDefs.length) {
                const def = s.pairDefs[idx];
                for (const t of [def.a, def.b]) {
                    if (t === 'char' || t === 'user') continue;
                    const nm = String(t).replace(/^npc:/, '');
                    if (nm && nm !== '未命名' && !s.ignored.includes(nm)) s.ignored.push(nm);
                }
                s.pairDefs.splice(idx, 1);
                context.saveSettingsDebounced();
                renderSettings();
            }
        });
    });
    container.querySelectorAll('.aff-ign-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.getAttribute('data-ign'), 10);
            if (!isNaN(i) && i >= 0 && i < s.ignored.length) {
                s.ignored.splice(i, 1);
                context.saveSettingsDebounced();
                renderSettings();
            }
        });
    });
    container.querySelector('#aff-set-save').addEventListener('click', () => {
        s.autoEnabled = container.querySelector('#aff-set-auto').checked;
        s.injectEnabled = container.querySelector('#aff-set-inject').checked;
        s.showSideBtn = container.querySelector('#aff-set-side').checked;
        s.dynamicActive = container.querySelector('#aff-set-dynamic').checked;
        s.manualStep = clamp(container.querySelector('#aff-set-step').value || 5, 1, 50);
        s.maxValue = clamp(container.querySelector('#aff-set-max').value || 100, 10, 1000);
        s.charDisplay = container.querySelector('#aff-set-char').value || '';
        s.rulesText = container.querySelector('#aff-set-rules').value || '';

        container.querySelectorAll('.aff-settings-row').forEach(row => {
            const idx = parseInt(row.querySelector('.aff-set-a').getAttribute('data-idx'), 10);
            if (isNaN(idx) || idx >= s.pairDefs.length) return;
            const def = s.pairDefs[idx];
            def.a = row.querySelector('.aff-set-a').value;
            def.b = row.querySelector('.aff-set-b').value;
            def.init = clamp(row.querySelector('.aff-set-init').value || 0, 0, s.maxValue);
            def.id = `${normalizeType(def.a)}->${normalizeType(def.b)}`;
        });

        context.saveSettingsDebounced();
        getChatData();
        saveChat();
        updateInjection();
        renderPanel();
        buildFabAndPanel();
    });
}

function typeOptions(current) {
    const opts = [
        ['char', resolveName('char')],
        ['user', resolveName('user')],
        ['npc:未命名', 'npc(填名字)'],
    ];
    return opts.map(([v, label]) =>
        `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`
    ).join('');
}

function onChatChanged() {
    renderPanel();
    updateInjection();
    setTimeout(renderInlineBars, 120);
}

function onMessageSent() {
    updateInjection();
}

function onGenerationStarted() {
    updateInjection();
}

function init() {
    const target = document.getElementById('extensions_settings2');
    if (!target) {
        setTimeout(init, 1500);
        return;
    }
    let root = document.getElementById('aff-meter-settings-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'aff-meter-settings-root';
        target.appendChild(root);
    }

    getSettings();
    getChatData();

    buildFabAndPanel();
    renderSettings();
    renderPanel();
    updateInjection();
    setTimeout(renderInlineBars, 600);

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
