# WIMYC

Bot de WhatsApp que recuerda dónde quedó el auto. Node 22 + TypeScript + Fastify + SQLite.
Kapso como proxy de WhatsApp, Groq para STT y LLM, OpenRouter como fallback del LLM.

## Reglas del proyecto

- **El LLM sólo interpreta lenguaje natural** (texto libre y transcripciones de audio). Botones,
  contraseña, pins de ubicación y mensajes de error se resuelven con código. Nunca agregar una
  llamada al modelo para armar una respuesta que puede ser un template.
- **Todos los textos que ve el usuario viven en `src/reply/messages.ts`.** No hardcodear strings
  de respuesta en los handlers.
- **Castellano rioplatense**, voseo, tono corto y seco. Sin "¡Hola! 😊 Soy tu asistente".
- **El auto es compartido**: el estado es global, no por usuario. Hay un solo `active` y un solo
  `pending` en toda la base.
- **El gate de acceso corre antes de gastar plata**: nunca transcribir ni llamar al LLM para un
  teléfono no autorizado.
- Nunca loguear la contraseña ni el número de teléfono completo.

## Comandos

```bash
npm run dev            # server con recarga
npm test               # vitest
npm run build          # tsc a dist/
npm run send-fixture   # postea un webhook firmado al server local
```

## Estructura

- `src/webhook/` — verificación de firma HMAC y normalización del payload de Kapso
  (soporta la forma con buffering, `{ batch: true, data: [...] }`, y la sin buffering)
- `src/pipeline/` — orquestación: auth → transcripción → interpretación → handler
- `src/handlers/` — un archivo por intención
- `src/providers/` — clientes HTTP de Kapso, Groq y OpenRouter
- `src/db/` — better-sqlite3, migraciones en `migrations/`, queries en `repo.ts`

## Cosas que ya mordieron

- El webhook tiene que responder 200 en menos de 10s: se verifica, se deduplica, se responde y
  recién ahí se procesa en la cola.
- La firma se calcula sobre el **raw body**, no sobre el JSON reparseado.
- Botones de WhatsApp: máximo 3, `title` ≤ 20 caracteres, `body.text` ≤ 1024.
