/**
 * Импорт BPMN 2.0 XML в модель конструктора (пулы, дорожки, дерево элементов).
 * Поддерживаются типичные блок-схемы: последовательность, шлюзы с явной точкой слияния;
 * разветвление без join (ветви до разных конечных событий) — как независимые ветки в одном шлюзе.
 */

import BpmnModdle from 'bpmn-moddle';
import {
  createElement,
  createEmptyDiagram,
  createLane,
  createAssociation,
  createArtifact,
} from './diagramModel.js';
import { isGatewayType } from './bpmnPalette.js';

function getLaneSetArray(process) {
  const ls = process.laneSets;
  if (Array.isArray(ls) && ls.length) return ls;
  if (ls && typeof ls === 'object' && !Array.isArray(ls)) return [ls];
  if (process.laneSet) return [process.laneSet];
  return [];
}

function flattenBpmnLanes(process) {
  return getLaneSetArray(process).flatMap((lset) => (Array.isArray(lset?.lanes) ? lset.lanes : []));
}

/** bpmn-moddle кладёт TextAnnotation и Association в process.artifacts, а не только в flowElements. */
function allProcessDiagramElements(process) {
  const fe = process.flowElements || [];
  const art = process.artifacts || [];
  return [...fe, ...art];
}

function buildNodeIdToLaneIdMap(bpmnLanes) {
  const map = new Map();
  for (const lane of bpmnLanes) {
    const lid = lane.id;
    if (!lid) continue;
    for (const ref of lane.flowNodeRef || []) {
      const rid = refId(ref);
      if (rid) map.set(rid, lid);
    }
  }
  return map;
}

function getParticipantForProcess(definitions, processId) {
  for (const re of definitions.rootElements || []) {
    if (re.$type !== 'bpmn:Collaboration') continue;
    for (const part of re.participants || []) {
      const pid = refId(part.processRef);
      if (pid === processId) {
        return {
          id: part.id,
          name: part.name != null ? String(part.name) : '',
        };
      }
    }
  }
  return null;
}

function collectDataOutputAssociationsFromActivity(fe, seq, flowNodeById, warnings, associationsOut) {
  const raw = fe.dataOutputAssociations || fe.dataOutputAssociation;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const dao of list) {
    const tid = refId(dao.targetRef);
    if (!tid) continue;
    const dataFe = flowNodeById.get(tid);
    if (!dataFe) continue;
    const artType = mapFlowElementType(dataFe.$type);
    if (artType !== 'dataObjectReference' && artType !== 'dataStoreReference') continue;
    const art = makeModelFlowNode(dataFe, warnings);
    if (art) seq.push(art);
    associationsOut.push(createAssociation(fe.id, tid, '', 'none'));
  }
}

function flowNodesInPath(path) {
  return (path || []).filter((n) => n && !ARTIFACT_TYPES.has(n.type));
}

/**
 * Ветка шлюза, переходящая в другую дорожку: префикс остаётся в path, хвост — в elements целевой дорожки,
 * связь через nextElementId (как в конструкторе и при экспорте BPMN).
 */
function splitBranchPathAtLaneBoundary(branch, gatewayLaneId, pool, nodeIdToLaneId) {
  const path = branch.path || [];
  if (!path.length) return;

  let runLane = branch.laneId || gatewayLaneId;
  const flowNodes = flowNodesInPath(path);
  if (flowNodes.length) {
    const firstLane = nodeIdToLaneId.get(flowNodes[0].id);
    if (firstLane && gatewayLaneId && firstLane !== gatewayLaneId && !branch.laneId) {
      branch.laneId = firstLane;
      runLane = firstLane;
    }
  }

  let splitIdx = -1;
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (ARTIFACT_TYPES.has(node.type)) continue;
    const nodeLane = nodeIdToLaneId.get(node.id);
    if (!nodeLane) continue;
    if (nodeLane !== runLane) {
      splitIdx = i;
      break;
    }
  }

  if (splitIdx < 0) return;

  const prefix = path.slice(0, splitIdx);
  const suffix = path.slice(splitIdx);
  branch.path = prefix;

  const prefixFlow = flowNodesInPath(prefix);
  const suffixFlow = flowNodesInPath(suffix);
  if (prefixFlow.length && suffixFlow.length) {
    const last = prefixFlow[prefixFlow.length - 1];
    last.nextElementId = suffixFlow[0].id;
  }

  const targetLaneId = nodeIdToLaneId.get(suffixFlow[0]?.id);
  if (!targetLaneId) return;

  const targetLane = pool.lanes.find((l) => l.id === targetLaneId);
  if (!targetLane) return;
  if (!targetLane.elements) targetLane.elements = [];
  targetLane.elements.push(...suffix);
  distributeCrossLaneInElementList(targetLane.elements, targetLaneId, pool, nodeIdToLaneId);
}

function distributeCrossLaneBranchPaths(pool, nodeIdToLaneId) {
  if (!pool?.lanes?.length) return;
  for (const lane of pool.lanes) {
    distributeCrossLaneInElementList(lane.elements || [], lane.id, pool, nodeIdToLaneId);
  }
}

function distributeCrossLaneInElementList(elements, currentLaneId, pool, nodeIdToLaneId) {
  if (!Array.isArray(elements)) return;
  for (const el of elements) {
    if (!el?.branches) continue;
    for (const branch of el.branches) {
      splitBranchPathAtLaneBoundary(branch, currentLaneId, pool, nodeIdToLaneId);
      distributeCrossLaneInElementList(branch.path || [], currentLaneId, pool, nodeIdToLaneId);
    }
  }
}

const ARTIFACT_TYPES = new Set(['dataObjectReference', 'dataStoreReference', 'textAnnotation']);

const TYPE_MAP = {
  'bpmn:StartEvent': 'startEvent',
  'bpmn:EndEvent': 'endEvent',
  'bpmn:IntermediateCatchEvent': 'intermediateCatchEvent',
  'bpmn:IntermediateThrowEvent': 'intermediateThrowEvent',
  'bpmn:Task': 'task',
  'bpmn:UserTask': 'userTask',
  'bpmn:ServiceTask': 'serviceTask',
  'bpmn:ScriptTask': 'scriptTask',
  'bpmn:BusinessRuleTask': 'businessRuleTask',
  'bpmn:SendTask': 'sendTask',
  'bpmn:ReceiveTask': 'receiveTask',
  'bpmn:ManualTask': 'manualTask',
  'bpmn:SubProcess': 'subProcess',
  'bpmn:CallActivity': 'callActivity',
  'bpmn:ExclusiveGateway': 'exclusiveGateway',
  'bpmn:ParallelGateway': 'parallelGateway',
  'bpmn:InclusiveGateway': 'inclusiveGateway',
  'bpmn:EventBasedGateway': 'eventBasedGateway',
  'bpmn:ComplexGateway': 'complexGateway',
  'bpmn:DataObjectReference': 'dataObjectReference',
  'bpmn:DataStoreReference': 'dataStoreReference',
  'bpmn:TextAnnotation': 'textAnnotation',
};

function refId(ref) {
  if (ref == null) return null;
  if (typeof ref === 'string') return ref;
  return ref.id || null;
}

function mapFlowElementType($type) {
  return TYPE_MAP[$type] || null;
}

function extractEventDefinition(node) {
  const eds = node.eventDefinitions || [];
  for (const ed of eds) {
    if (!ed) continue;
    const t = String(ed.$type || '');
    if (t.includes('Link')) return 'link';
    if (t.includes('Message')) return 'message';
  }
  return null;
}

function makeModelFlowNode(fe, warnings) {
  const localType = mapFlowElementType(fe.$type);
  if (!localType) {
    warnings.push(`Тип «${fe.$type}» (${fe.id}) не поддерживается — пропуск`);
    return null;
  }
  const label = fe.name != null && String(fe.name).trim() !== '' ? String(fe.name) : '';
  const el = createElement(localType, label);
  el.id = fe.id;

  const evDef = extractEventDefinition(fe);
  if (
    evDef &&
    (localType === 'startEvent' ||
      localType === 'intermediateCatchEvent' ||
      localType === 'intermediateThrowEvent')
  ) {
    el.eventDefinition = evDef;
  }

  if (ARTIFACT_TYPES.has(localType) && fe.text != null) {
    el.label = String(fe.text);
  }

  return el;
}

function flowConditionLabel(flow) {
  if (!flow) return '';
  const ce = flow.conditionExpression;
  if (ce && ce.body != null && String(ce.body).trim() !== '') return String(ce.body).trim();
  if (flow.name != null && String(flow.name).trim() !== '') return String(flow.name).trim();
  return '';
}

function isGatewayFe(fe) {
  return fe && isGatewayType(mapFlowElementType(fe.$type));
}

function collectProcesses(definitions) {
  const byId = new Map();
  for (const re of definitions.rootElements || []) {
    if (re.$type === 'bpmn:Process' && re.id) {
      byId.set(re.id, re);
    }
  }
  return Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function buildGraph(process, warnings) {
  const flowElements = process.flowElements || [];
  const artifacts = process.artifacts || [];
  const all = [...flowElements, ...artifacts];

  const flowNodeById = new Map();
  const sequenceFlows = [];

  for (const el of all) {
    if (!el || !el.$type) continue;
    if (el.$type === 'bpmn:SequenceFlow') {
      sequenceFlows.push(el);
      continue;
    }
    if (el.$type === 'bpmn:Association' || el.$type === 'bpmn:Group') {
      continue;
    }
    if (el.id) flowNodeById.set(el.id, el);
  }

  const outMap = new Map();
  const inDegree = new Map();

  function addOut(src, entry) {
    if (!outMap.has(src)) outMap.set(src, []);
    outMap.get(src).push(entry);
  }
  function incIn(tgt) {
    inDegree.set(tgt, (inDegree.get(tgt) || 0) + 1);
  }

  for (const sf of sequenceFlows) {
    const s = refId(sf.sourceRef);
    const t = refId(sf.targetRef);
    if (!s || !t) continue;
    addOut(s, { target: t, flow: sf });
    incIn(t);
  }

  for (const id of flowNodeById.keys()) {
    if (!inDegree.has(id)) inDegree.set(id, 0);
  }

  return { flowNodeById, outMap, inDegree, sequenceFlows };
}

function getOuts(outMap, id) {
  return outMap.get(id) || [];
}

/**
 * В BPMN у шлюза порядок ссылок outgoing задаёт порядок ветвей (как в bpmn-js).
 * outMap наполняется в порядке объявления sequenceFlow в файле — он может быть обратным; выравниваем.
 */
function orderOutsLikeBpmnFlowNode(fe, outs) {
  if (!outs || outs.length < 2 || !fe) return outs;
  const raw = fe.outgoing;
  if (!raw) return outs;
  const list = Array.isArray(raw) ? raw : [raw];
  const flowIds = [];
  for (const ref of list) {
    const fid = refId(ref);
    if (fid) flowIds.push(fid);
  }
  if (flowIds.length < 2) return outs;
  const byFlowId = new Map();
  for (const o of outs) {
    const id = o.flow?.id;
    if (id) byFlowId.set(id, o);
  }
  const seen = new Set();
  const ordered = [];
  for (const fid of flowIds) {
    const o = byFlowId.get(fid);
    if (o) {
      ordered.push(o);
      seen.add(fid);
    }
  }
  for (const o of outs) {
    const id = o.flow?.id;
    if (id && !seen.has(id)) ordered.push(o);
  }
  return ordered.length === outs.length ? ordered : outs;
}

/** Центр Y фигуры по BPMN DI (для порядка ветвей параллельного шлюза). */
function collectShapeCenterYFromDefinitions(definitionsRoot) {
  const map = new Map();
  const diagrams = definitionsRoot?.diagrams;
  if (!Array.isArray(diagrams)) return map;
  for (const dg of diagrams) {
    const plane = dg.plane;
    if (!plane) continue;
    const els = plane.planeElement;
    if (!Array.isArray(els)) continue;
    for (const el of els) {
      if (!el || el.$type !== 'bpmndi:BPMNShape') continue;
      const be = refId(el.bpmnElement);
      const b = el.bounds;
      if (!be || !b || b.y == null || b.height == null) continue;
      const cy = Number(b.y) + Number(b.height) / 2;
      if (Number.isFinite(cy)) map.set(be, cy);
    }
  }
  return map;
}

/**
 * Порядок исходов параллельного шлюза по вертикали цели на диаграмме (верхняя ветка → индекс 0 в модели).
 * Иначе порядок «outgoing» в XML и row в автолейауте расходятся (диагональ от шлюза).
 */
function orderParallelGatewayOutsByTargetShapeY(outs, shapeCenterYByElementId) {
  if (!outs || outs.length < 2 || !shapeCenterYByElementId || shapeCenterYByElementId.size === 0) {
    return outs;
  }
  const scored = outs.map((o) => ({
    o,
    cy: shapeCenterYByElementId.get(o.target),
  }));
  if (scored.some((s) => s.cy == null || !Number.isFinite(s.cy))) return outs;
  scored.sort((a, b) => a.cy - b.cy || String(a.o.target).localeCompare(String(b.o.target)));
  return scored.map((s) => s.o);
}

function walkModdleArraysForCollaboration(node, visit) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) walkModdleArraysForCollaboration(x, visit);
    return;
  }
  if (typeof node === 'object' && node.$type) {
    visit(node);
  }
}

/** Текстовые аннотации и связи с задачами из collaboration (как экспортирует bpmn-js). */
function extractCollaborationArtifactsAndAssociations(definitions, processId) {
  const artifacts = [];
  const assocs = [];
  const seenArtId = new Set();
  const seenAssocId = new Set();

  for (const re of definitions.rootElements || []) {
    if (re.$type !== 'bpmn:Collaboration') continue;
    const participants = re.participants || [];
    if (!participants.some((p) => refId(p.processRef) === processId)) continue;

    const visit = (item) => {
      if (!item || !item.$type) return;
      if (item.$type === 'bpmn:TextAnnotation') {
        const id = item.id;
        if (id && seenArtId.has(id)) return;
        const text = item.text != null ? String(item.text) : '';
        const art = createArtifact('textAnnotation', text);
        if (id) {
          art.id = id;
          seenArtId.add(id);
        }
        artifacts.push(art);
        return;
      }
      if (item.$type === 'bpmn:Association') {
        const id = item.id;
        if (id && seenAssocId.has(id)) return;
        const s = refId(item.sourceRef);
        const t = refId(item.targetRef);
        if (!s || !t) return;
        const a = createAssociation(s, t, '', 'none');
        if (id) {
          a.id = id;
          seenAssocId.add(id);
        }
        assocs.push(a);
      }
    };

    for (const k of Object.keys(re)) {
      if (k === '$type' || k === 'id') continue;
      walkModdleArraysForCollaboration(re[k], visit);
    }
  }

  return { artifacts, associations: assocs };
}

function getSingleSuccessor(outMap, id) {
  const outs = getOuts(outMap, id);
  if (outs.length !== 1) return null;
  return outs[0].target;
}

function isJoinOnly(flowNodeById, outMap, inDegree, id) {
  const fe = flowNodeById.get(id);
  if (!fe || !isGatewayFe(fe)) return false;
  const outs = getOuts(outMap, id);
  const inc = inDegree.get(id) || 0;
  return inc > 1 && outs.length === 1;
}

function shortestPathLen(from, to, outMap, maxHops) {
  if (from === to) return 0;
  const q = [[from, 0]];
  const seen = new Set([from]);
  while (q.length) {
    const [n, d] = q.shift();
    if (d > maxHops) continue;
    for (const { target } of getOuts(outMap, n)) {
      if (target === to) return d + 1;
      if (!seen.has(target)) {
        seen.add(target);
        q.push([target, d + 1]);
      }
    }
  }
  return null;
}

/**
 * Точка слияния веток после шлюза: узел, достижимый со всех исходов шлюза.
 * Учитывает слияние в обычную активность (одна ветка заходит в узел напрямую: длина 0).
 */
function findJoinGateway(splitId, branchTargets, flowNodeById, outMap, maxHops = 4000) {
  if (branchTargets.length < 2) return null;
  const candidates = [];
  for (const id of flowNodeById.keys()) {
    if (id === splitId) continue;
    const lens = branchTargets.map((t) => {
      if (t === id) return 0;
      return shortestPathLen(t, id, outMap, maxHops);
    });
    if (lens.some((l) => l == null)) continue;
    const allReach = lens.every((l, i) => {
      const t = branchTargets[i];
      if (t === id) return l === 0;
      return l > 0;
    });
    if (!allReach) continue;
    const score = Math.max(...lens);
    candidates.push({ id, score });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return candidates[0].id;
}

/** Слияние для параллельного шлюза: общий узел в процессе или граница внешнего фрагмента (как у неявного XOR). */
function findParallelMergePoint(splitId, branchTargets, exitBoundary, flowNodeById, outMap, maxHops = 4000) {
  const inner = findJoinGateway(splitId, branchTargets, flowNodeById, outMap, maxHops);
  if (inner) return inner;
  if (!exitBoundary) return null;
  const lens = branchTargets.map((t) => {
    if (t === exitBoundary) return 0;
    return shortestPathLen(t, exitBoundary, outMap, maxHops);
  });
  if (lens.some((l) => l == null)) return null;
  const allReach = lens.every((l, i) => {
    const t = branchTargets[i];
    if (t === exitBoundary) return l === 0;
    return l > 0;
  });
  return allReach ? exitBoundary : null;
}

/**
 * Точка слияния для неявного разветвления с активности (несколько sequenceFlow без шлюза).
 * Если граф большой — ищем join; во вложенном сегменте допускаем слияние на exitBoundary.
 */
function resolveImplicitSplitJoin(splitId, branchTargets, exitBoundary, flowNodeById, outMap) {
  const j = findJoinGateway(splitId, branchTargets, flowNodeById, outMap);
  if (j) return j;
  if (exitBoundary) {
    const lens = branchTargets.map((t) => {
      if (t === exitBoundary) return 0;
      return shortestPathLen(t, exitBoundary, outMap, 4000);
    });
    if (lens.some((l) => l == null)) return null;
    const allReach = lens.every((l, i) => {
      const t = branchTargets[i];
      if (t === exitBoundary) return l === 0;
      return l > 0;
    });
    if (allReach) return exitBoundary;
  }
  return null;
}

function isSplitGateway(flowNodeById, outMap, id) {
  const fe = flowNodeById.get(id);
  if (!fe || !isGatewayFe(fe)) return false;
  return getOuts(outMap, id).length > 1;
}

function findStartEventId(flowNodeById, inDegree, outMap) {
  const starts = [];
  for (const [id, fe] of flowNodeById) {
    if (fe.$type === 'bpmn:StartEvent') starts.push(id);
  }
  if (starts.length === 1) return starts[0];
  if (starts.length > 1) return starts[0];
  for (const [id] of flowNodeById) {
    const inc = inDegree.get(id) || 0;
    if (inc === 0 && mapFlowElementType(flowNodeById.get(id).$type)) {
      const t = mapFlowElementType(flowNodeById.get(id).$type);
      if (t && !ARTIFACT_TYPES.has(t)) return id;
    }
  }
  return null;
}

function defaultBranchLabels(gatewayFe, count) {
  const isPar = gatewayFe.$type === 'bpmn:ParallelGateway';
  if (isPar) return Array.from({ length: count }, (_, i) => '');
  if (count === 2) return ['Да', 'Нет'];
  return Array.from({ length: count }, (_, i) => `Ветвь ${i + 1}`);
}

function makeGatewayShell(fe, outs, joinId, flowNodeById, outMap, inDegree, warnings, parseSegment) {
  const localType = mapFlowElementType(fe.$type);
  const gw = createElement(localType, fe.name || '');
  gw.id = fe.id;
  const isPar = fe.$type === 'bpmn:ParallelGateway';

  const defaultFlowId = fe.default ? refId(fe.default) : null;
  const labels = defaultBranchLabels(fe, outs.length);

  const branches = [];
  for (let idx = 0; idx < outs.length; idx++) {
    const o = outs[idx];
    const cond = flowConditionLabel(o.flow);
    const sub = parseSegment(o.target, joinId);
    if (!sub.ok) return { ok: false, error: sub.error };
    const path = sub.seq;
    const isDefault = Boolean(defaultFlowId && o.flow.id === defaultFlowId);
    let condition = cond;
    if (!condition && !isPar) condition = labels[idx] || `Ветвь ${idx + 1}`;
    if (!path.length) {
      if (isPar) {
        const stub = createElement('task', '—');
        stub.id = `import_empty_branch_${fe.id}_${idx}_${Date.now()}`;
        branches.push({ condition, path: [stub], isDefault });
      } else {
        branches.push({ condition, path: [], next: joinId, isDefault });
      }
    } else {
      branches.push({ condition, path, isDefault });
    }
  }
  gw.branches = branches;
  return { ok: true, gateway: gw };
}

/** Шлюз-разветвитель без общей точки слияния: каждая исходящая ветка парсится до своего конца. */
function importSplitGatewayWithoutJoin(fe, outs, parseSegment) {
  const localType = mapFlowElementType(fe.$type);
  if (!localType) {
    return { ok: false, error: `Тип шлюза «${fe.$type}» не поддерживается при импорте` };
  }
  const isPar = fe.$type === 'bpmn:ParallelGateway';
  const defaultFlowId = fe.default ? refId(fe.default) : null;
  const labels = defaultBranchLabels(fe, outs.length);
  const branches = [];
  for (let idx = 0; idx < outs.length; idx++) {
    const o = outs[idx];
    const sub = parseSegment(o.target, null);
    if (!sub.ok) return sub;
    let condition = flowConditionLabel(o.flow);
    if (!condition && !isPar) condition = labels[idx] || `Ветвь ${idx + 1}`;
    const isDefault = Boolean(defaultFlowId && o.flow.id === defaultFlowId);
    branches.push({ condition, path: sub.seq, isDefault });
  }
  const gw = createElement(localType, fe.name || '');
  gw.id = fe.id;
  gw.branches = branches;
  return { ok: true, gateway: gw };
}

function warningForGatewayWithoutJoin(fe) {
  if (fe.$type === 'bpmn:ParallelGateway') {
    return 'Параллельный шлюз без общей точки слияния (ветви завершаются разными конечными событиями) — импортирован как несколько независимых потоков.';
  }
  return 'Шлюз без общей точки слияния (ветви завершаются разными конечными событиями) — импортирован с независимыми ветками.';
}

/**
 * @param {string} xmlStr
 * @returns {Promise<{ diagram: object, warnings: string[], error?: string }>}
 */
export async function importBpmnXmlToDiagram(xmlStr) {
  const warnings = [];
  try {
    const moddle = new BpmnModdle();
    const { rootElement: definitions, warnings: parseWarnings } = await moddle.fromXML(xmlStr);
    if (parseWarnings?.length) {
      parseWarnings.forEach((w) => warnings.push(String(w.message || w)));
    }

    const processes = collectProcesses(definitions);
    if (!processes.length) {
      return { diagram: null, warnings, error: 'В файле не найден процесс BPMN (bpmn:Process)' };
    }
    if (processes.length > 1) {
      warnings.push('В файле несколько процессов — импортирован первый подходящий');
    }

    const process = processes[0];
    const { flowNodeById, outMap, inDegree } = buildGraph(process, warnings);

    const startId = findStartEventId(flowNodeById, inDegree, outMap);
    if (!startId) {
      return { diagram: null, warnings, error: 'Не найдено начальное событие (StartEvent) или стартовый узел' };
    }

    const shapeCenterYByElementId = collectShapeCenterYFromDefinitions(definitions);

    const associations = [];

    function parseSegment(entryId, exitBoundary) {
      const seq = [];
      let cur = entryId;

      while (cur && cur !== exitBoundary) {
        const fe = flowNodeById.get(cur);
        if (!fe) {
          warnings.push(`Нет узла с id «${cur}» — обрыв потока`);
          break;
        }

        if (isJoinOnly(flowNodeById, outMap, inDegree, cur)) {
          cur = getSingleSuccessor(outMap, cur);
          continue;
        }

        if (cur === exitBoundary) break;

        const localType = mapFlowElementType(fe.$type);

        if (ARTIFACT_TYPES.has(localType)) {
          const art = makeModelFlowNode(fe, warnings);
          if (art) seq.push(art);
          cur = getSingleSuccessor(outMap, cur);
          continue;
        }

        if (isSplitGateway(flowNodeById, outMap, cur)) {
          let outs = orderOutsLikeBpmnFlowNode(fe, getOuts(outMap, cur));
          if (fe.$type === 'bpmn:ParallelGateway') {
            outs = orderParallelGatewayOutsByTargetShapeY(outs, shapeCenterYByElementId);
          }
          const branchTargets = outs.map((o) => o.target);
          const isParFork = fe.$type === 'bpmn:ParallelGateway';
          const joinId = isParFork
            ? findParallelMergePoint(cur, branchTargets, exitBoundary, flowNodeById, outMap)
            : exitBoundary != null
              ? resolveImplicitSplitJoin(cur, branchTargets, exitBoundary, flowNodeById, outMap)
              : findJoinGateway(cur, branchTargets, flowNodeById, outMap);

          if (!joinId && exitBoundary == null) {
            const terminal = importSplitGatewayWithoutJoin(fe, outs, parseSegment);
            if (!terminal.ok) return terminal;
            seq.push(terminal.gateway);
            warnings.push(warningForGatewayWithoutJoin(fe));
            return { ok: true, seq };
          }

          if (!joinId) {
            return {
              ok: false,
              error:
                'Не удалось найти точку слияния после шлюза — слишком сложная или циклическая схема. Упростите диаграмму или откройте в Camunda и экспортируйте линейный процесс.',
            };
          }
          const made = makeGatewayShell(fe, outs, joinId, flowNodeById, outMap, inDegree, warnings, parseSegment);
          if (!made.ok) return made;
          seq.push(made.gateway);
          // Продолжать с узла слияния; если это активность (не шлюз), successor нельзя брать сразу — иначе узел теряется из основной цепочки.
          cur = joinId;
          continue;
        }

        if (fe.$type === 'bpmn:EndEvent') {
          const endEl = makeModelFlowNode(fe, warnings);
          if (endEl) seq.push(endEl);
          return { ok: true, seq };
        }

        if (!localType) {
          warnings.push(`Пропуск ${fe.$type} (${fe.id})`);
          cur = getSingleSuccessor(outMap, cur);
          continue;
        }

        const modelEl = makeModelFlowNode(fe, warnings);
        if (modelEl) seq.push(modelEl);
        if (modelEl && localType && !ARTIFACT_TYPES.has(localType)) {
          collectDataOutputAssociationsFromActivity(fe, seq, flowNodeById, warnings, associations);
        }

        const outs = getOuts(outMap, cur);
        if (outs.length === 0) break;
        if (outs.length > 1) {
          // Несколько исходов с задачи/события без шлюза — допустимо в BPMN (Camunda/bpmn.io); моделируем как XOR.
          const branchTargets = outs.map((o) => o.target);
          const joinId = resolveImplicitSplitJoin(cur, branchTargets, exitBoundary, flowNodeById, outMap);
          const labels = outs.length === 2 ? ['Да', 'Нет'] : outs.map((_, i) => `Ветвь ${i + 1}`);
          const igw = createElement('exclusiveGateway', '');
          igw.id = `implicit_xor_${fe.id}`;

          if (joinId != null) {
            const branches = [];
            for (let idx = 0; idx < outs.length; idx++) {
              const o = outs[idx];
              let cond = flowConditionLabel(o.flow);
              if (!cond) cond = labels[idx] || `Ветвь ${idx + 1}`;
              const sub = parseSegment(o.target, joinId);
              if (!sub.ok) return sub;
              const path = sub.seq;
              if (!path.length) {
                branches.push({ condition: cond, path: [], next: joinId, isDefault: false });
              } else {
                branches.push({ condition: cond, path, isDefault: false });
              }
            }
            igw.branches = branches;
            seq.push(igw);
            warnings.push(
              `У узла «${fe.name || fe.id}» несколько исходящих потоков без шлюза — при импорте добавлен шлюз XOR (${igw.id}).`,
            );
            cur = joinId;
            continue;
          }

          if (exitBoundary != null) {
            return {
              ok: false,
              error:
                `Узел «${fe.name || fe.id}» имеет несколько исходящих потоков без шлюза; не удалось согласовать ветки со слиянием внешнего фрагмента. Добавьте явный XOR в BPMN-редакторе.`,
            };
          }

          const terminalBranches = [];
          for (let idx = 0; idx < outs.length; idx++) {
            const o = outs[idx];
            let cond = flowConditionLabel(o.flow);
            if (!cond) cond = labels[idx] || `Ветвь ${idx + 1}`;
            const sub = parseSegment(o.target, null);
            if (!sub.ok) return sub;
            terminalBranches.push({ condition: cond, path: sub.seq, isDefault: false });
          }
          igw.branches = terminalBranches;
          seq.push(igw);
          warnings.push(
            `У узла «${fe.name || fe.id}» несколько исходящих без шлюза — импортирован как XOR с независимыми ветками (${igw.id}).`,
          );
          return { ok: true, seq };
        }
        cur = outs[0].target;
      }
      return { ok: true, seq };
    }

    const parsed = parseSegment(startId, null);
    if (!parsed.ok) {
      return { diagram: null, warnings, error: parsed.error };
    }
    const top = parsed.seq;

    const diagram = createEmptyDiagram();
    const pool = diagram.pools[0];

    const participant = getParticipantForProcess(definitions, process.id);
    if (participant?.id) {
      pool.id = participant.id;
      pool.name = participant.name || (process.name ? String(process.name) : 'Импортированный процесс');
    } else {
      pool.name = process.name ? String(process.name) : 'Импортированный процесс';
      pool.id = `pool_${pool.name.replace(/\s+/g, '_').slice(0, 40)}_${Date.now()}`;
    }

    const bpmnLanes = flattenBpmnLanes(process);
    const nodeIdToLaneId = buildNodeIdToLaneIdMap(bpmnLanes);
    const primaryLaneBpmnId = nodeIdToLaneId.get(startId);

    if (bpmnLanes.length === 0) {
      pool.lanes = [createLane('Дорожка 1')];
      pool.lanes[0].elements = top;
      distributeCrossLaneBranchPaths(pool, nodeIdToLaneId);
    } else {
      pool.lanes = bpmnLanes.map((bl) => {
        const lane = createLane(bl.name != null ? String(bl.name) : 'Дорожка');
        lane.id = bl.id;
        lane.elements = [];
        return lane;
      });

      const primaryId = primaryLaneBpmnId || pool.lanes[0].id;
      for (const lane of pool.lanes) {
        lane.elements = lane.id === primaryId ? top : [];
      }
      distributeCrossLaneBranchPaths(pool, nodeIdToLaneId);

      const pIdx = pool.lanes.findIndex((l) => l.id === primaryId);
      if (pIdx > 0) {
        const [primary] = pool.lanes.splice(pIdx, 1);
        pool.lanes.unshift(primary);
      }
    }

    const assocKey = (a) => `${a.sourceRef}\0${a.targetRef}`;
    const seenAssoc = new Set(associations.map(assocKey));
    for (const fe of allProcessDiagramElements(process)) {
      if (fe.$type === 'bpmn:Association') {
        const s = refId(fe.sourceRef);
        const t = refId(fe.targetRef);
        if (s && t) {
          const a = createAssociation(s, t, '', 'none');
          if (fe.id) a.id = fe.id;
          const k = assocKey(a);
          if (!seenAssoc.has(k)) {
            seenAssoc.add(k);
            associations.push(a);
          }
        }
      }
    }

    const seenArtId = new Set((diagram.artifacts || []).map((a) => a?.id).filter(Boolean));
    for (const fe of allProcessDiagramElements(process)) {
      if (fe.$type !== 'bpmn:TextAnnotation') continue;
      const id = fe.id;
      if (id && seenArtId.has(id)) continue;
      const text = fe.text != null ? String(fe.text) : '';
      const art = createArtifact('textAnnotation', text);
      if (id) {
        art.id = id;
        seenArtId.add(id);
      }
      diagram.artifacts.push(art);
    }

    const collab = extractCollaborationArtifactsAndAssociations(definitions, process.id);
    for (const art of collab.artifacts) {
      if (art?.id && seenArtId.has(art.id)) continue;
      if (art?.id) seenArtId.add(art.id);
      diagram.artifacts.push(art);
    }
    for (const a of collab.associations) {
      const k = assocKey(a);
      if (!seenAssoc.has(k)) {
        seenAssoc.add(k);
        associations.push(a);
      }
    }

    diagram.associations = associations;

    return { diagram, warnings };
  } catch (e) {
    return {
      diagram: null,
      warnings,
      error: e.message || String(e),
    };
  }
}
