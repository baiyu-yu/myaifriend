<template>
  <div class="settings-page">
    <div class="header-area">
      <el-button @click="backToHome" circle class="back-btn">
        <el-icon><Back /></el-icon>
      </el-button>
      <el-page-header content="设置中心" icon="" title="" @back="backToHome" />
    </div>

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
          <el-form-item label="任务分类规则（正则）">
            <div style="width: 100%">
              <div class="mapping-header" style="margin-bottom: 8px">
                <span>按优先级从小到大匹配，命中即采用该任务类型</span>
                <el-button size="small" type="primary" @click="addTaskRule">新增规则</el-button>
              </div>
              <el-table :data="taskClassifierRows" border stripe>
                <el-table-column label="启用" width="80">
                  <template #default="{ row }">
                    <el-switch v-model="row.enabled" />
                  </template>
                </el-table-column>
                <el-table-column label="名称" width="140">
                  <template #default="{ row }">
                    <el-input v-model="row.name" placeholder="规则名" />
                  </template>
                </el-table-column>
                <el-table-column label="任务类型" width="140">
                  <template #default="{ row }">
                    <el-select v-model="row.taskType">
                      <el-option label="chat" value="chat" />
                      <el-option label="roleplay" value="roleplay" />
                      <el-option label="tool_call" value="tool_call" />
                      <el-option label="file_operation" value="file_operation" />
                      <el-option label="summary" value="summary" />
                      <el-option label="translation" value="translation" />
                      <el-option label="vision" value="vision" />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="优先级" width="120">
                  <template #default="{ row }">
                    <el-input-number v-model="row.priority" :min="1" :max="9999" />
                  </template>
                </el-table-column>
                <el-table-column label="匹配正则">
                  <template #default="{ row }">
                    <el-input v-model="row.pattern" placeholder="例如：翻译|translate|译为" />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="90">
                  <template #default="{ $index }">
                    <el-button size="small" type="danger" @click="removeTaskRule($index)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-text type="info">注意：这是 JavaScript 正则，错误规则会被自动忽略。</el-text>
            </div>
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
          <el-form-item label="记忆相似度阈值">
            <el-input-number
              v-model="configStore.config.agentChain.memoryMinScore"
              :min="0"
              :max="1"
              :step="0.01"
              :precision="2"
            />
          </el-form-item>
          <el-form-item label="记忆去重（按来源）">
            <el-switch v-model="configStore.config.agentChain.memoryDeduplicate" />
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
            <el-text type="success" style="margin-left: 8px">保存后立即生效（若系统占用会自动回退）</el-text>
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
        <el-divider content-position="left">网络搜索过滤规则（web_search）</el-divider>
        <el-form label-width="140px" style="max-width: 900px">
          <el-form-item label="白名单域名">
            <el-input
              v-model="searchAllowDomainsInput"
              type="textarea"
              :rows="3"
              placeholder="每行一个域名，例如：wikipedia.org"
            />
          </el-form-item>
          <el-form-item label="黑名单域名">
            <el-input
              v-model="searchBlockDomainsInput"
              type="textarea"
              :rows="3"
              placeholder="每行一个域名，例如：example.com"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveWebSearchConfig">保存搜索规则</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="记忆管理" name="memory">
        <div class="mapping-header" style="margin-bottom: 8px">
          <el-button type="primary" @click="loadMemories">刷新</el-button>
          <el-button type="danger" plain @click="clearMemories">清空记忆</el-button>
        </div>
        <el-table :data="memoryRows" border stripe v-loading="memoriesLoading">
          <el-table-column prop="text" label="内容" />
          <el-table-column prop="hits" label="命中次数" width="100" />
          <el-table-column label="更新时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.updatedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button size="small" type="danger" @click="deleteMemory(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-divider content-position="left">碎片聚类（按来源）</el-divider>
        <el-table :data="memoryGroups" border stripe>
          <el-table-column prop="sourceId" label="来源ID" width="220" />
          <el-table-column prop="count" label="碎片数" width="90" />
          <el-table-column label="示例内容">
            <template #default="{ row }">
              {{ row.preview }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button size="small" type="primary" :disabled="row.count < 2" @click="mergeMemoryGroup(row.ids)">
                合并碎片
              </el-button>
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
import { useRouter } from 'vue-router'
import { v4 as uuidv4 } from 'uuid'
import { useConfigStore } from '../stores/config'
import { Back } from '@element-plus/icons-vue'
import type {
  ApiConfig,
  CharacterConfig,
  ModelRouteRule,
  TaskClassifierRule,
  TaskType,
  ToolDefinition,
} from '../../../common/types'

type MappingRow = { alias: string; target: string }
type MemoryRow = { id: string; sourceId: string; text: string; createdAt: number; updatedAt: number; hits: number }
type MemoryGroupRow = { sourceId: string; count: number; preview: string; ids: string[] }

const configStore = useConfigStore()
const router = useRouter()
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
  // Electron 这里的 dialog 返回的是绝对路径
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
const taskClassifierRows = ref<TaskClassifierRule[]>([])

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
  configStore.config.agentChain.taskClassifierRules = taskClassifierRows.value
    .filter((row) => row.pattern.trim())
    .map((row) => ({
      ...row,
      name: row.name.trim() || `规则-${row.taskType}`,
      pattern: row.pattern.trim(),
    }))
  await configStore.setConfig('agentChain', { ...configStore.config.agentChain })
}

function addTaskRule() {
  taskClassifierRows.value.push({
    id: uuidv4(),
    name: '',
    pattern: '',
    taskType: 'chat',
    enabled: true,
    priority: 10,
  })
}

function removeTaskRule(index: number) {
  taskClassifierRows.value.splice(index, 1)
}

function syncTaskRulesFromConfig() {
  taskClassifierRows.value = (configStore.config.agentChain.taskClassifierRules || []).map((rule) => ({ ...rule }))
}

const toolList = ref<ToolDefinition[]>([])
const toolsLoading = ref(false)
const memoryRows = ref<MemoryRow[]>([])
const memoriesLoading = ref(false)
const searchAllowDomainsInput = ref('')
const searchBlockDomainsInput = ref('')

const memoryGroups = computed<MemoryGroupRow[]>(() => {
  const groupMap = new Map<string, MemoryGroupRow>()
  for (const item of memoryRows.value) {
    const sourceId = item.sourceId || item.id
    if (!groupMap.has(sourceId)) {
      groupMap.set(sourceId, {
        sourceId,
        count: 0,
        preview: item.text.slice(0, 80),
        ids: [],
      })
    }
    const group = groupMap.get(sourceId)!
    group.count += 1
    group.ids.push(item.id)
  }
  return Array.from(groupMap.values()).sort((a, b) => b.count - a.count)
})

async function loadTools() {
  toolsLoading.value = true
  try {
    toolList.value = await window.electronAPI.tools.list()
  } finally {
    toolsLoading.value = false
  }
}

function parseDomainInput(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function syncSearchConfigInputs() {
  searchAllowDomainsInput.value = (configStore.config.webSearch.allowDomains || []).join('\n')
  searchBlockDomainsInput.value = (configStore.config.webSearch.blockDomains || []).join('\n')
}

async function saveWebSearchConfig() {
  await configStore.setConfig('webSearch', {
    allowDomains: parseDomainInput(searchAllowDomainsInput.value),
    blockDomains: parseDomainInput(searchBlockDomainsInput.value),
  })
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yy}-${mm}-${dd} ${hh}:${mi}`
}

async function loadMemories() {
  memoriesLoading.value = true
  try {
    memoryRows.value = await window.electronAPI.memory.list()
  } finally {
    memoriesLoading.value = false
  }
}

async function deleteMemory(id: string) {
  await window.electronAPI.memory.delete(id)
  await loadMemories()
}

async function clearMemories() {
  await window.electronAPI.memory.clear()
  await loadMemories()
}

async function mergeMemoryGroup(ids: string[]) {
  if (!ids || ids.length < 2) return
  await window.electronAPI.memory.merge(ids)
  await loadMemories()
}

function backToHome() {
  router.push('/live2d')
}

onMounted(async () => {
  await configStore.loadConfig()
  syncActionMapRowsFromConfig()
  syncTaskRulesFromConfig()
  syncSearchConfigInputs()
  await loadTools()
  await loadMemories()
})
</script>

<style scoped>
.settings-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.header-area {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  font-size: 18px;
}

.tabs {
  margin-top: 20px;
  background-color: #fff;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

:deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 500;
}

:deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background-color: #ebeef5;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.ellipsis {
  max-height: 64px;
  overflow: hidden;
  color: #606266;
  line-height: 1.6;
  font-size: 14px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.active {
  border: 1px solid #409eff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.1);
}

.mapping-block {
  margin-bottom: 24px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 16px;
  background-color: #fafafa;
}

.mapping-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-weight: 500;
}

.mapping-header span {
  font-size: 15px;
  color: #303133;
}

:deep(.el-form-item__label) {
  font-weight: 500;
}

:deep(.el-card) {
  transition: all 0.3s;
  margin-bottom: 12px;
}

:deep(.el-card:hover) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
</style>
