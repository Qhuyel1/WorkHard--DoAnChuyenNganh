import { env } from "cloudflare:workers";
import { account } from "../../../lib/shop-access";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  if(!await account(request))return new Response(null,{status:403});
  const id=new URL(request.url).searchParams.get("id")||"";
  if(!/^[a-f0-9-]{36}$/.test(id))return new Response(null,{status:400});
  const object=await env.BUCKET!.get("products/"+id);
  if(!object)return new Response(null,{status:404});
  return new Response(object.body,{headers:{"Content-Type":"image/jpeg","Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"}});
}
export async function POST(request:Request){
  const origin=request.headers.get("origin");
  if(origin&&new URL(origin).host!==request.headers.get("host")&&origin!==new URL(request.url).origin)return new Response(null,{status:403});
  if((await account(request))?.role!=="owner")return new Response(null,{status:403});
  if(request.headers.get("content-type")!=="image/jpeg")return new Response(null,{status:415});
  const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return new Response(null,{status:400});
  const id=crypto.randomUUID();await env.BUCKET!.put("products/"+id,bytes,{httpMetadata:{contentType:"image/jpeg"}});
  return Response.json({id},{headers:{"Cache-Control":"no-store"}});
}
