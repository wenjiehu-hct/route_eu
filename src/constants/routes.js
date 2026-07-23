export const STORAGE_KEY = 'routePlannerVue.groups.v1';
export const LEGACY_STORAGE_KEYS = [
  'routePlannerLite.routes.v1',
  'routesData_v2',
];
export const EUROPE_BOUNDS = [[34.5, -11.5], [71.5, 34.8]];
export const MAX_GOOGLE_WAYPOINTS = 8;
export const ROUTE_COLORS = [
  '#e53935',
  '#1e88e5',
  '#43a047',
  '#8e24aa',
  '#fb8c00',
  '#00acc1',
  '#6d4c41',
  '#3949ab',
  '#d81b60',
  '#00897b',
];

export const DEFAULT_GROUP_NAME = '默认分组';

// 区域覆盖规划：可选道路类型（OSM highway 等级）
export const HIGHWAY_TYPE_OPTIONS = [
  { value: 'motorway', label: '高速公路' },
  { value: 'trunk', label: '快速路' },
  { value: 'primary', label: '主干道' },
  { value: 'secondary', label: '次干道' },
  { value: 'tertiary', label: '支路' },
  { value: 'residential', label: '居住区道路' },
  { value: 'unclassified', label: '未分类道路' },
];

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const COVERAGE_DEFAULTS = {
  roadTypes: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
  includeLinks: false,
  // 目标值而非硬上限：规划器会均衡分段，让各条路线尽量接近该里程。
  maxSegmentKm: 50,
  routeCount: 5,
  sampleSpacingMeters: 300,
};

// 勾选细密道路（residential/unclassified）时的道路查询面积上限更严格
export const COVERAGE_AREA_LIMIT_KM2 = { dense: 150, major: 600 };
export const COVERAGE_MAX_WAYS = 5000;
// Google Maps 最多 8 个中间 waypoint，另加起点和终点，共 10 个 stop。
// 路线渲染仍使用完整遍历几何，stop 只用于导出导航链接。
export const COVERAGE_MAX_WAYPOINTS_PER_SEGMENT = MAX_GOOGLE_WAYPOINTS + 2;

export const DEFAULT_ROUTES = [
  { name: '德国环线', stops: ['Munich', 'Dresden', 'Berlin', 'Hamburg', 'Cologne', 'Frankfurt am Main', 'Stuttgart', 'Munich'] },
  { name: '意大利环线', stops: ['Bolzano', 'Naples', 'Rome', 'Florence', 'Milan', 'Turin'] },
  { name: '西班牙线', stops: ['València', 'Barcelona', 'Seville', 'Madrid', 'Zaragoza'] },
  { name: '法国线', stops: ['Marseille', 'Nice', 'Lyon', 'Nantes', 'Paris', 'Calais'] },
  { name: '英国线', stops: ['London', 'Birmingham', 'Liverpool', 'Manchester', 'Leeds', 'Cambridge'] },
];

export const CITY_COORDS = {
  munich: [48.137154, 11.576124], 'münchen': [48.137154, 11.576124], dresden: [51.050409, 13.737262],
  berlin: [52.520008, 13.404954], hamburg: [53.551086, 9.993682], cologne: [50.937531, 6.960279], 'köln': [50.937531, 6.960279],
  frankfurt: [50.110924, 8.682127], 'frankfurt am main': [50.110924, 8.682127], stuttgart: [48.775846, 9.182932],
  bolzano: [46.498295, 11.354758], naples: [40.851799, 14.26812], rome: [41.902782, 12.496366], florence: [43.769562, 11.255814], milan: [45.464204, 9.189982], turin: [45.070312, 7.686856],
  'valència': [39.469908, -0.376288], valencia: [39.469908, -0.376288], barcelona: [41.387397, 2.168568], seville: [37.389092, -5.984459], madrid: [40.416775, -3.70379], zaragoza: [41.648823, -0.889085],
  marseille: [43.296482, 5.36978], nice: [43.710173, 7.261953], lyon: [45.764043, 4.835659], nantes: [47.218371, -1.553621], paris: [48.856614, 2.352222], calais: [50.95129, 1.858686],
  london: [51.5074, -0.1278], birmingham: [52.4862, -1.8904], liverpool: [53.4084, -2.9916], manchester: [53.4808, -2.2426], leeds: [53.8008, -1.5491], cambridge: [52.2053, 0.1218],
  北京: { displayName: '北京', coords: [39.9042, 116.4074], aliases: ['beijing', 'peking'] },
  天津: { displayName: '天津', coords: [39.3434, 117.3616], aliases: ['tianjin'] },
  上海: { displayName: '上海', coords: [31.2304, 121.4737], aliases: ['shanghai'] },
  重庆: { displayName: '重庆', coords: [29.563, 106.5516], aliases: ['chongqing'] },
  哈尔滨: { displayName: '哈尔滨', coords: [45.8038, 126.5349], aliases: ['harbin'] },
  长春: { displayName: '长春', coords: [43.8171, 125.3235], aliases: ['changchun'] },
  沈阳: { displayName: '沈阳', coords: [41.8057, 123.4315], aliases: ['shenyang'] },
  大连: { displayName: '大连', coords: [38.914, 121.6147], aliases: ['dalian'] },
  石家庄: { displayName: '石家庄', coords: [38.0428, 114.5149], aliases: ['shijiazhuang'] },
  太原: { displayName: '太原', coords: [37.8706, 112.5489], aliases: ['taiyuan'] },
  呼和浩特: { displayName: '呼和浩特', coords: [40.8426, 111.7492], aliases: ['hohhot', 'huhehaote'] },
  济南: { displayName: '济南', coords: [36.6512, 117.1201], aliases: ['jinan', 'ji nan'] },
  青岛: { displayName: '青岛', coords: [36.0671, 120.3826], aliases: ['qingdao'] },
  郑州: { displayName: '郑州', coords: [34.7472, 113.6249], aliases: ['zhengzhou'] },
  西安: { displayName: '西安', coords: [34.3416, 108.9398], aliases: ['xian', "xi'an"] },
  兰州: { displayName: '兰州', coords: [36.0611, 103.8343], aliases: ['lanzhou'] },
  西宁: { displayName: '西宁', coords: [36.6171, 101.7782], aliases: ['xining'] },
  银川: { displayName: '银川', coords: [38.4872, 106.2309], aliases: ['yinchuan'] },
  乌鲁木齐: { displayName: '乌鲁木齐', coords: [43.8256, 87.6168], aliases: ['urumqi', 'wulumuqi'] },
  南京: { displayName: '南京', coords: [32.0603, 118.7969], aliases: ['nanjing'] },
  苏州: { displayName: '苏州', coords: [31.2989, 120.5853], aliases: ['suzhou'] },
  杭州: { displayName: '杭州', coords: [30.2741, 120.1551], aliases: ['hangzhou'] },
  宁波: { displayName: '宁波', coords: [29.8683, 121.544], aliases: ['ningbo'] },
  合肥: { displayName: '合肥', coords: [31.8206, 117.2272], aliases: ['hefei'] },
  福州: { displayName: '福州', coords: [26.0745, 119.2965], aliases: ['fuzhou'] },
  厦门: { displayName: '厦门', coords: [24.4798, 118.0894], aliases: ['xiamen'] },
  南昌: { displayName: '南昌', coords: [28.682, 115.8579], aliases: ['nanchang'] },
  武汉: { displayName: '武汉', coords: [30.5928, 114.3055], aliases: ['wuhan'] },
  长沙: { displayName: '长沙', coords: [28.2282, 112.9388], aliases: ['changsha'] },
  广州: { displayName: '广州', coords: [23.1291, 113.2644], aliases: ['guangzhou'] },
  深圳: { displayName: '深圳', coords: [22.5431, 114.0579], aliases: ['shenzhen'] },
  南宁: { displayName: '南宁', coords: [22.817, 108.3669], aliases: ['nanning'] },
  海口: { displayName: '海口', coords: [20.044, 110.1983], aliases: ['haikou'] },
  成都: { displayName: '成都', coords: [30.5728, 104.0668], aliases: ['chengdu'] },
  贵阳: { displayName: '贵阳', coords: [26.647, 106.6302], aliases: ['guiyang'] },
  昆明: { displayName: '昆明', coords: [25.0389, 102.7183], aliases: ['kunming'] },
  拉萨: { displayName: '拉萨', coords: [29.652, 91.1721], aliases: ['lhasa', 'lasa'] },
};
