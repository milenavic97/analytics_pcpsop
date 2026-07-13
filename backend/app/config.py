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

    # Rollout de autenticação em 2 fatores (TOTP via Supabase Auth MFA).
    # Começa desligado (False) de propósito: o objetivo é dar tempo para
    # todo mundo cadastrar o segundo fator pela tela antes de bloquear
    # quem ainda não tem. Depois que a equipe toda estiver cadastrada,
    # muda essa variável de ambiente para "true" (sem precisar de deploy
    # de código) para passar a EXIGIR o segundo fator de todo usuário
    # em toda chamada da API.
    mfa_obrigatorio: bool = False

    class Config:
        env_file = ".env"
        extra = "ignore"  # <<< ISSO resolve o erro do anon_key e environment


settings = Settings()