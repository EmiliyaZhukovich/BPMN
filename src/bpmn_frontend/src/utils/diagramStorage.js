/**
 * Локальное хранение сохранённых диаграмм (конструктор + XML превью).
 */

const STORAGE_KEY = 'bpmn-assistant-saved-diagrams';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('diagramStorage: write failed', e);
    throw e;
  }
}

/**
 * @returns {Array<{ id: string, name: string, updatedAt: number, createdAt: number, diagramBuilt?: boolean }>}
 */
export function listSavedDiagramsMeta() {
  return readAll()
    .map((r) => ({
      id: r.id,
      name: r.name || 'Без названия',
      updatedAt: r.updatedAt || 0,
      createdAt: r.createdAt || r.updatedAt || 0,
      diagramBuilt: !!r.diagramBuilt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSavedDiagram(id) {
  if (!id) return null;
  const list = readAll();
  return list.find((d) => d.id === id) || null;
}

/**
 * @param {{ id: string, name: string, diagram: object, bpmnXml?: string, diagramBuilt?: boolean }} payload
 */
export function upsertSavedDiagram(payload) {
  const list = readAll();
  const now = Date.now();
  const id = payload.id;
  const idx = list.findIndex((d) => d.id === id);
  const prev = idx >= 0 ? list[idx] : null;
  const rec = {
    id,
    name: (payload.name && String(payload.name).trim()) || 'Диаграмма',
    diagram: payload.diagram,
    bpmnXml: payload.bpmnXml != null ? String(payload.bpmnXml) : '',
    diagramBuilt: !!payload.diagramBuilt,
    updatedAt: now,
    createdAt: prev?.createdAt ?? now,
  };
  if (idx >= 0) list[idx] = rec;
  else list.push(rec);
  writeAll(list);
  return rec;
}

export function deleteSavedDiagram(id) {
  if (!id) return;
  const list = readAll().filter((d) => d.id !== id);
  writeAll(list);
}
