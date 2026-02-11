import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'settings',
      component: () => import('./views/SettingsView.vue')
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('./views/ChatView.vue')
    },
    {
      path: '/live2d',
      name: 'live2d',
      component: () => import('./views/Live2DView.vue')
    }
  ]
})

export default router
