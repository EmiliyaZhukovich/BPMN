from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from bpmn_assistant.api.requests import BpmnToJsonRequest
from bpmn_assistant.core.decorators import handle_exceptions
from bpmn_assistant.services.bpmn_json_generator import BpmnJsonGenerator

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "https://bpmn-frontend.onrender.com",
]


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def health_check():
    return {"status": "ok"}


@app.post("/bpmn_to_json")
@handle_exceptions # для логирования при ошибке и вызове ошибки
async def _bpmn_to_json(request: BpmnToJsonRequest) -> JSONResponse:
    # Он
    # преобразует
    # BPMN - XML → JSON.
    bpmn_json_generator = BpmnJsonGenerator()
    result = bpmn_json_generator.create_bpmn_json(request.bpmn_xml)
    return JSONResponse(content=result) #Возвращается уже сформированный JSON
