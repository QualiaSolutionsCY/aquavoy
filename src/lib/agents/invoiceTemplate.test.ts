import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { fillInvoiceTemplate, type InvoiceFields } from "./invoiceTemplate";

/**
 * Seam tests for `fillInvoiceTemplate`.
 *
 * Loads the committed `gefo.docx` fixture from `assets/invoice-templates/`.
 * Nothing is mocked — docxtemplater renders against the real template bytes.
 * Covers:
 *   AC1 — valid fields → non-empty Buffer
 *   AC2 — malformed-tag template → single readable Error naming the bad tag
 */

const FIXTURES_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../assets/invoice-templates",
);

const SAMPLE_FIELDS: InvoiceFields = {
  recipient_name: "Novo Porto Scheepvaart BV",
  recipient_address: "Wilhelminaplein 1, 2074 DE Rotterdam",
  recipient_vat: "NL819154064B01",
  invoice_date: "27-06-2026",
  invoice_number: "26-047",
  vessel: "Pride of Faial",
  crewing: "4500.00",
  travel: "350.00",
  service_fee: "200.00",
  cash_advance: "500.00",
  total: "4550.00",
  currency: "EUR",
};

describe("fillInvoiceTemplate — gefo.docx fixture", () => {
  it("returns a non-empty Buffer when valid fields are provided", () => {
    const templateBuf = readFileSync(path.join(FIXTURES_DIR, "gefo.docx"));
    const result = fillInvoiceTemplate(templateBuf, SAMPLE_FIELDS);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
    // A .docx is a ZIP container; every ZIP starts with the "PK" magic bytes.
    expect(result[0]).toBe(0x50); // 'P'
    expect(result[1]).toBe(0x4b); // 'K'
  });

  it("also renders novo-porto.docx without error", () => {
    const templateBuf = readFileSync(path.join(FIXTURES_DIR, "novo-porto.docx"));
    const result = fillInvoiceTemplate(templateBuf, SAMPLE_FIELDS);

    expect(result.byteLength).toBeGreaterThan(0);
  });
});

describe("fillInvoiceTemplate — bad template error path", () => {
  it("throws a readable Error naming the malformed tag on an unclosed-tag template", () => {
    // Build a minimal OOXML .docx with an unclosed tag: `{unclosed`
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{unclosed</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const zip = new PizZip();
    zip.file("[Content_Types].xml", contentTypes);
    zip.file("_rels/.rels", rels);
    zip.file("word/document.xml", docXml);
    const badTemplateBuf = Buffer.from(
      zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
    );

    expect(() => fillInvoiceTemplate(badTemplateBuf, SAMPLE_FIELDS)).toThrow(
      /Invoice template error:.*unclosed/i,
    );
  });
});
