# WIMYC — Where Is My Car

Bot de WhatsApp para acordarse de dónde quedó el auto.

Le escribís, le mandás un audio o le pasás el pin de ubicación diciendo dónde lo dejaste, y
después le preguntás "¿dónde está el auto?" y te contesta.

**El auto es compartido.** No es un registro por persona: si el último que lo usó fue tu viejo,
vos preguntás y WIMYC te dice dónde lo dejó él y hace cuánto.

## Cómo funciona

```
WhatsApp → Kapso → POST /webhooks/kapso → cola → pipeline → respuesta por Kapso
```

- **Kapso** hace de proxy de la WhatsApp Cloud API: recibe los mensajes y los reenvía firmados
  a `/webhooks/kapso`; las respuestas salen por su API REST.
- **Groq Whisper** transcribe las notas de voz.
- **Groq LLM** (con OpenRouter de fallback) interpreta el texto: entiende si querés guardar,
  consultar o borrar, y de paso corrige lo que Whisper escribe mal — nombres de calles, alturas,
  niveles de cochera.
- **SQLite** guarda el estacionamiento activo y el historial.

El LLM se usa **sólo** para interpretar lenguaje natural. Los botones, la contraseña y los pins
de ubicación se resuelven con código, sin gastar un token.

## Flujos

| Mandás | Pasa |
|---|---|
| Texto: *"dejé el auto en Corrientes 1234, nivel 2"* | Lo guarda y confirma |
| Nota de voz | Transcribe, interpreta y **pide confirmación** con botones `Confirmar` / `Modificar` |
| Pin de ubicación | Guarda lat/lng y devuelve link de Google Maps |
| *"¿dónde está el auto?"* | Te dice dónde, quién lo dejó y hace cuánto |
| *"ya lo saqué"* | Borra la ubicación |

La confirmación por botones existe porque Whisper puede errarle a una calle: mejor que lo veas
antes de que quede guardado.

## Acceso

Hay una contraseña compartida en `ACCESS_PASSWORD`. Un número desconocido tiene que mandarla como
primer mensaje; a partir de ahí queda registrado y no se le pide nunca más.

## Desarrollo

```bash
npm install
cp .env.example .env   # completar las claves
npm run dev
npm test
```

Para probar el webhook sin WhatsApp, hay un script que firma un fixture y lo postea al server local:

```bash
npm run send-fixture text
```

## Deploy

Corre en un VPS detrás de `https://wimyc.sopia.app`.

```bash
mkdir -p data && chown 1000:1000 data   # sólo la primera vez
docker compose up -d --build
```

La app queda en `127.0.0.1:3000` y la publica el reverse proxy del host. Con
Caddy, alcanza con agregarle:

```
wimyc.sopia.app {
	reverse_proxy 127.0.0.1:3000
}
```

Si el VPS no tiene ningún reverse proxy, hay uno incluido:
`docker compose --profile proxy up -d --build`.

Después registrar el webhook en Kapso (Integrations → Webhooks → Platform) apuntando a
`https://wimyc.sopia.app/webhooks/kapso`, suscripto a `whatsapp.message.received`, con el mismo
secret que `KAPSO_WEBHOOK_SECRET`.

## Variables de entorno

Ver [`.env.example`](.env.example). Las imprescindibles son `PHONE_NUMBER_ID`, `KAPSO_API_KEY`,
`KAPSO_WEBHOOK_SECRET`, `ACCESS_PASSWORD` y `GROQ_API_KEY`.
