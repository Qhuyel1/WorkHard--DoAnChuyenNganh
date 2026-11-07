import {validPosition,distanceMeters} from "./store-location.mjs";
import {applyStaffCommand} from "./staff-sales.mjs";
const round=n=>Math.round(n*1e6)/1e6;
const localDay=iso=>new Date(+new Date(iso)+7*3600000).toISOString().slice(0,10);
function check(ok,message){if(!ok) throw Error(message);}
function words(value,max=500){const s=typeof value==="string"?value.trim():"";check(s && s.length<=max,"Vui lòng kiểm tra nội dung đã nhập.");return s;}
function date(value){check(typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value+"T12:00Z").toISOString().slice(0,10)===value,"Ngày không hợp lệ.");return value;}
function paid(db,sale){return db.payments.filter(p=>p.sale===sale.id).reduce((v,p)=>v+p.amount,0);}
function draftLines(db,input){
  check(Array.isArray(input)&&input.length>0&&input.length<=300,"Đơn phải có từ 1 đến 300 dòng hàng.");
  return input.map(l=>{
    const p=db.products.find(p=>p.id===l.product&&!p.archived);
    check(p && (l.unit===p.unit || (p.pack && l.unit===p.pack)) && (!p.width || p.lots.some(x=>x.id===l.lot)),"Mặt hàng hoặc cuộn không còn trong kho.");
    check(Number.isFinite(l.quantity)&&l.quantity>0&&Number.isSafeInteger(l.price)&&l.price>=0,"Số lượng hoặc đơn giá không hợp lệ.");
    const base=round(l.quantity*(l.unit===p.pack?p.factor:1)),total=Math.round(l.quantity*(p.width||1)*l.price);
    check(base>0 && Number.isSafeInteger(total),"Giá trị dòng hàng không hợp lệ.");
    const name=[p.name,p.brand,p.width?"khổ "+p.width.toLocaleString("vi-VN")+" m":""].filter(Boolean).join(" · ");
    return {product:p.id,name,quantity:l.quantity,base,unit:l.unit,width:p.width,price:l.price,lot:p.width?l.lot:"",total};
  });
}
export function workCommand(db,c,actor,at=new Date().toISOString()){
  const user=actor.employeeKey,owner=actor.role==="owner",person=owner?"Cửa hàng":actor.fullName||actor.username;
  check(user,"Phiên đăng nhập không hợp lệ.");
  for (const key of ["shifts","leaves","drafts","changes"]) db[key]??=[];
  const record=()=>({id:crypto.randomUUID(),user,person,at});
  const today=localDay(at);
  if(c.kind==="storeLocation"){
    check(owner,"Chỉ chủ cửa hàng được cập nhật vị trí.");check(validPosition(c.position),"Vị trí không hợp lệ.");
    db.locationHistory??=[];if(db.storeLocation)db.locationHistory.push(db.storeLocation);
    db.storeLocation={lat:c.position.lat,lon:c.position.lon,updatedAt:at,updatedBy:actor.username};return;
  }
  if(c.kind==="manualAttendance"){
    check(owner,"Chỉ chủ cửa hàng được điểm danh thủ công.");
    const day=date(c.day);check(day<=today,"Không điểm danh cho ngày tương lai.");
    check(["Đi làm","Nghỉ","Nghỉ buổi sáng","Nghỉ buổi chiều"].includes(c.status),"Trạng thái không hợp lệ.");
    check(c.employee&&c.employee.key===c.user,"Không tìm thấy nhân viên.");
    const note=words(c.note,500);db.manualAttendance??=[];
    let item=db.manualAttendance.find(r=>r.user===c.user&&r.day===day);
    if(!item){item={id:crypto.randomUUID(),user:c.user,person:c.employee.name,day,history:[]};db.manualAttendance.push(item);}
    else item.history.push({status:item.status,note:item.note,at:item.at,by:item.by});
    Object.assign(item,{status:c.status,note,at,by:actor.username});return;
  }
  if(c.kind==="shiftIn" || c.kind==="shiftOut"){
    check(!owner,"Chỉ nhân viên được điểm danh.");
    const open=db.shifts.find(s=>s.user===user&&!s.out);
    if(c.kind==="shiftOut"){check(open,"Bạn chưa vào ca.");open.out=at;}
    else {check(!open,"Bạn đang trong ca.");check(c.checkin?.photoId,"Cần ảnh check-in và vị trí trước khi vào ca.");check(validPosition(db.storeLocation),"Chủ cửa hàng chưa thiết lập vị trí. Hãy liên hệ chủ cửa hàng.");check(validPosition(c.checkin),"Vị trí check-in không hợp lệ.");const distance=distanceMeters(db.storeLocation,c.checkin);check(distance<=100,"Bạn ở ngoài phạm vi 100 m của cửa hàng. Không thể vào ca. Nếu GPS sai, liên hệ chủ cửa hàng điểm danh thủ công.");c.checkin.distance=distance;c.checkin.storeLocation={...db.storeLocation};db.shifts.push({...record(),day:today,checkin:c.checkin});}
    return;
  }
  if(c.kind==="leave"){
    check(!owner,"Chỉ nhân viên gửi đơn nghỉ.");
    const day=date(c.day),slot=c.slot;
    check(day>=today && ["Cả ngày","Buổi sáng","Buổi chiều"].includes(slot),"Kiểm tra ngày và buổi nghỉ.");
    check(!db.leaves.some(l=>l.user===user && l.day===day && l.status!=="Từ chối" && (l.slot===slot||l.slot==="Cả ngày"||slot==="Cả ngày")),"Buổi này đã có đơn nghỉ.");
    db.leaves.push({...record(),day,slot,reason:words(c.reason),status:"Chờ duyệt"});return;
  }
  if(c.kind==="leaveReview"){
    const l=db.leaves.find(l=>l.id===c.id);
    check(owner&&l?.status==="Chờ duyệt","Không thể xử lý đơn nghỉ.");
    l.status=c.approve===true?"Đã duyệt":"Từ chối";l.reviewedAt=at;return;
  }
  const draft=c.draftId?db.drafts.find(d=>d.id===c.draftId&&d.user===user):null;
  if(c.draftId) check(draft && draft.rev===c.rev,"Đơn giữ đã thay đổi hoặc đã được thanh toán. Vui lòng mở lại.");
  if(c.kind==="hold"){
    const lines=Array.isArray(c.lines)&&!c.lines.length?[]:draftLines(db,c.lines),label=words(c.label,100);
    const item=draft||record();
    Object.assign(item,{lines,label,client:c.client||"",rev:(item.rev||0)+1,updated:at});
    if(!draft)db.drafts.push(item);return;
  }
  if(c.kind==="dropDraft"){check(draft,"Không tìm thấy đơn.");db.drafts.splice(db.drafts.indexOf(draft),1);return;}
  if(c.kind==="sale" || c.kind==="client"){
    applyStaffCommand(db,c,person);
    if(c.kind==="sale"){
      db.sales.at(-1).sellerKey=user;
      if(c.payment) Object.assign(db.payments.at(-1),{collector:person,collectorKey:user});
      if(draft) db.drafts.splice(db.drafts.indexOf(draft),1);
    }
    return;
  }
  const sale=db.sales.find(s=>s.id===c.saleId);
  if(c.kind==="repay"){
    check(sale&&!sale.cancelled && Number.isSafeInteger(c.amount)&&c.amount>0&&c.amount<=sale.total-paid(db,sale),"Số tiền thu vượt dư nợ hoặc hóa đơn không còn nợ.");
    check(["Tiền mặt","Chuyển khoản QR"].includes(c.method),"Phương thức không hợp lệ.");
    db.payments.push({id:crypto.randomUUID(),sale:sale.id,at,amount:c.amount,method:c.method,initial:false,collector:person,collectorKey:user});return;
  }
  if(c.kind==="requestChange"){
    check(!owner&&sale?.sellerKey===user&&!sale.cancelled,"Chỉ được yêu cầu xử lý hóa đơn mình đã bán.");
    check(!db.changes.some(x=>x.saleId===sale.id&&x.status==="Chờ duyệt"),"Hóa đơn đã có yêu cầu chờ duyệt.");
    check(["edit","cancel"].includes(c.type),"Loại yêu cầu không hợp lệ.");
    let lines=[];
    if(c.type==="edit"){
      lines=draftLines(db,c.lines);
      check(lines.length===sale.lines.length&&lines.every((l,i)=>l.product===sale.lines[i].product && l.unit===sale.lines[i].unit),"Vui lòng giữ đúng sản phẩm và đơn vị của từng dòng.");
    }
    db.changes.push({...record(),saleId:sale.id,code:sale.code,type:c.type,reason:words(c.reason),lines,status:"Chờ duyệt"});return;
  }
  check(c.kind==="changeReview"&&owner,"Bạn không có quyền thực hiện thao tác.");
  const x=db.changes.find(x=>x.id===c.id),s=db.sales.find(s=>s.id===x?.saleId);
  check(x?.status==="Chờ duyệt" && s && !s.cancelled,"Yêu cầu đã xử lý hoặc hóa đơn không hợp lệ.");
  if(c.approve===true){
    const before=structuredClone(s);
    for(const l of s.lines){
      const p=db.products.find(p=>p.id===l.product);
      check(p && l.allocations?.length,"Không xác định được lô gốc của hóa đơn.");
      for(const a of l.allocations){const lot=p.lots.find(v=>v.id===a.lot);check(lot,"Không tìm thấy lô gốc.");lot.qty=round(lot.qty+a.qty);}
    }
    const received=paid(db,s);
    if(x.type==="edit"){
      // Reuse the sale validator and FIFO allocation without creating a payment or invoice.
      const staged={...db,sales:[],payments:[]};
      const newTotal=x.lines.reduce((n,l)=>n+l.total,0);
      applyStaffCommand(staged,{kind:"sale",sale:{...s,lines:x.lines},payment:{amount:newTotal,method:"Tiền mặt"}},s.sellerName);
      Object.assign(s,{lines:staged.sales[0].lines,total:staged.sales[0].total});
      check(s.client || s.total<=received,"Hóa đơn khách lẻ không thể phát sinh nợ. Hãy hủy và lập lại đơn.");
    }else{Object.assign(s,{lines:[],total:0,cancelled:true});}
    const refund=Math.max(0,received-s.total);
    if(refund){
      check(c.refund===refund && ["Tiền mặt","Chuyển khoản QR"].includes(c.method),"Xác nhận đúng số tiền và phương thức đã hoàn cho khách.");
      db.payments.push({id:crypto.randomUUID(),sale:s.id,at,amount:-refund,method:c.method,initial:false,collector:person,collectorKey:user,refund:true});
    }
    x.original=before;
  }
  x.status=c.approve===true?"Đã duyệt":"Từ chối";x.reviewedAt=at;x.reviewer=person;
}
