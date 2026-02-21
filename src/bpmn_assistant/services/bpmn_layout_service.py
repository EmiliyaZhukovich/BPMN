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

                # element_to_lane и lane_bounds_map уже созданы выше из оригинального XML

                # Применяем offset к shapes и корректируем Y-координаты по дорожкам
                for sxml in shapes_for_proc:
                    # Извлекаем element ID
                    be_match = re.search(r'bpmnElement="([^"]+)"', sxml, re.IGNORECASE)
                    element_id = be_match.group(1) if be_match else None

                    # Определяем lane для этого элемента
                    lane_id = element_to_lane.get(element_id) if element_id else None

                    # Вычисляем Y-координату для элемента
                    # Проверяем, есть ли информация о дорожке для этого элемента
                    if element_id and element_id in element_to_lane:
                        lane_id = element_to_lane[element_id]

                    if lane_id and lane_id in lane_bounds_map:
                        lane_bounds = lane_bounds_map[lane_id]
                        # Центрируем элемент в дорожке по вертикали
                        # Высота элемента обычно 80 для задач, 36 для событий
                        element_height = 80  # default для задач
                        height_match = re.search(
                            r'height="([0-9+.\-eE]+)"', sxml, re.IGNORECASE
                        )
                        if height_match:
                            element_height = float(height_match.group(1))
                        # Центр дорожки минус половина высоты элемента
                        lane_center_y = lane_bounds["y"] + lane_bounds["height"] / 2
                        desired_y = lane_center_y - element_height / 2
                        # Используем desired_y напрямую, а не через offset
                        # Но нужно учесть offset_x для X координаты
                        current_x_match = re.search(
                            r'x="([0-9+.\-eE]+)"', sxml, re.IGNORECASE
                        )
                        current_x = float(current_x_match.group(1)) if current_x_match else 0
                        new_x = current_x + offset_x

                        # Заменяем координаты - используем простую замену через regex
                        # Сначала заменяем x, потом y (они могут быть в любом порядке)
                        adjusted = sxml
                        # Заменяем x координату в Bounds (только первое вхождение)
                        adjusted = re.sub(
                            r'(<dc:Bounds[^>]*\s)x="([0-9+.\-eE]+)"',
                            rf'\1x="{new_x}"',
                            adjusted,
                            count=1,
                            flags=re.IGNORECASE,
                        )
                        # Заменяем y координату в Bounds (только первое вхождение)
                        adjusted = re.sub(
                            r'(<dc:Bounds[^>]*\s)y="([0-9+.\-eE]+)"',
                            rf'\1y="{desired_y}"',
                            adjusted,
                            count=1,
                            flags=re.IGNORECASE,
                        )
                        # Если замена не сработала (возможно формат другой), пробуем без группы
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
                    else:
                        # Если нет информации о дорожке, используем стандартный offset
                        adjusted = re.sub(
                            r"<dc:Bounds([^>]*)>",
                            lambda m: self._adjust_bounds(m.group(1), offset_x, offset_y),
                            sxml,
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

                    # Определяем Y-координаты для waypoints на основе дорожек
                    # По умолчанию используем offset_y, но если элементы в дорожках - используем центры дорожек
                    first_waypoint_y = offset_y + 22  # default offset внутри participant
                    last_waypoint_y = offset_y + 22

                    if source_id and target_id:
                        source_lane = element_to_lane.get(source_id)
                        target_lane = element_to_lane.get(target_id)

                        if source_lane and lane_bounds_map.get(source_lane):
                            source_lane_center = (
                                lane_bounds_map[source_lane]["y"]
                                + lane_bounds_map[source_lane]["height"] / 2
                            )
                            first_waypoint_y = source_lane_center
                        elif source_id:
                            # Если элемент не в дорожке, используем его текущую Y координату
                            # Найдем shape для source элемента
                            source_shape_match = re.search(
                                f'<bpmndi:BPMNShape[\\s\\S]*?bpmnElement="{re.escape(source_id)}"[\\s\\S]*?</bpmndi:BPMNShape>',
                                "\n".join(shapes_for_proc),
                                re.IGNORECASE,
                            )
                            if source_shape_match:
                                source_y_match = re.search(
                                    r'y="([0-9+.\-eE]+)"',
                                    source_shape_match.group(0),
                                    re.IGNORECASE,
                                )
                                if source_y_match:
                                    source_y = float(source_y_match.group(1))
                                    first_waypoint_y = source_y + 40  # центр элемента (примерно)

                        if target_lane and lane_bounds_map.get(target_lane):
                            target_lane_center = (
                                lane_bounds_map[target_lane]["y"]
                                + lane_bounds_map[target_lane]["height"] / 2
                            )
                            last_waypoint_y = target_lane_center
                        elif target_id:
                            # Если элемент не в дорожке, используем его текущую Y координату
                            target_shape_match = re.search(
                                f'<bpmndi:BPMNShape[\\s\\S]*?bpmnElement="{re.escape(target_id)}"[\\s\\S]*?</bpmndi:BPMNShape>',
                                "\n".join(shapes_for_proc),
                                re.IGNORECASE,
                            )
                            if target_shape_match:
                                target_y_match = re.search(
                                    r'y="([0-9+.\-eE]+)"',
                                    target_shape_match.group(0),
                                    re.IGNORECASE,
                                )
                                if target_y_match:
                                    target_y = float(target_y_match.group(1))
                                    last_waypoint_y = target_y + 40  # центр элемента (примерно)

                    # Применяем корректировку waypoints
                    # Находим все waypoints и заменяем их координаты
                    waypoint_pattern = r'<di:waypoint[^>]*>'
                    waypoint_matches = list(re.finditer(waypoint_pattern, exml, re.IGNORECASE))
                    waypoint_total = len(waypoint_matches)

                    if waypoint_total > 0:
                        adjusted_edge = exml
                        for idx, wp_match in enumerate(waypoint_matches):
                            wp = wp_match.group(0)
                            is_first = idx == 0
                            is_last = idx == waypoint_total - 1

                            # Определяем Y координату для этого waypoint
                            if is_first:
                                y_adjust = first_waypoint_y
                            elif is_last:
                                y_adjust = last_waypoint_y
                            else:
                                # Интерполируем между first и last
                                progress = idx / (waypoint_total - 1)
                                y_adjust = first_waypoint_y + (last_waypoint_y - first_waypoint_y) * progress

                            # Извлекаем текущую X координату
                            x_match = re.search(r'x="([0-9+.\-eE]+)"', wp, re.IGNORECASE)
                            current_x = float(x_match.group(1)) if x_match else 0
                            new_x = current_x + offset_x

                            # Заменяем waypoint
                            new_waypoint = f'<di:waypoint x="{new_x}" y="{y_adjust}"/>'
                            adjusted_edge = adjusted_edge.replace(wp, new_waypoint, 1)
                    else:
                        adjusted_edge = exml

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
