/**
 * Project-internal shapes for the OneDrive surface. These are intentionally a
 * SUBSET of the raw Microsoft Graph DriveItem — the adapter (onedrive.ts) maps
 * Graph's wide response envelope down to these so the rest of the app never
 * couples to Graph's field names.
 */
export interface DriveItem {
  id: string;
  name: string;
  /** true when this item is a folder. */
  isFolder: boolean;
  /** true when this item is a real, downloadable file (has Graph's `file` facet).
   *  Items that are neither folder nor file — OneNote notebooks, the Personal
   *  Vault, shortcuts — have no download URL and must NOT be rendered as
   *  download links (doing so navigates to a raw error). */
  isFile: boolean;
  /** child count for folders, undefined for files. */
  childCount?: number;
  /** size in bytes (files). */
  size: number;
  /** MIME type for files, undefined for folders. */
  mimeType?: string;
  /** ISO timestamp. */
  lastModified: string;
  /** Web URL to open the item in OneDrive's UI. */
  webUrl?: string;
  /** Path relative to the drive root, e.g. "/Documents/report.pdf". */
  path?: string;
  /** Graph item ID of the parent folder. Used to capture prior location for undo. */
  parentId?: string;
  /** Pre-authenticated thumbnail URL (short-lived, from Graph $expand=thumbnails). */
  thumbnailUrl?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch ms when the access token expires. */
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface MicrosoftUser {
  id: string;
  displayName: string | null;
  userPrincipalName: string | null;
}

/** Raw Graph DriveItem fields we read. Kept loose on purpose. */
export interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { path?: string; id?: string };
  "@microsoft.graph.downloadUrl"?: string;
  thumbnails?: Array<{
    medium?: { url?: string };
    small?: { url?: string };
  }>;
}
