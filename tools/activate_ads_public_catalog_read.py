#!/usr/bin/env python3
"""Habilita exclusivamente la lectura anónima del catálogo publicitario TaskFlow ADS.
El usuario conserva intactos otros permisos, credenciales y documentos.
No concede acceso a users/, adsCampaigns/ ni al panel de aprobación.
"""
import datetime
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "taskflow-b0ece"
BASE = "https://firebaserules.googleapis.com/v1/"
RELEASE = f"projects/{PROJECT}/releases/cloud.firestore"
MARKER = "TASKFLOW_ADS_PUBLIC_CATALOG_READ_V1"

ADDITION = """
    // TASKFLOW_ADS_PUBLIC_CATALOG_READ_V1
    // TaskFlow consulta exclusivamente el catálogo mínimo de anuncios aprobados.
    // Esta lectura pública NO afecta colecciones privadas ni concede escrituras.
    match /adsPublicCampaigns/{adsPublicCatalogId} {
      allow get, list: if true;
    }
"""


def abort(message):
    raise SystemExit("SIN CAMBIOS: " + message)


def gcloud(*args):
    try:
        return subprocess.check_output(["gcloud", *args], text=True, stderr=subprocess.PIPE).strip()
    except (OSError, subprocess.CalledProcessError):
        abort("No se pudo autenticar Cloud Shell. Comprueba la sesión de Google Cloud.")


def api(method, path, token, data=None):
    headers = {
        "Authorization": "Bearer " + token,
        "X-Goog-User-Project": PROJECT,
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode("utf-8") if data is not None else None
    request = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except (ValueError, UnicodeDecodeError):
            detail = "Error de Firebase"
        abort(f"Firebase rechazó {method} ({e.code}): {detail[:500]}")
    except (TimeoutError, urllib.error.URLError):
        abort("Firebase no respondió. No se publicaron reglas.")


def main():
    active = gcloud("config", "get-value", "project")
    if active != PROJECT:
        abort(f"Proyecto distinto del esperado: {active!r}. Selecciona {PROJECT}.")
    account = gcloud("auth", "list", "--filter=status:ACTIVE", "--format=value(account)")
    if not account:
        abort("No hay cuenta activa de Google Cloud.")
    token = gcloud("auth", "print-access-token")

    release = api("GET", RELEASE, token)
    old_rule_name = release.get("rulesetName")
    if release.get("name") != RELEASE or not old_rule_name or not old_rule_name.startswith(f"projects/{PROJECT}/rulesets/"):
        abort("La versión activa de Firestore no tiene un ruleset válido.")
    ruleset = api("GET", old_rule_name, token)
    source = ruleset.get("source", {})
    files = source.get("files", [])
    candidates = [i for i, file in enumerate(files) if "service cloud.firestore" in file.get("content", "")]
    if len(candidates) != 1:
        abort("No se encontró un único archivo principal de reglas Firestore.")
    index = candidates[0]
    original = files[index]["content"]
    if MARKER in original:
        print("La corrección ADS ya se encuentra en las reglas activas. Sin cambios.")
        return
    if not re.search(r"(?m)^\s*rules_version\s*=\s*['\"]2['\"]\s*;", original):
        abort("El archivo actual no usa rules_version = '2'. No se cambia automáticamente.")
    # La regla de lectura complementa los permisos administrativos existentes.
    match = re.search(r"match\s*/databases/\{database\}/documents\s*\{", original)
    if not match:
        abort("No se encontró el contenedor estándar de reglas. No se realizará una modificación automática.")

    revised = original[:match.end()] + "\n" + ADDITION + original[match.end():]
    updated_files = [{"name": f["name"], "content": revised if i == index else f["content"]}
                     for i, f in enumerate(files)]
    backup = pathlib.Path.home() / ("taskflow-ads-public-backup-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S") + ".json")
    backup.write_text(json.dumps({"release": release, "source": source}, indent=2, ensure_ascii=False), encoding="utf-8")

    print("Proyecto:", PROJECT)
    print("Cuenta Cloud Shell:", account)
    print("Respaldo de reglas existentes:", backup)
    print("Cambio propuesto: permitir exclusivamente la lectura del catálogo adsPublicCampaigns.")
    print("No se alterarán usuarios, documentos, campañas, contraseñas ni escrituras.")
    if input("Escribe PUBLICAR para aplicar las reglas: ").strip() != "PUBLICAR":
        print("Cancelado. No se publicó ningún cambio.")
        return

    latest = api("GET", RELEASE, token)
    if latest.get("rulesetName") != old_rule_name:
        abort("Otra persona actualizó las reglas durante el proceso. Revisa los cambios.")
    payload = {"source": {"files": updated_files}}
    if ruleset.get("attachment_point"):
        payload["attachment_point"] = ruleset["attachment_point"]
    created = api("POST", f"projects/{PROJECT}/rulesets", token, payload)
    new_name = created.get("name", "")
    if not new_name.startswith(f"projects/{PROJECT}/rulesets/"):
        abort("No se obtuvo un identificador válido para las reglas nuevas.")
    api("PATCH", RELEASE, token,
        {"release": {"name": RELEASE, "rulesetName": new_name}, "updateMask": "rulesetName"})
    verified = api("GET", RELEASE, token)
    if verified.get("rulesetName") == new_name:
        print("LECTURA PUBLICA ADS ACTIVADA CORRECTAMENTE")
        print("La lectura anónima de adsPublicCampaigns ya está autorizada.")
    else:
        abort("No se confirmó el despliegue. Consulta las reglas en Firebase Console.")


if __name__ == "__main__":
    main()
