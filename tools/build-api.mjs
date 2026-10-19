import fs from "node:fs";
fs.mkdirSync(".api-public", { recursive: true });
fs.writeFileSync(".api-public/index.html", "<!doctype html><title>Personal Tap Data</title><p>Personal Tap market data service</p>");
