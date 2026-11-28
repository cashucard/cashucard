// Keep navigation available in plain HTML on every route, including the 404.
import { readFile, readdir, writeFile } from "node:fs/promises";
const tools = new URL("./", import.meta.url);
const dist = new URL("../dist/", tools);
const [header, footer] = (await readFile(new URL("navigation.html", tools), "utf8")).trim().split("\n<!-- footer template -->\n");
const primary = [["/downloads","Downloads"], ["/#buy","Get cards"], ["/guide","Guide"], ["/developers","Developers"], ["/fund","Fund"], ["/support","Support"]];
const external = '<svg class="ui-icon" width="16" height="16" aria-hidden="true" focusable="false"><use href="/assets/ui-icons.svg#up-right"/></svg>';
function links(items) {
  return items.map(([url,label]) => `<a href="${url}">${label}</a>`).join(" ");
}
const check = process.argv.includes("--check");
for (const file of (await readdir(dist)).filter(name => name.endsWith(".html"))) {
  const path = new URL(file,dist);
  const before = await readFile(path,"utf8");
  const route = file === "index.html" ? "/" : "/" + file.slice(0,-5);
  let html = before;
  for (const [name,template] of [["header",header],["footer",footer]]) {
    const start = `<!-- site ${name} -->`, end = `<!-- end site ${name} -->`;
    if (html.split(start).length !== 2 || html.split(end).length !== 2) throw new Error("Missing or duplicate navigation markers in "+file);
    const block = template.replaceAll("{{all-links}}", links(primary)).replaceAll("{{menu-links}}",links(primary.slice(1)))
      .replaceAll("{{guide-wallets}}",route === "/guide" ? '<a href="https://getflash.io/">Flash {{external}}</a><a href="https://getfoxy.io/">Foxy {{external}}</a>' : "")
      .replaceAll("{{ops-release}}",route === "/ops-service" ? '<a href="https://github.com/cashucard/cashucard/releases/tag/ops-v0.2.1">Ops release {{external}}</a>' : "")
      .replaceAll("{{external}}",external)
      .replaceAll(`href="${route}"`,`href="${route}" aria-current="page"`);
    html = html.slice(0,html.indexOf(start)) + start + "\n" + block + "\n" + html.slice(html.indexOf(end));
  }
  if (before !== html) {
    if (check) throw new Error("Run node tools/sync-navigation.mjs to update "+file);
    await writeFile(path, html);
  }
}
