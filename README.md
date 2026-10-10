# mealie-mcp-server

MCP (stdio) server for [Mealie](https://mealie.io): recipes, meal plans, shopping lists.

```
npm install && npm run build
```

Create an API token at `<mealie>/user/profile/api-tokens`, then add to your MCP client:

```json
{ "mcpServers": { "mealie": { "command": "node", "args": ["/path/to/mealie-mcp/dist/index.js"],
  "env": { "MEALIE_URL": "https://mealie.example.com", "MEALIE_API_TOKEN": "..." } } } }
```

Tools: `mealie_search_recipes`, `_get_recipe`, `_create_recipe`, `_import_recipe_from_url`, `_update_recipe`, `_delete_recipe`, `_list_organizers`, `_list_foods`, `_list_mealplan`, `_add_mealplan_entry`, `_delete_mealplan_entry`, `_list_shopping_lists`, `_get_shopping_list`, `_create_shopping_list`, `_add_shopping_items`, `_add_recipe_to_shopping_list`, `_set_shopping_item_checked`, `_delete_shopping_items`.
