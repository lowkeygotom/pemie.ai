# Reporte de actividad por archivo

`pemie-activity-hook.mjs` recibe por `stdin` el evento de una edición y reporta
a `report_activity` las rutas tocadas. Por defecto no manda `summary`: agrega los
paths al tramo que el agente ya declaró, sin crear una segunda fila con narrativa
genérica. El hook no imprime errores y siempre termina con código 0 si falta
configuración, no hay red o pemie.ai no responde.

Configura antes `PEMIE_MCP_API_KEY` con una key de proyecto que tenga
`board:write`. Opcionalmente define `PEMIE_MCP_URL` (por defecto
`https://pemieai.vercel.app/mcp`) y `PEMIE_PROJECT_ID` si la key tiene alcance
workspace o usuario. Define `PEMIE_ACTIVITY_SUMMARY` solo si quieres que el hook
declare explícitamente un tramo en vez de limitarse a enriquecer el actual.

## Claude Code

Fusiona este bloque en `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/bryanriano/Desktop/Projects/pemie.ai/scripts/pemie-activity-hook.mjs >/dev/null 2>&1 || true",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

## Codex

Fusiona el mismo evento en `~/.codex/hooks.json`. `apply_patch` también se
incluye porque es la herramienta habitual con la que Codex edita archivos:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/bryanriano/Desktop/Projects/pemie.ai/scripts/pemie-activity-hook.mjs >/dev/null 2>&1 || true",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

No guardes la key en esos JSON: el proceso de Claude Code o Codex debe heredarla
del entorno. Si el archivo ya contiene hooks, conserva los existentes y añade
solo la entrada `PostToolUse` mostrada.
