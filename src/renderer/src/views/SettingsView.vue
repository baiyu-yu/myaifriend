<template>
  <div class="settings-page">
    <div class="header-area">
      <el-button @click="hideSettings" circle class="back-btn">
        <el-icon><Back /></el-icon>
      </el-button>
      <el-page-header content="设置中心" icon="" title="" @back="hideSettings" />
      <el-button text class="collapse-btn" @click="toggleTabsCollapsed">
        {{ tabsCollapsed ? '展开菜单' : '收起菜单' }}
      </el-button>
    </div>

    <el-tabs v-model="activeTab" tab-position="left" class="tabs" :class="{ collapsed: tabsCollapsed }">
      <el-tab-pane label="API 与模型配置" name="api">
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

        <el-divider content-position="left">模型分配（按功能类型）</el-divider>
        <el-form label-width="180px" style="max-width: 860px">
          <el-form-item v-for="(label, key) in taskTypeLabels" :key="key" :label="label">
            <div style="display: flex; gap: 12px; width: 100%">
              <el-select v-model="modelAssignmentForm[key].apiConfigId" placeholder="选择 API" style="flex: 1">
                <el-option label="（未配置）" value="" />
                <el-option v-for="api in configStore.apiConfigs" :key="api.id" :value="api.id" :label="api.name" />
              </el-select>
              <el-input v-model="modelAssignmentForm[key].model" placeholder="模型名称" style="flex: 1" />
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveModelAssignments">保存模型分配</el-button>
          </el-form-item>
        </el-form>
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

      <el-tab-pane label="工作链" name="chain">
        <el-form label-width="220px" style="max-width: 760px">
          <el-form-item label="工作链调度说明">
            <el-text type="info">
              工作链由总理模型自动分析用户输入并生成调度方案，无需手动配置正则规则。请确保在"API 与模型配置"中为总理模型分配了可用的 API 和模型。
            </el-text>
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
          <el-form-item label="启用轮次摘要">
            <el-switch v-model="configStore.config.agentChain.enableRoundSummary" />
          </el-form-item>
          <el-form-item label="轮次摘要触发阈值（轮）">
            <el-input-number v-model="configStore.config.agentChain.roundSummaryTriggerTurns" :min="20" :max="500" :step="10" />
          </el-form-item>
          <el-form-item label="轮次摘要前段轮次">
            <el-input-number v-model="configStore.config.agentChain.roundSummaryHeadTurns" :min="10" :max="300" :step="10" />
          </el-form-item>
          <el-form-item label="启用长期记忆">
            <el-switch v-model="configStore.config.agentChain.enableMemory" />
          </el-form-item>
          <el-form-item label="启用本能层记忆">
            <el-switch v-model="configStore.config.memoryLayers.instinctEnabled" />
          </el-form-item>
          <el-form-item label="本能层记忆（每行一条）">
            <el-input
              v-model="instinctMemoriesInput"
              type="textarea"
              :rows="4"
              placeholder="例如：回答先给结论，再给步骤"
            />
          </el-form-item>
          <el-form-item label="启用潜意识层记忆">
            <el-switch v-model="configStore.config.memoryLayers.subconsciousEnabled" />
          </el-form-item>
          <el-form-item label="启用主动回忆层">
            <el-switch v-model="configStore.config.memoryLayers.activeRecallEnabled" />
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
                <el-button @click="selectLive2DModelPath">选择模型路径</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="待机轻微晃动">
            <el-switch v-model="configStore.config.live2dBehavior.enableIdleSway" />
          </el-form-item>
          <el-form-item label="晃动幅度">
            <el-input-number v-model="configStore.config.live2dBehavior.idleSwayAmplitude" :min="1" :max="30" />
          </el-form-item>
          <el-form-item label="晃动速度">
            <el-input-number v-model="configStore.config.live2dBehavior.idleSwaySpeed" :min="0.1" :max="3" :step="0.1" :precision="1" />
          </el-form-item>
          <el-form-item label="眼部鼠标追踪">
            <el-switch v-model="configStore.config.live2dBehavior.enableEyeTracking" />
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
          <el-table-column label="启用" width="96">
            <template #default="{ row }">
              <el-switch
                :model-value="row.enabled !== false"
                @update:model-value="toggleToolEnabled(row.name, Boolean($event))"
              />
            </template>
          </el-table-column>
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

      <el-tab-pane label="运行日志" name="logs">
        <div class="mapping-header" style="margin-bottom: 8px">
          <div style="display: flex; gap: 8px; align-items: center">
            <el-button type="primary" @click="loadRuntimeLogs">刷新</el-button>
            <el-select v-model="logLevelFilter" style="width: 140px">
              <el-option label="全部等级" value="all" />
              <el-option label="INFO" value="info" />
              <el-option label="WARN" value="warn" />
              <el-option label="ERROR" value="error" />
            </el-select>
          </div>
          <el-button type="danger" plain @click="clearRuntimeLogs">清空日志</el-button>
        </div>
        <el-table :data="filteredRuntimeLogs" border stripe :row-class-name="runtimeLogRowClass">
          <el-table-column label="时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.timestamp) }}
            </template>
          </el-table-column>
          <el-table-column label="级别" width="96">
            <template #default="{ row }">
              <el-tag :type="logLevelTagType(row.level)" effect="dark">{{ row.level.toUpperCase() }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="source" label="来源" width="130" />
          <el-table-column prop="message" label="内容" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="数据存储" name="storage">
        <el-form label-width="140px" style="max-width: 920px">
          <el-form-item label="当前目录">
            <el-input v-model="storageDir" readonly placeholder="未获取" />
          </el-form-item>
          <el-form-item label="新目录">
            <el-input v-model="pendingStorageDir" placeholder="请选择新的数据存储目录" readonly>
              <template #append>
                <el-button @click="selectStorageDir">选择目录</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="applyStorageDir">应用并重启</el-button>
            <el-text type="info" style="margin-left: 8px">将迁移配置、会话和记忆数据到新目录</el-text>
          </el-form-item>
        </el-form>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { v4 as uuidv4 } from 'uuid'
import { useConfigStore } from '../stores/config'
import { Back } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type {
  ApiConfig,
  CharacterConfig,
  TaskType,
  ToolDefinition,
} from '../../../common/types'
import { TASK_TYPE_LABELS } from '../../../common/types'

type MappingRow = { alias: string; target: string }
type MemoryRow = { id: string; sourceId: string; text: string; createdAt: number; updatedAt: number; hits: number }
type MemoryGroupRow = { sourceId: string; count: number; preview: string; ids: string[] }
type RuntimeLogRow = {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error'
  source: string
  message: string
}

const configStore = useConfigStore()
const router = useRouter()
const activeTab = ref('api')
const tabsCollapsed = ref(false)
const fileChangeInfo = '{{fileChangeInfo}}'
const taskTypeLabels = TASK_TYPE_LABELS

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

const modelAssignmentForm = reactive<Record<TaskType, { apiConfigId: string; model: string }>>({
  roleplay: { apiConfigId: '', model: '' },
  context_compression: { apiConfigId: '', model: '' },
  memory_fragmentation: { apiConfigId: '', model: '' },
  vision: { apiConfigId: '', model: '' },
  code_generation: { apiConfigId: '', model: '' },
  premier: { apiConfigId: '', model: '' },
})

function getElectronAPIOrNotify() {
  const api = window.electronAPI
  if (!api) {
    ElMessage.error('桌面桥接不可用，请使用桌面应用启动（npm run dev:electron 或打包版）。')
    return null
  }
  return api
}

function syncModelAssignmentsFromConfig() {
  const assignments = configStore.config.modelAssignments
  if (!assignments) return
  for (const key of Object.keys(modelAssignmentForm) as TaskType[]) {
    if (assignments[key]) {
      modelAssignmentForm[key].apiConfigId = assignments[key].apiConfigId || ''
      modelAssignmentForm[key].model = assignments[key].model || ''
    }
  }
}

async function saveModelAssignments() {
  const next = { ...modelAssignmentForm }
  await configStore.setConfig('modelAssignments', next)
  ElMessage.success('模型分配已保存')
}

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
  ElMessage.success('API 配置已保存')
}

async function deleteApi(id: string) {
  await configStore.removeApiConfig(id)
  ElMessage.success('API 配置已删除')
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
  ElMessage.success('角色配置已保存')
}

const watchFolderRows = computed(() => configStore.config.watchFolders.map((path) => ({ path })))

async function addWatchFolder() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  const folder = await api.dialog.selectFolder()
  if (!folder) return
  await configStore.setConfig('watchFolders', [...configStore.config.watchFolders, folder])
  ElMessage.success('已添加监听文件夹')
}

async function removeWatchFolder(index: number) {
  const next = configStore.config.watchFolders.filter((_, i) => i !== index)
  await configStore.setConfig('watchFolders', next)
  ElMessage.success('已移除监听文件夹')
}

async function selectLive2DModelPath() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  const selectedPath = await api.dialog.selectPath()
  if (selectedPath) {
    configStore.config.live2dModelPath = selectedPath
    ElMessage.success('已选择 Live2D 模型路径')
  }
}

async function saveLive2DConfig() {
  try {
    await configStore.setConfig('live2dModelPath', configStore.config.live2dModelPath)
    await configStore.setConfig('live2dBehavior', { ...configStore.config.live2dBehavior })
    await configStore.setConfig('window', { ...configStore.config.window })
    await configStore.loadConfig()
    syncActionMapRowsFromConfig()
    ElMessage.success('Live2D 配置已保存')
  } catch (error) {
    ElMessage.error(`Live2D 配置保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
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
  ElMessage.success('映射表已保存')
}

async function saveHotkeys() {
  const result = (await configStore.setConfig('hotkeys', {
    ...configStore.config.hotkeys,
  })) as
    | {
        applied?: { toggleChat: string; toggleLive2D: string }
        warnings?: string[]
      }
    | undefined

  if (result?.applied) {
    configStore.config.hotkeys = { ...result.applied }
  }
  if (result?.warnings?.length) {
    ElMessage.warning(result.warnings.join('；'))
  } else {
    ElMessage.success('快捷键已保存并生效')
  }
}

async function saveTriggerPrompts() {
  await configStore.setConfig('triggerPrompts', { ...configStore.config.triggerPrompts })
  await configStore.setConfig('randomTimerRange', { ...configStore.config.randomTimerRange })
  ElMessage.success('唤起提示词已保存')
}

async function saveAgentChainConfig() {
  await configStore.setConfig('memoryLayers', {
    ...configStore.config.memoryLayers,
    instinctMemories: parseDomainInput(instinctMemoriesInput.value),
  })
  await configStore.setConfig('agentChain', { ...configStore.config.agentChain })
  ElMessage.success('工作链配置已保存')
}

const toolList = ref<ToolDefinition[]>([])
const toolsLoading = ref(false)
const memoryRows = ref<MemoryRow[]>([])
const memoriesLoading = ref(false)
const runtimeLogs = ref<RuntimeLogRow[]>([])
const logLevelFilter = ref<'all' | 'info' | 'warn' | 'error'>('all')
const storageDir = ref('')
const pendingStorageDir = ref('')
let logRefreshTimer: ReturnType<typeof setInterval> | null = null
const searchAllowDomainsInput = ref('')
const searchBlockDomainsInput = ref('')
const instinctMemoriesInput = ref('')

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

const filteredRuntimeLogs = computed(() =>
  runtimeLogs.value.filter((item) => logLevelFilter.value === 'all' || item.level === logLevelFilter.value)
)

async function loadTools() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  toolsLoading.value = true
  try {
    toolList.value = await api.tools.list()
  } finally {
    toolsLoading.value = false
  }
}

async function toggleToolEnabled(name: string, enabled: boolean) {
  const next = { ...(configStore.config.toolToggles || {}) }
  next[name] = enabled
  await configStore.setConfig('toolToggles', next)
  await loadTools()
  ElMessage.success(`工具 ${name} 已${enabled ? '启用' : '禁用'}`)
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

function syncMemoryLayerInputs() {
  instinctMemoriesInput.value = (configStore.config.memoryLayers.instinctMemories || []).join('\n')
}

async function saveWebSearchConfig() {
  await configStore.setConfig('webSearch', {
    allowDomains: parseDomainInput(searchAllowDomainsInput.value),
    blockDomains: parseDomainInput(searchBlockDomainsInput.value),
  })
  ElMessage.success('搜索规则已保存')
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

async function loadMemories() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  memoriesLoading.value = true
  try {
    memoryRows.value = await api.memory.list()
  } finally {
    memoriesLoading.value = false
  }
}

async function deleteMemory(id: string) {
  const api = getElectronAPIOrNotify()
  if (!api) return
  await api.memory.delete(id)
  await loadMemories()
}

async function clearMemories() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  await api.memory.clear()
  await loadMemories()
  ElMessage.success('记忆已清空')
}

async function mergeMemoryGroup(ids: string[]) {
  if (!ids || ids.length < 2) return
  const api = getElectronAPIOrNotify()
  if (!api) return
  await api.memory.merge(ids)
  await loadMemories()
  ElMessage.success('记忆碎片已合并')
}

async function loadRuntimeLogs() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  runtimeLogs.value = await api.app.log.list()
}

function logLevelTagType(level: 'info' | 'warn' | 'error'): 'success' | 'warning' | 'danger' {
  if (level === 'error') return 'danger'
  if (level === 'warn') return 'warning'
  return 'success'
}

function runtimeLogRowClass(args: { row: RuntimeLogRow }) {
  if (args.row.level === 'error') return 'log-row-error'
  if (args.row.level === 'warn') return 'log-row-warn'
  return 'log-row-info'
}

function stopLogAutoRefresh() {
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer)
    logRefreshTimer = null
  }
}

function startLogAutoRefresh() {
  stopLogAutoRefresh()
  loadRuntimeLogs()
  logRefreshTimer = setInterval(() => {
    void loadRuntimeLogs()
  }, 1500)
}

async function clearRuntimeLogs() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  await api.app.log.clear()
  runtimeLogs.value = []
  ElMessage.success('运行日志已清空')
}

async function loadStorageInfo() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  const info = await api.app.storage.info()
  storageDir.value = info.currentDir || ''
  if (!pendingStorageDir.value) {
    pendingStorageDir.value = storageDir.value
  }
}

async function selectStorageDir() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  const selected = await api.dialog.selectFolder()
  if (!selected) return
  pendingStorageDir.value = selected
}

async function applyStorageDir() {
  const api = getElectronAPIOrNotify()
  if (!api) return
  const next = pendingStorageDir.value.trim()
  if (!next) {
    ElMessage.warning('请先选择目录')
    return
  }
  if (next === storageDir.value) {
    ElMessage.info('目录未变化')
    return
  }
  await api.app.storage.set(next)
}

function hideSettings() {
  router.push('/cover')
}

function toggleTabsCollapsed() {
  tabsCollapsed.value = !tabsCollapsed.value
}

onMounted(async () => {
  await configStore.loadConfig()
  syncActionMapRowsFromConfig()
  syncModelAssignmentsFromConfig()
  syncSearchConfigInputs()
  syncMemoryLayerInputs()
  await loadTools()
  await loadMemories()
  await loadStorageInfo()
  if (activeTab.value === 'logs') {
    startLogAutoRefresh()
  } else {
    await loadRuntimeLogs()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'logs') {
    startLogAutoRefresh()
    return
  }
  stopLogAutoRefresh()
})

onBeforeUnmount(() => {
  stopLogAutoRefresh()
})
</script>

<style scoped>
.settings-page {
  padding: 22px;
  max-width: 1200px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(248, 250, 251, 0.82));
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.1);
}

.header-area {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 6px 10px;
  border-bottom: 1px dashed rgba(15, 23, 42, 0.12);
}

.collapse-btn {
  margin-left: auto;
  color: #0f766e;
}

.back-btn {
  font-size: 18px;
  background: linear-gradient(135deg, #e9f8f5 0%, #d7f2ed 100%);
  border: 1px solid rgba(15, 118, 110, 0.22);
  color: #0f766e;
}

.tabs {
  margin-top: 14px;
  min-height: calc(100vh - 170px);
  background: rgba(255, 255, 255, 0.78);
  padding: 16px;
  border-radius: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

:deep(.el-tabs__header) {
  margin-bottom: 0;
  margin-right: 12px;
  border-right: 1px solid rgba(15, 23, 42, 0.08);
  padding-right: 8px;
}

:deep(.el-tabs__nav-scroll) {
  padding-bottom: 2px;
}

:deep(.el-tabs__item) {
  font-size: 14px;
  font-weight: 500;
  height: 36px;
  color: #334155;
  border-radius: 10px;
  margin-right: 4px;
  transition: all 0.2s;
}

:deep(.el-tabs__item:hover) {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.09);
}

:deep(.el-tabs__item.is-active) {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.14);
}

:deep(.el-tabs__nav-wrap::after) {
  height: 0;
}

:deep(.el-tabs__active-bar) {
  background: linear-gradient(135deg, #0f766e, #115e59);
  border-radius: 999px;
  width: 3px;
}

.tabs.collapsed :deep(.el-tabs__header) {
  width: 48px;
}

.tabs.collapsed :deep(.el-tabs__item) {
  width: 36px;
  padding-left: 0;
  padding-right: 0;
  justify-content: center;
  font-size: 0;
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
  flex-wrap: wrap;
}

.active {
  border: 1px solid rgba(15, 118, 110, 0.45);
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.14);
}

.mapping-block {
  margin-bottom: 24px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 10px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(249, 252, 252, 0.92), rgba(242, 247, 248, 0.9));
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
  color: #334155;
}

:deep(.el-card) {
  transition: all 0.22s;
  margin-bottom: 12px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
}

:deep(.el-card:hover) {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
}

:deep(.el-button--primary) {
  background: linear-gradient(135deg, #0f766e 0%, #0b5e58 100%);
  border-color: #0f766e;
}

:deep(.el-button--primary:hover) {
  filter: brightness(1.04);
}

:deep(.el-table) {
  border-radius: 10px;
  overflow: hidden;
  border-color: rgba(15, 23, 42, 0.1);
}

:deep(.el-table th.el-table__cell) {
  background: rgba(15, 118, 110, 0.08);
  color: #1f2937;
  font-weight: 600;
}

:deep(.log-row-info .el-table__cell) {
  background: rgba(15, 118, 110, 0.03);
}

:deep(.log-row-warn .el-table__cell) {
  background: rgba(245, 158, 11, 0.08);
}

:deep(.log-row-error .el-table__cell) {
  background: rgba(239, 68, 68, 0.08);
}

@media (max-width: 768px) {
  .settings-page {
    padding: 12px;
    border-radius: 0;
    border: none;
    box-shadow: none;
  }

  .tabs {
    padding: 10px;
  }

  :deep(.el-form-item) {
    margin-bottom: 14px;
  }
}
</style>
