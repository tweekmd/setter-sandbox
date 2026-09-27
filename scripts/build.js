import { copyFileSync, mkdirSync } from "node:fs";

const outputDirectory = new URL("../dist/", import.meta.url);
mkdirSync(outputDirectory, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js", "free-run-week.html"]) {
	copyFileSync(new URL(`../${file}`, import.meta.url), new URL(file, outputDirectory));
}