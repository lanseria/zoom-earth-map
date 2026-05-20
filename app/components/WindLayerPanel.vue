<script setup lang="ts">
import { useTimelineStore, WIND_LEVELS } from '~/composables/timeline'

const timelineStore = useTimelineStore()
const isPanelOpen = ref(false)

function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
  if (isPanelOpen.value)
    timelineStore.fetchWindManifests()
}
</script>

<template>
  <div class="pointer-events-auto right-4 top-40 absolute">
    <!-- 风力图层触发按钮 -->
    <button
      class="icon-btn rounded-full bg-dark-800/70 flex h-10 w-10 items-center justify-center backdrop-blur-sm !text-2xl"
      title="风力图层"
      @click="togglePanel"
    >
      <div :class="isPanelOpen ? 'i-carbon-close' : 'i-carbon-windy'" />
    </button>

    <!-- 风力图层面板 -->
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
        class="text-white p-4 rounded-lg bg-dark-800/80 w-72 shadow-lg right-12 top-0 absolute backdrop-blur-sm"
      >
        <div class="space-y-3">
          <div>
            <h3 class="text-lg font-semibold mb-2 pb-1 border-b border-gray-500/50">
              风力图层
            </h3>
            <!-- 总开关 -->
            <div class="flex items-center justify-between">
              <label class="text-sm">显示图层</label>
              <button
                class="p-1 rounded-full h-6 w-12 transition-colors duration-300"
                :class="timelineStore.showWind ? 'bg-sky-600' : 'bg-gray-600'"
                @click="timelineStore.showWind = !timelineStore.showWind"
              >
                <span
                  class="rounded-full bg-white h-4 w-4 block shadow transform transition-transform duration-300"
                  :class="{ 'translate-x-6': timelineStore.showWind }"
                />
              </button>
            </div>

            <!-- 等压面单选列表 -->
            <div class="mt-3 space-y-1.5">
              <button
                v-for="level in WIND_LEVELS"
                :key="level.id"
                class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors duration-200 flex items-center justify-between"
                :class="timelineStore.selectedWindLevel === level.id
                  ? 'bg-sky-600 text-white'
                  : 'bg-dark-900/50 hover:bg-gray-600/50 text-gray-300'"
                @click="timelineStore.selectedWindLevel = level.id"
              >
                <span>{{ level.label }}</span>
                <span class="text-xs opacity-70">{{ level.altitude }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
