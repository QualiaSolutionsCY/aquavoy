import {
  listChildren,
  search,
  downloadContent,
  createFolder as createFolderOnDrive,
  uploadFile,
  getDownloadUrl,
} from "@/lib/microsoft/onedrive";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import type { DriveItem } from "@/lib/microsoft/types";
import { buildSpreadsheet, type SheetSpec } from "@/lib/agents/spreadsheet";
import { tavilySearch } from "@/lib/agents/tavily";
import { recallMemory } from "@/lib/agents/memoryTools";
import { stagePendingAction } from "@/lib/agents/pendingActions";
import { loadAccountWithSecretByEmail, listAccounts } from "@/lib/mail/accounts";
import { listScheduled, cancelScheduled } from "@/lib/mail/scheduled";
import { scheduleTask, listTasks, cancelTask } from "@/lib/agents/scheduledTasks";
import { listFolders, listEmails, readEmail, searchEmails } from "@/lib/mail/imap";

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
        "List items in a OneDrive folder. Returns name, id, isFolder, size, and lastModified for each item. Omit folderId to list the root. For 'latest/newest/most recent file' questions, prefer navigating the folder structure (e.g. an invoices folder, then the newest year subfolder) and compare lastModified dates yourself.",
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
      name: "create_spreadsheet",
      description:
        "Generate a professionally-formatted Excel (.xlsx) spreadsheet from structured data, save it to OneDrive, and return a link the user can view/download. WORKFLOW: first gather the data the user wants with the OneDrive read tools (list_folder, search_files, read_file), then call this ONCE with columns + rows. Generating a sheet is additive and runs DIRECTLY — there is NO confirmation card. Returns JSON with fileName, webUrl (open in OneDrive), and downloadUrl. Relay the link to the user.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description:
              "File name for the spreadsheet (the .xlsx extension is added automatically if missing), e.g. 'Q1 Invoices'.",
          },
          sheets: {
            type: "array",
            description:
              "One or more sheets. Each sheet has a tab name, the column header labels, and the data rows (one array of cells per row, aligned to columns by position).",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Sheet tab name.",
                },
                columns: {
                  type: "array",
                  description: "Column header labels.",
                  items: { type: "string" },
                },
                rows: {
                  type: "array",
                  description:
                    "Data rows. Each row is an array of cell values (string or number) aligned to columns by index.",
                  items: {
                    type: "array",
                    items: { type: ["string", "number"] },
                  },
                },
              },
              required: ["name", "columns", "rows"],
              additionalProperties: false,
            },
          },
          parentId: {
            type: "string",
            description:
              "Optional Graph item ID of the destination folder. Omit to save to the OneDrive root.",
          },
        },
        required: ["filename", "sheets"],
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
        "Search through past conversation history to recall what was discussed before. Use this when the user references previous conversations or asks what was talked about earlier. Memory is automatically scoped to the current operator — you do not specify whose history to search.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term to find in past messages.",
          },
        },
        required: ["query"],
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

  // ── Schedule email ──
  {
    type: "function" as const,
    function: {
      name: "schedule_email",
      description:
        "Schedule an email to be sent at a future date/time. IMPORTANT: Before calling this tool, ALWAYS show the user the full draft (from, to, subject, body, scheduled time) in chat and wait for their EXPLICIT confirmation in a follow-up message. Never schedule without asking first.",
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "The sender email address — must match a connected mail account.",
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
          sendAt: {
            type: "string",
            description:
              "ISO-8601 datetime WITH timezone offset for when to send (e.g. 2026-06-12T09:00:00+02:00).",
          },
        },
        required: ["from", "to", "subject", "body", "sendAt"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_scheduled_emails",
      description:
        "List the most recent scheduled emails with their statuses (pending, sent, failed, cancelled).",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_scheduled_email",
      description:
        "Cancel a scheduled email by its ID. Only works if the email is still pending.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The UUID of the scheduled email to cancel.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },

  // ── Scheduled tasks / reminders ──
  {
    type: "function" as const,
    function: {
      name: "schedule_task",
      description:
        "Set a reminder that is EMAILED to a connected company mailbox at a future date/time. Use this when the user asks to be reminded of something (e.g. 'remind me tomorrow at 9 to call the harbour master'). Confirm the title and the exact time with the user in chat FIRST, but note this tool runs DIRECTLY — it is benign/additive and is NOT staged for confirmation (no confirm card). Do not call it before you have agreed the title and time with the user.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short reminder title — what to be reminded about.",
          },
          scheduledAt: {
            type: "string",
            description:
              "ISO-8601 datetime WITH timezone offset for when the reminder is sent, e.g. 2026-06-19T09:00:00+02:00.",
          },
          mailbox: {
            type: "string",
            description:
              "A connected company mailbox the reminder will be emailed to (e.g. info@aquavoy.com).",
          },
          notes: {
            type: "string",
            description: "Optional extra detail included in the reminder email body.",
          },
        },
        required: ["title", "scheduledAt", "mailbox"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_scheduled_tasks",
      description:
        "List the most recent reminders with their statuses (pending, sent, failed, cancelled).",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_scheduled_task",
      description:
        "Cancel a reminder by its ID. Only works if the reminder is still pending.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The UUID of the reminder to cancel.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },

  // ── Mailbox read (IMAP) ──
  {
    type: "function" as const,
    function: {
      name: "list_emails",
      description:
        "List the most recent emails in a connected mailbox folder. Returns uid, date, from, to, subject, and seen/unseen status. Newest first.",
      parameters: {
        type: "object",
        properties: {
          mailbox: {
            type: "string",
            description:
              "The email address of the connected mailbox (e.g. info@aquavoy.com).",
          },
          folder: {
            type: "string",
            description:
              'Folder hint: "inbox", "sent", "drafts", "trash", or an explicit IMAP path. Defaults to inbox.',
          },
          count: {
            type: "number",
            description: "Number of messages to return (max 25, default 15).",
          },
        },
        required: ["mailbox"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_email",
      description:
        "Read the full content of a single email by UID. Returns from, to, cc, date, subject, and plain-text body (capped at 12000 chars).",
      parameters: {
        type: "object",
        properties: {
          mailbox: {
            type: "string",
            description: "The email address of the connected mailbox.",
          },
          folder: {
            type: "string",
            description:
              'Folder hint: "inbox", "sent", "drafts", "trash", or an explicit IMAP path. Defaults to inbox.',
          },
          uid: {
            type: "number",
            description: "The UID of the message to read (from list_emails or search_emails results).",
          },
        },
        required: ["mailbox", "uid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_emails",
      description:
        "Search emails in a connected mailbox folder by text content, sender, and/or date. Returns matching envelope summaries, newest first.",
      parameters: {
        type: "object",
        properties: {
          mailbox: {
            type: "string",
            description: "The email address of the connected mailbox.",
          },
          folder: {
            type: "string",
            description:
              'Folder hint: "inbox", "sent", "drafts", "trash", or an explicit IMAP path. Defaults to inbox.',
          },
          query: {
            type: "string",
            description: "Free-text search across headers and body.",
          },
          from: {
            type: "string",
            description: "Filter by sender address or name.",
          },
          since: {
            type: "string",
            description: "Only messages after this ISO date (e.g. 2026-06-01).",
          },
          count: {
            type: "number",
            description: "Max results (max 25, default 15).",
          },
        },
        required: ["mailbox"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_mail_folders",
      description:
        "List all IMAP folders/mailboxes for a connected email account. Returns path, name, and special-use flags.",
      parameters: {
        type: "object",
        properties: {
          mailbox: {
            type: "string",
            description: "The email address of the connected mailbox.",
          },
        },
        required: ["mailbox"],
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
    // Dates let the model answer "latest/newest/last" correctly — search
    // ranking is by relevance, never by recency.
    ...(item.lastModified ? { lastModified: item.lastModified } : {}),
    ...(item.path ? { path: item.path } : {}),
  };
}

// ── Validate the model's spreadsheet args into SheetSpec[] ───
// The model supplies `sheets` as loosely-typed JSON; coerce + validate it into
// the strict shape buildSpreadsheet expects. Returns an Error (not thrown) so
// executeTool can surface a readable {error} string without crashing the turn.
function parseSheets(raw: unknown): SheetSpec[] | Error {
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Error("sheets must be a non-empty array");
  }
  const out: SheetSpec[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const s = raw[i] as Record<string, unknown> | null;
    if (!s || typeof s !== "object") return new Error(`sheet ${i + 1} is malformed`);
    const name = typeof s.name === "string" && s.name.trim() ? s.name : `Sheet ${i + 1}`;
    if (!Array.isArray(s.columns) || s.columns.length === 0) {
      return new Error(`sheet "${name}" needs a non-empty columns array`);
    }
    const columns = s.columns.map((c) => String(c));
    const rawRows = Array.isArray(s.rows) ? s.rows : [];
    const rows: (string | number)[][] = rawRows.map((row) => {
      const cells = Array.isArray(row) ? row : [];
      return cells.map((cell) =>
        typeof cell === "number" ? cell : cell == null ? "" : String(cell),
      );
    });
    out.push({ name, columns, rows });
  }
  return out;
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

  // .pdf — pdf-parse v2 uses a class-based API.
  // Wrapped so the read_file tool ALWAYS returns a non-empty, informative string
  // to the model: a parse failure (password-protected / corrupted / unsupported)
  // or an empty result (scanned, image-only PDF) must never surface as "no
  // response". Both branches return a human-readable sentinel instead of throwing
  // or returning "".
  if (lower.endsWith(".pdf")) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const buf = new Uint8Array(await response.arrayBuffer());
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();
      if (!result.text || !result.text.trim()) {
        return `[The PDF "${name}" contains no extractable text — it is most likely a scanned image. Text/OCR extraction is not available for scanned PDFs yet.]`;
      }
      return truncate(result.text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `[Could not read the PDF "${name}": ${message}. It may be password-protected, corrupted, or in an unsupported format.]`;
    }
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
  "create_spreadsheet",
  "move_item",
  "rename_item",
  "delete_item",
]);

// ── Destructive tools (staged, never executed in the model loop) ─
// Per ADR-003: these NEVER perform their side-effect inside executeTool. They
// stage a pending_actions row; the real effect runs only via the confirm
// endpoint → executeConfirmedAction. create_folder is additive/low-risk and is
// intentionally NOT in this set.
const DESTRUCTIVE = new Set([
  "send_email",
  "schedule_email",
  "delete_item",
  "move_item",
  "rename_item",
]);

/** Human-readable one-liner describing what a destructive action will do. */
function summarizeAction(name: string, args: Record<string, unknown>): string {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "send_email":
      return `Send email from ${s("from")} to ${s("to")} — "${s("subject")}"`;
    case "schedule_email":
      return `Schedule email from ${s("from")} to ${s("to")} — "${s("subject")}" at ${s("sendAt")}`;
    case "delete_item":
      return `Delete OneDrive item ${s("itemId")} (moves to recycle bin)`;
    case "move_item":
      return `Move OneDrive item ${s("itemId")} into folder ${s("newParentId")}`;
    case "rename_item":
      return `Rename OneDrive item ${s("itemId")} to "${s("newName")}"`;
    default:
      return `Run ${name}`;
  }
}

// ── Tool executor ────────────────────────────────────────────

/**
 * Execute a tool call by name. Returns a JSON string the model consumes as a
 * tool result message. Never throws — errors are returned as readable strings.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  connectionId?: string | null,
  sessionPrincipal?: string | null,
): Promise<string> {
  try {
    // Destructive actions are STAGED, never executed here (ADR-003). The model
    // has no code path to the side-effect — this gate is the enforcement, not
    // the system prompt. Fail closed without a verified session principal: the
    // staged row must be owned by the HMAC-verified identity, never a value the
    // model supplied (ADR-001 / REQ-3).
    if (DESTRUCTIVE.has(name)) {
      if (!sessionPrincipal)
        return JSON.stringify({ error: "no verified principal in session" });
      const summary = summarizeAction(name, args);
      const row = await stagePendingAction({
        principal: sessionPrincipal,
        tool: name,
        args,
        summary,
      });
      return JSON.stringify({
        status: "confirmation_required",
        action_id: row.id,
        summary,
      });
    }

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

      // ── OneDrive: generate spreadsheet (additive — runs DIRECTLY) ──
      // create_spreadsheet is additive/low-risk like create_folder: it creates a
      // NEW file and is intentionally NOT in the DESTRUCTIVE set, so it runs here
      // rather than being staged for confirmation.
      case "create_spreadsheet": {
        const filename = typeof args.filename === "string" ? args.filename.trim() : "";
        if (!filename) return JSON.stringify({ error: "filename is required" });

        const sheets = parseSheets(args.sheets);
        if (sheets instanceof Error) return JSON.stringify({ error: sheets.message });

        const parentId = typeof args.parentId === "string" && args.parentId
          ? args.parentId
          : undefined;

        const { buffer, fileName } = buildSpreadsheet({ filename, sheets });
        const item = await uploadFile(
          connId!,
          parentId ? { itemId: parentId } : {},
          fileName,
          buffer,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        // Graph exposes a short-lived pre-authenticated download URL separately
        // from the item metadata; resolve it so the user can download directly.
        let downloadUrl: string | null = null;
        try {
          downloadUrl = await getDownloadUrl(connId!, item.id);
        } catch {
          // Non-fatal: the webUrl still lets the user open & download from OneDrive.
        }
        return JSON.stringify({
          created: true,
          fileName: item.name,
          webUrl: item.webUrl ?? null,
          downloadUrl,
        });
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
        // Principal is pinned to the HMAC-verified session identity passed in by
        // the caller — NEVER args.principal. The model cannot read another
        // operator's memory by naming them in the tool call (REQ-3 / ADR-001).
        // Fail closed if there is no verified session principal.
        if (!sessionPrincipal)
          return JSON.stringify({ error: "no verified principal in session" });
        if (!query) return JSON.stringify({ error: "query is required" });
        return await recallMemory(query, sessionPrincipal);
      }

      case "list_scheduled_emails": {
        // Principal isolation (REQ-3): only the session principal's own queue.
        if (!sessionPrincipal)
          return JSON.stringify({ error: "no verified principal in session" });
        const emails = await listScheduled(sessionPrincipal);
        const summary = emails.map((e) => ({
          id: e.id,
          from: e.fromEmail,
          to: e.toEmail,
          subject: e.subject,
          scheduledAt: e.scheduledAt,
          status: e.status,
          sentAt: e.sentAt,
          error: e.error,
        }));
        return JSON.stringify(summary);
      }

      case "cancel_scheduled_email": {
        // Principal isolation (REQ-3): an operator can only cancel their own.
        if (!sessionPrincipal)
          return JSON.stringify({ error: "no verified principal in session" });
        const id = typeof args.id === "string" ? args.id : "";
        if (!id) return JSON.stringify({ error: "id is required" });
        const row = await cancelScheduled(id, sessionPrincipal);
        return JSON.stringify({ cancelled: true, id: row.id, status: row.status });
      }

      // ── Scheduled tasks / reminders ──
      // schedule_task is benign/additive (like create_folder): it runs DIRECTLY
      // here and is intentionally NOT in the DESTRUCTIVE set — no confirm card.
      case "schedule_task": {
        // Principal isolation (REQ-3): the row is owned by the HMAC-verified
        // session principal, never a value the model supplied.
        if (!sessionPrincipal)
          return JSON.stringify({ error: "no verified principal in session" });
        const title = typeof args.title === "string" ? args.title : "";
        const scheduledAt = typeof args.scheduledAt === "string" ? args.scheduledAt : "";
        const mailbox = typeof args.mailbox === "string" ? args.mailbox : "";
        if (!title) return JSON.stringify({ error: "title is required" });
        if (!scheduledAt) return JSON.stringify({ error: "scheduledAt is required" });
        if (!mailbox) return JSON.stringify({ error: "mailbox is required" });
        const notes = typeof args.notes === "string" ? args.notes : undefined;
        const task = await scheduleTask({
          principal: sessionPrincipal,
          mailbox,
          title,
          notes,
          scheduledAt,
        });
        return JSON.stringify({
          scheduled: true,
          id: task.id,
          scheduledAt: task.scheduledAt,
        });
      }

      case "list_scheduled_tasks": {
        // Principal isolation (REQ-3): only the session principal's own reminders.
        if (!sessionPrincipal)
          return JSON.stringify({ error: "no verified principal in session" });
        const tasks = await listTasks(sessionPrincipal);
        const summary = tasks.map((t) => ({
          id: t.id,
          title: t.title,
          mailbox: t.mailbox,
          scheduledAt: t.scheduledAt,
          status: t.status,
          sentAt: t.sentAt,
          error: t.error,
        }));
        return JSON.stringify(summary);
      }

      case "cancel_scheduled_task": {
        // Principal isolation (REQ-3): an operator can only cancel their own.
        if (!sessionPrincipal)
          return JSON.stringify({ error: "no verified principal in session" });
        const id = typeof args.id === "string" ? args.id : "";
        if (!id) return JSON.stringify({ error: "id is required" });
        const row = await cancelTask(id, sessionPrincipal);
        return JSON.stringify({ cancelled: true, id: row.id, status: row.status });
      }

      // ── Mailbox read (IMAP) ──
      case "list_emails": {
        const mailbox = typeof args.mailbox === "string" ? args.mailbox : "";
        if (!mailbox) return JSON.stringify({ error: "mailbox (email address) is required" });
        const acct = await loadAccountWithSecretByEmail(mailbox);
        if (!acct) {
          const accounts = await listAccounts();
          return JSON.stringify({
            error: `No connected mail account for "${mailbox}".`,
            connected_addresses: accounts.map((a) => a.email),
            hint: "Tell the user which addresses are available and ask them to pick one.",
          });
        }
        const folder = typeof args.folder === "string" ? args.folder : undefined;
        const count = typeof args.count === "number" ? args.count : undefined;
        const emails = await listEmails(mailbox, folder, count);
        return JSON.stringify(emails);
      }

      case "read_email": {
        const mailbox = typeof args.mailbox === "string" ? args.mailbox : "";
        const uid = typeof args.uid === "number" ? args.uid : Number(args.uid);
        if (!mailbox || !uid || isNaN(uid))
          return JSON.stringify({ error: "mailbox and uid are required" });
        const acct2 = await loadAccountWithSecretByEmail(mailbox);
        if (!acct2) {
          const accounts = await listAccounts();
          return JSON.stringify({
            error: `No connected mail account for "${mailbox}".`,
            connected_addresses: accounts.map((a) => a.email),
          });
        }
        const folder = typeof args.folder === "string" ? args.folder : undefined;
        const detail = await readEmail(mailbox, folder, uid);
        return JSON.stringify(detail);
      }

      case "search_emails": {
        const mailbox = typeof args.mailbox === "string" ? args.mailbox : "";
        if (!mailbox) return JSON.stringify({ error: "mailbox (email address) is required" });
        const acct3 = await loadAccountWithSecretByEmail(mailbox);
        if (!acct3) {
          const accounts = await listAccounts();
          return JSON.stringify({
            error: `No connected mail account for "${mailbox}".`,
            connected_addresses: accounts.map((a) => a.email),
          });
        }
        const folder = typeof args.folder === "string" ? args.folder : undefined;
        const query = typeof args.query === "string" ? args.query : undefined;
        const from = typeof args.from === "string" ? args.from : undefined;
        const since = typeof args.since === "string" ? args.since : undefined;
        const count = typeof args.count === "number" ? args.count : undefined;
        const results = await searchEmails(
          mailbox,
          folder,
          { text: query, from, since },
          count,
        );
        return JSON.stringify(results);
      }

      case "list_mail_folders": {
        const mailbox = typeof args.mailbox === "string" ? args.mailbox : "";
        if (!mailbox) return JSON.stringify({ error: "mailbox (email address) is required" });
        const acct4 = await loadAccountWithSecretByEmail(mailbox);
        if (!acct4) {
          const accounts = await listAccounts();
          return JSON.stringify({
            error: `No connected mail account for "${mailbox}".`,
            connected_addresses: accounts.map((a) => a.email),
          });
        }
        const folders = await listFolders(mailbox);
        return JSON.stringify(folders);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return JSON.stringify({ error: message });
  }
}
