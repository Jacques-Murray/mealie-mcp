import { afterAll, beforeAll, expect, test } from "vitest";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Req = { method: string; url: string; auth?: string; body: string };
const seen: Req[] = [];
let srv: http.Server;
let client: Client;

beforeAll(async () => {
  srv = http.createServer((q, r) => {
    let body = "";
    q.on("data", (d) => (body += d));
    q.on("end", () => {
      seen.push({ method: q.method!, url: q.url!, auth: q.headers.authorization, body });
      r.setHeader("content-type", "application/json");
      if (q.url!.includes("missing")) { r.statusCode = 404; return r.end('{"detail":"nf"}'); }
      r.end(q.url!.includes("/shopping/items/i1") ? '{"id":"i1","note":"eggs","checked":false}' : '{"items":[]}');
    });
  });
  await new Promise<void>((ok) => srv.listen(0, ok));
  const port = (srv.address() as { port: number }).port;
  client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({
    command: "node", args: ["dist/index.js"],
    env: { ...process.env as Record<string, string>, MEALIE_URL: `http://127.0.0.1:${port}/api`, MEALIE_API_TOKEN: "tok" },
  }));
});
afterAll(async () => { await client.close(); srv.close(); });

const call = async (name: string, args: Record<string, unknown>) => {
  seen.length = 0;
  return (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
};

test("registers 18 tools", async () => {
  expect((await client.listTools()).tools).toHaveLength(18);
});

test("search sends bearer token and repeated array params", async () => {
  await call("mealie_search_recipes", { search: "curry", tags: ["a", "b"] });
  expect(seen[0].auth).toBe("Bearer tok");
  expect(seen[0].url).toBe("/api/recipes?page=1&perPage=20&search=curry&tags=a&tags=b");
});

test("HTTP errors become isError with a hint", async () => {
  const r = await call("mealie_get_recipe", { slug: "missing" });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toMatch(/404.*Check the id\/slug/);
});

test("mealplan entry requires recipe_id or title", async () => {
  const r = await call("mealie_add_mealplan_entry", { date: "2026-10-11" });
  expect(r.isError).toBe(true);
  expect(seen).toHaveLength(0);
});

test("mealplan entry maps fields to Mealie's camelCase body", async () => {
  await call("mealie_add_mealplan_entry", { date: "2026-10-11", recipe_id: "r1" });
  expect(JSON.parse(seen[0].body)).toMatchObject({ date: "2026-10-11", entryType: "dinner", recipeId: "r1" });
});

test("delete shopping items repeats ids param", async () => {
  await call("mealie_delete_shopping_items", { item_ids: ["x", "y"] });
  expect(seen[0]).toMatchObject({ method: "DELETE", url: "/api/households/shopping/items?ids=x&ids=y" });
});

test("set checked does GET then PUT with checked flipped", async () => {
  await call("mealie_set_shopping_item_checked", { item_id: "i1", checked: true });
  expect(seen.map((s) => s.method)).toEqual(["GET", "PUT"]);
  expect(JSON.parse(seen[1].body)).toMatchObject({ id: "i1", note: "eggs", checked: true });
});
