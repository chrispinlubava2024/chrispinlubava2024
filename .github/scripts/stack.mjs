// Builds stack.svg: language usage across all of the owner's repos (private included
// when a token with repo access is provided), grouped into Mobile / Web / etc.
// Only aggregate percentages are written out - no repo names or code.
import { writeFileSync } from "node:fs";

const TOKEN = process.env.GH_STATS_TOKEN || process.env.GITHUB_TOKEN || "";
const OUT = process.env.OUT || "stack.svg";

// Languages that are mostly generated/boilerplate (Flutter platform runners, build files).
const IGNORE = new Set(["CMake", "Makefile", "Batchfile", "Dockerfile", "Shell", "PowerShell"]);
// Languages below this share of the total are dropped from the card.
const MIN_PERCENT = 1;

// Group order = display order. Anything not listed lands in "Other".
const GROUPS = [
  ["Mobile", ["Dart", "Kotlin", "Swift", "Objective-C", "Java"]],
  ["Web", ["PHP", "Blade", "JavaScript", "TypeScript", "HTML", "CSS", "SCSS", "Vue", "Svelte"]],
  ["Backend & Data", ["Python", "Go", "C#", "Ruby", "Rust", "PLpgSQL", "TSQL", "SQL"]],
  ["Systems & Embedded", ["C", "C++"]],
];

const COLORS = {
  Dart: "#00B4AB", Kotlin: "#A97BFF", Swift: "#F05138", "Objective-C": "#438EFF", Java: "#B07219",
  PHP: "#4F5D95", Blade: "#F7523F", JavaScript: "#F1E05A", TypeScript: "#3178C6", HTML: "#E34C26",
  CSS: "#563D7C", SCSS: "#C6538C", Vue: "#41B883", Svelte: "#FF3E00",
  Python: "#3572A5", Go: "#00ADD8", "C#": "#178600", Ruby: "#701516", Rust: "#DEA584", PLpgSQL: "#336790",
  C: "#555555", "C++": "#F34B7D",
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "profile-stack",
      ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function listRepos() {
  const owner = TOKEN ? (await gh("/user")).login : process.env.OWNER;
  if (!owner) throw new Error("Set GH_STATS_TOKEN, or OWNER for a public-only run");
  const base = TOKEN
    ? "/user/repos?affiliation=owner,organization_member&visibility=all"
    : `/users/${owner}/repos?type=owner`;
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`${base}&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.fork && r.full_name !== `${owner}/${owner}`);
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function render(groups, repoCount) {
  const W = 600, PAD = 24, BAR_X = 190, BAR_W = 300;
  let y = 56;
  const maxPercent = Math.max(...groups.flatMap((g) => g.langs.map((l) => l.percent)));
  const rows = [];
  for (const g of groups) {
    rows.push(
      `<text x="${PAD}" y="${y}" class="grp">${esc(g.name)}</text>` +
        `<text x="${W - PAD}" y="${y}" class="pct grp" text-anchor="end">${g.percent.toFixed(1)}%</text>`,
    );
    y += 10;
    for (const l of g.langs) {
      y += 22;
      const w = Math.max(4, (l.percent / maxPercent) * BAR_W);
      rows.push(
        `<circle cx="${PAD + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>` +
          `<text x="${PAD + 18}" y="${y}" class="lang">${esc(l.name)}</text>` +
          `<rect x="${BAR_X}" y="${y - 10}" width="${BAR_W}" height="8" rx="4" class="track"/>` +
          `<rect x="${BAR_X}" y="${y - 10}" width="${w}" height="8" rx="4" fill="${l.color}"/>` +
          `<text x="${W - PAD}" y="${y}" class="pct" text-anchor="end">${l.percent.toFixed(1)}%</text>`,
      );
    }
    y += 26;
  }
  const H = y + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tech stack by language">
<style>
  .bg{fill:#fff;stroke:#d0d7de}.title{fill:#1f2328;font:600 18px 'Segoe UI',Ubuntu,sans-serif}
  .sub{fill:#656d76;font:12px 'Segoe UI',Ubuntu,sans-serif}.grp{fill:#1f2328;font:600 14px 'Segoe UI',Ubuntu,sans-serif}
  .lang{fill:#424a53;font:13px 'Segoe UI',Ubuntu,sans-serif}.pct{fill:#656d76;font:12px 'Segoe UI',Ubuntu,sans-serif}
  .pct.grp{fill:#1f2328;font-size:13px}.track{fill:#eaeef2}
  @media (prefers-color-scheme: dark){.bg{fill:#0d1117;stroke:#30363d}.title,.grp,.pct.grp{fill:#e6edf3}
    .lang{fill:#c9d1d9}.sub,.pct{fill:#8b949e}.track{fill:#21262d}}
</style>
<rect class="bg" x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10"/>
<text x="${PAD}" y="30" class="title">Tech stack</text>
<text x="${W - PAD}" y="30" class="sub" text-anchor="end">${repoCount} repos · public + private · each repo weighted equally</text>
${rows.join("\n")}
</svg>
`;
}

const repos = await listRepos();
// By default every repo counts equally (its languages split the repo's weight by share), so many
// small apps are not drowned out by one huge project. WEIGHT=bytes switches to raw bytes of code.
const BY_BYTES = process.env.WEIGHT === "bytes";
const totals = {};
for (const r of repos) {
  const langs = Object.entries(await gh(`/repos/${r.full_name}/languages`)).filter(([n]) => !IGNORE.has(n));
  const repoSum = langs.reduce((a, [, b]) => a + b, 0);
  for (const [name, bytes] of langs) {
    totals[name] = (totals[name] || 0) + (BY_BYTES ? bytes : bytes / repoSum);
  }
}
const personal = repos.filter((r) => r.owner.type === "User").length;
console.log(`Repos: ${repos.length} (${personal} personal, ${repos.length - personal} from organisations)`);

const sum = Object.values(totals).reduce((a, b) => a + b, 0);
if (!sum) throw new Error("No language data found");

const groupOf = (lang) => GROUPS.find(([, members]) => members.includes(lang))?.[0] ?? "Other";
const byGroup = new Map([...GROUPS.map(([n]) => [n, []]), ["Other", []]]);
for (const [name, bytes] of Object.entries(totals)) {
  const percent = (bytes / sum) * 100;
  if (percent >= MIN_PERCENT) byGroup.get(groupOf(name)).push({ name, percent, color: COLORS[name] || "#8b949e" });
}

const groups = [...byGroup]
  .map(([name, langs]) => ({
    name,
    langs: langs.sort((a, b) => b.percent - a.percent),
    percent: langs.reduce((a, l) => a + l.percent, 0),
  }))
  .filter((g) => g.langs.length)
  .sort((a, b) => b.percent - a.percent);

writeFileSync(OUT, render(groups, repos.length));
console.log(`Wrote ${OUT}: ${repos.length} repos`);
for (const g of groups) console.log(`${g.name} ${g.percent.toFixed(1)}%: ${g.langs.map((l) => `${l.name} ${l.percent.toFixed(1)}`).join(", ")}`);
