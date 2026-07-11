from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_key: str

    # Integração automática com a API da Cogtive (apontamentos de produção).
    # Opcional: se não configurado, a sincronização automática fica desligada
    # sozinha (sem quebrar o resto do sistema).
    cogtive_api_token: Optional[str] = None
    cogtive_unidades: str = "11,12"  # IDs separados por vírgula

    class Config:
        env_file = ".env"
        extra = "ignore"  # <<< ISSO resolve o erro do anon_key e environment


settings = Settings()