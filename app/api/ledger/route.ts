import { env } from "cloudflare:workers";

import { account } from "../../../lib/shop-access";
import { staffView, preserveSaleSellers } from "../../../lib/staff-sales.mjs";

import { workCommand } from "../../../lib/shop-workflows.mjs";
export const dynamic = "force-dynamic";
const collections = ["products", "sales", "receipts", "clients", "payments"];

async function readLedger() {
  const [head, parts] = await env.DB!.batch([
    env.DB!.prepare("SELECT version, records FROM ledger ORDER BY version DESC LIMIT 1"),
    env.DB!.prepare("SELECT content FROM ledger_parts ORDER BY part"),
  ]);
  const row = head.results[0];
  const records = parts.results.map(part => part.content).join("") || String(row?.records || "null");
  return { version: row?.version || 0, data: JSON.parse(records) };
}
export async function GET(request: Request) {
  const actor=await account(request);
  const role=actor?.role;
  if (!role) return new Response(null,{status:403});
  const since=new URL(request.url).searchParams.get("since");
  if(since!==null){
    const head=await env.DB!.prepare("SELECT version FROM ledger ORDER BY version DESC LIMIT 1").first<{version:number}>();
    if(String(head?.version||0)===since)return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
  }
  const {version,data} = await readLedger();
  return Response.json(
    { version, role, employeeKey:actor?.employeeKey, data: role==="owner" ? data : staffView(data||{products:[],sales:[],clients:[],payments:[],bank:{}},actor) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host") && origin !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  const seller = await account(request);
  if (!seller) return new Response(null,{status:403});
  const current = await readLedger();
  const body = await request.json();
  const version = body.version;
  if (current.version !== version) return new Response(null,{status:409});
  let data = body.data;
  if (body.command) {
    if(data) return new Response(null,{status:400});
    data=current.data||{products:[],sales:[],clients:[],payments:[],receipts:[],bank:{}};
    delete body.command.employee;
    if(body.command.kind==="manualAttendance"){
      if(seller.role!=="owner")return new Response(null,{status:403});
      const employee=await env.DB!.prepare("SELECT employee_key AS key,full_name AS name,username FROM shop_accounts WHERE employee_key=? AND role='staff'").bind(String(body.command.user||"")).first<{key:string,name:string,username:string}>();
      if(!employee)return Response.json({error:"Không tìm thấy nhân viên."},{status:400});
      body.command.employee={key:employee.key,name:employee.name||employee.username};
    }
    delete body.command.checkin;
    if(body.command.kind==="shiftIn"){
      const id=body.command.photoId;
      if(seller.role!=="staff"||typeof id!=="string"||!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:"Cần chụp ảnh và lấy vị trí trước khi vào ca."},{status:400});
      const photo=await env.BUCKET!.head("checkins/"+id),meta=photo?.customMetadata;
      if(!meta||meta.user!==seller.employeeKey||Date.now()-Date.parse(meta.receivedAt)>300000||!Number.isFinite(Date.parse(meta.receivedAt))||(data.shifts||[]).some((s:any)=>s.checkin?.photoId===id))return Response.json({error:"Ảnh không hợp lệ hoặc đã quá 5 phút. Vui lòng chụp lại."},{status:400});
      body.command.checkin={photoId:id,receivedAt:meta.receivedAt,lat:Number(meta.lat),lon:Number(meta.lon),accuracy:Number(meta.accuracy),device:meta.device};
    }
    try { workCommand(data,body.command,seller); }
    catch(error){return Response.json({error:error instanceof Error?error.message:"Thao tác không hợp lệ."},{status:400});}
  } else if(seller.role!=="owner") return new Response(null,{status:403});
  if (!data || !collections.every(k=>Array.isArray(data[k]))) return new Response(null,{status:400});
  if (!body.command && seller.role==="owner") preserveSaleSellers(current.data?.sales || [],data.sales);
  const db = env.DB!;
  const next = version + 1;
  const records = JSON.stringify(data);
  // The unique revision insert and all chunk writes commit as one transaction.
  const statements = [
    db.prepare("INSERT INTO ledger(id, version, records) VALUES (?, ?, '')").bind(next, next),
    db.prepare("DELETE FROM ledger_parts"),
  ];
  let offset = 0, part = 0;
  while (offset < records.length) {
    let end = Math.min(offset + 32768, records.length);
    if (end < records.length && /[\uD800-\uDBFF]/.test(records[end - 1])) end--;
    statements.push(db.prepare("INSERT INTO ledger_parts(part,content) VALUES (?,?)").bind(part++, records.slice(offset, end)));
    offset = end;
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return new Response(null, { status: 409 });
    throw error;
  }
  return Response.json(body.command ? {version:next,role:seller.role,employeeKey:seller.employeeKey,data:seller.role==="staff"?staffView(data,seller):data} : {version:next},{headers:{"Cache-Control":"no-store"}});
}
