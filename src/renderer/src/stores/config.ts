import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AppConfig, ApiConfig, CharacterConfig, TaskType } from '../../../common/types'
import { DEFAULT_CONFIG } from '../../../common/defaults'

export const useConfigStore = defineStore('config', () => {
  const config = ref<AppConfig>({ ...DEFAULT_CONFIG })
  const loading = ref(false)

  function toIPCCloneable<T>(value: T): T {
    try {
      return structuredClone(value)
    } catch {
      return JSON.parse(
        JSON.stringify(value, (_key, item) => {
          if (typeof item === 'function' || typeof item === 'symbol') return undefined
          return item
        })
      ) as T
    }
  }

  function getElectronAPI() {
    const api = window.electronAPI
    if (!api?.config) {
      throw new Error('桌面桥接不可用，请使用桌面应用启动（npm run dev:electron 或打包版）。')
    }
    return api
  }

  /** 从主进程加载配置 */
  async function loadConfig() {
    loading.value = true
    try {
      const data = await getElectronAPI().config.getAll()
      config.value = data
    } catch (e) {
      console.error('加载配置失败:', e)
    } finally {
      loading.value = false
    }
  }

  /** 保存单个配置项 */
  async function setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    const safeValue = toIPCCloneable(value)
    config.value[key] = safeValue
    return getElectronAPI().config.set(key, safeValue)
  }

  // --- API Configs ---
  const apiConfigs = computed(() => config.value.apiConfigs)

  async function addApiConfig(apiConfig: ApiConfig) {
    const newList = [...config.value.apiConfigs, apiConfig]
    await setConfig('apiConfigs', newList)
  }

  async function updateApiConfig(apiConfig: ApiConfig) {
    const idx = config.value.apiConfigs.findIndex((c) => c.id === apiConfig.id)
    if (idx >= 0) {
      const newList = [...config.value.apiConfigs]
      newList[idx] = apiConfig
      await setConfig('apiConfigs', newList)
    }
  }

  async function removeApiConfig(id: string) {
    const newList = config.value.apiConfigs.filter((c) => c.id !== id)
    await setConfig('apiConfigs', newList)
  }

  // --- Characters ---
  const characters = computed(() => config.value.characters)
  const activeCharacter = computed(() =>
    config.value.characters.find((c) => c.id === config.value.activeCharacterId)
  )

  async function addCharacter(char: CharacterConfig) {
    const newList = [...config.value.characters, char]
    await setConfig('characters', newList)
  }

  async function updateCharacter(char: CharacterConfig) {
    const idx = config.value.characters.findIndex((c) => c.id === char.id)
    if (idx >= 0) {
      const newList = [...config.value.characters]
      newList[idx] = char
      await setConfig('characters', newList)
    }
  }

  async function removeCharacter(id: string) {
    const newList = config.value.characters.filter((c) => c.id !== id)
    await setConfig('characters', newList)
  }

  async function setActiveCharacter(id: string) {
    await setConfig('activeCharacterId', id)
  }

  // --- Model Assignments ---
  async function setModelAssignment(taskType: TaskType, apiConfigId: string, model: string) {
    const next = { ...config.value.modelAssignments, [taskType]: { apiConfigId, model } }
    await setConfig('modelAssignments', next)
  }

  return {
    config,
    loading,
    loadConfig,
    setConfig,
    apiConfigs,
    addApiConfig,
    updateApiConfig,
    removeApiConfig,
    characters,
    activeCharacter,
    addCharacter,
    updateCharacter,
    removeCharacter,
    setActiveCharacter,
    setModelAssignment,
  }
})
