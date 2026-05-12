import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONFIG } from "../shared/config";
import { generateFolderUrl, generateListUrl, generateSpaceUrl } from "../shared/utils";

const spaceFeaturesSchema = z.record(z.any()).optional().describe("Optional ClickUp Space features object passed through to the official API");
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Optional hex color (for example, #123456)");
const listDescriptionSchema = z.string().optional().describe("Optional list description/content");
const listStatusColorSchema = colorSchema.describe("Optional List color. ClickUp's List API calls this field `status`; it is not a task workflow status.");
const listPrioritySchema = z.number().int().min(1).max(4).optional().describe("Optional list priority number: 1 urgent, 2 high, 3 normal, 4 low");
const dateSchema = z.string().optional().describe("Optional ISO date string, converted to ClickUp's millisecond timestamp");

export function registerAdminToolsWrite(server: McpServer) {
  server.tool(
    "createSpace",
    [
      "Creates a new ClickUp Space in the configured Workspace using the official ClickUp API v2.",
      "Only use when the user explicitly wants a new Space/project container.",
      "The response includes the Space ID and URL; always mention both when referencing the created Space."
    ].join("\n"),
    {
      name: z.string().min(1).describe("The name of the Space to create"),
      multiple_assignees: z.boolean().optional().describe("Whether tasks in this Space can have multiple assignees"),
      private: z.boolean().optional().describe("Whether the Space should be private"),
      admin_can_manage: z.boolean().optional().describe("Whether admins can manage the private Space"),
      features: spaceFeaturesSchema,
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ name, multiple_assignees, private: isPrivate, admin_can_manage, features }) => {
      try {
        const body = removeUndefined({
          name,
          multiple_assignees,
          private: isPrivate,
          admin_can_manage,
          features,
        });

        const createdSpace = await clickUpFetch(`/team/${CONFIG.teamId}/space`, "POST", body, "creating space");

        return textResult(formatSpaceResponse(createdSpace, "created"));
      } catch (error) {
        console.error("Error creating space:", error);
        return errorResult("creating space", error);
      }
    }
  );

  server.tool(
    "updateSpace",
    [
      "Updates an existing ClickUp Space using the official ClickUp API v2.",
      "Use searchSpaces first if you need to confirm the Space ID.",
      "This tool does not manage task workflow statuses."
    ].join("\n"),
    {
      space_id: z.string().min(1).describe("The Space ID to update"),
      name: z.string().min(1).optional().describe("Optional new Space name"),
      color: colorSchema,
      multiple_assignees: z.boolean().optional().describe("Optional multiple-assignee setting"),
      private: z.boolean().optional().describe("Optional private setting"),
      admin_can_manage: z.boolean().optional().describe("Optional private-Space admin management setting"),
      features: spaceFeaturesSchema,
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ space_id, name, color, multiple_assignees, private: isPrivate, admin_can_manage, features }) => {
      try {
        const body = removeUndefined({
          name,
          color,
          multiple_assignees,
          private: isPrivate,
          admin_can_manage,
          features,
        });
        if (Object.keys(body).length === 0) {
          return textResult(["No updates provided. Please specify at least one Space field to update."]);
        }

        const updatedSpace = await clickUpFetch(`/space/${space_id}`, "PUT", body, "updating space");

        return textResult(formatSpaceResponse({ ...updatedSpace, id: updatedSpace.id || space_id }, "updated"));
      } catch (error) {
        console.error("Error updating space:", error);
        return errorResult("updating space", error);
      }
    }
  );

  server.tool(
    "createFolder",
    [
      "Creates a new Folder inside a ClickUp Space using the official ClickUp API v2.",
      "Use searchSpaces first if you need to confirm the Space ID.",
      "The response includes Folder and Space references with IDs."
    ].join("\n"),
    {
      space_id: z.string().min(1).describe("The Space ID where the Folder will be created"),
      name: z.string().min(1).describe("The name of the Folder to create"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ space_id, name }) => {
      try {
        const createdFolder = await clickUpFetch(`/space/${space_id}/folder`, "POST", { name }, "creating folder");

        return textResult(formatFolderResponse(createdFolder, "created", space_id));
      } catch (error) {
        console.error("Error creating folder:", error);
        return errorResult("creating folder", error);
      }
    }
  );

  server.tool(
    "updateFolder",
    [
      "Renames an existing ClickUp Folder using the official ClickUp API v2.",
      "Use searchSpaces first if you need to confirm the Folder ID.",
      "The response includes the Folder ID and URL."
    ].join("\n"),
    {
      folder_id: z.string().min(1).describe("The Folder ID to update"),
      name: z.string().min(1).describe("The new Folder name"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ folder_id, name }) => {
      try {
        const updatedFolder = await clickUpFetch(`/folder/${folder_id}`, "PUT", { name }, "updating folder");

        return textResult(formatFolderResponse({ ...updatedFolder, id: updatedFolder.id || folder_id }, "updated"));
      } catch (error) {
        console.error("Error updating folder:", error);
        return errorResult("updating folder", error);
      }
    }
  );

  server.tool(
    "createList",
    [
      "Creates a new ClickUp List using the official ClickUp API v2.",
      "Provide exactly one of space_id for a folderless List, or folder_id for a List inside a Folder.",
      "IMPORTANT: status_color maps to the ClickUp List API `status` field, which is the List color, not a task workflow status."
    ].join("\n"),
    {
      space_id: z.string().min(1).optional().describe("Create a folderless List in this Space ID. Mutually exclusive with folder_id."),
      folder_id: z.string().min(1).optional().describe("Create a List inside this Folder ID. Mutually exclusive with space_id."),
      name: z.string().min(1).describe("The name of the List to create"),
      content: listDescriptionSchema,
      status_color: listStatusColorSchema,
      due_date: dateSchema,
      due_date_time: z.boolean().optional().describe("Whether due_date includes a specific time"),
      priority: listPrioritySchema,
      assignee: z.string().optional().describe("Optional user ID for the List owner/assignee"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ space_id, folder_id, name, content, status_color, due_date, due_date_time, priority, assignee }) => {
      try {
        const targetError = validateListTarget(space_id, folder_id);
        if (targetError) {
          return textResult([targetError]);
        }

        const body = buildListRequestBody({ name, content, status_color, due_date, due_date_time, priority, assignee });
        const endpoint = space_id ? `/space/${space_id}/list` : `/folder/${folder_id}/list`;
        const createdList = await clickUpFetch(endpoint, "POST", body, "creating list");

        return textResult(formatListResponse(createdList, "created", { space_id, folder_id }));
      } catch (error) {
        console.error("Error creating list:", error);
        return errorResult("creating list", error);
      }
    }
  );

  server.tool(
    "updateList",
    [
      "Updates ClickUp List fields using the official ClickUp API v2.",
      "Use getListInfo first if you need current List context.",
      "IMPORTANT: status_color maps to the ClickUp List API `status` field, which is the List color, not a task workflow status."
    ].join("\n"),
    {
      list_id: z.string().min(1).describe("The List ID to update"),
      name: z.string().min(1).optional().describe("Optional new List name"),
      content: listDescriptionSchema,
      status_color: listStatusColorSchema,
      due_date: dateSchema,
      due_date_time: z.boolean().optional().describe("Whether due_date includes a specific time"),
      priority: listPrioritySchema,
      assignee: z.string().optional().describe("Optional user ID for the List owner/assignee"),
      unset_status: z.boolean().optional().describe("Optional official API flag for unsetting the List color/status"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ list_id, name, content, status_color, due_date, due_date_time, priority, assignee, unset_status }) => {
      try {
        const body = buildListRequestBody({ name, content, status_color, due_date, due_date_time, priority, assignee, unset_status });
        if (Object.keys(body).length === 0) {
          return textResult(["No updates provided. Please specify at least one List field to update."]);
        }

        const updatedList = await clickUpFetch(`/list/${list_id}`, "PUT", body, "updating list");

        return textResult(formatListResponse({ ...updatedList, id: updatedList.id || list_id }, "updated"));
      } catch (error) {
        console.error("Error updating list:", error);
        return errorResult("updating list", error);
      }
    }
  );
}

type HttpMethod = "POST" | "PUT";

async function clickUpFetch(path: string, method: HttpMethod, body: Record<string, unknown>, action: string): Promise<any> {
  const response = await fetch(`https://api.clickup.com/api/v2${path}`, {
    method,
    headers: {
      Authorization: CONFIG.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Error ${action}: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
  }

  return await response.json();
}

function buildListRequestBody(params: {
  name?: string;
  content?: string;
  status_color?: string;
  due_date?: string;
  due_date_time?: boolean;
  priority?: number;
  assignee?: string;
  unset_status?: boolean;
}): Record<string, unknown> {
  const body = removeUndefined({
    name: params.name,
    content: params.content,
    status: params.status_color,
    due_date: params.due_date ? new Date(params.due_date).getTime() : undefined,
    due_date_time: params.due_date_time,
    priority: params.priority,
    assignee: params.assignee,
    unset_status: params.unset_status,
  });

  return body;
}

function validateListTarget(spaceId?: string, folderId?: string): string | null {
  if ((spaceId && folderId) || (!spaceId && !folderId)) {
    return "Provide exactly one of space_id or folder_id when creating a List.";
  }

  return null;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function textResult(lines: string[]) {
  return {
    content: [
      {
        type: "text" as const,
        text: lines.join("\n"),
      },
    ],
  };
}

function errorResult(action: string, error: unknown) {
  return textResult([`Error ${action}: ${error instanceof Error ? error.message : "Unknown error"}`]);
}

function formatSpaceResponse(space: any, action: "created" | "updated"): string[] {
  const spaceId = space.id || "N/A";
  return [
    `Space ${action} successfully!`,
    `space_id: ${spaceId}`,
    `space_url: ${generateSpaceUrl(spaceId)}`,
    `name: ${space.name || "N/A"}`,
    ...(space.color ? [`color: ${space.color}`] : []),
    ...(space.private !== undefined ? [`private: ${space.private}`] : []),
  ];
}

function formatFolderResponse(folder: any, action: "created" | "updated", spaceId?: string): string[] {
  const folderId = folder.id || "N/A";
  return [
    `Folder ${action} successfully!`,
    `folder_id: ${folderId}`,
    `folder_url: ${generateFolderUrl(folderId)}`,
    `name: ${folder.name || "N/A"}`,
    ...(spaceId ? [`space_id: ${spaceId}`, `space_url: ${generateSpaceUrl(spaceId)}`] : []),
  ];
}

function formatListResponse(list: any, action: "created" | "updated", target?: { space_id?: string; folder_id?: string }): string[] {
  const listId = list.id || "N/A";
  const lines = [
    `List ${action} successfully!`,
    `list_id: ${listId}`,
    `list_url: ${generateListUrl(listId)}`,
    `name: ${list.name || "N/A"}`,
  ];

  if (target?.space_id) {
    lines.push(`space_id: ${target.space_id}`);
    lines.push(`space_url: ${generateSpaceUrl(target.space_id)}`);
  }

  if (target?.folder_id) {
    lines.push(`folder_id: ${target.folder_id}`);
    lines.push(`folder_url: ${generateFolderUrl(target.folder_id)}`);
  }

  if (list.status) {
    lines.push(`list_status_color: ${typeof list.status === "string" ? list.status : JSON.stringify(list.status)}`);
  }

  return lines;
}
