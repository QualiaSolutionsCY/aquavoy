"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  Folder, FileText, FileSpreadsheet, Image as ImageIcon, Presentation,
  FileArchive, Music, Video, File as FileGeneric, FolderOpen,
  type LucideIcon,
} from "lucide-react";
import type { DriveItem } from "@/lib/microsoft/types";

interface Connection {
  id: string;
  displayName: string | null;
  userPrincipalName: string | null;
}

interface Crumb {
  id?: string;
  name: string;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as Envelope<T>;
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function fmtSize(n: number): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/* Map a drive item to a lucide file-type icon — one consistent line-icon family
   gives the drive console real iconography (graphics.md) instead of OS-variable
   emoji or one generic page icon for every file. */
function fileIconFor(item: DriveItem): LucideIcon {
  if (item.isFolder) return Folder;
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = item.mimeType ?? "";
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return Video;
  if (mime.startsWith("audio/")) return Music;
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return FileSpreadsheet;
  if (["doc", "docx", "odt", "rtf", "pdf", "txt", "md"].includes(ext)) return FileText;
  if (["ppt", "pptx", "key"].includes(ext)) return Presentation;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  return FileGeneric;
}

export default function Home() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConn, setActiveConn] = useState<string>("");
  const [items, setItems] = useState<DriveItem[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ name: "OneDrive" }]);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const currentFolderId = crumbs[crumbs.length - 1]?.id;

  const loadConnections = useCallback(async () => {
    const list = await api<Connection[]>("/api/onedrive/connections");
    setConnections(list);
    setActiveConn((prev) => prev || list[0]?.id || "");
    return list;
  }, []);

  const loadFolder = useCallback(
    async (conn: string, folderId?: string) => {
      if (!conn) return;
      setBusy(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ connectionId: conn });
        if (folderId) qs.set("itemId", folderId);
        setItems(await api<DriveItem[]>(`/api/onedrive/files?${qs}`));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Surface connect/error feedback from the OAuth redirect, then load state.
  useEffect(() => {
    async function init() {
      const url = new URL(window.location.href);
      const err = url.searchParams.get("error");
      const connected = url.searchParams.get("connected");
      if (err) setError(err);
      if (connected) setNotice("OneDrive connected.");
      if (err || connected) window.history.replaceState({}, "", url.pathname);
      try {
        const list = await loadConnections();
        const conn = connected || list[0]?.id;
        if (conn) loadFolder(conn);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setInitializing(false);
      }
    }
    init();
  }, [loadConnections, loadFolder]);

  const openFolder = (item: DriveItem) => {
    const next = [...crumbs, { id: item.id, name: item.name }];
    setCrumbs(next);
    loadFolder(activeConn, item.id);
  };

  const goCrumb = (idx: number) => {
    const next = crumbs.slice(0, idx + 1);
    setCrumbs(next);
    loadFolder(activeConn, next[next.length - 1]?.id);
  };

  const onConnChange = (id: string) => {
    setActiveConn(id);
    setCrumbs([{ name: "OneDrive" }]);
    loadFolder(id);
  };

  const refresh = () => loadFolder(activeConn, currentFolderId);

  const run = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(okMsg);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onUpload = (file: File) =>
    run(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("connectionId", activeConn);
      if (currentFolderId) fd.set("parentItemId", currentFolderId);
      await api<DriveItem>("/api/onedrive/upload", { method: "POST", body: fd });
    }, `Uploaded ${file.name}`);

  const onNewFolder = () => {
    const name = window.prompt("New folder name:");
    if (!name) return;
    run(
      () =>
        api<DriveItem>("/api/onedrive/folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId: activeConn, parentItemId: currentFolderId, name }),
        }).then(() => undefined),
      `Created ${name}`,
    );
  };

  const onDelete = (item: DriveItem) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    run(
      () =>
        api(`/api/onedrive/item?connectionId=${activeConn}&itemId=${item.id}`, {
          method: "DELETE",
        }).then(() => undefined),
      `Deleted ${item.name}`,
    );
  };

  const onSearch = async () => {
    if (!query.trim()) return refresh();
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ connectionId: activeConn, q: query });
      setItems(await api<DriveItem[]>(`/api/onedrive/search?${qs}`));
      setCrumbs([{ name: `Search: "${query}"` }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connected = connections.length > 0;

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>OneDrive</h1>
          <div className="tag">Microsoft Graph file console</div>
        </div>
        <div className="row">
          <a className={connected ? "btn ghost" : "btn"} href="/api/onedrive/connect">
            {connected ? "+ Connect account" : "Connect OneDrive"}
          </a>
        </div>
      </div>

      {error && (
        <div className="notice err" role="alert">
          Couldn’t reach the drive — the request was refused.{" "}
          <button
            className="btn ghost sm"
            onClick={() => {
              setError(null);
              if (activeConn) {
                loadFolder(activeConn, currentFolderId);
              } else {
                loadConnections()
                  .then((list) => {
                    const first = list[0]?.id;
                    if (first) loadFolder(first);
                  })
                  .catch((e) => setError((e as Error).message));
              }
            }}
          >
            Retry
          </button>
        </div>
      )}
      {notice && (
        <div className="notice ok" role="status">
          {notice}
        </div>
      )}

      {initializing ? (
        <div className="list" aria-busy="true" aria-label="Loading OneDrive accounts">
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton icon" />
              <span className="skeleton" style={{ width: `${72 - i * 9}%` }} />
              <span className="skeleton meta" />
            </div>
          ))}
        </div>
      ) : !connected ? (
        <div className="empty">
          No OneDrive account connected yet. Click <strong>Connect OneDrive</strong> to
          authorize via Microsoft and bring the company drive aboard.
        </div>
      ) : (
        <>
          <div className="bar">
            <select
              value={activeConn}
              onChange={(e) => onConnChange(e.target.value)}
              aria-label="Select OneDrive account"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName ?? c.userPrincipalName ?? c.id}
                </option>
              ))}
            </select>
            <input
              placeholder="Search drive…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              aria-label="Search files"
            />
            <button className="btn ghost" onClick={onSearch} disabled={busy}>
              Search
            </button>
            <button className="btn ghost" onClick={onNewFolder} disabled={busy}>
              New folder
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              Upload
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
          </div>

          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && " / "}
                <span
                  className="b"
                  onClick={() => goCrumb(i)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && goCrumb(i)}
                >
                  {c.name}
                </span>
              </span>
            ))}
          </nav>

          <div className="list" role="list" aria-label="Files and folders" aria-busy={busy}>
            {busy ? (
              [0, 1, 2, 3].map((i) => (
                <div className="skeleton-row" key={i}>
                  <span className="skeleton icon" />
                  <span className="skeleton" style={{ width: `${68 - i * 11}%` }} />
                  <span className="skeleton meta" />
                </div>
              ))
            ) : items.length === 0 ? (
              error ? null : (
                <div className="empty">
                  <FolderOpen className="empty-icon" size={30} strokeWidth={1.5} aria-hidden="true" />
                  This folder is empty.
                  <span className="empty-hint">Ask the agent to find a file, or upload one.</span>
                </div>
              )
            ) : (
              items.map((item) => {
                const isImage = !item.isFolder && item.mimeType?.startsWith("image/");
                const showThumb = isImage && !!item.thumbnailUrl;
                const Icon = fileIconFor(item);
                return (
                <div className="item" key={item.id} role="listitem">
                  {showThumb ? (
                    <img
                      className="thumb"
                      src={item.thumbnailUrl}
                      alt={item.name}
                      loading="lazy"
                      onError={(e: SyntheticEvent<HTMLImageElement>) => {
                        const img = e.currentTarget;
                        img.style.display = "none";
                        // Insert fallback icon after the hidden img.
                        const span = document.createElement("span");
                        span.setAttribute("aria-hidden", "true");
                        span.style.opacity = "0.5";
                        span.style.fontSize = "1rem";
                        span.textContent = "\u{1F4C4}";
                        img.parentElement?.insertBefore(span, img.nextSibling);
                      }}
                    />
                  ) : (
                    <span className={`file-icon${item.isFolder ? " folder" : ""}`} aria-hidden="true">
                      <Icon size={18} strokeWidth={1.75} />
                    </span>
                  )}
                  {item.isFolder ? (
                    <span
                      className="name folder"
                      onClick={() => openFolder(item)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && openFolder(item)}
                    >
                      {item.name}
                    </span>
                  ) : (
                    <a
                      className="name"
                      href={`/api/onedrive/download?connectionId=${activeConn}&itemId=${item.id}`}
                    >
                      {item.name}
                    </a>
                  )}
                  <span className="meta">
                    {item.isFolder ? `${item.childCount ?? 0} items` : fmtSize(item.size)}
                  </span>
                  <button
                    className="btn danger"
                    onClick={() => onDelete(item)}
                    disabled={busy}
                    aria-label={`Delete ${item.name}`}
                  >
                    Delete
                  </button>
                </div>
                );
              })
            )}
          </div>
        </>
      )}
    </main>
  );
}
