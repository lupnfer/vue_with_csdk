import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import SdkView from './views/SdkView.vue'
import DbView from './views/DbView.vue'
import HttpView from './views/HttpView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/sdk', component: SdkView },
    { path: '/db', component: DbView },
    { path: '/http', component: HttpView }
  ]
})
