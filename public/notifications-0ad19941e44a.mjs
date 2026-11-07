const money = value => Number(value || 0).toLocaleString('vi-VN') + ' ₫';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function notificationFeed(data) {
  const events = [], sales = new Map((data.sales || []).map(s => [s.id,s]));
  const clients = new Map((data.clients || []).map(c => [c.id,c.name]));
  const add = (key, item, title, detail, kind, at=item.at) => events.push({id:key+':'+item.id, title, detail, kind, at, referenceId:item.id});
  for (const s of sales.values()) add('sale',s,'Đơn hàng mới · '+s.code,(s.sellerName || 'Cửa hàng')+' đã tạo đơn '+money(s.total)+' · '+(clients.get(s.client)||'Khách lẻ'),'sale');
  for (const p of data.payments || []) {
    if (p.initial || p.refund || p.amount <= 0) continue;
    const sale = sales.get(p.sale);
    if (!sale) continue;
    add('payment',p,'Khách hàng trả nợ', (clients.get(sale.client)||'Khách hàng')+' đã trả '+money(p.amount)+' cho '+sale.code+' · '+p.method,'payment');
  }
  for (const l of data.leaves || []) {
    add('leave',l,'Đơn xin nghỉ mới',l.person+' xin nghỉ ngày '+l.day.split('-').reverse().join('/')+' · '+l.slot+' · '+l.reason,'leave');
    if (l.reviewedAt) add('leave-review',l,'Đơn xin nghỉ · '+l.status,l.person+' · '+l.day.split('-').reverse().join('/')+' · '+l.slot,'leave',l.reviewedAt);
  }
  for (const c of data.changes || []) {
    add('change',c,'Yêu cầu '+(c.type==='cancel'?'hủy':'sửa')+' hóa đơn',c.person+' · '+c.code+' · '+c.reason,'change');
    if (c.reviewedAt) add('change-review',c,'Yêu cầu hóa đơn · '+c.status,c.code+' · '+(c.reviewer || 'Cửa hàng'),'change',c.reviewedAt);
  }
  return events.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)||a.id.localeCompare(b.id)).slice(0,100);
}
export function reconcileNotifications(feed, previous) {
  const known = new Set(previous?.known || []), read = new Set(previous?.read || []);
  const deleted = new Set(previous?.deleted || []);
  const fresh = previous ? feed.filter(n=>!known.has(n.id)&&!deleted.has(n.id)) : [];
  if (!previous) feed.forEach(n=>read.add(n.id));
  return {fresh, state:{deleted:[...deleted],known:feed.map(n=>n.id),read:feed.filter(n=>read.has(n.id)).map(n=>n.id)}};
}
const bell = '<svg class="notification-bell-icon" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
export function dismissReadNotifications(state, ids) {
  const read = new Set(state.read);
  return {...state,deleted:[...new Set([...(state.deleted || []),...ids.filter(id=>read.has(id))])]};
}
export function createNotificationCenter({onOpen=()=>false}={}) {
  let key='',feed=[],state=null,opened=false,ringUntil=0,toastTimer,exitTimer,toastNode,undoIds=[];
  const storageKey=()=> 'workhard-notifications-v1:'+key;
  function readStorage() {
    try { const value=JSON.parse(localStorage.getItem(storageKey())); return Array.isArray(value?.known)&&Array.isArray(value?.read)?value:null; } catch {return null;}
  }
  function persist() {try {localStorage.setItem(storageKey(),JSON.stringify(state));} catch {/* Keep working when browser storage is unavailable. */}}
  function visible() {const deleted=new Set(state?.deleted || []);return feed.filter(n=>!deleted.has(n.id));}
  function unread() {const read=new Set(state?.read);return visible().filter(n=>!read.has(n.id));}
  function date(at) {const value=new Date(at);return Number.isNaN(+value)?'':value.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});}
  function mount() {
    const host=document.getElementById('notification-center'); if(!host)return;
    const count=unread().length,read=new Set(state?.read),items=visible();
    const scroll=host.querySelector('.notification-list')?.scrollTop || 0;
    const active=document.activeElement?.closest('[data-notice]')?.getAttribute('data-notice');
    host.innerHTML='<button type="button" class="notification-bell '+(Date.now()<ringUntil?'is-ringing':'')+'" data-notice="toggle" aria-label="Thông báo, '+count+' chưa đọc" aria-expanded="'+opened+'" aria-controls="notification-panel">'+bell+(count?'<span class="notification-count" aria-hidden="true">'+(count>99?'99+':count)+'</span>':'')+'</button>'+
      '<section id="notification-panel" class="notification-panel" aria-label="Danh sách thông báo" '+(opened?'':'hidden')+'><div class="notification-heading"><div><h2>Thông báo</h2><p>'+count+' chưa đọc · 100 tin gần nhất</p></div><button type="button" data-notice="close" class="notification-close" aria-label="Đóng thông báo">×</button></div><div class="notification-tools"><button type="button" data-notice="read-all" '+(!count?'disabled':'')+'>Đánh dấu tất cả đã đọc</button><button type="button" data-notice="delete-read" '+(!items.some(n=>read.has(n.id))?'disabled':'')+'>Xóa tất cả đã đọc</button>'+ (undoIds.length?'<button type="button" data-notice="undo">Hoàn tác xóa</button>':'')+'</div><div class="notification-list">'+(items.length?items.map(n=>'<div class="notification-row"><button type="button" class="notification-item '+(!read.has(n.id)?'is-unread':'')+'" data-notice="item-'+feed.indexOf(n)+'" aria-label="'+escape(n.title+(read.has(n.id)?', đã đọc':', chưa đọc'))+'"><span class="notification-symbol '+n.kind+'" aria-hidden="true">'+({sale:'＋',payment:'₫',leave:'◷',change:'↺'}[n.kind])+'</span><span class="notification-copy"><strong>'+escape(n.title)+'</strong><span>'+escape(n.detail)+'</span><time>'+escape(date(n.at))+'</time></span>'+(!read.has(n.id)?'<i class="notification-dot" aria-hidden="true"></i>':'')+'</button>'+(read.has(n.id)?'<button type="button" class="notification-delete" data-notice="delete-'+feed.indexOf(n)+'" aria-label="Xóa thông báo '+escape(n.title)+'" title="Xóa thông báo">×</button>':'')+'</div>').join(''):'<div class="notification-empty">'+bell+'<p>Chưa có thông báo</p><span>Hoạt động mới sẽ xuất hiện tại đây.</span></div>')+'</div></section>';
    host.querySelector('.notification-list').scrollTop=scroll;
    if(active) [...host.querySelectorAll('[data-notice]')].find(el=>el.dataset.notice===active)?.focus({preventScroll:true});
  }
  function dismissToast() {
    clearTimeout(toastTimer);clearTimeout(exitTimer);
    if(!toastNode)return;
    const node=toastNode;node.classList.add('is-leaving');
    exitTimer=setTimeout(()=>{node.remove();if(toastNode===node)toastNode=null;},300);
  }
  function toast(items) {
    clearTimeout(toastTimer);clearTimeout(exitTimer);toastNode?.remove();
    const n=items[0];toastNode=document.createElement('div');toastNode.className='notification-toast';
    toastNode.innerHTML='<div class="notification-toast-body" role="status" aria-live="polite">'+bell+'<div><strong>'+escape(items.length>1?'Có '+items.length+' thông báo mới':n.title)+'</strong><p>'+escape(items.length>1?n.title+' và '+(items.length-1)+' hoạt động khác.':n.detail)+'</p></div></div><div class="notification-toast-actions"><button type="button" data-notice="open">Xem thông báo</button><button type="button" data-notice="dismiss" aria-label="Ẩn thông báo">×</button></div>';
    document.body.append(toastNode);toastTimer=setTimeout(dismissToast,5500);
    toastNode.addEventListener('mouseenter',()=>clearTimeout(toastTimer));
    toastNode.addEventListener('mouseleave',()=>{toastTimer=setTimeout(dismissToast,3500);});
    toastNode.addEventListener('focusin',()=>clearTimeout(toastTimer));
    toastNode.addEventListener('focusout',()=>{toastTimer=setTimeout(dismissToast,3500);});
  }
  function update(data,user) {
    if(!user)return;
    if(key!==user){key=user;state=readStorage();opened=false;undoIds=[];toastNode?.remove();toastNode=null;}
    feed=notificationFeed(data);
    const result=reconcileNotifications(feed,state);state=result.state;persist();
    if(result.fresh.length){ringUntil=Date.now()+1800;toast(result.fresh);}
    mount();
  }
  document.addEventListener('click',e=>{
    const target=e.target.closest('[data-notice]');
    if(!target){if(opened&&!e.target.closest('#notification-center')){opened=false;mount();}return;}
    const action=target.dataset.notice;
    if(action==='dismiss'){dismissToast();return;}
    if(action==='toggle'){opened=!opened;if(opened)dismissToast();}
    else if(action==='open'){opened=true;dismissToast();}
    else if(action==='close')opened=false;
    else if(action==='read-all'){state.read=feed.map(n=>n.id);persist();}
    else if(action==='undo'){state.deleted=(state.deleted||[]).filter(id=>!undoIds.includes(id));undoIds=[];persist();}
    else if(action==='delete-read'||action.startsWith('delete-')){
      const item=feed[Number(action.slice(7))];
      const ids=action==='delete-read'?visible().filter(n=>state.read.includes(n.id)).map(n=>n.id):item?[item.id]:[];
      undoIds=ids.filter(id=>state.read.includes(id)&&!(state.deleted||[]).includes(id));
      state=dismissReadNotifications(state,ids);persist();
    }
    else if(action.startsWith('item-')){
      const item=feed[Number(action.slice(5))];
      if(item && onOpen(item)!==false){state.read=[...new Set([...state.read,item.id])];persist();opened=false;dismissToast();}
    }
    mount();
    if(action==='close')document.querySelector('.notification-bell')?.focus();
    if(action==='open')document.querySelector('[data-notice="close"]')?.focus();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&opened){opened=false;mount();document.querySelector('.notification-bell')?.focus();}});
  window.addEventListener('storage',e=>{if(key&&e.key===storageKey()){state=readStorage()||state;mount();}});
  return {update,mount,reset(){key='';feed=[];state=null;opened=false;clearTimeout(toastTimer);clearTimeout(exitTimer);toastNode?.remove();toastNode=null;}};
}
