// Single-file ESM; effects start in activate. Native operations use the proposed
// host bus protocol described in HOST_PLUGIN_PROTOCOL.md, never a private API.
export const PROTOCOL = 'class-attendance/1'
export const PROVIDER = 'shugao.attendance-service'
export const ORIENTATION = '照片左侧＝人面向摄像头时的右手侧；第1列在照片左侧。'
// Kept empty in the public edition; private packaging supplies an offline roster.
export const BUNDLED_ROSTER = null
const copy = v => JSON.parse(JSON.stringify(v))
const LABEL = { PRESENT:'到场', ABSENT:'缺勤', LEAVE:'请假', OCCUPIED:'AI有人', EMPTY:'疑似空座', UNKNOWN:'待核实' }

export function resolveRoster(resource, bundled=BUNDLED_ROSTER) {
  const normalize = rows => {
    const used=new Set()
    return (Array.isArray(rows)?rows:[]).filter(s=>s&&typeof s.id==='string'&&s.id.trim()&&typeof s.name==='string'&&s.name.trim()&&!used.has(s.id)&&used.add(s.id)).map(s=>({id:s.id,name:s.name,no:String(s.no??'')}))
  }
  const host=normalize(resource?.students)
  if(host.length)return{students:host,source:'host',stale:!!resource.stale,className:null}
  const local=normalize(bundled?.students)
  return{students:local,source:local.length?'bundled':'empty',stale:false,className:local.length?bundled.className:null}
}

export function validateAssignments(map, seats, students) {
  const s = new Set(seats.map(x => x.id)), p = new Set(students.map(x => x.id)), used = new Set()
  for (const [seat, person] of Object.entries(map)) {
    if (!s.has(seat) || !p.has(person)) throw new Error('排座引用了已移除的座位或学生，请重新检查。')
    if (used.has(person)) throw new Error('同一名学生不能分配到两个座位。')
    used.add(person)
  }
}
export function assignStudent(map, person, target, seats, students) {
  const next = {...map}, origin = Object.keys(next).find(k => next[k] === person), displaced = next[target]
  if (origin) delete next[origin]
  if (target) next[target] = person
  if (displaced && displaced !== person && origin) next[origin] = displaced
  validateAssignments(next, seats, students); return next
}
export function validateSeats(seats) {
  const ids = new Set(), positions = new Set()
  for (const s of seats) {
    const pos = `${s.row}/${s.col}`
    if (!s.id || ids.has(s.id) || positions.has(pos)) throw new Error('座位编号或行列位置重复。')
    if (![s.row,s.col].every(x => Number.isInteger(x) && x > 0 && x <= 20)) throw new Error('座位行列须在1到20之间。')
    ids.add(s.id); positions.add(pos)
    for (const polygon of [s.body || [],s.upper || []]) {
      if (polygon.length && (polygon.length < 3 || polygon.some(p => p.length !== 2 || p.some(x => !Number.isFinite(x) || x < 0 || x > 1)))) throw new Error('座位区域至少需要3个顶点，且必须位于照片内。')
    }
  }
}
export function displayStatus(p) { return p?.confirmed || (p?.manualOnly ? 'UNKNOWN' : p?.visual) || 'UNKNOWN' }
export function setStatus(record, seatId, status, now, note = '老师人工确认') {
  const next = copy(record)
  if (next.state !== 'PENDING') throw new Error('已提交的考勤不能继续修改。')
  const p = next.people.find(p => p.seatId === seatId)
  if (!p) return next
  if (status !== null && !['PRESENT','ABSENT','LEAVE'].includes(status)) throw new Error('考勤状态无效。')
  next.audit.push({studentId:p.studentId,seatId,previous:p.confirmed,status,at:now,note})
  p.confirmed = status; return next
}
export function togglePerson(record, seatId, now) {
  const p = record.people.find(p => p.seatId === seatId)
  return p ? setStatus(record,seatId,['PRESENT','OCCUPIED'].includes(displayStatus(p)) ? 'ABSENT' : 'PRESENT',now,'老师点击座位') : record
}
export function confirmRemaining(record, now) {
  let next = copy(record)
  for (const p of record.people) if (!p.confirmed && !p.manualOnly && ['OCCUPIED','EMPTY'].includes(p.visual)) next = setStatus(next,p.seatId,p.visual === 'OCCUPIED' ? 'PRESENT' : 'ABSENT',now,'老师主动接受AI建议')
  return next
}
export function submitRecord(record, now) {
  if (record.state !== 'PENDING') throw new Error('本次考勤已经提交，请勿重复提交。')
  if (record.people.some(p => !p.confirmed)) throw new Error('还有学生未确认，请先处理黄色座位和盲区。')
  return {...copy(record),state:'SUBMITTED',submittedAt:now}
}
export function csvRecord(record) {
  const cell = v => {const text=String(v??'');return '"'+(/^[\s]*[=+@-]|^[\t\r]/.test(text)?"'"+text:text).replaceAll('"','""')+'"'}
  const rows = [['考勤时间','座位表','座位','学生姓名','状态','备注'],...record.people.map(p => [record.at,record.chartTitle,p.seatId,p.name,LABEL[p.confirmed] || '待确认',p.note || ''])]
  return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')
}
export function makeDemo(now, today=now.slice(0,10)) {
  const students = Array.from({length:40},(_,i) => ({id:`demo-${i+1}`,name:`演练学生${String(i+1).padStart(2,'0')}`,no:String(i+1)}))
  const seats = students.map((s,i) => ({id:`R${Math.floor(i/8)+1}C${i%8+1}`,row:Math.floor(i/8)+1,col:i%8+1,manualOnly:i===0 || i===7,body:[],upper:[]}))
  const chart = {id:'demo-chart-1',title:'演练座位表',effectiveDate:today,assignments:Object.fromEntries(seats.map((s,i) => [s.id,students[i].id]))}
  return {students,seats,charts:[chart],currentChartId:chart.id,schedule:['08:00','14:00'],records:[],camera:'模拟摄像头',model:'合成判断，无AI推理'}
}
export function demoRecord(data, chart, scenario, now, key) {
  const names = Object.fromEntries(data.students.map(s => [s.id,s.name]))
  return {id:key,at:now,chartId:chart.id,chartTitle:chart.title,chartSnapshot:copy(chart),seats:copy(data.seats),state:'PENDING',simulation:true,audit:[],
    people:Object.entries(chart.assignments).map(([seatId,studentId],i) => {
      const seat = data.seats.find(s => s.id === seatId)
      const visual = seat.manualOnly || scenario === 'failure' ? 'UNKNOWN' : scenario === 'absence' && [9,18,27,35].includes(i) ? 'EMPTY' : scenario === 'moving' && [10,11].includes(i) ? 'UNKNOWN' : 'OCCUPIED'
      return {studentId,name:names[studentId],seatId,visual,manualOnly:seat.manualOnly,confirmed:null,note:'',reason:seat.manualOnly ? '摄像头盲区，必须人工核实。' : visual === 'UNKNOWN' ? '模拟识别不确定，等待老师判断。' : '合成的10帧演练证据，不代表真实AI识别结果。'}
    })}
}
export class LocalPort {
  constructor(ctx,onEvent) {
    this.ctx=ctx; this.pending=new Map(); this.serial=0; this.closed=false; this.client=Math.random().toString(36).slice(2)
    this.off=ctx.bus ? ctx.bus.on('attendance.local.response',(p,from) => {
      if (this.closed || from !== PROVIDER || p?.protocol !== PROTOCOL || p.client !== this.client || p.classId !== ctx.class.id) return
      const job=this.pending.get(p.requestId); if (!job) return
      clearTimeout(job.timer); this.pending.delete(p.requestId)
      if (p.ok) job.resolve(p.value)
      else job.reject(new Error('本机考勤服务未完成操作，请检查设备状态后重试。'))
    }) : () => {}
    this.offEvent=ctx.bus ? ctx.bus.on('attendance.local.event',(p,from) => {
      if (!this.closed && from === PROVIDER && p?.protocol === PROTOCOL && p.classId === ctx.class.id) onEvent(p)
    }) : () => {}
  }
  request(operation,payload={},timeout=2500) {
    if (!this.ctx.bus || this.closed) return Promise.reject(new Error('这台设备没有接入本机考勤服务。'))
    const requestId=`${this.client}-${++this.serial}`
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => {this.pending.delete(requestId);reject(new Error('这台设备的本机考勤服务未响应。'))},timeout)
      this.pending.set(requestId,{resolve,reject,timer})
      try{this.ctx.bus.emit('attendance.local.request',{protocol:PROTOCOL,classId:this.ctx.class.id,client:this.client,requestId,operation,payload})}catch(error){clearTimeout(timer);this.pending.delete(requestId);reject(error)}
    })
  }
  close() {this.closed=true;this.off();this.offEvent();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('考勤界面已关闭。'))}this.pending.clear()}
}

const CSS = `
:host{display:block;height:100%;color:var(--color-ink);font:16px/1.45 "Microsoft YaHei UI",system-ui,sans-serif}
*{box-sizing:border-box}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.48}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--color-accenttext);outline-offset:2px}
.app{height:100%;display:flex;flex-direction:column;background:var(--color-surface);padding:20px;gap:14px;overflow:auto}.top,.bar,.actions,.stats,.tabs,.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.top{justify-content:space-between}.heading{font-size:26px;font-weight:700;margin:0}.muted{color:var(--color-ink3)}.meta{color:var(--color-ink2);margin-top:4px}.grow{flex:1}.tag{padding:5px 10px;border-radius:var(--radius-sm);background:var(--color-accentsoft);color:var(--color-accenttext);font-weight:600}
button{min-height:44px;padding:8px 16px;border:1px solid var(--color-line);border-radius:var(--radius-sm);background:var(--color-surface2)}button.primary{background:var(--color-accentsoft);color:var(--color-accenttext);border:2px solid var(--color-accent);font-weight:700}button.link{border-color:transparent;background:transparent;color:var(--color-accenttext)}button.danger{color:var(--color-bad)}
.tabs{gap:4px;border-bottom:1px solid var(--color-line);padding-bottom:8px}.tabs button{background:transparent;border-color:transparent}.tabs button.active{color:var(--color-accenttext);background:var(--color-accentsoft);font-weight:700}
.notice{padding:10px 14px;background:var(--color-surface2);border-left:4px solid var(--color-warn);border-radius:var(--radius-sm)}.orientation{color:var(--color-ink2);padding:10px 14px;background:var(--color-surface2);border-radius:var(--radius-sm)}.board{flex:1;min-height:260px;overflow:auto;padding:4px}.stage{max-width:360px;text-align:center;background:var(--color-surface2);padding:8px;margin:0 auto 18px;border-bottom:3px solid var(--color-accent);border-radius:var(--radius-sm)}
.seat-grid{display:grid;gap:12px;min-width:640px;align-content:start}.seat{min-height:90px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;padding:8px 4px;background:var(--color-surface2);border:1px solid var(--color-line);border-top:5px solid var(--color-line);color:var(--color-ink)}.seat .name{font-size:19px;font-weight:650;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.seat .where{color:var(--color-ink3)}.seat .state{font-weight:600}.seat.present{border-top-color:var(--color-ok)}.seat.absent{border-top-color:var(--color-bad)}.seat.unknown{border-top-color:var(--color-warn)}.seat.leave{border-top-color:var(--color-accenttext)}.seat.selected{outline:3px solid var(--color-accenttext);outline-offset:1px}.seat.empty{opacity:.6}
.stats{gap:20px}.stat{display:flex;align-items:baseline;gap:6px}.stat strong{font-size:40px;font-variant-numeric:tabular-nums;font-weight:650}.footer{border-top:1px solid var(--color-line);padding-top:12px}.split{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:20px;flex:1;min-height:0}.panel{padding:16px;background:var(--color-surface2);border-radius:var(--radius-md);overflow:auto}.panel h3{margin:0 0 12px;font-size:19px}.people{display:flex;flex-direction:column;gap:8px;max-height:330px;overflow:auto}.person{text-align:left;touch-action:none}.form{display:flex;flex-direction:column;gap:14px}.field{display:flex;flex-direction:column;gap:6px}input,select,textarea{background:var(--color-surface);border:1px solid var(--color-line);padding:9px;border-radius:var(--radius-sm);min-width:0;max-width:100%}.empty-state{text-align:center;max-width:640px;margin:28px auto;padding:24px;color:var(--color-ink2)}.empty-state h2{color:var(--color-ink);font-size:24px}.list{display:flex;flex-direction:column;gap:10px}.record{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:14px;background:var(--color-surface2);border-radius:var(--radius-sm)}
.overlay{position:fixed;inset:0;background:var(--color-surface2);display:flex;align-items:center;justify-content:center;z-index:10;padding:16px}.dialog{background:var(--color-surface);border:1px solid var(--color-line);border-radius:var(--radius-lg);padding:24px;max-width:620px;width:100%;max-height:90%;overflow:auto}.dialog h2{margin-top:0}.dialog .actions{margin-top:20px;justify-content:flex-end}.compact{display:none}.compact .count{font-size:40px;font-variant-numeric:tabular-nums}.compact p{margin:0}.photo-stage{position:relative;width:100%;background:var(--color-surface2);touch-action:none}.photo-stage img{display:block;width:100%;height:100%;object-fit:fill}.photo-stage svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.evidence{max-width:100%;max-height:200px;object-fit:contain}.drag-ghost{position:fixed;z-index:20;padding:10px 18px;pointer-events:none;background:var(--color-accentsoft);color:var(--color-accenttext);border:2px solid var(--color-accent);border-radius:var(--radius-sm)}
.app{padding:16px;gap:10px}.top>div:first-child{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}.heading{font-size:24px}.tabs{padding-bottom:4px}.notice,.orientation{padding:7px 12px}.board{min-height:0}.seat-grid{gap:8px}.seat{min-height:66px;padding:4px;gap:0;line-height:1.15}.seat .name{font-size:18px}.stage{padding:5px;margin-bottom:10px}.footer{padding-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.footer .actions{flex:1;justify-content:flex-end}.stats{gap:16px}.split{min-height:0}
@container (max-width:650px){.app{padding:12px;gap:10px}.heading{font-size:23px}.split{display:flex;flex-direction:column}.panel{max-height:280px}.seat-grid{gap:8px}.stats{gap:10px}}
@container (max-width:450px){.full{display:none!important}.compact{display:flex;flex-direction:column;gap:8px}.app{justify-content:center}.compact .muted{font-size:16px}}
`
function el(doc,tag,text,cls){const e=doc.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);if(cls)e.className=cls;return e}

export class AttendanceApp {
  constructor(ctx,root,doc){
    Object.assign(this,{ctx,root,doc,dead:false,simulation:false,ready:false,page:'attendance',record:null,draft:null,selected:null,message:'正在检查本机考勤服务…',running:false,progress:0,scenario:'absence',busy:false,requestKey:null,editor:null,drag:null})
    this.data={students:[],seats:[],charts:[],records:[],schedule:[]};this.undoStack=[];this.redoStack=[];this.timers=new Set();this.alerts=new Set()
    this.port=new LocalPort(ctx,p=>this.hostEvent(p))
  }
  now(){return this.ctx.now().toISOString()}
  today(){return this.ctx.now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}
  nextText(){
    if(this.simulation){const times=[...(this.data.schedule||[])].sort(),hm=this.ctx.now().toLocaleTimeString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}).slice(0,5),next=times.find(t=>t>hm);return next?`今天 ${next}`:times.length?`明天 ${times[0]}`:'未设置'}
    if(this.data.nextDueAt){const t=Date.parse(this.data.nextDueAt);if(Number.isFinite(t))return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(t)}
    return this.ready&&this.data.schedule.length?'待本机服务计算':'未设置'
  }
  chart(){return this.data.charts.find(c=>c.id===this.data.currentChartId)||null}
  async init(){this.render();await this.loadRoster();if(this.dead)return;try{const v=await this.port.request('bootstrap');if(!this.dead&&!this.simulation)this.acceptBootstrap(v)}catch{if(!this.dead&&!this.simulation){this.ready=false;this.serviceChecked=true;this.message='';this.render()}}}
  async loadRoster(){
    if(this.simulation)return
    let resource=null,failed=false
    try{if(this.ctx.data)resource=await this.ctx.data.read('class.roster')}catch{failed=true}
    if(this.dead||this.simulation)return
    const roster=resolveRoster(resource),previous=this.rosterSource
    this.data.students=roster.students;this.stale=roster.stale;this.rosterSource=roster.source;this.rosterClassName=roster.className
    if(failed&&!roster.students.length)this.message='班级名单读取失败，请回到教务通检查本班名单。'
    else if(previous==='bundled'&&roster.source==='host')this.message='已读取教务通正式名单，请核对学生与座位的对应关系。'
    this.render()
  }
  acceptBootstrap(v){
    if(v?.protocol!==PROTOCOL||v.localOnly!==true||!Array.isArray(v.seats)||!Array.isArray(v.charts)||!Array.isArray(v.records)||!Array.isArray(v.schedule))throw new Error('本机考勤服务版本不匹配。')
    validateSeats(v.seats)
    this.data={...copy(v),students:this.data.students};this.ready=true;this.serviceChecked=true;this.running=!!v.activeTask;this.progress=Number(v.activeTask?.count)||0;this.record=this.data.records.find(r=>r.state==='PENDING')||null;this.message=this.running?'本机考勤任务正在执行，请等待采集与识别完成。':this.record?'已恢复待确认考勤，请继续核对。':'';this.render()
  }
  async hostEvent(p){
    if(this.simulation||this.dead)return
    if(p.kind==='reminder'&&!this.alerts.has(p.taskKey)){this.alerts.add(p.taskKey);if(this.alerts.size>100)this.alerts.delete(this.alerts.values().next().value);if(this.ctx.sound)this.ctx.sound.play('ding');this.message='30秒后开始考勤，请保持摄像头前方无遮挡。';this.render()}
    else if(p.kind==='progress'){this.running=true;this.progress=Number(p.count)||0;this.message=p.phase==='capture'?`正在拍照 ${this.progress}/10，请稍候。`:'照片已采集完成，正在本机识别。';this.render()}
    else if(p.kind==='changed'){try{this.acceptBootstrap(await this.port.request('bootstrap'))}catch{this.message='考勤状态暂时无法读取，请检查本机服务。';this.render()}}
  }
  enterDemo(){if(this.running||this.busy||this.simulation)return;this.realData=this.data;this.realRecord=this.record;this.realReady=this.ready;this.realReference=this.reference;this.realTestResult=this.testResult;this.reference=null;this.testResult=null;this.data=makeDemo(this.now(),this.today());this.simulation=true;this.record=null;this.draft=null;this.page='attendance';this.message='';this.render()}
  exitDemo(){if(this.running){this.message='请等本次演练采集完成后再退出。';this.render();return}this.data=this.realData;this.record=this.realRecord;this.ready=this.realReady;this.reference=this.realReference;this.testResult=this.realTestResult;this.simulation=false;this.draft=null;this.editor=null;this.page='attendance';this.message='';this.render();void this.init()}
  ensureDraft(){if(this.draft)return;this.draft={title:'新座位表',effectiveDate:this.today(),assignments:copy(this.chart()?.assignments||{}),seats:copy(this.data.seats)};this.undoStack=[];this.redoStack=[]}
  changeDraft(next){this.undoStack.push(copy(this.draft));this.undoStack=this.undoStack.slice(-50);this.redoStack=[];this.draft=next;this.render()}
  moveStudent(student,target){this.ensureDraft();this.changeDraft({...this.draft,assignments:assignStudent(this.draft.assignments,student,target,this.draft.seats,this.data.students)})}
  reseat(){this.ensureDraft();const keys=Object.keys(this.draft.assignments);if(keys.length<2)throw new Error('至少排好两名学生后才能一键换位。');const next=copy(this.draft);keys.forEach((k,i)=>{next.assignments[k]=this.draft.assignments[keys[(i+1)%keys.length]]});this.changeDraft(next);this.message='已轮换一个座位，请检查并拖动微调，再保存新版本。';this.render()}
  async saveChart(){
    this.ensureDraft();validateSeats(this.draft.seats);validateAssignments(this.draft.assignments,this.draft.seats,this.data.students)
    const date=this.draft.effectiveDate,parts=date.split('-').map(Number),[y,m,d]=parts,max=[31,(y%4===0&&y%100!==0)||y%400===0?29:28,31,30,31,30,31,31,30,31,30,31][m-1]
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!max||d<1||d>max||y<2000||!this.draft.title.trim())throw new Error('请填写座位表名称和有效的生效日期。')
    if(this.simulation){const c={id:`demo-chart-${this.data.charts.length+1}`,title:this.draft.title.trim(),effectiveDate:this.draft.effectiveDate,assignments:copy(this.draft.assignments)};this.data.seats=copy(this.draft.seats);this.data.charts.push(c);if(c.effectiveDate<=this.today())this.data.currentChartId=c.id}
    else{if(!this.ready)throw new Error('本机考勤服务未接入，排座草稿尚未保存。');await this.port.request('saveChart',copy(this.draft));this.acceptBootstrap(await this.port.request('bootstrap'))}
    this.draft=null;this.undoStack=[];this.redoStack=[];this.message='座位表已保存为新版本。';this.render()
  }
  async start(){
    if(this.running||this.busy)return
    const pending=this.data.records.find(r=>r.state==='PENDING')
    if(pending){this.record=pending;this.page='attendance';this.message='请先处理已有的待确认考勤。';this.render();return}
    const c=this.chart();if(!c||!Object.keys(c.assignments).length)throw new Error('请先排好座位并保存生效版本。')
    validateAssignments(c.assignments,this.data.seats,this.data.students)
    if(!this.simulation){if(!this.ready)throw new Error('这台设备尚未接入摄像头与本机识别服务。');this.requestKey||=`manual-${this.now()}-${Math.random().toString(36).slice(2)}`;await this.port.request('start',{taskKey:this.requestKey},5000);this.running=true;this.acceptBootstrap(await this.port.request('bootstrap'));this.requestKey=null;return}
    this.running=true;this.progress=0;this.message='演练采集中，不会调用真实摄像头。';this.render()
    const key=`demo-task-${this.now()}-${this.data.records.length}`,snapshot=copy(this.data),chart=copy(c),scenario=this.scenario
    const timer=setInterval(()=>{if(this.dead)return;this.progress++;if(this.progress>=10){clearInterval(timer);this.timers.delete(timer);this.running=false;this.record=demoRecord(snapshot,chart,scenario,this.now(),key);this.data.records.unshift(this.record);this.data.records=this.data.records.slice(0,100);this.message='演练完成：10帧合成结果，请点座位核对。'}this.render()},1000);this.timers.add(timer)
  }
  async updateRecord(next,operation,payload={}){
    if(this.running)throw new Error('采集或识别尚未完成，请稍后核对。')
    if(this.simulation){this.record=next;const i=this.data.records.findIndex(r=>r.id===next.id);if(i>=0)this.data.records[i]=copy(next)}
    else{if(!this.ready)throw new Error('本机服务未接入，无法保存人工确认。');this.record=copy(await this.port.request(operation,{recordId:this.record.id,...payload}));const i=this.data.records.findIndex(r=>r.id===this.record.id);if(i>=0)this.data.records[i]=copy(this.record)}this.render()
  }
  async clickSeat(seatId){this.selected=seatId;if(!this.record||this.record.state!=='PENDING'){this.render();return}await this.updateRecord(togglePerson(this.record,seatId,this.now()),'toggle',{seatId})}
  async submit(){await this.updateRecord(submitRecord(this.record,this.now()),'submit');this.message=this.simulation?'演练考勤已提交，仅保留在本次演练内。':'本次考勤已提交并保存在本机。';this.render()}
  close(){this.dead=true;this.port.close();for(const t of this.timers){clearInterval(t);clearTimeout(t)}this.timers.clear();this.drag?.ghost?.remove();this.root.remove?.();for(const k of ['data','record','draft','realData','realRecord','reference','realReference','testResult','realTestResult'])this[k]=null}
}

Object.assign(AttendanceApp.prototype, {
  h(tag,text,cls){return el(this.doc,tag,text,cls)},
  async perform(fn){if(this.working||this.dead)return;this.working=true;try{await fn()}catch(e){if(!this.dead){this.message=e.message||'操作未完成，请检查设备后重试。';this.ctx.log?.('attendance action failed',e)}}finally{this.working=false;if(!this.dead)this.render()}},
  button(text,fn,cls='',disabled=false){const b=this.h('button',text,cls);b.type='button';b.disabled=disabled;b.addEventListener('click',()=>void this.perform(fn));return b},
  input(label,value,onChange,type='text'){const wrap=this.h('label',null,'field');wrap.append(this.h('span',label));const input=this.h('input');input.type=type;input.value=value;input.addEventListener('change',()=>onChange(input.value));wrap.append(input);return wrap},
  dialog(title,build,confirm,label='确定'){
    const layer=this.h('div',null,'overlay'),box=this.h('section',null,'dialog');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);box.tabIndex=-1;box.append(this.h('h2',title));layer.append(box)
    build(box);const error=this.h('p','','notice');error.hidden=true;box.append(error)
    const dismiss=()=>{this.modal=false;layer.remove()},actions=this.h('div',null,'actions'),cancel=this.button(confirm?'取消':'关闭',dismiss);actions.append(cancel)
    if(confirm)actions.append(this.button(label,async()=>{try{await confirm();dismiss()}catch(e){error.hidden=false;error.textContent=e.message}},'primary'))
    box.append(actions);this.modal=true;this.shadow.append(layer);box.focus()
    layer.addEventListener('keydown',e=>{if(e.key==='Escape'){dismiss();this.render()}if(e.key==='Tab'){const items=[...box.querySelectorAll('button,input,select,textarea')].filter(x=>!x.disabled);const first=items[0],last=items.at(-1);if(e.shiftKey&&(this.shadow.activeElement===first||this.shadow.activeElement===box)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&this.shadow.activeElement===last){e.preventDefault();first?.focus()}}})
  },
  render(){
    if(this.dead||!this.doc)return
    // Dialogs remain open on minute updates; user actions close them explicitly.
    if(this.modal)return
    if(this.shadow?.activeElement?.matches('input,select,textarea')&&!this.working)return
    this.shadow ||= this.root.attachShadow({mode:'open'})
    this.root.style.cssText='display:block;height:100%;min-height:0;container-type:inline-size'
    this.shadow.replaceChildren();const style=this.h('style',CSS),app=this.h('div',null,'app');this.shadow.append(style,app)
    const compact=this.h('section',null,'compact');compact.append(this.h('strong',this.simulation?'考勤演练':'教室考勤'),this.h('div',this.running?`采集 ${this.progress}/10`:this.record?.state==='PENDING'?`${this.record.people.filter(p=>!p.confirmed).length} 人待核实`:'等待考勤','count'),this.h('p',this.simulation?'合成结果，不是真实AI':this.ready?'本机服务已连接':'本机考勤服务未接入','muted'),this.button('展开座位表',()=>this.ctx.ui.setSize(12,9),'primary'))
    app.append(compact)
    const header=this.h('header',null,'top full'),titles=this.h('div');titles.append(this.h('h1','教室考勤','heading'))
    const className=!this.simulation&&this.rosterSource==='bundled'?this.rosterClassName:this.ctx.class.name
    const chart=this.record&&this.page==='attendance'?{title:this.record.chartTitle}:this.chart();titles.append(this.h('div',`${className || '当前班级'}　座位表：${chart?.title || '尚未设置'}　下一次：${this.nextText()}`,'meta'));header.append(titles)
    const right=this.h('div',null,'row');if(this.simulation)right.append(this.h('span','离线演练 · 合成结果','tag'),this.button('退出演练',()=>this.exitDemo(),'link'));else right.append(this.button('离线演练',()=>this.enterDemo(),'link'));header.append(right);app.append(header)
    const tabs=this.h('nav',null,'tabs full');for(const [key,title] of [['attendance','考勤'],['seating','排座'],['history','记录'],['test','现场测试']])tabs.append(this.button(title,()=>{this.page=key;this.editor=null;this.selected=null;this.message='';this.render()},this.page===key?'active':''));app.append(tabs)
    if(this.message)app.append(this.h('div',this.message,'notice full'))
    if(!this.ready&&!this.simulation&&this.serviceChecked)app.append(this.h('div','这台设备尚未接入本机考勤服务。正式拍照与保存暂不可用，可进入离线演练。','notice full'))
    if(this.stale&&!this.simulation)app.append(this.h('div','当前名单为宿主缓存，请核对班级和人数。','notice full'))
    if(this.rosterSource==='bundled'&&!this.simulation)app.append(this.h('div',`正在使用插件附带的${this.rosterClassName || '班级'}默认名单（${this.data.students.length}人）。教务通有正式名单时优先使用正式名单。`,'notice full'))
    const body=this.h('main',null,'full');body.style.cssText='display:flex;flex-direction:column;flex:1;min-height:0;gap:12px';app.append(body)
    if(this.page==='attendance')this.renderAttendance(body)
    else if(this.page==='seating')this.renderSeating(body)
    else if(this.page==='history')this.renderHistory(body)
    else this.renderTest(body)
  },
  orientation(parent){parent.append(this.h('div',ORIENTATION,'orientation'))},
  empty(parent,title,text){const e=this.h('div',null,'empty-state');e.append(this.h('h2',title),this.h('p',text));parent.append(e);return e},
  renderBoard(parent,seats,map,people=[],editable=false){
    const board=this.h('div',null,'board');board.append(this.h('div','讲台 / 摄像头','stage'));parent.append(board)
    const grid=this.h('div',null,'seat-grid');grid.style.gridTemplateColumns=`repeat(${Math.max(1,...seats.map(s=>s.col))},minmax(70px,1fr))`;board.append(grid)
    const names=Object.fromEntries(this.data.students.map(s=>[s.id,s.name]))
    for(const seat of seats){
      const person=people.find(p=>p.seatId===seat.id),student=map[seat.id],state=displayStatus(person)
      const name=person?.name||names[student]||(student?'名单待同步':'空座'),tone=!student&&!person?'empty':!person?'':state==='PRESENT'||state==='OCCUPIED'?'present':state==='ABSENT'||state==='EMPTY'?'absent':state==='LEAVE'?'leave':'unknown'
      const b=this.button('',()=>editable?this.assignDialog(seat):this.clickSeat(seat.id),`seat ${tone} ${this.selected===seat.id?'selected':''}`,this.running)
      b.dataset.seat=seat.id;b.style.gridRow=String(seat.row);b.style.gridColumn=String(seat.col)
      const label=person?(person.confirmed?`已确认${LABEL[person.confirmed]}`:person.manualOnly?'盲区待核实':LABEL[state]):student?(seat.manualOnly?'盲区座位':editable?'可拖动换座':'尚未考勤'):'未分配学生'
      b.append(this.h('span',`第${seat.row}排 ${seat.col}列`,'where'),this.h('span',name,'name'),this.h('span',label,'state'));b.setAttribute('aria-label',`${name}，第${seat.row}排${seat.col}列，${label}`)
      if(editable&&student)b.addEventListener('pointerdown',e=>this.beginDrag(e,student))
      if(!editable&&person)b.addEventListener('contextmenu',e=>{e.preventDefault();this.selected=seat.id;this.detailOpen=true;this.render()})
      grid.append(b)
    }
  },
  renderAttendance(parent){
    const bar=this.h('div',null,'bar');if(!this.record)parent.append(bar)
    bar.append(this.button(this.running?`正在${this.simulation?'演练':'拍照'}采集 ${this.progress}/10`:this.simulation?'开始10秒演练':'立即拍照考勤',()=>this.start(),'primary',this.running||(!this.simulation&&!this.ready)),this.button('自动考勤时间',()=>this.scheduleDialog()))
    const times=this.data.schedule||[];bar.append(this.h('span',times.length?`每日 ${times.join('、')}`:'尚未设置自动时间','muted'))
    this.orientation(parent)
    const seats=this.record?.seats||this.data.seats,map=this.record?.chartSnapshot.assignments||this.chart()?.assignments||{}
    if(!seats.length){const e=this.empty(parent,'先把本班座位排好','名单来自教务通；物理座位与摄像头区域配置完成后即可开始。');e.append(this.button('打开排座',()=>{this.page='seating';this.render()},'primary'));if(!this.ready)e.append(this.h('p','本机服务未接入时，可用离线演练体验完整操作。'));return}
    const split=this.h('div',null,this.detailOpen&&this.selected&&this.record?'split':'');split.style.cssText='display:grid;flex:1;min-height:0';parent.append(split)
    const main=this.h('div');main.style.cssText='display:flex;flex-direction:column;min-width:0;min-height:0';split.append(main);this.renderBoard(main,seats,map,this.record?.people||[])
    if(this.detailOpen&&this.selected&&this.record)this.renderDetail(split)
    const footer=this.h('div',null,'footer');parent.append(footer)
    if(this.record){
      const p=this.record.people,stats=this.h('div',null,'stats')
      for(const [name,count] of [['应到',p.length],['到场',p.filter(x=>x.confirmed==='PRESENT').length],['缺勤',p.filter(x=>x.confirmed==='ABSENT').length],['请假',p.filter(x=>x.confirmed==='LEAVE').length],['待确认',p.filter(x=>!x.confirmed).length]]){const s=this.h('div',null,'stat');s.append(this.h('strong',count),this.h('span',name));stats.append(s)}footer.append(stats)
      const actions=this.h('div',null,'actions');footer.append(actions)
      if(this.record.state==='PENDING'){
        actions.append(this.button('撤销上次确认',()=>this.undoConfirm(),'',!this.record.audit.length),this.button('查看所选座位依据',()=>{this.detailOpen=!this.detailOpen;this.render()},'',!this.selected),this.button('确认其余AI建议',()=>this.dialog('确认AI建议',box=>box.append(this.h('p','此操作接受可判断座位的AI建议。盲区和待核实座位仍需逐个点击确认。')),()=>this.updateRecord(confirmRemaining(this.record,this.now()),'confirmRemaining'),'确认建议')),this.h('div',null,'grow'),this.button('提交考勤',()=>this.submitDialog(),'primary'))
      }else actions.append(this.h('span','本次考勤已提交，历史记录已锁定。','tag'),this.button('导出CSV',()=>this.exportRecord()),this.button('开始下一次考勤',()=>{this.record=null;this.selected=null;this.detailOpen=false;this.render()},'primary'))
      if(this.running)for(const b of actions.querySelectorAll('button'))b.disabled=true
    }else footer.append(this.h('p','拍照后生成待确认结果。点一下座位切换到场/缺勤，核对后再提交。','muted'))
  },
  renderDetail(parent){
    const panel=this.h('aside',null,'panel'),p=this.record.people.find(p=>p.seatId===this.selected);parent.append(panel)
    panel.append(this.button('收起详情',()=>{this.detailOpen=false;this.render()},'link'))
    if(!p){panel.append(this.h('p','空座不计入应到人数。'));return}
    panel.append(this.h('h3',p.name),this.h('p',p.confirmed?`老师确认：${LABEL[p.confirmed]}`:`AI建议：${p.manualOnly?'盲区待核实':LABEL[p.visual]}`),this.h('p',p.reason))
    if(p.crop?.startsWith('data:image/')){const image=this.h('img');image.src=p.crop;image.alt='本座位关联的局部图像';image.className='evidence';panel.append(image)}else panel.append(this.h('p','当前没有可用的局部照片。','muted'))
    if(this.record.state==='PENDING'){
      const choices=this.h('div',null,'actions');for(const status of ['PRESENT','ABSENT','LEAVE'])choices.append(this.button(LABEL[status],()=>this.updateRecord(setStatus(this.record,p.seatId,status,this.now()),'setStatus',{seatId:p.seatId,status})));panel.append(choices)
      let note=p.note||'';panel.append(this.input('备注',note,v=>{note=v}),this.button('保存备注',async()=>{const next=copy(this.record),target=next.people.find(x=>x.seatId===p.seatId);target.note=note;next.audit.push({seatId:p.seatId,studentId:p.studentId,at:this.now(),previous:p.confirmed,status:p.confirmed,note});await this.updateRecord(next,'note',{seatId:p.seatId,note})}))
    }
    const audit=this.record.audit.filter(a=>a.seatId===p.seatId).slice(-5);if(audit.length){panel.append(this.h('h3','修改记录'));for(const a of audit)panel.append(this.h('p',`${a.at.replace('T',' ').slice(0,19)} ${LABEL[a.status]||'未确认'} ${a.note}`,'muted'))}
  },
  async undoConfirm(){
    const undone=new Set(this.record.audit.filter(a=>a.undoIndex!==undefined).map(a=>a.undoIndex))
    let index=this.record.audit.length-1
    while(index>=0&&(this.record.audit[index].undoIndex!==undefined||undone.has(index)||this.record.audit[index].previous===this.record.audit[index].status))index--
    if(index<0)throw new Error('没有可撤销的人工确认。')
    const last=this.record.audit[index],next=copy(this.record),p=next.people.find(p=>p.seatId===last.seatId)
    p.confirmed=last.previous;next.audit.push({...last,previous:last.status,status:last.previous,undoIndex:index,at:this.now(),note:'撤销上次人工确认'});await this.updateRecord(next,'undo')
  },
  submitDialog(){
    const p=this.record.people,unconfirmed=p.filter(x=>!x.confirmed).length
    if(unconfirmed)throw new Error(`还有${unconfirmed}名学生未确认，请先核实黄色座位和盲区。`)
    this.dialog('核对后提交',box=>{box.append(this.h('p',`应到${p.length}人，到场${p.filter(x=>x.confirmed==='PRESENT').length}人，缺勤${p.filter(x=>x.confirmed==='ABSENT').length}人，请假${p.filter(x=>x.confirmed==='LEAVE').length}人。`),this.h('p',`盲区${p.filter(x=>x.manualOnly).length}个，均已经老师人工确认。`));if(this.simulation)box.append(this.h('p','这是合成演练结果，不会写入正式考勤。','notice'))},()=>this.submit(),'确认提交')
  },
  scheduleDialog(){
    let times=[...(this.data.schedule||[])],hour='08',minute='00',days=14
    this.dialog('自动考勤时间',box=>{
      box.append(this.h('p',this.simulation?'演练设置仅在本次演练中有效。':'由本机服务执行，提前30秒提醒；程序关闭或休眠期间无法拍照。'))
      const list=this.h('div',null,'list'),chooser=this.h('div',null,'row');box.append(list,chooser)
      const paint=()=>{list.replaceChildren();for(const t of times){const row=this.h('div',null,'row');row.append(this.h('strong',t),this.button('移除',()=>{times=times.filter(x=>x!==t);paint()},'link'));list.append(row)}};paint()
      const select=(values,fn)=>{const s=this.h('select');for(const v of values){const o=this.h('option',v);o.value=v;s.append(o)}s.addEventListener('change',()=>fn(s.value));return s}
      const hh=select(Array.from({length:24},(_,i)=>String(i).padStart(2,'0')),v=>{hour=v});hh.value=hour;hh.setAttribute('aria-label','小时')
      const mm=select(Array.from({length:60},(_,i)=>String(i).padStart(2,'0')),v=>{minute=v});mm.value=minute;mm.setAttribute('aria-label','分钟')
      chooser.append(hh,this.h('span','时'),mm,this.h('span','分'),this.button('添加时间',()=>{times=[...new Set([...times,`${hour}:${minute}`])].sort();paint()}))
      const reminder=select(['14','7'],v=>{days=Number(v)});reminder.setAttribute('aria-label','换座提醒天数');const row=this.h('label',null,'row');row.append(this.h('span','每隔几天提醒换座'),reminder,this.h('span','天'));box.append(row)
    },async()=>{if(this.simulation){this.data.schedule=times;this.data.reminderDays=days}else{if(!this.ready)throw new Error('本机考勤服务未接入，自动时间尚未保存。');await this.port.request('saveSchedule',{times,reminderDays:days});this.data.schedule=times}this.message='自动时间已保存。'},'保存时间')
  }
})

Object.assign(AttendanceApp.prototype, {
  renderSeating(parent){
    this.ensureDraft()
    if(this.editor){this.renderEditor(parent);return}
    const bar=this.h('div',null,'bar');parent.append(bar)
    bar.append(this.button('一键换位',()=>this.reseat(),'primary'),this.button('撤销',()=>{if(this.undoStack.length){this.redoStack.push(copy(this.draft));this.draft=this.undoStack.pop()}},'',!this.undoStack.length),this.button('重做',()=>{if(this.redoStack.length){this.undoStack.push(copy(this.draft));this.draft=this.redoStack.pop()}},'',!this.redoStack.length),this.button('版本记录',()=>this.versionsDialog()),this.button('配置物理座位',()=>this.layoutDialog()),this.button('名单与导入说明',()=>this.rosterHelpDialog()))
    this.orientation(parent)
    if(!this.draft.seats.length){const e=this.empty(parent,'先配置教室的物理座位','座位位置只需初次标定；以后换座只拖动学生姓名。');e.append(this.button('设置行数和列数',()=>this.layoutDialog(),'primary'));return}
    const split=this.h('div',null,'split');parent.append(split);const main=this.h('div');main.style.cssText='display:flex;flex-direction:column;min-width:0';split.append(main)
    this.renderBoard(main,this.draft.seats,this.draft.assignments,[],true)
    const panel=this.h('aside',null,'panel');split.append(panel)
    const assigned=new Set(Object.values(this.draft.assignments)),unassigned=this.data.students.filter(s=>!assigned.has(s.id));panel.append(this.h('h3',`未分配学生 ${unassigned.length}人`),this.h('p','拖动姓名到座位。两个已排座学生可以直接交换。','muted'))
    const list=this.h('div',null,'people');panel.append(list)
    for(const s of unassigned){const b=this.button(s.name,()=>this.pickSeatDialog(s),'person');b.addEventListener('pointerdown',e=>this.beginDrag(e,s.id));list.append(b)}
    if(!this.data.students.length)panel.append(this.h('p','宿主没有返回学生名单，请在教务通中维护本班名单。'))
    panel.append(this.h('hr'),this.input('新版本名称',this.draft.title,v=>{this.draft.title=v}),this.input('生效日期',this.draft.effectiveDate,v=>{this.draft.effectiveDate=v},'date'),this.button('保存新版本',()=>this.saveChart(),'primary',!this.simulation&&!this.ready),this.h('p','当前是排座草稿，保存后才正式生效。','muted'))
    panel.append(this.button('清空排座',()=>this.dialog('清空当前草稿',box=>box.append(this.h('p','所有学生将回到未分配列表。已保存版本和历史考勤保留。')),()=>this.changeDraft({...this.draft,assignments:{}}),'清空草稿'),'danger'))
  },
  rosterHelpDialog(){
    this.dialog('学生名单怎么准备',box=>{
      box.append(this.h('p','不需要每位老师重新制表。教务通中已有本班名单时，插件自动读取；同班老师使用本班名单，换座只调整座位表。'))
      box.append(this.h('p','首次准备名单，请由班级负责人在教务通的本班名单中导入或维护。已有Excel可继续用，只需学号和姓名两列。'))
      const table=this.h('table');table.style.cssText='width:100%;border-collapse:collapse;margin:12px 0'
      const head=this.h('tr');for(const title of ['学号','姓名']){const cell=this.h('th',title);cell.style.cssText='text-align:left;padding:8px;border-bottom:1px solid var(--color-line)';head.append(cell)}table.append(head)
      for(const row of [['1','示例学生甲'],['2','示例学生乙']]){const tr=this.h('tr');for(const value of row){const cell=this.h('td',value);cell.style.padding='8px';tr.append(cell)}table.append(tr)}
      box.append(table,this.h('p','以上仅为格式示例。学号不必连续，空号不用补人；重名学生请使用不同学号。','muted'))
      box.append(this.h('p',this.simulation?'当前是离线演练，显示虚拟学生。':this.data.students.length?`当前已读取${this.data.students.length}名学生，排座时从未分配名单拖入座位。`:'当前尚未收到学生名单，请先在教务通核对当前班级及名单。'))
      box.append(this.h('p','本插件的名单入口来自教务通；独立测试程序的“导入学生名单”另提供模板、选列和导入前预览。','muted'))
    })
  },
  layoutDialog(){
    let rows=5,cols=8
    this.dialog('配置物理座位',box=>{box.append(this.h('p','只在首次配置时设置。重新生成座位会清除草稿中的区域标注和排座。'));box.append(this.input('排数',rows,v=>{rows=Number(v)},'number'),this.input('每排座位数',cols,v=>{cols=Number(v)},'number'))},()=>{
      if(![rows,cols].every(x=>Number.isInteger(x)&&x>0&&x<=20)||rows*cols>100)throw new Error('请设置1至20排/列，座位总数不超过100。')
      this.ensureDraft();this.changeDraft({...this.draft,assignments:{},seats:Array.from({length:rows*cols},(_,i)=>({id:`R${Math.floor(i/cols)+1}C${i%cols+1}`,row:Math.floor(i/cols)+1,col:i%cols+1,manualOnly:false,body:[],upper:[]}))})
    },'生成草稿')
  },
  assignDialog(seat){
    let student=this.draft.assignments[seat.id]||'',blind=!!seat.manualOnly
    this.dialog(`第${seat.row}排 ${seat.col}列`,box=>{
      const select=this.h('select');select.setAttribute('aria-label','指定学生');const empty=this.h('option','空座');empty.value='';select.append(empty)
      for(const s of this.data.students){const o=this.h('option',s.name);o.value=s.id;select.append(o)}select.value=student;select.addEventListener('change',()=>{student=select.value});box.append(select)
      const label=this.h('label',null,'row'),check=this.h('input');check.type='checkbox';check.checked=blind;check.addEventListener('change',()=>{blind=check.checked});label.append(check,this.h('span','摄像头盲区，始终人工确认'));box.append(label)
      box.append(this.button('标注可见人体区域',()=>{this.modal=false;this.editor={seatId:seat.id,kind:'body',points:copy(seat.body||[])};this.render()}),this.button('标注头部/上半身区域',()=>{this.modal=false;this.editor={seatId:seat.id,kind:'upper',points:copy(seat.upper||[])};this.render()}))
    },()=>{let next=copy(this.draft);if(student)next.assignments=assignStudent(next.assignments,student,seat.id,next.seats,this.data.students);else delete next.assignments[seat.id];next.seats.find(x=>x.id===seat.id).manualOnly=blind;this.changeDraft(next)},'应用到草稿')
  },
  pickSeatDialog(student){
    let id=this.draft.seats[0]?.id
    this.dialog(`为${student.name}安排座位`,box=>{const select=this.h('select');select.setAttribute('aria-label','目标座位');for(const s of this.draft.seats){const o=this.h('option',`第${s.row}排 ${s.col}列`);o.value=s.id;select.append(o)}select.addEventListener('change',()=>{id=select.value});box.append(select)},()=>this.moveStudent(student.id,id),'安排到座位')
  },
  versionsDialog(){
    this.dialog('座位表版本',box=>{for(const c of [...this.data.charts].reverse()){
      const row=this.h('div',null,'record'),text=this.h('div');text.append(this.h('strong',c.title),this.h('p',`${c.effectiveDate}生效${c.id===this.data.currentChartId?'，当前使用':''}`));row.append(text)
      row.append(this.button('复制修改',()=>{this.ensureDraft();this.changeDraft({...this.draft,title:c.title+' 副本',assignments:copy(c.assignments)});this.modal=false;this.page='seating';this.render()}),this.button('设为当前',async()=>{if(this.simulation)this.data.currentChartId=c.id;else{await this.port.request('activateChart',{chartId:c.id});this.acceptBootstrap(await this.port.request('bootstrap'))}this.modal=false;this.draft=null;this.render()},'',!this.simulation&&!this.ready));box.append(row)
    }if(!this.data.charts.length)box.append(this.h('p','还没有已保存的座位表。'))},null)
  },
  beginDrag(event,student){
    if(event.button!==0||this.running)return
    this.drag={student,x:event.clientX,y:event.clientY,moved:false,pointer:event.pointerId}
  },
  dragMove(event){
    const d=this.drag;if(!d)return
    if(!d.moved&&Math.hypot(event.clientX-d.x,event.clientY-d.y)>6){d.moved=true;this.root.setPointerCapture?.(event.pointerId)}
    if(!d.moved)return
    if(!d.ghost){d.ghost=this.h('div',this.data.students.find(s=>s.id===d.student)?.name||'学生','drag-ghost');this.shadow.append(d.ghost)}d.ghost.style.left=`${event.clientX+12}px`;d.ghost.style.top=`${event.clientY+12}px`
  },
  dragEnd(event){
    const d=this.drag;if(!d)return;this.drag=null;d.ghost?.remove();if(this.root.hasPointerCapture?.(event.pointerId))this.root.releasePointerCapture(event.pointerId)
    if(d.moved){const target=this.shadow.elementFromPoint(event.clientX,event.clientY)?.closest('[data-seat]');this.suppressClick=true;const timer=setTimeout(()=>{this.suppressClick=false;this.timers.delete(timer)},100);this.timers.add(timer);if(target)void this.perform(()=>this.moveStudent(d.student,target.dataset.seat))}
  },
  renderHistory(parent){
    parent.append(this.h('p',this.simulation?'演练记录只在本次演练内保留。':'历史记录绑定当时的座位表；今天换座不会改动过去记录。','muted'))
    if(!this.data.records.length){this.empty(parent,'还没有考勤记录',this.ready?'完成第一次考勤后会显示在这里。':'本机考勤服务接入后才能保存和恢复正式考勤。');return}
    const list=this.h('div',null,'list');parent.append(list)
    for(const r of this.data.records){const row=this.h('div',null,'record'),desc=this.h('div');desc.append(this.h('strong',r.state==='PENDING'?'待核对':'已提交'),this.h('p',`${r.at.replace('T',' ').slice(0,19)}　${r.chartTitle}`));row.append(desc,this.button(r.state==='PENDING'?'恢复核对':'查看座位表',()=>{this.record=copy(r);this.selected=null;this.page='attendance';this.render()}));list.append(row)}
  },
  async exportRecord(){
    if(!this.ctx.files)throw new Error('这台设备暂不支持文件导出，请在教室端主窗口操作。')
    const ok=await this.ctx.files.save(`${this.simulation?'演练-':''}考勤.csv`,new Blob([csvRecord(this.record)],{type:'text/csv;charset=utf-8'}))
    if(!ok)throw new Error('这台设备未能保存文件，请在支持文件导出的教室端主窗口重试。')
    this.message='考勤CSV已保存。'
  },
  renderTest(parent){
    const panel=this.h('section',null,'panel');parent.append(panel);panel.append(this.h('h3','现场设备检查'),this.h('p',`摄像头：${this.data.camera||'未接入'}　　本地模型：${this.data.model||'未接入'}`))
    if(!this.ready&&!this.simulation)panel.append(this.h('p','当前宿主没有摄像头和离线推理接口。现场测试不能执行，可用演练检查排座与确认流程。','notice'))
    const actions=this.h('div',null,'actions');panel.append(actions)
    for(const [text,op] of [['测试摄像头','testCamera'],['测试本地模型','testModel'],['整图检测','detectFull'],['分区域检测','detectTiled']])actions.append(this.button(text,async()=>{
      const result=await this.port.request(op,{},60000);this.testResult=result;if(result.image?.startsWith('data:image/'))this.reference=result;this.message='现场测试完成，请核对照片和性能数据。'
    },'',!this.ready||this.simulation))
    if(this.testResult){panel.append(this.h('p',this.testResult.summary||'设备已响应。'));if(this.testResult.image?.startsWith('data:image/')){const image=this.h('img');image.src=this.testResult.image;image.alt='现场测试照片';image.style.cssText='max-width:100%;max-height:440px;object-fit:contain';panel.append(image)}}
    const demo=this.h('section',null,'panel');parent.append(demo);demo.append(this.h('h3','离线演练'),this.h('p','使用40名虚拟学生，演练10秒采集、座位核对、换座和提交。所有判断均为合成数据。'))
    if(!this.simulation)demo.append(this.button('进入40人演练',()=>this.enterDemo(),'primary'))
    else{const select=this.h('select');select.setAttribute('aria-label','演练场景');for(const [id,text] of [['normal','正常到场'],['absence','有人缺勤'],['moving','人员走动，部分待核实'],['failure','AI识别失败，全员待核实']]){const o=this.h('option',text);o.value=id;select.append(o)}select.value=this.scenario;select.addEventListener('change',()=>{this.scenario=select.value});demo.append(select,this.button('开始10秒演练',()=>{this.page='attendance';return this.start()},'primary',this.running))}
  },
  renderEditor(parent){
    const e=this.editor,seat=this.draft.seats.find(s=>s.id===e.seatId);parent.append(this.h('h2',`第${seat.row}排${seat.col}列：${e.kind==='upper'?'头部 / 上半身':'可见人体'}区域`));this.orientation(parent)
    parent.append(this.h('p','点击照片添加顶点；拖动顶点调整，拖动区域整体移动。标注基于原照片坐标。','muted'))
    if(!this.reference&&!this.simulation){parent.append(this.h('p','请先在现场测试中拍摄参考照片，再回来标注。','notice'),this.button('去现场测试',()=>{this.editor=null;this.page='test';this.render()}));return}
    const stage=this.h('div',null,'photo-stage');stage.style.aspectRatio=this.reference?`${this.reference.width||16}/${this.reference.height||9}`:'16/9';parent.append(stage)
    if(this.reference){const image=this.h('img');image.src=this.reference.image;image.alt='原始参考照片';image.draggable=false;stage.append(image)}else{const text=this.h('div','合成标注练习画布，无真实教室照片','empty-state');stage.append(text)}
    const ns='http://www.w3.org/2000/svg',svg=this.doc.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');stage.append(svg)
    const paint=()=>{svg.replaceChildren();if(e.points.length){const polygon=this.doc.createElementNS(ns,'polygon');polygon.setAttribute('points',e.points.map(p=>p.map(x=>x*1000).join(',')).join(' '));polygon.style.cssText='fill:var(--color-accentsoft);stroke:var(--color-accenttext);stroke-width:3';polygon.dataset.area='1';svg.append(polygon)}e.points.forEach((p,i)=>{const dot=this.doc.createElementNS(ns,'circle');dot.setAttribute('cx',p[0]*1000);dot.setAttribute('cy',p[1]*1000);dot.setAttribute('r','10');dot.style.cssText='fill:var(--color-accenttext);stroke:var(--color-surface);stroke-width:3';dot.dataset.vertex=String(i);svg.append(dot)})}
    const point=event=>{const r=stage.getBoundingClientRect();return[Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]}
    let drag=null;stage.addEventListener('pointerdown',event=>{const p=point(event);if(event.target.dataset.vertex!==undefined)drag={index:Number(event.target.dataset.vertex),start:p,before:copy(e.points)};else if(event.target.dataset.area)drag={index:-1,start:p,before:copy(e.points)};else{e.points.push(p);paint()}stage.setPointerCapture(event.pointerId)})
    stage.addEventListener('pointermove',event=>{if(!drag)return;const p=point(event);if(drag.index>=0)e.points[drag.index]=p;else{let dx=p[0]-drag.start[0],dy=p[1]-drag.start[1];dx=Math.max(-Math.min(...drag.before.map(p=>p[0])),Math.min(1-Math.max(...drag.before.map(p=>p[0])),dx));dy=Math.max(-Math.min(...drag.before.map(p=>p[1])),Math.min(1-Math.max(...drag.before.map(p=>p[1])),dy));e.points=drag.before.map(p=>[p[0]+dx,p[1]+dy])}paint()});stage.addEventListener('pointerup',()=>{drag=null});stage.addEventListener('pointercancel',()=>{drag=null});paint()
    const actions=this.h('div',null,'actions');parent.append(actions);actions.append(this.button('撤销顶点',()=>{e.points.pop();paint()}),this.button('清空区域',()=>{e.points=[];paint()}),this.button('取消标注',()=>{this.editor=null;this.render()}),this.button('应用到排座草稿',()=>{const next=copy(this.draft);next.seats.find(s=>s.id===e.seatId)[e.kind]=copy(e.points);validateSeats(next.seats);this.changeDraft(next);this.editor=null;this.render()},'primary'))
  }
})

export default {
  async activate(ctx){
    ctx.ui.setTitle('教室考勤')
    const doc=globalThis.document
    if(!doc?.createElement){const root={textContent:'教室考勤：座位表与人工确认；本机服务未连接时可离线演练。',remove(){}};ctx.ui.container.append(root);ctx.onDispose(()=>root.remove());return}
    const root=doc.createElement('section');ctx.ui.container.append(root);const app=new AttendanceApp(ctx,root,doc)
    const move=e=>app.dragMove(e),up=e=>app.dragEnd(e),cancel=()=>{app.drag?.ghost?.remove();app.drag=null},click=e=>{if(app.suppressClick){e.preventDefault();e.stopImmediatePropagation()}}
    root.addEventListener('pointermove',move);root.addEventListener('pointerup',up);root.addEventListener('pointercancel',cancel);root.addEventListener('click',click,true)
    if(ctx.data)ctx.onDispose(ctx.data.watch('class.roster',()=>void app.loadRoster()))
    if(ctx.clock)ctx.onDispose(ctx.clock.onMinute(()=>app.render()))
    ctx.onDispose(()=>{root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',cancel);root.removeEventListener('click',click,true);app.close()})
    void app.init().catch(error=>{if(!app.dead){app.message='考勤界面初始化失败，请重新打开或检查本机服务。';ctx.log?.('attendance init failed',error);app.render()}})
  },
  async deactivate(){},
}
