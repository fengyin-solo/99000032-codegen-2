<template>
  <el-table :data="reports" v-loading="loading" border size="small" empty-text="暂无导入记录">
    <el-table-column label="文件名" prop="filename" min-width="180" show-overflow-tooltip />
    <el-table-column label="状态" width="110">
      <template #default="{ row }">
        <el-tag :type="statusMeta(row.status).type" size="small">{{ statusMeta(row.status).label }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="结果" min-width="220">
      <template #default="{ row }">
        <template v-if="row.status === 'committed' || row.status === 'superseded'">
          <el-tag size="small" type="success">新建 {{ row.imported_count }}</el-tag>
          <el-tag v-if="row.replaced_count > 0" size="small" type="primary">替换 {{ row.replaced_count }}</el-tag>
          <el-tag size="small" type="info">跳过 {{ row.skipped_count }}</el-tag>
          <el-tag v-if="row.failed_count > 0" size="small" type="danger">失败 {{ row.failed_count }}</el-tag>
        </template>
        <span v-else class="preview-note">
          已解析 {{ row.total_parsed }} 条（{{ row.existing_count }} 已存在 / {{ row.invalid_count }} 不合法）
        </span>
      </template>
    </el-table-column>
    <el-table-column label="时间" width="160">
      <template #default="{ row }">
        {{ formatTime(row.committed_at || row.created_at) }}
      </template>
    </el-table-column>
    <el-table-column label="操作" width="130" align="center">
      <template #default="{ row }">
        <el-button link type="primary" size="small" @click="$emit('open', row.id)">
          {{ row.status === 'preview' ? '继续导入' : '查看明细' }}
        </el-button>
        <el-popconfirm
          title="仅删除这份明细记录，已导入的链接不受影响。确定删除？"
          @confirm="$emit('delete', row.id)"
        >
          <template #reference>
            <el-button link type="danger" size="small">删除</el-button>
          </template>
        </el-popconfirm>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup>
defineProps({
  reports: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

defineEmits(['open', 'delete'])

function statusMeta(status) {
  return {
    preview: { type: 'warning', label: '仅预览' },
    committed: { type: 'success', label: '已导入' },
    superseded: { type: 'info', label: '被替换' },
  }[status] || { type: 'info', label: status }
}

function formatTime(value) {
  if (!value) return '-'
  const d = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'))
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}
</script>

<style scoped>
.preview-note {
  font-size: 12px;
  color: #909399;
}
</style>
