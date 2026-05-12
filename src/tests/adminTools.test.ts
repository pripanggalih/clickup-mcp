import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher } from "undici";

function createServerStub() {
  const tools: Record<string, any> = {};
  const metadata: Record<string, any> = {};

  const serverStub = {
    tool: (
      name: string,
      _desc: string,
      _schema: any,
      opts: any,
      handler: any,
    ) => {
      tools[name] = handler;
      metadata[name] = opts;
    },
  } as any;

  return { serverStub, tools, metadata };
}

test("admin tools create and update spaces with official v2 endpoints", async () => {
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerAdminToolsWrite } = await import("../tools/admin-tools");
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  let createBody: any;
  client
    .intercept({ path: "/api/v2/team/team1/space", method: "POST" })
    .reply((opts) => {
      createBody = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "space123", name: "Admin Space", private: true } };
    });

  let updateBody: any;
  client
    .intercept({ path: "/api/v2/space/space123", method: "PUT" })
    .reply((opts) => {
      updateBody = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "space123", name: "Renamed Space", color: "#123456" } };
    });

  const { serverStub, tools, metadata } = createServerStub();
  registerAdminToolsWrite(serverStub);

  const createResult = await tools.createSpace({
    name: "Admin Space",
    private: true,
    multiple_assignees: true,
    features: { tags: { enabled: true } },
  });
  const updateResult = await tools.updateSpace({
    space_id: "space123",
    name: "Renamed Space",
    color: "#123456",
  });

  assert.deepEqual(createBody, {
    name: "Admin Space",
    private: true,
    multiple_assignees: true,
    features: { tags: { enabled: true } },
  });
  assert.deepEqual(updateBody, { name: "Renamed Space", color: "#123456" });
  assert.equal(metadata.createSpace.destructiveHint, false);
  assert.equal(metadata.updateSpace.destructiveHint, false);
  assert.match(createResult.content[0].text, /space_id: space123/);
  assert.match(updateResult.content[0].text, /space_url:/);

  await mockAgent.close();
});

test("admin tools create and update folders with official v2 endpoints", async () => {
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerAdminToolsWrite } = await import("../tools/admin-tools");
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  let createBody: any;
  client
    .intercept({ path: "/api/v2/space/space123/folder", method: "POST" })
    .reply((opts) => {
      createBody = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "folder123", name: "Roadmap" } };
    });

  let updateBody: any;
  client
    .intercept({ path: "/api/v2/folder/folder123", method: "PUT" })
    .reply((opts) => {
      updateBody = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "folder123", name: "Delivery" } };
    });

  const { serverStub, tools } = createServerStub();
  registerAdminToolsWrite(serverStub);

  const createResult = await tools.createFolder({ space_id: "space123", name: "Roadmap" });
  const updateResult = await tools.updateFolder({ folder_id: "folder123", name: "Delivery" });

  assert.deepEqual(createBody, { name: "Roadmap" });
  assert.deepEqual(updateBody, { name: "Delivery" });
  assert.match(createResult.content[0].text, /folder_id: folder123/);
  assert.match(updateResult.content[0].text, /folder_url:/);

  await mockAgent.close();
});

test("createList creates either folderless or folder lists and treats status_color as list color", async () => {
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerAdminToolsWrite } = await import("../tools/admin-tools");
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  let folderlessBody: any;
  client
    .intercept({ path: "/api/v2/space/space123/list", method: "POST" })
    .reply((opts) => {
      folderlessBody = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "list123", name: "Inbox", status: "#ff00aa" } };
    });

  let folderBody: any;
  client
    .intercept({ path: "/api/v2/folder/folder123/list", method: "POST" })
    .reply((opts) => {
      folderBody = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "list456", name: "Sprint" } };
    });

  const { serverStub, tools } = createServerStub();
  registerAdminToolsWrite(serverStub);

  const folderlessResult = await tools.createList({
    space_id: "space123",
    name: "Inbox",
    content: "Incoming work",
    status_color: "#ff00aa",
  });
  const folderResult = await tools.createList({ folder_id: "folder123", name: "Sprint" });
  const invalidResult = await tools.createList({ space_id: "space123", folder_id: "folder123", name: "Bad" });

  assert.deepEqual(folderlessBody, { name: "Inbox", content: "Incoming work", status: "#ff00aa" });
  assert.deepEqual(folderBody, { name: "Sprint" });
  assert.match(folderlessResult.content[0].text, /list_id: list123/);
  assert.match(folderResult.content[0].text, /list_id: list456/);
  assert.match(invalidResult.content[0].text, /Provide exactly one of space_id or folder_id/);

  await mockAgent.close();
});

test("updateList updates list fields and maps status_color to ClickUp list status", async () => {
  process.env.CLICKUP_API_KEY = "test-key";
  process.env.CLICKUP_TEAM_ID = "team1";

  const { registerAdminToolsWrite } = await import("../tools/admin-tools");
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const client = mockAgent.get("https://api.clickup.com");

  let updateBody: any;
  client
    .intercept({ path: "/api/v2/list/list123", method: "PUT" })
    .reply((opts) => {
      updateBody = JSON.parse(String(opts.body));
      return { statusCode: 200, data: { id: "list123", name: "Backlog", status: "#00ff00" } };
    });

  const { serverStub, tools } = createServerStub();
  registerAdminToolsWrite(serverStub);

  const result = await tools.updateList({
    list_id: "list123",
    name: "Backlog",
    content: "Updated description",
    status_color: "#00ff00",
    due_date: "2026-06-01T00:00:00.000Z",
    priority: 2,
  });

  assert.deepEqual(updateBody, {
    name: "Backlog",
    content: "Updated description",
    status: "#00ff00",
    due_date: new Date("2026-06-01T00:00:00.000Z").getTime(),
    priority: 2,
  });
  assert.match(result.content[0].text, /list_id: list123/);
  assert.match(result.content[0].text, /list_status_color: #00ff00/);

  await mockAgent.close();
});
