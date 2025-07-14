// app/components/TimelineControl.vue

<script setup lang="ts">
import { useTimelineStore } from '~/composables/timeline'

// 直接使用 store
const timelineStore = useTimelineStore()
</script>

<template>
  <div
    class="text-white p-3 rounded-lg bg-dark-800/70 flex gap-4 pointer-events-auto shadow-lg items-center bottom-8 left-1/2 justify-center absolute backdrop-blur-1 -translate-x-1/2"
  >
    <!-- 播放/暂停按钮 -->
    <button
      class="icon-btn !text-3xl"
      :disabled="timelineStore.isFirstTimestamp && timelineStore.isLastTimestamp"
      @click="timelineStore.togglePlay"
    >
      <div :class="timelineStore.isPlaying ? 'i-carbon-pause-filled' : 'i-carbon-play-filled-alt'" />
    </button>

    <!-- 日期和时间选择器 -->
    <div class="text-center flex gap-4 items-center">
      <!-- 日期调整 -->
      <div class="flex flex-col w-32 items-center">
        <button class="icon-btn" :disabled="timelineStore.isPlaying || !timelineStore.hasNextDay" title="后一天" @click="timelineStore.nextDay">
          <div i-carbon-chevron-up />
        </button>
        <div class="text-lg font-mono tabular-nums">
          {{ timelineStore.formattedDate }}
        </div>
        <button class="icon-btn" :disabled="timelineStore.isPlaying || !timelineStore.hasPrevDay" title="前一天" @click="timelineStore.prevDay">
          <div i-carbon-chevron-down />
        </button>
      </div>
      <!-- 时间调整 -->
      <div class="flex flex-col w-20 items-center">
        <button class="icon-btn" :disabled="timelineStore.isPlaying || timelineStore.isLastTimestamp" title="下一个时间点" @click="timelineStore.nextTimestamp">
          <div i-carbon-chevron-up />
        </button>
        <div class="text-xl font-mono tabular-nums">
          {{ timelineStore.formattedTime }}
        </div>
        <button class="icon-btn" :disabled="timelineStore.isPlaying || timelineStore.isFirstTimestamp" title="上一个时间点" @click="timelineStore.prevTimestamp">
          <div i-carbon-chevron-down />
        </button>
      </div>
    </div>

    <!-- 跳转到最新时间点按钮 -->
    <button
      class="icon-btn !text-xl"
      title="跳转到最新"
      :disabled="timelineStore.isLastTimestamp || timelineStore.isPlaying"
      @click="timelineStore.goToLatest"
    >
      <div i-carbon-skip-forward-filled />
    </button>
  </div>
</template>
