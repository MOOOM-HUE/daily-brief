// 离线自测用样例数据（--offline 模式）：模拟抓取到的候选新闻
// 时间统一设为"昨天"，便于验证昨天的精选逻辑与文件产出。

export const SAMPLE_YESTERDAY = '2026-01-05';

export const SAMPLE_CANDIDATES = [
  {
    title: 'OpenAI 发布 Agent 工具链重大更新，可跨应用自主执行任务',
    url: 'https://example.com/news/openai-agent-update',
    snippet:
      'OpenAI 昨日发布新版 Agent 工具链，支持跨应用自主规划与执行任务，并开放给开发者 API。分析认为这将显著降低企业接入智能体的门槛，行业竞争从模型能力转向工程化落地。',
    publishedAt: new Date('2026-01-04T23:30:00Z').getTime(),
    sourceName: 'TechCrunch AI',
    topic: 'AI / Agent / 大模型',
    image: 'https://picsum.photos/seed/openai/640/360',
  },
  {
    title: '国产大模型厂商发布千亿参数新模型，推理成本再降五成',
    url: 'https://example.com/news/cn-llm-cost-down',
    snippet:
      '某国产大模型厂商昨日发布千亿参数旗舰模型，主打长上下文与低推理成本，官方称单位 token 成本较上一代下降约 50%。业内观点认为价格战将加速 Agent 类应用的规模化。',
    publishedAt: new Date('2026-01-04T15:10:00Z').getTime(),
    sourceName: '机器之心',
    topic: 'AI / Agent / 大模型',
    image: 'https://picsum.photos/seed/llm/640/360',
  },
  {
    title: '英伟达发布新一代消费级 GPU，AI 算力下放到个人电脑',
    url: 'https://example.com/news/nvidia-consumer-gpu',
    snippet:
      '英伟达昨日发布新一代消费级 GPU，首次在主流价位提供本地大模型推理加速。硬件评测普遍认为这将推动端侧 AI 应用生态爆发，同时带动整机升级需求。',
    publishedAt: new Date('2026-01-04T12:00:00Z').getTime(),
    sourceName: 'The Verge',
    topic: '科技产品与硬件',
    image: 'https://picsum.photos/seed/gpu/640/360',
  },
  {
    title: '苹果发布搭载自研芯片的新款 Mac，性能提升但价格上调',
    url: 'https://example.com/news/apple-mac-new-chip',
    snippet:
      '苹果昨日更新 Mac 产品线，搭载新一代自研芯片，续航与性能均有提升，起售价上调。有观点认为定价策略反映供应链成本压力，也有分析指出需观察 AI 功能能否撑起溢价。',
    publishedAt: new Date('2026-01-04T08:00:00Z').getTime(),
    sourceName: 'Engadget',
    topic: '科技产品与硬件',
    image: 'https://picsum.photos/seed/apple/640/360',
  },
  {
    title: '教育部发布 2026 年高校毕业生就业工作通知，拓宽基层就业渠道',
    url: 'https://example.com/news/edu-employment-policy',
    snippet:
      '教育部昨日发布新一年度高校毕业生就业工作通知，提出拓宽基层就业渠道、扩大科研助理岗位等举措。专家解读认为政策信号利好教育类与就业服务类企业，也需关注结构性矛盾。',
    publishedAt: new Date('2026-01-04T10:30:00Z').getTime(),
    sourceName: 'Bing:大学生 就业',
    topic: '大学 / 专业 / 就业',
    image: 'https://picsum.photos/seed/edu/640/360',
  },
  {
    title: '多所高校公布 2026 年新增本科专业，人工智能方向持续扩张',
    url: 'https://example.com/news/university-new-majors',
    snippet:
      '多所高校昨日公布 2026 年新增本科专业名单，人工智能、数据科学等方向持续扩容。教育研究者提醒，专业热未必等于就业热，报考需结合培养方案与行业周期。',
    publishedAt: new Date('2026-01-04T09:20:00Z').getTime(),
    sourceName: 'Bing:高考 专业 就业',
    topic: '大学 / 专业 / 就业',
    image: 'https://picsum.photos/seed/major/640/360',
  },
  {
    title: '某创业公司发布端侧 Agent 开发框架，宣称无需云端即可部署',
    url: 'https://example.com/news/edge-agent-framework',
    snippet:
      '一家创业公司昨日发布端侧 Agent 开发框架，宣称可在消费级硬件上离线部署智能体。业界对该框架的实际效果存在分歧：支持者认为端侧是趋势，质疑者指出复杂任务仍需云端算力。',
    publishedAt: new Date('2026-01-04T05:00:00Z').getTime(),
    sourceName: 'VentureBeat AI',
    topic: 'AI / Agent / 大模型',
    image: 'https://picsum.photos/seed/agent/640/360',
  },
  {
    title: '国内手机厂商发布折叠屏新品，铰链与影像成竞争焦点',
    url: 'https://example.com/news/foldable-phone',
    snippet:
      '国内手机厂商昨日发布新一代折叠屏手机，主打更轻铰链与更强影像。行业分析认为折叠屏进入性价比竞争阶段，供应链成熟度成为决定销量的关键变量。',
    publishedAt: new Date('2026-01-04T03:40:00Z').getTime(),
    sourceName: '36氪',
    topic: '科技产品与硬件',
    image: 'https://picsum.photos/seed/fold/640/360',
  },
  {
    title: '调查报告：AI 岗位需求同比增长 45%，复合型人才最稀缺',
    url: 'https://example.com/news/ai-jobs-report',
    snippet:
      '一份昨日发布的招聘平台报告显示，AI 相关岗位需求同比增长约 45%，既懂业务又懂技术的复合型人才最稀缺。报告同时指出院校培养与产业需求仍存在错位。',
    publishedAt: new Date('2026-01-04T01:00:00Z').getTime(),
    sourceName: 'Bing:大学生 就业',
    topic: '大学 / 专业 / 就业',
    image: 'https://picsum.photos/seed/report/640/360',
  },
  {
    title: '某芯片厂商公布 2nm 工艺进度，预计明年量产',
    url: 'https://example.com/news/chip-2nm',
    snippet:
      '某芯片代工厂昨日公布 2nm 工艺最新进度，宣称良率达标并预计明年量产。半导体分析师认为这关系下一代旗舰芯片性能，也将影响 AI 训练成本曲线。',
    publishedAt: new Date('2026-01-04T00:30:00Z').getTime(),
    sourceName: 'Bing:芯片 发布',
    topic: '科技产品与硬件',
    image: 'https://picsum.photos/seed/chip/640/360',
  },
  {
    title: '考研国家线公布，多学科分数线上涨引发讨论',
    url: 'https://example.com/news/kaoyan-line',
    snippet:
      '昨日考研国家线公布，多个学科分数线较去年上涨。教育评论指出报名人数下降但分数线仍涨，反映考生结构变化；也有观点认为应理性看待单年波动。',
    publishedAt: new Date('2026-01-04T20:00:00Z').getTime(),
    sourceName: 'Bing:考研 分数线',
    topic: '大学 / 专业 / 就业',
    image: 'https://picsum.photos/seed/kaoyan/640/360',
  },
];

// 与上面部分条目"撞题"的近期历史，用于验证去重提示是否生效
export const SAMPLE_HISTORY = [
  { key: 'u:example.com/news/openai-agent-update', title: 'OpenAI 发布 Agent 工具链更新（昨日重复）', topic: 'AI / Agent / 大模型', date: '2026-01-03' },
  { key: 'u:example.com/news/nvidia-consumer-gpu', title: '英伟达新一代 GPU 发布（前日已报道）', topic: '科技产品与硬件', date: '2026-01-03' },
];

export const SAMPLE_SUBSCRIPTIONS = [
  {
    endpoint: 'https://example.push.apple.com/dummy-endpoint-for-offline-test',
    keys: { p256dh: 'dummy', auth: 'dummy' },
    addedAt: '2026-01-01T00:00:00.000Z',
  },
];
