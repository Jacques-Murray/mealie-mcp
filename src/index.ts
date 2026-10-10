#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.MEALIE_URL ?? "").replace(/\/+$/, "").replace(/\/api$/, "");
const TOKEN = process.env.MEALIE_API_TOKEN ?? "";
if (!BASE || !TOKEN) {
  console.error("Set MEALIE_URL (e.g. https://mealie.example.com) and MEALIE_API_TOKEN (from /user/profile/api-tokens).");
  process.exit(1);
}

async function api(method: string, path: string, query?: Record<string, unknown>, body?: unknown): Promise<unknown> {
  const url = new URL(`${BASE}/api${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 ? " Check MEALIE_API_TOKEN." : res.status === 404 ? " Check the id/slug (use a list/search tool)." : res.status === 422 ? " Request body failed validation; see detail." : "";
    throw new Error(`Mealie ${res.status} on ${method} ${path}.${hint} ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : { ok: true };
}

const server = new McpServer({ name: "mealie-mcp-server", version: "1.0.0" });

type Annot = "read" | "write" | "delete";
const A = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};

// Registers a tool whose result is the JSON returned by Mealie, truncated to keep context small.
function tool<S extends z.ZodRawShape>(name: string, description: string, kind: Annot, shape: S, run: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>) {
  server.registerTool(name, { title: name, description, inputSchema: shape as z.ZodRawShape, annotations: A[kind] }, async (args: any): Promise<any> => {
    try {
      let text = JSON.stringify(await run(args), null, 1);
      if (text.length > 25000) text = text.slice(0, 25000) + "\n...truncated; narrow with search/page/per_page.";
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
    }
  });
}

const page = { page: z.number().int().min(1).default(1), per_page: z.number().int().min(1).max(100).default(20) };
const pg = (a: { page: number; per_page: number }) => ({ page: a.page, perPage: a.per_page });

// Recipes
tool("mealie_search_recipes", "Search recipes. Returns summaries (name, slug, id, rating, tags). Use the slug with mealie_get_recipe.", "read",
  { search: z.string().optional().describe("Free text, e.g. 'chicken curry'"), categories: z.array(z.string()).optional().describe("Category slugs"), tags: z.array(z.string()).optional().describe("Tag slugs"), ...page },
  (a) => api("GET", "/recipes", { ...pg(a), search: a.search, categories: a.categories, tags: a.tags }));
tool("mealie_get_recipe", "Get a full recipe (ingredients, instructions, nutrition) by slug.", "read",
  { slug: z.string() }, (a) => api("GET", `/recipes/${encodeURIComponent(a.slug)}`));
tool("mealie_create_recipe", "Create an empty recipe by name; returns its slug. Then fill it with mealie_update_recipe.", "write",
  { name: z.string().min(1) }, (a) => api("POST", "/recipes", undefined, { name: a.name }));
tool("mealie_import_recipe_from_url", "Scrape and import a recipe from a web URL; returns the new slug.", "write",
  { url: z.string().url(), include_tags: z.boolean().default(false) }, (a) => api("POST", "/recipes/create/url", undefined, { url: a.url, includeTags: a.include_tags }));
tool("mealie_update_recipe", "Partially update a recipe (PATCH). Pass only fields to change, using Mealie's recipe schema, e.g. {description, recipeIngredient:[{note:'2 eggs'}], recipeInstructions:[{text:'Boil'}], tags:[...]}. Lists replace the existing list.", "write",
  { slug: z.string(), fields: z.record(z.unknown()) }, (a) => api("PATCH", `/recipes/${encodeURIComponent(a.slug)}`, undefined, a.fields));
tool("mealie_delete_recipe", "Permanently delete a recipe by slug.", "delete",
  { slug: z.string() }, (a) => api("DELETE", `/recipes/${encodeURIComponent(a.slug)}`));

// Organizers
tool("mealie_list_organizers", "List categories, tags, or cookbooks (names, slugs, ids) for filtering recipes.", "read",
  { kind: z.enum(["categories", "tags", "cookbooks"]), ...page },
  (a) => api("GET", a.kind === "cookbooks" ? "/households/cookbooks" : `/organizers/${a.kind}`, pg(a)));
tool("mealie_list_foods", "List or search the foods database (ids needed for structured shopping items).", "read",
  { search: z.string().optional(), ...page }, (a) => api("GET", "/foods", { ...pg(a), search: a.search }));

// Meal plans
tool("mealie_list_mealplan", "List meal plan entries between two dates (inclusive).", "read",
  { start_date: z.string().describe("YYYY-MM-DD"), end_date: z.string().describe("YYYY-MM-DD"), ...page },
  (a) => api("GET", "/households/mealplans", { ...pg(a), start_date: a.start_date, end_date: a.end_date }));
tool("mealie_add_mealplan_entry", "Add a meal plan entry. Use recipe_id (the recipe's id, not slug) or a free-text title.", "write",
  { date: z.string().describe("YYYY-MM-DD"), entry_type: z.enum(["breakfast", "lunch", "dinner", "side", "snack", "drink", "dessert"]).default("dinner"), recipe_id: z.string().optional(), title: z.string().optional(), text: z.string().optional() },
  (a) => {
    if (!a.recipe_id && !a.title) throw new Error("Provide recipe_id or title.");
    return api("POST", "/households/mealplans", undefined, { date: a.date, entryType: a.entry_type, recipeId: a.recipe_id, title: a.title ?? "", text: a.text ?? "" });
  });
tool("mealie_delete_mealplan_entry", "Delete a meal plan entry by its integer id.", "delete",
  { id: z.number().int() }, (a) => api("DELETE", `/households/mealplans/${a.id}`));

// Shopping
tool("mealie_list_shopping_lists", "List shopping lists (id, name).", "read", { ...page }, (a) => api("GET", "/households/shopping/lists", pg(a)));
tool("mealie_get_shopping_list", "Get a shopping list with its items.", "read", { list_id: z.string() }, (a) => api("GET", `/households/shopping/lists/${a.list_id}`));
tool("mealie_create_shopping_list", "Create a shopping list.", "write", { name: z.string() }, (a) => api("POST", "/households/shopping/lists", undefined, { name: a.name }));
tool("mealie_add_shopping_items", "Add free-text items (e.g. '2 onions') to a shopping list.", "write",
  { list_id: z.string(), items: z.array(z.string()).min(1) },
  (a) => api("POST", "/households/shopping/items/create-bulk", undefined, a.items.map((note) => ({ shoppingListId: a.list_id, note, quantity: 1, checked: false }))));
tool("mealie_add_recipe_to_shopping_list", "Add all ingredients of a recipe to a shopping list.", "write",
  { list_id: z.string(), recipe_id: z.string(), scale: z.number().positive().default(1) },
  (a) => api("POST", `/households/shopping/lists/${a.list_id}/recipe`, undefined, [{ recipeId: a.recipe_id, recipeIncrementQuantity: a.scale }]));
tool("mealie_set_shopping_item_checked", "Check or uncheck a shopping list item.", "write",
  { item_id: z.string(), checked: z.boolean() },
  async (a) => {
    const item = (await api("GET", `/households/shopping/items/${a.item_id}`)) as Record<string, unknown>;
    return api("PUT", `/households/shopping/items/${a.item_id}`, undefined, { ...item, checked: a.checked });
  });
tool("mealie_delete_shopping_items", "Delete shopping list items by id.", "delete",
  { item_ids: z.array(z.string()).min(1) }, (a) => api("DELETE", "/households/shopping/items", { ids: a.item_ids }));

await server.connect(new StdioServerTransport());
