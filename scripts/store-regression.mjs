globalThis.localStorage = {
  data: new Map(),
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
  setItem(key, value) { this.data.set(key, String(value)); },
  clear() { this.data.clear(); },
};
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options) { this.type = type; this.detail = options?.detail; }
};

const { useRoutePlannerStore } = await import('../src/stores/useRoutePlannerStore.js');
const { useComplianceStore, normalizeProject } = await import('../src/stores/useComplianceStore.js');
const { useCoveragePlannerStore, getCoverageDerived } = await import('../src/stores/useCoveragePlannerStore.js');
const { COMPLIANCE_PROFILES, COMPLIANCE_SCENARIOS } = await import('../src/constants/compliance.js');
const { analyzeRouteForProfile } = await import('../src/services/compliance.js');
const { traversalToSegments } = await import('../src/services/coveragePlanner.js');

const assert = (value, message) => { if (!value) throw new Error(message); };
const routeStore = useRoutePlannerStore.getState();
assert(routeStore.groups.length === 1 && routeStore.groups[0].routes.length === 0, 'New installations must not contain sample routes');
routeStore.addGroup();
assert(useRoutePlannerStore.getState().groups.length === 2, 'Route group creation failed');
const groupId = useRoutePlannerStore.getState().groups[0].id;
routeStore.addRoutesToGroup(groupId, [{ id: 'route-test', name: 'React route', color: '#2563eb', visible: true, stops: [], stats: { distance: 60_000 } }]);
assert(useRoutePlannerStore.getState().groups[0].routes[0].name === 'React route', 'Route insertion failed');

const project = useComplianceStore.getState().createProject('eu_gsr_isa');
useComplianceStore.getState().assignRoutesToProject(project.id, ['route-test']);
assert(useComplianceStore.getState().projects[0].routeIds.includes('route-test'), 'Compliance route assignment failed');
const normalizedLegacy = normalizeProject({ id: 'legacy', name: 'Legacy project', profileId: 'eu_gsr_isa', routeIds: [] });
assert(normalizedLegacy.phase === 'concept' && normalizedLegacy.priority === 'medium', 'Legacy project defaults were not migrated');
assert(Array.isArray(normalizedLegacy.testRuns) && Array.isArray(normalizedLegacy.issues) && Array.isArray(normalizedLegacy.activities), 'Legacy project collections were not migrated');
const testRun = useComplianceStore.getState().addTestRun(project.id, { name: 'Munich execution', routeId: 'route-test' });
useComplianceStore.getState().updateTestRun(project.id, testRun.id, { status: 'completed', distance: 52.4 });
const issue = useComplianceStore.getState().addIssue(project.id, { title: 'ISA sign mismatch', severity: 'high', routeId: 'route-test' });
useComplianceStore.getState().updateIssue(project.id, issue.id, { status: 'investigating' });
const expandedProject = useComplianceStore.getState().projects.find(item => item.id === project.id);
assert(expandedProject.testRuns[0].status === 'completed' && expandedProject.testRuns[0].distance === 52.4, 'Test run lifecycle failed');
assert(expandedProject.issues[0].status === 'investigating', 'Issue lifecycle failed');
assert(expandedProject.activities.length >= 4, 'Project activity logging failed');
useCoveragePlannerStore.getState().configureForCompliance('eu_gsr_isa', project.id);
const planner = useCoveragePlannerStore.getState();
assert(planner.routeCount === 5 && planner.includeLinks && planner.complianceProjectId === project.id, 'Compliance planner configuration failed');
assert(getCoverageDerived(planner).areaKm2 === 0, 'Empty coverage state is invalid');

for (const profile of COMPLIANCE_PROFILES) {
  for (const id of profile.scenarios) assert(COMPLIANCE_SCENARIOS[id], `Missing compliance scenario: ${id}`);
}

const edge = (id, maxspeed, tags = {}) => ({
  id, wayId: id, from: `${id}a`, to: `${id}b`, length: 5_000, insideLength: 5_000,
  highway: tags.highway || 'primary', name: id,
  tags: { highway: tags.highway || 'primary', maxspeed, ...tags }, oneway: false,
  geometry: [{ lat: 50, lon: Number(id) }, { lat: 50.01, lon: Number(id) + 0.01 }],
});
const segments = traversalToSegments({ walk: [
  { edge: edge('1', '30'), reversed: false, deadhead: false },
  { edge: edge('2', '50', { 'maxspeed:conditional': '30 @ wet' }), reversed: false, deadhead: false },
  { edge: edge('3', 'signals', { tunnel: 'yes', junction: 'roundabout' }), reversed: false, deadhead: false },
] }, { targetSegmentCount: 1 });
assert(segments[0].regulatorySignals.speedChangeCount === 2, 'Regulatory attribute extraction failed');
const analysis = analyzeRouteForProfile({ stats: { distance: 60_000, motorwayDistance: 20_000, urbanDistance: 20_000, ruralDistance: 20_000, regulatorySignals: segments[0].regulatorySignals } }, 'eu_gsr_isa');
assert(analysis.score > 0, 'Compliance route analysis failed');

process.stdout.write(`Store regression passed: ${COMPLIANCE_PROFILES.length} profiles, ${Object.keys(COMPLIANCE_SCENARIOS).length} scenarios\n`);
