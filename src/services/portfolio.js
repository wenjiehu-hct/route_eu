import { getComplianceProfile } from '../constants/compliance.js';

export const flattenRoutes = groups => groups.flatMap(group => group.routes || []);

export function getProjectMetrics(project, allRoutes = []) {
  const profile = getComplianceProfile(project.profileId);
  const scenarioIds = profile.scenarios || [];
  const testRuns = Array.isArray(project.testRuns) ? project.testRuns : [];
  const milestones = Array.isArray(project.milestones) ? project.milestones : [];
  const issues = Array.isArray(project.issues) ? project.issues : [];
  const completedScenarios = scenarioIds.filter(id => ['passed', 'failed', 'blocked', 'not_applicable'].includes(project.results?.[id]?.status)).length;
  const completedRuns = testRuns.filter(run => run.status === 'completed').length;
  const openIssues = issues.filter(issue => !['closed', 'verified'].includes(issue.status));
  const criticalIssues = openIssues.filter(issue => ['critical', 'high'].includes(issue.severity)).length;
  const assignedRoutes = allRoutes.filter(route => project.routeIds.includes(route.id));
  const assignedDistance = assignedRoutes.reduce((sum, route) => sum + (route.stats?.distance || 0), 0);
  const milestoneDone = milestones.filter(item => item.status === 'completed').length;
  const scenarioProgress = scenarioIds.length ? completedScenarios / scenarioIds.length : 0;
  const runProgress = testRuns.length ? completedRuns / testRuns.length : 0;
  const milestoneProgress = milestones.length ? milestoneDone / milestones.length : 0;
  const deliveryProgress = Math.round((scenarioProgress * .6 + runProgress * .25 + milestoneProgress * .15) * 100);
  const baseline = project.regulatoryBaseline || {};
  const references = Array.isArray(baseline.references) ? baseline.references : [];
  const hasUsableRoute = assignedRoutes.some(route => (route.stats?.distance || 0) > 0);
  const hasLongRoute = assignedRoutes.some(route => (route.stats?.distance || 0) >= 10_000);
  const hasNavigableRoute = assignedRoutes.some(route => (route.stops?.length || 0) >= 2 || route.googleUrl);
  const hasRunRoute = testRuns.some(run => run.routeId && assignedRoutes.some(route => route.id === run.routeId));
  const readinessDimensions = [
    readinessDimension('definition', '项目定义', 25, [
      readinessItem('owner', '指定项目负责人', 6, Boolean(project.owner?.trim()), 'definition', true),
      readinessItem('market', '确认目标市场', 5, Boolean(project.market?.trim()), 'definition'),
      readinessItem('vehicle', '填写车型 / 软件 / 地图版本', 6, Boolean(project.vehicle?.trim()), 'definition', true),
      readinessItem('startDate', '设置项目开始日期', 4, Boolean(project.startDate), 'definition'),
      readinessItem('endDate', '设置计划结束日期', 4, Boolean(project.endDate), 'definition'),
    ]),
    readinessDimension('baseline', '法规基线', 20, [
      readinessItem('applicabilityDate', '填写法规适用日期', 4, Boolean(baseline.applicabilityDate), 'baseline'),
      readinessItem('vehicleCategory', '确认车型类别与适用范围', 4, Boolean(baseline.vehicleCategory?.trim()), 'baseline'),
      readinessItem('approvedBy', '指定法规审核人', 4, Boolean(baseline.approvedBy?.trim()), 'baseline'),
      readinessItem('references', '确认法规文件版本', 4, references.length > 0 && references.every(reference => reference.version?.trim() && ['reviewed', 'frozen'].includes(reference.status)), 'baseline'),
      readinessItem('frozenAt', '冻结法规基线', 4, Boolean(baseline.frozenAt), 'baseline', true),
    ]),
    readinessDimension('routes', '路线包', 25, [
      readinessItem('assignedRoutes', '至少关联一条测试路线', 10, assignedRoutes.length > 0, 'routes', true),
      readinessItem('usableRoute', '路线具有可计算里程', 5, hasUsableRoute, 'routes'),
      readinessItem('longRoute', '至少一条路线达到 10 km', 5, hasLongRoute, 'routes'),
      readinessItem('navigableRoute', '路线具有可导航 Waypoint', 5, hasNavigableRoute, 'routes'),
    ]),
    readinessDimension('execution', '执行计划', 30, [
      readinessItem('testRun', '创建测试执行任务', 7, testRuns.length > 0, 'runs', true),
      readinessItem('runRoute', '为任务分配有效路线', 5, hasRunRoute, 'runs', true),
      readinessItem('runDriver', '为任务指派驾驶员', 5, testRuns.some(run => run.driver?.trim()), 'runs', true),
      readinessItem('runVehicle', '为任务填写车辆版本', 4, testRuns.some(run => run.vehicle?.trim()), 'runs'),
      readinessItem('runScenarios', '为任务选择测试场景', 4, testRuns.some(run => run.scenarioIds?.length), 'runs'),
      readinessItem('runReady', '至少一个任务准备就绪', 5, testRuns.some(run => ['ready', 'running', 'completed'].includes(run.status)), 'runs', true),
    ]),
  ];
  const readiness = Math.round(readinessDimensions.reduce((sum, dimension) => sum + dimension.contribution, 0));
  const readinessMissing = readinessDimensions.flatMap(dimension => dimension.items.filter(item => !item.complete).map(item => ({ ...item, dimensionId: dimension.id, dimensionLabel: dimension.label }))).sort((a, b) => Number(b.critical) - Number(a.critical) || b.weight - a.weight);
  const readinessLabel = readiness >= 85 ? '已具备开测条件' : readiness >= 60 ? '基本就绪，仍需补项' : readiness >= 30 ? '准备中' : '尚未形成执行条件';
  return { profile, scenarioCount: scenarioIds.length, completedScenarios, completedRuns, openIssues, criticalIssues, assignedRoutes, assignedDistance, milestoneDone, readiness, readinessLabel, readinessDimensions, readinessMissing, deliveryProgress };
}

function readinessItem(id, label, weight, complete, action, critical = false) {
  return { id, label, weight, complete: Boolean(complete), action, critical };
}

function readinessDimension(id, label, weight, items) {
  const completedWeight = items.reduce((sum, item) => sum + (item.complete ? item.weight : 0), 0);
  return { id, label, weight, items, score: Math.round(completedWeight / weight * 100), contribution: completedWeight };
}

export function formatDate(value, fallback = '未设置') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function relativeTime(value) {
  if (!value) return '';
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

export function toneForProject(project) {
  if (project.status === 'completed') return 'green';
  if (project.status === 'paused') return 'amber';
  if (project.priority === 'critical') return 'red';
  return 'blue';
}
