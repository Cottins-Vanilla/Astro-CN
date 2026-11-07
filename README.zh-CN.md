# Astro 本地中文版

基于官方 v0.1.1 制作的本地汉化版，原项目为 https://github.com/Solen-AI-org/Astro ，采用 MIT 许可证。本版不是原作者的官方中文发行版。

菜单、设置说明、常用提示、示例笔记、内置插件、星座名称和常见错误信息已翻译为简体中文。字体优先使用微软雅黑，中文和英文均能正常显示。知识库称为“知识库”，图谱称为“星图”，没有关联的笔记直接写明含义。

品牌、模型名称、网址、路径和配置字段保留原格式，避免影响使用。第三方网页、命令终端输出、模型服务的原始错误和用户已有笔记不会自动翻译。

直接运行版：双击文件夹中的 Astro中文版.exe，首次启动选择保存笔记的文件夹。整个应用文件夹需要保留。

中文版的配置保存在 AppData/Roaming/Astro-Chinese，与原版配置分开；笔记保存在你选择的知识库文件夹。

## 从源码构建

需要 Node.js 22 以上和 pnpm。使用项目 package.json 指定的 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm --filter @solen/core --filter @solen/plugin-api build
pnpm --filter @solen/mcp-server build
pnpm --filter @solen/desktop dist
```

桌面运行组件和依赖在构建时从各自的官方发布源获取。本地界面已经过类型检查、生产构建和桌面启动验证，笔记格式、关联链接、导入导出及本地保存测试通过。

正式使用前，先阅读应用旁的“使用说明.txt”。
