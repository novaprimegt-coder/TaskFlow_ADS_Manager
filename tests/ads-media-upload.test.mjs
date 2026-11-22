import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const rules = readFileSync(new URL("../storage.ads.rules.example", import.meta.url), "utf8");
test("todos los espacios tienen un proveedor alternativo", () => {
 assert.match(html,/const providers=isVertical&&ad\._blob\.size>5\*1024\*1024&&ad\._blob\.size<=90\*1024\*1024\?\['firebase','blob'\]:\['blob','firebase'\];/);
 assert.match(html,/const attemptBlob=async\(\)=>/); assert.match(html,/const attemptFirebase=async\(\)=>/);
 assert.match(html,/for\(let i=0;i<providers\.length;i\+\+\)/);
});
test("se admiten los formatos de imagen, GIF y video", () => {
 for(const mime of ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm"]) {
  assert.ok(html.includes(mime),"Falta "+mime);
  assert.ok(rules.includes(mime.split("/")[1]),"Storage no contempla "+mime);
 }
 assert.match(html,/MEDIA_MAX_BYTES=500\*1024\*1024/);
});
test("se validan dimensiones, duración y archivo almacenado", () => {
 assert.match(html,/creativeSizeAllowed\(info\.width,info\.height,spec\)/);
 assert.match(html,/info\.duration<9\.95\|\|info\.duration>180\.05/);
 assert.match(html,/getDownloadURL\(\)/);
 assert.match(html,/No se pudo comprobar el archivo guardado/);
 assert.match(html,/ad\.storagePath=uploaded\.storagePath/);
});
