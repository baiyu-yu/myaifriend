<template>
  <div class="settings-layout">
    <el-container style="height: 100vh">
      <el-aside width="220px" style="background: #304156">
        <div class="logo">
          <h2>AI Bot</h2>
          <span class="version">v1.0.0</span>
        </div>
        <el-menu
          :default-active="activeTab"
          background-color="#304156"
          text-color="#bfcbd9"
          active-text-color="#409eff"
          @select="activeTab = $event"
        >
          <el-menu-item index="api">
            <el-icon><Connection /></el-icon>
            <span>API 配置</span>
          </el-menu-item>
          <el-menu-item index="character">
            <el-icon><User /></el-icon>
            <span>角色设定</span>
          </el-menu-item>
          <el-menu-item index="model-route">
            <el-icon><Switch /></el-icon>
            <span>模型路由</span>
          </el-menu-item>
          <el-menu-item index="live2d">
            <el-icon><Picture /></el-icon>
            <span>Live2D 模型</span>
          </el-menu-item>
          <el-menu-item index="folders">
            <el-icon><FolderOpened /></el-icon>
            <span>文件夹监听</span>
          </el-menu-item>
          <el-menu-item index="hotkeys">
            <el-icon><Keyboard /></el-icon>
            <span>快捷键</span>
          </el-menu-item>
          <el-menu-item index="tools">
            <el-icon><SetUp /></el-icon>
            <span>工具管理</span>
          </el-menu-item>
          <el-menu-item index="trigger">
            <el-icon><ChatDotRound /></el-icon>
            <span>唤起提示词</span>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-main style="padding: 20px; overflow-y: auto">
        <div v-if="activeTab === 'api'">
          <h3>API 配置</h3>
          <p class="desc">管理模型供应商和 OpenAI 兼容接口。</p>

          <el-button type="primary" @click="showApiDialog = true" style="margin-bottom: 16px">
            <el-icon><Plus /></el-icon>
            添加 API
          </el-button>

          <el-table :data="configStore.apiConfigs" border stripe>
            <el-table-column prop="name" label="名称" width="160" />
            <el-table-column prop="baseUrl" label="接口地址" />
            <el-table-column prop="defaultModel" label="默认模型" width="220" />
            <el-table-column label="操作" width="170" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="editApi(row)">编辑</el-button>
                <el-button size="small" type="danger" @click="deleteApi(row.id)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="activeTab === 'character'">
          <h3>角色设定</h3>
          <p class="desc">定义系统提示词、角色风格和问候语。</p>

          <el-button type="primary" @click="showCharDialog = true" style="margin-bottom: 16px">
            <el-icon><Plus /></el-icon>
            添加角色
          </el-button>

          <el-row :gutter="16">
            <el-col :span="8" v-for="char in configStore.characters" :key="char.id">
              <el-card shadow="hover" :class="{ 'active-card': char.id === configStore.config.activeCharacterId }">
                <template #header>
                  <div class="card-head">
                    <span>{{ char.name }}</span>
                    <el-tag v-if="char.id === configStore.config.activeCharacterId" type="success" size="small">
                      当前
                    </el-tag>
                  </div>
                </template>
                <p class="prompt-preview">{{ char.systemPrompt.substring(0, 100) }}...</p>
                <div class="card-actions">
                  <el-button size="small" type="primary" @click="configStore.setActiveCharacter(char.id)">
                    使用
                  </el-button>
                  <el-button size="small" @click="editChar(char)">编辑</el-button>
                  <el-button size="small" type="danger" @click="configStore.removeCharacter(char.id)">
                    删除
                  </el-button>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </div>

        <div v-if="activeTab === 'model-route'">
          <h3>模型路由</h3>
          <p class="desc">按任务类型路由到不同模型，平衡成本和效果。</p>

          <el-button type="primary" @click="showRouteDialog = true" style="margin-bottom: 16px">
            <el-icon><Plus /></el-icon>
            添加规则
          </el-button>

          <el-table :data="configStore.modelRoutes" border stripe>
            <el-table-column prop="name" label="规则名称" width="160" />
            <el-table-column label="任务类型" width="220">
              <template #default="{ row }">
                <el-tag v-for="t in row.taskTypes" :key="t" size="small" style="margin: 2px">{{ t }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="model" label="模型" />
            <el-table-column prop="priority" label="优先级" width="90" />
            <el-table-column label="操作" width="170" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="editRoute(row)">编辑</el-button>
                <el-button size="small" type="danger" @click="configStore.removeModelRoute(row.id)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="activeTab === 'live2d'">
          <h3>Live2D 模型</h3>
          <p class="desc">选择模型文件并设置桌宠窗口尺寸。</p>

          <el-form label-width="120px">
            <el-form-item label="模型路径">
              <el-input v-model="configStore.config.live2dModelPath" placeholder="选择 .model3.json 文件" readonly>
                <template #append>
                  <el-button @click="selectLive2DModel">浏览</el-button>
                </template>
              </el-input>
            </el-form-item>
            <el-form-item label="窗口宽度">
              <el-input-number v-model="configStore.config.window.live2dWidth" :min="100" :max="800" />
            </el-form-item>
            <el-form-item label="窗口高度">
              <el-input-number v-model="configStore.config.window.live2dHeight" :min="100" :max="1000" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveLive2DConfig">保存</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div v-if="activeTab === 'folders'">
          <h3>文件夹监听</h3>
          <p class="desc">AI 可读写这些文件夹中的文件，并监听变动。</p>

          <el-button type="primary" @click="addWatchFolder" style="margin-bottom: 16px">
            <el-icon><Plus /></el-icon>
            添加文件夹
          </el-button>

          <el-table :data="watchFolderRows" border stripe>
            <el-table-column prop="path" label="文件夹路径" />
            <el-table-column label="操作" width="110">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removeWatchFolder($index)">移除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="activeTab === 'hotkeys'">
          <h3>快捷键</h3>
          <el-form label-width="170px" style="max-width: 560px">
            <el-form-item label="显示/隐藏对话窗口">
              <el-input v-model="configStore.config.hotkeys.toggleChat" placeholder="e.g. Alt+Space" />
            </el-form-item>
            <el-form-item label="显示/隐藏 Live2D">
              <el-input v-model="configStore.config.hotkeys.toggleLive2D" placeholder="e.g. Alt+L" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveHotkeys">保存</el-button>
              <el-text type="warning" style="margin-left: 12px">修改后需重启应用生效。</el-text>
            </el-form-item>
          </el-form>
        </div>

        <div v-if="activeTab === 'tools'">
          <h3>工具管理</h3>
          <p class="desc">当前已注册并可供模型调用的工具。</p>

          <el-table :data="toolList" border stripe v-loading="toolsLoading">
            <el-table-column prop="name" label="工具名称" width="220" />
            <el-table-column prop="description" label="描述" />
            <el-table-column label="参数" width="220">
              <template #default="{ row }">
                <el-tag v-for="(_, key) in row.parameters" :key="key" size="small" style="margin: 2px">
                  {{ key }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="activeTab === 'trigger'">
          <h3>唤起提示词</h3>
          <p class="desc">不同唤起方式会自动拼接对应提示词。</p>

          <el-form label-width="180px" style="max-width: 760px">
            <el-form-item label="快捷键唤起">
              <el-input type="textarea" :rows="2" v-model="configStore.config.triggerPrompts.hotkey" />
            </el-form-item>
            <el-form-item label="点击头像唤起">
              <el-input type="textarea" :rows="2" v-model="configStore.config.triggerPrompts.click_avatar" />
            </el-form-item>
            <el-form-item label="随机定时唤起">
              <el-input type="textarea" :rows="2" v-model="configStore.config.triggerPrompts.random_timer" />
            </el-form-item>
            <el-form-item label="文件变动唤起">
              <el-input type="textarea" :rows="2" v-model="configStore.config.triggerPrompts.file_change" />
              <el-text type="info">可用变量：{{ '{{fileChangeInfo}}' }}</el-text>
            </el-form-item>
            <el-form-item label="随机定时范围（分钟）">
              <div style="display: flex; gap: 12px; align-items: center">
                <el-input-number v-model="configStore.config.randomTimerRange.min" :min="1" :max="1440" />
                <span>~</span>
                <el-input-number v-model="configStore.config.randomTimerRange.max" :min="1" :max="1440" />
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveTriggerPrompts">保存</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-main>
    </el-container>

    <el-dialog v-model="showApiDialog" :title="editingApi ? '编辑 API' : '添加 API'" width="520px">
      <el-form label-width="110px">
        <el-form-item label="名称" required>
          <el-input v-model="apiForm.name" placeholder="OpenAI / Claude / Local" />
        </el-form-item>
        <el-form-item label="接口地址" required>
          <el-input v-model="apiForm.baseUrl" placeholder="https://api.openai.com/v1" />
        </el-form-item>
        <el-form-item label="API Key" required>
          <el-input v-model="apiForm.apiKey" type="password" show-password placeholder="sk-..." />
        </el-form-item>
        <el-form-item label="默认模型" required>
          <el-input v-model="apiForm.defaultModel" placeholder="gpt-4o" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showApiDialog = false">取消</el-button>
        <el-button type="primary" @click="saveApi">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCharDialog" :title="editingChar ? '编辑角色' : '添加角色'" width="640px">
      <el-form label-width="110px">
        <el-form-item label="名称" required>
          <el-input v-model="charForm.name" />
        </el-form-item>
        <el-form-item label="问候语">
          <el-input v-model="charForm.greeting" placeholder="可选开场白" />
        </el-form-item>
        <el-form-item label="系统提示词" required>
          <el-input
            type="textarea"
            :rows="8"
            v-model="charForm.systemPrompt"
            placeholder="定义角色人设、行为和说话风格"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCharDialog = false">取消</el-button>
        <el-button type="primary" @click="saveChar">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showRouteDialog" :title="editingRoute ? '编辑路由' : '添加路由'" width="540px">
      <el-form label-width="120px">
        <el-form-item label="规则名称" required>
          <el-input v-model="routeForm.name" />
        </el-form-item>
        <el-form-item label="任务类型" required>
          <el-checkbox-group v-model="routeForm.taskTypes">
            <el-checkbox value="chat">chat</el-checkbox>
            <el-checkbox value="roleplay">roleplay</el-checkbox>
            <el-checkbox value="tool_call">tool_call</el-checkbox>
            <el-checkbox value="file_operation">file_operation</el-checkbox>
            <el-checkbox value="summary">summary</el-checkbox>
            <el-checkbox value="translation">translation</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="API 配置" required>
          <el-select v-model="routeForm.apiConfigId" placeholder="选择 API">
            <el-option v-for="api in configStore.apiConfigs" :key="api.id" :label="api.name" :value="api.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型" required>
          <el-input v-model="routeForm.model" placeholder="模型名称" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="routeForm.priority" :min="1" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRouteDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRoute">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { useConfigStore } from '../stores/config'
import type { ApiConfig, CharacterConfig, ModelRouteRule, TaskType, ToolDefinition } from '../../../common/types'

const configStore = useConfigStore()

const activeTab = ref('api')

const showApiDialog = ref(false)
const editingApi = ref(false)
const apiForm = reactive<ApiConfig>({
  id: '',
  name: '',
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
  availableModels: [],
})

function editApi(api: ApiConfig) {
  Object.assign(apiForm, api)
  editingApi.value = true
  showApiDialog.value = true
}

async function saveApi() {
  if (!apiForm.name || !apiForm.baseUrl || !apiForm.apiKey || !apiForm.defaultModel) return
  if (editingApi.value) {
    await configStore.updateApiConfig({ ...apiForm })
  } else {
    await configStore.addApiConfig({ ...apiForm, id: uuidv4() })
  }
  showApiDialog.value = false
  editingApi.value = false
  Object.assign(apiForm, { id: '', name: '', baseUrl: '', apiKey: '', defaultModel: '', availableModels: [] })
}

async function deleteApi(id: string) {
  await configStore.removeApiConfig(id)
}

const showCharDialog = ref(false)
const editingChar = ref(false)
const charForm = reactive<CharacterConfig>({
  id: '',
  name: '',
  systemPrompt: '',
  greeting: '',
})

function editChar(char: CharacterConfig) {
  Object.assign(charForm, char)
  editingChar.value = true
  showCharDialog.value = true
}

async function saveChar() {
  if (!charForm.name || !charForm.systemPrompt) return
  if (editingChar.value) {
    await configStore.updateCharacter({ ...charForm })
  } else {
    await configStore.addCharacter({ ...charForm, id: uuidv4() })
  }
  showCharDialog.value = false
  editingChar.value = false
  Object.assign(charForm, { id: '', name: '', systemPrompt: '', greeting: '' })
}

const showRouteDialog = ref(false)
const editingRoute = ref(false)
const routeForm = reactive<ModelRouteRule>({
  id: '',
  name: '',
  taskTypes: [] as TaskType[],
  apiConfigId: '',
  model: '',
  priority: 10,
})

function editRoute(route: ModelRouteRule) {
  Object.assign(routeForm, { ...route, taskTypes: [...route.taskTypes] })
  editingRoute.value = true
  showRouteDialog.value = true
}

async function saveRoute() {
  if (!routeForm.name || !routeForm.apiConfigId || !routeForm.model) return
  if (editingRoute.value) {
    await configStore.updateModelRoute({ ...routeForm, taskTypes: [...routeForm.taskTypes] })
  } else {
    await configStore.addModelRoute({ ...routeForm, id: uuidv4(), taskTypes: [...routeForm.taskTypes] })
  }
  showRouteDialog.value = false
  editingRoute.value = false
  Object.assign(routeForm, { id: '', name: '', taskTypes: [], apiConfigId: '', model: '', priority: 10 })
}

const watchFolderRows = computed(() => configStore.config.watchFolders.map((p) => ({ path: p })))

async function addWatchFolder() {
  const folder = await window.electronAPI.dialog.selectFolder()
  if (folder) {
    const folders = [...configStore.config.watchFolders, folder]
    await configStore.setConfig('watchFolders', folders)
  }
}

async function removeWatchFolder(index: number) {
  const folders = configStore.config.watchFolders.filter((_, i) => i !== index)
  await configStore.setConfig('watchFolders', folders)
}

async function selectLive2DModel() {
  const file = await window.electronAPI.dialog.selectFile([{ name: 'Live2D Model', extensions: ['model3.json'] }])
  if (file) configStore.config.live2dModelPath = file
}

async function saveLive2DConfig() {
  await configStore.setConfig('live2dModelPath', configStore.config.live2dModelPath)
  await configStore.setConfig('window', { ...configStore.config.window })
}

async function saveHotkeys() {
  await configStore.setConfig('hotkeys', { ...configStore.config.hotkeys })
}

async function saveTriggerPrompts() {
  await configStore.setConfig('triggerPrompts', { ...configStore.config.triggerPrompts })
  await configStore.setConfig('randomTimerRange', { ...configStore.config.randomTimerRange })
}

const toolList = ref<ToolDefinition[]>([])
const toolsLoading = ref(false)

async function loadTools() {
  toolsLoading.value = true
  try {
    toolList.value = await window.electronAPI.tools.list()
  } catch (e) {
    console.error('Failed to load tool list:', e)
  } finally {
    toolsLoading.value = false
  }
}

onMounted(async () => {
  await configStore.loadConfig()
  await loadTools()
})
</script>

<style scoped>
.logo {
  padding: 20px;
  text-align: center;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo h2 {
  margin: 0;
  font-size: 20px;
}

.version {
  font-size: 12px;
  opacity: 0.65;
}

h3 {
  margin-bottom: 8px;
  color: #303133;
}

.desc {
  color: #909399;
  margin-bottom: 16px;
}

.active-card {
  border-color: #409eff;
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

.prompt-preview {
  font-size: 13px;
  color: #666;
  height: 60px;
  overflow: hidden;
}
</style>
