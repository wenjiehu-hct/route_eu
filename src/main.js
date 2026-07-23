import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { create, NButton, NButtonGroup, NCard, NCheckbox, NCheckboxGroup, NCollapse, NCollapseItem, NColorPicker, NConfigProvider, NDivider, NDropdown, NEmpty, NForm, NFormItem, NIcon, NInput, NInputNumber, NList, NListItem, NModal, NProgress, NScrollbar, NSelect, NSpace, NSwitch, NTag } from 'naive-ui';
import App from './App.vue';
import './styles/main.css';
import 'leaflet/dist/leaflet.css';

const naive = create({
  components: [
    NButton,
    NButtonGroup,
    NCard,
    NCheckbox,
    NCheckboxGroup,
    NCollapse,
    NCollapseItem,
    NColorPicker,
    NConfigProvider,
    NDivider,
    NDropdown,
    NEmpty,
    NForm,
    NFormItem,
    NIcon,
    NInput,
    NInputNumber,
    NList,
    NListItem,
    NModal,
    NProgress,
    NScrollbar,
    NSelect,
    NSpace,
    NSwitch,
    NTag,
  ],
});

const app = createApp(App);
app.use(createPinia());
app.use(naive);
app.mount('#app');
