# 甘特图工作台

一个无需安装、打开浏览器就能使用的甘特图编辑工具。

## 直接使用

### 方法一：在线打开

**[点击这里直接打开甘特图工作台](https://lin-guang.github.io/Gantt_Plan/)**

> 如果链接暂时显示 404，说明 GitHub Pages 还没有完成首次启用。

### 方法二：下载到电脑使用

1. **[点击下载 ZIP](https://github.com/Lin-guang/Gantt_Plan/archive/refs/heads/main.zip)**
2. 解压下载的压缩包。
3. 双击文件 **`打开甘特图.html`**。

不需要安装软件，不需要运行命令。请保留解压后的整个文件夹，不要只复制一个 HTML 文件。

## 数据保存在哪里

排期数据保存在当前浏览器中，不会自动上传服务器，也不会自动同步到其他电脑。

重要项目请定期点击页面里的 **“备份”**，保存备份文件。

## 主要功能

- 编辑任务、负责人、开始和结束日期
- 设置前置任务及间隔时间
- 编辑自然日和工作日工期
- 设置里程碑、状态、进度和计划分组
- 导入 Mermaid 甘特图代码
- 复制代码、导出 PNG、备份和恢复

需要了解全部按钮和字段时，请查看 **[完整使用说明](./完整使用说明.md)**。

<details>
<summary>开发与测试说明</summary>

安装测试依赖并运行测试：

```bash
npm install
npm test
```

主要文件：

- `index.html`：应用主体
- `mermaid.min.js`：Mermaid 浏览器运行文件
- `smoke-test.js`：核心逻辑测试
- `dom-e2e-test.js`：DOM 交互测试

</details>
