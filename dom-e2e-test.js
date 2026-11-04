/* DOM 级端到端验证：新建项目弹窗 / 删除确认弹窗 / 重置开关（jsdom） */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (extra ? '  >> ' + extra : '')); fail++; }
}

/* jsdom 不支持页面导航（reload 后真实浏览器行为由 smoke-test 的 location stub 验证），过滤该噪音 */
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Not implemented: navigation/.test(e.message)) console.error('jsdomError:', e.message); });

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://localhost/gantt', pretendToBeVisual: true, virtualConsole: vc });
const win = dom.window, doc = win.document;
const $ = id => doc.getElementById(id);

setTimeout(() => {
  try {
    console.log('[DOM e2e] 本地渲染与零主动外传路径');
    const scriptSrcs = [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
    ok('Mermaid 仅从项目本地加载', scriptSrcs.length === 1 && scriptSrcs[0] === './mermaid.min.js', scriptSrcs.join(','));
    ok('在线校验按钮已删除', !$('btnVerify'));
    ok('源码不再包含 mermaid.live', !html.includes('mermaid.live'));
    ok('源码无主动网络请求 API', !/fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(html));

    console.log('[DOM e2e] 本地缓存异常保护');
    const storageProto = win.Storage.prototype;
    const originalSetItem = storageProto.setItem;
    storageProto.setItem = function(){ throw new Error('模拟存储空间不足'); };
    const saveWhenFull = win.eval('save()');
    storageProto.setItem = originalSetItem;
    ok('本地存储写入失败时 save 明确返回失败', saveWhenFull === false);
    win.localStorage.setItem('gantt-studio-v3', '{损坏的JSON');
    const loadBroken = win.eval('load()');
    const recoveryKeys = Object.keys(win.localStorage).filter(k => k.startsWith('gantt-studio-v3:recovery:'));
    ok('损坏缓存不会被当作正常数据加载', loadBroken === false);
    ok('损坏缓存会先保存恢复副本再进入干净模板', recoveryKeys.length === 1 && win.localStorage.getItem(recoveryKeys[0]) === '{损坏的JSON', recoveryKeys.join(','));
    win.eval('save()');

    console.log('[DOM e2e] 新建项目弹窗');
    const np = $('npModal'), cf = $('cfModal');
    ok('页面加载无脚本错误', true);
    ok('新建弹窗初始隐藏', !np.classList.contains('on'));
    ok('确认弹窗初始隐藏', !cf.classList.contains('on'));
    ok('顶栏按钮为文字版「＋ 新建」', $('btnNewProj').textContent.trim() === '＋ 新建', $('btnNewProj').textContent);

    $('btnNewProj').click();
    ok('点击后弹窗显示', np.classList.contains('on'));
    setTimeout(() => {
      ok('输入框自动聚焦', doc.activeElement === $('npName'));

      /* 空名称拦截 */
      $('npOk').click();
      ok('空名称不创建且弹窗保留', np.classList.contains('on') && $('toast').textContent.includes('请先输入项目名称'));

      /* 正常创建 */
      $('npName').value = 'DOM 测试项目';
      $('npCopy').checked = true; /* 复制当前任务 */
      const before = $('projSel').options.length;
      $('npOk').click();
      ok('创建后弹窗关闭', !np.classList.contains('on'));
      ok('提示已新建', ($('toast').textContent || '').includes('已新建项目'), $('toast').textContent);
      ok('项目下拉新增一项', $('projSel').options.length === before + 1);
      ok('当前项目切换为新项目', $('projSel').value !== '' && $('projSel').selectedOptions[0].textContent.includes('DOM 测试项目'));
      ok('标题输入框同步', $('titleInput').value === 'DOM 测试项目', $('titleInput').value);
      ok('复制任务生效（模板 5 条）', doc.querySelectorAll('#tbody tr').length === 5, '实际 ' + doc.querySelectorAll('#tbody tr').length);

      /* Enter 键提交 */
      $('btnNewProj').click();
      $('npName').value = '回车创建项目';
      $('npName').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      ok('Enter 直接创建', !np.classList.contains('on') && $('projSel').selectedOptions[0].textContent.includes('回车创建项目'));

      console.log('[DOM e2e] 删除确认弹窗');
      const cnt = $('projSel').options.length;
      $('btnDelProj').click();
      ok('删除弹出确认框', cf.classList.contains('on'));
      ok('确认文案含项目名', $('cfMsg').textContent.includes('回车创建项目'), $('cfMsg').textContent);
      $('cfCancel').click();
      ok('取消后弹窗关闭', !cf.classList.contains('on'));
      ok('取消后项目仍在', $('projSel').options.length === cnt);

      $('btnDelProj').click();
      $('cfOk').click();
      ok('确认后项目被删除', $('projSel').options.length === cnt - 1);
      ok('确认按钮为危险色', ($('cfOk').className || '').includes('danger'), $('cfOk').className);

      /* Esc 关闭 */
      $('btnNewProj').click();
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      ok('Esc 关闭新建弹窗', !np.classList.contains('on'));
      $('btnDelProj').click();
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      ok('Esc 关闭确认弹窗', !cf.classList.contains('on'));

      /* 点击遮罩关闭 */
      $('btnNewProj').click();
      np.click(); /* e.target === modal 遮罩 */
      ok('点击遮罩关闭新建弹窗', !np.classList.contains('on'));

      console.log('[DOM e2e] 重置开关');
      ok('重置按钮存在且为危险风格', !!$('btnReset') && ($('btnReset').className || '').includes('danger-ghost'), $('btnReset') && $('btnReset').className);
      $('btnReset').click();
      ok('重置弹出确认框', cf.classList.contains('on'));
      ok('确认文案含「不可撤销」与备份提示', $('cfMsg').textContent.includes('不可撤销') && $('cfMsg').textContent.includes('备份'), $('cfMsg').textContent);
      ok('确认按钮为危险色', ($('cfOk').className || '').includes('danger'));
      $('cfCancel').click();
      ok('取消后弹窗关闭', !cf.classList.contains('on'));
      ok('取消后数据仍在', win.localStorage.getItem('gantt-studio-v3') !== null);
      $('btnReset').click();
      $('cfOk').click();
      ok('确认后弹窗关闭', !cf.classList.contains('on'));
      ok('项目数据已清除', win.localStorage.getItem('gantt-studio-v3') === null);
      ok('使用说明标记已清除', win.localStorage.getItem('gantt-studio-v3:intro') === null);
      /* resetApp 内 removeItem 先于 location.reload() 执行；reload 后的恢复流程（模板+说明）由
         smoke-test [26]/[25] 与启动逻辑覆盖：load() 失败 → loadTemplate() → maybeIntro() */

      console.log('[DOM e2e] 空状态卡片（删完最后一个项目后）');
      /* 关掉首次打开可能弹出的使用说明，避免遮罩干扰 */
      if ($('inModal').classList.contains('on')) $('inOk').click();
      ok('初始 main 未设空状态标记', !$('mainApp').dataset.empty);
      ok('初始空状态卡片隐藏', $('emptyState').hidden);
      const projCnt = $('projSel').options.length;
      ok('初始至少 1 个项目', projCnt >= 1, '实际 ' + projCnt);
      /* 删到只剩 0 */
      let safety = 10;
      while ($('projSel').options.length > 0 && safety-- > 0) {
        $('btnDelProj').click();
        if (!cf.classList.contains('on')) break;
        $('cfOk').click();
      }
      ok('项目下拉仅剩占位 option', $('projSel').options.length === 1 && $('projSel').options[0].disabled, 'options: ' + $('projSel').options.length);
      ok('项目下拉显示「暂无项目」占位', $('projSel').options[0] && $('projSel').options[0].textContent.includes('暂无项目'));
      ok('空状态卡片可见', !$('emptyState').hidden);
      ok('main 标记为空状态（data-empty=1）', $('mainApp').dataset.empty === '1');
      ok('main 实际隐藏（display:none 由 CSS 选择器触发，jsdom 不渲染）', $('mainApp').getAttribute('data-empty') === '1');
      ok('标题输入框已禁用', $('titleInput').disabled === true);
      ok('删除项目按钮隐藏', $('btnDelProj').style.display === 'none');
      ok('空状态文案含「还没有项目」', $('emptyState').textContent.includes('还没有项目'));
      ok('三个空状态主按钮可见', !!$('esNew') && !$('esNew').hidden && !!$('esSample') && !!$('esRestore'));
      /* 点 esSample 应创建一个示例项目并退出空状态 */
      $('esSample').click();
      ok('点 esSample 后空状态卡片隐藏', $('emptyState').hidden);
      ok('点 esSample 后 main 恢复', !$('mainApp').dataset.empty);
      ok('点 esSample 后标题输入框可用', $('titleInput').disabled === false);
      ok('点 esSample 后下拉出现示例项目', $('projSel').selectedOptions[0] && $('projSel').selectedOptions[0].textContent.includes('示例项目'));
      ok('点 esSample 后表格有示例任务', doc.querySelectorAll('#tbody tr').length === 15, '实际 ' + doc.querySelectorAll('#tbody tr').length);

      console.log('\n[DOM e2e] 表格列结构（计划分组 / 操作列 / 选中行插入）');
      const ths = [...doc.querySelectorAll('table thead th')];
      const cols = [...doc.querySelectorAll('table colgroup col')];
      ok('表格为 12 列', ths.length === 12, '实际 ' + ths.length);
      ok('第 2 列为「计划分组」', ths[1].textContent.trim() === '计划分组', ths[1].textContent);
      ok('最右列标题为「操作」', ths[ths.length-1].textContent.trim() === '操作', ths[ths.length-1].textContent);
      /* 列宽可能在 <th> style 或 <col> style，优先从 <col> 取（更可靠） */
      const widths = cols.length === 12 ? cols.map(c => (c.getAttribute('style') || '').match(/(\d+)px/) || []) : ths.map(th => (th.getAttribute('style') || '').match(/(\d+)px/) || []);
      const lastWidth = parseInt(widths[widths.length-1][1], 10);
      ok('操作列宽 64px', lastWidth === 64, '实际 ' + lastWidth);
      const totalColW = widths.reduce((s, m) => s + parseInt(m[1], 10), 0);
      ok('列总宽 ≤ 1200px（新增计划分组后仍保持紧凑）', totalColW <= 1200, '总计 ' + totalColW);
      ok('计划分组作为附加功能默认收起', $('groupFilter').value === '__collapsed__');
      ok('收起时隐藏计划分组列并释放列宽', [...doc.querySelectorAll('.group-column')].every(el => el.classList.contains('is-collapsed')) && Number(doc.querySelector('table').dataset.colsSum) === totalColW - parseInt(widths[1][1], 10));
      $('groupFilter').value = '';
      $('groupFilter').dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('同一个下拉框可展开分组列并选择筛选范围', $('groupFilter').value === '' && [...doc.querySelectorAll('.group-column')].every(el => !el.classList.contains('is-collapsed')));
      ok('工具栏只保留一个固定宽度的计划分组控件', !$('btnGroupToggle') && !$('groupTools') && /\.schedule-actions \.group-filter\{[^}]*width:\s*128px/.test([...doc.querySelectorAll('style')].map(x => x.textContent).join('\n')));
      /* 固定内容列（开始/结束/进度/状态/里程碑）最小宽度——保证不被截断（用户要求 2026-09-04） */
      const colW = i => parseInt(widths[i][1], 10);
      const MIN_REQ = { 4:142, 5:142, 7:88, 8:124, 9:48 };
      const COL_NAME = { 4:'开始', 5:'结束', 7:'进度%', 8:'状态', 9:'里程碑' };
      Object.keys(MIN_REQ).forEach(i => {
        ok('「' + COL_NAME[i] + '」列宽 ≥ ' + MIN_REQ[i] + 'px（完整显示不截断）',
           colW(i) >= MIN_REQ[i], '实际 ' + colW(i));
      });
      const durationCell = doc.querySelector('#tbody td.duration-cell');
      ok('工期单元格同时显示自然日和工作日', !!durationCell && !!durationCell.querySelector('.dur-cal') && !!durationCell.querySelector('.dur-work'));
      const durCal = durationCell && durationCell.querySelector('.dur-cal');
      const durWork = durationCell && durationCell.querySelector('.dur-work');
      const durInput = durationCell && durationCell.querySelector('[data-f="duration"]');
      const workDurInput = durationCell && durationCell.querySelector('[data-f="workDuration"]');
      ok('工期自然日提供数字输入框', durInput && durInput.type === 'number' && Number(durInput.value) >= 1, durInput && durInput.outerHTML);
      ok('工期工作日也提供数字输入框', workDurInput && workDurInput.type === 'number' && Number(workDurInput.value) >= 0, workDurInput && workDurInput.outerHTML);
      ok('工期自然日按“自然日 X”顺序显示且不再显示“天”', durCal && durCal.firstElementChild.textContent === '自然日' && durCal.children.length === 2 && !durCal.textContent.includes('天'), durCal && durCal.textContent);
      ok('工期工作日按“工作日 Y”顺序显示且不再显示“天”', durWork && durWork.firstElementChild.textContent === '工作日' && durWork.querySelector('[data-f="workDuration"]') && durWork.children.length === 2 && !durWork.textContent.includes('天'), durWork && durWork.textContent);
      ok('自然日与工作日使用同一两列网格对齐', /grid-template-columns:\s*42px 32px/.test([...doc.querySelectorAll('style')].map(x => x.textContent).join('\n')));
      ok('工期使用 dur-stack 容器', !!durationCell && !!durationCell.querySelector('.dur-stack'));
      ok('工期表头说明工作日口径', ths[6].title.includes('周一至周五') && ths[6].title.includes('节假日'));
      /* 表头居中 + 字体加大（用户要求 2026-09-04）——jsdom 算不出 fontSize，改查 CSS 规则 */
      const cssTextForTable = [...doc.querySelectorAll('style')].map(x => x.textContent).join('\n');
      ok('表头规则含 text-align:center', /th\{[^}]*text-align:\s*center/.test(cssTextForTable));
      ok('表头字号 14px（整体放大）', /th\{[^}]*font-size:\s*14px/.test(cssTextForTable));
      ok('表基础字号 14.5px（整体放大）', /\btable\{[^}]*font-size:\s*14\.5px/.test(cssTextForTable));
      ok('table 含 width:100%（宽屏撑满容器）', /\btable\{[^}]*width:\s*100%/.test(cssTextForTable));
      ok('tbl-wrap 含 overflow:auto（窄屏可横滚）', /\.tbl-wrap\{[^}]*overflow:\s*auto/.test(cssTextForTable));
      ok('tbl-wrap 含 min-width:0（允许 flex 子项收缩触发滚动）', /\.tbl-wrap\{[^}]*min-width:\s*0/.test(cssTextForTable));
      /* syncTableWidth 接线：宽屏填充、窄屏锁宽 */
      ok('syncTableWidth 函数已定义', typeof win.syncTableWidth === 'function');
      /* 检查函数源码包含两套分支（宽屏 100% / 窄屏锁列宽之和） */
      ok('syncTableWidth 含宽屏 100% 分支', /width\s*=\s*['"]100%/.test(win.syncTableWidth.toString()));
      ok('syncTableWidth 含窄屏锁列宽分支', /colsSum\s*\+\s*['"]px/.test(win.syncTableWidth.toString()));
      const colResizers = [...doc.querySelectorAll('thead .col-resizer')];
      ok('每一列表头都有列宽拖动手柄', colResizers.length === 12, '实际 ' + colResizers.length);
      ok('列宽手柄具备可访问分隔条语义', colResizers.every((h, i) => h.getAttribute('role') === 'separator' && h.getAttribute('aria-orientation') === 'vertical' && h.dataset.col === String(i)));
      ok('列宽热区跨在真实列边界两侧', /\.col-resizer\{[^}]*right:\s*-4px/.test(cssTextForTable));
      ok('表头允许边界手柄跨列显示', /th\{[^}]*overflow:\s*visible/.test(cssTextForTable));
      const taskCol = cols[2], taskHandle = colResizers[2];
      const taskWidthBefore = parseInt(taskCol.style.width, 10);
      taskHandle.dispatchEvent(new win.MouseEvent('pointerdown', { clientX:200, bubbles:true, cancelable:true }));
      doc.dispatchEvent(new win.MouseEvent('pointermove', { clientX:280, bubbles:true, cancelable:true }));
      doc.dispatchEvent(new win.MouseEvent('pointerup', { clientX:280, bubbles:true, cancelable:true }));
      ok('拖动任务名称表头可扩大列宽', parseInt(taskCol.style.width, 10) === taskWidthBefore + 80, taskCol.style.width);
      const savedAfterResize = JSON.parse(win.localStorage.getItem('gantt-studio-v3'));
      const savedData = savedAfterResize.items[savedAfterResize.current].data;
      ok('调整后的列宽写入当前项目缓存', Array.isArray(savedData.tableColWidths) && savedData.tableColWidths[2] === taskWidthBefore + 80, JSON.stringify(savedData.tableColWidths));
      const tableWrap = doc.querySelector('.tbl-wrap');
      let testWrapWidth = 2000;
      Object.defineProperty(tableWrap, 'clientWidth', { configurable:true, get:() => testWrapWidth });
      win.syncTableWidth();
      ok('手动调宽后，宽屏仍自动撑满且右侧不留空白', doc.querySelector('table').style.width === '100%', doc.querySelector('table').style.width);
      testWrapWidth = 700;
      win.syncTableWidth();
      ok('手动调宽后，窄屏仍按列宽总和横向滚动', /px$/.test(doc.querySelector('table').style.width) && doc.querySelector('table').style.width !== '100%', doc.querySelector('table').style.width);
      testWrapWidth = 2000;
      win.syncTableWidth();
      taskHandle.dispatchEvent(new win.MouseEvent('dblclick', { bubbles:true, cancelable:true }));
      ok('双击列宽手柄恢复该列默认宽度', parseInt(taskCol.style.width, 10) === 140, taskCol.style.width);
      const ownerHandle = colResizers[3], ownerCol = cols[3];
      ownerHandle.dispatchEvent(new win.KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true, cancelable:true }));
      ok('键盘方向键也可调整列宽', parseInt(ownerCol.style.width, 10) === 82, ownerCol.style.width);
      ok('调宽状态使用独立 col-resizing 类，不干扰上下分隔条', /body\.col-resizing/.test(cssTextForTable) && !doc.body.classList.contains('col-resizing'));

      let firstGroup = doc.querySelector('#tbody tr[data-i="0"] [data-f="group"]');
      firstGroup.value = '模块A';
      firstGroup.dispatchEvent(new win.Event('change', { bubbles:true }));
      let secondGroup = doc.querySelector('#tbody tr[data-i="1"] [data-f="group"]');
      secondGroup.value = '模块B';
      secondGroup.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('计划分组写入任务数据', win.eval('state.tasks[0].group') === '模块A' && win.eval('state.tasks[1].group') === '模块B');
      let groupedRow0 = doc.querySelector('#tbody tr[data-i="0"]');
      let groupedRow1 = doc.querySelector('#tbody tr[data-i="1"]');
      ok('不同计划分组为甘特图准备不同颜色', win.eval('groupColor("模块A")') !== win.eval('groupColor("模块B")'));
      ok('排期表不再绘制计划分组边框', !/tbody tr\.has-group td/.test([...doc.querySelectorAll('style')].map(x => x.textContent).join('\n')) && !groupedRow0.classList.contains('has-group') && !groupedRow1.classList.contains('has-group'));
      const groupColorTrigger = groupedRow0.querySelector('[data-act="groupColorMenu"]');
      groupColorTrigger.click();
      ok('颜色入口优先展示 5 个推荐边框色', $('groupColorPop').style.display === 'block' && $('groupColorPop').querySelectorAll('[data-color]').length === 5);
      const recommendedColors = [...$('groupColorPop').querySelectorAll('[data-color]')].map(el => el.dataset.color.toLowerCase());
      const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
      ok('推荐边框色避开现有任务填充色', ['#378add','#1d9e75','#ef9f27','#e24b4a','#534ab7'].every(color => !recommendedColors.includes(color)) && !recommendedColors.includes('#e24b4a'), recommendedColors.join('、'));
      ok('推荐色使用中等亮度，避免荧光或过暗', recommendedColors.every(color => { const max = Math.max(...rgb(color)); return max >= 80 && max <= 215; }) && !recommendedColors.includes('#ffff00') && !recommendedColors.includes('#111827'), recommendedColors.join('、'));
      ok('刷新时把旧版亮色和深色安全迁移为中等色', win.eval('hydrate({groupColors:{甲:"#ffff00",乙:"#004b5a",自定义:"#123456"}}).groupColors.甲') === '#b7791f' && win.eval('hydrate({groupColors:{甲:"#ffff00",乙:"#004b5a",自定义:"#123456"}}).groupColors.乙') === '#0891b2' && win.eval('hydrate({groupColors:{甲:"#ffff00",乙:"#004b5a",自定义:"#123456"}}).groupColors.自定义') === '#123456');
      const fills = ['#378add','#1d9e75','#ef9f27','#e24b4a','#534ab7'];
      const minDistance = recommendedColors.reduce((min, border) => Math.min(min, ...fills.map(fill => {
        const a = rgb(border), b = rgb(fill); return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
      })), Infinity);
      ok('推荐色与任一任务填充色不使用相同色值', minDistance >= 55, String(minDistance));
      ok('甘特图分组边框增加白色分隔层，避免与任务填充色粘连', /group-border-halo/.test(win.applyGroupBorders.toString()) && /strokeWidth\s*=\s*['"]6px/.test(win.applyGroupBorders.toString()));
      ok('推荐色浮层使用 fixed 定位，不撑动表格布局', /\.group-color-pop\{[^}]*position:\s*fixed/.test([...doc.querySelectorAll('style')].map(x => x.textContent).join('\n')));
      $('groupColorPop').querySelector('[data-color="#0891b2"]').click();
      ok('点击推荐色立即应用到整个分组', win.eval('state.groupColors["模块A"]') === '#0891b2' && win.eval('groupColor("模块A")') === '#0891b2');
      groupedRow0 = doc.querySelector('#tbody tr[data-i="0"]');
      groupedRow0.querySelector('[data-act="groupColorMenu"]').click();
      const groupColorPicker = $('groupColorCustom');
      groupColorPicker.value = '#123456';
      groupColorPicker.dispatchEvent(new win.Event('change', { bubbles:true }));
      groupedRow0 = doc.querySelector('#tbody tr[data-i="0"]');
      ok('推荐色不够时可打开自定义色盘', groupColorPicker.type === 'color' && win.eval('state.groupColors["模块A"]') === '#123456' && win.eval('groupColor("模块A")') === '#123456', win.eval('groupColor("模块A")'));
      ok('自定义分组颜色已写入本地缓存', JSON.parse(win.localStorage.getItem('gantt-studio-v3')).items[win.eval('projects.current')].data.groupColors['模块A'] === '#123456');
      ok('分组筛选器列出已填写分组', [...$('groupFilter').options].some(o => o.value === '模块A') && [...$('groupFilter').options].some(o => o.value === '模块B'));
      $('groupFilter').value = '模块A';
      $('groupFilter').dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('选择分组后表格只显示该分组', doc.querySelectorAll('#tbody tr[data-i]').length === 1 && doc.querySelector('#tbody [data-f="group"]').value === '模块A');
      ok('分组预览代码只含当前分组且复制代码保留全部任务', win.eval('genMermaid(visibleTasks(), true)').includes(win.eval('state.tasks[0].name')) && !win.eval('genMermaid(visibleTasks(), true)').includes(win.eval('state.tasks[1].name')) && $('code').value.includes(win.eval('state.tasks[1].name')));
      const filteredAddCount = win.eval('state.tasks.length');
      $('btnAdd').click();
      ok('分组筛选中未选行时，末尾新增任务自动继承当前分组', win.eval('state.tasks.length') === filteredAddCount + 1 && win.eval('state.tasks[state.tasks.length - 1].group') === '模块A' && doc.querySelector('#tbody tr.row-selected [data-f="group"]').value === '模块A');
      win.eval('state.tasks.pop(); selectedTaskId=null; renderTable(); refresh()');
      $('groupFilter').value = '';
      $('groupFilter').dispatchEvent(new win.Event('change', { bubbles:true }));

      const selectedBase = doc.querySelector('#tbody tr[data-i="1"]');
      selectedBase.dispatchEvent(new win.MouseEvent('click', { bubbles:true }));
      ok('点击任务行后保持选中状态', selectedBase.classList.contains('row-selected') && selectedBase.getAttribute('aria-selected') === 'true');
      const beforeInsertCount = win.eval('state.tasks.length');
      $('btnAdd').click();
      ok('添加任务插入选中行下一行', win.eval('state.tasks.length') === beforeInsertCount + 1 && win.eval('state.tasks[2].name') === '新任务');
      ok('插入任务继承选中行的阶段与计划分组', win.eval('state.tasks[2].section === state.tasks[1].section && state.tasks[2].group === state.tasks[1].group'));
      ok('新插入任务成为新的选中行', doc.querySelector('#tbody tr[data-i="2"]').classList.contains('row-selected'));
      win.eval('state.tasks.splice(2,1); selectedTaskId=null; renderTable(); refresh()');
      $('groupFilter').value = '模块A';
      $('groupFilter').dispatchEvent(new win.Event('change', { bubbles:true }));
      $('groupFilter').value = '__collapsed__';
      $('groupFilter').dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('同一个下拉框收起时自动退出筛选并恢复全部任务', $('groupFilter').value === '__collapsed__' && win.eval('activeGroupFilter') === '' && doc.querySelectorAll('#tbody tr[data-i]').length === win.eval('state.tasks.length'));
      ok('收起后分组名称与自定义颜色没有被删除', win.eval('state.tasks[0].group') === '模块A' && win.eval('state.groupColors["模块A"]') === '#123456');

      const firstRowForDates = doc.querySelector('#tbody tr[data-i="0"]');
      const startInput = firstRowForDates.querySelector('[data-f=start]');
      const endInput = firstRowForDates.querySelector('[data-f=end]');
      const originalStart = startInput.value, originalEnd = endInput.value;
      startInput.value = '';
      startInput.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('清空开始日期会提示并恢复原值', startInput.value === originalStart && $('toast').textContent.includes('日期不能为空'), startInput.value + ' / ' + $('toast').textContent);
      endInput.value = '2000-01-01';
      endInput.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('结束日期早于开始日期会提示并恢复原值', endInput.value === originalEnd && $('toast').textContent.includes('不能早于'), endInput.value + ' / ' + $('toast').textContent);

      const editableDuration = firstRowForDates.querySelector('[data-f="duration"]');
      editableDuration.value = '9';
      editableDuration.dispatchEvent(new win.Event('change', { bubbles:true }));
      const durationEnd = win.eval('addDays(state.tasks[0].start, 8)');
      ok('修改自然日工期会同步结束日期', win.eval('state.tasks[0].end') === durationEnd && endInput.value === durationEnd, endInput.value + ' / ' + durationEnd);
      ok('工期修改显示绿色同步提示', $('toast').classList.contains('success') && $('toast').textContent.includes('9 自然日') && $('toast').textContent.includes('结束时间已同步修改'), $('toast').textContent);
      const updatedWorkDays = win.eval('workDaysInclusive(state.tasks[0].start, state.tasks[0].end)');
      ok('修改自然日工期后工作日自动重算', firstRowForDates.querySelector('[data-f="workDuration"]').value === String(updatedWorkDays), firstRowForDates.querySelector('.dur-work').textContent);
      const refreshedDuration = firstRowForDates.querySelector('[data-f="duration"]');
      refreshedDuration.value = '0';
      refreshedDuration.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('非法工期会恢复并显示红色提示', refreshedDuration.value === '9' && $('toast').classList.contains('error') && $('toast').textContent.includes('1–3650'), refreshedDuration.value + ' / ' + $('toast').textContent);

      const editableWorkDuration = firstRowForDates.querySelector('[data-f="workDuration"]');
      editableWorkDuration.value = '5';
      editableWorkDuration.dispatchEvent(new win.Event('change', { bubbles:true }));
      const workDurationEnd = win.eval('endDateForWorkDays(state.tasks[0].start, 5)');
      ok('修改工作日工期会同步结束日期', win.eval('state.tasks[0].end') === workDurationEnd && endInput.value === workDurationEnd, endInput.value + ' / ' + workDurationEnd);
      ok('工作日工期修改显示绿色同步提示', $('toast').classList.contains('success') && $('toast').textContent.includes('5 工作日') && $('toast').textContent.includes('结束时间已同步修改'), $('toast').textContent);

      let milestoneBox = firstRowForDates.querySelector('[data-f=milestone]');
      milestoneBox.checked = true;
      milestoneBox.dispatchEvent(new win.Event('change', { bubbles:true }));
      let milestoneRow = doc.querySelector('#tbody tr[data-i="0"]');
      let milestoneStart = milestoneRow.querySelector('[data-f=start]');
      let milestoneEnd = milestoneRow.querySelector('[data-f=end]');
      ok('设为里程碑后开始结束立即强制同日', milestoneStart.value === milestoneEnd.value && win.eval('state.tasks[0].start === state.tasks[0].end'));
      const milestoneDurationInput = milestoneRow.querySelector('[data-f="duration"]');
      const milestoneWorkDurationInput = milestoneRow.querySelector('[data-f="workDuration"]');
      ok('里程碑自然日和工作日工期均固定为 0 且只读', milestoneDurationInput.value === '0' && milestoneDurationInput.readOnly && milestoneWorkDurationInput.value === '0' && milestoneWorkDurationInput.readOnly);
      milestoneDurationInput.click();
      ok('点击里程碑工期明确提示先取消里程碑', $('toast').classList.contains('error') && $('toast').textContent.includes('工期固定为 0 天') && $('toast').textContent.includes('先取消里程碑'), $('toast').textContent);
      const shiftedMilestoneDate = win.eval('addDays(state.tasks[0].start, 2)');
      milestoneEnd.value = shiftedMilestoneDate;
      milestoneEnd.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('正常修改里程碑结束日期会同步开始日期', milestoneEnd.value === shiftedMilestoneDate && milestoneStart.value === shiftedMilestoneDate, milestoneStart.value + ' / ' + milestoneEnd.value);
      ok('修改结束时间时明确提示开始时间已同步', $('toast').textContent.includes('开始时间已同步修改') && !$('toast').textContent.includes('另一个时间') && $('toast').classList.contains('success') && !$('toast').classList.contains('error') && $('toast').getAttribute('role') === 'status', $('toast').textContent);
      const shiftedMilestoneStart = win.eval('addDays(state.tasks[0].start, 1)');
      milestoneStart.value = shiftedMilestoneStart;
      milestoneStart.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('正常修改里程碑开始日期会同步结束日期', milestoneStart.value === shiftedMilestoneStart && milestoneEnd.value === shiftedMilestoneStart && $('toast').classList.contains('success'), milestoneStart.value + ' / ' + milestoneEnd.value);
      ok('修改开始时间时明确提示结束时间已同步', $('toast').textContent.includes('结束时间已同步修改') && !$('toast').textContent.includes('另一个时间'), $('toast').textContent);
      ok('提示位于导入工具栏同一行', $('toast').parentElement.classList.contains('schedule-head') && /top:\s*50%/.test(cssTextForTable));
      milestoneBox = milestoneRow.querySelector('[data-f=milestone]');
      milestoneBox.checked = false;
      milestoneBox.dispatchEvent(new win.Event('change', { bubbles:true }));
      milestoneEnd.value = win.eval('addDays(state.tasks[0].start, 3)');
      milestoneEnd.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('取消里程碑后允许设置时间段', win.eval('state.tasks[0].start !== state.tasks[0].end'));

      let depRow = doc.querySelector('#tbody tr[data-i="1"]');
      let depStart = depRow.querySelector('[data-f=start]');
      const constrainedStart = depStart.value;
      ok('有前置任务的开始日期显示为只读锁定', depStart.readOnly && depStart.dataset.locked === 'deps');
      depStart.click();
      ok('点击被前置锁定的开始日期会报告前置原因', $('toast').textContent.includes('已有前置') && $('toast').textContent.includes('请先取消前置') && !$('toast').textContent.includes('该任务是里程碑'), $('toast').textContent);
      depStart.value = '2099-01-01';
      depStart.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('强行修改有前置任务的开始日期会恢复', depStart.value === constrainedStart && win.eval('state.tasks[1].start') === constrainedStart && $('toast').textContent.includes('请先取消前置'), depStart.value + ' / ' + $('toast').textContent);
      win.eval('state.tasks[1].milestone = true; normalizeTaskConstraints(state.tasks); renderTable(); refresh()');
      depRow = doc.querySelector('#tbody tr[data-i="1"]');
      depStart = depRow.querySelector('[data-f=start]');
      const depEnd = depRow.querySelector('[data-f=end]');
      depEnd.value = win.eval('addDays(state.tasks[1].end, 2)');
      depEnd.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('同时有前置和里程碑时，修改结束日期只报告里程碑原因', $('toast').textContent.includes('该任务是里程碑') && !$('toast').textContent.includes('已有前置') && depEnd.value === depStart.value, $('toast').textContent);
      ok('违反组合约束仍使用红色错误样式', $('toast').classList.contains('error') && !$('toast').classList.contains('success') && $('toast').getAttribute('role') === 'alert');
      depStart.click();
      ok('同时有前置和里程碑时，修改开始日期只报告前置原因', $('toast').textContent.includes('已有前置') && !$('toast').textContent.includes('该任务是里程碑'), $('toast').textContent);
      win.eval('state.tasks[1].milestone = false; state.tasks[1].deps = []; renderTable(); refresh()');
      depRow = doc.querySelector('#tbody tr[data-i="1"]');
      depStart = depRow.querySelector('[data-f=start]');
      const freeStart = win.eval('addDays(state.tasks[1].start, 1)');
      depStart.value = freeStart;
      depStart.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('取消前置后允许修改开始日期', !depStart.readOnly && win.eval('state.tasks[1].start') === freeStart);
      win.eval('state.tasks[1].deps = [state.tasks[0].id]; autoReschedule(); renderTable(); refresh()');

      const progressInput = doc.querySelector('#tbody tr[data-i="0"] [data-f=progress]');
      progressInput.value = '150';
      progressInput.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('进度超过 100 时显示值与缓存值同步限制为 100', progressInput.value === '100' && win.eval('state.tasks[0].progress') === 100 && $('toast').textContent.includes('0–100'), progressInput.value + ' / ' + $('toast').textContent);
      /* 取一行任务，验证操作列同时提供拖动与删除 */
      const r1 = doc.querySelector('#tbody tr');
      const opsCell = r1 && r1.querySelector('td.ops-cell');
      const handle = opsCell && opsCell.querySelector('.drag-handle');
      const del = opsCell && opsCell.querySelector('button.del');
      ok('每行操作列存在', !!opsCell);
      ok('拖动把手存在且可拖动', !!handle && handle.draggable === true);
      ok('删除按钮存在', !!del && del.textContent.trim() === '×');
      ok('操作列仅含拖动与删除两个按钮', opsCell && opsCell.querySelectorAll('button').length === 2);
      ok('行本身不启用 draggable（避免编辑时误拖）', r1.draggable !== true);

      /* 模拟真实拖放：把第一行放到第二行之后 */
      const beforeDrag = [...doc.querySelectorAll('#tbody tr')].slice(0, 2).map(tr => tr.querySelector('[data-f=name]').value);
      const dataTransfer = { effectAllowed:'', dropEffect:'', setData(){}, getData(){ return '0'; } };
      const dragStart = new win.Event('dragstart', { bubbles:true, cancelable:true });
      Object.defineProperty(dragStart, 'dataTransfer', { value:dataTransfer });
      handle.dispatchEvent(dragStart);
      const secondRow = doc.querySelectorAll('#tbody tr')[1];
      const drop = new win.MouseEvent('drop', { bubbles:true, cancelable:true, clientY:1 });
      Object.defineProperty(drop, 'dataTransfer', { value:dataTransfer });
      secondRow.dispatchEvent(drop);
      const afterDrag = [...doc.querySelectorAll('#tbody tr')].slice(0, 2).map(tr => tr.querySelector('[data-f=name]').value);
      ok('拖动把手可调整行顺序', afterDrag[0] === beforeDrag[1] && afterDrag[1] === beforeDrag[0], afterDrag.join(' → '));

      /* 删除当前第一行，验证按钮行为与重新渲染 */
      const rowsBeforeDelete = doc.querySelectorAll('#tbody tr').length;
      doc.querySelector('#tbody button.del').click();
      ok('删除按钮可删除当前行', doc.querySelectorAll('#tbody tr').length === rowsBeforeDelete - 1,
         '删除前 ' + rowsBeforeDelete + '，删除后 ' + doc.querySelectorAll('#tbody tr').length);

      console.log('\n[DOM e2e] 排期表 / 甘特图可调分隔条');
      const splitter = $('splitter');
      const mainApp = $('mainApp');
      ok('存在可访问的横向分隔条', !!splitter && splitter.getAttribute('role') === 'separator');
      ok('默认上下各占一半', splitter.getAttribute('aria-valuenow') === '50' && mainApp.style.getPropertyValue('--table-pane-size') === '50.0%',
         splitter.getAttribute('aria-valuenow') + ' / ' + mainApp.style.getPropertyValue('--table-pane-size'));
      splitter.dispatchEvent(new win.KeyboardEvent('keydown', { key:'ArrowUp', bubbles:true, cancelable:true }));
      ok('键盘上箭头可缩小排期表区域', splitter.getAttribute('aria-valuenow') === '45', splitter.getAttribute('aria-valuenow'));
      splitter.dispatchEvent(new win.KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
      ok('回车恢复各占一半', splitter.getAttribute('aria-valuenow') === '50', splitter.getAttribute('aria-valuenow'));
      mainApp.getBoundingClientRect = () => ({ top:0, height:500, left:0, right:1000, bottom:500, width:1000 });
      splitter.dispatchEvent(new win.MouseEvent('pointerdown', { clientY:250, bubbles:true, cancelable:true }));
      doc.dispatchEvent(new win.MouseEvent('pointermove', { clientY:350, bubbles:true, cancelable:true }));
      doc.dispatchEvent(new win.MouseEvent('pointerup', { clientY:350, bubbles:true, cancelable:true }));
      ok('拖动分隔条可调整为 70% / 30%', splitter.getAttribute('aria-valuenow') === '70' && mainApp.style.getPropertyValue('--table-pane-size') === '70.0%',
         splitter.getAttribute('aria-valuenow') + ' / ' + mainApp.style.getPropertyValue('--table-pane-size'));
      win.setLayout('table');
      ok('仅排期表布局隐藏分隔条', mainApp.className === 'layout-table');
      win.setLayout('chart');
      ok('仅甘特图布局隐藏分隔条', mainApp.className === 'layout-chart');
      splitter.dispatchEvent(new win.KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
      win.setLayout('both');
      ok('切回全部布局保留分隔条与 50% 比例', mainApp.className === 'layout-both' && splitter.getAttribute('aria-valuenow') === '50');

      console.log('\n[DOM e2e] 负责人 / 日期外部开关与手动时间轴');
      const ownerToggle = $('showOwner'), datesToggle = $('showDates');
      ok('甘特图工具栏同时提供负责人和日期开关', !!ownerToggle && !!datesToggle);
      const firstOwner = doc.querySelector('#tbody [data-f=owner]').value;
      ownerToggle.checked = false;
      ownerToggle.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('关闭负责人会同步移除生成代码中的负责人', !$('code').value.includes('·' + firstOwner));
      ownerToggle.checked = true;
      ownerToggle.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('开启负责人会同步写入生成代码', $('code').value.includes('·' + firstOwner));
      datesToggle.checked = false;
      datesToggle.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('关闭日期会移除自动日期后缀', !/\(\d{1,2}\/\d{1,2}(?:-\d{1,2}\/\d{1,2})?\)/.test($('code').value));
      datesToggle.checked = true;
      datesToggle.dispatchEvent(new win.Event('change', { bubbles:true }));
      ok('开启日期会写入自动日期后缀', /\(\d{1,2}\/\d{1,2}(?:-\d{1,2}\/\d{1,2})?\)/.test($('code').value));
      $('btnStyle').click();
      ok('样式设置中已删除任务名增强', !$('smodal').textContent.includes('任务名增强') && !$('s_nameDates') && !$('s_nameOwner'));
      ok('样式设置中已删除智能刻度', !$('smodal').textContent.includes('智能刻度') && !$('s_smartTicks'));
      $('s_tick').value = '1month';
      $('sOk').click();
      ok('时间轴严格使用手动选择', $('code').value.includes('tickInterval 1month'));
      win.eval("state.style.axisFormat='%m/%d'; syncStyleUI();");
      ok('样式面板保留非选项值（动态补项）', $('s_axisFormat').value === '%m/%d' && !!$('s_axisFormat').querySelector('option[value="%m/%d"]'), $('s_axisFormat').value);
      $('sOk').click();
      ok('非选项 axisFormat 应用后进入生成代码', $('code').value.includes('axisFormat %m/%d'));
      win.eval("state.style.axisFormat='%m-%d';");

      console.log('\n[DOM e2e] 操作分组与紧凑响应式页头');
      const inner = $('headerInner');
      ok('存在 .header-inner 容器', !!inner);
      const scheduleActions = doc.querySelector('.schedule-actions');
      const tableActionIds = ['btnImport','btnBackup','btnReset','btnReschedule','btnSample','btnClear','btnAdd'];
      ok('排期相关操作全部移到排期表标题栏', tableActionIds.every(id => $(id).parentElement === scheduleActions));
      ok('原重排按钮已改为智能排序并说明排序规则', $('btnReschedule').textContent.trim() === '智能排序' && $('btnReschedule').title.includes('依赖关系') && $('btnReschedule').title.includes('开始时间'));
      const topActions = doc.querySelector('.top-actions');
      ok('顶栏操作区含备注/复制代码/导出 PNG', !!topActions && [...topActions.querySelectorAll('button')].map(b => b.id).join(',') === 'btnNotes,btnCopyTop,btnExport');
      const settings = doc.querySelector('.header-settings');
      ok('主题与帮助组成最右侧设置组', !!settings && $('themeToggle').parentElement === settings && $('btnHelp').parentElement === settings && inner.lastElementChild === settings);
      const innerCs = win.getComputedStyle(inner);
      const cssText = [...doc.querySelectorAll('style')].map(x => x.textContent).join('\n');
      ok('页头禁止横向滚动并允许换行', (innerCs.overflow === 'hidden' || cssText.includes('flex-wrap:wrap; overflow:hidden')) && innerCs.flexWrap === 'wrap',
         (innerCs.overflow || innerCs.overflowX) + ' / ' + innerCs.flexWrap);
      ok('窄屏仅让排期操作区内部换行', cssText.includes('.schedule-actions') && cssText.includes('flex-wrap:wrap'));
      ok('760px 以下标题与排期操作区继续响应式调整', cssText.includes('@media(max-width:760px)') && cssText.includes('.schedule-actions{justify-content:flex-start'));

      console.log('\n[DOM e2e] 任务备注抽屉（右侧常驻面板，本地记录）');
      const firstNoteBtn = doc.querySelector('#tbody .note-btn');
      const drawer = $('notesDrawer');
      const list = $('notesList');
      const badge = $('notesBadge');
      ok('存在 notesDrawer 容器', !!drawer);
      ok('存在 notesList 列表', !!list);
      ok('存在顶栏 notesBadge 计数', !!badge);
      ok('初始为折叠态（无 .on）', !drawer.classList.contains('on'));
      ok('初始为空数据（data-empty=1）', drawer.getAttribute('data-empty') === '1');
      ok('初始 badge 隐藏', badge.hidden === true);
      ok('任务名旁存在备注图标', !!firstNoteBtn);
      ok('初始备注图标为无备注态', !!firstNoteBtn && !firstNoteBtn.classList.contains('has'));
      const targetRow = doc.querySelector('#tbody tr');
      const targetName = targetRow.querySelector('[data-f=name]').value;
      const NOTE_TXT = '9/15 会议：钢材改 0.6mm，开模顺延 2 天';
      firstNoteBtn.click();
      ok('点击备注图标打开 drawer', drawer.classList.contains('on'));
      ok('drawer 显示当前任务名条目', !!list.querySelector('.nd-item .nd-item-name') && list.querySelector('.nd-item .nd-item-name').textContent.includes(targetName));
      ok('点击后自动进入编辑态（textarea 已挂载）', !!list.querySelector('.nd-item textarea'));
      const ta0 = list.querySelector('.nd-item textarea');
      ta0.value = NOTE_TXT;
      ta0.dispatchEvent(new win.Event('input', { bubbles: true }));
      ta0.dispatchEvent(new win.FocusEvent('blur', { bubbles: false }));
      ok('blur 后图标进入有备注态', targetRow.querySelector('.note-btn').classList.contains('has'));
      const saved = JSON.parse(win.localStorage.getItem('gantt-studio-v3'));
      const cur = saved.items[saved.current].data;
      ok('备注已写入本地存储', cur.tasks[0].note === NOTE_TXT, String(cur.tasks[0].note));
      ok('badge 显示 1', badge.textContent === '1' && !badge.hidden);
      ok('drawer 计数显示 1', $('notesCount').textContent === '1');
      ok('drawer 列表至少 1 条', list.querySelectorAll('.nd-item').length >= 1);
      /* 重开编辑：点 .nd-item-name 旁边的正文 */
      const itemEl = list.querySelector('.nd-item');
      itemEl.querySelector('.nd-item-body').click();
      ok('再次点正文可进入编辑态', !!list.querySelector('.nd-item textarea'));
      const ta1 = list.querySelector('.nd-item textarea');
      ok('textarea 回显已存备注', ta1.value === NOTE_TXT, ta1.value);
      ta1.value = '临时改动不应保存';
      ta1.dispatchEvent(new win.Event('input', { bubbles: true }));
      ta1.dispatchEvent(new win.FocusEvent('blur', { bubbles: false }));
      const afterEsc = JSON.parse(win.localStorage.getItem('gantt-studio-v3'));
      ok('blur 落盘为最新值', afterEsc.items[afterEsc.current].data.tasks[0].note === '临时改动不应保存', String(afterEsc.items[afterEsc.current].data.tasks[0].note));
      /* 验证复制格式（纯文本）：写一条带负责人的 */
      targetRow.querySelector('.note-btn').click();
      const ta2 = list.querySelector('.nd-item textarea');
      ta2.value = '与供应商确认 9/20 交期';
      ta2.dispatchEvent(new win.FocusEvent('blur', { bubbles: false }));
      const sampleTxt = win.eval('notesPlainText()');
      ok('纯文本格式含【任务名】', sampleTxt.includes('【') && sampleTxt.includes('】'), sampleTxt);
      ok('纯文本格式含正文', sampleTxt.includes('与供应商确认 9/20 交期'), sampleTxt);
      ok('纯文本格式无 Mermaid 标记', !sampleTxt.includes('gantt') && !sampleTxt.includes('section'), sampleTxt);
      /* 清除：点 .nd-item-del → 走 confirm */
      const delBtn = list.querySelector('.nd-item .nd-item-del');
      delBtn.click();
      ok('清除备注需经确认框', cf.classList.contains('on'));
      $('cfOk').click();
      ok('确认后图标回落无备注态', !targetRow.querySelector('.note-btn').classList.contains('has'));
      const afterClear = JSON.parse(win.localStorage.getItem('gantt-studio-v3'));
      ok('清空后本地为无备注', (afterClear.items[afterClear.current].data.tasks[0].note || '') === '');
      ok('badge 隐藏（无备注时）', badge.hidden === true);
      ok('drawer data-empty=1（无备注时）', drawer.getAttribute('data-empty') === '1');
      /* 顶栏 toggle 关闭 */
      $('btnNotes').click();
      ok('顶栏备注按钮可关闭 drawer', !drawer.classList.contains('on'));
      /* 顶栏 toggle 再次打开 */
      $('btnNotes').click();
      ok('顶栏备注按钮可重开 drawer', drawer.classList.contains('on'));

      /* 起止日期胶囊 + 纯自由文本备注（不解析提醒，2026-09-17 起） */
      win.eval('state.tasks[0].start = "2026-09-08"; state.tasks[0].end = "2026-09-20"; renderTable();');
      const rmRow = doc.querySelector('#tbody tr[data-i="0"]');
      rmRow.querySelector('.note-btn').click();
      const taR = list.querySelector('.nd-item textarea');
      ok('新建备注进入编辑态', !!taR);
      taR.value = '提前3天提醒，确认物料到位';
      taR.dispatchEvent(new win.Event('input', { bubbles: true }));
      taR.dispatchEvent(new win.FocusEvent('blur', { bubbles: false }));
      const rmItem = list.querySelector('.nd-item');
      const rmDateEl = rmItem.querySelector('.nd-item-date');
      ok('条目显示起止日期胶囊（9/8–9/20）', !!rmDateEl && rmDateEl.textContent === '9/8–9/20', rmDateEl ? rmDateEl.textContent : 'null');
      ok('条目不再输出推算的提醒行', !rmItem.querySelector('.nd-item-remind'), rmItem.querySelector('.nd-item-remind') ? rmItem.querySelector('.nd-item-remind').textContent : '');
      ok('备注原样显示（含提醒字样也不加工）', rmItem.querySelector('.nd-item-body').textContent === '提前3天提醒，确认物料到位',
         rmItem.querySelector('.nd-item-body').textContent);
      const todoTxt = win.eval('notesTodoText()');
      ok('待办清单含标题行', /^待办清单 · /.test(todoTxt.split('\n')[0] || ''), todoTxt.split('\n')[0]);
      ok('待办清单不含推算的提醒日期行', !/\n   提醒：/.test(todoTxt), todoTxt);
      ok('待办清单含起止短格式', (todoTxt.split('\n')[1] || '').includes('9/8–9/20'), todoTxt.split('\n')[1]);
      ok('待办清单含备注正文', todoTxt.includes('确认物料到位'));

      console.log('\n[DOM e2e] 顶栏示例按钮不覆盖当前项目（关键安全契约）');
      /* 当前备注 drawer 是打开的，且已有 1 条备注（来自前面 [DOM e2e] 任务备注抽屉段） */
      /* 先关 drawer，避免与后续按钮冲突 */
      $('btnNotes').click();
      /* 准备一段「真实排期」：新建一个项目 + 加一条任务 */
      $('btnNewProj').click();
      $('npName').value = '我的真实排期';
      $('npOk').click();
      const realProjId = win.eval('projects.current');
      const realTitleBefore = win.eval('state.title');
      /* 直接通过 state API 注入一条任务并渲染，避免依赖 btnAdd 渲染时序 */
      win.eval('state.tasks.push(newTask(0)); state.tasks[0].name="不要覆盖我"; renderTable();');
      const realTaskNameBefore = win.eval('state.tasks[0].name');
      /* 点顶栏「示例」按钮 —— 关键安全契约：原项目原任务应完好 */
      $('btnSample').click();
      const curId = win.eval('projects.current');
      ok('点 btnSample 后 current 切换到新项目', curId && curId !== realProjId, 'curId=' + curId + ' realProjId=' + realProjId);
      const itemsAfter = win.eval('Object.keys(projects.items)');
      ok('点 btnSample 后项目数 ≥ 2', itemsAfter.length >= 2, '实际 ' + itemsAfter.length);
      const realStillThere = win.eval('!!projects.items["' + realProjId + '"]');
      ok('原项目仍在 projects.items 里', realStillThere);
      const realItemAfter = win.eval('projects.items["' + realProjId + '"]');
      ok('原项目 title 未被覆盖', realItemAfter.name === '我的真实排期', realItemAfter.name);
      ok('原项目标题 state.title 未被覆盖', realItemAfter.data.title === realTitleBefore, realItemAfter.data.title);
      ok('原项目任务 0 名称未被覆盖', realItemAfter.data.tasks[0].name === realTaskNameBefore, realItemAfter.data.tasks[0].name);
      /* 新项目应填入示例数据 */
      const newItem = win.eval('projects.items[projects.current]');
      ok('新项目名为「示例项目」', newItem.name === '示例项目', newItem.name);
      ok('新项目含 15 条示例任务', newItem.data.tasks.length === 15, '实际 ' + newItem.data.tasks.length);
      /* 切回原项目，验证表格里那条「不要覆盖我」还在 */
      win.eval('switchProject("' + realProjId + '")');
      const switchedBack = win.eval('state.tasks[0].name');
      ok('切回原项目后「不要覆盖我」仍在', switchedBack === '不要覆盖我', switchedBack);
      /* 连续点两次示例，应再建两个示例项目 */
      const beforeCount = win.eval('Object.keys(projects.items).length');
      $('btnSample').click();
      $('btnSample').click();
      const afterCount = win.eval('Object.keys(projects.items).length');
      ok('连续两次示例后项目数 +2', afterCount === beforeCount + 2, 'before=' + beforeCount + ' after=' + afterCount);

      console.log(fail ? '\n失败 ' + fail + ' 项' : '\nDOM e2e 全部通过');
      win.close();
      process.exit(fail ? 1 : 0);
    }, 120);
  } catch (e) {
    console.error('DOM e2e 异常: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
    process.exit(1);
  }
}, 200);
