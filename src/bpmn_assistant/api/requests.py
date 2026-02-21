from pydantic import BaseModel


class BpmnToJsonRequest(BaseModel):

    bpmn_xml: str


class BpmnLayoutRequest(BaseModel):

    bpmnXml: str


# То есть от клиента приходит JSON:
# {
#   "bpmn_xml": "<xml>...</xml>"
# }
# или для layout:
# {
#   "bpmnXml": "<xml>...</xml>"
# }
