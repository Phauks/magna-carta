const CATEGORY_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

export function parseFragment(markdown) {
  const lines = markdown.split("\n");
  const end = lines.indexOf("---", 1);
  let category = "";
  for (const line of lines.slice(1, end)) {
    if (line.startsWith("category:")) category = line.slice("category:".length).trim();
  }
  const text = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  return { category, text };
}

export function foldFragments(changelogMarkdown, fragments) {
  const lines = changelogMarkdown.split("\n");
  const unreleased = lines.findIndex((line) => line.startsWith("## [Unreleased]"));
  if (unreleased === -1) throw new Error("CHANGELOG.md is missing the [Unreleased] section");
  let nextSection = lines.findIndex((line, index) => index > unreleased && line.startsWith("## "));
  if (nextSection === -1) nextSection = lines.length;

  for (const category of CATEGORY_ORDER) {
    const entries = fragments.filter((fragment) => fragment.category === category);
    if (entries.length === 0) continue;
    let heading = lines.findIndex(
      (line, index) => index > unreleased && index < nextSection && line === `### ${category}`,
    );
    if (heading === -1) {
      lines.splice(
        nextSection,
        0,
        `### ${category}`,
        "",
        ...entries.map((entry) => `- ${entry.text}`),
        "",
      );
      nextSection += entries.length + 3;
      continue;
    }
    let insertAt = heading + 1;
    while (
      insertAt < nextSection &&
      !(lines[insertAt] === "" && lines[insertAt + 1]?.startsWith("###"))
    ) {
      if (lines[insertAt] === "" && (insertAt + 1 >= nextSection || lines[insertAt + 1] === ""))
        break;
      insertAt++;
    }
    lines.splice(insertAt, 0, ...entries.map((entry) => `- ${entry.text}`));
    nextSection += entries.length;
  }
  return lines.join("\n");
}
