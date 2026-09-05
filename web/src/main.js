import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import en from 'element-plus/es/locale/lang/en'
import 'element-plus/dist/index.css'
import './theme.css' // 极客/终端主题（须在 element-plus 样式之后）
import * as Icons from '@element-plus/icons-vue'
import App from './App.vue'
import { connect } from './store'

const app = createApp(App)
for (const [name, comp] of Object.entries(Icons)) app.component(name, comp)
app.use(ElementPlus, { locale: en })
app.mount('#app')

connect()
