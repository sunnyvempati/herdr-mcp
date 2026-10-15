// Renders the PNG fallbacks for the SVG assets: npm run render:assets
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const assets = [
  { svg: "assets/logo.svg", png: "assets/logo.png", width: 512 },
  { svg: "assets/banner.svg", png: "assets/banner.png", width: 1200 },
];

for (const { svg, png, width } of assets) {
  const rendered = new Resvg(readFileSync(svg, "utf8"), { fitTo: { mode: "width", value: width } }).render();
  writeFileSync(png, rendered.asPng());
  console.log(`${png}: ${rendered.width}x${rendered.height}`);
}
