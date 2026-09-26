/**
 * ============================================================
 *  好感度状态栏 Affection Meter  v1.0.0
 *  SillyTavern UI Extension
 *  ------------------------------------------------------------
 *  混合模式：
 *   1) 自动判定 —— 正文标记法。注入好感度状态提示词，LLM 在
 *      回复末尾输出 {{AFF|A→B:+5,C→D:-2}}，插件解析后累加，
 *      并把标记从聊天记录中剥离（不污染正文、不额外烧 API）。
 *   2) 手动微调 —— 状态栏每条关系带 +/- 按钮。
 *  手机端适配：右下角浮动按钮 + 可折叠面板。
 *  数据：好感度数值存对话级 chatMetadata，关系对定义存全局设置。
 * ============================================================
 */

const context = SillyTavern.getContext();
const { eventSource, event_types } = context;

const MODULE = 'affection_meter';

/** 匹配正文末尾的好感度标记：{{AFF|名字→名字:+5,名字→名字:-2}} */
const AFF_RE = /\{\{AFF\|([^}]*)\}\}\s*$/;
/** 匹配标记内单个条目：名字→名字:+5 或 名字→名字:-3 */
const ITEM_RE = /^\s*(.+?)\s*:\s*([+-]?\d+)\s*$/;

/* ==================== 默认配置 ==================== */

const DEFAULT_SETTINGS = {
    autoEnabled: true,          // 自动判定（正文标记法）
    injectEnabled: true,        // 注入好感度状态到 prompt
    manualStep: 5,              // 手动 +/- 步长
    maxValue: 100,              // 好感度上限
    levelRanges: [
        { max: 20, label: '陌生',   desc: '彼此还很生疏，客套而疏离。' },
        { max: 40, label: '冷淡',   desc: '有些熟悉，但仍保持距离。' },
        { max: 60, label: '熟络',   desc: '相处自然，有来有往。' },
        { max: 80, label: '亲近',   desc: '关系亲密，会互相关心。' },
        { max: 100, label: '沦陷',  desc: '全身心交付，无法抗拒。' },
    ],
    /** 关系对定义：a/b 取值 char | user | npc:名字 */
    pairDefs: [
        { id: 'char->user', a: 'char', b: 'user', init: 50 },
        { id: 'user->char', a: 'user', b: 'char', init: 50 },
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

/* ==================== 对话级数据 ==================== */

function getChatData() {
    if (!context.chatMetadata[MODULE]) {
        const s = getSettings();
        const pairs = {};
        for (const def of s.pairDefs) {
            pairs[def.id] = { value: clamp(def.init ?? 50, 0, s.maxValue) };
        }
        context.chatMetadata[MODULE] = { version: 1, pairs };
    } else {
        // 补建设置中新增、但当前对话还没有的关系对
        const s = getSettings();
        const data = context.chatMetadata[MODULE];
        if (!data.pairs) data.pairs = {};
        for (const def of s.pairDefs) {
            if (!data.pairs[def.id]) {
                data.pairs[def.id] = { value: clamp(def.init ?? 50, 0, s.maxValue) };
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

/* ==================== 名称解析 ==================== */

function resolveName(type) {
    if (type === 'char') {
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

function getLevelInfo(value) {
    const s = getSettings();
    for (const r of s.levelRanges) {
        if (value <= r.max) return r;
    }
    return s.levelRanges[s.levelRanges.length - 1] || { label: '?', desc: '' };
}

/* ==================== Prompt 注入 ==================== */

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
    lines.push('');
    lines.push(`若某段剧情使好感度发生明显变化，请在回复【正文末尾】附加一行标记（如无变化则省略）：`);
    lines.push(`{{AFF|角色A→角色B:+5,角色C→角色D:-3}}`);
    lines.push('用角色名替换 A/B，数值为变化量。该标记仅供系统读取，不要写进剧情正文。');
    return lines.join('\n');
}

function updateInjection() {
    const s = getSettings();
    if (!s.injectEnabled) {
        // 清空注入
        context.setExtensionPrompt(MODULE, [], 0, 0);
        return;
    }
    const text = buildPromptText();
    // position=2 表示 at_system（注入到系统区，LLM 最先读到）
    context.setExtensionPrompt(MODULE, [{ role: 'system', content: text }], 2, 0);
}

/* ==================== 自动判定：解析正文标记 ==================== */

function findPairByKey(key) {
    const s = getSettings();
    const data = getChatData();
    // 1) 直接命中 id
    if (data.pairs[key]) return { id: key, def: s.pairDefs.find(d => d.id === key) };
    // 2) 命中显示名 "A→B"
    for (const def of s.pairDefs) {
        const display = `${resolveName(def.a)}→${resolveName(def.b)}`;
        if (display === key) return { id: def.id, def };
    }
    return null;
}

/** 解析并应用标记，返回是否发生了更新 */
function parseAndApply(mes) {
    const m = String(mes || '').match(AFF_RE);
    if (!m) return false;
    const s = getSettings();
    const data = getChatData();
    let changed = false;
    for (const part of m[1].split(',')) {
        const mm = part.match(ITEM_RE);
        if (!mm) continue;
        const hit = findPairByKey(mm[1].trim());
        if (!hit) continue;
        const delta = parseInt(mm[2], 10);
        if (isNaN(delta)) continue;
        const pair = data.pairs[hit.id];
        const old = pair.value;
        pair.value = clamp(old + delta, 0, s.maxValue);
        if (pair.value !== old) changed = true;
    }
    return changed;
}

/** 生成完成后：解析并剥离标记 */
function onMessageReceived() {
    const s = getSettings();
    if (!s.autoEnabled) return;
    const chat = context.chat;
    const msg = chat && chat[chat.length - 1];
    if (!msg || msg.is_user) return;
    const mes = msg.mes || '';
    if (!AFF_RE.test(mes)) return;
    const changed = parseAndApply(mes);
    // 从聊天记录中剥离标记（消息尚未渲染，直接改 mes 即可）
    msg.mes = mes.replace(AFF_RE, '');
    if (changed) {
        saveChat();
        renderPanel();
    }
}

/* ==================== UI：状态栏 ==================== */

let panelRendered = false;

function buildFabAndPanel() {
    if (panelRendered) return;
    panelRendered = true;

    const fab = document.createElement('div');
    fab.id = 'aff-meter-fab';
    fab.title = '好感度状态栏';
    fab.textContent = '♡';
    fab.addEventListener('click', () => {
        const panel = document.getElementById('aff-meter-panel');
        if (panel) {
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) renderPanel();
        }
    });

    const panel = document.createElement('div');
    panel.id = 'aff-meter-panel';

    document.body.appendChild(fab);
    document.body.appendChild(panel);
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
            const pct = Math.round((pair.value / s.maxValue) * 100);
            html += `
            <div class="aff-row" data-pair="${def.id}">
                <div class="aff-row-head">
                    <span class="aff-names">${escapeHtml(aName)}<span class="aff-arrow">→</span>${escapeHtml(bName)}<span class="aff-level-tag">${lv.label}</span></span>
                    <span class="aff-val">${pair.value}</span>
                </div>
                <div class="aff-bar"><div class="aff-bar-fill" style="width:${pct}%"></div></div>
                <div class="aff-row-ops">
                    <button class="aff-btn minus" data-act="minus" data-pair="${def.id}">-${s.manualStep}</button>
                    <button class="aff-btn plus" data-act="plus" data-pair="${def.id}">+${s.manualStep}</button>
                </div>
            </div>`;
        }
    }

    panel.innerHTML = html;

    // 绑定手动调节
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
            saveChat();
            renderPanel();
        });
    });
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/* ==================== UI：设置面板 ==================== */

function renderSettings() {
    const s = getSettings();
    const container = document.getElementById('aff-meter-settings-root');
    if (!container) return;

    let html = '';
    html += `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>好感度状态栏 Affection Meter</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label">
                <input type="checkbox" id="aff-set-auto" ${s.autoEnabled ? 'checked' : ''}>
                <span>自动判定（LLM 正文标记法）</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="aff-set-inject" ${s.injectEnabled ? 'checked' : ''}>
                <span>注入好感度状态到 prompt</span>
            </label>
            <div class="aff-settings-row">
                <span>手动步长：</span>
                <input type="number" id="aff-set-step" value="${s.manualStep}" min="1" max="50">
            </div>
            <div class="aff-settings-row">
                <span>上限：</span>
                <input type="number" id="aff-set-max" value="${s.maxValue}" min="10" max="1000">
            </div>
            <hr>
            <div><b>关系对（A 对 B 的好感度）</b></div>`;

    s.pairDefs.forEach((def, idx) => {
        html += `
            <div class="aff-settings-row">
                <select data-idx="${idx}" class="aff-set-a">
                    ${typeOptions(def.a)}
                </select>
                <span>→</span>
                <select data-idx="${idx}" class="aff-set-b">
                    ${typeOptions(def.b)}
                </select>
                <input type="number" data-idx="${idx}" class="aff-set-init" value="${def.init ?? 50}" min="0" max="${s.maxValue}" title="初始值">
                <button class="aff-btn minus aff-set-del" data-idx="${idx}">删</button>
            </div>`;
    });

    html += `
            <div class="aff-settings-actions">
                <button class="aff-btn plus" id="aff-set-add">+ 添加关系对</button>
                <button class="aff-btn" id="aff-set-save">保存设置</button>
            </div>
            <div class="aff-settings-note">
                类型：char=当前角色，user=你，npc:名字=自定义NPC（可在下拉里选「npc」后输入名字）。
                添加 NPC：先在下拉选「npc」，保存后可在弹窗/输入框补名字。
            </div>
        </div>
    </div>`;

    container.innerHTML = html;

    container.querySelector('#aff-set-add').addEventListener('click', () => {
        s.pairDefs.push({ id: genPairId(s.pairDefs), a: 'char', b: 'npc:未命名', init: 50 });
        renderSettings();
    });
    container.querySelectorAll('.aff-set-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-idx'), 10);
            if (!isNaN(idx) && idx >= 0 && idx < s.pairDefs.length) {
                s.pairDefs.splice(idx, 1);
                renderSettings();
            }
        });
    });
    container.querySelector('#aff-set-save').addEventListener('click', () => {
        s.autoEnabled = container.querySelector('#aff-set-auto').checked;
        s.injectEnabled = container.querySelector('#aff-set-inject').checked;
        s.manualStep = clamp(container.querySelector('#aff-set-step').value || 5, 1, 50);
        s.maxValue = clamp(container.querySelector('#aff-set-max').value || 100, 10, 1000);

        container.querySelectorAll('.aff-settings-row').forEach(row => {
            const idx = parseInt(row.querySelector('.aff-set-a').getAttribute('data-idx'), 10);
            if (isNaN(idx) || idx >= s.pairDefs.length) return;
            const def = s.pairDefs[idx];
            def.a = row.querySelector('.aff-set-a').value;
            def.b = row.querySelector('.aff-set-b').value;
            def.init = clamp(row.querySelector('.aff-set-init').value || 50, 0, s.maxValue);
            def.id = `${normalizeType(def.a)}->${normalizeType(def.b)}`;
        });

        context.saveSettingsDebounced();
        // 新对话数据补建
        getChatData();
        saveChat();
        updateInjection();
        renderPanel();
        renderSettings();
    });
}

function typeOptions(current) {
    const opts = [
        ['char', '当前角色'],
        ['user', '你'],
        ['npc:未命名', 'npc(填名字)'],
    ];
    return opts.map(([v, label]) =>
        `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`
    ).join('');
}

function normalizeType(t) {
    if (t === 'char' || t === 'user') return t;
    return `npc:${String(t).replace(/^npc:/, '')}`;
}

function genPairId(existing) {
    let n = existing.length + 1;
    while (existing.some(d => d.id === `pair${n}`)) n++;
    return `pair${n}`;
}

/* ==================== 事件与初始化 ==================== */

function onChatChanged() {
    renderPanel();
    updateInjection();
}

function onMessageSent() {
    // 用户发送消息后立即刷新注入，保证本次生成带上最新状态
    updateInjection();
}

function onGenerationStarted() {
    updateInjection();
}

function init() {
    // 确保设置面板挂载点存在
    const target = document.getElementById('extensions_settings2');
    if (!target) {
        console.warn('[AffectionMeter] 未找到 #extensions_settings2，稍后重试');
        setTimeout(init, 1500);
        return;
    }
    let root = document.getElementById('aff-meter-settings-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'aff-meter-settings-root';
        target.appendChild(root);
    }

    // 初始化默认数据
    getSettings();
    getChatData();

    buildFabAndPanel();
    renderSettings();
    renderPanel();
    updateInjection();

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    console.log('[AffectionMeter] 好感度状态栏已加载');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
