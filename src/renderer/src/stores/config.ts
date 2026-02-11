import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppConfig, ApiConfig, CharacterConfig, ModelRouteRule } from '../../../common/types'
import { DEFAULT_CONFIG } from '../../../common/defaults'

export const useConfigStore = defineStore('config', () => {
  const config = ref<AppConfig>({ ...DEFAULT_CONFIG })
  const loading = ref(false)

  /** 从主进程加载配置 */
  async function loadConfig() {
    loading.value = true
    try {
      const data = await window.electronAPI.config.getAll()
      config.value = data
    } catch (e) {
      console.error('加载配置失败:', e)
    } finally {
      loading.value = false
    }
  }

  /** 保存单个配置项 */
  async function setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    config.value[key] = value
    await window.electronAPI.config.set(key, value)
  }

  // --- API Configs ---
  const apiConfigs = computed(() => config.value.apiConfigs)

  async function addApiConfig(apiConfig: ApiConfig) {
    const newList = [...config.value.apiConfigs, apiConfig]
    await setConfig('apiConfigs', newList)
  }

  async function updateApiConfig(apiConfig: ApiConfig) {
    const idx = config.value.apiConfigs.findIndex(c => c.id === apiConfig.id)
    if (idx >= 0) {
      const newList = [...config.value.apiConfigs]
      newList[idx] = apiConfig
      await setConfig('apiConfigs', newList)
    }
  }

  async function removeApiConfig(id: string) {
    const newList = config.value.apiConfigs.filter(c => c.id !== id)
    await setConfig('apiConfigs', newList)
  }

  // --- Characters ---
  const characters = computed(() => config.value.characters)
  const activeCharacter = computed(() =>
    config.value.characters.find(c => c.id === config.value.activeCharacterId)
  )

  async function addCharacter(char: CharacterConfig) {
    const newList = [...config.value.characters, char]
    await setConfig('characters', newList)
  }

  async function updateCharacter(char: CharacterConfig) {
    const idx = config.value.characters.findIndex(c => c.id === char.id)
    if (idx >= 0) {
      const newList = [...config.value.characters]
      newList[idx] = char
      await setConfig('characters', newList)
    }
  }

  async function removeCharacter(id: string) {
    const newList = config.value.characters.filter(c => c.id !== id)
    await setConfig('characters', newList)
  }

  async function setActiveCharacter(id: string) {
    await setConfig('activeCharacterId', id)
  }

  // --- Model Routes ---
  const modelRoutes = computed(() => config.value.modelRoutes)

  async function addModelRoute(route: ModelRouteRule) {
    const newList = [...config.value.modelRoutes, route]
    await setConfig('modelRoutes', newList)
  }

  async function updateModelRoute(route: ModelRouteRule) {
    const idx = config.value.modelRoutes.findIndex(r => r.id === route.id)
    if (idx >= 0) {
      const newList = [...config.value.modelRoutes]
      newList[idx] = route
      await setConfig('modelRoutes', newList)
    }
  }

  async function removeModelRoute(id: string) {
    const newList = config.value.modelRoutes.filter(r => r.id !== id)
    await setConfig('modelRoutes', newList)
  }

  return {
    config, loading,
    loadConfig, setConfig,
    // API
    apiConfigs, addApiConfig, updateApiConfig, removeApiConfig,
    // Characters
    characters, activeCharacter, addCharacter, updateCharacter, removeCharacter, setActiveCharacter,
    // Model Routes
    modelRoutes, addModelRoute, updateModelRoute, removeModelRoute,
  }
})
