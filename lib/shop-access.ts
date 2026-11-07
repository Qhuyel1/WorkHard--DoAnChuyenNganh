import { env } from "cloudflare:workers";
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,"0")).join("");
export const randomHex=(length:number)=>hex(crypto.getRandomValues(new Uint8Array(length)).buffer);
export async function digest(value:string) {
  return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
}
export async function passwordHash(password:string,salt:string) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:100000,hash:"SHA-256"},key,256));
}
export function sameHash(a:string,b:string) {
  if (a.length!==b.length) return false;
  let diff=0;
  for (let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
export const cookieName="__Host-soquay";
export const sessionDuration=43200;
export function sessionCookie(token:string,seconds:number) {
  return cookieName+"="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+seconds;
}
export async function sessionDigest(req:Request) {
  const token=req.headers.get("x-shop-session") || req.headers.get("cookie")?.split(/;\s*/).find(v=>v.startsWith(cookieName+"="))?.slice(cookieName.length+1);
  return token && /^[0-9a-f]{64}$/.test(token) ? digest(token) : "";
}
export async function account(req:Request) {
  const hash=await sessionDigest(req);
  if (!hash) return null;
  const actor=await env.DB!.prepare("SELECT a.username,a.role,a.full_name AS fullName,a.employee_key AS employeeKey FROM shop_sessions s JOIN shop_accounts a ON a.username=s.username WHERE s.digest=? AND s.expires>?").bind(hash,Date.now()).first<{username:string,role:string,fullName:string|null,employeeKey:string|null}>();
  if (actor && !actor.employeeKey) {
    const row=await env.DB!.prepare("UPDATE shop_accounts SET employee_key=COALESCE(employee_key,?) WHERE username=? AND EXISTS(SELECT 1 FROM shop_sessions WHERE digest=? AND username=shop_accounts.username) RETURNING employee_key").bind(crypto.randomUUID(),actor.username,hash).first<{employee_key:string}>();
    if (!row) return null;
    actor.employeeKey=row.employee_key;
  }
  return actor;
}
export async function setupAllowed(req:Request) {
  const email=req.headers.get("oai-authenticated-user-email")?.toLowerCase().trim();
  return !!email && !!req.headers.get("oai-authenticated-user-id") &&
    await digest(email)==="4c5e4814203b8174dbbcfe281c3eb05f6728e9934d00157833feaf54661566ac";
}
