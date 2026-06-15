import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GraphDriveItem } from "./types";

/**
 * Seam test for the OneDrive operations layer. We mock the transport (./graph)
 * and assert the GraphDriveItem -> DriveItem mapping: folder detection, path
 * derivation from parentReference, size defaulting, and thumbnail selection.
 */
vi.mock("./graph", () => ({
  graphJson: vi.fn(),
  graphRaw: vi.fn(),
  GRAPH_BASE: "https://graph.microsoft.com/v1.0",
}));

import { listChildren, getItem, search } from "./onedrive";
import { graphJson } from "./graph";

const graphJsonMock = vi.mocked(graphJson);

const fileRaw: GraphDriveItem = {
  id: "file-1",
  name: "report.pdf",
  size: 2048,
  webUrl: "https://onedrive/report.pdf",
  lastModifiedDateTime: "2026-01-02T03:04:05Z",
  file: { mimeType: "application/pdf" },
  parentReference: { path: "/drive/root:/Documents" },
  thumbnails: [{ medium: { url: "https://thumb/medium" }, small: { url: "https://thumb/small" } }],
};

const folderRaw: GraphDriveItem = {
  id: "folder-1",
  name: "Documents",
  folder: { childCount: 7 },
  parentReference: { path: "/drive/root:" },
};

describe("microsoft/onedrive mapping", () => {
  beforeEach(() => graphJsonMock.mockReset());

  it("listChildren maps each raw item to a DriveItem", async () => {
    graphJsonMock.mockResolvedValueOnce({ value: [fileRaw, folderRaw] });

    const items = await listChildren("conn-1");

    expect(items).toHaveLength(2);
    const [file, folder] = items;

    expect(file.id).toBe("file-1");
    expect(file.isFolder).toBe(false);
    expect(file.size).toBe(2048);
    expect(file.mimeType).toBe("application/pdf");
    expect(file.lastModified).toBe("2026-01-02T03:04:05Z");
    expect(file.path).toBe("/Documents/report.pdf");
    expect(file.thumbnailUrl).toBe("https://thumb/medium");

    expect(folder.isFolder).toBe(true);
    expect(folder.childCount).toBe(7);
    expect(folder.size).toBe(0); // size defaults to 0 when Graph omits it
  });

  it("getItem maps a single raw item", async () => {
    graphJsonMock.mockResolvedValueOnce(fileRaw);
    const item = await getItem("conn-1", { itemId: "file-1" });
    expect(item.name).toBe("report.pdf");
    expect(item.webUrl).toBe("https://onedrive/report.pdf");
  });

  it("search maps the value array and falls back to small thumbnail", async () => {
    const noMedium: GraphDriveItem = {
      ...fileRaw,
      id: "file-2",
      thumbnails: [{ small: { url: "https://thumb/small-only" } }],
    };
    graphJsonMock.mockResolvedValueOnce({ value: [noMedium] });
    const [item] = await search("conn-1", "report");
    expect(item.id).toBe("file-2");
    expect(item.thumbnailUrl).toBe("https://thumb/small-only");
  });
});
