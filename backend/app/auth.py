"""
Dependência única de autenticação para a API.

Uso:
    from app.auth import usuario_logado, exigir_admin

    # Protege um router inteiro (recomendado):
    app.include_router(meu_router.router, dependencies=[Depends(usuario_logado)])

    # Ou protege um endpoint específico:
    @router.get("/algo")
    async def algo(perfil: dict = Depends(usuario_logado)):
        ...

Autenticação em 2 fatores (TOTP)
--------------------------------
O cadastro e a verificação do segundo fator acontecem direto no Supabase
Auth, chamados pelo frontend (supabase.auth.mfa.*) — o backend não precisa
de rota própria para isso. O papel do backend é só de fiscal, em duas
frentes:

1. Se o usuário JÁ tem um fator TOTP verificado, toda chamada à API só é
   aceita se o token da sessão atual for de nível aal2 (ou seja, a pessoa
   realmente completou o desafio do segundo fator nesse login — não só a
   senha). Isso vale sempre, independente de qualquer configuração.

2. Se `settings.mfa_obrigatorio` estiver ligado, um usuário que ainda não
   tem NENHUM fator cadastrado é bloqueado (403 "mfa_cadastro_obrigatorio")
   em qualquer rota — com uma exceção: `usuario_logado_permitir_pendente_mfa`
   (usada só em GET /usuarios/me), para o frontend sempre conseguir
   descobrir quem é a pessoa e mandar ela para a tela de cadastro do
   segundo fator, em vez de ficar preso numa tela em branco sem saber
   por que perdeu acesso.
"""

import base64
import json
from typing import Any

from fastapi import Depends, HTTPException, Header

from app.config import settings
from app.database import supabase


def _get_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Token não informado.")

    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Token inválido.")

    token = authorization[len(prefix):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token inválido.")

    return token


def _aal_do_token(token: str) -> str:
    """
    Lê o claim 'aal' (Authenticator Assurance Level) direto do payload do
    JWT, sem validar assinatura -- isso não é um problema de segurança
    aqui porque a autenticidade do token já foi confirmada logo acima por
    supabase.auth.get_user(token), que bate no servidor de Auth do
    Supabase e só responde para um token de verdade. Esta função só
    extrai um campo que o próprio Supabase sempre inclui no token
    ('aal1' = só senha; 'aal2' = senha + segundo fator confirmado nesta
    sessão).
    """
    try:
        partes = token.split(".")
        if len(partes) != 3:
            return "aal1"

        payload_b64 = partes[1]
        padding = "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + padding))

        return str(payload.get("aal") or "aal1")
    except Exception:
        return "aal1"


def _validar_sessao(authorization: str | None) -> dict[str, Any]:
    """
    Núcleo da validação, compartilhado pelas duas dependências abaixo:
    - confirma o token contra o Supabase Auth;
    - se existir um fator MFA verificado para o usuário, exige que a
      sessão atual esteja em aal2 (ou seja, o segundo fator já foi
      conferido neste login, não só a senha);
    - busca o perfil em usuarios_app e confere se está ativo.

    Não decide sozinho se cadastro de MFA é obrigatório -- isso é feito
    por quem chama (usuario_logado), para permitir a exceção do /me.
    """
    token = _get_bearer_token(authorization)

    try:
        user_resp = supabase.auth.get_user(token)
        user = user_resp.user
    except Exception:
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    if not user:
        raise HTTPException(status_code=401, detail="Usuário não autenticado.")

    fatores = user.factors or []
    tem_fator_verificado = any(getattr(f, "status", None) == "verified" for f in fatores)

    if tem_fator_verificado and _aal_do_token(token) != "aal2":
        raise HTTPException(
            status_code=401,
            detail="mfa_aal2_requerido",
        )

    res = (
        supabase.table("usuarios_app")
        .select("*")
        .eq("auth_user_id", user.id)
        .limit(1)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=403, detail="Usuário sem perfil configurado.")

    perfil = res.data[0]

    if not perfil.get("ativo", True):
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    perfil["_mfa_verificado"] = tem_fator_verificado

    return perfil


def usuario_logado(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Valida o token Bearer contra o Supabase Auth e retorna o perfil
    correspondente em usuarios_app. Levanta 401/403 se algo não bater.

    Quando settings.mfa_obrigatorio estiver ligado, também exige que o
    usuário já tenha um segundo fator cadastrado -- quem ainda não tem
    recebe 403 "mfa_cadastro_obrigatorio" em qualquer rota protegida por
    esta dependência.
    """
    perfil = _validar_sessao(authorization)

    if settings.mfa_obrigatorio and not perfil.get("_mfa_verificado"):
        raise HTTPException(status_code=403, detail="mfa_cadastro_obrigatorio")

    return perfil


def usuario_logado_permitir_pendente_mfa(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Igual a usuario_logado, mas nunca bloqueia por falta de cadastro de
    MFA. Usada só em GET /usuarios/me, para o frontend sempre conseguir
    identificar a pessoa logada e decidir se deve mandar ela para a tela
    de cadastro do segundo fator -- em vez de travar antes disso."""
    return _validar_sessao(authorization)


def exigir_admin(perfil: dict[str, Any] = Depends(usuario_logado)) -> dict[str, Any]:
    """Igual a usuario_logado, mas além disso exige perfil admin
    (ou permissão explícita de 'configuracoes')."""
    permissoes = perfil.get("permissoes") or []
    is_admin = perfil.get("perfil") == "admin" or "configuracoes" in permissoes

    if not is_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")

    return perfil