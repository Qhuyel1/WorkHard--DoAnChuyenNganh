import { env } from "cloudflare:workers";
import { account } from "../../../lib/shop-access";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const actor=await account(request);if(!actor)return new Response(null,{status:403});
  const id=new URL(request.url).searchParams.get("id")||"";
  if(!/^[a-f0-9-]{36}$/.test(id))return new Response(null,{status:400});
  const object=await env.BUCKET!.get("checkins/"+id);
  if(!object)return new Response(null,{status:404});
  if(actor.role!=="owner"&&object.customMetadata?.user!==actor.employeeKey)return new Response(null,{status:403});
  return new Response(object.body,{headers:{"Content-Type":"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
export async function POST(request:Request){
  const origin=request.headers.get("origin");
  if(origin&&new URL(origin).host!==request.headers.get("host")&&origin!==new URL(request.url).origin)return new Response(null,{status:403});
  const actor=await account(request);if(actor?.role!=="staff")return new Response(null,{status:403});
  const lat=Number(request.headers.get("X-Checkin-Lat")),lon=Number(request.headers.get("X-Checkin-Lon")),accuracy=Number(request.headers.get("X-Checkin-Accuracy"));
  if(!request.headers.has("X-Checkin-Lat")||!request.headers.has("X-Checkin-Lon")||!request.headers.has("X-Checkin-Accuracy")||!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(accuracy)||accuracy<0||accuracy>100000)return new Response(null,{status:400});
  if(request.headers.get("content-type")!=="image/jpeg")return new Response(null,{status:415});
  const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return new Response(null,{status:400});
  const id=crypto.randomUUID();await env.BUCKET!.put("checkins/"+id,bytes,{httpMetadata:{contentType:"image/jpeg"},customMetadata:{user:actor.employeeKey!,receivedAt:new Date().toISOString(),lat:String(lat),lon:String(lon),accuracy:String(accuracy),device:(request.headers.get("user-agent")||"Không xác định").slice(0,500)}});
  return Response.json({id},{headers:{"Cache-Control":"no-store"}});
}
