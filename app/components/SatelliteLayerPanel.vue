<script setup lang="ts">
import { useTimelineStore } from '~/composables/timeline'
import { SATELLITES } from '~/constants/map'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)
</script>

<template>
  <div class="pointer-events-auto right-4 top-16 absolute">
    <!-- 卫星云图触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="卫星云图"
      @click="isPanelOpen = !isPanelOpen"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-cloud'" />
    </button>

    <!-- 卫星云图面板 -->
    <Transition
      enter-from-class="opacity-0 translate-x-4"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 translate-x-4"
      enter-active-class="transition-all duration-200 ease-out"
    >
      <div
        v-if="isPanelOpen"
        class="text-white p-4 rounded-lg bg-dark-800/80 w-64 shadow-lg right-12 top-0 absolute backdrop-blur-sm"
      >
        <div class="space-y-4">
          <div>
            <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
              卫星云图
            </h3>
            <!-- 总开关 -->
            <div class="flex items-center justify-between">
              <label class="text-sm">显示卫星云图</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showSatelliteCloud ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showSatelliteCloud = !timelineStore.showSatelliteCloud"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showSatelliteCloud }"
                />
              </button>
            </div>
            <!-- 各卫星开关 -->
            <div
              v-for="sat in SATELLITES"
              :key="sat.id"
              class="mt-3 flex items-center justify-between"
            >
              <label class="text-sm">{{ sat.name }}</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.satelliteVisibility[sat.id] ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.satelliteVisibility[sat.id] = !timelineStore.satelliteVisibility[sat.id]"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.satelliteVisibility[sat.id] }"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
