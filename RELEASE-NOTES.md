# Astro CN 0.2.1 · 笔记标题修复与分层关联

本次更新面向 Windows 10 / 11 x64 桌面用户，重点改进笔记标题保存和「关联笔记」窗口。

## 相比 0.2.0 的变化

- 修复已有笔记在刷新时标题被重置为「未命名」的问题。暂时清空标题或正在使用中文输入法组词时，可以继续编辑，原有标题会保留到新名称确认。
- 「关联笔记」和「插入笔记链接」现在沿用左侧导航栏的文件夹层级及自定义顺序，支持逐层展开子文件夹。
- 保留搜索，可按笔记名称或文件夹路径查找。搜索结果标明所属文件夹，方便区分同名笔记。按 Enter 选中结果，按 Esc 关闭窗口。
- 改进跨文件夹同名笔记的链接定位。选择具体笔记后，跳转和取消关联都会识别对应的笔记。

## 安装与升级

下载 **Astro-CN-0.2.1-windows-x64-setup.exe** 并运行中文安装向导。已有用户请先关闭 Astro，升级后继续选择原知识库。桌面笔记位于知识库的 `.astro` 子目录，升级前可使用「导出知识库备份」保存一份副本。

安装包未签名。要核对下载内容，可在 PowerShell 中运行 `Get-FileHash .\Astro-CN-0.2.1-windows-x64-setup.exe -Algorithm SHA256`，并与附件 **SHA256SUMS.txt** 中的对应行比较。**Astro-CN-0.2.1-source.zip** 是本次发布的源码归档。

## 项目来源

Astro CN 是基于 Solen AI 的 Astro v0.1.1 维护的社区中文增强版，保留原作者版权及 MIT 许可证。桌面笔记保存在本机，启用 AI 时，用户选中的上下文会发送给所配置的服务。[上游项目](https://github.com/Solen-AI-org/Astro) · [本版使用指南](https://github.com/Cottins-Vanilla/Astro-CN/blob/v0.2.1/docs/USER-GUIDE.zh-CN.md) · [更新日志](https://github.com/Cottins-Vanilla/Astro-CN/blob/v0.2.1/CHANGELOG.md)
