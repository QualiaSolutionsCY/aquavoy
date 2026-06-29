/**
 * build-invoice-templates.ts
 *
 * Constructs two tagged .docx invoice templates for Aquavoy M6 Phase 3.
 * Uses pizzip to assemble the minimal OOXML zip (4 parts) and embeds
 * {tag} placeholders compatible with docxtemplater's default single-brace
 * delimiter (paragraphLoop:true, linebreaks:true).
 *
 * Templates produced:
 *   assets/invoice-templates/gefo.docx      — Gefo voyage/layover invoice
 *   assets/invoice-templates/novo-porto.docx — Novo Porto Scheepvaart BV invoice
 *
 * After writing each file the script performs a test-render with sample data
 * to prove the tags are well-formed before committing.
 *
 * Run: npx tsx scripts/build-invoice-templates.ts
 */

import * as fs from "fs";
import * as path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// ---------------------------------------------------------------------------
// OOXML minimal document parts
// ---------------------------------------------------------------------------

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

// ---------------------------------------------------------------------------
// OOXML helpers — wrap text in a paragraph/run
// ---------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function para(text: string, bold = false): string {
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  // Split on newlines — each becomes its own paragraph
  return text
    .split("\n")
    .map((line) => {
      // Within a line, {tag} tokens must NOT be split across runs.
      // We emit the whole line as a single run so docxtemplater sees complete tags.
      return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`;
    })
    .join("\n");
}

function buildDocumentXml(bodyLines: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:aink="http://schemas.microsoft.com/office/drawing/2016/ink"
  xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:oel="http://schemas.microsoft.com/office/2019/extlst"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
  xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"
  xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"
  xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml"
  xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash"
  xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14">
  <w:body>
${bodyLines.join("\n")}
    <w:sectPr/>
  </w:body>
</w:document>`;
}

// ---------------------------------------------------------------------------
// Issuer block (same for both templates — Aquavoy Ltd)
// ---------------------------------------------------------------------------

function issuerBlock(): string[] {
  return [
    para("Aquavoy Ltd", true),
    para("Ledras 147 1st floor office 6"),
    para("1011 Nicosia Cyprus"),
    para("VAT CY 60038875Q"),
    para(""),
  ];
}

// ---------------------------------------------------------------------------
// Shared recipient + metadata + footer blocks
// ---------------------------------------------------------------------------

function recipientBlock(): string[] {
  return [
    para("{recipient_name}", true),
    para("{recipient_address}"),
    para("VAT {recipient_vat}"),
    para(""),
  ];
}

function metaBlock(): string[] {
  return [
    para("Invoice Date {invoice_date}"),
    para("Invoice number {invoice_number}"),
    para(""),
  ];
}

function lineItemsBlock(): string[] {
  return [
    para("Crewing Services        {crewing}"),
    para("Travel Cost             {travel}"),
    para("Service Fee (Food and Drink)  {service_fee}"),
    para("Cash advance            {cash_advance}-"),
    para("VAT Shifted"),
    para("Total                   {total}", true),
    para(""),
  ];
}

function footerBlock(): string[] {
  return [
    para("Payment term: 7 days"),
    para("Revolut Bank LT62 3250 0781 7194 2284  BIC Revolut21"),
    para("Admin@aquavoy.com"),
  ];
}

// ---------------------------------------------------------------------------
// Gefo template body
// ---------------------------------------------------------------------------

function gefoBody(): string[] {
  return [
    ...issuerBlock(),
    ...recipientBlock(),
    ...metaBlock(),
    para(
      "Hereby we charge you for services rendered onboard of the Mts {vessel},"
    ),
    para(
      "(voyage/layover period — see attached voyage/layover statement for details)"
    ),
    para(""),
    ...lineItemsBlock(),
    ...footerBlock(),
  ];
}

// ---------------------------------------------------------------------------
// Novo Porto template body
// ---------------------------------------------------------------------------

function novoPortoBody(): string[] {
  return [
    ...issuerBlock(),
    ...recipientBlock(),
    ...metaBlock(),
    para("Hereby we charge you for services rendered onboard of the Mts {vessel},"),
    para(""),
    ...lineItemsBlock(),
    ...footerBlock(),
  ];
}

// ---------------------------------------------------------------------------
// Assemble .docx via pizzip
// ---------------------------------------------------------------------------

function buildDocx(documentXml: string): Buffer {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------
// Render-test: verify all {tag} tokens are well-formed
// ---------------------------------------------------------------------------

const SAMPLE_DATA = {
  recipient_name: "Novo Porto Scheepvaart BV",
  recipient_address: "Wilhelminaplein 1, 2074 DE Rotterdam",
  recipient_vat: "NL819154064B01",
  invoice_date: "27-05-2026",
  invoice_number: "26-047",
  vessel: "Pride of Faial",
  crewing: "4500.00",
  travel: "350.00",
  service_fee: "200.00",
  cash_advance: "500.00",
  total: "4550.00",
};

function renderTest(buf: Buffer, label: string): void {
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render(SAMPLE_DATA);
  // If no tags are malformed, toBuffer() succeeds
  doc.toBuffer();
  console.log(`  [RENDER OK] ${label}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Resolve output path relative to project root (script runs from project root via npx tsx)
const OUT_DIR = path.resolve(process.cwd(), "assets/invoice-templates");

fs.mkdirSync(OUT_DIR, { recursive: true });

const templates: Array<{ name: string; body: string[] }> = [
  { name: "gefo", body: gefoBody() },
  { name: "novo-porto", body: novoPortoBody() },
];

for (const { name, body } of templates) {
  const docXml = buildDocumentXml(body);
  const buf = buildDocx(docXml);
  const outPath = path.join(OUT_DIR, `${name}.docx`);
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath} (${buf.length} bytes)`);
  renderTest(buf, name);
}

console.log("\nBUILT");
