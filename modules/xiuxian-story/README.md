# 万劫问仙模块

这是 WorldX 的独立修仙互动故事模块。模块将“必须抵达的剧情锚点”与“玩家和 AI 自由产生的过程”分开，确保世界可以发生意外，同时仍按大纲抵达固定终局。

v0.9 将玩法重心完全移回 WorldX Phaser 地图：地图占据主画面，玩家直接控制陆尘移动、接近 NPC 与场景物件并在原地交互。章节目标、状态与联机入口改为轻量 HUD，不再用大块文字面板挤压世界。

在世界选择页载入 **万劫问仙·青云坊市**，即可进入青石主街、丹符阁、天机台和问剑碑。首次进入会自动绑定并跟随默认主角陆尘。

## 地图操作

- `WASD` / 方向键：直接移动主角
- 鼠标左键：点击地面寻路；点击 NPC 或场景物件会自动靠近
- `E` / 空格：与附近高亮目标交互
- `1`：吐纳修炼
- `2`：尝试突破
- 第一章由真实地图行为推进：共鸣问剑碑，再与顾长风交谈

## 当前能力

- 六章修仙主线与固定终局
- JSON 大纲校验和唯一剧情锚点
- 只推进当前章节，禁止意外事件跳过主线
- 玩家与主角角色的一对一绑定
- 主角行动意图鉴权和队列
- 可序列化、可恢复的剧情导演状态
- 凡人至大乘的境界与突破规则
- 功法学习、打坐收益、气血与灵力属性
- 不修改输入状态的战斗回合结算和剧情事件标签
- 带章节门槛、权重与冷却的动态意外事件池
- 意外选择、后果数据和可恢复状态
- 主角死亡或关键锚点损坏时的因果纠偏与劫债
- WorldX REST 服务适配和时间线 SQLite 独立状态
- 2–100 人可配置房间、唯一主角身份和角色占用保护
- 服务器行动序号、防重复提交、权威结算记录与断线恢复凭证
- 轻量游戏 HUD：章节目标、气血灵力、地图交互、修炼突破、意外选择和联机房间
- 主角接管后停用该角色的 AI 决策，移动、世界行动和交谈进入 WorldX 原生执行器
- 工笔画修仙坊市、原生 Phaser 碰撞寻路与动画角色
- WASD、方向键与点击寻路三套直接控制，镜头自动跟随主角
- NPC 与场景物件的距离判定、靠近提示和原地互动
- 地图互动直接产出剧情标签，章节不再依赖面板按钮推进

## 目录边界

- `story/`：可编辑的大纲与世界叙事数据
- `src/plot-director.mjs`：章节推进和终局约束
- `src/protagonist-controller.mjs`：玩家主角控制权
- `test/`：模块级回归测试

模块不会直接修改 WorldX 的角色管理、模拟或存储实现。后续通过服务器适配层连接 `SimulationEngine`、时间线 SQLite 和 WebSocket，保持原项目仍能单独运行。

## 验证

在仓库根目录运行：

```bash
npm run test:xiuxian
```

## 实施顺序

1. 故事大纲、剧情导演与主角控制（当前阶段）
2. 修仙境界、功法、修炼与战斗规则（已完成）
3. 奇遇、事故、因果纠偏和支线生成（基础引擎已完成）
4. WorldX 服务端、时间线存档与游戏面板接入（已完成）
5. 多人房间、服务器权威同步和断线重连（服务端核心与 WebSocket 网关已完成）

## 服务端接口

- `GET /api/xiuxian/status`：模块、主角、境界、章节和意外状态
- `POST /api/xiuxian/protagonist/bind`：绑定 WorldX 角色为玩家主角
- `POST /api/xiuxian/action`：提交主角行动或打坐
- `POST /api/xiuxian/breakthrough`：尝试突破境界
- `POST /api/xiuxian/techniques/:id/learn`：学习功法
- `POST /api/xiuxian/accidents/propose`：按当前章节触发意外
- `POST /api/xiuxian/accidents/resolve`：选择意外处理方式
- `GET/POST /api/xiuxian/rooms`：查看或创建联机房间
- `POST /api/xiuxian/rooms/:id/join`：以同伴、宿敌、宗门成员或观察者加入
- `POST /api/xiuxian/rooms/:id/intents`：HTTP 降级通道提交权威行动

WebSocket 连接后依次发送 `xiuxian_room_auth` 和带递增 `clientSequence` 的 `xiuxian_intent`。服务端向同房间广播 `xiuxian_action_resolved`，不会把恢复凭证广播给其他玩家。
