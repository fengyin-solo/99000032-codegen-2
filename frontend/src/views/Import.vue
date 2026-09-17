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

      <!-- ============ STEP 1: 选择文件 ============ -->
      <div v-show="stage === 'upload'">
        <div class="import-instructions">
          <h3>如何导出 Chrome 书签：</h3>
          <ol>
            <li>打开 Chrome 浏览器，点击右上角菜单 (三个点)</li>
            <li>选择 "书签和清单" &gt; "书签管理器"</li>
            <li>在书签管理器中，点击右上角菜单 (三个点)</li>
            <li>选择 "导出书签"，保存 HTML 文件后上传到此处</li>
          </ol>
          <p class="flow-hint">选择文件后会先生成预览，确认条目后才会真正写入，预览阶段不会改动链接库。</p>
        </div>

        <el-upload
          class="upload-area"
          drag
          :auto-upload="false"
          :show-file-list="false"
          accept=".html,.htm"
          :on-change="handleFileChange"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择文件</em></div>
          <template #tip>
            <div class="el-upload__tip">仅支持浏览器导出的书签 HTML 文件（10MB 以内）</div>
          </template>
        </el-upload>

        <div v-if="previewError" class="preview-error">
          <el-alert
            :title="previewError"
            type="error"
            show-icon
            :closable="false"
          >
            <template #default>
              <div class="error-detail">{{ previewErrorDetail || '文件未通过解析，未写入任何条目，请修正文件后重新选择。' }}</div>
            </template>
          </el-alert>
        </div>
      </div>

      <!-- ============ STEP 2: 预览 ============ -->
      <div v-show="stage === 'preview'">
        <div class="preview-summary">
          <div class="summary-row">
            <el-icon class="file-icon"><Document /></el-icon>
            <span class="filename" :title="preview.filename">{{ preview.filename }}</span>
            <el-tag size="small">共 {{ preview.total_count }} 条</el-tag>
            <el-tag size="small" type="success">新建 {{ selectableNewCount }}</el-tag>
            <el-tag size="small" type="info">已存在 {{ preview.existed_count }}</el-tag>
            <el-tag size="small" type="warning" v-if="preview.in_file_duplicate_count">文件内重复 {{ preview.in_file_duplicate_count }}</el-tag>
            <el-tag size="small" type="danger" v-if="preview.invalid_count">地址不合法 {{ preview.invalid_count }}</el-tag>
          </div>

          <div v-if="preview.new_categories.length" class="summary-row cats">
            <span class="summary-label">将新建分类：</span>
            <el-tag v-for="c in preview.new_categories" :key="c" type="success" size="small" effect="plain" class="cat-tag">
              <el-icon><FolderAdd /></el-icon>&nbsp;{{ c }}
            </el-tag>
          </div>

          <el-alert
            v-if="preview.same_file_report"
            type="warning"
            show-icon
            :closable="false"
            class="dup-alert"
            :title="`这个文件之前导入过（${formatTime(preview.same_file_report.created_at)}）`"
          >
            <template #default>
              <div>
                相同内容文件已存在一份导入记录，状态：{{ statusText(preview.same_file_report.status) }}。
                你仍然可以继续导入；对已存在的链接可逐条选择"跳过"或"替换"。
                <el-button link type="primary" @click="openReport(preview.same_file_report.id)">查看上次明细</el-button>
              </div>
            </template>
          </el-alert>
          <el-alert
            v-else-if="preview.same_name_report"
            type="info"
            show-icon
            :closable="false"
            class="dup-alert"
            :title="`检测到同名文件「${preview.filename}」`"
          >
            <template #default>
              <div>
                你之前导入过同名文件（内容不同，{{ formatTime(preview.same_name_report.created_at) }}，状态：{{ statusText(preview.same_name_report.status) }}），本次会作为一次新的导入保留明细。
                <el-button link type="primary" @click="openReport(preview.same_name_report.id)">查看历史明细</el-button>
              </div>
            </template>
          </el-alert>
        </div>

        <div class="preview-toolbar">
          <el-radio-group v-model="filter" size="small">
            <el-radio-button label="all">全部 ({{ preview.total_count }})</el-radio-button>
            <el-radio-button label="new">可导入 ({{ preview.valid_count - preview.existed_count }})</el-radio-button>
            <el-radio-button label="existed">已存在 ({{ preview.existed_count }})</el-radio-button>
            <el-radio-button label="invalid">不合法 ({{ preview.invalid_count }})</el-radio-button>
            <el-radio-button label="dupfile" v-if="preview.in_file_duplicate_count">文件内重复 ({{ preview.in_file_duplicate_count }})</el-radio-button>
          </el-radio-group>
          <div class="toolbar-right">
            <el-button size="small" @click="selectAllFiltered" :disabled="!filteredSelectable.length">全选当前</el-button>
            <el-button size="small" @click="clearAllFiltered" :disabled="!selectedOrdinals.size">清空选择</el-button>
            <el-radio-group
              v-model="bulkAction"
              size="small"
              @change="applyBulkAction"
              class="bulk-action"
            >
              <span class="summary-label">已存在项：</span>
              <el-radio-button label="skip">全部跳过</el-radio-button>
              <el-radio-button label="replace">全部替换</el-radio-button>
            </el-radio-group>
          </div>
        </div>

        <el-table
          :data="pagedRows"
          size="small"
          height="420"
          class="preview-table"
          :row-key="(row) => row.ordinal"
          ref="previewTableRef"
        >
          <el-table-column width="46" align="center">
            <template #header>
              <el-checkbox
                :model-value="pageAllSelected"
                :indeterminate="pageSomeSelected"
                @change="togglePageSelection"
                :disabled="!filteredSelectableOnPage.length"
              />
            </template>
            <template #default="{ row }">
              <el-checkbox
                :model-value="selectedOrdinals.has(row.ordinal)"
                :disabled="!isSelectable(row)"
                @change="(v) => toggleRow(row, v)"
              />
            </template>
          </el-table-column>
          <el-table-column label="标题 / 地址" min-width="260">
            <template #default="{ row }">
              <div class="cell-title" :title="row.title">{{ row.title || '(无标题)' }}</div>
              <a class="cell-url" :href="row.url" target="_blank" rel="noopener" :title="row.url">{{ row.url }}</a>
              <div v-if="!row.valid" class="cell-invalid">地址不合法：{{ row.invalid_reason }}</div>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="150">
            <template #default="{ row }">
              <el-tag v-if="row.category_name" size="small" :type="row.category_action === 'new' ? 'success' : 'info'" effect="plain">
                {{ row.category_name }}
              </el-tag>
              <span v-else class="muted">未分类</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="{ row }">
              <el-tag v-if="!row.valid" type="danger" size="small">地址不合法</el-tag>
              <el-tag v-else-if="row.in_file_duplicate" type="warning" size="small">文件内重复</el-tag>
              <el-tag v-else-if="row.existed" type="info" size="small">库中已存在</el-tag>
              <el-tag v-else type="success" size="small">将新建</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="重复处理" width="140">
            <template #default="{ row }">
              <el-select
                v-if="row.existed && selectedOrdinals.has(row.ordinal)"
                v-model="row.duplicate_action"
                size="small"
                style="width: 120px"
              >
                <el-option label="跳过" value="skip" />
                <el-option label="替换" value="replace" />
              </el-select>
              <span v-else-if="row.existed" class="muted">未勾选 / {{ row.duplicate_action === 'replace' ? '替换' : '跳过' }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          class="preview-pager"
          background
          layout="total, prev, pager, next"
          :total="filteredRows.length"
          :page-size="pageSize"
          :current-page="page"
          @current-change="(p) => (page = p)"
          small
        />

        <div v-if="commitNote" class="commit-note">
          <el-alert :title="commitNote" :type="commitNoteType" show-icon :closable="false" />
        </div>

        <div class="preview-actions">
          <el-button @click="backToUpload">重新选择文件</el-button>
          <div class="spacer" />
          <span class="selected-hint">
            已选择 <b>{{ selectedOrdinals.size }}</b> 条
            <template v-if="selectedReplaceCount">，其中 <b>{{ selectedReplaceCount }}</b> 条将替换已有链接</template>
          </span>
          <el-button type="primary" :disabled="!selectedOrdinals.size" :loading="committing" @click="handleCommit">
            导入选中的 {{ selectedOrdinals.size }} 条
          </el-button>
          <el-button v-if="committing" type="danger" plain @click="handleCancelCommit">取消导入</el-button>
        </div>
      </div>

      <!-- ============ STEP 3: 导入明细 ============ -->
      <div v-show="stage === 'report' && report">
        <div class="report-header">
          <el-result
            :icon="reportIcon"
            :title="reportTitle"
            :sub-title="`文件：${report.filename}`"
          />
          <el-alert
            v-if="report.status === 'cancelled'"
            type="warning"
            show-icon
            :closable="false"
            class="status-alert"
            :title="report.cancel_reason || '导入在处理过程中被取消'"
          />
          <el-alert
            v-else-if="report.status === 'failed'"
            type="error"
            show-icon
            :closable="false"
            class="status-alert"
            :title="report.cancel_reason || '导入失败'"
          />
        </div>

        <el-descriptions :column="4" border size="small" class="report-stats">
          <el-descriptions-item label="明细总条数">{{ report.total_count }}</el-descriptions-item>
          <el-descriptions-item label="新建">
            <span class="stat-created">{{ report.created_count }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="替换已存在">{{ report.replaced_count }}</el-descriptions-item>
          <el-descriptions-item label="跳过（含未选/取消）">{{ report.skipped_count }}</el-descriptions-item>
          <el-descriptions-item label="处理失败" v-if="report.failed_count">
            <span class="stat-failed">{{ report.failed_count }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="完成时间">{{ formatTime(report.finished_at) }}</el-descriptions-item>
          <el-descriptions-item label="服务端链接库总数" :span="2">
            <b>{{ report.links_total }}</b>
            <el-tag v-if="countMatches" type="success" size="small" class="match-tag">与链接库列表数量一致</el-tag>
            <el-tag v-else type="danger" size="small" class="match-tag">数量对不上，请刷新核对</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-table :data="report.items" size="small" height="430" class="report-table">
          <el-table-column label="#" type="index" width="46" />
          <el-table-column label="标题 / 地址" min-width="240">
            <template #default="{ row }">
              <div class="cell-title">{{ row.title || '(无标题)' }}</div>
              <a v-if="row.url" class="cell-url" :href="row.url" target="_blank" rel="noopener">{{ row.url }}</a>
              <div v-if="row.invalid_reason" class="cell-invalid">{{ row.invalid_reason }}</div>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="130">
            <template #default="{ row }">
              <el-tag v-if="row.category_name" size="small" :type="row.category_action === 'new' ? 'success' : 'info'" effect="plain">
                {{ row.category_name }}
              </el-tag>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="110">
            <template #default="{ row }">
              <el-tag :type="resultTagType(row.result)" size="small">{{ resultText(row.result) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="200">
            <template #default="{ row }">
              <span class="muted">{{ row.reason || '—' }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="report-actions">
          <el-button @click="backToUpload">继续导入其他文件</el-button>
          <el-button @click="loadHistory">刷新明细</el-button>
          <div class="spacer" />
          <el-button @click="goHome">返回链接库</el-button>
          <el-button type="primary" @click="goHome">在链接库中查看（{{ report.links_total }} 条）</el-button>
        </div>
      </div>
    </el-card>

    <!-- ============ 历史导入记录 ============ -->
    <el-card class="history-card" v-if="history.length">
      <template #header>
        <div class="card-header">
          <h3>历史导入明细（保存在服务端，刷新页面不会丢失）</h3>
          <el-button text @click="loadHistory"><el-icon><Refresh /></el-icon>刷新</el-button>
        </div>
      </template>
      <el-table :data="history" size="small">
        <el-table-column label="文件名" min-width="200" prop="filename" />
        <el-table-column label="导入时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="resultTagType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="新建" width="70" prop="created_count" />
        <el-table-column label="替换" width="70" prop="replaced_count" />
        <el-table-column label="跳过" width="70" prop="skipped_count" />
        <el-table-column label="库总数" width="90" prop="links_total" />
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openReport(row.id)">查看明细</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, shallowRef, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowLeft, UploadFilled, Document, FolderAdd, Refresh,
} from '@element-plus/icons-vue'
import { importApi, linksApi } from '../api'

const route = useRoute()
const router = useRouter()

const stage = ref('upload') // upload | preview | report
const selectedFile = shallowRef(null)
const preview = ref(null)
const previewError = ref('')
const previewErrorDetail = ref('')
const committing = ref(false)
const report = ref(null)
const history = ref([])
const linksListTotal = ref(null)
const commitNote = ref('')
const commitNoteType = ref('info')
const filter = ref('all')
const page = ref(1)
const pageSize = 10
const bulkAction = ref('skip')
const previewTableRef = ref(null)
let abortController = null

const LAST_REPORT_KEY = 'lastImportReportId'

const selectedOrdinals = computed(() => {
  const s = new Set()
  if (!preview.value) return s
  for (const row of preview.value.rows) {
    if (row.selected) s.add(row.ordinal)
  }
  return s
})

const selectableNewCount = computed(() => {
  if (!preview.value) return 0
  return preview.value.rows.filter((r) => r.valid && !r.existed && !r.in_file_duplicate).length
})

const filteredRows = computed(() => {
  if (!preview.value) return []
  switch (filter.value) {
    case 'new':
      return preview.value.rows.filter((r) => r.valid && !r.existed)
    case 'existed':
      return preview.value.rows.filter((r) => r.existed)
    case 'invalid':
      return preview.value.rows.filter((r) => !r.valid)
    case 'dupfile':
      return preview.value.rows.filter((r) => r.in_file_duplicate)
    default:
      return preview.value.rows
  }
})

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredRows.value.slice(start, start + pageSize)
})

function isSelectable(row) {
  return row.valid
}

const filteredSelectable = computed(() => filteredRows.value.filter(isSelectable))
const filteredSelectableOnPage = computed(() => pagedRows.value.filter(isSelectable))

const pageAllSelected = computed(() =>
  filteredSelectableOnPage.value.length > 0 &&
  filteredSelectableOnPage.value.every((r) => selectedOrdinals.value.has(r.ordinal))
)
const pageSomeSelected = computed(() => {
  const n = filteredSelectableOnPage.value.filter((r) => selectedOrdinals.value.has(r.ordinal)).length
  return n > 0 && n < filteredSelectableOnPage.value.length
})

const selectedReplaceCount = computed(() => {
  if (!preview.value) return 0
  return preview.value.rows.filter((r) => r.selected && r.existed && r.duplicate_action === 'replace').length
})

const countMatches = computed(() => {
  if (!report.value || linksListTotal.value == null) return true
  return report.value.links_total === linksListTotal.value
})

const reportIcon = computed(() => {
  if (!report.value) return 'info'
  if (report.value.status === 'completed') return report.value.created_count + report.value.replaced_count > 0 ? 'success' : 'warning'
  if (report.value.status === 'cancelled') return 'warning'
  return 'error'
})
const reportTitle = computed(() => {
  if (!report.value) return ''
  if (report.value.status === 'cancelled') return '导入已取消（已写入的条目已保留，未回退）'
  if (report.value.status === 'failed') return '导入失败'
  return `导入完成：新建 ${report.value.created_count} 条，替换 ${report.value.replaced_count} 条`
})

async function handleFileChange(file) {
  selectedFile.value = file.raw
  previewError.value = ''
  previewErrorDetail.value = ''
  try {
    const { data } = await importApi.previewBookmarks(file.raw)
    data.rows.forEach((r) => {
      r.selected = !!r.selected
      r.duplicate_action = r.duplicate_action || 'skip'
    })
    preview.value = data
    filter.value = 'all'
    page.value = 1
    stage.value = 'preview'
  } catch (err) {
    const code = err.response?.data?.code
    previewError.value = err.response?.data?.error || '解析失败'
    previewErrorDetail.value = code === 'PARSE_ERROR'
      ? '停留在选择文件这一步，尚未向链接库写入任何内容。'
      : ''
    stage.value = 'upload'
  }
}

function toggleRow(row, checked) {
  row.selected = !!checked
}

function togglePageSelection(checked) {
  for (const row of filteredSelectableOnPage.value) row.selected = !!checked
}

function selectAllFiltered() {
  filteredSelectable.value.forEach((r) => { r.selected = true })
}
function clearAllFiltered() {
  preview.value.rows.forEach((r) => { r.selected = false })
}

function applyBulkAction(action) {
  preview.value.rows.forEach((r) => {
    if (r.existed) r.duplicate_action = action
  })
}

function backToUpload() {
  stage.value = 'upload'
  preview.value = null
  report.value = null
  selectedFile.value = null
  commitNote.value = ''
}

async function handleCommit() {
  if (!preview.value || !selectedFile.value) return
  commitNote.value = ''
  committing.value = true
  abortController = new AbortController()

  const content = await selectedFile.value.text()
  const payload = {
    filename: preview.value.filename,
    file_size: preview.value.file_size,
    content_hash: preview.value.content_hash,
    content,
    default_duplicate_action: bulkAction.value,
    items: preview.value.rows.map((r) => ({
      ordinal: r.ordinal,
      url: r.url,
      title: r.title,
      folder: r.folder,
      full_path: r.full_path,
      valid: r.valid,
      invalid_reason: r.invalid_reason,
      in_file_duplicate: r.in_file_duplicate,
      category_name: r.category_name,
      category_action: r.category_action,
      selected: r.selected,
      duplicate_action: r.duplicate_action,
    })),
  }

  try {
    const { data } = await importApi.commitImport(payload, abortController.signal)
    await showReport(data, true)
  } catch (err) {
    if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError') {
      // Server finalizes a 'cancelled' report; the client doesn't know its id in this path,
      // so look up the most recent report for this file.
      commitNoteType.value = 'warning'
      commitNote.value = '已向服务器发送取消请求：正在同步已处理的明细，已写入条目不会回退…'
      await new Promise((r) => setTimeout(r, 400))
      const found = await waitForLatestReport(preview.value.filename, ['cancelled', 'completed', 'failed'])
      if (found) {
        await showReport(found, true)
      } else {
        commitNote.value = '已取消，但暂时取不到服务端明细，请稍后在下方历史记录中查看（已写入条目不会回退）。'
      }
    } else if (err.response?.data?.report_id) {
      const { data } = await importApi.getReport(err.response.data.report_id)
      await showReport(data, true)
    } else {
      commitNoteType.value = 'error'
      commitNote.value = err.response?.data?.error || '导入请求失败，已处理的条目已在服务端保留，可在历史明细中查看。'
      loadHistory()
    }
  } finally {
    committing.value = false
    abortController = null
  }
}

function handleCancelCommit() {
  if (abortController) abortController.abort()
  ElMessage.warning('正在取消…服务器会处理完当前条目后停止，已写入的不回退')
}

async function waitForLatestReport(filename, statuses, tries = 6) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const { data } = await importApi.getReports()
    const match = data.find((d) => d.filename === filename && statuses.includes(d.status))
    if (match) {
      const { data: detail } = await importApi.getReport(match.id)
      return detail
    }
  }
  return null
}

async function showReport(data, saveLast) {
  report.value = data
  stage.value = 'report'
  commitNote.value = ''
  if (saveLast) localStorage.setItem(LAST_REPORT_KEY, String(data.id))
  // Cross-check against the count the link-library list endpoint returns.
  try {
    const { data: listData } = await linksApi.getLinks({ page: 1, limit: 1 })
    linksListTotal.value = listData.total
  } catch {
    linksListTotal.value = null
  }
  loadHistory()
}

async function openReport(id) {
  try {
    const { data } = await importApi.getReport(id)
    await showReport(data, false)
    router.replace({ query: { report: id } })
  } catch {
    ElMessage.error('明细不存在或已被删除')
  }
}

async function loadHistory() {
  try {
    const { data } = await importApi.getReports()
    history.value = data
  } catch {
    history.value = []
  }
}

function goHome() {
  router.push('/')
}

function formatTime(t) {
  if (!t) return '—'
  const d = new Date(t.includes('T') ? t : t.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return t
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function resultText(r) {
  return ({ created: '新建', replaced: '替换', skipped: '跳过', failed: '失败',
    completed: '完成', cancelled: '已取消', processing: '处理中', pending: '待处理' })[r] || r
}
function resultTagType(r) {
  return ({ created: 'success', replaced: 'primary', skipped: 'info', failed: 'danger',
    completed: 'success', cancelled: 'warning', processing: 'warning', pending: 'info' })[r] || 'info'
}
function statusText(s) {
  return resultText(s)
}

onMounted(async () => {
  await loadHistory()
  const reportId = route.query.report || localStorage.getItem(LAST_REPORT_KEY)
  if (reportId) {
    try {
      const { data } = await importApi.getReport(reportId)
      showReport(data, false)
    } catch {
      localStorage.removeItem(LAST_REPORT_KEY)
    }
  }
})
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

.card-header h2,
.card-header h3 {
  margin: 0;
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

.flow-hint {
  margin: 10px 0 0;
  color: #409eff;
  font-size: 13px;
}

.upload-area {
  margin-bottom: 16px;
}

.preview-error {
  margin-top: 16px;
}

.error-detail {
  margin-top: 4px;
  font-size: 13px;
}

.preview-summary {
  margin-bottom: 12px;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.filename {
  font-weight: 600;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-icon {
  font-size: 18px;
  color: #409eff;
}

.summary-label {
  font-size: 13px;
  color: #606266;
}

.cat-tag {
  display: inline-flex;
  align-items: center;
}

.dup-alert {
  margin-top: 10px;
}

.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.bulk-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.preview-table,
.report-table {
  width: 100%;
}

.cell-title {
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-url {
  font-size: 12px;
  color: #909399;
  word-break: break-all;
}

.cell-invalid {
  color: #f56c6c;
  font-size: 12px;
  margin-top: 2px;
}

.muted {
  color: #a8abb2;
  font-size: 12px;
}

.preview-pager {
  margin: 12px 0;
  display: flex;
  justify-content: flex-end;
}

.preview-actions,
.report-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}

.spacer {
  flex: 1;
}

.selected-hint {
  color: #606266;
  font-size: 14px;
}

.commit-note {
  margin-top: 12px;
}

.status-alert {
  margin-bottom: 16px;
}

.report-stats {
  margin-bottom: 16px;
}

.stat-created {
  color: #67c23a;
  font-weight: 600;
}

.stat-failed {
  color: #f56c6c;
  font-weight: 600;
}

.match-tag {
  margin-left: 8px;
}

.history-card {
  margin-top: 20px;
}
</style>
