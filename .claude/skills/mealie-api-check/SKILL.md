---
name: mealie-api-check
description: Use when adding or changing a tool in src/index.ts that sends a request body or query params to Mealie. Verifies the payload against Mealie's real OpenAPI schema.
user-invocable: false
---

Request shapes in `src/index.ts` were written from partial docs. Before changing a tool's endpoint, body or params:

1. Fetch the schema: `curl -s -H "Authorization: Bearer $MEALIE_API_TOKEN" "$MEALIE_URL/openapi.json"` (or https://demo.mealie.io/openapi.json).
2. Find the path and its request-body component with `jq`; confirm field names (Mealie mixes camelCase bodies with `perPage`/`per_page` query params) and required fields.
3. Update the tool, then `npm run build`.
