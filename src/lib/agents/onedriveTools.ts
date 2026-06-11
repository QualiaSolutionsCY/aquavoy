import {
  listChildren,
  search,
  downloadContent,
  createFolder as createFolderOnDrive,
  updateItem,
  deleteItem as deleteItemOnDrive,
} from "@/lib/microsoft/onedrive";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import type { DriveItem } from "@/lib/microsoft/types";
import { tavilySearch } from "@/lib/agents/tavily";
import { recallMemory } from "@/lib/agents/memoryTools";
import { loadAccountWithSecretByEmail, listAccounts } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";

/**
 * Tool definitions (OpenAI function-calling JSON schema) and executor for the
 * Aquavoy agent. Covers OneDrive browsing/reading/organization, web research
 * (Tavily), memory recall, and email sending.
 */

// ── Text extraction constants ────────────────────────────────
const TEXT_CAP = 12_000;
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm",
  ".js", ".ts", ".jsx", ".tsx", ".py", ".sh", ".bash", ".yml", ".yaml",
  ".toml", ".ini", ".cfg", ".conf", ".log", ".sql", ".env", ".css",
  ".scss", ".less", ".svelte", ".vue", ".rb", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".pl", ".r", ".swift",
]);

function isTextLike(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function isExcel(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}

function truncate(text: string): string {
  if (text.length <= TEXT_CAP) return text;
  return text.slice(0, TEXT_CAP) + "\n\n(truncated)";
}

// ── Tool definitions (OpenAI function-calling schema) ────────

export const TOOL_DEFINITIONS = [
  // ── OneDrive: browse & read ──
  {
    type: "function" as const,
    function: {
      name: "list_folder",
      description:
        "List items in a OneDrive folder. Returns name, id, isFolder, and size for each item. Omit folderId to list the root.",
      parameters: {
        type: "object",
        properties: {
          folderId: {
            type: "string",
            description:
              "The Graph item ID of the folder to list. Omit or leave empty for root.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_files",
      description:
        "Full-text search across the user's OneDrive. Returns matching files with name, id, path, and size.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        "Download a file from OneDrive and extract its text content. Supports .docx (via mammoth), .pdf (via pdf-parse), .xlsx/.xls (spreadsheets — all sheets as CSV), and text-like files (txt, md, csv, json, code files, etc.). Returns extracted text capped at ~12000 chars. For unsupported binary formats returns a message instead of content.",
      parameters: {
        type: "object",
        properties: {
          itemId: {
            type: "string",
            description: "The Graph item ID of the file to read.",
          },
        },
        required: ["itemId"],
        additionalProperties: false,
      },
    },
  },

  // ── OneDrive: file organization ──
  {
    type: "function" as const,
    function: {
      name: "create_folder",
      description:
        "Create a new folder in OneDrive. Returns the created folder's name and id. Always propose the plan to the user and get confirmation before creating folders.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the new folder.",
          },
          parentId: {
            type: "string",
            description:
              "Graph item ID of the parent folder. Omit for root.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_item",
      description:
        "Move a file or folder to a different parent folder. Always propose the move to the user and get confirmation first.",
      parameters: {
        type: "object",
        properties: {
          itemId: {
            type: "string",
            description: "Graph item ID of the item to move.",
          },
          newParentId: {
            type: "string",
            description: "Graph item ID of the destination folder.",
          },
        },
        required: ["itemId", "newParentId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "rename_item",
      description:
        "Rename a file or folder. Always propose the rename to the user and get confirmation first.",
      parameters: {
        type: "object",
        properties: {
          itemId: {
            type: "string",
            description: "Graph item ID of the item to rename.",
          },
          newName: {
            type: "string",
            description: "The new name for the item.",
          },
        },
        required: ["itemId", "newName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_item",
      description:
        "Delete a file or folder (moves to recycle bin). NEVER call this without first naming the exact file to the user and getting explicit confirmation.",
      parameters: {
        type: "object",
        properties: {
          itemId: {
            type: "string",
            description: "Graph item ID of the item to delete.",
          },
        },
        required: ["itemId"],
        additionalProperties: false,
      },
    },
  },

  // ── Web research (Tavily) ──
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web for up-to-date information using Tavily. Returns an AI-generated answer plus the top source results with titles, URLs, and content snippets. Use this when the user asks about current events, facts, prices, news, or anything that might need live data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },

  // ── Memory recall ──
  {
    type: "function" as const,
    function: {
      name: "recall_memory",
      description:
        "Search through past conversation history to recall what was discussed before. Use this when the user references previous conversations or asks what was talked about earlier.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term to find in past messages.",
          },
          principal: {
            type: "string",
            description: "The name of the person whose history to search (Wency or Jeanette).",
          },
        },
        required: ["query", "principal"],
        additionalProperties: false,
      },
    },
  },

  // ── Send email ──
  {
    type: "function" as const,
    function: {
      name: "send_email",
      description:
        "Send an email from one of the connected mail accounts. IMPORTANT: Before calling this tool, you MUST first show the user the complete draft (from, to, subject, body) in a chat message and wait for their explicit confirmation in a follow-up message. Never send without confirmation.",
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description:
              "The sender email address — must match a connected mail account.",
          },
          to: {
            type: "string",
            description: "Recipient email address.",
          },
          subject: {
            type: "string",
            description: "Email subject line.",
          },
          body: {
            type: "string",
            description: "Email body (plain text).",
          },
        },
        required: ["from", "to", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
];

// ── Slim DriveItem projection for tool results ───────────────

function slimItem(item: DriveItem) {
  return {
    name: item.name,
    id: item.id,
    isFolder: item.isFolder,
    size: item.size,
    ...(item.path ? { path: item.path } : {}),
  };
}

// ── Text extraction from downloaded bytes ────────────────────

async function extractText(
  name: string,
  response: Response,
): Promise<string> {
  const lower = name.toLowerCase();

  // .docx — mammoth converts to plain text
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const buf = Buffer.from(await response.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer: buf });
    return truncate(result.value);
  }

  // .pdf — pdf-parse v2 uses a class-based API
  if (lower.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const buf = new Uint8Array(await response.arrayBuffer());
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    return truncate(result.text);
  }

  // .xlsx / .xls — extract all sheets as CSV
  if (isExcel(lower)) {
    const XLSX = await import("xlsx");
    const buf = new Uint8Array(await response.arrayBuffer());
    const workbook = XLSX.read(buf, { type: "array" });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      parts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
    }
    return truncate(parts.join("\n\n"));
  }

  // Text-like files — decode as UTF-8
  if (isTextLike(lower)) {
    const buf = await response.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return truncate(text);
  }

  // Unsupported binary
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "(unknown)";
  return `Cannot extract text from ${ext} file "${name}". This is a binary format that the assistant cannot read directly.`;
}

// ── Resolve connection (with friendly no-connection message) ─

const NO_CONNECTION_MSG =
  "No OneDrive account is connected. Please ask the user to connect their OneDrive on the Files tab before you can browse or read files.";

async function safeResolveConnection(): Promise<string | null> {
  try {
    return await resolveConnectionId();
  } catch {
    return null;
  }
}

// ── Tools that need OneDrive connection ─────────────────────
const ONEDRIVE_TOOLS = new Set([
  "list_folder",
  "search_files",
  "read_file",
  "create_folder",
  "move_item",
  "rename_item",
  "delete_item",
]);

// ── Tool executor ────────────────────────────────────────────

/**
 * Execute a tool call by name. Returns a JSON string the model consumes as a
 * tool result message. Never throws — errors are returned as readable strings.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  connectionId?: string | null,
): Promise<string> {
  try {
    // OneDrive tools need a connection; others don't.
    let connId: string | null = null;
    if (ONEDRIVE_TOOLS.has(name)) {
      connId = connectionId ?? (await safeResolveConnection());
      if (!connId) return NO_CONNECTION_MSG;
    }

    switch (name) {
      // ── OneDrive: browse & read ──
      case "list_folder": {
        const folderId = typeof args.folderId === "string" && args.folderId
          ? args.folderId
          : undefined;
        const items = await listChildren(connId!, folderId ? { itemId: folderId } : {});
        return JSON.stringify(items.map(slimItem));
      }

      case "search_files": {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) return JSON.stringify({ error: "search query is required" });
        const items = await search(connId!, query);
        return JSON.stringify(items.map(slimItem));
      }

      case "read_file": {
        const itemId = typeof args.itemId === "string" ? args.itemId : "";
        if (!itemId) return JSON.stringify({ error: "itemId is required" });
        const res = await downloadContent(connId!, itemId);
        const disposition = res.headers.get("content-disposition") ?? "";
        const nameMatch = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
        let fileName = nameMatch?.[1] ?? "";
        if (!fileName) {
          const { getItem } = await import("@/lib/microsoft/onedrive");
          const meta = await getItem(connId!, { itemId });
          fileName = meta.name;
        }
        const text = await extractText(fileName, res);
        return JSON.stringify({ fileName, content: text });
      }

      // ── OneDrive: file organization ──
      case "create_folder": {
        const folderName = typeof args.name === "string" ? args.name : "";
        if (!folderName) return JSON.stringify({ error: "folder name is required" });
        const parentId = typeof args.parentId === "string" && args.parentId
          ? args.parentId
          : undefined;
        const folder = await createFolderOnDrive(
          connId!,
          parentId ? { itemId: parentId } : {},
          folderName,
        );
        return JSON.stringify(slimItem(folder));
      }

      case "move_item": {
        const itemId = typeof args.itemId === "string" ? args.itemId : "";
        const newParentId = typeof args.newParentId === "string" ? args.newParentId : "";
        if (!itemId || !newParentId)
          return JSON.stringify({ error: "itemId and newParentId are required" });
        const moved = await updateItem(connId!, itemId, { newParentId });
        return JSON.stringify(slimItem(moved));
      }

      case "rename_item": {
        const itemId = typeof args.itemId === "string" ? args.itemId : "";
        const newName = typeof args.newName === "string" ? args.newName : "";
        if (!itemId || !newName)
          return JSON.stringify({ error: "itemId and newName are required" });
        const renamed = await updateItem(connId!, itemId, { newName });
        return JSON.stringify(slimItem(renamed));
      }

      case "delete_item": {
        const itemId = typeof args.itemId === "string" ? args.itemId : "";
        if (!itemId) return JSON.stringify({ error: "itemId is required" });
        await deleteItemOnDrive(connId!, itemId);
        return JSON.stringify({ deleted: true, itemId });
      }

      // ── Web research (Tavily) ──
      case "web_search": {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query) return JSON.stringify({ error: "search query is required" });
        const result = await tavilySearch(query);
        return JSON.stringify(result);
      }

      // ── Memory recall ──
      case "recall_memory": {
        const query = typeof args.query === "string" ? args.query : "";
        const principal = typeof args.principal === "string" ? args.principal : "";
        if (!query || !principal)
          return JSON.stringify({ error: "query and principal are required" });
        return await recallMemory(query, principal);
      }

      // ── Send email ──
      case "send_email": {
        const from = typeof args.from === "string" ? args.from : "";
        const to = typeof args.to === "string" ? args.to : "";
        const subject = typeof args.subject === "string" ? args.subject : "";
        const body = typeof args.body === "string" ? args.body : "";
        if (!from || !to || !subject || !body)
          return JSON.stringify({ error: "from, to, subject, and body are all required" });

        const account = await loadAccountWithSecretByEmail(from);
        if (!account) {
          const accounts = await listAccounts();
          const connected = accounts.map((a) => a.email);
          return JSON.stringify({
            error: `No connected mail account for "${from}".`,
            connected_addresses: connected,
            hint: "Tell the user which addresses are available and ask them to pick one.",
          });
        }

        await sendMail({ account, to, subject, body });
        return JSON.stringify({ sent: true, from: account.email, to, subject });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return JSON.stringify({ error: message });
  }
}
