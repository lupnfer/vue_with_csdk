import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import SdkView from './views/SdkView.vue'
import DbView from './views/DbView.vue'
import HttpView from './views/HttpView.vue'
import UseCaseView from './views/UseCaseView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/sdk', component: SdkView },
    { path: '/db', component: DbView },
    { path: '/http', component: HttpView },
    { path: '/use-case', component: UseCaseView }
  ]
})
