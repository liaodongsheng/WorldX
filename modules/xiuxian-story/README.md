# 万劫问仙模块

这是 WorldX 的独立修仙互动故事模块。模块将“必须抵达的剧情锚点”与“玩家和 AI 自由产生的过程”分开，确保世界可以发生意外，同时仍按大纲抵达固定终局。

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
4. WorldX 服务端与时间线存档接入（服务端已完成，界面待接入）
5. 多人房间、服务器权威同步和断线重连

## 服务端接口

- `GET /api/xiuxian/status`：模块、主角、境界、章节和意外状态
- `POST /api/xiuxian/protagonist/bind`：绑定 WorldX 角色为玩家主角
- `POST /api/xiuxian/action`：提交主角行动或打坐
- `POST /api/xiuxian/breakthrough`：尝试突破境界
- `POST /api/xiuxian/techniques/:id/learn`：学习功法
- `POST /api/xiuxian/accidents/propose`：按当前章节触发意外
- `POST /api/xiuxian/accidents/resolve`：选择意外处理方式
