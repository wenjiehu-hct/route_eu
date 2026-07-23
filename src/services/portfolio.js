import { getComplianceProfile } from '../constants/compliance.js';

export const flattenRoutes = groups => groups.flatMap(group => group.routes || []);

export function getProjectMetrics(project, allRoutes = []) {
  const profile = getComplianceProfile(project.profileId);
  const scenarioIds = profile.scenarios || [];
  const completedScenarios = scenarioIds.filter(id => ['passed', 'failed', 'blocked', 'not_applicable'].includes(project.results?.[id]?.status)).length;
  const completedRuns = project.testRuns.filter(run => run.status === 'completed').length;
  const openIssues = project.issues.filter(issue => !['closed', 'verified'].includes(issue.status));
  const criticalIssues = openIssues.filter(issue => ['critical', 'high'].includes(issue.severity)).length;
  const assignedRoutes = allRoutes.filter(route => project.routeIds.includes(route.id));
  const assignedDistance = assignedRoutes.reduce((sum, route) => sum + (route.stats?.distance || 0), 0);
  const milestoneDone = project.milestones.filter(item => item.status === 'completed').length;
  const scenarioProgress = scenarioIds.length ? completedScenarios / scenarioIds.length : 0;
  const milestoneProgress = project.milestones.length ? milestoneDone / project.milestones.length : 0;
  const readiness = Math.round((scenarioProgress * .55 + milestoneProgress * .25 + (assignedRoutes.length ? .2 : 0)) * 100);
  return { profile, scenarioCount: scenarioIds.length, completedScenarios, completedRuns, openIssues, criticalIssues, assignedRoutes, assignedDistance, milestoneDone, readiness };
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
