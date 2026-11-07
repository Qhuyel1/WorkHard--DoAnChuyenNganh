import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationFeed,reconcileNotifications,dismissReadNotifications} from '../public/notifications-0ad19941e44a.mjs';
import {staffView} from '../lib/staff-sales.mjs';
const at='2026-11-07T10:00:00Z';
const db={products:[],receipts:[],clients:[{id:'c1',name:'Khách A'},{id:'c2',name:'Khách B'}],sales:[{id:'s1',code:'HD001',client:'c1',total:100000,at,sellerKey:'staff1',lines:[]},{id:'s2',code:'HD002',client:'c2',total:50000,at,sellerKey:'staff2',lines:[]}],payments:[{id:'p1',sale:'s1',at,amount:20000,initial:true},{id:'p2',sale:'s1',at,amount:35000,initial:false,method:'Tiền mặt'},{id:'p3',sale:'s2',at,amount:50000,initial:true},{id:'refund',sale:'s1',at,amount:-10000,refund:true}],leaves:[{id:'l1',user:'staff1',person:'Nhân viên A',at,day:'2026-11-08',slot:'Cả ngày',reason:'Việc gia đình',status:'Chờ duyệt'}]};
test('new sale, debt repayment and leave have independent events; initial payment is not debt',()=>{
 const feed=notificationFeed(db);assert.equal(feed.length,4);assert.equal(feed.filter(n=>n.kind==='payment').length,1);assert.match(feed.find(n=>n.kind==='payment').detail,/35\.000 ₫/);
});
test('first visit does not trigger old alerts; later updates alert once, including after reload',()=>{
 const feed=notificationFeed(db),first=reconcileNotifications(feed,null);assert.equal(first.fresh.length,0);assert.equal(first.state.read.length,4);
 const updated=notificationFeed({...db,sales:[...db.sales,{id:'s3',code:'HD003',total:1,at,lines:[]}]});
 const next=reconcileNotifications(updated,JSON.parse(JSON.stringify(first.state)));assert.deepEqual(next.fresh.map(n=>n.id),['sale:s3']);assert.ok(!next.state.read.includes('sale:s3'));assert.equal(reconcileNotifications(updated,next.state).fresh.length,0);
});
test('leave approval creates a new notification without repeating original leave',()=>{
 const first=reconcileNotifications(notificationFeed(db),null);const changed=structuredClone(db);changed.leaves[0].status='Đã duyệt';changed.leaves[0].reviewedAt=at;
 assert.deepEqual(reconcileNotifications(notificationFeed(changed),first.state).fresh.map(n=>n.id),['leave-review:l1']);
});
test('staff feed respects existing server visibility; no fully paid sale from another staff',()=>{
 const feed=notificationFeed(staffView(db,{employeeKey:'staff1'}));assert.ok(!feed.some(n=>n.id==='sale:s2'));assert.ok(feed.some(n=>n.id==='sale:s1'));
 const other=notificationFeed(staffView(db,{employeeKey:'staff2'}));assert.ok(!other.some(n=>n.id==='leave:l1'));
});
test('notification list is capped at latest 100',()=>{
 const feed=notificationFeed({sales:Array.from({length:120},(_,i)=>({id:String(i),code:String(i),at:new Date(i*1000).toISOString()}))});assert.equal(feed.length,100);assert.equal(feed[0].id,'sale:119');
});

test('references point to exact records for detail views',()=>{
 const feed=notificationFeed(db);
 for(const [event,ref] of [['sale:s1','s1'],['payment:p2','p2'],['leave:l1','l1']])assert.equal(feed.find(n=>n.id===event).referenceId,ref);
});
test('deletion hides only read notifications and survives refresh without a new alert',()=>{
 const first=reconcileNotifications(notificationFeed(db),null).state;
 first.read=first.read.filter(id=>id!=='sale:s1');
 const deleted=dismissReadNotifications(first,['sale:s1','payment:p2']);
 assert.deepEqual(deleted.deleted,['payment:p2']);
 const next=reconcileNotifications(notificationFeed(db),JSON.parse(JSON.stringify(deleted)));
 assert.deepEqual(next.state.deleted,['payment:p2']);assert.equal(next.fresh.length,0);
 assert.equal(db.payments.length,4);
});
