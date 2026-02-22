"""
Сервис для автоматической расстановки элементов BPMN диаграммы.
Использует библиотеку bpmn-auto-layout через Node.js subprocess.
"""
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


class BpmnLayoutService:
    """
    Класс для обработки BPMN XML и автоматической расстановки элементов.
    Логика переписана с JavaScript версии (bpmn_layout_server/server.js).
    """

    def __init__(self):
        self.node_script_path = Path(__file__).parent / "layout_process.js"

    def process_bpmn(self, bpmn_xml: str) -> str:
        """
        Обрабатывает BPMN XML и возвращает XML с автоматической расстановкой элементов.

        Args:
            bpmn_xml: BPMN XML строка

        Returns:
            BPMN XML с автоматической расстановкой элементов
        """
        if not bpmn_xml or not bpmn_xml.strip():
            raise ValueError("Empty BPMN XML in request body")

        # Проверяем наличие Collaboration/Participant (pools)
        has_collaboration = (
            re.search(r"<collaboration[\s>]", bpmn_xml, re.IGNORECASE) is not None
            or re.search(r"<participant[\s>]", bpmn_xml, re.IGNORECASE) is not None
        )

        if has_collaboration:
            return self._process_collaboration_diagram(bpmn_xml)

        # Для диаграмм без pools, удаляем существующий BPMN DI
        # чтобы дать layout engine чистую модель
        xml_without_di = re.sub(
            r"<bpmndi:BPMNDiagram[\s\S]*?</bpmndi:BPMNDiagram>",
            "",
            bpmn_xml,
            flags=re.IGNORECASE,
        )

        layouted_xml = self._call_layout_process(xml_without_di)
        return layouted_xml or bpmn_xml

    def _process_collaboration_diagram(self, bpmn_xml: str) -> str:
        """
        Обрабатывает диаграмму с Collaboration/Participant (pools).
        Делает layout для каждого процесса отдельно, сохраняя pools.
        """
        try:
            # Извлекаем collaboration block для последующей вставки
            collaboration_match = re.search(
                r"<collaboration[\s\S]*?</collaboration>", bpmn_xml, re.IGNORECASE
            )
            collaboration_block = collaboration_match.group(0) if collaboration_match else ""

            # Извлекаем все <process> блоки
            process_regex = re.compile(r"<process[\s\S]*?</process>", re.IGNORECASE)
            processes = process_regex.findall(bpmn_xml)

            if not processes:
                return bpmn_xml

            # Создаем mapping processId -> participantId из collaboration block
            proc_to_participant = {}
            if collaboration_block:
                participant_tag_regex = re.compile(r"<participant\b[^>]*>", re.IGNORECASE)
                for ptag_match in participant_tag_regex.finditer(collaboration_block):
                    tag = ptag_match.group(0)
                    id_match = re.search(r'\bid\s*=\s*"([^"]+)"', tag, re.IGNORECASE)
                    proc_ref_match = re.search(
                        r'\bprocessRef\s*=\s*"([^"]+)"', tag, re.IGNORECASE
                    )
                    if id_match and proc_ref_match:
                        participant_id = id_match.group(1)
                        pid = proc_ref_match.group(1)
                        proc_to_participant[pid.strip()] = participant_id.strip()

            # Извлекаем оригинальный BPMNDI diagram для чтения participant bounds
            original_diagram_match = re.search(
                r"<bpmndi:BPMNDiagram[\s\S]*?</bpmndi:BPMNDiagram>",
                bpmn_xml,
                re.IGNORECASE,
            )
            original_diagram = original_diagram_match.group(0) if original_diagram_match else ""

            # Извлекаем информацию о дорожках из оригинального XML (до обработки)
            element_to_lane = {}
            lane_bounds_map = {}

            # Находим process в оригинальном XML
            process_match = re.search(
                r"<process[^>]*id=\"([^\"]+)\"[\s\S]*?</process>", bpmn_xml, re.IGNORECASE
            )
            if process_match:
                process_content = process_match.group(0)
                # Извлекаем laneSet из process
                lane_set_match = re.search(
                    r"<laneSet[^>]*>([\s\S]*?)</laneSet>", process_content, re.IGNORECASE
                )
                if lane_set_match:
                    lane_set_content = lane_set_match.group(1)
                    lane_regex = re.compile(
                        r'<lane[^>]*id="([^"]+)"[^>]*>([\s\S]*?)</lane>',
                        re.IGNORECASE,
                    )
                    for lane_match in lane_regex.finditer(lane_set_content):
                        lane_id = lane_match.group(1)
                        lane_content = lane_match.group(2)
                        # Извлекаем flowNodeRef из lane
                        flow_node_refs = re.findall(
                            r'<flowNodeRef>([^<]+)</flowNodeRef>',
                            lane_content,
                            re.IGNORECASE,
                        )
                        for elem_id in flow_node_refs:
                            element_to_lane[elem_id.strip()] = lane_id

            # Предварительно извлекаем participant bounds и lane bounds
            participant_bounds = {}
            if original_diagram:
                part_shape_regex = re.compile(
                    r"<bpmndi:BPMNShape[\s\S]*?>[\s\S]*?</bpmndi:BPMNShape>",
                    re.IGNORECASE,
                )
                for psh_match in part_shape_regex.finditer(original_diagram):
                    s = psh_match.group(0)
                    be_match = re.search(r'bpmnElement="([^"]+)"', s, re.IGNORECASE)
                    if not be_match:
                        continue
                    be = be_match.group(1)
                    # Учитываем только participant и lane shapes
                    if not re.match(r"^pool_|^participant|^lane_", be, re.IGNORECASE):
                        continue
                    # Ищем bounds - сначала ищем все атрибуты отдельно
                    x_match = re.search(r'x="([0-9+.\-eE]+)"', s, re.IGNORECASE)
                    y_match = re.search(r'y="([0-9+.\-eE]+)"', s, re.IGNORECASE)
                    width_match = re.search(r'width="([0-9+.\-eE]+)"', s, re.IGNORECASE)
                    height_match = re.search(r'height="([0-9+.\-eE]+)"', s, re.IGNORECASE)

                    if x_match and y_match:
                        x_val = float(x_match.group(1))
                        y_val = float(y_match.group(1))
                        participant_bounds[be] = {
                            "x": x_val,
                            "y": y_val,
                        }
                        # Если это lane, сохраняем полную информацию о bounds
                        if re.match(r"^lane_", be, re.IGNORECASE):
                            width_val = float(width_match.group(1)) if width_match else 0
                            height_val = float(height_match.group(1)) if height_match else 0
                            if width_val > 0 and height_val > 0:
                                lane_bounds_map[be] = {
                                    "x": x_val,
                                    "y": y_val,
                                    "width": width_val,
                                    "height": height_val,
                                }

            collected_shapes = []
            collected_edges = []

            # Делаем layout для каждого процесса отдельно
            for proc in processes:
                # Создаем минимальный definitions только с этим процессом
                proc_id_match = re.search(r'<process[^>]*id="([^"]+)"', proc, re.IGNORECASE)
                proc_id = proc_id_match.group(1) if proc_id_match else None

                minimal = f'<?xml version="1.0"?>\n<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="tmp_def">\n{proc}\n</definitions>'

                # Вызываем layoutProcess для этого single-process diagram
                try:
                    layouted = self._call_layout_process(minimal)
                    if not layouted:
                        continue
                except Exception:
                    continue

                # Извлекаем BPMNPlane content из layouted result
                plane_match = re.search(
                    r"<bpmndi:BPMNPlane[\s\S]*?</bpmndi:BPMNPlane>",
                    layouted,
                    re.IGNORECASE,
                )
                if not plane_match:
                    continue

                plane = plane_match.group(0)

                # Собираем shapes и edges
                shape_regex = re.compile(
                    r"<bpmndi:BPMNShape[\s\S]*?</bpmndi:BPMNShape>", re.IGNORECASE
                )
                edge_regex = re.compile(
                    r"<bpmndi:BPMNEdge[\s\S]*?</bpmndi:BPMNEdge>", re.IGNORECASE
                )

                shapes_for_proc = shape_regex.findall(plane)
                edges_for_proc = edge_regex.findall(plane)

                if not shapes_for_proc and not edges_for_proc:
                    continue

                # Парсим shapes для поиска minX/minY
                bounds_regex = re.compile(
                    r'<dc:Bounds[^>]*x="([0-9+.\-eE]+)"[^>]*y="([0-9+.\-eE]+)"[^>]*>',
                    re.IGNORECASE,
                )
                min_x = float("inf")
                min_y = float("inf")
                for sxml in shapes_for_proc:
                    b = bounds_regex.search(sxml)
                    if b:
                        x = float(b.group(1))
                        y = float(b.group(2))
                        if not (x != x or y != y):  # not NaN
                            if x < min_x:
                                min_x = x
                            if y < min_y:
                                min_y = y

                if min_x == float("inf"):
                    min_x = 0
                if min_y == float("inf"):
                    min_y = 0

                # Определяем participant bounds для этого процесса
                participant_id = proc_to_participant.get(proc_id) if proc_id else None
                participant_x = 40  # defaults inside lane
                participant_y = 0

                if participant_id and participant_bounds.get(participant_id):
                    participant_x = participant_bounds[participant_id]["x"]
                    participant_y = participant_bounds[participant_id]["y"]
                elif proc and original_diagram:
                    # fallback: пытаемся найти lane id внутри process и использовать lane bounds
                    lane_regex = re.compile(r'<lane[^>]*id="([^"]+)"[^>]*>', re.IGNORECASE)
                    lane_match = lane_regex.search(proc)
                    if lane_match:
                        lane_id = lane_match.group(1)
                        if participant_bounds.get(lane_id):
                            participant_x = participant_bounds[lane_id]["x"]
                            participant_y = participant_bounds[lane_id]["y"]
                        else:
                            # final fallback: ищем lane shape в original_diagram
                            lane_shape_regex = re.compile(
                                f'<bpmndi:BPMNShape[\\s\\S]*?bpmnElement="{re.escape(lane_id)}"[\\s\\S]*?</bpmndi:BPMNShape>',
                                re.IGNORECASE,
                            )
                            lane_shape_match = lane_shape_regex.search(original_diagram)
                            if lane_shape_match:
                                b2 = re.search(
                                    r'<dc:Bounds[^>]*x="([0-9+.\-eE]+)"[^>]*y="([0-9+.\-eE]+)"',
                                    lane_shape_match.group(0),
                                    re.IGNORECASE,
                                )
                                if b2:
                                    participant_x = float(b2.group(1))
                                    participant_y = float(b2.group(2))

                # Желаемое размещение внутри participant: оставляем некоторый отступ
                desired_left = participant_x + 82  # common left offset observed
                desired_top = participant_y + 22

                offset_x = desired_left - min_x
                offset_y = desired_top - min_y

                # Номер ветки для каждого элемента (0 = основной поток, 1,2,... = параллельные ветки шлюза)
                element_to_branch = self._get_element_to_branch(proc)
                # Шлюзы и порядок исходящих потоков — для ортогональной маршрутизации стрелок
                gateway_ids, gateway_outgoing = self._get_gateway_info(proc)
                # Вертикальное смещение по веткам, чтобы параллельные ветки не перекрывались
                def branch_y_offset(branch_idx: int) -> float:
                    if branch_idx <= 0:
                        return 0.0
                    half = (branch_idx + 1) // 2
                    sign = 1 if branch_idx % 2 == 0 else -1
                    return sign * 100 * half

                # В какой дорожке сколько веток: смещение по ветке только если в одной дорожке > 1 ветки
                lane_to_branch_indices: dict = {}
                for eid, lid in element_to_lane.items():
                    lane_to_branch_indices.setdefault(lid, set()).add(
                        element_to_branch.get(eid, 0)
                    )

                # element_to_lane и lane_bounds_map уже созданы выше из оригинального XML
                # Карта скорректированных границ элементов (для привязки стрелок к центрам фигур)
                shape_adjusted_bounds = {}

                # Первый проход: заполняем shape_adjusted_bounds (offset + Y по дорожкам)
                for sxml in shapes_for_proc:
                    # Извлекаем element ID
                    be_match = re.search(r'bpmnElement="([^"]+)"', sxml, re.IGNORECASE)
                    element_id = be_match.group(1) if be_match else None

                    # Размеры фигуры (для карты bounds и стрелок)
                    x_match = re.search(r'x="([0-9+.\-eE]+)"', sxml, re.IGNORECASE)
                    y_match = re.search(r'y="([0-9+.\-eE]+)"', sxml, re.IGNORECASE)
                    w_match = re.search(r'width="([0-9+.\-eE]+)"', sxml, re.IGNORECASE)
                    h_match = re.search(r'height="([0-9+.\-eE]+)"', sxml, re.IGNORECASE)
                    shape_w = float(w_match.group(1)) if w_match else 36
                    shape_h = float(h_match.group(1)) if h_match else 36

                    # Определяем lane для этого элемента
                    lane_id = element_to_lane.get(element_id) if element_id else None

                    # Вычисляем Y-координату для элемента
                    # Проверяем, есть ли информация о дорожке для этого элемента
                    if element_id and element_id in element_to_lane:
                        lane_id = element_to_lane[element_id]

                    if lane_id and lane_id in lane_bounds_map:
                        lane_bounds = lane_bounds_map[lane_id]
                        element_height = shape_h
                        lane_center_y = lane_bounds["y"] + lane_bounds["height"] / 2
                        # Смещение по ветке только если в этой дорожке несколько веток (чтобы не сливались).
                        # Иначе центрируем в дорожке — стрелки горизонтальны, от центра границ.
                        branch_idx = element_to_branch.get(element_id, 0)
                        branches_in_lane = lane_to_branch_indices.get(lane_id, set())
                        offset_in_lane = (
                            branch_y_offset(branch_idx)
                            if len(branches_in_lane) > 1
                            else 0.0
                        )
                        desired_y = lane_center_y - element_height / 2 + offset_in_lane
                        min_y = lane_bounds["y"] + 5
                        max_y = lane_bounds["y"] + lane_bounds["height"] - element_height - 5
                        desired_y = max(min_y, min(max_y, desired_y))
                        current_x = float(x_match.group(1)) if x_match else 0
                        new_x = current_x + offset_x
                        if element_id:
                            shape_adjusted_bounds[element_id] = {
                                "x": new_x,
                                "y": desired_y,
                                "w": shape_w,
                                "h": shape_h,
                            }
                    else:
                        # Если нет информации о дорожке, используем стандартный offset + смещение по ветке
                        current_x = float(x_match.group(1)) if x_match else 0
                        current_y = float(y_match.group(1)) if y_match else 0
                        branch_idx = element_to_branch.get(element_id, 0)
                        adj_y = current_y + offset_y + branch_y_offset(branch_idx)
                        if element_id:
                            shape_adjusted_bounds[element_id] = {
                                "x": current_x + offset_x,
                                "y": adj_y,
                                "w": shape_w,
                                "h": shape_h,
                            }

                # Выравнивание по X: цель cross-lane перехода под источником (одна колонка)
                flow_ref_re = re.compile(
                    r'<sequenceFlow[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"',
                    re.IGNORECASE,
                )
                flow_ref_re2 = re.compile(
                    r'<sequenceFlow[^>]*targetRef="([^"]+)"[^>]*sourceRef="([^"]+)"',
                    re.IGNORECASE,
                )
                flow_pairs = []
                for m in flow_ref_re.finditer(proc):
                    flow_pairs.append((m.group(1), m.group(2)))
                for m in flow_ref_re2.finditer(proc):
                    flow_pairs.append((m.group(2), m.group(1)))
                for src_id, tgt_id in flow_pairs:
                    # Не сдвигаем цель по X, если источник — шлюз: раскладка веток уже задана layout'ом
                    if src_id in gateway_ids:
                        continue
                    src_lane = element_to_lane.get(src_id)
                    tgt_lane = element_to_lane.get(tgt_id)
                    if (
                        src_lane is not None
                        and tgt_lane is not None
                        and src_lane != tgt_lane
                        and src_id in shape_adjusted_bounds
                        and tgt_id in shape_adjusted_bounds
                    ):
                        sb = shape_adjusted_bounds[src_id]
                        tb = shape_adjusted_bounds[tgt_id]
                        center_x = sb["x"] + sb["w"] / 2
                        shape_adjusted_bounds[tgt_id]["x"] = center_x - tb["w"] / 2

                # Второй проход: применяем bounds к XML и собираем shapes
                for sxml in shapes_for_proc:
                    be_match = re.search(r'bpmnElement="([^"]+)"', sxml, re.IGNORECASE)
                    element_id = be_match.group(1) if be_match else None
                    b = shape_adjusted_bounds.get(element_id) if element_id else None
                    if not b:
                        collected_shapes.append(sxml)
                        continue
                    new_x, desired_y = b["x"], b["y"]
                    shape_w, shape_h = b["w"], b["h"]
                    adjusted = sxml
                    adjusted = re.sub(
                        r'(<dc:Bounds[^>]*\s)x="([0-9+.\-eE]+)"',
                        rf'\1x="{new_x}"',
                        adjusted,
                        count=1,
                        flags=re.IGNORECASE,
                    )
                    adjusted = re.sub(
                        r'(<dc:Bounds[^>]*\s)y="([0-9+.\-eE]+)"',
                        rf'\1y="{desired_y}"',
                        adjusted,
                        count=1,
                        flags=re.IGNORECASE,
                    )
                    if adjusted == sxml:
                        adjusted = re.sub(
                            r'x="([0-9+.\-eE]+)"',
                            f'x="{new_x}"',
                            sxml,
                            count=1,
                            flags=re.IGNORECASE,
                        )
                        adjusted = re.sub(
                            r'y="([0-9+.\-eE]+)"',
                            f'y="{desired_y}"',
                            adjusted,
                            count=1,
                            flags=re.IGNORECASE,
                        )
                    collected_shapes.append(adjusted)

                # Применяем offset к edges и корректируем waypoints для элементов из разных дорожек
                for exml in edges_for_proc:
                    # Извлекаем bpmnElement (это ID sequenceFlow)
                    be_match = re.search(r'bpmnElement="([^"]+)"', exml, re.IGNORECASE)
                    flow_id = be_match.group(1) if be_match else None

                    # Находим sourceRef и targetRef из sequenceFlow в оригинальном XML
                    source_id = None
                    target_id = None
                    if flow_id:
                        # Ищем в оригинальном XML, а не в минимальном процессе
                        flow_xml_match = re.search(
                            f'<sequenceFlow[^>]*id="{re.escape(flow_id)}"[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"',
                            bpmn_xml,
                            re.IGNORECASE,
                        )
                        if not flow_xml_match:
                            # Попробуем другой формат (атрибуты в другом порядке)
                            flow_xml_match = re.search(
                                f'<sequenceFlow[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"[^>]*id="{re.escape(flow_id)}"',
                                bpmn_xml,
                                re.IGNORECASE,
                            )
                        if flow_xml_match:
                            source_id = flow_xml_match.group(1)
                            target_id = flow_xml_match.group(2)

                    # Точки подключения стрелки: от правого центра source к левому центру target
                    first_wp_x = first_wp_y = last_wp_x = last_wp_y = None
                    if source_id and target_id and source_id in shape_adjusted_bounds and target_id in shape_adjusted_bounds:
                        sb = shape_adjusted_bounds[source_id]
                        tb = shape_adjusted_bounds[target_id]
                        first_wp_x = sb["x"] + sb["w"]
                        first_wp_y = sb["y"] + sb["h"] / 2
                        last_wp_x = tb["x"]
                        last_wp_y = tb["y"] + tb["h"] / 2

                    waypoint_pattern = re.compile(r'<di:waypoint[^>]*>', re.IGNORECASE)
                    waypoint_matches = list(waypoint_pattern.finditer(exml))
                    waypoint_total = len(waypoint_matches)

                    source_lane = element_to_lane.get(source_id) if source_id else None
                    target_lane = element_to_lane.get(target_id) if target_id else None

                    # Ортогональная маршрутизация для стрелок из шлюза (нотация BPMN)
                    is_from_gateway = (
                        source_id in gateway_ids
                        and flow_id
                        and gateway_outgoing.get(source_id)
                        and len(gateway_outgoing[source_id]) > 1
                    )
                    if is_from_gateway and first_wp_x is not None and last_wp_x is not None:
                        out_list = gateway_outgoing[source_id]
                        try:
                            out_index = out_list.index(flow_id)
                        except ValueError:
                            out_index = 0
                        n_out = len(out_list)
                        # Если цель в той же дорожке и справа — упрощённая стрелка только при одной исходящей.
                        # При нескольких исходящих из шлюза в одну дорожку выходим из вершин ромба (разные Y), иначе ветки сливаются.
                        gateway_right = sb["x"] + sb["w"]
                        same_lane_right = (
                            n_out <= 1
                            and source_lane
                            and target_lane
                            and source_lane == target_lane
                            and last_wp_x > gateway_right
                        )
                        if same_lane_right:
                            waypoints = [
                                (gateway_right, sb["y"] + sb["h"] / 2),
                                (last_wp_x, last_wp_y),
                            ]
                        else:
                            # По нотации BPMN: стрелки выходят из верхней и нижней вершин ромба
                            exit_x = sb["x"] + sb["w"] / 2
                            if n_out <= 1:
                                exit_y = sb["y"] + sb["h"] / 2
                            else:
                                exit_y = sb["y"] + (out_index / (n_out - 1)) * sb["h"]
                            waypoints = [
                                (exit_x, exit_y),
                                (exit_x, last_wp_y),
                                (last_wp_x, last_wp_y),
                            ]
                        wp_lines = "\n".join(
                            f'      <di:waypoint x="{x}" y="{y}"/>' for x, y in waypoints
                        )
                        adjusted_edge = re.sub(
                            r"(<bpmndi:BPMNEdge[^>]*>)\s*[\s\S]*?(\s*</bpmndi:BPMNEdge>)",
                            r"\1\n" + wp_lines + r"\n      \2",
                            exml,
                            count=1,
                            flags=re.IGNORECASE,
                        )
                        collected_edges.append(adjusted_edge)
                    elif (
                        source_lane is not None
                        and target_lane is not None
                        and source_lane != target_lane
                        and first_wp_x is not None
                        and last_wp_x is not None
                    ):
                        # Переход между дорожками: вертикальная линия (без диагонали)
                        center_x = sb["x"] + sb["w"] / 2
                        src_bottom = sb["y"] + sb["h"]
                        tgt_top = tb["y"]
                        waypoints = [(center_x, src_bottom), (center_x, tgt_top)]
                        wp_lines = "\n".join(
                            f'      <di:waypoint x="{x}" y="{y}"/>' for x, y in waypoints
                        )
                        adjusted_edge = re.sub(
                            r"(<bpmndi:BPMNEdge[^>]*>)\s*[\s\S]*?(\s*</bpmndi:BPMNEdge>)",
                            r"\1\n" + wp_lines + r"\n      \2",
                            exml,
                            count=1,
                            flags=re.IGNORECASE,
                        )
                        collected_edges.append(adjusted_edge)
                    elif waypoint_total > 0 and first_wp_x is not None and last_wp_x is not None:
                        # Обычная стрелка: два waypoint (источник — цель)
                        adjusted_edge = exml
                        for idx, wp_match in enumerate(waypoint_matches):
                            wp = wp_match.group(0)
                            is_first = idx == 0
                            is_last = idx == waypoint_total - 1
                            if is_first:
                                new_waypoint = f'<di:waypoint x="{first_wp_x}" y="{first_wp_y}"/>'
                            elif is_last:
                                new_waypoint = f'<di:waypoint x="{last_wp_x}" y="{last_wp_y}"/>'
                            else:
                                progress = idx / (waypoint_total - 1)
                                mid_x = first_wp_x + (last_wp_x - first_wp_x) * progress
                                mid_y = first_wp_y + (last_wp_y - first_wp_y) * progress
                                new_waypoint = f'<di:waypoint x="{mid_x}" y="{mid_y}"/>'
                            adjusted_edge = adjusted_edge.replace(wp, new_waypoint, 1)
                        collected_edges.append(adjusted_edge)
                    else:
                        # Fallback: как раньше — offset по X и Y по центру дорожки/фигуры
                        first_waypoint_y = offset_y + 22
                        last_waypoint_y = offset_y + 22
                        if source_id and target_id:
                            if source_id in shape_adjusted_bounds:
                                sb = shape_adjusted_bounds[source_id]
                                first_waypoint_y = sb["y"] + sb["h"] / 2
                            if target_id in shape_adjusted_bounds:
                                tb = shape_adjusted_bounds[target_id]
                                last_waypoint_y = tb["y"] + tb["h"] / 2
                        adjusted_edge = exml
                        for idx, wp_match in enumerate(waypoint_matches):
                            wp = wp_match.group(0)
                            is_first = idx == 0
                            is_last = idx == waypoint_total - 1
                            if is_first:
                                y_adjust = first_waypoint_y
                            elif is_last:
                                y_adjust = last_waypoint_y
                            else:
                                progress = idx / (waypoint_total - 1)
                                y_adjust = first_waypoint_y + (last_waypoint_y - first_waypoint_y) * progress
                            x_m = re.search(r'x="([0-9+.\-eE]+)"', wp, re.IGNORECASE)
                            current_x = float(x_m.group(1)) if x_m else 0
                            new_x = current_x + offset_x
                            new_waypoint = f'<di:waypoint x="{new_x}" y="{y_adjust}"/>'
                            adjusted_edge = adjusted_edge.replace(wp, new_waypoint, 1)
                        collected_edges.append(adjusted_edge)

            # Извлекаем оригинальный BPMNDI diagram (если есть)
            if not original_diagram_match:
                # Нет оригинального diagram: создаем новый BPMNDI с собранными shapes/edges
                new_diagram = f'<bpmndi:BPMNDiagram id="BPMNDiagram_1">\n  <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">\n{"\n".join(collected_shapes)}\n{"\n".join(collected_edges)}\n  </bpmndi:BPMNPlane>\n</bpmndi:BPMNDiagram>'
                merged = re.sub(
                    r"<definitions([^>]*)>",
                    lambda m: f"<definitions{m.group(1)}>{collaboration_block}",
                    bpmn_xml,
                    flags=re.IGNORECASE,
                ) + new_diagram
                return merged

            original_diagram = original_diagram_match.group(0)

            # Из оригинального diagram сохраняем только participant и lane shapes
            original_shape_regex = re.compile(
                r"<bpmndi:BPMNShape[\s\S]*?</bpmndi:BPMNShape>", re.IGNORECASE
            )
            original_shapes = []
            for osh_match in original_shape_regex.finditer(original_diagram):
                s = osh_match.group(0)
                if re.search(r'bpmnElement="(pool_|participant|lane_)', s, re.IGNORECASE):
                    original_shapes.append(s)

            # Строим merged BPMNPlane
            original_plane_open_match = re.search(
                r"<bpmndi:BPMNPlane[^>]*>", original_diagram, re.IGNORECASE
            )
            original_plane_open = (
                original_plane_open_match.group(0)
                if original_plane_open_match
                else '<bpmndi:BPMNPlane bpmnElement="Collaboration_1">'
            )

            merged_plane_inner = (
                "\n".join(original_shapes)
                + "\n"
                + "\n".join(collected_shapes)
                + "\n"
                + "\n".join(collected_edges)
            )
            merged_plane = f"{original_plane_open}\n{merged_plane_inner}\n</bpmndi:BPMNPlane>"

            # Заменяем BPMNPlane в оригинальном diagram на mergedPlane
            merged_diagram = re.sub(
                r"<bpmndi:BPMNPlane[\s\S]*?</bpmndi:BPMNPlane>",
                merged_plane,
                original_diagram,
                flags=re.IGNORECASE,
            )

            # Заменяем оригинальный diagram в оригинальном XML на merged diagram
            final_xml = re.sub(
                r"<bpmndi:BPMNDiagram[\s\S]*?</bpmndi:BPMNDiagram>",
                merged_diagram,
                bpmn_xml,
                flags=re.IGNORECASE,
            )

            return final_xml

        except Exception as e:
            # В случае ошибки возвращаем оригинальный XML
            return bpmn_xml

    def _get_element_to_branch(self, process_xml: str) -> dict:
        """
        Определяет номер ветки для каждого элемента (0 = основной поток,
        1, 2, ... = параллельные ветки от шлюзов), чтобы разнести их по вертикали.
        """
        # Парсим sequenceFlow: flow_id -> (sourceRef, targetRef)
        flow_src_tgt = {}
        flow_tag = re.compile(
            r'<sequenceFlow\b[^>]*id="([^"]+)"[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"',
            re.IGNORECASE,
        )
        for m in flow_tag.finditer(process_xml):
            flow_src_tgt[m.group(1)] = (m.group(2), m.group(3))
        alt_flow = re.compile(
            r'<sequenceFlow\b[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"[^>]*id="([^"]+)"',
            re.IGNORECASE,
        )
        for m in alt_flow.finditer(process_xml):
            flow_src_tgt[m.group(3)] = (m.group(1), m.group(2))

        # Исходящие потоки по элементу: element_id -> [(flow_id, target_id), ...]
        outgoing = {}
        for fid, (src, tgt) in flow_src_tgt.items():
            outgoing.setdefault(src, []).append((fid, tgt))

        # Шлюзы с несколькими исходящими — корни веток
        branch_sets = []  # list of set of element_id
        seen_in_branch = set()

        for elem_id, out_list in outgoing.items():
            if len(out_list) < 2:
                continue
            for flow_id, first_target in out_list:
                branch_elements = set()
                stack = [first_target]
                while stack:
                    n = stack.pop()
                    if n in branch_elements:
                        continue
                    branch_elements.add(n)
                    for next_flow_id, next_tgt in outgoing.get(n, []):
                        stack.append(next_tgt)
                if branch_elements:
                    branch_sets.append(branch_elements)
                    seen_in_branch |= branch_elements

        # element_id -> branch_index (0 = основной поток)
        element_to_branch = {}
        for idx, branch in enumerate(branch_sets):
            for eid in branch:
                element_to_branch[eid] = idx + 1
        return element_to_branch

    def _get_gateway_info(self, process_xml: str) -> tuple[set, dict]:
        """
        Возвращает (множество id шлюзов, словарь gateway_id -> упорядоченный список flow_id исходящих потоков).
        Нужно для ортогональной маршрутизации стрелок из шлюза по нотации BPMN.
        """
        gateway_tags = re.compile(
            r"<(?:exclusiveGateway|inclusiveGateway|parallelGateway)\s+id=\"([^\"]+)\"",
            re.IGNORECASE,
        )
        gateway_ids = set()
        for m in gateway_tags.finditer(process_xml):
            gateway_ids.add(m.group(1))

        # Порядок исходящих потоков у каждого шлюза (по тегам <outgoing> внутри элемента)
        gateway_outgoing = {}
        gate_block = re.compile(
            r"<(?:exclusiveGateway|inclusiveGateway|parallelGateway)\s+id=\"([^\"]+)\"[^>]*>"
            r"([\s\S]*?)</(?:exclusiveGateway|inclusiveGateway|parallelGateway)>",
            re.IGNORECASE,
        )
        for m in gate_block.finditer(process_xml):
            gid = m.group(1)
            inner = m.group(2)
            out_refs = re.findall(r"<outgoing>([^<]+)</outgoing>", inner, re.IGNORECASE)
            gateway_outgoing[gid] = [fid.strip() for fid in out_refs]

        return gateway_ids, gateway_outgoing

    def _adjust_bounds(self, bounds_attrs: str, offset_x: float, offset_y: float) -> str:
        """Корректирует координаты в Bounds атрибутах."""
        bx_match = re.search(r'x="([0-9+.\-eE]+)"', bounds_attrs)
        by_match = re.search(r'y="([0-9+.\-eE]+)"', bounds_attrs)
        bx = float(bx_match.group(1)) if bx_match else 0
        by = float(by_match.group(1)) if by_match else 0
        new_x = bx + offset_x
        new_y = by + offset_y

        # Удаляем существующие x/y атрибуты
        rest = re.sub(r'x="[^"]+"|y="[^"]+"', "", bounds_attrs).strip()
        rest = re.sub(r"\s*\/?\s*$", "", rest)
        spacer = " " if rest else ""
        return f'<dc:Bounds x="{new_x}" y="{new_y}"{spacer}{rest} />'

    def _adjust_waypoint(self, waypoint: str, offset_x: float, offset_y: float) -> str:
        """Корректирует координаты в waypoint."""
        mx = re.search(r'x="([0-9+.\-eE]+)"', waypoint, re.IGNORECASE)
        my = re.search(r'y="([0-9+.\-eE]+)"', waypoint, re.IGNORECASE)
        if mx and my:
            x = float(mx.group(1)) + offset_x
            y = float(my.group(1)) + offset_y
            return f'<di:waypoint x="{x}" y="{y}"/>'
        return waypoint

    def _call_layout_process(self, bpmn_xml: str) -> Optional[str]:
        """
        Вызывает Node.js скрипт для обработки layout через bpmn-auto-layout.
        """
        try:
            # Создаем временный файл с XML
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".xml", delete=False, encoding="utf-8"
            ) as tmp_file:
                tmp_file.write(bpmn_xml)
                tmp_file_path = tmp_file.name

            try:
                # Вызываем Node.js скрипт из директории, где установлены зависимости
                script_dir = self.node_script_path.parent
                result = subprocess.run(
                    ["node", str(self.node_script_path), tmp_file_path],
                    cwd=str(script_dir),
                    capture_output=True,
                    text=True,
                    timeout=30,
                )

                if result.returncode != 0:
                    raise Exception(f"Node.js script failed: {result.stderr}")

                return result.stdout.strip()

            finally:
                # Удаляем временный файл
                Path(tmp_file_path).unlink(missing_ok=True)

        except Exception as e:
            raise Exception(f"Error calling layout process: {str(e)}")
