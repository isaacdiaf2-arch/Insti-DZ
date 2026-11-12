import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outputPublicDir = path.join(rootDir, ".output", "public");
const distDir = path.join(rootDir, "dist");

// 1. Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 2. Copy all files from .output/public into dist if it exists
if (fs.existsSync(outputPublicDir)) {
  fs.cpSync(outputPublicDir, distDir, { recursive: true });
  console.log(`Copied assets from ${outputPublicDir} to ${distDir}`);
}

// 3. Find built CSS and JS files in dist/assets
let cssFile = "";
let clientJsFile = "";
const assetsDir = path.join(distDir, "assets");
if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  cssFile = files.find((f) => f.startsWith("styles-") && f.endsWith(".css")) || "";
  clientJsFile = files.find((f) => f.startsWith("client-") && f.endsWith(".js")) || "";
}

// 4. Create robust index.html in dist
const indexHtmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Study DZ — منصة سحابية جزائرية لإدارة التعليم</title>
    <meta name="description" content="منصة SaaS لإدارة المؤسسات التعليمية الجزائرية: لوحات تحكم للمدير والأستاذ والطالب، دروس واختبارات ونتائج، باشتراك سنوي 9,000 دج." />
    <meta name="author" content="Study DZ" />
    <meta property="og:title" content="Study DZ — منصة سحابية جزائرية لإدارة التعليم" />
    <meta property="og:description" content="منصة SaaS لإدارة المؤسسات التعليمية الجزائرية: لوحات تحكم للمدير والأستاذ والطالب، دروس واختبارات ونتائج، باشتراك سنوي 9,000 دج." />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Study DZ — منصة سحابية جزائرية لإدارة التعليم" />
    <meta name="twitter:description" content="منصة SaaS لإدارة المؤسسات التعليمية الجزائرية: لوحات تحكم للمدير والأستاذ والطالب، دروس واختبارات ونتائج، باشتراك سنوي 9,000 دج." />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@300;400;500;700;800&display=swap" rel="stylesheet" />
    ${cssFile ? `<link rel="stylesheet" href="/assets/${cssFile}" />` : ""}
  </head>
  <body class="bg-background text-foreground min-h-screen">
    <div id="root"></div>
    ${clientJsFile ? `<script type="module" src="/assets/${clientJsFile}"></script>` : ""}
  </body>
</html>
`;

fs.writeFileSync(path.join(distDir, "index.html"), indexHtmlContent, "utf-8");
fs.writeFileSync(path.join(distDir, "200.html"), indexHtmlContent, "utf-8");
fs.writeFileSync(path.join(distDir, "404.html"), indexHtmlContent, "utf-8");

console.log("Postbuild completed successfully: dist populated with HTML and assets.");
