import {
  newCanvasId,
  newEdgeId,
  newNodeId,
  newNoteId,
  type CanvasDoc,
  type Note,
} from "@solen/core";
import { NOTE_NODE_HEIGHT as CHIP_HEIGHT, NOTE_NODE_WIDTH as CHIP_WIDTH } from "./vaultDefaults";

/** A small demo constellation shown the first time a vault is empty — a
 * handful of notes linked by canvas edges (the graph's structural links,
 * see docs/WORKSPACE-3D.md), which is what the 3D graph renders as stars.
 * A single connected cluster demonstrates the teach flow without separating
 * clusters into different constellations. */
export function seedDemo(): { notes: Note[]; canvas: CanvasDoc } {
  const now = new Date().toISOString();

  const welcomeId = newNoteId();
  const ideasId = newNoteId();
  const readingId = newNoteId();
  const projectsId = newNoteId();
  const questionsId = newNoteId();

  const notes: Note[] = [
    {
      id: welcomeId,
      title: "使用指南",
      tags: ["intro"],
      createdAt: now,
      updatedAt: now,
      body: [
        "# 欢迎使用 Astro 中文版",
        "",
        "这里是你的知识星图，每篇笔记都是一颗星。",
        "点击任意星星，即可打开对应笔记。",
        "",
        "要关联两篇笔记：按住 **Shift** 键，从一颗星拖到",
        "另一颗星，即可建立并保存关联。",
        "按住 Shift 拖到空白处，可以直接新建一篇",
        "与原笔记有关联的新笔记。",
        "",
        "- 拖动星星，可以固定它的位置",
        "- 按 Ctrl+G，切换为星座排列",
        "- 按 Ctrl+K，搜索操作和笔记",
      ].join("\n"),
    },
    {
      id: ideasId,
      title: "灵感收集",
      tags: ["inbox"],
      createdAt: now,
      updatedAt: now,
      body: "从 [[使用指南]] 开始收集灵感。有些资料可以放进 [[阅读清单]]，尚未解决的问题放进 [[待解决问题]]。",
    },
    {
      id: readingId,
      title: "阅读清单",
      tags: ["reading"],
      createdAt: now,
      updatedAt: now,
      body: "从 [[灵感收集]] 中整理值得阅读的内容。#阅读\n\n- 一篇讲解本地保存软件的文章\n- [[以后再看]]：这篇笔记尚未创建，点击链接即可创建",
    },
    {
      id: projectsId,
      title: "项目记录",
      tags: ["projects"],
      createdAt: now,
      updatedAt: now,
      body: "记录项目经验，并关联 [[使用指南]] 和 [[待解决问题]]。",
    },
    {
      id: questionsId,
      title: "待解决问题",
      tags: ["inbox"],
      createdAt: now,
      updatedAt: now,
      body: "记录 [[灵感收集]] 和 [[项目记录]] 中暂时没有解决的问题。",
    },
  ];

  const welcomeNodeId = newNodeId();
  const ideasNodeId = newNodeId();
  const readingNodeId = newNodeId();
  const projectsNodeId = newNodeId();
  const questionsNodeId = newNodeId();
  const textNodeId = newNodeId();
  const linkNodeId = newNodeId();

  const canvas: CanvasDoc = {
    format: "scanvas",
    version: 1,
    id: newCanvasId(),
    name: "使用指南",
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: welcomeNodeId, type: "note", x: 0, y: 0, width: CHIP_WIDTH, height: CHIP_HEIGHT, noteId: welcomeId, color: "violet" },
      { id: ideasNodeId, type: "note", x: 640, y: -80, width: CHIP_WIDTH, height: CHIP_HEIGHT, noteId: ideasId, color: "blue" },
      { id: textNodeId, type: "text", x: 40, y: 280, width: CHIP_WIDTH, height: CHIP_HEIGHT, text: "双击卡片即可编辑。", color: "amber" },
      { id: readingNodeId, type: "note", x: 920, y: 440, width: CHIP_WIDTH, height: CHIP_HEIGHT, noteId: readingId, color: "green" },
      { id: projectsNodeId, type: "note", x: -440, y: 520, width: CHIP_WIDTH, height: CHIP_HEIGHT, noteId: projectsId, color: "amber" },
      { id: questionsNodeId, type: "note", x: 240, y: 840, width: CHIP_WIDTH, height: CHIP_HEIGHT, noteId: questionsId, color: "red" },
      { id: linkNodeId, type: "link", x: -520, y: 120, width: CHIP_WIDTH, height: CHIP_HEIGHT, url: "https://github.com", color: "blue" },
    ],
    edges: [
      { id: newEdgeId(), from: welcomeNodeId, to: ideasNodeId, color: "violet" },
      { id: newEdgeId(), from: ideasNodeId, to: readingNodeId, label: "reading", color: "green" },
      { id: newEdgeId(), from: welcomeNodeId, to: projectsNodeId, color: "amber" },
      { id: newEdgeId(), from: ideasNodeId, to: questionsNodeId, color: "red" },
      { id: newEdgeId(), from: projectsNodeId, to: questionsNodeId, color: "red" },
      { id: newEdgeId(), from: welcomeNodeId, to: textNodeId, color: "violet" },
      { id: newEdgeId(), from: welcomeNodeId, to: linkNodeId, color: "blue" },
    ],
  };

  return { notes, canvas };
}
