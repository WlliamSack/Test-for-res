const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  return ips;
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  let relPath = decodeURIComponent(urlPath);
  if (relPath === "/") relPath = "/index.html";
  else if (relPath.endsWith("/")) relPath += "index.html";

  const resolved = path.resolve(ROOT, "." + relPath);
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const targetFile = stat.isDirectory() ? path.join(resolved, "index.html") : resolved;
    const ext = path.extname(targetFile).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(targetFile, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-cache"
      });
      res.end(data);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("====================================================");
  console.log("  BSNT YHCT Pro - Local Server dang chay!");
  console.log("====================================================");
  console.log(`  Ban May tinh : http://localhost:${PORT}/`);
  console.log(`  Ban Mobile   : http://localhost:${PORT}/mobile/`);
  const ips = getLanIPs();
  if (ips.length) {
    console.log("\n  Mo tren dien thoai Samsung (cung mang Wi-Fi):");
    ips.forEach((ip) => {
      console.log(`  -> http://${ip.address}:${PORT}/mobile/   (${ip.name})`);
    });
  }
  console.log("\n  Nhan Ctrl+C de dung server.");
  console.log("====================================================");
});
