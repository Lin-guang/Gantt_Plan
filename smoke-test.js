const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 script'); process.exit(1); }
let src = m[1];
src += '\n;globalThis.__T={parseMermaid,genMermaid,computeSchedule,normalizeTaskConstraints,parseTSV,diffDays,addDays,workDaysInclusive,endDateForWorkDays,durationMarkup,fmt,normDate,parseDur,loadSample,loadTemplate,sampleToNewProject,renderGantt,renderPreview,replaceChartHtml,refresh,buildThemeCSS,parseThemeCSS,parseTodayMarker,normTick,DEFAULT_STYLE,getState:()=>state,setState:s=>{state=s},getProjects:()=>projects,newProject,createProject,delProject,switchProject,setLayout,autoReschedule,smartSortTasks,depsNames,sectionColor,sectionBg,setConfirmStub,askConfirm,resetApp,getResetFlag:()=>_resetReloaded,applyProjectState,isEmptyState,enterEmptyState,getEmptyOpen:()=>!document.getElementById(\'emptyState\').hidden,newTask,hasNote,notesTodoText,notesPlainText,taskRangeShort,fallbackCopy,revealCodeForManualCopy};';

function stub() {
  const el = {
    value: '', checked: false, textContent: '', innerHTML: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    addEventListener() {}, appendChild() {}, remove() {}, select() {}, focus() {},
    closest() { return null }, querySelector() { return null }, querySelectorAll() { return [] },
    setAttribute() {}, getAttribute() { return '100' }, onclick: null, onchange: null
  };
  el.parentNode = { parentNode: { appendChild() {} } };
  return el;
}
const els = {};
const lsRemoved = [];
let lsReloaded = false;
const ctx = {
  console, setTimeout, clearTimeout,
  localStorage: {
    getItem: () => null, setItem: () => {},
    removeItem: k => lsRemoved.push(k)
  },
  location: { reload: () => { lsReloaded = true; } },
  navigator: {},
document: {
      getElementById: id => els[id] || (els[id] = stub()),
      createElement: () => stub(),
      createElementNS: () => stub(),
      documentElement: { dataset: {} },
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { getSelection: () => ({ removeAllRanges() {} }), addEventListener() {}, dispatchEvent() {} }
};
ctx.globalThis = ctx;
vm.createContext(ctx);

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (extra ? '  >> ' + extra : '')); fail++; }
}

try { vm.runInContext(src, ctx, { filename: 'inline.js' }); }
catch (e) { console.error('脚本执行异常: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')); process.exit(1); }

const T = ctx.__T;
const setS = patch => T.setState(Object.assign({}, T.getState(), patch));
const setStyle = patch => { const s = T.getState(); s.style = Object.assign({}, s.style, patch); };
const base = () => { T.loadSample(); return T.getState(); };

console.log('\n[1] 内置示例数据');
const st = base();
ok('任务数 = 15', st.tasks.length === 15, '实际 ' + st.tasks.length);
ok('里程碑数 = 3', st.tasks.filter(t => t.milestone).length === 3);
ok('带依赖任务数 = 14', st.tasks.filter(t => (t.deps || []).length).length === 14,
   '实际 ' + st.tasks.filter(t => (t.deps || []).length).length);

console.log('\n[2] 依赖驱动排期（拓扑）');
const sch = T.computeSchedule();
ok('r2 开始 = r1 结束当天', sch['r2'].start === sch['r1'].end);
const e2 = sch['e2'];
ok('e2 开始 = 双前置中较晚的结束日期', e2.start === [sch['s2'].end, sch['e1'].end].sort().pop());
ok('m3 里程碑工期 1 天', sch['m3'].dur === 1 && sch['m3'].start === sch['m3'].end);
ok('全部任务已排程', Object.keys(sch).length === 15);

console.log('\n[2b] 智能排序（阶段完整 / 依赖优先 / 日期次之 / 稳定兜底）');
const task = (id, section, start, deps=[]) => ({ id, section, start, end:start, deps, name:id, owner:'', progress:0, status:'', milestone:false });
const stateBeforeSmartSort = T.getState();
T.setState({ tasks:[
  task('b2','阶段B','2026-09-10'),
  task('a2','阶段A','2026-09-01',['a1']),
  task('b1','阶段B','2026-09-05'),
  task('a1','阶段A','2026-09-03')
] });
const sortResult = T.smartSortTasks();
const sortedIds = T.getState().tasks.map(t => t.id).join(',');
ok('阶段按最早开始时间排序且保持连续', sortedIds === 'a1,a2,b1,b2', sortedIds);
ok('同阶段内依赖优先于开始时间', sortedIds.indexOf('a1') < sortedIds.indexOf('a2'));
ok('无依赖冲突时按开始时间排序', sortedIds.indexOf('b1') < sortedIds.indexOf('b2'));
ok('首次智能排序报告发生变化', sortResult.changed === true && sortResult.cycleCount === 0);
const stableResult = T.smartSortTasks();
ok('重复排序保持稳定', stableResult.changed === false && T.getState().tasks.map(t => t.id).join(',') === sortedIds);
T.setState({ tasks:[task('c2','循环阶段','2026-09-02',['c1']), task('c1','循环阶段','2026-09-01',['c2'])] });
const cycleResult = T.smartSortTasks();
ok('循环依赖不丢任务并返回提示计数', cycleResult.cycleCount === 2 && T.getState().tasks.length === 2);
T.setState(stateBeforeSmartSort);

console.log('\n[2c] 工期双指标（自然日 / 工作日）');
ok('周四到周一 = 5 自然日 / 3 工作日', T.diffDays('2026-09-03','2026-09-07') + 1 === 5 && T.workDaysInclusive('2026-09-03','2026-09-07') === 3);
ok('单个工作日计 1 工作日', T.workDaysInclusive('2026-09-11','2026-09-11') === 1);
ok('纯周末计 0 工作日', T.workDaysInclusive('2026-09-12','2026-09-13') === 0);
ok('跨整周计 5 工作日', T.workDaysInclusive('2026-09-07','2026-09-13') === 5);
ok('工作日工期可反推结束日期（周四起 3 工作日到周一）', T.endDateForWorkDays('2026-09-03',3) === '2026-09-07');
ok('周末开始时第 1 个工作日落到周一', T.endDateForWorkDays('2026-09-05',1) === '2026-09-07');
const durationHtml = T.durationMarkup({ start:'2026-09-03', end:'2026-09-07', milestone:false });
ok('自然日与工作日均输出同结构输入框', /自然日<\/span><input[^>]*data-f="duration"[^>]*value="5"/.test(durationHtml) && /工作日<\/span><input[^>]*data-f="workDuration"[^>]*value="3"/.test(durationHtml), durationHtml);
const milestoneDuration = T.durationMarkup({ start:'2026-09-03', end:'2026-09-03', milestone:true });
ok('里程碑两项工期均为 0 且全部锁定', /data-f="duration"[^>]*value="0"[^>]*readonly/.test(milestoneDuration) && /data-f="workDuration"[^>]*value="0"[^>]*readonly/.test(milestoneDuration), milestoneDuration);

console.log('\n[2d] 任务备注字段（本地记录，不影响导出）');
const nt0 = T.newTask(0);
ok('新任务默认无 note 字段（用户主动点开才创建）', !('note' in nt0), JSON.stringify(nt0));
ok('旧数据缺 note 字段按空处理', (base().tasks[0].note || '') === '');
ok('hasNote 识别有内容备注', T.hasNote({ note: '会议结论' }) === true);
ok('hasNote 字段存在（含空字符串）即视为有备注', T.hasNote({ note: '' }) === true && T.hasNote({ note: '   ' }) === true);
ok('hasNote 字段不存在视为无备注', T.hasNote({}) === false && T.hasNote({ note: null }) === false && T.hasNote({ note: undefined }) === false);

console.log('\n[3] 生成 Mermaid（含 themeCSS 与图表指令）');
const code = T.genMermaid();
ok('首行为 init themeCSS', /^%%\{init: \{"themeCSS": ".+"\} \}%%$/.test(code.split('\n')[0]), code.split('\n')[0]);
ok('themeCSS 含网格线样式', /\.grid \.tick line\{stroke:#B8B8B8;stroke-width:1\.8px;stroke-dasharray:3 3;\}/.test(code));
ok('themeCSS 含任务描边', /\.task\{stroke-width:1\.5px;\}/.test(code));
ok('themeCSS 含 taskText 偏移', /\.taskText\{transform:translateX\(8px\);\}/.test(code));
ok('含 tickInterval', /\n {4}tickInterval (1day|1week|1month)\n/.test(code), '实际: ' + (code.match(/tickInterval [^\n]*/) || [])[0]);
ok('含 todayMarker', /todayMarker stroke-width:2px,stroke:#FF6B6B,dasharray:4 4/.test(code));
ok('含 excludes weekends', /excludes weekends/.test(code));
ok('含 axisFormat', /axisFormat %m-%d/.test(code));
ok('含 4 个 section', (code.match(/^\s{4}section /gm) || []).length === 4);
ok('默认输出结束日期格式', /:done, r1, \d{4}-\d{2}-\d{2}, \d{4}-\d{2}-\d{2}$/m.test(code), (code.match(/:done, r1,[^\n]*/) || [])[0]);
ok('里程碑用绝对同日 + 0d', /:milestone, done, m1, \d{4}-\d{2}-\d{2}, 0d/.test(code), (code.match(/m1,[^\n]*/) || [])[0]);
setStyle({ dateOut: 'duration' });
const codeDur = T.genMermaid();
ok('duration 模式输出工期', /:done, r1, \d{4}-\d{2}-\d{2}, 5d/.test(codeDur), (codeDur.match(/:done, r1,[^\n]*/) || [])[0]);
ok('duration 模式多依赖用 after', /after s2 e1/.test(codeDur));
const backDur = T.parseMermaid(codeDur);
ok('duration 模式依赖还原 e2', JSON.stringify((backDur.tasks.find(t => t.id === 'e2') || {}).deps) === '["s2","e1"]',
   JSON.stringify((backDur.tasks.find(t => t.id === 'e2') || {}).deps));
setStyle({ dateOut: 'enddate' });

console.log('\n[3b] 样式空值守卫（axisFormat/tickInterval 清空时不导出裸关键字行）');
setStyle({ axisFormat: '', tick: '' });
const codeGuard = T.genMermaid();
ok('空 axisFormat 不输出裸行', !/\n {4}axisFormat\s*\n/.test(codeGuard), '实际: ' + ((codeGuard.match(/ {4}axisFormat[^\n]*/) || ['(无该行)'])[0]));
ok('空 tickInterval 不输出裸行', !/\n {4}tickInterval\s*\n/.test(codeGuard), '实际: ' + ((codeGuard.match(/ {4}tickInterval[^\n]*/) || ['(无该行)'])[0]));
setStyle({ axisFormat: '%m-%d', tick: '1day' });

console.log('\n[4] Mermaid 往返解析');
const back = T.parseMermaid(code);
ok('解析出 15 个任务', back.tasks.length === 15, '实际 ' + back.tasks.length);
ok('标题还原', back.title === '示例项目', back.title);
ok('enddate 模式全量日期还原', back.tasks.every((t, i) => t.start === st.tasks[i].start && t.end === st.tasks[i].end),
   back.tasks.map((t, i) => t.start === st.tasks[i].start ? '' : t.id).filter(Boolean).join(','));
ok('日期一致 r1', back.tasks[0].start === st.tasks[0].start && back.tasks[0].end === st.tasks[0].end,
   back.tasks[0].start + '~' + back.tasks[0].end + ' vs ' + st.tasks[0].start + '~' + st.tasks[0].end);
ok('cfg 还原 axisFormat', back.cfg.axisFormat === '%m-%d', JSON.stringify(back.cfg));
ok('cfg 还原 tickInterval', /1day|1week|1month/.test(back.cfg.tick));
ok('cfg 还原 todayMarker', back.cfg.todayColor === '#FF6B6B' && back.cfg.todayWidth === 2 && back.cfg.todayDash === '4 4',
   JSON.stringify(back.cfg));
ok('cfg 还原 themeCSS', back.cfg.gridStyle === 'dash' && back.cfg.gridColor === '#B8B8B8' && back.cfg.taskStroke === 1.5,
   JSON.stringify(back.cfg));
ok('cfg 还原 taskText 偏移', back.cfg.taskText === 'both' && back.cfg.taskTextOffset === 8);
ok('cfg 还原 exWeekend', back.cfg.exWeekend === true);
ok('cfg 推断 dateOut 为 enddate', back.cfg.dateOut === 'enddate', back.cfg.dateOut);

console.log('\n[5] 手工代码解析');
const manual = `gantt
    title 示例排期
    dateFormat YYYY-MM-DD
    axisFormat %m-%d
    section 结构
    3D设计 :done, a1, 2026-09-01, 10d
    评审 :a2, after a1, 3d
    section 模具
    开模 :crit, b1, 2026-09-14, 25d
    T1 :milestone, m1, after b1, 0d`;
const pm = T.parseMermaid(manual);
ok('解析 4 个任务', pm.tasks.length === 4, '实际 ' + pm.tasks.length);
ok('a1 工期 10 天', T.diffDays(pm.tasks[0].start, pm.tasks[0].end) + 1 === 10);
ok('a2 依赖 a1', JSON.stringify(pm.tasks[1].deps) === '["a1"]');
ok('m1 里程碑 start=end', pm.tasks[3].start === pm.tasks[3].end && pm.tasks[3].milestone);
ok('b1 状态 crit', pm.tasks[2].status === 'crit');
ok('工期单位解析', T.parseDur('2w') === 14 && T.parseDur('5d') === 5 && T.parseDur('48h') === 2);
ok('日期归一 2026-9-1', T.normDate('2026-9-1') === '2026-09-01');
ok('无效日历日期不会被自动滚动成下个月', T.normDate('2026-02-30') === null && T.normDate('2026-13-01') === null);
ok('tick 归一', T.normTick('1day') === '1day' && T.normTick('2weeks') === '1week' && T.normTick('1month') === '1month');
const invalidMermaidDate = T.parseMermaid('gantt\n    title X\n    section S\n    错误日期 :t1, 2026-02-30, 3d');
ok('Mermaid 无效日期返回明确错误', invalidMermaidDate.errors && invalidMermaidDate.errors.length === 1 && invalidMermaidDate.errors[0].includes('2026-02-30'), JSON.stringify(invalidMermaidDate.errors));

console.log('\n[6] TSV 表格导入');
const tsv = '需求\t需求确认\t产品\t2026-09-01\t2026-09-05\t100\tdone\n结构\t3D设计\t结构\t2026-09-06\t2026-09-17\t30\tactive';
const pt = T.parseTSV(tsv);
ok('解析 2 行', pt.tasks.length === 2);
ok('列映射正确', pt.tasks[0].name === '需求确认' && pt.tasks[0].owner === '产品');
ok('进度与状态', pt.tasks[0].progress === 100 && pt.tasks[0].status === 'done');
const withHeader = T.parseTSV('阶段\t任务名称\t负责人\t开始日期\t结束日期\t进度\t状态\n结构\t需求确认\t产品\t2026-09-01\t2026-09-05\t20\tactive');
ok('Excel 表头行自动跳过，不误导入为任务', withHeader.tasks.length === 1 && withHeader.tasks[0].name === '需求确认', JSON.stringify(withHeader.tasks));
const withGroupHeader = T.parseTSV('阶段\t计划分组\t任务名称\t负责人\t开始日期\t结束日期\t进度\t状态\n结构\t模块B\t需求确认\t产品\t2026-09-01\t2026-09-05\t20\tactive');
ok('含计划分组的 8 列表格正确导入', withGroupHeader.tasks.length === 1 && withGroupHeader.tasks[0].group === '模块B' && withGroupHeader.tasks[0].name === '需求确认', JSON.stringify(withGroupHeader.tasks));
const invalidTsv = T.parseTSV('结构\t错误日期\t产品\t2026-02-30\t2026-03-05\t0\t');
ok('表格无效日期返回行号错误', invalidTsv.errors && invalidTsv.errors.length === 1 && invalidTsv.errors[0].includes('第 1 行'), JSON.stringify(invalidTsv.errors));
const reversedTsv = T.parseTSV('结构\t日期倒置\t产品\t2026-03-05\t2026-03-01\t0\t');
ok('表格结束日期早于开始日期时拒绝导入', reversedTsv.errors && reversedTsv.errors.length === 1 && reversedTsv.tasks.length === 0, JSON.stringify(reversedTsv));

console.log('\n[7] SVG 渲染');
const st7 = base();
setStyle({ taskText: 'both' });
T.renderGantt();
const svg = els['chart'] ? els['chart'].innerHTML : '';
ok('输出 SVG', svg.indexOf('<svg') === 0 && svg.indexOf('</svg>') > 0);
ok('无 NaN 坐标', svg.indexOf('NaN') === -1);
ok('无 undefined', svg.indexOf('undefined') === -1);
ok('含网格虚线', svg.includes('stroke-dasharray="3 3"'));
ok('网格线用配置颜色', svg.includes('stroke="#B8B8B8"'));
ok('任务条有描边', /stroke-width="1.5"/.test(svg));
ok('含依赖箭头', svg.includes('url(#ar)'));
ok('含今日线且用配置色', svg.includes('#FF6B6B'));
ok('含全部任务名', st7.tasks.every(t => svg.includes(t.name)));

console.log('\n[8] 排除周末（Mermaid excludes 行为）');
setStyle({ exWeekend: true, tick: '1day' });
T.renderGantt();
const svgEx = els['chart'].innerHTML;
ok('排除周末后仍无 NaN', svgEx.indexOf('NaN') === -1);
ok('排除周末后宽度更小', +svgEx.match(/width="(\d+)"/)[1] > 0);
setStyle({ exWeekend: false });
T.renderGantt();
const svgNoEx = els['chart'].innerHTML;
ok('不排除周末时图更宽', +svgNoEx.match(/width="(\d+)"/)[1] > +svgEx.match(/width="(\d+)"/)[1],
   svgNoEx.match(/width="(\d+)"/)[1] + ' vs ' + svgEx.match(/width="(\d+)"/)[1]);

console.log('\n[9] 时间轴与刻度配置');
['1day', '1week', '1month'].forEach(tk => {
  setStyle({ tick: tk });
  ['day', 'week', 'month', 'auto'].forEach(v => {
    setS({ view: v });
    try { T.renderGantt(); const s = els['chart'].innerHTML;
      ok(tk + ' / ' + v + ' 渲染正常', s.indexOf('<svg') === 0 && s.indexOf('NaN') === -1);
    } catch (e) { ok(tk + ' / ' + v + ' 渲染', false, e.message); }
  });
});
setS({ view: 'auto' }); setStyle({ tick: '1day' });

console.log('\n[9b] 缩放（自绘引擎）');
base();
setS({ zoom: 1 });
T.renderGantt();
const zw1 = +els['chart'].innerHTML.match(/width="(\d+)"/)[1];
setS({ zoom: 1.5 });
T.renderGantt();
const zw15 = +els['chart'].innerHTML.match(/width="(\d+)"/)[1];
ok('zoom 150% 图宽显著增加', zw15 > zw1 * 1.38 && zw15 < zw1 * 1.5, zw1 + ' -> ' + zw15);
setS({ zoom: 0.6 });
T.renderGantt();
const zw06 = +els['chart'].innerHTML.match(/width="(\d+)"/)[1];
ok('zoom 60% 图宽缩小', zw06 < zw1 * 0.8 && zw06 > zw1 * 0.5, zw1 + ' -> ' + zw06);
ok('缩小后无 NaN', els['chart'].innerHTML.indexOf('NaN') === -1);
setS({ zoom: 1 });

console.log('\n[10] 任务文字位置三档');
['left', 'bar', 'both'].forEach(pos => {
  setStyle({ taskText: pos });
  try { T.renderGantt(); const s = els['chart'].innerHTML;
    ok('taskText=' + pos + ' 渲染正常', s.indexOf('<svg') === 0 && s.indexOf('NaN') === -1);
    if (pos === 'left') ok('  left 时左侧列有任务名', s.includes('需求确认'));
  } catch (e) { ok('taskText=' + pos, false, e.message); }
});
setStyle({ taskText: 'both' });

console.log('\n[11] 兼容模式');
setStyle({ compat: true, exWeekend: true });
const cc = T.genMermaid();
ok('不含 after 依赖语法', cc.indexOf('after ') === -1);
ok('不含状态标签', !/:(done|active|crit)/.test(cc));
ok('不含 excludes', cc.indexOf('excludes') === -1);
ok('不含 themeCSS init', cc.indexOf('%%{init') === -1);
ok('保留 milestone 标签', /:milestone, m1, \d{4}-\d{2}-\d{2}, 0d/.test(cc));
const cback = T.parseMermaid(cc);
ok('兼容代码可反向解析', cback.tasks.length === 15, '实际 ' + cback.tasks.length);
setStyle({ compat: false });

console.log('\n[12] 用户真实模板（BOS 钢铁蓝）');
const TEMPLATE = `%%{init: {"themeCSS": ".grid .tick line{stroke:#B8B8B8;stroke-width:1.8px;stroke-dasharray:3 3;}.task{stroke-width:1.5px;}.taskText{transform:translateX(8px);}"} }%%
gantt
    title BOS钢铁蓝 Mini 款定制项目
    dateFormat YYYY-MM-DD
    axisFormat %d
    excludes weekends
    tickInterval 1day
    todayMarker stroke-width:2px,stroke:#FF6B6B,dasharray:4 4

    section 前期准备
    项目启动(8/17)                       :crit, milestone, start, 2026-08-17, 0d
    模块A准备完成(8/17)                    :done, milestone, eBom, 2026-08-17, 1d
    模块B准备完毕(8/18-8/19): done,tgBom, 2026-08-18, 2026-08-20
    模块B方案确认(8/20-8/25):done, lxBom, 2026-08-20, 2026-08-26
    交付清单完成(8/21)               :done, milestone, PBom, 2026-08-21, 0d
    交付方案确认(8/21-8/27):done, lxPBom, 2026-08-21, 2026-08-28

    section 样机线
    试运行(8/26-8/29，示例批次)    : done, TrialRun, 2026-08-26, 2026-08-30
    稳定性验证(8/31-9/7，示例批次):Reliability, 2026-08-31, 2026-09-08
    section 包装线
    资源下单(8/31)                        :crit, milestone, PackageMaterialOrder, 2026-08-31, 0d
    资源样品确认(9/4)                    :crit, milestone, PackageSampleApproval, 2026-09-04, 0d


    section 生产模块A
    资源入库及验收(8/31-9/4)               :b1, 2026-08-31, 2026-09-04
    模块A上线(9/7到货，9-8-9/14)                  :b3, 2026-09-08, 2026-09-15

    section 生产模块B
    资源到位(9/8)                 :milestone, BCRK, 2026-09-08, 1d
    资源检查(9/9-9/10)                 :PackageCheck, 2026-09-09, 2026-09-11
    资源运输及上线(9/11-9/12)                 :PackageCheck, 2026-09-11, 2026-09-13
    模块B上线(9/14-9/18):Packaging, 2026-09-14, 2026-09-18

    section 出货
    提前出样品装车(9/15):milestone, Packaging_Trans, 2026-09-15, 1d
    提前出样品交付(2k, 9/17)             :crit, milestone, m4, 2026-09-17, 0d
    最迟入库交付时限(7.2k, 9/28)             :crit, milestone, m3, 2026-09-28, 0d`;

const tp = T.parseMermaid(TEMPLATE);
ok('解析出 19 个任务', tp.tasks.length === 19, '实际 ' + tp.tasks.length);
ok('标题正确', tp.title === 'BOS钢铁蓝 Mini 款定制项目', tp.title);
ok('识别 6 个 section', new Set(tp.tasks.map(t => t.section)).size === 6,
   [...new Set(tp.tasks.map(t => t.section))].join('/'));
ok('themeCSS 网格线解析', tp.cfg.gridStyle === 'dash' && tp.cfg.gridColor === '#B8B8B8' && tp.cfg.gridWidth === 1.8,
   JSON.stringify(tp.cfg));
ok('themeCSS 虚线值解析 3 3', tp.cfg.gridDash === '3 3', tp.cfg.gridDash);
ok('themeCSS task 描边解析', tp.cfg.taskStroke === 1.5);
ok('themeCSS taskText 解析', tp.cfg.taskText === 'both' && tp.cfg.taskTextOffset === 8);
ok('tickInterval 解析', tp.cfg.tick === '1day');
ok('todayMarker 解析', tp.cfg.todayColor === '#FF6B6B' && tp.cfg.todayWidth === 2 && tp.cfg.todayDash === '4 4',
   JSON.stringify(tp.cfg));
ok('axisFormat 解析', tp.cfg.axisFormat === '%d', tp.cfg.axisFormat);
ok('excludes weekends 解析', tp.cfg.exWeekend === true);
ok('dateOut 推断为 enddate', tp.cfg.dateOut === 'enddate');

const tg = tp.tasks.find(t => t.id === 'tgBom');
ok('结束日期 exclusive：tgBom 为 8/18-8/19', tg.start === '2026-08-18' && tg.end === '2026-08-19',
   tg.start + '~' + tg.end);
const lx = tp.tasks.find(t => t.id === 'lxBom');
ok('结束日期 exclusive：lxBom 为 8/20-8/25', lx.start === '2026-08-20' && lx.end === '2026-08-25',
   lx.start + '~' + lx.end);
const tr = tp.tasks.find(t => t.id === 'TrialRun');
ok('结束日期 exclusive：试运行 8/26-8/29', tr.start === '2026-08-26' && tr.end === '2026-08-29',
   tr.start + '~' + tr.end);
const rel = tp.tasks.find(t => t.id === 'Reliability');
ok('跨月结束日期 exclusive：8/31-9/7', rel.start === '2026-08-31' && rel.end === '2026-09-07',
   rel.start + '~' + rel.end);
ok('标签顺序 crit,milestone 可解析', tp.tasks[0].milestone === true && tp.tasks[0].status === 'crit',
   tp.tasks[0].status);
ok('冒号后无空格可解析', !!tp.tasks.find(t => t.id === 'Packaging'));
ok('任务名含逗号不被截断', !!tp.tasks.find(t => t.name.includes('提前出样品交付(2k, 9/17)')),
   (tp.tasks.find(t => t.name.includes('提前出样品')) || {}).name);
ok('无标签任务行可解析', (tp.tasks.find(t => t.id === 'b1') || {}).status === '');
ok('重复 id 自动去重为 PackageCheck_2', tp.tasks.filter(t => t.id === 'PackageCheck').length === 1 && tp.tasks.filter(t => t.id === 'PackageCheck_2').length === 1,
   tp.tasks.filter(t => /PackageCheck/.test(t.id)).map(t => t.id).join(','));
ok('重复 id 有报告', (tp.dups || []).includes('PackageCheck'), JSON.stringify(tp.dups));

console.log('\n[13] 真实模板渲染与回环');
/* 模板是固定历史日期（2026-08/09），而今日线只在"今天落入渲染区间"时才绘制——
   整体平移到以今天为起点，断言才与运行日期无关（曾随日期漂移误报 FAIL） */
const tplTasks = JSON.parse(JSON.stringify(tp.tasks));
const nowD = new Date();
const todayStr = nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0') + '-' + String(nowD.getDate()).padStart(2, '0');
const minStart = tplTasks.reduce((m, t) => t.start < m ? t.start : m, tplTasks[0].start);
const shiftN = T.diffDays(minStart, todayStr);
tplTasks.forEach(t => { t.start = T.addDays(t.start, shiftN); t.end = T.addDays(t.end, shiftN); });
setS({ title: tp.title, tasks: tplTasks, view: 'auto' });
Object.assign(T.getState().style, tp.cfg);
T.renderGantt();
const tsvg = els['chart'].innerHTML;
ok('渲染无 NaN', tsvg.indexOf('NaN') === -1);
ok('渲染无 undefined', tsvg.indexOf('undefined') === -1);
ok('用模板的网格色', tsvg.includes('stroke="#B8B8B8"'));
ok('用模板的虚线', tsvg.includes('stroke-dasharray="3 3"'));
ok('用模板的今日线色', tsvg.includes('#FF6B6B'));
ok('含全部 19 个任务名', tp.tasks.every(t => tsvg.includes(t.name)),
   tp.tasks.filter(t => !tsvg.includes(t.name)).map(t => t.name).join('|'));
ok('含 6 个 section 名', ['前期准备', '样机线', '包装线', '生产模块A', '生产模块B', '出货'].every(s => tsvg.includes(s)));
const regen = T.genMermaid();
const reread = T.parseMermaid(regen);
ok('再解析任务数一致', reread.tasks.length === 19, '实际 ' + reread.tasks.length);
ok('再解析日期一致', reread.tasks.every((t, i) => t.start === tplTasks[i].start && t.end === tplTasks[i].end),
   reread.tasks.map((t, i) => t.start === tplTasks[i].start ? '' : t.id).filter(Boolean).join(','));
ok('再解析 id 一致', reread.tasks.map(t => t.id).join(',') === tp.tasks.map(t => t.id).join(','));

console.log('\n[14] 边界情况');
setS({ title: 'T', tasks: [], view: 'auto' });
try { T.renderGantt(); ok('空任务不崩溃', true); } catch (e) { ok('空任务不崩溃', false, e.message); }
const cyc = [{ id: 'a', name: 'A', section: 'S', owner: '', start: '2026-09-01', end: '2026-09-05', progress: 0, status: '', milestone: false, deps: ['b'] },
             { id: 'b', name: 'B', section: 'S', owner: '', start: '2026-09-01', end: '2026-09-05', progress: 0, status: '', milestone: false, deps: ['a'] }];
setS({ title: 'C', tasks: cyc });
try { const s = T.computeSchedule(); ok('循环依赖不死循环', !!s['a'] && !!s['b']); } catch (e) { ok('循环依赖不死循环', false, e.message); }
ok('脏代码不抛异常', Array.isArray(T.parseMermaid('gantt\n    title X\n    孤立行没有冒号\n    :bad, 2026-09-01, 3d').tasks));
setStyle({ gridStyle: 'none', taskStroke: 0 });
try { T.renderGantt(); ok('关闭网格与描边仍可渲染', true); } catch (e) { ok('关闭网格与描边', false, e.message); }

(async () => {
  console.log('\n[17] 里程碑切换不破坏日期');
  base();
  const t0 = T.getState().tasks[1];
  const d0 = [t0.start, t0.end];
  t0.milestone = true;
  T.normalizeTaskConstraints(T.getState().tasks);
  T.refresh();
  ok('勾选里程碑后开始结束强制同日', t0.start === t0.end, t0.start + '~' + t0.end);
  const msCode = T.genMermaid();
  ok('里程碑在代码中输出绝对同日 0d', /:milestone, done, r2, \d{4}-\d{2}-\d{2}, 0d/.test(msCode), (msCode.match(/r2,[^\n]*/) || [])[0]);
  t0.milestone = false;
  T.refresh();
  ok('取消里程碑保留当前单日日期', t0.start === t0.end, t0.start + '~' + t0.end);
  ok('取消后恢复工期输出', !/:milestone, done, r2/.test(T.genMermaid()));

  console.log('\n[18] 多项目管理（弹窗流程）');
  const P0 = T.getProjects();
  ok('初始项目存在', Object.keys(P0.items).length >= 1 && !!P0.items[P0.current]);
  const cur0 = P0.current, taskCount = T.getState().tasks.length, origTitle = T.getState().title;
  T.createProject('测试项目B');
  ok('新建后切换到新项目', T.getProjects().current !== cur0);
  ok('新项目任务为空', T.getState().tasks.length === 0, '实际 ' + T.getState().tasks.length);
  ok('新项目标题正确', T.getState().title === '测试项目B', T.getState().title);
  T.setState(Object.assign({}, T.getState(), { tasks: [{ id: 'x1', name: 'X', section: 'S', owner: '', start: '2026-09-01', end: '2026-09-03', progress: 0, status: '', milestone: false, deps: [] }] }));
  T.refresh();
  /* 拒绝删除：回调应收到 false 且项目不变 */
  T.setConfirmStub(false);
  T.delProject();
  ok('确认弹窗取消时不删除', T.getProjects().current !== cur0);
  T.setConfirmStub(true);
  T.delProject();
  ok('删除后回到原项目', T.getProjects().current === cur0);
  ok('原项目任务恢复', T.getState().tasks.length === taskCount, '实际 ' + T.getState().tasks.length);
  ok('原项目标题恢复', T.getState().title === origTitle, T.getState().title);
  const againCode = T.genMermaid();
  ok('切回后生成代码正常', /gantt/.test(againCode) && T.getState().tasks.length > 0);
  /* 新建项目 + 复制当前任务 */
  T.createProject('副本项目', true);
  const copyId = T.getProjects().current;
  ok('复制项目任务数一致', T.getState().tasks.length === taskCount, '实际 ' + T.getState().tasks.length);
  ok('复制项目标题正确', T.getState().title === '副本项目', T.getState().title);
  ok('复制任务是独立对象', T.getState().tasks[0] !== P0.items[cur0].data.tasks[0]);
  /* 空名称兜底 */
  T.createProject('   ');
  ok('空名称兜底为未命名项目', T.getState().title === '未命名项目', T.getState().title);
  T.setConfirmStub(true);
  T.delProject();               /* 删掉"未命名项目" */
  T.switchProject(copyId);      /* 切到副本项目 */
  T.delProject();               /* 删掉副本项目，回到原项目 */
  ok('清理后回到原项目', T.getProjects().current === cur0, T.getProjects().current);
  ok('清理后仅剩原项目', Object.keys(T.getProjects().items).length === Object.keys(P0.items).length,
     '实际 ' + Object.keys(T.getProjects().items).join(','));
  T.setConfirmStub(null);

  console.log('\n[19] v2 单项目数据迁移');
  const elsM = {};
  const ctxM = {
    console, setTimeout, clearTimeout,
    localStorage: {
      getItem: () => JSON.stringify({ title: '旧项目', tasks: [{ id: 'a1', name: '旧任务', section: 'S', owner: '', start: '2026-09-01', end: '2026-09-05', progress: 0, status: '', milestone: false, deps: [] }], style: { gridColor: '#123456' } }),
      setItem() {}
    },
    navigator: {},
    document: { getElementById: id => elsM[id] || (elsM[id] = stub()), createElement: () => stub(), documentElement: { dataset: {} }, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    window: { getSelection: () => ({ removeAllRanges() {} }), addEventListener() {}, dispatchEvent() {} }
  };
  ctxM.globalThis = ctxM;
  vm.createContext(ctxM);
  try { vm.runInContext(src, ctxM, { filename: 'inlineM.js' }); }
  catch (e) { console.error('v2 迁移错误: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')); ok('v2 迁移执行', false, e.message); }
  if(!ctxM.__T){ console.log('ctxM.__T 为空，ctxM keys: ' + Object.keys(ctxM).join(',')); }
  const PM = ctxM.__T.getProjects();
  ok('v2 数据迁移为单项目', Object.keys(PM.items).length === 1 && !!PM.items[PM.current]);
  ok('迁移保留任务与标题', ctxM.__T.getState().title === '旧项目' && ctxM.__T.getState().tasks.length === 1);
  ok('迁移保留样式', ctxM.__T.getState().style.gridColor === '#123456');

  console.log('\n[21] 前置点选 + 自动重排（勾选前置后开始时间对齐前置结束）');
  base();
  const s21 = T.getState();
  // 场景：任务 A（9/1-9/5），任务 B 原本排在 9/2-9/4（工期 3 天），勾选 A 为 B 的前置
  const A = s21.tasks[0], B = s21.tasks[1];
  const bDur = T.diffDays(B.start, B.end) + 1;
  B.deps = [A.id];
  T.autoReschedule();
  ok('勾选前置后开始 = 前置结束当天', B.start === A.end, A.end + ' → ' + B.start);
  ok('工期保持不变', T.diffDays(B.start, B.end) + 1 === bDur, '工期 ' + bDur + ' 天');
  // 取消前置：日期不再受约束（autoReschedule 后回到手填值——无 deps 时保留原值）
  B.deps = [];
  const bStartFixed = B.start, bDurFixed = T.diffDays(B.start, B.end) + 1;
  T.autoReschedule();
  ok('取消前置后日期不变', B.start === bStartFixed && T.diffDays(B.start, B.end) + 1 === bDurFixed);
  // depsNames 显示任务名而非 ID
  B.deps = [A.id];
  ok('depsNames 显示任务名', T.depsNames(B) === A.name, T.depsNames(B));
  base();

  console.log('\n[21b] 每个前置独立设置间隔自然日');
  const lagTasks = [
    { id:'la', name:'前置 A', section:'S', owner:'', start:'2026-11-01', end:'2026-11-04', progress:0, status:'', milestone:false, deps:[], depLags:{} },
    { id:'lb', name:'前置 B', section:'S', owner:'', start:'2026-11-01', end:'2026-11-06', progress:0, status:'', milestone:false, deps:[], depLags:{} },
    { id:'lc', name:'当前任务', section:'S', owner:'', start:'2026-11-04', end:'2026-11-08', progress:0, status:'', milestone:false, deps:['la'], depLags:{ la:3 } }
  ];
  T.setState(Object.assign({}, T.getState(), { tasks:lagTasks }));
  T.normalizeTaskConstraints(lagTasks);
  ok('单前置 +3 天：11/4 结束后从 11/7 开始', lagTasks[2].start === '2026-11-07', lagTasks[2].start);
  ok('前置列显示对应间隔', T.depsNames(lagTasks[2]) === '前置 A（3天后）', T.depsNames(lagTasks[2]));
  lagTasks[2].deps = ['la','lb'];
  lagTasks[2].depLags = { la:5, lb:1 };
  T.normalizeTaskConstraints(lagTasks);
  ok('多前置独立计算后取最晚日期', lagTasks[2].start === '2026-11-09', lagTasks[2].start);
  ok('多前置分别显示各自间隔', T.depsNames(lagTasks[2]) === '前置 A（5天后）、前置 B（1天后）', T.depsNames(lagTasks[2]));
  T.getState().style.dateOut = 'duration';
  const lagLine = T.genMermaid().split('\n').find(line => line.includes(':lc,'));
  ok('Mermaid 不支持独立间隔时改用绝对日期保持结果', lagLine && lagLine.includes('2026-11-09') && !lagLine.includes('after '), lagLine);
  base();

  console.log('\n[21c] 甘特图重绘保持预览滚动位置');
  const oldChart = els.chart;
  const scrollBox = { scrollTop:146, scrollLeft:88 };
  const jumpChart = stub();
  jumpChart.parentNode = scrollBox;
  let chartMarkup = '';
  Object.defineProperty(jumpChart, 'innerHTML', {
    configurable:true,
    get:() => chartMarkup,
    set:value => { chartMarkup = value; scrollBox.scrollTop = 0; scrollBox.scrollLeft = 0; }
  });
  els.chart = jumpChart;
  T.replaceChartHtml('<svg id="scroll-test"></svg>');
  ok('替换预览 SVG 后纵向位置保持', scrollBox.scrollTop === 146, String(scrollBox.scrollTop));
  ok('替换预览 SVG 后横向位置保持', scrollBox.scrollLeft === 88, String(scrollBox.scrollLeft));
  els.chart = oldChart;

  console.log('\n[21d] HTTP 页面复制代码兼容与真实失败提示');
  const oldCreateElement = ctx.document.createElement;
  const oldBody = ctx.document.body;
  const oldExecCommand = ctx.document.execCommand;
  let appendedCopyEl = null, removedCopyEl = null;
  ctx.document.createElement = tag => {
    const el = stub();
    el.tagName = String(tag).toUpperCase();
    el.setSelectionRange = () => {};
    return el;
  };
  ctx.document.body = {
    appendChild:el => { appendedCopyEl = el; },
    removeChild:el => { removedCopyEl = el; }
  };
  ctx.document.execCommand = cmd => cmd === 'copy';
  T.fallbackCopy('gantt\n    title 复制测试');
  ok('无 Clipboard API 时使用临时文本框复制', appendedCopyEl && appendedCopyEl.value.includes('复制测试'));
  ok('备用复制成功后移除临时文本框', removedCopyEl === appendedCopyEl);
  ok('备用复制成功后给出真实成功提示', els.toast.textContent.includes('已复制'), els.toast.textContent);
  let manualSelected = false;
  els.code.select = () => { manualSelected = true; };
  els.code.setSelectionRange = () => { manualSelected = true; };
  ctx.document.execCommand = () => false;
  T.fallbackCopy('gantt\n    title 手动复制测试');
  ok('浏览器彻底禁止复制时展开代码区', els.codePane.style.display === 'flex', els.codePane.style.display);
  ok('禁止自动复制时选中代码供 Ctrl+C', manualSelected && els.code.value.includes('手动复制测试'));
  ok('禁止自动复制时不再误报成功', els.toast.textContent.includes('请按 Ctrl+C'), els.toast.textContent);
  ctx.document.createElement = oldCreateElement;
  ctx.document.body = oldBody;
  ctx.document.execCommand = oldExecCommand;

  console.log('\n[15] Mermaid 官方渲染分支（在线时预览走官方渲染器）');
  const renderCalls = [], els2 = {};
  const svgStub = {
    attrs: {},
    getAttribute(a){ return a === 'viewBox' ? '0 0 700 300' : (this.attrs[a] != null ? String(this.attrs[a]) : null); },
    setAttribute(k, v){ this.attrs[k] = v; },
    style: {}
  };
  const chartStub = stub();
  chartStub.querySelector = sel => sel === 'svg' ? svgStub : null;
  const ctx2 = {
    console, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    mermaid: {
      version: '10.9.1-mock',
      initialize() {},
      render(id, code) {
        renderCalls.push({ id, code });
        return Promise.resolve({ svg: '<svg id="mock-mm" viewBox="0 0 700 300"><rect width="700" height="300" fill="#ffffff"/></svg>' });
      }
    },
    document: {
      getElementById: id => id === 'chart' ? chartStub : (els2[id] || (els2[id] = stub())),
      createElement: () => stub(),
      documentElement: { dataset: {} },
      createElementNS: (ns, tag) => {
        const el = stub();
        const attrs = {};
        el.setAttribute = (k, v) => { attrs[k] = String(v); };
        el.getAttribute = (k) => attrs[k] != null ? attrs[k] : null;
        return el;
      },
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { getSelection: () => ({ removeAllRanges() {} }), addEventListener() {}, dispatchEvent() {} }
  };
  ctx2.globalThis = ctx2;
  vm.createContext(ctx2);
  try { vm.runInContext(src, ctx2, { filename: 'inline2.js' }); }
  catch (e) { ok('mermaid 分支脚本执行', false, e.message); }

  ok('启动即调用 mermaid.render', renderCalls.length > 0, '调用次数 ' + renderCalls.length);
  const lastCall = renderCalls[renderCalls.length - 1] || {};
  ok('渲染代码含 gantt 头', /^%%\{init/.test(lastCall.code || '') && /gantt/.test(lastCall.code || ''));
  ok('渲染代码含 title', /title .+/.test(lastCall.code || ''));
  await new Promise(r => setImmediate(r));
  ok('chart 使用官方渲染结果', chartStub.innerHTML.includes('mock-mm'), (chartStub.innerHTML || '').slice(0, 60));
  ok('渲染模式徽章已设置', !!(els2['renderMode'] && els2['renderMode'].textContent && els2['renderMode'].textContent.length > 0),
     els2['renderMode'] ? els2['renderMode'].textContent : '(none)');

  console.log('\n[15c] Mermaid 异步重绘期间保留旧图，防止滚动区塌陷回顶');
  const baseGetElementById = ctx2.document.getElementById;
  ctx2.document.getElementById = id => {
    if(id === 'ganttRender') return { closest:() => null, remove:() => { chartStub.innerHTML = ''; } };
    return baseGetElementById(id);
  };
  let finishDeferredRender;
  ctx2.mermaid.render = () => new Promise(resolve => { finishDeferredRender = resolve; });
  chartStub.innerHTML = '<svg id="ganttRender">旧图仍显示</svg>';
  ctx2.__T.renderPreview();
  ok('新图生成完成前旧图不被提前删除', chartStub.innerHTML.includes('旧图仍显示'), chartStub.innerHTML);
  finishDeferredRender({ svg:'<svg id="ganttRender_new">新图</svg>' });
  await new Promise(r => setImmediate(r));
  ok('新图完成后一次性替换旧图', chartStub.innerHTML.includes('新图'), chartStub.innerHTML);
  ctx2.document.getElementById = baseGetElementById;
  ctx2.mermaid.render = (id, code) => Promise.resolve({ svg: '<svg id="mock-mm" viewBox="0 0 700 300"><rect width="700" height="300" fill="#ffffff"/></svg>' });

  console.log('\n[20] 默认显示负责人 / 布局切换 / 自适应缩放 / 原样时间轴');
  ok('showOwner 默认开启', T.getState().showOwner === true);
  ok('layout 默认为 both', T.getState().layout === 'both');

  // 给 ctx2.window 加 listener 收集与分发（resize 监听器需要真触发）
  ctx2.window = Object.assign(ctx2.window, {
    addEventListener(t, fn){ (this._listeners = this._listeners || []).push({t, fn}); },
    dispatchEvent(ev){ (this._listeners || []).filter(l => l.t === ev.type).forEach(l => l.fn(ev)); }
  });
  chartStub.parentNode.clientWidth = 800;

  // 准备密集文本节点 mock，网页端不得再擅自隐藏 Mermaid 输出。
  const textStubs = [
    { style:{}, getAttribute(a){return a==='x'?'100':a==='y'?'40':null;} },
    { style:{}, getAttribute(a){return a==='x'?'108':a==='y'?'40':null;} },
    { style:{}, getAttribute(a){return a==='x'?'116':a==='y'?'40':null;} },
    { style:{}, getAttribute(a){return a==='x'?'124':a==='y'?'40':null;} },
    { style:{}, getAttribute(a){return a==='x'?'180':a==='y'?'40':null;} },
    { style:{}, getAttribute(a){return a==='x'?'188':a==='y'?'40':null;} },
    { style:{}, getAttribute(a){return a==='x'?'196':a==='y'?'40':null;} }
  ];
  svgStub.querySelectorAll = sel => sel === 'text' ? textStubs : [];
  ctx2.__T.renderPreview();
  await new Promise(r => setImmediate(r));
  ok('密集时间轴标签保持 Mermaid 原样', textStubs.every(t => t.style.display !== 'none'));

  // 自适应缩放：zoom=1 时固定，zoom=0 时按容器宽计算
  ctx2.__T.setState(Object.assign({}, ctx2.__T.getState(), { zoom: 1 }));
  ctx2.__T.renderPreview();
  await new Promise(r => setImmediate(r));
  const fixedW = +svgStub.attrs.width;
  ok('zoom=1 固定宽 700', fixedW === 700, '实际 ' + fixedW);

  ctx2.__T.setState(Object.assign({}, ctx2.__T.getState(), { zoom: 0 }));
  ctx2.__T.renderPreview();
  await new Promise(r => setImmediate(r));
  const autoW = +svgStub.attrs.width;
  ok('zoom=0 自适应：容器 800 → SVG 宽 ≈800', Math.abs(autoW - 800) < 30, '实测 ' + autoW);

  // resize 事件触发自适应重渲（zoom=0 时重算）
  ctx2.window.dispatchEvent({ type: 'resize' });
  await new Promise(r => setImmediate(r));
  ok('resize 事件触发重渲', +svgStub.attrs.width === autoW);

  // 布局切换
  T.setLayout('chart');
  ok('setLayout 改 state.layout', T.getState().layout === 'chart');
  T.setLayout('both');
  ok('setLayout 还原', T.getState().layout === 'both');

  // 恢复 zoom=1 避免影响 [15b]
  ctx2.__T.setState(Object.assign({}, ctx2.__T.getState(), { zoom: 1 }));

  // 恢复 ctx2.mermaid.render 为 resolve 版本（[16] 之前的需求）
  ctx2.mermaid.render = (id, code) => Promise.resolve({ svg: '<svg id="mock-mm" viewBox="0 0 700 300"><rect width="700" height="300" fill="#ffffff"/></svg>' });
  ctx2.__T.renderPreview();
  await new Promise(r => setImmediate(r));

  console.log('\n[20b] 任务名增强：日期/负责人写入 Mermaid 代码（钉钉渲染可见）');
  base();
  setStyle({ nameDates: true, nameOwner: false });
  const codeND = T.genMermaid();
  /* 示例项目日期相对今天，期望后缀必须从排期结果推导（曾硬编码 9/ 月，随日期漂移误报） */
  const shortMD = d => { const p = d.split('-'); return (+p[1]) + '/' + (+p[2]); };
  const sch20 = T.computeSchedule();
  const r1t = T.getState().tasks.find(t => t.id === 'r1');
  const expR1 = '(' + shortMD(sch20['r1'] ? sch20['r1'].start : r1t.start) + '-' + shortMD(sch20['r1'] ? sch20['r1'].end : r1t.end) + ')';
  const r1line = codeND.split('\n').find(l => l.includes(':done, r1,'));
  ok('普通任务名追加 (M/D-M/D)', r1line && r1line.includes(expR1), r1line + ' 期望 ' + expR1);
  const m1t = T.getState().tasks.find(t => t.id === 'm1');
  const expM1 = '(' + shortMD(sch20['m1'] ? sch20['m1'].start : m1t.start) + ')';
  const m1line = codeND.split('\n').find(l => l.includes(':milestone, done, m1,'));
  ok('里程碑任务名追加 (M/D)', m1line && m1line.includes(expM1) && !m1line.includes(expM1 + '-'), m1line + ' 期望 ' + expM1);

  setStyle({ nameOwner: true });
  const codeNO = T.genMermaid();
  const r1line2 = codeNO.split('\n').find(l => l.includes(':done, r1,'));
  ok('负责人入名 ·产品', r1line2 && /·产品/.test(r1line2), r1line2);
  setStyle({ nameOwner: false });

  // 已含日期括号的名字不重复追加
  const stND = T.getState();
  stND.tasks[0].name = '需求确认(8/26-8/29，示例批次)';
  const codeDup = T.genMermaid();
  const r1dup = codeDup.split('\n').find(l => l.includes(':done, r1,'));
  ok('已含日期括号不重复追加', r1dup && (r1dup.match(/\(/g) || []).length === 1, r1dup);
  // 名字内嵌非括号日期（如"(2k, 9/17)"）也不追加
  stND.tasks[0].name = '提前出样品交付(2k, 9/17)';
  const codeDup2 = T.genMermaid();
  const r1dup2 = codeDup2.split('\n').find(l => l.includes(':done, r1,'));
  ok('内嵌日期文本不重复追加', r1dup2 && (r1dup2.match(/\(/g) || []).length === 1, r1dup2);
  base();

  console.log('\n[20c] 解析剥离：手写日期括号往返无损');
  const tpl2 = 'gantt\n    title T\n    section S\n    模块B准备完毕(8/18-8/19) :done, tgBom, 2026-08-18, 2026-08-20\n    项目启动(8/17) :milestone, s1, 2026-08-17, 0d\n    试运行(8/26-8/29，示例批次) :done, tr, 2026-08-26, 2026-08-30';
  const pr = T.parseMermaid(tpl2);
  const tg = pr.tasks.find(t => t.id === 'tgBom');
  ok('纯日期括号被剥离', tg && tg.name === '模块B准备完毕', tg ? tg.name : '(none)');
  const st2 = pr.tasks.find(t => t.id === 's1');
  ok('里程碑单日括号被剥离', st2 && st2.name === '项目启动', st2 ? st2.name : '(none)');
  const tr2 = pr.tasks.find(t => t.id === 'tr');
  ok('含其他内容的括号不剥离', tr2 && tr2.name === '试运行(8/26-8/29，示例批次)', tr2 ? tr2.name : '(none)');
  setS({ title: 'T', tasks: pr.tasks, view: 'auto' });
  T.getState().style.nameDates = true;
  const regen2 = T.genMermaid();
  const tgLine = regen2.split('\n').find(l => l.includes(':done, tgBom,'));
  ok('重新生成自动拼回日期', tgLine && /\(8\/18-8\/19\)/.test(tgLine), tgLine);
  const trLine = regen2.split('\n').find(l => l.includes(':done, tr,'));
  ok('含其他内容括号不双重追加', trLine && (trLine.match(/\(/g) || []).length === 1, trLine);
  const round2 = T.parseMermaid(regen2);
  const tg2 = round2.tasks.find(t => t.id === 'tgBom');
  ok('往返后任务名仍干净', tg2 && tg2.name === '模块B准备完毕', tg2 ? tg2.name : '(none)');
  ok('往返后日期一致', tg2 && tg2.start === '2026-08-18' && tg2.end === '2026-08-19', tg2 ? tg2.start + '~' + tg2.end : '');
  base();

  console.log('\n[20d] 解析剥离：日期与负责人展示后缀拆回独立字段');
  const decoratedTpl = `gantt
    title 示例项目
    dateFormat YYYY-MM-DD
    section 阶段一
    包装备料(11/17-12/1)·PMC :t20, 2026-11-19, 2026-12-04
    立项启动(11/2)·PM :milestone, crit, t1, 2026-11-04, 0d
    模具（复用）评审(11/5-11/7) · 结构工程师 :crit, t2, 2026-11-05, 2026-11-08
    试运行(8/26-8/29，示例批次) :done, t3, 2026-08-26, 2026-08-30`;
  const decoratedParsed = T.parseMermaid(decoratedTpl);
  const packaging = decoratedParsed.tasks.find(t => t.id === 't20');
  ok('日期负责人后缀拆分为干净任务名', packaging && packaging.name === '包装备料', packaging ? packaging.name : '(none)');
  ok('负责人后缀还原到负责人字段', packaging && packaging.owner === 'PMC', packaging ? packaging.owner : '(none)');
  ok('排期采用 Mermaid 结构化日期而非名称日期', packaging && packaging.start === '2026-11-19' && packaging.end === '2026-12-03', packaging ? packaging.start + '~' + packaging.end : '(none)');
  const launch = decoratedParsed.tasks.find(t => t.id === 't1');
  ok('带负责人的里程碑名称与负责人正确拆分', launch && launch.name === '立项启动' && launch.owner === 'PM' && launch.milestone, launch ? JSON.stringify(launch) : '(none)');
  const mold = decoratedParsed.tasks.find(t => t.id === 't2');
  ok('任务名自带其他括号且分隔符有空格时仍正确拆分', mold && mold.name === '模具（复用）评审' && mold.owner === '结构工程师', mold ? mold.name + ' / ' + mold.owner : '(none)');
  const annotated = decoratedParsed.tasks.find(t => t.id === 't3');
  ok('含额外说明的日期括号仍不误拆', annotated && annotated.name === '试运行(8/26-8/29，示例批次)' && annotated.owner === '', annotated ? annotated.name : '(none)');
  setS({ title: decoratedParsed.title, tasks: decoratedParsed.tasks, view: 'auto' });
  T.getState().style.nameDates = true;
  T.getState().style.nameOwner = true;
  const decoratedRegen = T.genMermaid();
  const packagingLine = decoratedRegen.split('\n').find(l => l.includes(':t20,'));
  ok('导出继续把最新结构化日期和负责人拼回名称', packagingLine && /包装备料\(11\/19-12\/3\)·PMC/.test(packagingLine), packagingLine);
  const changedPackaging = T.getState().tasks.find(t => t.id === 't20');
  changedPackaging.start = '2026-11-20';
  changedPackaging.end = '2026-12-05';
  const changedLine = T.genMermaid().split('\n').find(l => l.includes(':t20,'));
  ok('修改日期后导出名称同步更新且不残留旧日期', changedLine && /包装备料\(11\/20-12\/5\)·PMC/.test(changedLine) && !/11\/17-12\/1/.test(changedLine), changedLine);
  base();

  console.log('\n[15b] 缩放（官方渲染 SVG 尺寸）');
  ok('zoom 100% 时 SVG 用原生尺寸', +svgStub.attrs.width === 700, JSON.stringify(svgStub.attrs));
  ctx2.__T.setState(Object.assign({}, ctx2.__T.getState(), { zoom: 2 }));
  ctx2.__T.renderPreview();
  await new Promise(r => setImmediate(r));
  ok('zoom 200% 时 SVG 宽度翻倍', +svgStub.attrs.width === 1400, JSON.stringify(svgStub.attrs));
  ctx2.__T.setState(Object.assign({}, ctx2.__T.getState(), { zoom: 1 }));
  ctx2.mermaid.render = (id, code) => Promise.resolve({ svg: '<svg id="mock-mm" viewBox="0 0 700 300"><rect width="700" height="300" fill="#ffffff"/></svg>' });
  ctx2.__T.renderPreview();
  await new Promise(r => setImmediate(r));

  console.log('\n[16] Mermaid 渲染失败时的兜底');
  ctx2.mermaid.render = (id, code) => Promise.reject(new Error('Parse error on line 8'));
  ctx2.__T.renderPreview();
  await new Promise(r => setImmediate(r));
  ok('失败后回退本地引擎', chartStub.innerHTML.includes('<svg'));
  ok('失败时显示错误提示', (els2['chartErr'] ? els2['chartErr'].textContent : '').includes('Mermaid 渲染失败'),
     els2['chartErr'] ? els2['chartErr'].textContent : '');
  ok('徽章切换为警告', (els2['renderMode'] ? els2['renderMode'].textContent : '').includes('本地兜底'));

  console.log('\n[22] 删除任务清理依赖引用（防止孤立 ID 显示）');
  base();
  const s22 = T.getState();
  const targetId = s22.tasks[0].id;
  s22.tasks[1].deps = [targetId];
  s22.tasks.splice(0, 1);
  const removedId = s22.tasks[0].id;
  s22.tasks.forEach(t => { if(t.deps) t.deps = t.deps.filter(d => d !== removedId); });
  ok('删除任务后无对被删 id 的残留依赖', !s22.tasks.find(t => (t.deps || []).indexOf(removedId) >= 0));
  ok('未误删其他无关依赖', !s22.tasks.find(t => (t.deps || []).indexOf('nonexistent') >= 0));
  base();

  console.log('\n[23] 前置浮层位置 bug 修复（renderTable 不再销毁 anchor）');
  // depsPop 元素是 body 直接子节点，不受表格重建影响
  const pop = ctx2.document.getElementById('depsPop');
  ok('depsPop 元素存在于 DOM', !!pop);
  ok('depsPop 初始不可见（display 默认空）', pop.style.display === '' || pop.style.display === 'none');
  base();

  console.log('\n[24] 阶段行底色视觉清晰化（灰调不透明底色 + 亮色带成对色板）');
  base();
  const s24 = T.getState();
  const sec = s24.tasks[0].section;
  const c = T.sectionColor(sec);
  const bg = T.sectionBg(sec);
  ok('sectionColor 返回 6 位 hex 亮色带', /^[0-9a-f]{6}$/i.test(c.replace('#', '')), c);
  ok('sectionBg 返回 6 位 hex 灰调底色', /^[0-9a-f]{6}$/i.test(bg.replace('#', '')), bg);
  ok('sectionBg 同输入返回稳定结果', T.sectionBg(sec) === T.sectionBg(sec));
  // bg 来自 8 个预调灰调色板之一（与亮色带成对）
  ok('bg 来自预调浅色 pastel 色板', ['#fadcd9','#dde7fa','#f6ecc8','#e8e0f7','#d6ecdc','#fbe9c8','#d2eaea','#f6dcec'].indexOf(bg) >= 0, bg);
  // 5 个 section 在 8 色 palette 下多数能区分开（容忍少量撞色）
  const colors = new Set(['需求与立项','结构开发','模具与供应商','电子与软件','验证与量产'].map(s => T.sectionBg(s)));
  ok('基础示例 5 个 section 至少 3 种不同底色', colors.size >= 3, '实际 ' + colors.size + ' 种');
  // 主题切换：深色模式下 sectionBg 用灰调色板
  const lightBg = T.sectionBg('需求与立项');
  T.setState(Object.assign({}, T.getState(), { theme: 'dark' }));
  const darkBg = T.sectionBg('需求与立项');
  ok('深色模式 sectionBg 用灰调色板', ['#2b1d1d','#1a263a','#28230f','#251f33','#192b21','#2b2118','#192828','#261a2a'].indexOf(darkBg) >= 0, darkBg);
  ok('深浅两套色板色值不同', lightBg !== darkBg, lightBg + ' vs ' + darkBg);
  T.setState(Object.assign({}, T.getState(), { theme: 'light' }));
  ok('切回浅色恢复 pastel', T.sectionBg('需求与立项') === lightBg);
  base();

  console.log('\n[24b] 阶段底色对比度（相邻阶段不能撞色）');
  const sBg1 = T.sectionBg('阶段一');
  const sBg2 = T.sectionBg('阶段二');
  const sBar1 = T.sectionColor('阶段一');
  const sBar2 = T.sectionColor('阶段二');
  ok('「阶段一」与「阶段二」底色不同（避免撞色）', sBg1 !== sBg2, sBg1 + ' vs ' + sBg2);
  ok('「阶段一」与「阶段二」色带不同', sBar1 !== sBar2, sBar1 + ' vs ' + sBar2);
  /* 计算色相距离（HCL 近似）：RGB 三通道差的绝对值之和 ≥ 30 视为可辨 */
  function rgbDist(a, b){
    const pa = a.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16));
    const pb = b.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16));
    return Math.abs(pa[0]-pb[0]) + Math.abs(pa[1]-pb[1]) + Math.abs(pa[2]-pb[2]);
  }
  ok('「阶段一」与「阶段二」底色 RGB 距离 ≥ 30', rgbDist(sBg1, sBg2) >= 30, rgbDist(sBg1, sBg2) + '');
  base();

  console.log('\n[25] 首次打开模板（干净占位数据，非真实示例）');
  T.loadTemplate();
  const tpl = T.getState();
  ok('模板标题含「模板」', tpl.title.includes('模板'), tpl.title);
  ok('模板任务数 5', tpl.tasks.length === 5, '实际 ' + tpl.tasks.length);
  ok('模板含阶段一/阶段二', tpl.tasks.some(t => t.section === '阶段一') && tpl.tasks.some(t => t.section === '阶段二'));
  ok('模板含负责人占位', tpl.tasks.some(t => String(t.owner).indexOf('负责人') === 0));
  ok('模板含里程碑示例', tpl.tasks.some(t => t.milestone));
  ok('模板任务名带提示语', tpl.tasks.some(t => t.name.indexOf('改成') >= 0 || t.name.indexOf('可删') >= 0));
  /* 备份/说明相关控件与开关已接线 */
  const bk = ctx2.document.getElementById('btnBackup');
  ok('备份按钮已接线', !!bk && typeof bk.onclick === 'function');
  const hp = ctx2.document.getElementById('btnHelp');
  ok('帮助按钮已接线', !!hp && typeof hp.onclick === 'function');
  base();

  console.log('\n[26] 已有数据（即使任务为空）不被模板覆盖');
  const elsE = {};
  const ctxE = {
    console, setTimeout, clearTimeout,
    localStorage: {
      getItem: () => JSON.stringify({ current: 'p1', seq: 1, items: { p1: { name: '空项目', data: { title: '空项目', tasks: [], view: 'auto', style: {} } } } }),
      setItem() {}
    },
    navigator: {},
    document: { getElementById: id => elsE[id] || (elsE[id] = stub()), createElement: () => stub(), documentElement: { dataset: {} }, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    window: { getSelection: () => ({ removeAllRanges() {} }), addEventListener() {}, dispatchEvent() {} }
  };
  ctxE.globalThis = ctxE;
  vm.createContext(ctxE);
  try { vm.runInContext(src, ctxE, { filename: 'inlineE.js' }); }
  catch (e) { ok('空任务存储执行', false, e.message); }
  ok('有数据时空项目不被覆盖', ctxE.__T.getState().title === '空项目' && ctxE.__T.getState().tasks.length === 0,
     ctxE.__T.getState().title);

  console.log('\n[27] 重置工具（恢复首次打开状态）');
  ok('重置按钮已接线', !!ctx2.document.getElementById('btnReset') &&
     typeof ctx2.document.getElementById('btnReset').onclick === 'function');
  lsRemoved.length = 0; lsReloaded = false;
  T.resetApp();
  ok('重置清空项目数据键', lsRemoved.indexOf('gantt-studio-v3') >= 0, lsRemoved.join(','));
  ok('重置清空使用说明标记键', lsRemoved.indexOf('gantt-studio-v3:intro') >= 0, lsRemoved.join(','));
  ok('重置触发页面重载', lsReloaded);
  ok('重置标志位已置位', T.getResetFlag() === true);
  base();

  console.log('\n[28] 空状态（删除到最后一个项目后进入空状态）');
  /* 进入测试段前先把 startup 的 loadTemplate 项目清掉，确保数据可控 */
  T.enterEmptyState();
  ok('准备阶段为空状态', T.isEmptyState() === true);
  T.createProject('空态测试A');
  T.createProject('空态测试B');
  T.createProject('空态测试C');
  ok('准备 3 个项目', Object.keys(T.getProjects().items).length === 3, '实际 ' + Object.keys(T.getProjects().items).length);
  T.setConfirmStub(true);
  T.delProject(); T.delProject(); T.delProject(); /* 连续删 3 个 */
  T.setConfirmStub(null);
  ok('删到 0 后 projects.items 为空', Object.keys(T.getProjects().items).length === 0, '实际 ' + Object.keys(T.getProjects().items).length);
  ok('删到 0 后 current 为空', T.getProjects().current === '');
  ok('删到 0 后 state.title 为空', T.getState().title === '', T.getState().title);
  ok('删到 0 后 state.tasks 为空', T.getState().tasks.length === 0);
  ok('isEmptyState 返回 true', T.isEmptyState() === true);
  ok('applyProjectState 后空状态卡片显示', T.getEmptyOpen() === true);
  ok('applyProjectState 后 main 隐藏（data-empty=1）', ctx.document.getElementById('mainApp').dataset.empty === '1');
  ok('applyProjectState 后标题输入框禁用', ctx.document.getElementById('titleInput').disabled === true);
  ok('applyProjectState 后删除项目按钮隐藏', ctx.document.getElementById('btnDelProj').style.display === 'none');
  ok('空状态按钮已接线（esNew/esSample/esRestore）',
     typeof ctx2.document.getElementById('esNew').onclick === 'function' &&
     typeof ctx2.document.getElementById('esSample').onclick === 'function' &&
     typeof ctx2.document.getElementById('esRestore').onclick === 'function');
  /* 通过 createProject 恢复到非空状态 */
  T.createProject('恢复');
  ok('恢复后 isEmptyState 为 false', T.isEmptyState() === false);
  ok('恢复后空状态卡片隐藏', T.getEmptyOpen() === false);
  ok('恢复后标题输入框可用', ctx.document.getElementById('titleInput').disabled === false);
  ok('恢复后删除项目按钮显示', ctx.document.getElementById('btnDelProj').style.display !== 'none');
  base();

  console.log('\n[29] 示例按钮不覆盖当前项目（关键安全契约）');
  /* 先模拟一个有内容的项目 */
  T.createProject('我的真实排期', false);
  const realBefore = {
    title: T.getState().title,
    tasks: T.getState().tasks.map(t => Object.assign({}, t, { deps: (t.deps || []).slice() })),
    style: Object.assign({}, T.getState().style)
  };
  const realId = T.getProjects().current;
  const realItemBefore = JSON.parse(JSON.stringify(T.getProjects().items[realId]));
  /* 点 sampleToNewProject：应新建示例项目并切换，不改原项目 */
  T.sampleToNewProject();
  const afterProj = T.getProjects();
  const newId = afterProj.current;
  ok('sampleToNewProject 后 current 切换到新项目', newId !== realId, 'realId=' + realId + ' newId=' + newId);
  ok('sampleToNewProject 后 projects.items 至少 2 个', Object.keys(afterProj.items).length >= 2);
  ok('原项目仍在 projects.items 里', !!afterProj.items[realId]);
  /* 原项目的 data 应该和操作前一致（深拷贝） */
  const realItemAfter = afterProj.items[realId];
  ok('原项目 title 未被覆盖', realItemAfter.data.title === realBefore.title, realItemAfter.data.title);
  ok('原项目任务数未被覆盖', realItemAfter.data.tasks.length === realBefore.tasks.length);
  ok('原项目任务内容未被覆盖', JSON.stringify(realItemAfter.data.tasks) === JSON.stringify(realBefore.tasks));
  ok('原项目 style 未被覆盖', JSON.stringify(realItemAfter.data.style) === JSON.stringify(realItemBefore.data.style));
  /* 新项目应填入示例数据 */
  const newItem = afterProj.items[newId];
  ok('新项目名为「示例项目」', newItem.name === '示例项目', newItem.name);
  ok('新项目含 15 条示例任务', newItem.data.tasks.length === 15, '实际 ' + newItem.data.tasks.length);
  /* 再次点示例：应再建一个示例项目，原项目和第一个示例项目都不丢 */
  T.sampleToNewProject();
  const after2 = T.getProjects();
  ok('连续两次示例后仍能访问原项目', !!after2.items[realId]);
  ok('连续两次示例后第一个示例项目仍在', !!after2.items[newId]);
  ok('连续两次示例后 current 切到最新示例项目', after2.current !== newId && after2.current !== realId);

  console.log('\n[30] 备注起止短格式（纯自由文本，不解析提醒规则）');
  ok('taskRangeShort 普通任务 9/8–9/20', T.taskRangeShort({ start: '2026-09-08', end: '2026-09-20' }) === '9/8–9/20',
     T.taskRangeShort({ start: '2026-09-08', end: '2026-09-20' }));
  ok('taskRangeShort 里程碑只显示单日', T.taskRangeShort({ start: '2026-09-28', end: '2026-09-28', milestone: true }) === '9/28',
     T.taskRangeShort({ start: '2026-09-28', end: '2026-09-28', milestone: true }));

  console.log('\n[31] 待办清单（任务基础信息 + 原样备注，不推算提醒日期）');
  const stBefore31 = T.getState();
  T.setState({
    title: '示例项目',
    style: stBefore31.style,
    tasks: [
      { id: 'a1', section: '开发', name: '模块 A 开发', owner: '开发A', start: '2026-09-08', end: '2026-09-20', progress: 0, status: '', milestone: false, deps: [], note: '提前3天提醒\n与供应商确认交期' },
      { id: 'a2', section: '验证', name: '正式发布', owner: 'PM', start: '2026-09-28', end: '2026-09-28', progress: 0, status: '', milestone: true, deps: [], note: '需质量负责人签字' }
    ]
  });
  const todo = T.notesTodoText();
  ok('清单含标题行', /^待办清单 · 示例项目（生成于 \d{4}-\d{2}-\d{2}）$/.test(todo.split('\n')[0]), todo.split('\n')[0]);
  ok('清单含任务名与起止短格式', todo.includes('1. 模块 A 开发  9/8–9/20  负责人：开发A'), todo.split('\n')[1]);
  ok('清单含负责人', todo.includes('负责人：开发A') && todo.includes('负责人：PM'));
  ok('清单原样输出备注（不解析不加工）', todo.includes('备注：提前3天提醒') && todo.includes('与供应商确认交期'), todo);
  ok('清单含备注正文', todo.includes('备注：需质量负责人签字'));
  ok('多行备注缩进对齐', /\n         与供应商确认交期/.test(todo), JSON.stringify(todo.split('\n')));
  ok('里程碑条目只显示单日', /2\. 正式发布  9\/28/.test(todo), (todo.match(/2\..*/) || [])[0]);
  ok('清单不输出推算的提醒日期行', !/\n   提醒：/.test(todo), todo);
  ok('清单不含 Mermaid 标记', !todo.includes('gantt') && !todo.includes('section'));
  T.setState(stBefore31);
  base();

  console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败'));
  process.exit(fail === 0 ? 0 : 1);
})();
