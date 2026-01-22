from pydantic import BaseModel


class BpmnToJsonRequest(BaseModel):

    bpmn_xml: str


# То есть от клиента приходит JSON:
# {
#   "bpmn_xml": "<xml>...</xml>"
# }
