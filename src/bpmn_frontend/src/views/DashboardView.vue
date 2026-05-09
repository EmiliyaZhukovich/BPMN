<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <div class="header-inner">
        <div class="brand">
          <v-icon icon="mdi-chart-timeline-variant" color="primary" size="36" class="mr-3" />
          <div>
            <h1 class="title">BPMN Assistant</h1>
            <p class="subtitle">Сохранённые диаграммы хранятся в браузере на этом устройстве</p>
          </div>
        </div>
        <v-btn color="primary" size="large" prepend-icon="mdi-plus" @click="createDiagram">
          Создать диаграмму
        </v-btn>
      </div>
    </header>

    <main class="dashboard-main">
      <v-card v-if="items.length === 0" class="empty-card" variant="outlined">
        <v-card-text class="empty-text">
          <v-icon icon="mdi-folder-open-outline" size="48" color="grey" class="mb-4" />
          <p class="mb-2">Пока нет сохранённых диаграмм</p>
          <p class="hint">Нажмите «Создать диаграмму», соберите процесс и сохраните его в редакторе</p>
        </v-card-text>
      </v-card>

      <div v-else class="grid">
        <v-card
          v-for="item in items"
          :key="item.id"
          class="diagram-card"
          variant="outlined"
          @click="openDiagram(item.id)"
        >
          <v-card-title class="card-title-row">
            <span class="card-name text-truncate">{{ item.name }}</span>
            <v-btn
              icon="mdi-delete-outline"
              variant="text"
              size="small"
              color="error"
              class="shrink-0"
              @click.stop="confirmDelete(item)"
            />
          </v-card-title>
          <v-card-subtitle>
            Изменено: {{ formatDate(item.updatedAt) }}
          </v-card-subtitle>
          <v-card-actions>
            <v-btn color="primary" variant="text" size="small" @click.stop="openDiagram(item.id)">
              Открыть
            </v-btn>
          </v-card-actions>
        </v-card>
      </div>
    </main>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card v-if="toDelete">
        <v-card-title>Удалить диаграмму?</v-card-title>
        <v-card-text>«{{ toDelete.name }}» будет удалена без возможности восстановления.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Отмена</v-btn>
          <v-btn color="error" variant="elevated" @click="doDelete">Удалить</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { listSavedDiagramsMeta, deleteSavedDiagram } from '../utils/diagramStorage';

export default {
  name: 'DashboardView',
  data() {
    return {
      items: [],
      deleteDialog: false,
      toDelete: null,
    };
  },
  mounted() {
    this.refreshList();
  },
  methods: {
    refreshList() {
      this.items = listSavedDiagramsMeta();
    },
    createDiagram() {
      const id = crypto.randomUUID();
      this.$router.push({ name: 'editor', params: { id } });
    },
    openDiagram(id) {
      this.$router.push({ name: 'editor', params: { id } });
    },
    formatDate(ts) {
      if (!ts) return '—';
      try {
        return new Intl.DateTimeFormat('ru-RU', {
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(ts));
      } catch {
        return String(ts);
      }
    },
    confirmDelete(item) {
      this.toDelete = item;
      this.deleteDialog = true;
    },
    doDelete() {
      if (this.toDelete?.id) {
        deleteSavedDiagram(this.toDelete.id);
        this.refreshList();
      }
      this.deleteDialog = false;
      this.toDelete = null;
    },
  },
};
</script>

<style scoped>
.dashboard {
  min-height: 100vh;
  background: #f5f5f5;
}

.dashboard-header {
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  padding: 20px 24px;
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  min-width: 0;
}

.title {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  color: #212121;
}

.subtitle {
  margin: 4px 0 0 0;
  font-size: 0.875rem;
  color: #757575;
}

.dashboard-main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px;
}

.empty-card {
  max-width: 480px;
  margin: 48px auto;
}

.empty-text {
  text-align: center;
  padding: 32px 24px !important;
  color: #616161;
}

.hint {
  font-size: 0.875rem;
  color: #9e9e9e;
  margin: 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.diagram-card {
  cursor: pointer;
  transition: box-shadow 0.2s;
}

.diagram-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px !important;
}

.card-name {
  min-width: 0;
  font-size: 1rem !important;
  font-weight: 600;
}
</style>
