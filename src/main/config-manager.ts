import Store from 'electron-store'
import path from 'path'
import { AppConfig } from '../common/types'
import { DEFAULT_CONFIG } from '../common/defaults'

type ConfigStoreShape = {
  appConfig: AppConfig
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeConfig<T>(base: T, incoming: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(incoming) ? incoming : base) as T
  }
  if (!isPlainObject(base)) {
    return (incoming === undefined ? base : incoming) as T
  }
  if (!isPlainObject(incoming)) {
    return base
  }

  const merged: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base)) {
    merged[key] = mergeConfig((base as Record<string, unknown>)[key], incoming[key])
  }
  return merged as T
}

export class ConfigManager {
  private store: any
  private config: AppConfig

  constructor() {
    const fallbackOptions =
      process.versions.electron
        ? {}
        : {
            cwd: path.join(process.cwd(), '.aibot-test-store'),
            projectVersion: '0.0.0',
          }
    this.store = new Store<ConfigStoreShape>({
      name: 'aibot-config',
      ...fallbackOptions,
      defaults: {
        appConfig: DEFAULT_CONFIG,
      },
    })

    const rawConfig = this.store.get('appConfig')
    this.config = mergeConfig(DEFAULT_CONFIG, rawConfig)
    this.saveToDisk()
  }

  private saveToDisk(): void {
    this.store.set('appConfig', this.config)
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K]
  get(key: string): unknown
  get(key: string): unknown {
    return (this.config as unknown as Record<string, unknown>)[key]
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void
  set(key: string, value: unknown): void
  set(key: string, value: unknown): void {
    ;(this.config as unknown as Record<string, unknown>)[key] = value
    this.saveToDisk()
  }

  getAll(): AppConfig {
    return mergeConfig(DEFAULT_CONFIG, this.config)
  }

  reset(): void {
    this.config = mergeConfig(DEFAULT_CONFIG, {})
    this.saveToDisk()
  }
}
