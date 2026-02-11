<template>
  <div class="settings-page">
    <el-page-header content="设置中心" />

    <el-tabs v-model="activeTab" class="tabs">
      <el-tab-pane label="API 配置" name="api">
        <el-button type="primary" @click="openApiDialogForCreate">新增 API</el-button>
        <el-table :data="configStore.apiConfigs" border stripe style="margin-top: 12px">
          <el-table-column prop="name" label="名称" width="160" />
          <el-table-column prop="baseUrl" label="接口地址" />
          <el-table-column prop="defaultModel" label="默认模型" width="220" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button size="small" @click="openApiDialogForEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="deleteApi(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="角色设定" name="character">
        <el-button type="primary" @click="openCharDialogForCreate">新增角色</el-button>
        <el-row :gutter="12" style="margin-top: 12px">
          <el-col v-for="char in configStore.characters" :key="char.id" :span="8">
            <el-card :class="{ active: char.id === configStore.config.activeCharacterId }">
              <template #header>
                <div class="card-header">
                  <span>{{ char.name }}</span>
                  <el-tag v-if="char.id === configStore.config.activeCharacterId" type="success">当前</el-tag>
                </div>
              </template>
              <div class="ellipsis">{{ char.systemPrompt }}</div>
              <div class="actions">
                <el-button size="small" type="primary" @click="configStore.setActiveCharacter(char.id)">使用</el-button>
                <el-button size="small" @click="openCharDialogForEdit(char)">编辑</el-button>
                <el-button size="small" type="danger" @click="configStore.removeCharacter(char.id)">删除</el-button>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="模型路由" name="route">
        <el-button type="primary" @click="openRouteDialogForCreate">新增规则</el-button>
        <el-table :data="configStore.modelRoutes" border stripe style="margin-top: 12px">
          <el-table-column prop="name" label="规则名称" width="180" />
          <el-table-column label="任务类型">
            <template #default="{ row }">
              <el-tag v-for="t in row.taskTypes" :key="t" style="margin-right: 6px">{{ t }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="model" label="模型" width="180" />
          <el-table-column prop="priority" label="优先级" width="100" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button size="small" @click="openRouteDialogForEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="configStore.removeModelRoute(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="工作链" name="chain">
        <el-form label-width="220px" style="max-width: 760px">
          <el-form-item label="启用自动任务路由">
            <el-switch v-model="configStore.config.agentChain.enableAutoTaskRouting" />
          </el-form-item>
          <el-form-item label="启用上下文压缩">
            <el-switch v-model="configStore.config.agentChain.enableContextCompression" />
          </el-form-item>
          <el-form-item label="压缩阈值（估算 token）">
            <el-input-number v-model="configStore.config.agentChain.compressionThresholdTokens" :min="400" :max="20000" :step="200" />
          </el-form-item>
          <el-form-item label="保留最近消息数">
            <el-input-number v-model="configStore.config.agentChain.compressionKeepRecentMessages" :min="4" :max="40" />
          </el-form-item>
          <el-form-item label="启用长期记忆">
            <el-switch v-model="configStore.config.agentChain.enableMemory" />
          </el-form-item>
          <el-form-item label="每次注入记忆条数">
            <el-input-number v-model="configStore.config.agentChain.memoryTopK" :min="1" :max="20" />
          </el-form-item>
          <el-form-item label="记忆库最大条数">
            <el-input-number v-model="configStore.config.agentChain.memoryMaxItems" :min="50" :max="5000" :step="50" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveAgentChainConfig">保存工作链配置</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="Live2D" name="live2d">
        <el-form label-width="140px" style="max-width: 860px">
          <el-form-item label="模型文件">
            <el-input v-model="configStore.config.live2dModelPath" placeholder="选择 .model3.json 文件" readonly>
              <template #append>
                <el-button @click="selectLive2DModel">选择</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="窗口宽度">
            <el-input-number v-model="configStore.config.window.live2dWidth" :min="120" :max="1200" />
          </el-form-item>
          <el-form-item label="窗口高度">
            <el-input-number v-model="configStore.config.window.live2dHeight" :min="120" :max="1200" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveLive2DConfig">保存模型与窗口设置</el-button>
          </el-form-item>
        </el-form>

        <el-divider content-position="left">动作/表情映射（别名 => 实际名称）</el-divider>

        <div class="mapping-block">
          <div class="mapping-header">
            <span>表情映射（expression）</span>
            <el-button size="small" type="primary" @click="addExpressionRow">新增</el-button>
          </div>
          <el-table :data="expressionRows" border stripe>
            <el-table-column label="别名">
              <template #default="{ row }">
                <el-input v-model="row.alias" placeholder="如：开心" />
              </template>
            </el-table-column>
            <el-table-column label="实际表情名称">
              <template #default="{ row }">
                <el-input v-model="row.target" placeholder="如：exp_smile_01" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removeExpressionRow($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="mapping-block">
          <div class="mapping-header">
            <span>动作映射（motion）</span>
            <el-button size="small" type="primary" @click="addMotionRow">新增</el-button>
          </div>
          <el-table :data="motionRows" border stripe>
            <el-table-column label="别名">
              <template #default="{ row }">
                <el-input v-model="row.alias" placeholder="如：点头" />
              </template>
            </el-table-column>
            <el-table-column label="实际动作组名">
              <template #default="{ row }">
                <el-input v-model="row.target" placeholder="如：TapBody" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removeMotionRow($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <el-button type="success" @click="saveLive2DActionMap">保存映射表</el-button>
      </el-tab-pane>

      <el-tab-pane label="文件夹监听" name="folders">
        <el-button type="primary" @click="addWatchFolder">新增文件夹</el-button>
        <el-table :data="watchFolderRows" border stripe style="margin-top: 12px">
          <el-table-column prop="path" label="路径" />
          <el-table-column label="操作" width="120">
            <template #default="{ $index }">
              <el-button size="small" type="danger" @click="removeWatchFolder($index)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="快捷键" name="hotkeys">
        <el-form label-width="180px" style="max-width: 520px">
          <el-form-item label="显示/隐藏对话窗口">
            <el-input v-model="configStore.config.hotkeys.toggleChat" />
          </el-form-item>
          <el-form-item label="显示/隐藏 Live2D">
            <el-input v-model="configStore.config.hotkeys.toggleLive2D" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveHotkeys">保存</el-button>
            <el-text type="warning" style="margin-left: 8px">修改后需重启应用</el-text>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="工具列表" name="tools">
        <el-table :data="toolList" border stripe v-loading="toolsLoading">
          <el-table-column prop="name" label="工具名" width="200" />
          <el-table-column prop="description" label="描述" />
          <el-table-column label="参数" width="280">
            <template #default="{ row }">
              <el-tag v-for="(_, key) in row.parameters" :key="key" style="margin-right: 6px">{{ key }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="唤起提示词" name="trigger">
        <el-form label-width="180px" style="max-width: 860px">
          <el-form-item label="快捷键唤起">
            <el-input v-model="configStore.config.triggerPrompts.hotkey" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="点击形象唤起">
            <el-input v-model="configStore.config.triggerPrompts.click_avatar" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="随机定时唤起">
            <el-input v-model="configStore.config.triggerPrompts.random_timer" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="文件变化唤起">
            <el-input v-model="configStore.config.triggerPrompts.file_change" type="textarea" :rows="2" />
            <el-text type="info">可用变量：{{ fileChangeInfo }}</el-text>
          </el-form-item>
          <el-form-item label="随机定时范围（分钟）">
            <el-input-number v-model="configStore.config.randomTimerRange.min" :min="1" :max="1440" />
            <span style="margin: 0 8px">~</span>
            <el-input-number v-model="configStore.config.randomTimerRange.max" :min="1" :max="1440" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveTriggerPrompts">保存</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="showApiDialog" :title="editingApi ? '编辑 API' : '新增 API'" width="520px">
      <el-form label-width="110px">
        <el-form-item label="名称" required>
          <el-input v-model="apiForm.name" />
        </el-form-item>
        <el-form-item label="接口地址" required>
          <el-input v-model="apiForm.baseUrl" />
        </el-form-item>
        <el-form-item label="API Key" required>
          <el-input v-model="apiForm.apiKey" type="password" show-password />
        </el-form-item>
        <el-form-item label="默认模型" required>
          <el-input v-model="apiForm.defaultModel" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showApiDialog = false">取消</el-button>
        <el-button type="primary" @click="saveApi">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCharDialog" :title="editingChar ? '编辑角色' : '新增角色'" width="620px">
      <el-form label-width="110px">
        <el-form-item label="角色名" required>
          <el-input v-model="charForm.name" />
        </el-form-item>
        <el-form-item label="问候语">
          <el-input v-model="charForm.greeting" />
        </el-form-item>
        <el-form-item label="系统提示词" required>
          <el-input v-model="charForm.systemPrompt" type="textarea" :rows="8" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCharDialog = false">取消</el-button>
        <el-button type="primary" @click="saveChar">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showRouteDialog" :title="editingRoute ? '编辑路由' : '新增路由'" width="560px">
      <el-form label-width="120px">
        <el-form-item label="规则名" required>
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
            <el-checkbox value="vision">vision</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="API 配置" required>
          <el-select v-model="routeForm.apiConfigId" placeholder="请选择">
            <el-option v-for="api in configStore.apiConfigs" :key="api.id" :value="api.id" :label="api.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型" required>
          <el-input v-model="routeForm.model" />
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
import { computed, onMounted, reactive, ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { useConfigStore } from '../stores/config'
import type { ApiConfig, CharacterConfig, ModelRouteRule, TaskType, ToolDefinition } from '../../../common/types'

type MappingRow = { alias: string; target: string }

const configStore = useConfigStore()
const activeTab = ref('api')
const fileChangeInfo = '{{fileChangeInfo}}'

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

function openApiDialogForCreate() {
  editingApi.value = false
  Object.assign(apiForm, { id: '', name: '', baseUrl: '', apiKey: '', defaultModel: '', availableModels: [] })
  showApiDialog.value = true
}

function openApiDialogForEdit(api: ApiConfig) {
  editingApi.value = true
  Object.assign(apiForm, api)
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

function openCharDialogForCreate() {
  editingChar.value = false
  Object.assign(charForm, { id: '', name: '', systemPrompt: '', greeting: '' })
  showCharDialog.value = true
}

function openCharDialogForEdit(char: CharacterConfig) {
  editingChar.value = true
  Object.assign(charForm, char)
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

function openRouteDialogForCreate() {
  editingRoute.value = false
  Object.assign(routeForm, { id: '', name: '', taskTypes: [], apiConfigId: '', model: '', priority: 10 })
  showRouteDialog.value = true
}

function openRouteDialogForEdit(route: ModelRouteRule) {
  editingRoute.value = true
  Object.assign(routeForm, { ...route, taskTypes: [...route.taskTypes] })
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
}

const watchFolderRows = computed(() => configStore.config.watchFolders.map((path) => ({ path })))

async function addWatchFolder() {
  const folder = await window.electronAPI.dialog.selectFolder()
  if (!folder) return
  await configStore.setConfig('watchFolders', [...configStore.config.watchFolders, folder])
}

async function removeWatchFolder(index: number) {
  const next = configStore.config.watchFolders.filter((_, i) => i !== index)
  await configStore.setConfig('watchFolders', next)
}

async function selectLive2DModel() {
  const file = await window.electronAPI.dialog.selectFile([{ name: 'Live2D Model', extensions: ['model3.json', 'json'] }])
  if (file) {
    configStore.config.live2dModelPath = file
  }
}

async function saveLive2DConfig() {
  await configStore.setConfig('live2dModelPath', configStore.config.live2dModelPath)
  await configStore.setConfig('window', { ...configStore.config.window })
}

const expressionRows = ref<MappingRow[]>([])
const motionRows = ref<MappingRow[]>([])

function mapToRows(mapObj: Record<string, string>): MappingRow[] {
  return Object.entries(mapObj).map(([alias, target]) => ({ alias, target }))
}

function rowsToMap(rows: MappingRow[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) {
    const alias = row.alias.trim()
    const target = row.target.trim()
    if (alias && target) result[alias] = target
  }
  return result
}

function syncActionMapRowsFromConfig() {
  expressionRows.value = mapToRows(configStore.config.live2dActionMap.expression || {})
  motionRows.value = mapToRows(configStore.config.live2dActionMap.motion || {})
}

function addExpressionRow() {
  expressionRows.value.push({ alias: '', target: '' })
}

function removeExpressionRow(index: number) {
  expressionRows.value.splice(index, 1)
}

function addMotionRow() {
  motionRows.value.push({ alias: '', target: '' })
}

function removeMotionRow(index: number) {
  motionRows.value.splice(index, 1)
}

async function saveLive2DActionMap() {
  await configStore.setConfig('live2dActionMap', {
    expression: rowsToMap(expressionRows.value),
    motion: rowsToMap(motionRows.value),
  })
}

async function saveHotkeys() {
  await configStore.setConfig('hotkeys', { ...configStore.config.hotkeys })
}

async function saveTriggerPrompts() {
  await configStore.setConfig('triggerPrompts', { ...configStore.config.triggerPrompts })
  await configStore.setConfig('randomTimerRange', { ...configStore.config.randomTimerRange })
}

async function saveAgentChainConfig() {
  await configStore.setConfig('agentChain', { ...configStore.config.agentChain })
}

const toolList = ref<ToolDefinition[]>([])
const toolsLoading = ref(false)

async function loadTools() {
  toolsLoading.value = true
  try {
    toolList.value = await window.electronAPI.tools.list()
  } finally {
    toolsLoading.value = false
  }
}

onMounted(async () => {
  await configStore.loadConfig()
  syncActionMapRowsFromConfig()
  await loadTools()
})
</script>

<style scoped>
.settings-page {
  padding: 16px;
}

.tabs {
  margin-top: 12px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ellipsis {
  max-height: 64px;
  overflow: hidden;
  color: #606266;
  line-height: 1.5;
}

.actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

.active {
  border-color: #409eff;
}

.mapping-block {
  margin-bottom: 14px;
}

.mapping-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
</style>
