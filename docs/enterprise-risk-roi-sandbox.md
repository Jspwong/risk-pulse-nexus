# Enterprise Risk ROI 沙盘路线

## 目标

ROI 沙盘要回答一个简单问题：

> 这套系统提前发现风险后，能帮企业少损失多少钱？投入是否值得？

为了让答案不变成“模型拍脑袋”，ROI 沙盘采用三层路线：

```text
文献模型
  -> Qwen 假设代理
    -> 确定性计算器
      -> ROI 沙盘展示
```

核心原则：

- 文献模型负责定口径。
- Qwen 负责补假设和解释依据。
- 代码负责最终算数。
- Qwen 不直接输出 ROI 结果。

## 参考了什么文献

### 1. Open FAIR

参考链接：

https://www.opengroup.org/open-fair

Open FAIR 里最重要的思想是：

```text
风险 = 事件发生频率 x 损失金额
```

我们在 ROI 沙盘里借用了这个口径，把每个风险都拆成：

- 这个风险事件有多大概率发生。
- 一旦发生，企业可能损失多少钱。
- 系统介入后，能减少多少损失。

对应到代码里的假设项：

- `exposureBaseUsd`: 风险敞口，也就是可能被影响的金额。
- `eventProbability`: 事件发生概率。
- `lossGivenEventPct`: 事件发生后，敞口中真正形成损失的比例。

### 2. NIST SP 800-30

参考链接：

https://csrc.nist.gov/pubs/sp/800/30/r1/final

NIST SP 800-30 里最有用的是三件事：

- `likelihood`: 风险发生的可能性。
- `impact`: 风险造成的影响。
- `control effectiveness`: 控制措施能降低多少风险。

我们在 ROI 沙盘里借用了这个思路，把系统能力拆成：

- `detectionHitRate`: 系统提前命中的概率。
- `mitigationEffectiveness`: 命中后能减少多少损失。
- `residualLossUsd`: 系统介入后还剩下的损失。

这样可以把“预警系统有没有价值”讲成业务语言，而不是只讲技术能力。

## 统一计算公式

所有风险场景都尽量走同一套公式：

```text
基准期望损失 =
  风险敞口 x 事件概率 x 损失率

系统可减少损失 =
  基准期望损失 x 预警命中率 x 命中后减损率

系统后残余损失 =
  基准期望损失 - 系统可减少损失

净节省 =
  系统可减少损失 - 系统成本

ROI =
  净节省 / 系统成本
```

这套公式的好处是简单、可解释、可测试。

## Qwen 假设代理做什么

Qwen 的角色不是“财务计算器”，而是“假设代理”。

它负责从事件、公司画像、业务线、证据来源里提取参数：

```json
{
  "eventId": "demo-cbam-red-sea-001",
  "template": "regulatory",
  "confidence": 0.72,
  "assumptions": [
    {
      "key": "exposureBaseUsd",
      "label": "Exposure magnitude",
      "value": 2600000,
      "unit": "usd",
      "source": "provided profile/evidence",
      "confidence": 0.72
    },
    {
      "key": "eventProbability",
      "label": "Annual event probability",
      "value": 0.3,
      "unit": "probability",
      "source": "NIST likelihood assumption",
      "confidence": 0.6
    }
  ],
  "references": ["Open FAIR", "NIST SP 800-30"]
}
```

Qwen 可以做：

- 判断该风险适合哪个模板。
- 给出风险敞口、概率、命中率、减损率、系统成本等假设。
- 给每个假设补来源和置信度。
- 用简单中文解释为什么这么取值。

Qwen 不做：

- 不直接输出最终 ROI。
- 不直接输出 expected savings。
- 不直接输出 net savings。
- 不绕过代码里的计算公式。

## 确定性计算器做什么

确定性计算器在 `src/services/enterprise-risk.ts`。

它负责：

- 校验 Qwen 给出的假设是否在合理范围内。
- 如果 Qwen 没返回，就用 deterministic fallback。
- 用固定公式计算：
  - `expectedLossUsd`
  - `expectedSavingUsd`
  - `mitigationCostUsd`
  - `netSavingUsd`
  - `compositeRoiPct`
- 输出给前端沙盘展示。

这样做的原因：

- 数字结果可复现。
- 测试可以覆盖。
- 评审时可以解释公式。
- Qwen 出错时系统仍然能工作。

## 支持的计算口径

项目里的 4 个风险分类仍然不变：

- `regulatory`
- `supply_chain`
- `financial_fx`
- `geopolitical`

当前版本建议一一对应。

也就是说，ROI 沙盘不要再发明一套顶层分类。它直接沿用项目里的 4 个风险分类：

```text
regulatory      -> regulatory ROI
supply_chain    -> supply_chain ROI
financial_fx    -> financial_fx ROI
geopolitical    -> geopolitical ROI
```

每个风险分类都有自己的默认计算口径：

| 风险分类 | ROI 计算口径 | 典型场景 |
|---|---|---|
| `regulatory` | 合规/监管成本口径 | CBAM、碳关税、嵌入碳排、合规申报、关税、认证 |
| `supply_chain` | 供应链延误/中断口径 | 航线绕行、港口拥堵、供应商停摆、交付延误 |
| `financial_fx` | 财务/汇率毛利口径 | 汇率、报价、应收账款、融资成本、毛利波动 |
| `geopolitical` | 地缘/通道冲击口径 | 冲突、制裁、出口管制、关键航道风险 |

这样做更清楚：

- UI、筛选、Qwen 识别、ROI 沙盘都使用同一套 4 个风险分类。
- CBAM 不是新的风险分类，而是 `regulatory` 下面的一个具体场景。
- 如果以后要细分，也应该作为二级场景出现，而不是替代顶层风险分类。

例如：

```text
regulatory
  -> CBAM
  -> tariff
  -> customs delay
  -> battery regulation
```

这些风险都还是 `regulatory`，只是默认假设不同。

## CBAM 示例

如果是 CBAM 场景，可以这样理解：

```text
风险敞口 =
  年度受影响出口金额或碳成本风险

事件概率 =
  未来 12 个月被追溯、抽查、延误或补缴的概率

预警命中率 =
  系统提前发现 CBAM 规则变化或申报风险的概率

命中后减损率 =
  提前准备材料、补齐碳数据、调整客户沟通后能减少的损失比例

系统成本 =
  年度部署和使用成本
```

最终不是只看“风险有多大”，而是看：

```text
系统能减少多少损失 - 系统成本
```

## 沙盘数字怎么读

以 CBAM 为例，界面上这几个数字可以这样理解。

### Expected savings

截图里的 `$46K expected savings` 表示：

```text
在当前时间窗口内，系统预计能帮企业减少的损失。
```

它不是总风险敞口，也不是收入。

它来自这个公式：

```text
Expected savings =
  基准期望损失
  x 预警命中率
  x 命中后减损率
  x (1 - correlation haircut)
```

放到 CBAM 场景里，就是：

```text
如果未来 CBAM 申报、抽查、追溯或碳数据缺口造成损失，
系统提前发现风险后，
通过补齐碳数据、准备申报材料、调整客户沟通，
预计能减少的那部分损失。
```

### Composite ROI

截图里的 `715% composite ROI` 表示：

```text
净节省 / 系统成本
```

也就是：

```text
Composite ROI =
  (Expected savings - System cost) / System cost
```

如果 ROI 是 `715%`，可以简单理解为：

```text
每投入 1 元系统成本，净节省大约是 7.15 元。
```

它叫 `composite`，是因为当前选中的事件可能同时触发多个风险轴。

例如 CBAM 新闻可能同时触发：

- `regulatory`: CBAM 合规风险。
- `supply_chain`: 欧洲清关或交付延误风险。
- `geopolitical`: 如果事件还涉及红海、苏伊士等路线风险。

沙盘会把这些风险轴的 ROI 合并后展示。

### Scenario mode

`Scenario mode` 是情景假设：

| 模式 | 含义 |
|---|---|
| Base | 默认估计，适合日常汇报和年度预算讨论 |
| Stress | 压力估计，假设监管、供应链或市场冲击更强，用来看最坏一些的情况 |

CBAM 场景里：

- Base：采用默认 CBAM 抽查、追溯、数据缺口和系统减损假设。
- Stress：认为监管冲击更强，抽查或追溯概率更高，提前预警更有价值；同时系统响应成本也略高。

### Time horizon

`Time horizon` 是计算周期。

当前只保留两个企业更常用的档位：

| 周期 | 适合回答的问题 |
|---|---|
| `90d` | 未来一个季度内，当前风险是否值得马上处理 |
| `1y` | 未来 12 个月内，这套系统是否值得进入年度预算 |

如果选 `90d`，意思是：

```text
只看未来 90 天内的期望损失和期望节省。
```

如果切到 `1y`，就表示看未来 12 个月。

CBAM 场景里：

- `90d` 适合看一个季度内的申报窗口、抽查、客户交付节点和整改动作。
- `1y` 适合做年度 ROI 论证。

这里有一个重要口径：`Time horizon` 只缩放风险发生概率、期望损失和期望节省，不把系统成本按天数等比例砍掉。
系统成本按年度部署/承诺成本处理，否则 `90d` 的成本会被压得太低，ROI 反而可能比 `1y` 更高。

### Mitigation intensity

`Mitigation intensity` 是企业响应强度。

截图里的 `60%` 表示：

```text
企业采取中等强度的减损动作。
```

CBAM 场景里的减损动作包括：

- 补齐供应商碳排因子。
- 准备 CBAM 申报材料。
- 提前和欧洲客户沟通交付与合规风险。
- 调整报价或合同条款。
- 准备替代证明或第三方认证。

这个值越高，说明企业响应越积极，系统命中后能减少的损失越多，但成本也可能更高。

### Correlation haircut

`Correlation haircut` 是相关性折扣。

截图里的 `20%` 表示：

```text
多个风险轴同时触发时，不能把所有节省简单相加，要先打 8 折。
```

原因是同一个动作可能同时降低多个风险。

例如：

```text
补齐 CBAM 碳数据
  -> 降低 regulatory 风险
  -> 也可能降低清关延误带来的 supply_chain 风险
```

如果不打折，就会重复计算节省。

所以：

```text
最终 expected savings =
  各风险轴节省之和 x (1 - correlation haircut)
```

`20% haircut` 就是：

```text
最终节省 = 原始节省 x 80%
```

## 前端展示

前端组件：

`src/components/EnterpriseRiskPanel.ts`

展示内容包括：

- Expected loss
- Expected savings
- System cost
- Net savings
- Composite ROI
- 风险轴拆分表
- 假设账本

风险轴拆分表保留完整计算链路，但只重点高亮 3 个业务指标：

- `Saving`：主高亮，表示系统预计能减少多少损失。
- `ROI`：主高亮，表示这类风险轴是否值得投入。
- `Exposure`：次级高亮，表示这个风险轴的敞口盘子有多大。

`Base loss`、`Residual`、`Cost`、`Net` 继续展示，用来保留公式可解释性，但视觉上不抢主指标。

假设账本会显示：

- 假设名称
- 当前取值
- 来源
- 置信度
- 是否来自 Qwen 或 deterministic fallback

## API 接入

Qwen 入口：

`api/enterprise-risk-agent.js`

新增模式：

```text
roi_assumptions
```

这个模式只返回假设包，不返回 ROI 计算结果。

浏览器侧调用：

`src/services/enterprise-risk-agent-client.ts`

调用完成后，`data-loader` 会把假设包合并进 assessment：

```text
Qwen assumption pack
  -> applyEnterpriseRiskRoiAssumptionPack()
    -> buildEnterpriseRoiSimulation()
      -> ROI sandbox UI
```

## 一句话总结

ROI 沙盘不是让 Qwen 算钱，而是让 Qwen 帮我们补“有依据的假设”。

最后的 ROI 数字必须由固定公式算出来：

```text
Open FAIR/NIST 定口径
Qwen 补假设
TypeScript 计算器算结果
UI 展示假设和 ROI
```
