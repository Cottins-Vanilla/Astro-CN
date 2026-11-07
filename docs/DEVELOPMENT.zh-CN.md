# 开发、构建与本地版本管理

## 环境

- Node.js 24 LTS
- pnpm 11.25.0（package.json 已固定）
- Git
- 制作本次 Windows 安装包需在 Windows x64 环境运行。

~~~sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm check:paths
~~~

构建先生成内部工作区包，再生成前端和 Electron 主进程。不要跳过内部包构建后直接测试依赖它们的桌面代码。

## 调试

~~~sh
# 浏览器界面；数据存放于当前浏览器的 IndexedDB
pnpm dev

# 构建完成后启动桌面版
pnpm --filter @solen/desktop start
~~~

开发模式使用单独的桌面配置目录。测试请使用临时知识库，不要用包含私人笔记和密钥的真实知识库做演示。

## 制作 Windows 安装包

~~~sh
pnpm install --frozen-lockfile
pnpm build:windows
~~~

该命令构建工作区、生成依赖许可，然后调用 electron-builder 制作 Windows x64 NSIS 安装包，不会自动上传发布。

产物位于 apps/desktop/release：

- Astro-CN-0.2.0-windows-x64-setup.exe
- win-unpacked/：用于本地验证的完整应用目录。

首次打包需要联网获取 Electron、NSIS 等官方构建组件。安装包使用简体中文向导、按用户安装，可选择安装位置，并提供快捷方式选项。不需要把 node_modules、dist 或 release 提交到源码仓库。

安装包默认不带代码签名。若要签名，应由维护者配置自己的证书和受保护的 CI 密钥，不能把证书或私钥提交到仓库。

## 许可文件

~~~sh
pnpm licenses:bundle
~~~

此脚本读取本地已安装的生产依赖，收集许可证文本并输出到桌面构建资源目录。源依赖必须先安装。生成的许可汇总随安装包分发，不把机器路径写进去。

## 版本与 Git

首个提交保存了开始整理前的修改版源码；后续提交记录文档、打包和功能变更。可用以下命令查看：

~~~sh
git log --oneline
git show --stat HEAD
git diff HEAD~1 HEAD
~~~

根包和桌面包的 0.2.0 是社区发行版本；内部私有工作区包可以保留各自版本。上游 v0.1.1 的来源关系写在 docs/UPSTREAM.md 中。

## 检查与发布

发布前确认测试通过，使用隔离数据验证安装、启动、笔记编辑与卸载，检查源码和截图无个人信息。安装包校验和应在最终文件生成后计算。

GitHub Actions 的 CI 用于源码构建与测试；Release 工作流通过手动触发构建安装包并保存为 Actions 产物，不会自行创建公开 Release。正式发布由维护者检查后执行，见 docs/RELEASE.md。

## 已知边界

本次实际发布平台为 Windows x64。仓库保留的 macOS、Linux、MCP、账户和终端代码来自上游及本地修改，不代表每个组合都已完成发行验证。当前安装包不包含独立 MCP 服务运行包。
