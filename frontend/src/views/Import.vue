<template>
  <div class="import-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <el-button @click="$router.push('/')" text>
            <el-icon><ArrowLeft /></el-icon>
            返回
          </el-button>
          <h2>导入浏览器书签</h2>
        </div>
      </template>

      <el-steps :active="step" finish-status="success" align-center class="steps">
        <el-step title="选择文件" />
        <el-step title="预览与选择" />
        <el-step title="导入结果" />
      </el-steps>

      <!-- ============ Step 1: upload ============ -->
      <div v-show="step === 0">
        <div class="import-instructions">
          <h3>如何导出 Chrome 书签：</h3>
          <ol>
            <li>打开 Chrome 浏览器，点击右上角菜单 (三个点)</li>
            <li>选择 "书签和清单" &gt; "书签管理器"</li>
            <li>在书签管理器中，点击右上角菜单 (三个点)</li>
            <li>选择 "导出书签"，保存为 HTML 文件</li>
          </ol>
        </div>

        <el-upload
          class="upload-area"
          drag
          :auto-upload="false"
          :limit="1"
          accept=".html,.htm"
          :on-change="handleFileChange"
          :on-remove="handleFileRemove"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">
            拖拽文件到此处，或 <em>点击选择</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">仅支持浏览器导出的 HTML 书签文件，选择后会先生成预览，不会立即写入。</div>
          </template>
        </el-upload>

        <el-alert
          v-if="parseError"
          class="parse-error"
          type="error"
          :closable="false"
          show-icon
          title="无法生成预览，导入已停在这一步（链接库未做任何改动）"
          :description="parseError"
        />

        <div class="upload-actions" v-if="selectedFile">
          <p class="file-name">已选择: {{ selectedFile.name }}（{{ formatSize(selectedFile.size) }}）</p>
          <el-button type="primary" :loading="previewing" @click="handlePreview" size="large">
            生成预览
          </el-button>
        </div>

        <el-divider>最近的导入记录</el-divider>
        <HistoryTable :reports="history" :loading="loadingHistory" @open="openReport" @delete="deleteHistory" />
      </div>

      <!-- ============ Step 2: preview ============ -->
      <div v-show="step === 1 && report">
        <div class="preview-summary">
          <p class="filename">
            <el-icon><Document /></el-icon>
            {{ report.filename }}（{{ formatSize(report.file_size) }}）
          </p>
          <div class="stat-tags">
            <el-tag type="info">共解析 {{ report.total_parsed }} 条</el-tag>
            <el-tag type="success">可新建 {{ newCount }} 条</el-tag>
            <el-tag type="warning">库中已存在 {{ report.existing_count }} 条</el-tag>
            <el-tag type="info" v-if="report.in_file_duplicate_count > 0">
              文件内重复 {{ report.in_file_duplicate_count }} 条
            </el-tag>
            <el-tag type="danger">地址不合法 {{ report.invalid_count }} 条</el-tag>
            <el-tag type="success" v-if="newCategories.length > 0" effect="plain">
              将新建 {{ newCategories.length }} 个分类：{{ newCategories.join('、') }}
            </el-tag>
          </div>
        </div>

        <el-alert
          v-if="sameNameReports.length > 0"
          class="same-name-alert"
          type="warning"
          show-icon
          :closable="false"
          :title="`检测到同名文件「${report.filename}」此前已导入过 ${sameNameReports.length} 次`"
        >
          <div>
            选择「替换历史明细」会把同名文件的旧明细标记为被替换（旧链接本身不会被删除）；
            选择「保留历史明细」则新旧明细各自保留，下方已存在的链接也按相同策略处理。
          </div>
        </el-alert>

        <el-radio-group v-model="duplicateAction" class="action-group">
          <el-radio-button value="skip">已存在条目：跳过（默认）</el-radio-button>
          <el-radio-button value="replace">已存在条目：替换标题与分类</el-radio-button>
        </el-radio-group>
        <p class="action-hint">
          {{
            duplicateAction === 'replace'
              ? '勾选的已存在条目将被更新；同名文件的历史明细将标记为「被替换」。'
              : '勾选的已存在条目保持不变；同名文件的历史明细原样保留。'
          }}
        </p>

        <div class="table-toolbar">
          <el-radio-group v-model="filterStatus" size="small">
            <el-radio-button value="all">全部 ({{ selectableItems.length }})</el-radio-button>
            <el-radio-button value="new">新建 ({{ newCount }})</el-radio-button>
            <el-radio-button value="existing">已存在 ({{ report.existing_count }})</el-radio-button>
            <el-radio-button value="duplicate">文件内重复 ({{ duplicateItemCount }})</el-radio-button>
            <el-radio-button value="invalid">不合法 ({{ report.invalid_count }})</el-radio-button>
          </el-radio-group>
          <div class="selection-controls">
            <el-checkbox v-model="selectAllVisible" :indeterminate="someVisibleSelected" @change="toggleSelectAllVisible">
              全选当前筛选
            </el-checkbox>
            <span class="selected-count">已选 {{ selectedCount }} 条可导入</span>
          </div>
        </div>

        <el-table :data="filteredItems" border stripe max-height="440" row-key="id" class="preview-table">
          <el-table-column width="48" align="center">
            <template #default="{ row }">
              <el-checkbox
                :model-value="!!row._selected"
                :disabled="row.preview_status === 'invalid'"
                @change="(val) => toggleRow(row, val)"
              />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="170">
            <template #default="{ row }">
              <el-tag v-if="row.preview_status === 'new'" type="success" size="small">新建</el-tag>
              <el-tag v-else-if="row.preview_status === 'existing'" type="warning" size="small">库中已存在</el-tag>
              <el-tag v-else type="danger" size="small">地址不合法</el-tag>
              <el-tag v-if="row.duplicate_in_file" type="info" size="small" class="dup-tag">文件内重复</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
          <el-table-column prop="url" label="地址" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span :class="{ 'invalid-url': row.preview_status === 'invalid' }">{{ row.url || '(空)' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="150" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.folder || '未分类' }}
              <el-tag v-if="isNewCategory(row.folder)" type="success" size="small" effect="plain">新建</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="150">
            <template #default="{ row }">
              <span v-if="row.preview_status === 'invalid'" class="reason-text">{{ row.invalid_reason }}</span>
              <span v-else-if="row.preview_status === 'existing'" class="reason-text">
                将{{ duplicateAction === 'replace' ? '替换该链接的标题与分类' : '跳过，不改动原链接' }}
              </span>
              <span v-else-if="row.duplicate_in_file && !isFirstOccurrence(row)" class="reason-text">
                与文件内更早的条目重复，默认不勾选
              </span>
              <span v-else-if="row.duplicate_in_file" class="reason-text">文件内首次出现，其后有重复地址</span>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="commitError" class="commit-error">
          <el-alert type="error" :closable="false" show-icon :title="commitError" />
          <el-alert
            v-if="commitAborted"
            type="info"
            :closable="false"
            show-icon
            class="abort-note"
            title="服务端仍在后台继续完成本次导入，已经带进来的条目不会回退。"
            description="可以点击「查询导入结果」获取服务端的最新明细（报告已持久化，刷新页面也不会丢失）。"
          />
        </div>

        <div class="preview-actions">
          <el-button @click="backToUpload">重新选文件</el-button>
          <el-button v-if="commitAborted" @click="refreshReport">查询导入结果</el-button>
          <el-popconfirm
            title="取消后不会导入任何条目，预览明细仍会保留在导入记录中。确定取消？"
            confirm-button-text="确定取消"
            cancel-button-text="继续导入"
            @confirm="cancelImport"
          >
            <el-button>取消</el-button>
          </el-popconfirm>
          <el-button
            type="primary"
            :loading="committing"
            :disabled="selectedCount === 0"
            @click="handleCommit"
          >
            导入选中的 {{ selectedCount }} 条
          </el-button>
        </div>
      </div>

      <!-- ============ Step 3: result ============ -->
      <div v-show="step === 2 && report">
        <el-result
          :icon="report.failed_count > 0 ? 'warning' : 'success'"
          :title="resultTitle"
          :sub-title="resultSubtitle"
        />

        <div class="result-stats">
          <el-tag type="success" size="large">新建 {{ report.imported_count }} 条</el-tag>
          <el-tag type="primary" size="large" v-if="report.replaced_count > 0">替换 {{ report.replaced_count }} 条</el-tag>
          <el-tag type="info" size="large">跳过 {{ report.skipped_count }} 条</el-tag>
          <el-tag type="danger" size="large" v-if="report.failed_count > 0">失败 {{ report.failed_count }} 条</el-tag>
          <el-tag type="success" size="large" effect="dark">链接库当前共 {{ report.links_total }} 条</el-tag>
        </div>

        <el-alert
          v-if="sameNameNote"
          type="warning"
          show-icon
          :closable="false"
          class="same-name-note"
          :title="sameNameNote"
        />

        <el-table :data="report.items" border stripe max-height="420" class="result-table">
          <el-table-column label="结果" width="170">
            <template #default="{ row }">
              <el-tag :type="finalTagType(row.final_status)" size="small">
                {{ finalStatusLabel(row.final_status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="150" show-overflow-tooltip />
          <el-table-column prop="url" label="地址" min-width="200" show-overflow-tooltip />
          <el-table-column prop="folder" label="分类" width="130" show-overflow-tooltip />
          <el-table-column prop="detail" label="明细说明" min-width="200" show-overflow-tooltip />
        </el-table>

        <div class="result-actions">
          <el-button type="primary" @click="$router.push('/')">回到链接库列表</el-button>
          <el-button @click="resetAll">继续导入新文件</el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowLeft, UploadFilled, Document } from '@element-plus/icons-vue'
import { importApi } from '../api'
import HistoryTable from '../components/ImportHistory.vue'

const step = ref(0)
const selectedFile = ref(null)
const previewing = ref(false)
const committing = ref(false)
const parseError = ref('')
const commitError = ref('')
const commitAborted = ref(false)
const report = ref(null)
const duplicateAction = ref('skip')
const filterStatus = ref('all')
const history = ref([])
const loadingHistory = ref(false)
const sameNameNote = ref('')

// Local per-item selection map: itemId -> boolean
const selection = ref({})

const selectableItems = computed(() =>
  (report.value?.items || []).filter((i) => i.preview_status !== 'invalid')
)

const decoratedItems = computed(() =>
  (report.value?.items || []).map((item) => ({ ...item, _selected: !!selection.value[item.id] }))
)

const newCount = computed(() => selectableItems.value.filter((i) => i.preview_status === 'new').length)
const duplicateItemCount = computed(() => (report.value?.items || []).filter((i) => i.duplicate_in_file).length)
const selectedCount = computed(() => selectableItems.value.filter((i) => selection.value[i.id]).length)

const allNewCategories = computed(() => report.value?.new_categories || [])

// Folders that will actually be created based on the current selection
const newCategories = computed(() => {
  const used = new Set()
  for (const item of selectableItems.value) {
    if (selection.value[item.id] && item.folder && item.folder !== '未分类') {
      used.add(item.folder)
    }
  }
  return allNewCategories.value.filter((name) => used.has(name))
})

const sameNameReports = computed(() => report.value?.same_name_reports || [])

const filteredItems = computed(() => {
  const items = decoratedItems.value
  if (filterStatus.value === 'all') return items
  if (filterStatus.value === 'duplicate') return items.filter((i) => i.duplicate_in_file)
  return items.filter((i) => i.preview_status === filterStatus.value)
})

const selectAllVisible = computed({
  get() {
    const visible = filteredItems.value.filter((i) => i.preview_status !== 'invalid')
    return visible.length > 0 && visible.every((i) => selection.value[i.id])
  },
  // real setter is toggleSelectAllVisible; v-model needs a setter
  set() {},
})

const someVisibleSelected = computed(() => {
  const visible = filteredItems.value.filter((i) => i.preview_status !== 'invalid')
  const picked = visible.filter((i) => selection.value[i.id]).length
  return picked > 0 && picked < visible.length
})

const resultTitle = computed(() => {
  if (!report.value) return ''
  if (report.value.failed_count > 0) return '导入完成，但有条目失败'
  return '导入完成'
})

const resultSubtitle = computed(() => {
  if (!report.value) return ''
  const r = report.value
  return [
    `共解析 ${r.total_parsed} 条`,
    `新建 ${r.imported_count} 条`,
    r.replaced_count > 0 ? `替换 ${r.replaced_count} 条` : null,
    `跳过 ${r.skipped_count} 条`,
    r.failed_count > 0 ? `失败 ${r.failed_count} 条` : null,
  ].filter(Boolean).join('，')
})

onMounted(fetchHistory)

async function fetchHistory() {
  loadingHistory.value = true
  try {
    const { data } = await importApi.getReports()
    history.value = data
  } catch (err) {
    console.error('Failed to load import history:', err)
  } finally {
    loadingHistory.value = false
  }
}

function handleFileChange(file) {
  parseError.value = ''
  selectedFile.value = file.raw
}

function handleFileRemove() {
  selectedFile.value = null
  parseError.value = ''
}

async function handlePreview() {
  if (!selectedFile.value) return
  previewing.value = true
  parseError.value = ''
  try {
    const { data } = await importApi.previewBookmarks(selectedFile.value)
    applyReport(data)
    step.value = 1
  } catch (err) {
    // Corrupt document / parse failure: stay at the upload step with a
    // clear reason. Nothing has been written to the link library.
    parseError.value = err.response?.data?.error || '文件解析失败，请确认是浏览器导出的书签 HTML 文件'
  } finally {
    previewing.value = false
  }
}

function applyReport(data) {
  report.value = data
  sameNameNote.value = ''
  commitError.value = ''
  commitAborted.value = false
  duplicateAction.value = 'skip'
  filterStatus.value = 'all'
  const map = {}
  for (const item of data.items) {
    map[item.id] = !!item.selected
  }
  selection.value = map
}

function isNewCategory(folder) {
  return folder && folder !== '未分类' && allNewCategories.value.includes(folder)
}

function isFirstOccurrence(row) {
  const items = report.value?.items || []
  return items.find((i) => i.preview_status !== 'invalid' && i.url.toLowerCase() === row.url.toLowerCase())?.id === row.id
}

function toggleRow(row, val) {
  selection.value = { ...selection.value, [row.id]: val }
}

function toggleSelectAllVisible(val) {
  const next = { ...selection.value }
  for (const item of filteredItems.value) {
    if (item.preview_status !== 'invalid') next[item.id] = val
  }
  selection.value = next
}

async function handleCommit() {
  if (!report.value) return
  committing.value = true
  commitError.value = ''
  commitAborted.value = false
  const selectedIds = selectableItems.value.filter((i) => selection.value[i.id]).map((i) => i.id)
  try {
    const { data } = await importApi.commitBookmarks(report.value.id, {
      selected_ids: selectedIds,
      duplicate_action: duplicateAction.value,
    })
    report.value = data
    sameNameNote.value = data.same_name_note || ''
    step.value = 2
    ElMessage.success('导入完成')
    fetchHistory()
  } catch (err) {
    if (err.code === 'ERR_CANCELED' || err.message === 'canceled') {
      commitAborted.value = true
      commitError.value = '请求已被取消。'
    } else {
      commitError.value =
        err.response?.data?.error || '导入请求失败。已导入的条目不会回退，可稍候查询服务端结果。'
    }
  } finally {
    committing.value = false
  }
}

async function refreshReport() {
  if (!report.value) return
  try {
    const { data } = await importApi.getReport(report.value.id)
    report.value = { ...report.value, ...data }
    if (data.status === 'committed') {
      step.value = 2
      commitError.value = ''
      commitAborted.value = false
      fetchHistory()
    } else {
      ElMessage.info('服务端尚未完成导入，请稍后再查询')
    }
  } catch (err) {
    ElMessage.error('查询失败：' + (err.response?.data?.error || err.message))
  }
}

function cancelImport() {
  // User cancellation: no commit happens. The preview detail is already
  // persisted server-side and remains available in import history.
  ElMessage.info('已取消，未导入任何条目；预览明细保留在导入记录中')
  resetAll()
}

function backToUpload() {
  step.value = 0
  parseError.value = ''
}

function resetAll() {
  step.value = 0
  selectedFile.value = null
  report.value = null
  parseError.value = ''
  commitError.value = ''
  commitAborted.value = false
  selection.value = {}
  fetchHistory()
}

async function openReport(id) {
  try {
    const { data } = await importApi.getReport(id)
    applyReport(data)
    if (data.status === 'committed') {
      step.value = 2
    } else {
      step.value = 1
      ElMessage.info('这是一份尚未提交导入的预览，可继续选择并导入')
    }
  } catch (err) {
    ElMessage.error('打开记录失败：' + (err.response?.data?.error || err.message))
  }
}

async function deleteHistory(id) {
  try {
    await importApi.deleteReport(id)
    ElMessage.success('记录已删除')
    fetchHistory()
  } catch (err) {
    ElMessage.error('删除失败：' + (err.response?.data?.error || err.message))
  }
}

function finalStatusLabel(status) {
  return {
    imported: '新建',
    replaced: '替换',
    skipped_existing: '跳过（已存在）',
    skipped_duplicate: '跳过（文件内重复）',
    skipped_invalid: '跳过（地址不合法）',
    skipped_unselected: '跳过（未勾选）',
    failed: '失败',
  }[status] || status || '-'
}

function finalTagType(status) {
  return {
    imported: 'success',
    replaced: 'primary',
    skipped_existing: 'info',
    skipped_duplicate: 'info',
    skipped_invalid: 'danger',
    skipped_unselected: 'info',
    failed: 'danger',
  }[status] || 'info'
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
</script>

<style scoped>
.import-container {
  max-width: 1000px;
  margin: 30px auto;
  padding: 0 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-header h2 {
  margin: 0;
}

.steps {
  margin: 10px 0 28px;
}

.import-instructions {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 24px;
}

.import-instructions h3 {
  margin: 0 0 12px 0;
  font-size: 15px;
  color: #303133;
}

.import-instructions ol {
  margin: 0;
  padding-left: 20px;
  color: #606266;
  font-size: 14px;
  line-height: 1.8;
}

.upload-area {
  margin-bottom: 20px;
}

.upload-actions {
  text-align: center;
  padding: 16px 0;
}

.file-name {
  margin-bottom: 12px;
  color: #606266;
}

.parse-error {
  margin: 12px 0;
}

.preview-summary .filename {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 10px;
}

.stat-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.same-name-alert,
.same-name-note {
  margin: 12px 0;
}

.action-group {
  margin: 8px 0 4px;
}

.action-hint {
  font-size: 13px;
  color: #909399;
  margin: 4px 0 14px;
}

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.selection-controls {
  display: flex;
  align-items: center;
  gap: 14px;
}

.selected-count {
  font-size: 13px;
  color: #409eff;
}

.dup-tag {
  margin-left: 4px;
}

.invalid-url {
  color: #f56c6c;
  text-decoration: line-through;
}

.reason-text {
  font-size: 12px;
  color: #909399;
}

.preview-actions,
.result-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.commit-error {
  margin-top: 14px;
}

.abort-note {
  margin-top: 10px;
}

.result-stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin: 8px 0 18px;
}
</style>
