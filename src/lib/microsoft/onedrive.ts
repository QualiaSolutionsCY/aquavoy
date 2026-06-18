import { graphJson, graphRaw } from "./graph";
import type { DriveItem, GraphDriveItem } from "./types";

/**
 * OneDrive file operations, expressed in project-internal DriveItem terms. This
 * is the seam the rest of Aquavoy uses; route handlers stay thin wiring around
 * these calls. Covers the full read + write + browse surface:
 * list · get · download · upload (small & chunked) · folder · delete · rename
 * · move · copy · search.
 *
 * Addressing: items are referenced either by Graph item id, or by a
 * drive-root-relative path like "/Documents/Q3". `itemRef` builds the right
 * Graph URL segment for each.
 */

const SMALL_UPLOAD_MAX = 4 * 1024 * 1024; // 4 MiB — Graph's simple-PUT ceiling.
const CHUNK_SIZE = 5 * 1024 * 1024; // multiple of 320 KiB, per Graph guidance.

const SELECT =
  "id,name,size,webUrl,lastModifiedDateTime,folder,file,parentReference";

function map(raw: GraphDriveItem): DriveItem {
  // parentReference.path looks like "/drive/root:/Documents"; strip the prefix.
  const parent = raw.parentReference?.path?.replace(/^\/drive\/root:?/, "") ?? "";
  const path = `${parent}/${raw.name}`.replace(/\/+/g, "/");
  // Prefer medium thumbnail, fall back to small.
  const thumb = raw.thumbnails?.[0];
  const thumbnailUrl = thumb?.medium?.url ?? thumb?.small?.url;
  return {
    id: raw.id,
    name: raw.name,
    isFolder: Boolean(raw.folder),
    isFile: Boolean(raw.file),
    childCount: raw.folder?.childCount,
    size: raw.size ?? 0,
    mimeType: raw.file?.mimeType,
    lastModified: raw.lastModifiedDateTime ?? "",
    webUrl: raw.webUrl,
    path,
    parentId: raw.parentReference?.id,
    thumbnailUrl,
  };
}

/** Build the Graph URL segment that addresses an item by id or by path. */
function itemRef(ref: { itemId?: string; path?: string }): string {
  if (ref.itemId) return `/me/drive/items/${encodeURIComponent(ref.itemId)}`;
  const path = (ref.path ?? "").replace(/^\/+/, "");
  if (!path) return "/me/drive/root";
  return `/me/drive/root:/${path.split("/").map(encodeURIComponent).join("/")}:`;
}

/** List children of a folder (root by default). */
export async function listChildren(
  connectionId: string,
  ref: { itemId?: string; path?: string } = {},
): Promise<DriveItem[]> {
  const base = itemRef(ref);
  // For path-addressed folders Graph needs the children suffix without a 2nd colon.
  const suffix = base.endsWith(":") ? "/children" : "/children";
  const data = await graphJson<{ value: GraphDriveItem[] }>(connectionId, {
    path: `${base}${suffix}?$select=${SELECT}&$expand=thumbnails&$top=200`,
  });
  return data.value.map(map);
}

/** Fetch a single item's metadata. */
export async function getItem(
  connectionId: string,
  ref: { itemId?: string; path?: string },
): Promise<DriveItem> {
  const data = await graphJson<GraphDriveItem>(connectionId, {
    path: `${itemRef(ref)}?$select=${SELECT}`,
  });
  return map(data);
}

/**
 * Resolve a short-lived, pre-authenticated download URL for a file. Returning
 * the URL (rather than proxying bytes) lets the caller stream directly from
 * Microsoft's CDN.
 */
export async function getDownloadUrl(connectionId: string, itemId: string): Promise<string> {
  const data = await graphJson<GraphDriveItem>(connectionId, {
    path: `/me/drive/items/${encodeURIComponent(itemId)}?$select=id,@microsoft.graph.downloadUrl`,
  });
  const url = data["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error("Item has no download URL (is it a folder?).");
  return url;
}

/** Stream a file's content through Graph (alternative to the CDN redirect). */
export function downloadContent(connectionId: string, itemId: string): Promise<Response> {
  return graphRaw(connectionId, {
    path: `/me/drive/items/${encodeURIComponent(itemId)}/content`,
  });
}

/**
 * Upload a file to `parent` (folder path or id) under `name`. Chooses a simple
 * PUT for small files and a resumable upload session for large ones.
 */
export async function uploadFile(
  connectionId: string,
  parent: { itemId?: string; path?: string },
  name: string,
  data: ArrayBuffer | Uint8Array,
  contentType = "application/octet-stream",
): Promise<DriveItem> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength <= SMALL_UPLOAD_MAX) {
    return uploadSmall(connectionId, parent, name, bytes, contentType);
  }
  return uploadLarge(connectionId, parent, name, bytes);
}

async function uploadSmall(
  connectionId: string,
  parent: { itemId?: string; path?: string },
  name: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<DriveItem> {
  // Address the destination as parent + ":/name:" then "/content".
  const base = itemRef(parent);
  const dest = base.endsWith(":")
    ? `${base.slice(0, -1)}/${encodeURIComponent(name)}:`
    : `${base}:/${encodeURIComponent(name)}:`;
  const raw = await graphJson<GraphDriveItem>(connectionId, {
    method: "PUT",
    path: `${dest}/content`,
    headers: { "Content-Type": contentType },
    body: bytes as unknown as BodyInit,
  });
  return map(raw);
}

async function uploadLarge(
  connectionId: string,
  parent: { itemId?: string; path?: string },
  name: string,
  bytes: Uint8Array,
): Promise<DriveItem> {
  const base = itemRef(parent);
  const dest = base.endsWith(":")
    ? `${base.slice(0, -1)}/${encodeURIComponent(name)}:`
    : `${base}:/${encodeURIComponent(name)}:`;
  const session = await graphJson<{ uploadUrl: string }>(connectionId, {
    method: "POST",
    path: `${dest}/createUploadSession`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });

  const total = bytes.byteLength;
  let offset = 0;
  let last: GraphDriveItem | null = null;
  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const chunk = bytes.subarray(offset, end);
    // The upload session URL is pre-authenticated; call it directly.
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
      },
      body: chunk as unknown as BodyInit,
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`Chunk upload failed at ${offset}: ${res.status} ${res.statusText}`);
    }
    if (res.status !== 202) last = (await res.json()) as GraphDriveItem;
    offset = end;
  }
  if (!last) throw new Error("Upload session completed without returning an item.");
  return map(last);
}

/** Create a folder under `parent`. */
export async function createFolder(
  connectionId: string,
  parent: { itemId?: string; path?: string },
  name: string,
): Promise<DriveItem> {
  const base = itemRef(parent);
  const path = base.endsWith(":") ? `${base}/children` : `${base}/children`;
  const raw = await graphJson<GraphDriveItem>(connectionId, {
    method: "POST",
    path,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename",
    }),
  });
  return map(raw);
}

/** Permanently delete (moves to recycle bin) an item. */
export async function deleteItem(connectionId: string, itemId: string): Promise<void> {
  await graphJson<void>(connectionId, {
    method: "DELETE",
    path: `/me/drive/items/${encodeURIComponent(itemId)}`,
  });
}

/** Rename and/or move an item. Pass `newParentId` to move, `newName` to rename. */
export async function updateItem(
  connectionId: string,
  itemId: string,
  changes: { newName?: string; newParentId?: string },
): Promise<DriveItem> {
  const body: Record<string, unknown> = {};
  if (changes.newName) body.name = changes.newName;
  if (changes.newParentId) body.parentReference = { id: changes.newParentId };
  const raw = await graphJson<GraphDriveItem>(connectionId, {
    method: "PATCH",
    path: `/me/drive/items/${encodeURIComponent(itemId)}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return map(raw);
}

/** Copy an item into `targetParentId` (async on Graph's side; returns immediately). */
export async function copyItem(
  connectionId: string,
  itemId: string,
  targetParentId: string,
  newName?: string,
): Promise<void> {
  await graphRaw(connectionId, {
    method: "POST",
    path: `/me/drive/items/${encodeURIComponent(itemId)}/copy`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parentReference: { id: targetParentId },
      ...(newName ? { name: newName } : {}),
    }),
  });
}

/** Full-text search across the drive. */
export async function search(connectionId: string, query: string): Promise<DriveItem[]> {
  const q = encodeURIComponent(query.replace(/'/g, "''"));
  const data = await graphJson<{ value: GraphDriveItem[] }>(connectionId, {
    path: `/me/drive/root/search(q='${q}')?$select=${SELECT}&$expand=thumbnails&$top=100`,
  });
  return data.value.map(map);
}
