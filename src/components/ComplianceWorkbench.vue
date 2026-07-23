<template>
  <n-card class="compliance-card" size="small">
    <template #header>
      <div class="compliance-title">
        <div>
          <strong>海外法规测试工作台</strong>
          <span>法规路线规划 · 执行记录 · 工程报告</span>
        </div>
        <n-tag size="small" type="warning">工程摸底</n-tag>
      </div>
    </template>

    <div v-if="!activeProject" class="compliance-empty">
      <div class="empty-icon">GSR</div>
      <h3>建立第一个法规测试项目</h3>
      <p>选择模板后，把路线加入项目，系统会自动分析道路类型、里程、限速数据与复杂场景覆盖。</p>
      <n-select v-model:value="newProfileId" :options="profileOptions" />
      <n-button type="primary" @click="store.createProject(newProfileId)">创建测试项目</n-button>
      <div class="template-list">
        <button v-for="profile in store.profiles" :key="profile.id" type="button" @click="createFrom(profile.id)">
          <strong>{{ profile.name }}</strong>
          <span>{{ profile.market }} · {{ profile.scenarios.length }} 个场景</span>
        </button>
      </div>
    </div>

    <template v-else>
      <div class="project-toolbar">
        <n-select
          :value="store.activeProjectId"
          :options="projectOptions"
          size="small"
          @update:value="store.selectProject"
        />
        <n-button size="small" @click="store.createProject(activeProject.profileId)">新建</n-button>
        <n-button size="small" quaternary @click="store.duplicateProject(activeProject.id)">复制</n-button>
      </div>

      <div class="compliance-nav">
        <button v-for="item in sections" :key="item.value" :class="{ active: section === item.value }" @click="section = item.value">
          {{ item.label }}
          <span v-if="item.value === 'routes'">{{ assignedRoutes.length }}</span>
          <span v-if="item.value === 'scenarios'">{{ completedCount }}/{{ scenarios.length }}</span>
        </button>
      </div>

      <div v-if="section === 'overview'" class="section-stack">
        <div class="readiness-panel">
          <div class="readiness-score">
            <strong>{{ routeReadiness }}</strong><span>/100</span>
            <small>路线准备度</small>
          </div>
          <div class="readiness-copy">
            <strong>{{ activeProfile.name }}</strong>
            <span>{{ activeProfile.type }} · {{ activeProject.market }}</span>
            <n-progress type="line" :percentage="executionPercent" :show-indicator="false" />
            <small>执行完成 {{ completedCount }}/{{ scenarios.length }} · 已分配 {{ assignedRoutes.length }} 条路线</small>
          </div>
        </div>

        <div class="safety-notice">
          本模块用于工程摸底与内部预验证，不构成法规认证结论。OSM 数据必须用现场标志和适用法规原文复核；AEB、转向干预等危险动作只能在受控条件下执行。
        </div>

        <div class="form-grid">
          <label class="span-2">项目名称<n-input :value="activeProject.name" @update:value="update('name', $event)" /></label>
          <label>模板<n-select :value="activeProject.profileId" :options="profileOptions" @update:value="store.setProfile" /></label>
          <label>项目状态<n-select :value="activeProject.status" :options="projectStatusOptions" @update:value="update('status', $event)" /></label>
          <label>目标市场<n-input :value="activeProject.market" @update:value="update('market', $event)" /></label>
          <label>车型/版本<n-input :value="activeProject.vehicle" placeholder="车型、软件、地图版本" @update:value="update('vehicle', $event)" /></label>
          <label>负责人<n-input :value="activeProject.owner" @update:value="update('owner', $event)" /></label>
          <label class="span-2">项目备注<n-input type="textarea" :rows="3" :value="activeProject.notes" @update:value="update('notes', $event)" /></label>
        </div>

        <div class="overview-actions">
          <n-button type="primary" @click="openCompliancePlanner">按模板生成路线</n-button>
          <n-button type="primary" :disabled="!assignedRoutes.length" @click="section = 'scenarios'">进入场景矩阵</n-button>
          <n-button @click="store.exportProject(activeProject.id, allRoutes)">导出 Markdown 报告</n-button>
          <n-button type="error" quaternary @click="removeProject">删除项目</n-button>
        </div>
      </div>

      <div v-else-if="section === 'routes'" class="section-stack">
        <div class="section-head">
          <div><strong>测试路线池</strong><span>将现有路线加入项目，评分越高表示自动场景匹配越充分。</span></div>
          <n-space :size="5">
            <n-button size="tiny" @click="store.assignAllRoutes(allRoutes.map(route => route.id))">全选</n-button>
            <n-button size="tiny" @click="store.assignAllRoutes([])">清空</n-button>
          </n-space>
        </div>
        <n-empty v-if="!allRoutes.length" size="small" description="路线库为空，请先生成或手工创建路线" />
        <div v-else class="compliance-route-list">
          <div
            v-for="item in rankedRoutes"
            :key="item.route.id"
            class="compliance-route-item"
            :class="{ selected: (activeProject.routeIds || []).includes(item.route.id) }"
          >
            <n-checkbox
              :checked="(activeProject.routeIds || []).includes(item.route.id)"
              @update:checked="store.toggleRoute(item.route.id, $event)"
            />
            <span class="route-swatch" :style="{ background: item.route.color }"></span>
            <button type="button" class="route-score-main" @click="routeStore.locateRoute(item.route.id)">
              <strong>{{ item.route.name }}</strong>
              <span>{{ formatKm(item.route.stats?.distance || 0) }} · 自动覆盖 {{ item.analysis.matched }}/{{ item.analysis.automaticCount }}</span>
              <small>{{ regulatorySummary(item.route) }}</small>
            </button>
            <div class="score-badge" :class="scoreClass(item.analysis.score)">{{ item.analysis.score }}</div>
          </div>
        </div>
        <div class="route-score-legend">评分基于路线数据，不代表测试通过。手工创建且未含 OSM 法规属性的路线评分可能偏低。</div>
      </div>

      <div v-else-if="section === 'scenarios'" class="section-stack">
        <div class="section-head">
          <div><strong>测试场景覆盖矩阵</strong><span>自动指标用于筛路；执行状态、真值和证据由测试人员确认。</span></div>
          <n-button size="small" @click="store.exportProject(activeProject.id, allRoutes)">导出报告</n-button>
        </div>

        <div v-if="!assignedRoutes.length" class="safety-notice">请先在“路线池”中分配至少一条路线。</div>

        <n-collapse :default-expanded-names="[scenarioGroups[0]?.category]">
          <n-collapse-item v-for="group in scenarioGroups" :key="group.category" :name="group.category">
            <template #header>
              <div class="scenario-group-title">
                <strong>{{ group.category }}</strong>
                <span>{{ groupCompleted(group) }}/{{ group.items.length }}</span>
              </div>
            </template>
            <div class="scenario-list">
              <article v-for="scenario in group.items" :key="scenario.id" class="scenario-card">
                <div class="scenario-topline">
                  <div>
                    <strong>{{ scenario.name }}</strong>
                    <span>目标 {{ scenario.targetLabel }}</span>
                  </div>
                  <n-tag size="small" :type="statusInfo(resultFor(scenario.id).status).type">
                    {{ statusInfo(resultFor(scenario.id).status).label }}
                  </n-tag>
                </div>
                <p>{{ scenario.objective }}</p>
                <div class="auto-match">
                  <span>路线摸底</span>
                  <strong>{{ bestMatch(scenario.id)?.analysis.label || '需人工验证' }}</strong>
                  <span v-if="bestMatch(scenario.id)?.route">{{ bestMatch(scenario.id).route.name }}</span>
                </div>
                <n-progress
                  v-if="bestMatch(scenario.id)?.analysis.auto"
                  type="line"
                  :percentage="bestMatch(scenario.id).analysis.score"
                  :show-indicator="false"
                  :status="bestMatch(scenario.id).analysis.meetsTarget ? 'success' : 'default'"
                />
                <div class="scenario-edit-grid">
                  <label>执行状态<n-select size="small" :value="resultFor(scenario.id).status || 'not_started'" :options="testStatusOptions" @update:value="setResult(scenario.id, 'status', $event)" /></label>
                  <label>执行路线<n-select clearable size="small" :value="resultFor(scenario.id).routeId || null" :options="assignedRouteOptions" @update:value="setResult(scenario.id, 'routeId', $event || '')" /></label>
                  <label>实测次数<n-input-number size="small" :min="0" :value="resultFor(scenario.id).actualCount" @update:value="setResult(scenario.id, 'actualCount', $event)" /></label>
                  <label class="span-2">结果记录<n-input type="textarea" :rows="2" :value="resultFor(scenario.id).notes || ''" :placeholder="scenario.evidenceHint" @update:value="setResult(scenario.id, 'notes', $event)" /></label>
                  <label class="span-2">证据索引<n-input :value="resultFor(scenario.id).evidence || ''" placeholder="视频文件名、日志ID、问题单或云盘链接" @update:value="setResult(scenario.id, 'evidence', $event)" /></label>
                </div>
                <details>
                  <summary>路线与证据建议</summary>
                  <div>{{ scenario.routeHint }}</div>
                  <div>{{ scenario.evidenceHint }}</div>
                </details>
              </article>
            </div>
          </n-collapse-item>
        </n-collapse>
      </div>

      <div v-else class="section-stack">
        <div class="reference-intro">
          <strong>{{ activeProfile.name }}</strong>
          <p>{{ activeProfile.description }}</p>
        </div>
        <div v-if="activeProfile.references.length" class="reference-list">
          <a v-for="reference in activeProfile.references" :key="reference.url" :href="reference.url" target="_blank" rel="noreferrer">
            <span>{{ reference.label }}</span><strong>打开官方来源 ↗</strong>
          </a>
        </div>
        <n-empty v-else size="small" description="该模板是跨市场工程模板，请按目标国家补充适用法规版本" />
        <div class="safety-notice">
          法规和消费者测试协议会更新。项目立项时应冻结适用市场、车型类别、实施日期及法规/协议版本，并由法规工程师复核。
        </div>
      </div>
    </template>
  </n-card>
</template>

<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { COMPLIANCE_SCENARIOS, TEST_STATUSES, getComplianceProfile } from '../constants/compliance.js';
import { analyzeRouteForProfile, bestRouteForScenario } from '../services/compliance.js';
import { formatKm } from '../services/utils.js';
import { useComplianceStore } from '../stores/compliance.js';
import { useCoveragePlannerStore } from '../stores/coveragePlanner.js';
import { useRoutePlannerStore } from '../stores/routePlanner.js';

const store = useComplianceStore();
const routeStore = useRoutePlannerStore();
const coverageStore = useCoveragePlannerStore();
const { activeProject } = storeToRefs(store);
const { allRoutes } = storeToRefs(routeStore);
const section = ref('overview');
const newProfileId = ref(store.profiles[0].id);
const sections = [
  { value: 'overview', label: '项目' },
  { value: 'routes', label: '路线池' },
  { value: 'scenarios', label: '场景矩阵' },
  { value: 'references', label: '依据' },
];
const projectStatusOptions = [
  { label: '规划中', value: 'planning' },
  { label: '执行中', value: 'running' },
  { label: '暂停', value: 'paused' },
  { label: '已完成', value: 'completed' },
];
const testStatusOptions = TEST_STATUSES.map(item => ({ label: item.label, value: item.value }));
const profileOptions = computed(() => store.profiles.map(profile => ({ label: profile.name, value: profile.id })));
const projectOptions = computed(() => store.projects.map(project => ({ label: project.name, value: project.id })));
const activeProfile = computed(() => getComplianceProfile(activeProject.value?.profileId));
const scenarios = computed(() => activeProfile.value.scenarios.map(id => COMPLIANCE_SCENARIOS[id]).filter(Boolean));
const assignedRoutes = computed(() => {
  const ids = new Set(activeProject.value?.routeIds || []);
  return allRoutes.value.filter(route => ids.has(route.id));
});
const assignedRouteOptions = computed(() => assignedRoutes.value.map(route => ({ label: route.name, value: route.id })));
const rankedRoutes = computed(() => allRoutes.value
  .map(route => ({ route, analysis: analyzeRouteForProfile(route, activeProject.value?.profileId) }))
  .sort((a, b) => b.analysis.score - a.analysis.score));
const scenarioGroups = computed(() => {
  const result = [];
  scenarios.value.forEach(scenario => {
    let group = result.find(item => item.category === scenario.category);
    if (!group) {
      group = { category: scenario.category, items: [] };
      result.push(group);
    }
    group.items.push(scenario);
  });
  return result;
});
const completedCount = computed(() => scenarios.value.filter(scenario => {
  const status = activeProject.value?.results?.[scenario.id]?.status;
  return ['passed', 'failed', 'blocked', 'not_applicable'].includes(status);
}).length);
const executionPercent = computed(() => scenarios.value.length ? Math.round(completedCount.value / scenarios.value.length * 100) : 0);
const routeReadiness = computed(() => {
  const automatic = scenarios.value.filter(scenario => !scenario.manualOnly && scenario.autoMetric);
  if (!automatic.length || !assignedRoutes.value.length) return 0;
  return Math.round(automatic.reduce((sum, scenario) => sum + (bestMatch(scenario.id)?.analysis.score || 0), 0) / automatic.length);
});

function createFrom(profileId) {
  newProfileId.value = profileId;
  store.createProject(profileId);
}

function update(field, value) {
  store.updateProject({ [field]: value });
}

function openCompliancePlanner() {
  coverageStore.configureForCompliance(activeProject.value.profileId, activeProject.value.id);
  window.dispatchEvent(new CustomEvent('open-workspace', { detail: 'coverage' }));
}

function removeProject() {
  if (window.confirm(`确定删除测试项目“${activeProject.value.name}”吗？路线本身不会被删除。`)) {
    store.deleteProject(activeProject.value.id);
  }
}

function resultFor(scenarioId) {
  return activeProject.value?.results?.[scenarioId] || {};
}

function setResult(scenarioId, field, value) {
  store.setScenarioResult(scenarioId, { [field]: value });
}

function bestMatch(scenarioId) {
  return bestRouteForScenario(assignedRoutes.value, scenarioId);
}

function statusInfo(status = 'not_started') {
  return TEST_STATUSES.find(item => item.value === status) || TEST_STATUSES[0];
}

function groupCompleted(group) {
  return group.items.filter(scenario => ['passed', 'failed', 'blocked', 'not_applicable'].includes(resultFor(scenario.id).status)).length;
}

function regulatorySummary(route) {
  const signals = route.stats?.regulatorySignals;
  if (!signals) return '暂无 OSM 限速属性，可人工执行或重新用区域规划生成';
  const parts = [
    `限速覆盖 ${formatKm(signals.speedTaggedDistance || 0)}`,
    `变化 ${signals.speedChangeCount || 0} 次`,
    `限速值 ${signals.uniqueSpeedLimitCount || 0} 种`,
  ];
  if (signals.tunnelDistance) parts.push(`隧道 ${formatKm(signals.tunnelDistance)}`);
  if (signals.roundaboutCount) parts.push(`环岛 ${signals.roundaboutCount} 个`);
  return parts.join(' · ');
}

function scoreClass(score) {
  if (score >= 75) return 'good';
  if (score >= 45) return 'medium';
  return 'low';
}
</script>

<style scoped>
.compliance-card { border: 1px solid #cbd9ee; }
.compliance-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.compliance-title > div { display: flex; flex-direction: column; }
.compliance-title strong { font-size: 15px; }
.compliance-title span { color: #64748b; font-size: 11px; font-weight: 400; }
.compliance-empty { display: flex; flex-direction: column; align-items: stretch; gap: 10px; text-align: center; padding: 8px 0; }
.compliance-empty h3, .compliance-empty p { margin: 0; }
.compliance-empty p { color: #64748b; font-size: 12px; line-height: 1.6; }
.empty-icon { align-self: center; display: grid; place-items: center; width: 58px; height: 58px; border-radius: 18px; background: linear-gradient(135deg, #123c7a, #3478d4); color: white; font-size: 18px; font-weight: 800; box-shadow: 0 8px 20px rgba(18, 60, 122, .22); }
.template-list { display: grid; gap: 6px; margin-top: 4px; }
.template-list button { text-align: left; padding: 9px 10px; border: 1px solid #dbe5f2; background: white; border-radius: 9px; cursor: pointer; }
.template-list button:hover { border-color: #3b82f6; background: #f7fbff; }
.template-list button strong, .template-list button span { display: block; }
.template-list button span { margin-top: 2px; color: #64748b; font-size: 11px; }
.project-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; }
.compliance-nav { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 4px; margin: 10px 0; border-radius: 9px; background: #edf2f8; }
.compliance-nav button { border: 0; border-radius: 7px; background: transparent; padding: 7px 3px; font-size: 12px; cursor: pointer; color: #526175; }
.compliance-nav button.active { color: #123c7a; background: white; font-weight: 700; box-shadow: 0 1px 4px rgba(15, 23, 42, .10); }
.compliance-nav button span { margin-left: 3px; font-size: 10px; color: #64748b; }
.section-stack { display: flex; flex-direction: column; gap: 10px; }
.readiness-panel { display: grid; grid-template-columns: 88px 1fr; gap: 12px; align-items: center; padding: 12px; color: white; background: linear-gradient(135deg, #123c7a, #265cb5); border-radius: 12px; }
.readiness-score { text-align: center; border-right: 1px solid rgba(255,255,255,.25); }
.readiness-score strong { font-size: 27px; }
.readiness-score span { opacity: .75; }
.readiness-score small, .readiness-copy span, .readiness-copy small { display: block; opacity: .82; font-size: 10px; }
.readiness-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.readiness-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.safety-notice { border: 1px solid #f0d28a; background: #fff9e8; color: #765515; padding: 9px 10px; border-radius: 8px; font-size: 11px; line-height: 1.55; }
.form-grid, .scenario-edit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.form-grid label, .scenario-edit-grid label { display: flex; flex-direction: column; gap: 4px; color: #526175; font-size: 11px; }
.span-2 { grid-column: span 2; }
.overview-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.section-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.section-head > div { display: flex; flex-direction: column; }
.section-head span { color: #64748b; font-size: 10px; }
.compliance-route-list { display: flex; flex-direction: column; gap: 6px; }
.compliance-route-item { display: grid; grid-template-columns: auto 4px minmax(0, 1fr) 38px; gap: 8px; align-items: center; padding: 8px; border: 1px solid #dfe7f1; border-radius: 9px; background: white; }
.compliance-route-item.selected { border-color: #7da9e8; background: #f5f9ff; }
.route-swatch { align-self: stretch; border-radius: 3px; }
.route-score-main { border: 0; padding: 0; background: none; min-width: 0; text-align: left; cursor: pointer; }
.route-score-main strong, .route-score-main span, .route-score-main small { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.route-score-main span { color: #475569; font-size: 11px; }
.route-score-main small { color: #8190a3; font-size: 10px; margin-top: 2px; }
.score-badge { display: grid; place-items: center; height: 32px; border-radius: 9px; font-weight: 800; font-size: 12px; }
.score-badge.good { background: #dcfce7; color: #15803d; }
.score-badge.medium { background: #fef3c7; color: #a16207; }
.score-badge.low { background: #f1f5f9; color: #64748b; }
.route-score-legend { color: #64748b; font-size: 10px; line-height: 1.5; }
.scenario-group-title { display: flex; gap: 6px; align-items: center; }
.scenario-group-title span { color: #64748b; font-size: 11px; }
.scenario-list { display: flex; flex-direction: column; gap: 8px; }
.scenario-card { border: 1px solid #dfe7f1; border-radius: 10px; padding: 10px; background: #fff; }
.scenario-topline { display: flex; justify-content: space-between; gap: 8px; }
.scenario-topline > div { display: flex; flex-direction: column; }
.scenario-topline span { color: #64748b; font-size: 10px; }
.scenario-card p { color: #526175; font-size: 11px; line-height: 1.55; margin: 7px 0; }
.auto-match { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 6px; align-items: center; margin: 6px 0; font-size: 10px; }
.auto-match > span:first-child { color: #64748b; }
.auto-match > span:last-child { color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.scenario-edit-grid { margin-top: 9px; }
.scenario-card details { color: #64748b; font-size: 10px; margin-top: 8px; }
.scenario-card details div { margin-top: 4px; line-height: 1.5; }
.scenario-card summary { cursor: pointer; color: #265cb5; }
.reference-intro { padding: 12px; background: #eef5ff; border-radius: 10px; }
.reference-intro p { margin: 5px 0 0; color: #526175; font-size: 11px; line-height: 1.6; }
.reference-list { display: flex; flex-direction: column; gap: 6px; }
.reference-list a { display: flex; justify-content: space-between; gap: 8px; padding: 9px 10px; color: #334155; text-decoration: none; border: 1px solid #dbe5f2; border-radius: 8px; font-size: 11px; }
.reference-list a strong { color: #2563eb; white-space: nowrap; }
</style>
