# Astro CN 0.2.0 · 中文增强版

Astro CN 基于 [Solen AI / Astro](https://github.com/Solen-AI-org/Astro) v0.1.1，是社区维护的中文增强版本，并非原作者官方中文发行版。原作者版权及 MIT 许可保留。

## 这次发布带来了什么

- 简体中文界面、设置说明、提示与示例。
- Markdown 编辑 / 预览 / 源码，多语言代码高亮、格式化粘贴和隐藏围栏。
- 文件夹及笔记混合排序，嵌套分类、整棵目录跨层级移动。
- 2D / 3D 知识星图，平面节点和标题避让、自动整理与星座排列。
- DeepSeek 等服务配置、当前模型信息，以及将助手回答插入当前笔记。
- 修复笔记改名后星图遗留旧标题、再次点击误建笔记等问题。
- 中文项目文档、使用指南、开发指南、许可汇总和 Windows 安装包。

## 下载与安装

适用于 Windows 10 / 11 x64。下载 Astro-CN-0.2.0-windows-x64-setup.exe，运行中文安装向导。安装目录可以选择；普通使用不需要额外安装 Node.js。

首次启动选择知识库文件夹。现有本地中文版用户可以继续选择原知识库；升级前请导出备份。笔记保存在所选知识库的 .astro 子目录，应用配置位于 %APPDATA%/Astro-Chinese。

## 校验

SHA256SUMS.txt 列出最终附件的 SHA-256。可使用 PowerShell 的 Get-FileHash 命令计算下载文件的 SHA256 并对照。

## 使用前了解

- 安装包暂未签名，暂无自动更新承诺。
- 密集图谱仍可能有交叉连线。
- AI 需要自己的服务配置；启用后相关提问和上下文会发送给所选服务。密钥目前随知识库设置保存，分享知识库前应清除。
- 当前实际发行验证为 Windows x64；macOS / Linux 未发布验证安装包。
- 独立 MCP 服务运行包不包含在此安装包中；需要时请从源码构建。

详细变化见 [CHANGELOG.md](https://github.com/Cottins-Vanilla/Astro-CN/blob/main/CHANGELOG.md)，使用方式见[使用指南](https://github.com/Cottins-Vanilla/Astro-CN/blob/main/docs/USER-GUIDE.zh-CN.md)。

## 验证结果

本地工作区构建与类型检查通过，668 项自动测试通过。实际安装版完成 11 项界面与磁盘保存检查，安装及卸载验证通过，卸载后外部演示知识库保持完整。详见 [验证记录](https://github.com/Cottins-Vanilla/Astro-CN/blob/main/docs/VALIDATION-0.2.0.md)。

## 开源与致谢

原项目：Solen-AI-org/Astro，Copyright (c) 2026 Solen AI，MIT。星座数据和其他依赖遵守各自许可，安装包附带对应说明。感谢原作者和开源社区。
