import { describe, expect, it } from "vitest";
import { createMetadataPort } from "../src/metadata.ts";
import type { Finding, FindingField, MetadataReport } from "../src/model.ts";
import { SCRUB_ALL } from "../src/options.ts";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function findingOf(report: MetadataReport, category: Finding["category"]): Finding {
  const finding = report.findings.find((each) => each.category === category);
  if (finding === undefined) throw new Error(`no ${category} finding`);
  return finding;
}

function named(finding: Finding, name: string): FindingField | undefined {
  return finding.fields?.find((field) => field.name === name);
}

function body(content: string): string {
  return `${DECL}<w:document ${W}><w:body>${content}</w:body></w:document>`;
}

describe("document property values", () => {
  it("names each core and extended property with its value", () => {
    const properties = findingOf(inspectDocx(buildDocx()), "identifying-metadata");
    expect(named(properties, "Author")?.value).toEqual({ form: "text", text: "Jane Author" });
    expect(named(properties, "Last Saved By")?.value).toEqual({
      form: "text",
      text: "Bob Reviewer",
    });
    expect(named(properties, "Revision Number")?.value).toEqual({ form: "text", text: "7" });
    expect(named(properties, "Created")?.value).toEqual({
      form: "instant",
      instant: "2020-01-01T00:00:00.000Z",
    });
    expect(named(properties, "Company")?.value).toEqual({ form: "text", text: "Old Firm LLP" });
    expect(named(properties, "Template")?.value).toEqual({ form: "text", text: "Normal.dotm" });
    expect(named(properties, "Total Editing Time")?.value).toEqual({
      form: "minutes",
      minutes: 120,
    });
    // The author is listed before the dates, the order a person looks for them in.
    expect(properties.fields?.[0]?.name).toBe("Author");
  });

  it("shows a core property no list anticipated under its own name", () => {
    const core = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:x="urn:x"><x:matterCode>ACME-0042</x:matterCode></cp:coreProperties>`;
    const properties = findingOf(inspectDocx(buildDocx({ core })), "identifying-metadata");
    expect(named(properties, "matterCode")?.value).toEqual({ form: "text", text: "ACME-0042" });
  });

  it("leaves out the statistics, which identify nobody", () => {
    const app = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Old Firm LLP</Company><Words>812</Words><Pages>3</Pages></Properties>`;
    const properties = findingOf(inspectDocx(buildDocx({ app })), "identifying-metadata");
    expect(properties.fields?.map((field) => field.name)).not.toContain("Words");
  });
});

describe("custom property values", () => {
  it("reads each custom property with its typed value", () => {
    const custom = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Client"><vt:lpwstr>Acme Holdings</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Opened"><vt:filetime>2026-03-04T09:00:00Z</vt:filetime></property></Properties>`;
    const finding = findingOf(inspectDocx(buildDocx({ custom })), "custom-properties");
    expect(named(finding, "Client")?.value).toEqual({ form: "text", text: "Acme Holdings" });
    expect(named(finding, "Opened")?.value).toEqual({
      form: "instant",
      instant: "2026-03-04T09:00:00.000Z",
    });
  });
});

describe("settings values", () => {
  it("resolves the attached template and mail-merge source to their paths", () => {
    const settings = `${DECL}<w:settings ${W} ${R}><w:attachedTemplate r:id="rId1"/><w:mailMerge><w:connectString w:val="Provider=Clients"/><w:query w:val="SELECT * FROM Clients"/><w:dataSource r:id="rId2"/></w:mailMerge><w:docVars><w:docVar w:name="MatterNumber" w:val="2026-0042"/></w:docVars></w:settings>`;
    const settingsRels = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///\\\\fileserver\\templates\\letter.dotm" TargetMode="External"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/mailMergeSource" Target="file:///C:\\Clients\\acme.xlsx" TargetMode="External"/></Relationships>`;
    const report = inspectDocx(
      buildDocx({ settings, extra: { "word/_rels/settings.xml.rels": settingsRels } }),
    );
    const finding = findingOf(report, "document-settings");
    expect(named(finding, "Attached Template")?.value).toEqual({
      form: "text",
      text: "file:///\\\\fileserver\\templates\\letter.dotm",
    });
    expect(named(finding, "Mail Merge Source")?.value).toEqual({
      form: "text",
      text: "file:///C:\\Clients\\acme.xlsx",
    });
    expect(named(finding, "Mail Merge Query")?.value).toEqual({
      form: "text",
      text: "SELECT * FROM Clients",
    });
    expect(named(finding, "MatterNumber")?.value).toEqual({ form: "text", text: "2026-0042" });
  });
});

describe("custom XML values", () => {
  it("lists the named values a document-management system left behind", () => {
    const item = `${DECL}<record><client>Acme Holdings</client><matter><number>2026-0042</number></matter></record>`;
    const finding = findingOf(
      inspectDocx(buildDocx({ extra: { "customXml/item1.xml": item } })),
      "embedded-data",
    );
    expect(finding.fields).toEqual([
      { name: "client", value: { form: "text", text: "Acme Holdings" } },
      { name: "number", value: { form: "text", text: "2026-0042" } },
    ]);
  });
});

describe("comment values", () => {
  it("reads who wrote each comment, what it says and when", () => {
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="0" w:author="M. Chen" w:initials="MC" w:date="2026-10-03T09:15:00Z"><w:p><w:r><w:t>Do we want to cap this?</w:t></w:r></w:p></w:comment></w:comments>`;
    const document = body(
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Fees</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    );
    const finding = findingOf(inspectDocx(buildDocx({ comments, document })), "comments");
    expect(finding.fields).toEqual([
      {
        name: "M. Chen",
        value: { form: "text", text: "Do we want to cap this?" },
        when: { form: "instant", instant: "2026-10-03T09:15:00.000Z" },
      },
    ]);
  });
});

describe("tracked change values", () => {
  it("reads each insertion and deletion with its author, words and moment", () => {
    const document = body(
      '<w:p><w:del w:id="1" w:author="J. Alvarez" w:date="2026-10-02T10:00:00Z"><w:r><w:delText>$250 per hour</w:delText></w:r></w:del><w:ins w:id="2" w:author="J. Alvarez" w:date="2026-10-02T10:00:00Z"><w:r><w:t>$300 per hour</w:t></w:r></w:ins></w:p>',
    );
    const finding = findingOf(inspectDocx(buildDocx({ document })), "tracked-changes");
    expect(finding.fields).toEqual([
      {
        name: "J. Alvarez",
        value: { form: "text", text: "$250 per hour" },
        revision: "deleted",
        when: { form: "instant", instant: "2026-10-02T10:00:00.000Z" },
      },
      {
        name: "J. Alvarez",
        value: { form: "text", text: "$300 per hour" },
        revision: "inserted",
        when: { form: "instant", instant: "2026-10-02T10:00:00.000Z" },
      },
    ]);
  });

  it("lists one formatting change once, however many runs it touched", () => {
    const change =
      '<w:rPr><w:b/><w:rPrChange w:id="3" w:author="M. Chen" w:date="2026-10-03T08:00:00Z"><w:rPr/></w:rPrChange></w:rPr>';
    const document = body(
      `<w:p><w:r>${change}<w:t>One</w:t></w:r><w:r>${change}<w:t>Two</w:t></w:r></w:p>`,
    );
    const finding = findingOf(inspectDocx(buildDocx({ document })), "tracked-changes");
    expect(finding.count).toBe(2);
    expect(finding.fields).toHaveLength(1);
    expect(finding.fields?.[0]).toMatchObject({ name: "M. Chen", revision: "formatted" });
  });

  it("reads tracked changes in a header too, and caps a long passage", () => {
    const header = `${DECL}<w:hdr ${W}><w:p><w:ins w:id="4" w:author="A" w:date="2026-10-02T10:00:00Z"><w:r><w:t>${"x".repeat(5000)}</w:t></w:r></w:ins></w:p></w:hdr>`;
    const finding = findingOf(inspectDocx(buildDocx({ header })), "tracked-changes");
    const value = finding.fields?.[0]?.value;
    expect(value?.form).toBe("text");
    expect(value?.form === "text" && value.text.endsWith("\u2026")).toBe(true);
  });
});

describe("hidden text values", () => {
  it("reads hidden runs in one paragraph as one passage, and says where it sits", () => {
    const hidden = "<w:rPr><w:vanish/></w:rPr>";
    const document = body(
      `<w:p><w:r><w:t>Shown. </w:t></w:r><w:r>${hidden}<w:t xml:space="preserve">Do not </w:t></w:r><w:r>${hidden}<w:t>send.</w:t></w:r></w:p>`,
    );
    const finding = findingOf(inspectDocx(buildDocx({ document })), "hidden-content");
    expect(finding.count).toBe(2);
    expect(finding.fields).toEqual([
      { name: "", value: { form: "text", text: "Do not send." }, part: "body" },
    ]);
  });
});

describe("a scrub still reports what it left", () => {
  it("re-inspects the clean copy with no values left behind", async () => {
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="0" w:author="M. Chen"><w:p><w:r><w:t>Cap?</w:t></w:r></w:p></w:comment></w:comments>`;
    const outcome = await createMetadataPort().scrub(
      { bytes: buildDocx({ comments }), filename: "letter.docx" },
      SCRUB_ALL,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.report.findings).toEqual([]);
  });
});
