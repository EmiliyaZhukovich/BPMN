/**
 * Импорт BPMN 2.0 XML в модель конструктора (пулы, дорожки, дерево элементов).
 * Поддерживаются типичные блок-схемы: последовательность, XOR/OR/AND с явной точкой слияния.
 */

import BpmnModdle from 'bpmn-moddle';
import { createElement, createEmptyDiagram, createLane, createAssociation } from './diagramModel.js';
import { isGatewayType, isParallelGatewayType } from './bpmnPalette.js';

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

function applyBranchLaneHints(elements, nodeIdToLaneId, primaryLaneId) {
  if (!Array.isArray(elements)) return;
  for (const el of elements) {
    if (!el?.branches) continue;
    for (const br of el.branches) {
      const path = br.path || [];
      const firstFlow = path.find((n) => n && !ARTIFACT_TYPES.has(n.type));
      if (firstFlow) {
        const lid = nodeIdToLaneId.get(firstFlow.id);
        if (lid && primaryLaneId && lid !== primaryLaneId) {
          br.laneId = lid;
        }
      }
      applyBranchLaneHints(path, nodeIdToLaneId, primaryLaneId);
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
          const outs = getOuts(outMap, cur);
          const joinId = findJoinGateway(cur, outs.map((o) => o.target), flowNodeById, outMap);
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
      applyBranchLaneHints(top, nodeIdToLaneId, primaryLaneBpmnId || pool.lanes[0].id);
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
      applyBranchLaneHints(top, nodeIdToLaneId, primaryId);

      const pIdx = pool.lanes.findIndex((l) => l.id === primaryId);
      if (pIdx > 0) {
        const [primary] = pool.lanes.splice(pIdx, 1);
        pool.lanes.unshift(primary);
      }
    }

    const assocKey = (a) => `${a.sourceRef}\0${a.targetRef}`;
    const seenAssoc = new Set(associations.map(assocKey));
    for (const fe of process.flowElements || []) {
      if (fe.$type === 'bpmn:Association') {
        const s = refId(fe.sourceRef);
        const t = refId(fe.targetRef);
        if (s && t) {
          const a = createAssociation(s, t, '', 'none');
          const k = assocKey(a);
          if (!seenAssoc.has(k)) {
            seenAssoc.add(k);
            associations.push(a);
          }
        }
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
