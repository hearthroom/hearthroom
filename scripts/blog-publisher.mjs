import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const operation = /^[a-zA-Z0-9-]{16,80}$/;
const routes = /^\/v1\/blog\/admin\/(?:columns(?:\/[A-Za-z0-9-]+)?|images|translation-groups|posts(?:\/[A-Za-z0-9-]+(?:\/(?:state|translation|preview|revisions(?:\/[A-Za-z0-9-]+(?:\/restore)?)?))?)?)$/;

/** A staff client for the existing blog service, with no generic authenticated HTTP escape hatch. */
export async function publisherRequest(args, { fetch: send = globalThis.fetch } = {}) {
  const [method, path, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!["--credential", "--json", "--image", "--operation-id"].includes(rest[i]) || !rest[i+1] || options[rest[i]]) throw new Error("Invalid command options");
    options[rest[i]] = rest[i+1];
  }
  const route = typeof path === "string" ? path.split("?")[0] : "";
  if (!["GET", "POST", "PUT", "DELETE"].includes(method) || !routes.test(route) || path.includes("#") || path.includes("\\")) throw new Error("Expected a blog admin path and supported method");
  const credentialPath = options["--credential"];
  if (!credentialPath) throw new Error("A private credential file is required");
  const stat = await lstat(credentialPath);
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error("Use a private credential file with mode 600");
  let credential;
  try { credential = JSON.parse(await readFile(credentialPath,"utf8")); } catch { throw new Error("Invalid private credential file"); }
  let origin;
  try {
    const url = new URL(credential.origin);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error();
    origin = url.origin;
  } catch { throw new Error("Invalid publisher origin; HTTPS is required except local fixtures"); }
  if (typeof credential.key !== "string" || !/^[a-f0-9]{64}$/.test(credential.key)) throw new Error("Invalid private credential key");
  const headers = { "X-Blog-Publisher-Key": credential.key };
  let body;
  if (method === "GET") {
    if (options["--json"] || options["--image"] || options["--operation-id"]) throw new Error("GET does not accept a body or operation ID");
  } else {
    const id = options["--operation-id"];
    if (!operation.test(id ?? "")) throw new Error("An explicit stable operation ID is required for writes");
    if (options["--image"]) {
      if (options["--json"] || route !== "/v1/blog/admin/images" || method !== "POST") throw new Error("Image upload requires POST /v1/blog/admin/images");
      const file = options["--image"], ext = file.split(".").at(-1).toLowerCase();
      const type = {png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif"}[ext];
      if (!type) throw new Error("Use a PNG, JPEG, WebP or GIF image");
      body = new FormData(); body.set("file",new File([await readFile(file)],"cover."+ext,{type})); body.set("operationId",id);
    } else {
      const input = options["--json"] ? JSON.parse(await readFile(options["--json"],"utf8")) : {};
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a JSON object");
      if (input.operationId !== undefined && input.operationId !== id) throw new Error("Conflicting operation ID");
      headers["Content-Type"] = "application/json"; body = JSON.stringify({...input,operationId:id});
    }
  }
  let response;
  try { response = await send(origin + path, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error("Blog request failed; read back before retrying with the same operation ID"); }
  const result = await response.json();
  if (!response.ok) throw new Error(`Blog request failed (${response.status}): ${typeof result.error === "string" ? result.error : "unknown error"}`);
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify(await publisherRequest(process.argv.slice(2)),null,2)+"\n"); }
  catch (error) { process.stderr.write(error.message+"\n"); process.exitCode=1; }
}
