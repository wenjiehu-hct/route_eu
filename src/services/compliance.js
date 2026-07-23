import { COMPLIANCE_SCENARIOS, TEST_STATUSES, getComplianceProfile } from '../constants/compliance.js';
import { formatKm } from './utils.js';

export function getRouteComplianceMetrics(route) {
  const stats = route?.stats || {};
  const roadTypes = stats.roadTypeDistances || {};
  const signals = stats.regulatorySignals || {};
  const motorwayDistance = sumMatching(roadTypes, /^(motorway|trunk)(?:_link)?$/);
  const linkDistance = sumMatching(roadTypes, /_link$/);
  const urbanDistance = Number(stats.urbanDistance) || sumMatching(roadTypes, /^(primary|secondary|tertiary|residential|unclassified)(?:_link)?$/);
  const distanceTotal = Number(stats.distance) || 0;
  const ruralDistance = Number(stats.ruralDistance) || Math.max(0, distanceTotal - motorwayDistance - urbanDistance);

  return {
    distanceTotal,
    motorwayDistance,
    urbanDistance,
    ruralDistance,
    linkDistance,
    speedTaggedDistance: Number(signals.speedTaggedDistance) || 0,
    speedChangeCount: Number(signals.speedChangeCount) || 0,
    uniqueSpeedLimitCount: Number(signals.uniqueSpeedLimitCount) || 0,
    conditionalSpeedDistance: Number(signals.conditionalSpeedDistance) || 0,
    variableSpeedDistance: Number(signals.variableSpeedDistance) || 0,
    schoolZoneDistance: Number(signals.schoolZoneDistance) || 0,
    tunnelDistance: Number(signals.tunnelDistance) || 0,
    roundaboutCount: Number(signals.roundaboutCount) || 0,
  };
}

export function analyzeRouteScenario(route, scenarioId) {
  const scenario = COMPLIANCE_SCENARIOS[scenarioId];
  if (!scenario) return { score: 0, value: 0, label: '未知场景', auto: false };
  if (scenario.manualOnly || !scenario.autoMetric) {
    return { score: 0, value: 0, label: '需人工验证', auto: false };
  }
  const metrics = getRouteComplianceMetrics(route);
  const value = Number(metrics[scenario.autoMetric]) || 0;
  const score = scenario.target > 0 ? Math.min(100, Math.round(value / scenario.target * 100)) : 0;
  return {
    score,
    value,
    label: formatMetric(value, scenario.unit),
    auto: true,
    meetsTarget: value >= scenario.target,
  };
}

export function analyzeRouteForProfile(route, profileId) {
  const profile = getComplianceProfile(profileId);
  const analyses = profile.scenarios.map(id => ({ id, ...analyzeRouteScenario(route, id) }));
  const automatic = analyses.filter(item => item.auto);
  const score = automatic.length
    ? Math.round(automatic.reduce((sum, item) => sum + item.score, 0) / automatic.length)
    : 0;
  return {
    score,
    matched: automatic.filter(item => item.meetsTarget).length,
    automaticCount: automatic.length,
    analyses,
  };
}

export function buildProjectReport(project, routes) {
  const profile = getComplianceProfile(project.profileId);
  const routeMap = new Map(routes.map(route => [route.id, route]));
  const assignedRoutes = (project.routeIds || []).map(id => routeMap.get(id)).filter(Boolean);
  const lines = [
    `# ${project.name}`,
    '',
    `- 模板：${profile.name}`,
    `- 市场：${project.market || profile.market}`,
    `- 车型/项目：${project.vehicle || '未填写'}`,
    `- 负责人：${project.owner || '未填写'}`,
    `- 状态：${projectStatusLabel(project.status)}`,
    `- 阶段：${({ concept: '概念验证', development: '开发验证', validation: '系统验证', homologation: '认证准备' })[project.phase] || '未设置'}`,
    `- 计划周期：${project.startDate || '未设置'} ～ ${project.endDate || '未设置'}`,
    `- 法规基线：${project.regulatoryBaseline?.frozenAt ? `已冻结（${new Date(project.regulatoryBaseline.frozenAt).toLocaleDateString('zh-CN')}）` : '未冻结'}`,
    `- 车型适用范围：${project.regulatoryBaseline?.vehicleCategory || '未填写'}`,
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '> 本报告用于工程摸底、路线准备和内部预验证，不构成法规合规或型式认证结论。',
    '',
    '## 已分配路线',
    '',
  ];

  if (!assignedRoutes.length) lines.push('- 暂无路线');
  assignedRoutes.forEach(route => {
    const analysis = analyzeRouteForProfile(route, project.profileId);
    lines.push(`- ${route.name}：${formatKm(route.stats?.distance || 0)}，路线适配评分 ${analysis.score}/100`);
  });

  lines.push('', '## 场景覆盖与执行结果', '', '| 类别 | 场景 | 目标 | 路线摸底 | 执行状态 | 指定路线 | 记录 |', '|---|---|---|---|---|---|---|');
  profile.scenarios.forEach(id => {
    const scenario = COMPLIANCE_SCENARIOS[id];
    const result = project.results?.[id] || {};
    const selectedRoute = routeMap.get(result.routeId);
    const best = bestRouteForScenario(assignedRoutes, id);
    const status = TEST_STATUSES.find(item => item.value === result.status)?.label || '未开始';
    lines.push(`| ${escapeCell(scenario.category)} | ${escapeCell(scenario.name)} | ${escapeCell(scenario.targetLabel || '')} | ${escapeCell(best?.analysis.label || '需人工验证')} | ${status} | ${escapeCell(selectedRoute?.name || best?.route?.name || '')} | ${escapeCell(result.notes || '')} |`);
  });

  lines.push('', '## 测试执行', '', '| 日期 | 测试任务 | 路线 | 驾驶员 | 车辆 | 状态 | 里程 |', '|---|---|---|---|---|---|---|');
  if (!(project.testRuns || []).length) lines.push('| - | 暂无测试执行 | - | - | - | - | - |');
  (project.testRuns || []).forEach(run => {
    const route = routeMap.get(run.routeId);
    const status = ({ planned: '待执行', ready: '准备就绪', running: '执行中', paused: '已暂停', completed: '已完成', cancelled: '已取消' })[run.status] || run.status;
    lines.push(`| ${escapeCell(run.date || '')} | ${escapeCell(run.name)} | ${escapeCell(route?.name || '')} | ${escapeCell(run.driver || '')} | ${escapeCell(run.vehicle || '')} | ${escapeCell(status)} | ${escapeCell(run.distance ? `${run.distance} km` : '')} |`);
  });

  (project.testRuns || []).forEach(run => {
    if (!run.scenarioIds?.length) return;
    lines.push('', `### ${run.name} · 场景结果`, '', '| 场景 | 结论 | 现场记录 | 外部证据 | 本机附件 |', '|---|---|---|---|---|');
    run.scenarioIds.forEach(id => {
      const scenario = COMPLIANCE_SCENARIOS[id];
      const result = run.scenarioResults?.[id] || {};
      const status = TEST_STATUSES.find(item => item.value === result.status)?.label || '未开始';
      lines.push(`| ${escapeCell(scenario?.name || id)} | ${escapeCell(status)} | ${escapeCell(result.notes)} | ${escapeCell(result.evidence)} | ${(result.attachments || []).length} |`);
    });
    if ((run.attachments || []).length) lines.push('', `任务附件：${run.attachments.map(item => item.name).join('、')}`);
  });

  lines.push('', '## 问题闭环', '', '| 严重度 | 问题 | 状态 | 负责人 | 测试任务 | 路线 | 证据 | 附件 |', '|---|---|---|---|---|---|---|---|');
  if (!(project.issues || []).length) lines.push('| - | 暂无问题 | - | - | - | - | - | - |');
  (project.issues || []).forEach(issue => {
    const route = routeMap.get(issue.routeId);
    const run = project.testRuns?.find(item => item.id === issue.runId);
    lines.push(`| ${escapeCell(issue.severity)} | ${escapeCell(issue.title)} | ${escapeCell(issue.status)} | ${escapeCell(issue.assignee)} | ${escapeCell(run?.name || '')} | ${escapeCell(route?.name || '')} | ${escapeCell(issue.evidence)} | ${(issue.attachments || []).length} |`);
  });
  (project.issues || []).filter(issue => issue.description || issue.rootCause || issue.resolution || issue.verificationNotes).forEach(issue => {
    lines.push('', `### ${issue.title}`, '', issue.description || '未填写问题描述');
    if (issue.rootCause) lines.push('', `- 根因分析：${issue.rootCause}`);
    if (issue.resolution) lines.push(`- 解决方案：${issue.resolution}`);
    if (issue.verificationNotes) lines.push(`- 验证结论：${issue.verificationNotes}`);
    if ((issue.attachments || []).length) lines.push(`- 本机附件：${issue.attachments.map(item => item.name).join('、')}`);
  });

  if ((project.milestones || []).length) {
    lines.push('', '## 里程碑', '');
    project.milestones.forEach(item => lines.push(`- [${item.status === 'completed' ? 'x' : ' '}] ${item.name}${item.dueDate ? `（${item.dueDate}）` : ''}${item.owner ? ` · ${item.owner}` : ''}`));
  }

  if (project.notes) lines.push('', '## 项目备注', '', project.notes);
  if (profile.references.length) {
    lines.push('', '## 法规基线与参考文件', '');
    if (project.regulatoryBaseline?.applicabilityDate) lines.push(`- 适用日期：${project.regulatoryBaseline.applicabilityDate}`);
    if (project.regulatoryBaseline?.approvedBy) lines.push(`- 法规审核人：${project.regulatoryBaseline.approvedBy}`);
    (project.regulatoryBaseline?.references || profile.references).forEach(reference => lines.push(`- [${reference.label}](${reference.url})${reference.version ? ` · ${reference.version}` : ''}${reference.status ? ` · ${reference.status}` : ''}`));
    if (project.regulatoryBaseline?.notes) lines.push('', project.regulatoryBaseline.notes);
  }
  lines.push('', '## 使用限制', '', '- OSM 与导航数据可能缺失、过期或与现场标志不一致。', '- 路线评分只用于筛选路线，法规结论必须依据适用版本原文、现场真值和合格试验程序。', '- 涉及 AEB、转向干预、超驰等风险动作时，应遵守当地法律并在封闭场地或受控条件下执行。');
  return lines.join('\n');
}

export function buildProjectCsv(project, routes) {
  const routeMap = new Map(routes.map(route => [route.id, route]));
  const rows = [['record_type', 'project', 'date', 'test_run', 'route', 'scenario', 'status', 'driver', 'vehicle', 'distance_km', 'issue', 'severity', 'assignee', 'notes', 'evidence']];
  (project.testRuns || []).forEach(run => {
    if (!run.scenarioIds?.length) rows.push(['run', project.name, run.date, run.name, routeMap.get(run.routeId)?.name || '', '', run.status, run.driver, run.vehicle, run.distance || '', '', '', '', run.notes, attachmentIndex(run.attachments)]);
    run.scenarioIds?.forEach(id => {
      const result = run.scenarioResults?.[id] || {};
      rows.push(['scenario', project.name, run.date, run.name, routeMap.get(run.routeId)?.name || '', COMPLIANCE_SCENARIOS[id]?.name || id, result.status || 'not_started', run.driver, run.vehicle, run.distance || '', '', '', '', result.notes || '', [result.evidence, attachmentIndex(result.attachments)].filter(Boolean).join(' | ')]);
    });
  });
  (project.issues || []).forEach(issue => {
    const run = project.testRuns?.find(item => item.id === issue.runId);
    rows.push(['issue', project.name, issue.createdAt?.slice(0, 10) || '', run?.name || '', routeMap.get(issue.routeId)?.name || '', COMPLIANCE_SCENARIOS[issue.scenarioId]?.name || '', issue.status, '', '', '', issue.title, issue.severity, issue.assignee, [issue.description, issue.rootCause, issue.resolution, issue.verificationNotes].filter(Boolean).join(' | '), [issue.evidence, attachmentIndex(issue.attachments)].filter(Boolean).join(' | ')]);
  });
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}

export function bestRouteForScenario(routes, scenarioId) {
  const scenario = COMPLIANCE_SCENARIOS[scenarioId];
  if (!scenario || scenario.manualOnly || !scenario.autoMetric) return null;
  return routes
    .map(route => ({ route, analysis: analyzeRouteScenario(route, scenarioId) }))
    .sort((a, b) => b.analysis.score - a.analysis.score)[0] || null;
}

function sumMatching(values, matcher) {
  return Object.entries(values).reduce((sum, [key, value]) => matcher.test(key) ? sum + (Number(value) || 0) : sum, 0);
}

function formatMetric(value, unit) {
  if (unit === 'km') return formatKm(value);
  if (unit === 'count') return `${Math.round(value)} 次`;
  if (unit === 'presence') return value > 0 ? '已发现' : '未发现';
  return String(value);
}

function escapeCell(value) {
  return String(value || '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function projectStatusLabel(status) {
  return ({ planning: '规划中', running: '执行中', paused: '暂停', completed: '已完成' })[status] || '规划中';
}

function csvCell(value) {
  const text = String(value ?? '').replaceAll('"', '""');
  return `"${text}"`;
}

function attachmentIndex(attachments = []) {
  return attachments.map(item => item.name).join(' | ');
}
