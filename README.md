---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 004dbf18681f7375e8a1d1d4a2c47c52_bf3fca75b98111f18442525400de85a5
    ReservedCode1: KsGJpOSGQxrb4drktpDfsUZxFPTN3+IuiYBVtyr+BPHl7MDWVZce9n6CSJH1pFhSoQ1aKLWelHqlbirDxOzUS0MBYrBMjJDt1biBxP/dVc9Dg2P5hgnPh/Dh1/8SEBctj2e+bTawPsQF+140fNNW+2TFypOJYZ7Z0lxhrkkloTZ25gUV6Cy9SnTvh6w=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 004dbf18681f7375e8a1d1d4a2c47c52_bf3fca75b98111f18442525400de85a5
    ReservedCode2: KsGJpOSGQxrb4drktpDfsUZxFPTN3+IuiYBVtyr+BPHl7MDWVZce9n6CSJH1pFhSoQ1aKLWelHqlbirDxOzUS0MBYrBMjJDt1biBxP/dVc9Dg2P5hgnPh/Dh1/8SEBctj2e+bTawPsQF+140fNNW+2TFypOJYZ7Z0lxhrkkloTZ25gUV6Cy9SnTvh6w=
---

# 好感度状态栏 Affection Meter v1.0.0

SillyTavern 好感度插件：**混合模式**（自动判定 + 手动微调），手机端适配。

## 功能

- 可自定义任意"谁对谁"的好感度关系对：char→user、user→char、char→npc、user→npc、npc→user、npc→char……
- 自动判定：每次生成时注入好感度状态提示词，LLM 在回复末尾输出 `{{AFF|名字→名字:+5}}` 标记，插件自动解析累加，并把标记从正文剥离（不污染剧情、不额外调用 API、不耗流量）
- 手动微调：状态栏每条好感度带 +/- 按钮，随时兜底改数值
- 好感度跟随发送：注入到 prompt 系统区，直接影响 LLM 生成正文
- 数据按对话独立存储（切换角色/对话互不干扰）
- 手机端 UI：右下角浮动按钮 + 可折叠状态栏面板

## 安装（手机 Termux 容器）

SillyTavern 目录内，把 `manifest.json` / `index.js` / `style.css` 放进**插件目录**，二选一：

| 安装方式 | 目标目录 |
|---------|---------|
| 仅当前用户 | `~/SillyTavern/data/<用户名>/extensions/affection-meter/` |
| 全部用户 | `~/SillyTavern/public/scripts/extensions/third-party/affection-meter/` |

示例（默认用户）：
```bash
cd ~/SillyTavern
mkdir -p data/default-user/extensions/affection-meter
# 把三个文件解压/上传到 data/default-user/extensions/affection-meter/
```

完成后**重启酒馆**，在 设置 → 扩展 中应能看到「好感度状态栏 Affection Meter」。

> 注意：安装目录必须是上面列出的两个之一。若放错位置（如直接放 extensions 根目录下没有子文件夹），插件不会加载。

## 使用

1. 打开任意对话，右下角出现 **♡** 浮动按钮，点击展开状态栏
2. 默认已有两组：`角色→你`、`你→角色`，初始 50
3. 设置 → 扩展 → 好感度状态栏，可：
   - 添加/删除关系对（A 类型：当前角色 / 你 / npc，选 npc 后把类型改成 `npc:名字`）
   - 设置每对初始值
   - 手动步长、好感度上限
   - 开关自动判定 / 开关注入
4. 自动判定：生成回复时 LLM 会根据剧情输出变化标记，插件自动累加。若 LLM 不输出标记，数值保持不变（可用手动兜底）

## 自定义 NPC

在设置面板的关系对中，把 A 或 B 的类型选为 `npc(填名字)`，保存后回到面板手动把值改成 `npc:名字`（例如 `npc:小明`）。改完点保存即可。显示时会用 NPC 名字。

## 常见问题

- **状态栏不出现**：插件没加载。检查目录位置、是否重启酒馆、扩展列表是否已勾选。
- **自动判定不生效**：确认「自动判定」已开启，且模型按提示在末尾输出 `{{AFF|...}}`。不同模型服从度不同，必要时在设置里关掉自动判定、纯手动。
- **数值不会自动变**：LLM 每轮都输出无变化标记是正常的（剧情没明显推进时）。手动按钮随时可用。
- **群聊**：char 取当前发言角色（群聊中取最后发言者所属角色），如遇取错可在手动面板直接改。

## 数据说明

- 关系对定义：存在酒馆全局设置（extensionSettings）
- 每场对话的数值：存在对话元数据（chatMetadata），换对话/换角色各自独立
- 卸载插件不影响已存数据；重新安装同 id 插件数据仍在
*（内容由AI生成，仅供参考）*
