import {env} from "cloudflare:workers";
import {account,digest,passwordHash,randomHex,sameHash,sessionCookie,sessionDigest,sessionDuration,setupAllowed} from "../../../lib/shop-access";
export const dynamic="force-dynamic";
const db=()=>env.DB!;
const result=(body:object,status=200,cookie="")=>Response.json(body,{status,headers:{"Cache-Control":"no-store",...(cookie?{"Set-Cookie":cookie}:{})}});
const fail=(error:string,status:number)=>result({error},status);
export async function GET(req:Request) {
  const current=await account(req);
  const staff=current?.role==="owner" ? (await db().prepare("SELECT username,employee_key AS employeeKey,full_name AS fullName,address,phone,approved FROM shop_accounts WHERE role='staff' ORDER BY approved,username").all()).results : [];
  const canSetup=!current && await setupAllowed(req) && !await db().prepare("SELECT 1 FROM shop_accounts WHERE owner_slot=1").first();
  return result({current,staff,canSetup});
}
export async function POST(req:Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json") || req.headers.get("sec-fetch-site")==="cross-site") return fail("Yêu cầu không hợp lệ.",403);
  const body=await req.json().catch(()=>null);
  if (!body) return fail("Yêu cầu không hợp lệ.",400);
  const {action,password}=body;
  if (action==="logout") {
    await db().prepare("DELETE FROM shop_sessions WHERE digest=?").bind(await sessionDigest(req)).run();
    return result({},200,sessionCookie("",0));
  }
  const username=typeof body.username==="string"?body.username.trim().toLowerCase():"";
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) return fail("Tên tài khoản cần 3–50 ký tự gồm chữ không dấu, số, dấu chấm, gạch ngang hoặc gạch dưới.",400);
  const owner=action==="edit" || action==="create" || action==="revoke" || action==="approve";
  if (owner && (await account(req))?.role!=="owner") return fail("Chỉ chủ cửa hàng được quản lý tài khoản.",403);
  if (action==="approve") {
    const updated=await db().prepare("UPDATE shop_accounts SET approved=1 WHERE username=? AND role='staff'").bind(username).run();
    return updated.meta.changes?result({}):fail("Không tìm thấy tài khoản.",404);
  }
  if (action==="revoke") {
    await db().batch([db().prepare("DELETE FROM shop_sessions WHERE username IN (SELECT username FROM shop_accounts WHERE role='staff' AND username=?)").bind(username),db().prepare("DELETE FROM shop_accounts WHERE role='staff' AND username=?").bind(username)]);
    return result({});
  }
  if (!(action==="edit" && password==="") && (typeof password!=="string" || password.length<8 || password.length>128)) return fail("Mật khẩu cần từ 8 đến 128 ký tự.",400);
  if (action==="edit" || action==="setup" || action==="create" || action==="register") {
    if (action==="setup" && !await setupAllowed(req)) return fail("Chỉ người sở hữu trang được khởi tạo cửa hàng.",403);
    const profile=[body.fullName,body.address,body.phone].map(v=>typeof v==="string"?v.trim():"");
    if (action==="edit" || action==="register" || (action==="create" && profile.some(Boolean))) {
      const [name,address,phone]=profile;
      if (!name || name.length>100 || !address || address.length>300 || !/^\+?[0-9 ()-]{7,25}$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g,""))) return fail("Kiểm tra họ tên, địa chỉ và số điện thoại.",400);
    }
    if (action==="edit") {
      const old=body.originalUsername;
      if (typeof old!=="string") return fail("Thiếu tài khoản cần sửa.",400);
      const salt=password?randomHex(16):null;
      const verifier=salt?await passwordHash(password,salt):null;
      const update=db().prepare("UPDATE shop_accounts SET username=?, full_name=?,address=?,phone=?,salt=COALESCE(?,salt),verifier=COALESCE(?,verifier) WHERE username=? AND role='staff'").bind(username,...profile,salt,verifier,old);
      try {
        const queries=[];
        if (password || username!==old) queries.push(db().prepare("DELETE FROM shop_sessions WHERE username IN (SELECT username FROM shop_accounts WHERE username=? AND role='staff')").bind(old));
        const changes=await db().batch([...queries,update]);
        return changes[changes.length-1].meta.changes ? result({}) : fail("Không tìm thấy nhân viên.",404);
      } catch(error) {
        if (String(error).includes("UNIQUE")) return fail("Tên tài khoản đã được sử dụng.",409);
        throw error;
      }
    }
    const salt=randomHex(16), verifier=await passwordHash(password,salt);
    const inserted=await db().prepare("INSERT OR IGNORE INTO shop_accounts(username,role,owner_slot,salt,verifier,full_name,address,phone,approved) VALUES(?,?,?,?,?,?,?,?,?)").bind(username,action==="setup"?"owner":"staff",action==="setup"?1:null,salt,verifier,...profile,action==="register"?0:1).run();
    if (!inserted.meta.changes) return fail("Tên tài khoản đã tồn tại hoặc chủ cửa hàng đã được thiết lập.",409);
    return result({});
  }
  if (action!=="login" && action!=="ownerCredentials") return fail("Yêu cầu không hợp lệ.",400);
  const actor=action==="ownerCredentials"?await account(req):null;
  if (action==="ownerCredentials" && actor?.role!=="owner") return fail("Chỉ chủ cửa hàng được đổi thông tin đăng nhập.",403);
  const now=Date.now(),bucket=await digest("ip:"+(req.headers.get("cf-connecting-ip")||"shared"));
  const rate=await db().prepare("INSERT INTO login_attempts(bucket,attempts,until) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN until<=? THEN 1 ELSE attempts+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END RETURNING attempts").bind(bucket,now+600000,now,now).first<{attempts:number}>();
  if ((rate?.attempts||0)>30) return fail("Đã thử quá nhiều lần. Vui lòng thử lại sau 10 phút.",429);
  if (action==="ownerCredentials" && actor) {
    const current=await db().prepare("SELECT salt,verifier FROM shop_accounts WHERE username=? AND role='owner'").bind(actor.username).first<{salt:string,verifier:string}>();
    if(!current || !sameHash(await passwordHash(password,current.salt),current.verifier)) return fail("Mật khẩu hiện tại chưa đúng.",401);
    const next=body.newPassword;
    if(typeof next!=="string" || (next && (next.length<8 || next.length>128))) return fail("Mật khẩu mới cần từ 8 đến 128 ký tự.",400);
    if(username===actor.username && (!next || next===password)) return fail("Hãy nhập tên đăng nhập hoặc mật khẩu mới.",400);
    const salt=randomHex(16),verifier=await passwordHash(next||password,salt);
    try {
      const [updated]=await db().batch([
        db().prepare("UPDATE shop_accounts SET username=?,salt=?,verifier=? WHERE username=? AND verifier=? AND role='owner' AND EXISTS(SELECT 1 FROM shop_sessions WHERE digest=? AND username=? AND expires>?)").bind(username,salt,verifier,actor.username,current.verifier,await sessionDigest(req),actor.username,Date.now()),
        db().prepare("DELETE FROM shop_sessions WHERE username=? AND EXISTS(SELECT 1 FROM shop_accounts WHERE username=? AND verifier=?)").bind(actor.username,username,verifier)
      ]);
      if(!updated.meta.changes)return fail("Phiên đã thay đổi. Vui lòng đăng nhập lại.",409);
      return result({},200,sessionCookie("",0));
    } catch(error) {
      if(String(error).includes("UNIQUE"))return fail("Tên tài khoản đã được sử dụng.",409);
      throw error;
    }
  }
  const row=await db().prepare("SELECT salt,verifier,approved FROM shop_accounts WHERE username=?").bind(username).first<{salt:string,verifier:string,approved:number}>();
  const check=await passwordHash(password,row?.salt||"invalid-account-salt");
  if (!row || !sameHash(check,row.verifier)) return fail("Tên tài khoản hoặc mật khẩu chưa đúng.",401);
  if (!row.approved) return fail("Tài khoản đang chờ chủ cửa hàng duyệt.",403);
  const token=randomHex(32);
  await db().batch([db().prepare("DELETE FROM shop_sessions WHERE expires<=?").bind(now),db().prepare("DELETE FROM login_attempts WHERE bucket=? OR until<=?").bind(bucket,now),db().prepare("INSERT INTO shop_sessions(digest,username,expires) SELECT ?,username,? FROM shop_accounts WHERE username=? AND verifier=?").bind(await digest(token),now+sessionDuration*1000,username,row.verifier)]);
  return result(body.tabSession === true ? {tabToken:token} : {},200,sessionCookie(token,sessionDuration));
}
