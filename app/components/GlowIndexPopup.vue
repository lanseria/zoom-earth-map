<script setup lang="ts">
interface GlowIndexData {
  lat: number
  lon: number
  date: string
  event: string
  event_time: string
  data_time: string
  final_score: number
  score_boundary: number
  score_hcc: number
  score_mcc: number
  score_lcc: number
  score_aod550: number
}

const props = defineProps<{
  data: GlowIndexData | null
  error: string | null
}>()

const eventLabel = computed(() =>
  props.data?.event === 'sunrise' ? '日出' : '日落',
)

const scorePercent = computed(() =>
  props.data ? (props.data.final_score * 100).toFixed(1) : '0.0',
)

const scoreColor = computed(() => {
  const s = props.data?.final_score ?? 0
  if (s >= 0.7) return '#f97316'
  if (s >= 0.4) return '#eab308'
  return '#6b7280'
})

const scoreLabel = computed(() => {
  const s = props.data?.final_score ?? 0
  if (s >= 0.7) return '高'
  if (s >= 0.4) return '中'
  return '低'
})

const factors = computed(() => {
  if (!props.data) return []
  return [
    { label: '云边界', score: props.data.score_boundary },
    { label: '高云量', score: props.data.score_hcc },
    { label: '中云量', score: props.data.score_mcc },
    { label: '低云遮挡', score: props.data.score_lcc },
    { label: '大气透明', score: props.data.score_aod550 },
  ]
})

function barColor(score: number) {
  if (score >= 0.7) return '#22c55e'
  if (score >= 0.4) return '#eab308'
  return '#ef4444'
}
</script>

<template>
  <div class="glow-index-content">
    <!-- 加载中 -->
    <div v-if="!data && !error" class="glow-loading">
      查询中...
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="glow-error">
      {{ error }}
    </div>

    <!-- 正常数据 -->
    <template v-else-if="data">
      <div class="glow-header">
        🔥 {{ eventLabel }}火烧云指数
      </div>

      <div class="glow-score-row">
        <span class="glow-score-value" :style="{ color: scoreColor }">{{ scorePercent }}</span>
        <span class="glow-score-label" :style="{ color: scoreColor }">{{ scoreLabel }}</span>
      </div>

      <div class="glow-time">
        {{ data.event_time }} · 数据时间 {{ data.data_time }}
      </div>

      <div class="glow-factors">
        <template v-for="f in factors" :key="f.label">
          <span class="glow-factor-label">{{ f.label }}</span>
          <div class="glow-bar-track">
            <div
              class="glow-bar-fill"
              :style="{ width: `${(f.score * 100).toFixed(0)}%`, background: barColor(f.score) }"
            />
          </div>
          <span class="glow-factor-pct">{{ (f.score * 100).toFixed(0) }}%</span>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.glow-index-content {
  font-family: system-ui, sans-serif;
  color: #e5e5e5;
  font-size: 13px;
  line-height: 1.6;
  min-width: 220px;
  padding: 10px 12px;
}

.glow-loading {
  color: #999;
}

.glow-error {
  color: #f87171;
}

.glow-header {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid #444;
}

.glow-score-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.glow-score-value {
  font-size: 28px;
  font-weight: 700;
}

.glow-score-label {
  font-size: 13px;
}

.glow-time {
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
}

.glow-factors {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 4px 8px;
  align-items: center;
  font-size: 12px;
}

.glow-factor-label {
  white-space: nowrap;
}

.glow-bar-track {
  background: #333;
  border-radius: 3px;
  height: 8px;
  width: 100%;
  overflow: hidden;
}

.glow-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.glow-factor-pct {
  text-align: right;
  min-width: 32px;
}
</style>
