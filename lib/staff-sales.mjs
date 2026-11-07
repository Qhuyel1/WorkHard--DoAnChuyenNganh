const round = value => Math.round(value * 1e6) / 1e6;
function requireValue(condition) {
  if (!condition) throw Error("Dữ liệu bán hàng không hợp lệ hoặc số lượng tồn không đủ.");
}
export function staffView(db,actor) {
  const own=s=>s.sellerKey===actor.employeeKey;
  const paid=new Map(), collected=new Set();
  for (const p of db.payments) {
    paid.set(p.sale,(paid.get(p.sale)||0)+p.amount);
    if (p.collectorKey===actor.employeeKey) collected.add(p.sale);
  }
  const sales=db.sales.filter(s=>own(s) || collected.has(s.id) || s.total>(paid.get(s.id)||0));
  const ids=new Set(sales.map(s=>s.id));
  return {
    products: db.products.filter(p => !p.archived).map(({id,name,brand,width,price,pack,unit,factor,lots,image}) =>
      ({id,name,brand,width,price,pack,unit,factor,image,lots:lots.map(({id,code,qty})=>({id,code,qty}))})),
    clients: db.clients.filter(c=>!c.archived).map(({id,name,address,phone})=>({id,name,address,phone})),
    sales:sales.map(({id,code,at,client,sellerName,total,lines,cancelled,sellerKey})=>({id,code,at,client,sellerName,total,cancelled,mine:sellerKey===actor.employeeKey,lines:lines.map(({allocations,...line})=>line)})),
    payments:db.payments.filter(p=>ids.has(p.sale)).map(({collectorKey,...payment})=>payment),receipts:[],
    ...Object.fromEntries(["shifts","leaves","drafts","changes"].map(key=>[key,(db[key]||[]).filter(r=>r.user===actor.employeeKey).map(({original,...item})=>item)])), bank:db.bank, storeLocation:db.storeLocation, manualAttendance:(db.manualAttendance||[]).filter(r=>r.user===actor.employeeKey), storeProfile:db.storeProfile, saleCount:db.sales.length
  };
}
export function applyStaffCommand(db, command, sellerName) {
  if (command.kind === "client") {
    const {id,name,address,phone} = command.client;
    requireValue(typeof id === "string" && !db.clients.some(c=>c.id===id) &&
      [name,address,phone].every(v=>typeof v==="string" && v.trim() && v.length<=500));
    db.clients.push({id,name,address,phone});
    return;
  }
  requireValue(command.kind==="sale");
  const {sale,payment} = command;
  requireValue(typeof sale.id==="string" && !db.sales.some(s=>s.id===sale.id) && Array.isArray(sale.lines) && sale.lines.length);
  requireValue(!sale.client || db.clients.some(c=>c.id===sale.client && !c.archived));
  const lines = sale.lines.map(item=>{
    const p = db.products.find(p=>p.id===item.product && !p.archived);
    requireValue(p && (item.unit===p.unit || (p.pack && item.unit===p.pack)));
    const {quantity,price,unit}=item;
    const base=round(quantity*(unit===p.pack?p.factor:1));
    requireValue(Number.isFinite(quantity) && quantity>0 && Number.isSafeInteger(price) && price>=0 && base>0);
    let left=base;
    const allocations=[];
    for (const lot of p.lots) {
      if (p.width && lot.id!==item.lot) continue;
      const take=Math.min(left,lot.qty);
      if (take>0) allocations.push({lot:lot.id,qty:take});
      lot.qty=round(lot.qty-take);
      left=round(left-take);
      if (!left) break;
    }
    requireValue(!left);
    const name=[p.name,p.brand,p.width?'khổ '+p.width.toLocaleString('vi-VN')+' m':''].filter(Boolean).join(' · ');
    return {allocations,product:p.id,name,quantity,unit,price,base,width:p.width,lot:p.width?item.lot:"",total:Math.round(quantity*(p.width||1)*price)};
  });
  const total=lines.reduce((sum,l)=>sum+l.total,0);
  const amount=payment ? payment.amount : 0;
  requireValue(Number.isSafeInteger(total) && Number.isSafeInteger(amount) && amount>=0 && amount<=total && (amount===total || sale.client));
  const code='HD'+String(db.sales.length+1).padStart(6,'0'),at=new Date().toISOString();
  if (payment) {
    requireValue(["Tiền mặt","Chuyển khoản QR"].includes(payment.method));
    db.payments.push({id:crypto.randomUUID(),sale:sale.id,at,method:payment.method,amount,initial:true});
  }
  db.sales.push({id:sale.id,code,at,client:sale.client,lines,total,sellerName});
}

export function preserveSaleSellers(previousSales, sales) {
  const names=new Map(previousSales.map(s=>[s.id,s.sellerName]));
  for (const sale of sales) {
    sale.sellerName=names.has(sale.id) ? names.get(sale.id) : "Cửa hàng";
  }
}
